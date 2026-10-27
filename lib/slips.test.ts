import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import { DAY_MS } from './time';
import { KEEP_SLIPS, isMissed, mergeSlips, normalizeSlips, slipsFrom, type Slip } from './slips';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
// Tuesday 27 Oct 2026, 15:00 local.
const NOW = at(27, 15);

const task = (extra: Partial<Task> = {}): Task => ({
  id: 'a', title: 'Call the bank', raw: '', notes: '', priority: 1, minutes: 30, start: at(27, 10), due: null,
  status: 'open', created: at(20, 9), order: 0, doneAt: null, label: 'work', ...extra,
});

describe('isMissed', () => {
  it('is an open task whose slot is over', () => {
    expect(isMissed(task(), NOW)).toBe(true);
    expect(isMissed(task({ start: at(27, 14, 45) }), NOW)).toBe(false);
    expect(isMissed(task({ status: 'done' }), NOW)).toBe(false);
    expect(isMissed(task({ start: null }), NOW)).toBe(false);
    expect(isMissed(task({ externalId: 'gcal:c:e' }), NOW)).toBe(false);
    expect(isMissed(task({ externalId: 'gtask:t1' }), NOW)).toBe(true);
  });
});

describe('slipsFrom', () => {
  it('notes a missed task moved to another time', () => {
    const b = task();
    expect(slipsFrom([{ before: b, after: { ...b, start: at(28, 9) } }], NOW)).toEqual([{
      id: 'a', start: at(27, 10), minutes: 30, title: 'Call the bank', label: 'work', priority: 1, at: NOW, how: 'moved',
    }]);
  });

  it('notes a missed task sent back to the backlog, or deleted', () => {
    const b = task();
    expect(slipsFrom([{ before: b, after: { ...b, start: null } }], NOW)[0].how).toBe('moved');
    expect(slipsFrom([{ before: b, after: null }], NOW)[0].how).toBe('dropped');
  });

  it('leaves alone a tick, an edit that keeps the slot, a new task and a move before the slot is over', () => {
    const b = task();
    expect(slipsFrom([
      { before: b, after: { ...b, status: 'done', doneAt: NOW } },
      { before: b, after: { ...b, title: 'Call the bank today' } },
      { before: null, after: b },
      { before: task({ start: at(27, 14, 45) }), after: task({ start: at(28, 9) }) },
      { before: task({ externalId: 'gcal:c:e' }), after: task({ externalId: 'gcal:c:e', start: at(28, 9) }) },
    ], NOW)).toEqual([]);
  });
});

const slip = (extra: Partial<Slip> = {}): Slip => ({
  id: 'a', start: at(27, 10), minutes: 30, title: 't', label: null, priority: 2, at: NOW, how: 'moved', ...extra,
});

describe('normalizeSlips', () => {
  it('keeps one slip per slot, the first one noted', () => {
    const out = normalizeSlips([slip({ at: NOW + 5 }), slip(), slip({ start: at(26, 10) })]);
    expect(out.map(s => [s.start, s.at])).toEqual([[at(27, 10), NOW], [at(26, 10), NOW]]);
  });

  it('drops what isn’t a slip and fills in what’s missing', () => {
    expect(normalizeSlips(null)).toEqual([]);
    expect(normalizeSlips([{ id: 'a' }, { start: 5 }, 'x', null])).toEqual([]);
    expect(normalizeSlips([{ id: 'b', start: at(27, 10), priority: 7, how: 'gone' }])[0])
      .toEqual({ id: 'b', start: at(27, 10), minutes: 30, title: '', label: null, priority: 2, at: at(27, 10), how: 'moved' });
  });
});

describe('mergeSlips', () => {
  it('joins two lists and forgets slots older than 400 days', () => {
    const old = slip({ id: 'old', start: NOW - 401 * DAY_MS });
    expect(mergeSlips([slip(), old], [slip({ id: 'b' })], NOW).map(s => s.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the newest slots when there are too many', () => {
    const many = Array.from({ length: KEEP_SLIPS + 5 }, (_, i) => slip({ id: 'x' + i, start: NOW - i * 60000 }));
    const out = mergeSlips(many, [], NOW);
    expect(out).toHaveLength(KEEP_SLIPS);
    expect(out[0].id).toBe('x0');
  });
});
