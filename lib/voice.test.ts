import { describe, expect, it } from 'vitest';
import {
  EMPTY_VOICE, LIMITS, addFix, addHabit, addWords, applyFixes, forgetLearned, hasPhrase, learnFrom, learnedCount, lessonOf,
  normalizeVoice, readLearned, removeFix, removeWord, replacedSpans, setHabit, setLang, speechPhrases, termsFrom, voiceHints,
  type ChatLesson, type VoiceProfile,
} from './voice';

const NOW = 1_800_000_000_000;
const lesson = (c: Partial<ChatLesson>): ChatLesson => ({ mic: [], said: [], model: { words: [], fixes: [], habits: [] }, corrections: [], retitled: [], ...c });
const fix = (heard: string, meant: string, source: 'you' | 'learned' = 'learned', uses = 1) => ({ heard, meant, source, uses, at: NOW });

describe('normalizeVoice', () => {
  it('reads what’s stored and drops what isn’t right', () => {
    const p = normalizeVoice({
      lang: 'en-IN', notes: 'I mix in Hindi', learn: false, chats: 3,
      words: [{ text: ' Raveena ', source: 'you' }, { text: 'raveena' }, { text: '' }, 'x', { text: 'Q3', uses: 'many' }],
      fixes: [{ heard: 'plum bar', meant: 'plumber', uses: 2 }, { heard: 'same', meant: 'Same' }, { heard: 'x', meant: '' }],
      habits: [{ text: 'Says “kal” for tomorrow' }],
    });
    expect(p.lang).toBe('en-IN');
    expect(p.learn).toBe(false);
    expect(p.words).toEqual([{ text: 'Raveena', source: 'you', uses: 1, at: 0 }, { text: 'Q3', source: 'learned', uses: 1, at: 0 }]);
    expect(p.fixes.map(f => [f.heard, f.meant, f.uses])).toEqual([['plum bar', 'plumber', 2]]);
    expect(p.habits).toHaveLength(1);
  });

  it('starts empty, learning, in the device’s language', () => {
    expect(normalizeVoice(null)).toEqual(EMPTY_VOICE);
    expect(normalizeVoice({ lang: 'english please' }).lang).toBeNull();
  });
});

describe('applyFixes', () => {
  const fixes = [fix('plum bar', 'plumber', 'you'), fix('Robbie', 'Ravi', 'learned', 2), fix('kora mangala', 'Koramangala', 'learned', 1)];

  it('makes the sure fixes, as whole words, whatever the case and punctuation', () => {
    expect(applyFixes('call the plum bar tomorrow, then Robbie', fixes)).toBe('call the plumber tomorrow, then Ravi');
    expect(applyFixes('Plum-bar first', fixes)).toBe('Plumber first');
    expect(applyFixes('plum barn and Robbies', fixes)).toBe('plum barn and Robbies');
  });

  it('leaves a fix learned only once as a hint for the AI', () => {
    expect(applyFixes('meet at kora mangala', fixes)).toBe('meet at kora mangala');
  });

  it('makes each fix once, so one never feeds another', () => {
    expect(applyFixes('a b', [fix('a', 'b', 'you'), fix('b', 'c', 'you')])).toBe('b c');
  });
});

describe('replacedSpans', () => {
  it('finds words swapped for others', () => {
    expect(replacedSpans('call the plum bar tomorrow at 9', 'Call the plumber tomorrow at 9.')).toEqual([{ from: 'plum bar', to: 'plumber' }]);
    expect(replacedSpans('Lunch with Robbie and Sam', 'Lunch with Ravi and Sam')).toEqual([{ from: 'Robbie', to: 'Ravi' }]);
  });

  it('ignores words only added or taken away, and long rewrites', () => {
    expect(replacedSpans('Call plumber', 'Call the plumber about the leak')).toEqual([]);
    expect(replacedSpans('um so call the plumber', 'Call the plumber')).toEqual([]);
    expect(replacedSpans('one two three four five six', 'seven eight nine ten eleven twelve')).toEqual([]);
  });

  it('won’t guess which words replaced which when more were added, unless they’re the same letters', () => {
    expect(replacedSpans('Lunch with Robbie', 'Lunch with Ravi at Toit')).toEqual([]);
    expect(replacedSpans('meet at kora man gala', 'meet at Koramangala')).toEqual([{ from: 'kora man gala', to: 'Koramangala' }]);
  });
});

