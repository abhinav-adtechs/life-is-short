import { describe, expect, it } from 'vitest';
import { joinWords, readResults, wordsOf, type SRResult } from './speech';

/** Results the way SpeechRecognition hands them over: each a list of guesses, best first. */
const res = (isFinal: boolean, ...guesses: string[]): SRResult => Object.assign(guesses.map(transcript => ({ transcript })), { isFinal });

describe('readResults', () => {
  it('joins what a desktop browser settles on, with its guess after', () => {
    const out = readResults([res(true, 'Call the plumber tomorrow'), res(true, ' at 9'), res(false, ' and buy')]);
    expect(out).toEqual({ fin: 'Call the plumber tomorrow at 9', int: 'and buy', doubts: [] });
  });

  it('folds Android’s repeats together, so nothing shows twice', () => {
    // Chrome on Android: each final result holds the ones before it, and the guess starts with them too.
    const out = readResults([res(true, 'call'), res(true, 'call the plumber'), res(true, 'call the plumber tomorrow at 9'), res(false, 'call the plumber tomorrow at 9 and buy milk')]);
    expect(out.fin).toBe('call the plumber tomorrow at 9');
    expect(out.int).toBe('and buy milk');
  });

  it('drops a shorter repeat, but keeps a short word said twice', () => {
    expect(readResults([res(true, 'book a haircut on Friday'), res(true, 'book a haircut')]).fin).toBe('book a haircut on Friday');
    expect(readResults([res(true, 'no'), res(true, 'no')]).fin).toBe('no no');
  });

  it('keeps the recogniser’s other guesses where it wasn’t sure', () => {
    const out = readResults([
      res(true, 'call the plum bar', 'call the plumber', 'Call the plum bar.', 'call the plum bah'),
      res(true, 'tomorrow', 'tomorrow'),
    ]);
    // A guess that differs only in case and punctuation isn't another guess; only the first three are asked for.
    expect(out.doubts).toEqual([{ said: 'call the plum bar', or: ['call the plumber'] }]);
  });

  it('skips empty results', () => {
    expect(readResults([res(true, '  '), res(false, '')])).toEqual({ fin: '', int: '', doubts: [] });
  });
});

describe('words', () => {
  it('compares words without case or punctuation, in any script', () => {
    expect(wordsOf('Call the Plumber, tomorrow!')).toEqual(['call', 'the', 'plumber', 'tomorrow']);
    expect(wordsOf("Don't forget Q3")).toEqual(["don't", 'forget', 'q3']);
    expect(wordsOf('कल दूध लेना')).toEqual(['कल', 'दूध', 'लेना']);
  });

  it('joins with exactly one space', () => {
    expect(joinWords(' call ', '', 'the plumber ')).toBe('call the plumber');
  });
});
