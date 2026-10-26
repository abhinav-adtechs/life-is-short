import { describe, expect, it } from 'vitest';
import { parseReply } from './reply';

describe('parseReply', () => {
  it('reads {add, update}', () => {
    expect(parseReply('{"add":[{"title":"A"}],"update":[{"ref":"T1","done":true}]}')).toEqual({ add: [{ title: 'A' }], update: [{ ref: 'T1', done: true }] });
  });
  it('tolerates a code fence and a bare array', () => {
    expect(parseReply('```json\n[{"title":"A"}]\n```')).toEqual({ add: [{ title: 'A' }], update: [] });
  });
  it('returns null for junk', () => {
    expect(parseReply('sorry, no')).toBeNull();
    expect(parseReply(undefined)).toBeNull();
    expect(parseReply('"text"')).toBeNull();
  });
});