describe('termsFrom', () => {
  it('finds names, acronyms and codes, not the verb a title starts with', () => {
    expect(termsFrom(['Call Raveena about the Q3 OKR deck', 'Book flight to New York', 'Renew passport', 'Fix the iPhone'])).toEqual(
      ['Raveena', 'Q3 OKR', 'New York', 'iPhone']);
    expect(termsFrom(['Lunch at Toit, Indiranagar', 'Ask Sam (Finance) about it'])).toEqual(['Toit', 'Indiranagar', 'Sam', 'Finance']);
  });
});

describe('speechPhrases', () => {
  it('lists your words and the words it mishears, best first, then labels and names from your tasks', () => {
    const p: VoiceProfile = {
      ...EMPTY_VOICE,
      words: [{ text: 'Q3 OKRs', source: 'learned', uses: 1, at: NOW }, { text: 'Raveena', source: 'you', uses: 1, at: NOW }],
      fixes: [fix('plum bar', 'plumber', 'learned', 3)],
    };
    expect(speechPhrases(p, { labels: ['Work', 'Side project'], titles: ['Call Raveena', 'Lunch with Arjun'] }))
      .toEqual(['Raveena', 'plumber', 'Q3 OKRs', 'Work', 'Side project', 'Arjun']);
  });

  it('keeps everyday words out and stops at the limit', () => {
    const words = Array.from({ length: 150 }, (_, i) => ({ text: `Name${i}`, source: 'you' as const, uses: 1, at: NOW }));
    const out = speechPhrases({ ...EMPTY_VOICE, words: [{ text: 'tomorrow', source: 'you', uses: 9, at: NOW }, ...words] });
    expect(out).toHaveLength(LIMITS.phrases);
    expect(out).not.toContain('tomorrow');
  });
});

