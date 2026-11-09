import { wordsOf } from './speech';

/**
 * Your voice profile: how the mic and the AI should hear you. Kept in your synced settings under `voice`, so every
 * device hears you the same way.
 *
 * - `lang` is the language the mic listens for.
 * - `notes` is how you talk, in your own words, read by the AI every time.
 * - `words` are names, places and terms: the mic listens out for them and the AI spells them your way.
 * - `fixes` are things the mic mishears ("plum bar" for "plumber"). Sure ones are fixed as you speak; the rest are
 *   hints for the AI.
 * - `habits` are notes on how you phrase things ("Says 'kal' for tomorrow").
 *
 * Each chat you apply teaches it (`learnFrom`), and you can change or remove anything it learned in Settings → Voice.
 */

export const VOICE_KEY = 'voice';

/** You added it, or it was learned from a chat you applied. */
export type Source = 'you' | 'learned';

interface Item {
  source: Source;
  /** Chats it has come up in; a correction you made yourself counts twice. */
  uses: number;
  /** When it last came up. */
  at: number;
}
export interface VoiceWord extends Item { text: string }
export interface VoiceFix extends Item { heard: string; meant: string }
export interface VoiceHabit extends Item { text: string }

export interface VoiceProfile {
  /** The language the mic listens for, as a BCP 47 tag; null is the device's. */
  lang: string | null;
  notes: string;
  words: VoiceWord[];
  fixes: VoiceFix[];
  habits: VoiceHabit[];
  /** Learn from each chat you apply. */
  learn: boolean;
  /** Chats it has learned from. */
  chats: number;
  updatedAt: number;
}

export const EMPTY_VOICE: VoiceProfile = { lang: null, notes: '', words: [], fixes: [], habits: [], learn: true, chats: 0, updatedAt: 0 };

export const LIMITS = { words: 200, fixes: 100, habits: 30, notes: 1000, word: 40, habit: 160, phrases: 100 } as const;

/** The languages offered for the mic. Another tag stored by another device still works. */
export const LANGS: readonly { id: string; name: string }[] = [
  { id: 'en-IN', name: 'English (India)' },
  { id: 'en-US', name: 'English (US)' },
  { id: 'en-GB', name: 'English (UK)' },
  { id: 'en-AU', name: 'English (Australia)' },
  { id: 'en-CA', name: 'English (Canada)' },
  { id: 'en-IE', name: 'English (Ireland)' },
  { id: 'en-NZ', name: 'English (New Zealand)' },
  { id: 'en-SG', name: 'English (Singapore)' },
  { id: 'en-ZA', name: 'English (South Africa)' },
  { id: 'hi-IN', name: 'Hindi' },
  { id: 'bn-IN', name: 'Bengali (India)' },
  { id: 'ta-IN', name: 'Tamil' },
  { id: 'te-IN', name: 'Telugu' },
  { id: 'mr-IN', name: 'Marathi' },
  { id: 'kn-IN', name: 'Kannada' },
  { id: 'de-DE', name: 'German' },
  { id: 'es-ES', name: 'Spanish (Spain)' },
  { id: 'es-MX', name: 'Spanish (Mexico)' },
  { id: 'fr-FR', name: 'French' },
  { id: 'it-IT', name: 'Italian' },
  { id: 'nl-NL', name: 'Dutch' },
  { id: 'pt-BR', name: 'Portuguese (Brazil)' },
  { id: 'ja-JP', name: 'Japanese' },
];
const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
export const isLang = (v: unknown): v is string => typeof v === 'string' && LANG.test(v);

/* ---------- text ---------- */

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
/** Without punctuation at either end. */
const edge = (s: string) => s.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
/** What two spellings of the same words share: "Plum-bar," and "plum bar". */
export const keyOf = (s: string) => wordsOf(s).join(' ');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = (phrase: string) => phrase.trim().split(/[\s-]+/).filter(Boolean).map(esc).join('[\\s,.-]+');
const B = '[\\p{L}\\p{M}\\p{N}]';

/** Whether the phrase is in the text as whole words, whatever the case and punctuation. */
export function hasPhrase(text: string, phrase: string): boolean {
  if (!keyOf(phrase)) return false;
  return new RegExp(`(?<!${B})${pattern(phrase)}(?!${B})`, 'iu').test(text);
}

