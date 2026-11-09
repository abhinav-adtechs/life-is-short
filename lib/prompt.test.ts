import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt';

const NOW = new Date(2026, 10, 9, 10, 0).getTime();

describe('buildPrompt and how they talk', () => {
  it('asks a typed dump for no transcript, and nothing to remember unless learning', () => {
    const p = buildPrompt('call mum', NOW);
    expect(p).toContain('"heard": "" (they typed it).');
    expect(p).not.toContain('"learn"');
    expect(p).not.toContain('speech recognition typed it');
  });

  it('reads a dictation for what they meant, with the recogniser’s other guesses', () => {
    const p = buildPrompt('call the plum bar tomorrow', NOW, [], undefined, [], undefined, {
      spoken: true, learn: true, doubts: [{ said: 'call the plum bar tomorrow', or: ['call the plumber tomorrow'] }],
    });
    expect(p).toContain('They said this out loud and speech recognition typed it');
    expect(p).toContain('- "call the plum bar tomorrow", or "call the plumber tomorrow"');
    expect(p).toContain('"heard": first, what they said as they meant it');
    expect(p).toContain('"fixes": [{"heard": the words speech recognition typed');
    expect(p).toContain('"learn": {...}}');
  });

  it('gives what’s known about how they talk before their tasks', () => {
    const p = buildPrompt('lunch with robbie', NOW, [], undefined, [], undefined, {
      spoken: false, learn: true, notes: 'I mix in Hindi: kal is tomorrow', habits: ['"EOD" means 6 PM'],
      words: ['Ravi', 'Koramangala'], fixes: [{ heard: 'Robbie', meant: 'Ravi' }],
    });
    const hints = p.indexOf('How they talk, to read them right');
    expect(hints).toBeGreaterThan(0);
    expect(hints).toBeLessThan(p.indexOf('Their open tasks right now'));
    expect(p).toContain('I mix in Hindi: kal is tomorrow');
    expect(p).toContain('- "EOD" means 6 PM');
    expect(p).toContain('- Names and words they use, spelled their way: Ravi; Koramangala.');
    expect(p).toContain('- Speech recognition has misheard them before: "Robbie" for "Ravi".');
    // Typed, so there are no fixes to suggest.
    expect(p).toContain('"fixes": [];');
  });
});

describe('buildPrompt and when things happen', () => {
  it('keeps a task with no day or time in the backlog, however urgent', () => {
    const p = buildPrompt('add a task, but not to the calendar', NOW);
    expect(p).not.toContain('clearly implied');
    expect(p).toContain('"date": "YYYY-MM-DD" only if they say a day');
    expect(p).toContain('How urgent, important or quick it is never sets a day');
    expect(p).toContain('With neither, "date" and "time" are null and it waits in their backlog');
    // The worked example shows one that waits in the backlog, next to one with a day and time.
    expect(p).toContain('{"title":"Book a haircut","priority":2,"minutes":15,"date":null,"time":null,"deadline":false,"notes":""}');
    expect(p).toContain('"date":"2026-11-10","time":"11:00"');
  });
});