describe('learning from a chat', () => {
  const spoken = (more: Partial<ChatLesson> = {}) => lesson({
    mic: ['call the plum bar tomorrow and lunch with Robbie at kora mangala'],
    said: ['Call the plumber tomorrow, and lunch with Ravi at Koramangala.'],
    ...more,
  });

  it('learns the AI’s fixes only where the words were really heard, and not everyday ones', () => {
    const l = lessonOf(spoken({
      model: {
        words: ['Koramangala', 'tomorrow', 'Bengaluru', 'Ravi'],
        fixes: [{ heard: 'plum bar', meant: 'plumber' }, { heard: 'pizza', meant: 'pasta' }, { heard: 'the', meant: 'a' }, { heard: 'kora mangala', meant: 'Koramangala' }],
        habits: ['Says “lunch with” for a 60-minute slot', 'short'],
      },
    }));
    expect(l.fixes).toEqual([{ from: 'plum bar', to: 'plumber', weight: 1 }, { from: 'kora mangala', to: 'Koramangala', weight: 1 }]);
    // Bengaluru was never said, tomorrow is an everyday word, and Koramangala is listened out for as a fix.
    expect(l.words).toEqual(['Ravi']);
    expect(l.habits).toEqual(['Says “lunch with” for a 60-minute slot']);
  });

  it('counts your own corrections twice, so they’re made as you speak from now on', () => {
    const l = lessonOf(spoken({ corrections: [{ from: 'lunch with Robbie at', to: 'lunch with Ravi at' }] }));
    expect(l.fixes).toEqual([{ from: 'Robbie', to: 'Ravi', weight: 2 }]);
    // Words the AI put there, not the mic, are only a hint.
    expect(lessonOf(spoken({ corrections: [{ from: 'lunch with Ravi', to: 'lunch with Raveena' }] })).fixes).toEqual([{ from: 'Ravi', to: 'Raveena', weight: 1 }]);
    const p = learnFrom(EMPTY_VOICE, spoken({ corrections: [{ from: 'lunch with Robbie', to: 'lunch with Ravi' }] }), NOW);
    expect(applyFixes('ping Robbie', p.fixes)).toBe('ping Ravi');
  });

  it('learns from a title you changed when the old words came from the mic', () => {
    const l = lessonOf(spoken({
      retitled: [{ from: 'Lunch with Robbie', to: 'Lunch with Ravi' }, { from: 'Book a table', to: 'Book a table at Toit' }, { from: 'Call the plumber', to: 'Call Mario the plumber' }],
    }));
    expect(l.fixes).toEqual([{ from: 'Robbie', to: 'Ravi', weight: 1 }]);
    // Ravi is listened out for as the fix's word.
    expect(l.words).toEqual(['Toit', 'Mario']);
  });

  it('learns no fixes from a typed chat, only names', () => {
    const l = lessonOf(lesson({ said: ['Lunch with Ravi'], model: { words: ['Ravi'], fixes: [{ heard: 'Robbie', meant: 'Ravi' }], habits: [] } }));
    expect(l).toEqual({ words: ['Ravi'], fixes: [], habits: [] });
  });

  it('counts each chat once, and a fix it learned twice becomes sure', () => {
    const c = spoken({ model: { words: ['Koramangala'], fixes: [{ heard: 'plum bar', meant: 'plumber' }], habits: ['Says “kal” for tomorrow'] } });
    const once = learnFrom(EMPTY_VOICE, c, NOW);
    expect(once.chats).toBe(1);
    expect(applyFixes('the plum bar', once.fixes)).toBe('the plum bar');
    const twice = learnFrom(once, { ...c, model: { ...c.model, habits: ['Says "kal" to mean tomorrow'] } }, NOW + 1);
    expect(twice.fixes).toEqual([{ heard: 'plum bar', meant: 'plumber', source: 'learned', uses: 2, at: NOW + 1 }]);
    expect(twice.words).toEqual([{ text: 'Koramangala', source: 'learned', uses: 2, at: NOW + 1 }]);
    // The same habit, put another way.
    expect(twice.habits).toHaveLength(1);
    expect(applyFixes('the plum bar', twice.fixes)).toBe('the plumber');
  });

  it('drops a fix learned the wrong way round, and never overrides one of yours', () => {
    const p = { ...EMPTY_VOICE, fixes: [fix('Ravi', 'Robbie', 'learned', 3), fix('Kal', 'Cal', 'you')] };
    const next = learnFrom(p, lesson({ mic: ['lunch with Robbie and Kal'], said: [], corrections: [{ from: 'lunch with Robbie and Kal', to: 'lunch with Ravi and Kalyan' }] }), NOW);
    expect(next.fixes.map(f => [f.heard, f.meant, f.source])).toEqual([['Kal', 'Cal', 'you'], ['Robbie', 'Ravi', 'learned']]);
  });

  it('makes room by forgetting the learned ones that came up least', () => {
    const words = Array.from({ length: LIMITS.words }, (_, i) => ({ text: `Name${i}`, source: i ? 'learned' as const : 'you' as const, uses: i < 2 ? 1 : 5, at: NOW }));
    const next = learnFrom({ ...EMPTY_VOICE, words }, lesson({ said: ['Meet Zubin'], model: { words: ['Zubin'], fixes: [], habits: [] } }), NOW);
    expect(next.words).toHaveLength(LIMITS.words);
    expect(next.words.map(w => w.text)).not.toContain('Name1');
    expect(next.words.map(w => w.text)).toContain('Name0');
    expect(next.words.at(-1)?.text).toBe('Zubin');
  });

  it('learns nothing when learning is off', () => {
    const off = { ...EMPTY_VOICE, learn: false };
    expect(learnFrom(off, spoken({ model: { words: ['Koramangala'], fixes: [], habits: [] } }), NOW)).toBe(off);
  });
});