/** Everyday words: never worth learning on their own, and never a mishearing worth fixing without context. */
const COMMON = new Set((
  'a an the and or but if so of to in on at by for from with about as into onto over under up down out off ' +
  'i me my mine we us our you your he him his she her it its they them their this that these those there here ' +
  'is am are was were be been being do does did done have has had will would shall should can could may might must ' +
  'not no yes ok okay yeah yep um uh er hmm like just also too very really then than now later soon again please ' +
  'what when where which who whom why how all any some each every more most much many few ' +
  'one two three four five six seven eight nine ten first second third half quarter ' +
  'today tomorrow tonight yesterday morning afternoon evening night noon midnight week weekend month year day days ' +
  'monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun ' +
  'january february march april june july august september october november december ' +
  'jan feb mar apr jun jul aug sep sept oct nov dec pm hour hours minute minutes min mins next last ' +
  'call email text send buy get make go see meet book pay fix check finish start stop add move put take need want ' +
  'urgent important later someday thing things stuff task tasks'
).split(' '));
const allCommon = (s: string) => wordsOf(s).every(w => COMMON.has(w) || /^\d+(?:st|nd|rd|th)?$/.test(w));

/**
 * Names and terms in some text: capitalised words after the first (Ravi, Koramangala), acronyms (OKR), and mixes of
 * letters and digits (Q3) or of case (iPhone). Neighbours join up to three words ("New York"), unless punctuation
 * parts them ("Toit, Indiranagar").
 */