describe('readLearned', () => {
  it('takes only the shape it asked for, capped', () => {
    expect(readLearned({ words: ['Ravi', 3, ''], fixes: [{ heard: 'Robbie', meant: 'Ravi' }, { heard: 'x' }], habits: 'no' }))
      .toEqual({ words: ['Ravi'], fixes: [{ heard: 'Robbie', meant: 'Ravi' }], habits: [] });
    expect(readLearned(null)).toEqual({ words: [], fixes: [], habits: [] });
    expect(readLearned({ words: Array.from({ length: 20 }, (_, i) => `W${i}`) }).words).toHaveLength(8);
  });
});

describe('your edits', () => {
  it('adds, keeps and removes words; one it learned becomes yours', () => {
    let p: VoiceProfile = { ...EMPTY_VOICE, words: [{ text: 'koramangala', source: 'learned', uses: 3, at: 1 }] };
    p = addWords('Raveena, Koramangala; Q3 OKRs\n', NOW)(p);
    expect(p.words.map(w => [w.text, w.source])).toEqual([['Koramangala', 'you'], ['Raveena', 'you'], ['Q3 OKRs', 'you']]);
    p = removeWord('raveena', NOW)(p);
    expect(p.words.map(w => w.text)).toEqual(['Koramangala', 'Q3 OKRs']);
  });

  it('adds a fix in place of one for the same words, and removes it', () => {
    let p: VoiceProfile = { ...EMPTY_VOICE, fixes: [fix('plum bar', 'plum bar man')] };
    p = addFix('Plum bar', 'plumber', NOW)(p);
    expect(p.fixes).toEqual([fix('Plum bar', 'plumber', 'you')]);
    expect(addFix('same', 'Same', NOW)(p)).toBe(p);
    expect(removeFix('plum bar', NOW)(p).fixes).toEqual([]);
  });

  it('edits and removes habits, and forgets what it learned but keeps yours', () => {
    let p: VoiceProfile = { ...EMPTY_VOICE, chats: 4, words: [{ text: 'Ravi', source: 'learned', uses: 1, at: 1 }], habits: [{ text: 'Says kal', source: 'learned', uses: 1, at: 1 }] };
    p = setHabit('Says kal', 'Says “kal” for tomorrow', NOW)(p);
    expect(p.habits).toEqual([{ text: 'Says “kal” for tomorrow', source: 'you', uses: 1, at: NOW }]);
    p = addHabit('EOD means 6 PM', NOW)(p);
    expect(learnedCount(p)).toBe(1);
    p = forgetLearned(NOW)(p);
    expect(p.words).toEqual([]);
    expect(p.habits).toHaveLength(2);
    expect(p.chats).toBe(0);
    expect(setHabit('EOD means 6 PM', '', NOW)(p).habits).toHaveLength(1);
  });

  it('takes a language only as a language tag', () => {
    expect(setLang('en-IN', NOW)(EMPTY_VOICE).lang).toBe('en-IN');
    expect(setLang('<script>', NOW)(EMPTY_VOICE).lang).toBeNull();
  });
});

describe('voiceHints', () => {
  it('gives the AI your notes and the most-used of the rest, yours first', () => {
    const p: VoiceProfile = {
      ...EMPTY_VOICE, notes: '  I mix in Hindi  ',
      words: [{ text: 'Arjun', source: 'learned', uses: 1, at: 1 }, { text: 'Toit', source: 'learned', uses: 4, at: 1 }, { text: 'Raveena', source: 'you', uses: 1, at: 1 }],
      fixes: [fix('plum bar', 'plumber')],
    };
    expect(voiceHints(p)).toEqual({ notes: 'I mix in Hindi', habits: [], words: ['Raveena', 'Toit', 'Arjun'], fixes: [{ heard: 'plum bar', meant: 'plumber' }] });
  });
});

describe('hasPhrase', () => {
  it('matches whole words only', () => {
    expect(hasPhrase('Call the plum-bar.', 'plum bar')).toBe(true);
    expect(hasPhrase('plumbar', 'plum bar')).toBe(false);
    expect(hasPhrase('anything', '')).toBe(false);
  });
});