export function termsFrom(texts: string[]): string[] {
  const out = new Map<string, string>();
  for (const text of texts) {
    const raw = text.split(/\s+/).filter(Boolean);
    const toks = raw.map(t => edge(t).replace(/['’]s$/u, ''));
    let run: string[] = [];
    const flush = () => {
      for (let i = 0; i < run.length; i += 3) {
        const t = run.slice(i, i + 3).join(' ');
        if (!out.has(keyOf(t))) out.set(keyOf(t), t);
      }
      run = [];
    };
    toks.forEach((t, i) => {
      const term = t.length > 1 && !COMMON.has(t.toLowerCase()) && (
        (i > 0 && /^\p{Lu}/u.test(t))
        || /^\p{Lu}{2,}$/u.test(t)
        || (/\d/.test(t) && /\p{L}/u.test(t))
        || /^\p{Ll}+\p{Lu}/u.test(t));
      if (/^[(\["“‘]/u.test(raw[i])) flush();
      if (term) run.push(t); else flush();
      if (/[,.;:!?)\]"”’]$/u.test(raw[i])) flush();
    });
    flush();
  }
  return [...out.values()];
}

/* ---------- reading what's stored ---------- */

const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
const list = (v: unknown) => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const meta = (o: Record<string, unknown>): Item => ({
  source: o.source === 'you' ? 'you' : 'learned',
  uses: Math.min(999, Math.max(1, Math.round(Number(o.uses)) || 1)),
  at: Math.max(0, Number(o.at) || 0),
});
function unique<T>(items: T[], k: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(t => { const x = k(t); if (!x || seen.has(x)) return false; seen.add(x); return true; });
}

/** A stored profile, checked: anything malformed is dropped, everything capped. */
export function normalizeVoice(raw: unknown): VoiceProfile {
  const o = obj(raw);
  const words = unique(list(o.words).map(obj).map(w => ({ text: clip(str(w.text), LIMITS.word), ...meta(w) })), w => keyOf(w.text));
  const fixes = unique(list(o.fixes).map(obj).map(f => ({ heard: clip(str(f.heard), LIMITS.word), meant: clip(str(f.meant), LIMITS.word), ...meta(f) }))
    .filter(f => f.meant && keyOf(f.heard) !== keyOf(f.meant)), f => keyOf(f.heard));
  const habits = unique(list(o.habits).map(obj).map(h => ({ text: clip(str(h.text), LIMITS.habit), ...meta(h) })), h => keyOf(h.text));
  return {
    lang: isLang(o.lang) ? o.lang : null,
    notes: str(o.notes).slice(0, LIMITS.notes),
    words: words.slice(0, LIMITS.words),
    fixes: fixes.slice(0, LIMITS.fixes),
    habits: habits.slice(0, LIMITS.habits),
    learn: o.learn !== false,
    chats: Math.max(0, Math.round(Number(o.chats)) || 0),
    updatedAt: Math.max(0, Number(o.updatedAt) || 0),
  };
}

/** Yours first, then the ones that come up most, then the most recent. */
const rank = (a: Item, b: Item) => (a.source === 'you' ? 0 : 1) - (b.source === 'you' ? 0 : 1) || b.uses - a.uses || b.at - a.at;

/** Sure enough to fix as you speak: you added it, or it was learned in two chats. */
export const isSure = (f: VoiceFix) => f.source === 'you' || f.uses >= 2;

/* ---------- using it ---------- */

const fixCache = new WeakMap<VoiceFix[], ((text: string) => string)>();
/** Matching the case of what was said: "Plum bar is…" becomes "Plumber is…", but "iPhone" stays as it is. */
const matchCase = (found: string, meant: string) => (/^\p{Lu}/u.test(found) && !/\p{Lu}/u.test(meant) ? meant.charAt(0).toUpperCase() + meant.slice(1) : meant);

/** The mic's words with the sure fixes made, in one pass (so one fix never feeds another). */
export function applyFixes(text: string, fixes: VoiceFix[]): string {
  let fn = fixCache.get(fixes);
  if (!fn) {
    const sure = fixes.filter(isSure).filter(f => keyOf(f.heard)).sort((a, b) => b.heard.length - a.heard.length);
    const byKey = new Map(sure.map(f => [keyOf(f.heard), f]));
    const re = sure.length ? new RegExp(`(?<!${B})(?:${sure.map(f => pattern(f.heard)).join('|')})(?!${B})`, 'giu') : null;
    fn = (t: string) => (re ? t.replace(re, m => { const f = byKey.get(keyOf(m)); return f ? matchCase(m, f.meant) : m; }) : t);
    fixCache.set(fixes, fn);
  }
  return fn(text);
}

/**
 * The phrases the mic listens out for (Chrome's `phrases`, the apps' `contextualStrings`): your words and the words
 * it mishears, best first, then your labels and the names in your tasks.
 */
export function speechPhrases(p: VoiceProfile, extra: { labels?: string[]; titles?: string[] } = {}): string[] {
  const out = new Map<string, string>();
  const add = (s: string) => {
    const t = clip(s, 50);
    const k = keyOf(t);
    if (k && !out.has(k) && !allCommon(t)) out.set(k, t);
  };
  [...p.words.map(w => ({ ...w, text: w.text })), ...p.fixes.map(f => ({ ...f, text: f.meant }))].sort(rank).forEach(x => add(x.text));
  (extra.labels ?? []).forEach(add);
  termsFrom((extra.titles ?? []).slice(0, 200)).forEach(add);
  return [...out.values()].slice(0, LIMITS.phrases);
}

/** What the AI reads about how you talk: your notes, then the most-used of everything else. */
export interface VoiceHints { notes: string; habits: string[]; words: string[]; fixes: { heard: string; meant: string }[] }

export function voiceHints(p: VoiceProfile): VoiceHints {
  const by = <T extends Item>(l: T[]) => [...l].sort(rank);
  return {
    notes: p.notes.trim(),
    habits: by(p.habits).slice(0, 15).map(h => h.text),
    words: by(p.words).slice(0, 80).map(w => w.text),
    fixes: by(p.fixes).slice(0, 50).map(f => ({ heard: f.heard, meant: f.meant })),
  };
}

/* ---------- learning ---------- */

/** What the AI suggests remembering from a chat, as `learn` in its answer. */
export interface Learned { words: string[]; fixes: { heard: string; meant: string }[]; habits: string[] }
export const NOTHING_LEARNED: Learned = { words: [], fixes: [], habits: [] };

/** The AI's `learn`, checked and capped. */
export function readLearned(raw: unknown): Learned {
  const o = obj(raw);
  const strs = (v: unknown, n: number, max: number) => list(v).map(str).map(s => clip(s, max)).filter(Boolean).slice(0, n);
  return {
    words: strs(o.words, 8, LIMITS.word),
    fixes: list(o.fixes).map(obj).map(f => ({ heard: clip(str(f.heard), LIMITS.word), meant: clip(str(f.meant), LIMITS.word) }))
      .filter(f => f.heard && f.meant).slice(0, 6),
    habits: strs(o.habits, 2, LIMITS.habit),
  };
}

export const mergeLearned = (all: Learned[]): Learned => ({
  words: all.flatMap(l => l.words), fixes: all.flatMap(l => l.fixes), habits: all.flatMap(l => l.habits),
});

/** A stretch of words changed for another: "plum bar" → "plumber". */
export interface Span { from: string; to: string }

/** How alike two spellings are, 0 to 1, by their letters alone: "kora man gala" and "Koramangala" are 1. */
function closeness(a: string, b: string) {
  const x = wordsOf(a).join(''), y = wordsOf(b).join('');
  if (!x || !y) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

/**
 * The words changed between two versions of a text, each a run of up to `maxWords` words replaced by another. Words
 * only added or only removed aren't changes of what was heard, so they're left out.
 */
export function replacedSpans(a: string, b: string, maxWords = 4): Span[] {
  const A = a.trim().split(/\s+/).filter(Boolean), Bt = b.trim().split(/\s+/).filter(Boolean);
  if (!A.length || !Bt.length || A.length > 400 || Bt.length > 400) return [];
  const ka = A.map(keyOf), kb = Bt.map(keyOf);
  const n = A.length, m = Bt.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Span[] = [];
  let da: string[] = [], db: string[] = [];
  const flush = () => {
    const from = edge(da.join(' ')), to = edge(db.join(' '));
    da = []; db = [];
    if (!from || !to || keyOf(from) === keyOf(to)) return;
    const wa = wordsOf(from).length, wb = wordsOf(to).length;
    if (wa > maxWords || wb > maxWords || from.length > LIMITS.word || to.length > LIMITS.word) return;
    // Words swapped and more added ("Robbie" → "Ravi at Toit") can't say which replaced which, unless it's the same
    // letters run together or apart.
    if (Math.abs(wa - wb) > 1 && closeness(from, to) < 0.6) return;
    out.push({ from, to });
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) { flush(); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) db.push(Bt[j++]);
    else da.push(A[i++]);
  }
  flush();
  return out;
}

/** One chat you applied, for learning from. */
export interface ChatLesson {
  /** What the mic typed each time you spoke, before any fix. Empty for a typed chat. */
  mic: string[];
  /** What you said, as sent and as the AI read it back. */
  said: string[];
  /** What the AI suggested remembering. */
  model: Learned;
  /** Your own corrections of what you said, from what you saw to what you sent. */
  corrections: Span[];
  /** Titles you changed in the plan. */
  retitled: Span[];
}

/** What a chat would teach, checked: only words that were really said, never everyday ones, one of each. */
export interface Lesson { words: string[]; fixes: (Span & { weight: number })[]; habits: string[] }

export function lessonOf(c: ChatLesson): Lesson {
  const mic = c.mic.join('\n');
  const spoken = c.mic.some(s => s.trim());
  const context = [...c.said, ...c.mic, ...c.retitled.map(r => r.to)].join('\n');
  const fixes = new Map<string, Span & { weight: number }>();
  const words = new Map<string, string>();
  const fix = (heard: string, meant: string, weight: number) => {
    if (!keyOf(heard) || !keyOf(meant) || keyOf(heard) === keyOf(meant) || allCommon(heard)) return;
    if (wordsOf(heard).length > 4 || wordsOf(meant).length > 4) return;
    const k = keyOf(heard);
    const had = fixes.get(k);
    if (!had || weight > had.weight) fixes.set(k, { from: heard, to: meant, weight });
  };
  const word = (w: string) => {
    const t = clip(w, LIMITS.word);
    if (!keyOf(t) || allCommon(t) || wordsOf(t).length > 4 || words.has(keyOf(t))) return;
    words.set(keyOf(t), t);
  };
  if (spoken) {
    // Your own corrections are the surest sign, where the words you replaced are ones the mic typed. Ones the AI
    // had put there are a hint.
    for (const { from, to } of c.corrections) for (const s of replacedSpans(from, to)) fix(s.from, s.to, hasPhrase(mic, s.from) ? 2 : 1);
    // A title you changed, where the words you replaced are ones the mic typed.
    for (const { from, to } of c.retitled) for (const s of replacedSpans(from, to)) if (hasPhrase(mic, s.from)) fix(s.from, s.to, 1);
    // The AI's, only where what it says was heard really was, and what it says was meant wasn't.
    for (const f of c.model.fixes) if (hasPhrase(mic, f.heard) && !hasPhrase(mic, f.meant)) fix(f.heard, f.meant, 1);
  }
  for (const { from, to } of c.retitled) {
    const before = new Set(termsFrom([from]).map(keyOf));
    termsFrom([to]).filter(t => !before.has(keyOf(t))).forEach(word);
  }
  for (const w of c.model.words) if (hasPhrase(context, w) && !/^\d+$/.test(w.trim())) word(w);
  // A misheard word isn't one of yours, and one it was misheard for is already listened out for as a fix.
  const inFixes = new Set([...fixes.values()].flatMap(f => [keyOf(f.from), keyOf(f.to)]));
  return {
    words: [...words.values()].filter(w => !inFixes.has(keyOf(w))),
    fixes: [...fixes.values()],
    habits: c.model.habits.filter(h => h.length >= 8).slice(0, 2),
  };
}

export const isEmptyLesson = (l: Lesson) => !l.words.length && !l.fixes.length && !l.habits.length;

/** Over the cap, the learned ones that came up least, longest ago, go first. Yours stay. */
function evict<T extends Item>(items: T[], cap: number): T[] {
  const out = [...items];
  while (out.length > cap) {
    let worst = -1;
    out.forEach((x, i) => {
      if (x.source !== 'learned') return;
      if (worst < 0 || x.uses < out[worst].uses || (x.uses === out[worst].uses && x.at < out[worst].at)) worst = i;
    });
    if (worst < 0) break;
    out.splice(worst, 1);
  }
  return out;
}

/** The same habit, put another way: most of the words that matter are shared. */
const similar = (a: string, b: string) => {
  const telling = (s: string) => { const all = wordsOf(s), some = all.filter(w => !COMMON.has(w)); return new Set(some.length ? some : all); };
  const x = telling(a), y = telling(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  x.forEach(w => { if (y.has(w)) both++; });
  return both / (x.size + y.size - both) >= 0.6;
};

/** Learn from a chat you applied. Nothing, when learning is off. */
export function learnFrom(p: VoiceProfile, c: ChatLesson, now = Date.now()): VoiceProfile {
  if (!p.learn) return p;
  const l = lessonOf(c);

  let fixes = [...p.fixes];
  for (const f of l.fixes) {
    const h = keyOf(f.from), m = keyOf(f.to);
    // Learned the other way round before: that one was wrong.
    fixes = fixes.filter(x => !(x.source === 'learned' && keyOf(x.heard) === m && keyOf(x.meant) === h));
    const i = fixes.findIndex(x => keyOf(x.heard) === h);
    if (i < 0) fixes.push({ heard: f.from, meant: f.to, source: 'learned', uses: f.weight, at: now });
    else if (keyOf(fixes[i].meant) === m) fixes[i] = { ...fixes[i], uses: Math.min(999, fixes[i].uses + f.weight), at: now };
    // It meant something else this time: the newer one, unless the older is yours.
    else if (fixes[i].source === 'learned') fixes[i] = { heard: f.from, meant: f.to, source: 'learned', uses: f.weight, at: now };
  }

  const words = [...p.words];
  for (const w of l.words) {
    const i = words.findIndex(x => keyOf(x.text) === keyOf(w));
    if (i < 0) words.push({ text: w, source: 'learned', uses: 1, at: now });
    else words[i] = { ...words[i], uses: Math.min(999, words[i].uses + 1), at: now };
  }

  const habits = [...p.habits];
  for (const h of l.habits) {
    const i = habits.findIndex(x => similar(x.text, h));
    if (i < 0) habits.push({ text: h, source: 'learned', uses: 1, at: now });
    else habits[i] = { ...habits[i], uses: Math.min(999, habits[i].uses + 1), at: now };
  }

  return {
    ...p,
    fixes: evict(fixes, LIMITS.fixes), words: evict(words, LIMITS.words), habits: evict(habits, LIMITS.habits),
    chats: p.chats + 1, updatedAt: now,
  };
}

/* ---------- your edits, from Settings → Voice ---------- */

type Edit = (p: VoiceProfile) => VoiceProfile;
const stamp = (p: VoiceProfile, now: number): VoiceProfile => ({ ...p, updatedAt: now });

/** Add words, separated by commas or new lines. One it learned becomes yours. */
export const addWords = (text: string, now = Date.now()): Edit => p => {
  const words = [...p.words];
  for (const raw of text.split(/[,;\n]+/)) {
    const t = clip(raw, LIMITS.word);
    if (!keyOf(t)) continue;
    const i = words.findIndex(w => keyOf(w.text) === keyOf(t));
    if (i >= 0) words[i] = { ...words[i], text: t, source: 'you', at: now };
    else if (words.length < LIMITS.words) words.push({ text: t, source: 'you', uses: 1, at: now });
  }
  return stamp({ ...p, words }, now);
};

export const removeWord = (text: string, now = Date.now()): Edit => p => stamp({ ...p, words: p.words.filter(w => keyOf(w.text) !== keyOf(text)) }, now);

/** "It hears X, you said Y". Replaces any fix for the same words. */
export const addFix = (heard: string, meant: string, now = Date.now()): Edit => p => {
  const h = clip(heard, LIMITS.word), m = clip(meant, LIMITS.word);
  if (!keyOf(h) || !keyOf(m) || keyOf(h) === keyOf(m)) return p;
  const rest = p.fixes.filter(f => keyOf(f.heard) !== keyOf(h));
  if (rest.length >= LIMITS.fixes) return p;
  return stamp({ ...p, fixes: [...rest, { heard: h, meant: m, source: 'you', uses: 1, at: now }] }, now);
};

export const removeFix = (heard: string, now = Date.now()): Edit => p => stamp({ ...p, fixes: p.fixes.filter(f => keyOf(f.heard) !== keyOf(heard)) }, now);

/** Change a habit's words (it becomes yours), or remove it with empty text. */
export const setHabit = (old: string, text: string, now = Date.now()): Edit => p => {
  const t = clip(text, LIMITS.habit);
  const habits = t
    ? p.habits.map(h => (keyOf(h.text) === keyOf(old) ? { ...h, text: t, source: 'you' as const, at: now } : h))
    : p.habits.filter(h => keyOf(h.text) !== keyOf(old));
  return stamp({ ...p, habits }, now);
};

export const addHabit = (text: string, now = Date.now()): Edit => p => {
  const t = clip(text, LIMITS.habit);
  if (!keyOf(t) || p.habits.length >= LIMITS.habits || p.habits.some(h => keyOf(h.text) === keyOf(t))) return p;
  return stamp({ ...p, habits: [...p.habits, { text: t, source: 'you', uses: 1, at: now }] }, now);
};

export const setNotes = (notes: string, now = Date.now()): Edit => p => stamp({ ...p, notes: notes.slice(0, LIMITS.notes) }, now);
export const setLang = (lang: string | null, now = Date.now()): Edit => p => stamp({ ...p, lang: isLang(lang) ? lang : null }, now);
export const setLearning = (learn: boolean, now = Date.now()): Edit => p => stamp({ ...p, learn }, now);

/** Forget everything it learned; what you added stays. */
export const forgetLearned = (now = Date.now()): Edit => p => stamp({
  ...p, chats: 0,
  words: p.words.filter(w => w.source === 'you'), fixes: p.fixes.filter(f => f.source === 'you'), habits: p.habits.filter(h => h.source === 'you'),
}, now);

export const learnedCount = (p: VoiceProfile) => [...p.words, ...p.fixes, ...p.habits].filter(x => x.source === 'learned').length;
