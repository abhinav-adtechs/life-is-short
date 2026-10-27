import { describe, expect, it } from 'vitest';
import { cleanItem, findSlot, placeItem } from './place';
import type { Task } from './model';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
// Monday 26 Oct 2026, 13:30 local.
const NOW = at(26, 13, 30);

let n = 0;
const task = (start: number | null, minutes: number, extra: Partial<Task> = {}): Task => ({
  id: 'x' + n++, title: 't', raw: '', notes: '', priority: 2, minutes, start, due: null,
  status: 'open', created: 0, order: 0, doneAt: null, ...extra,
});

describe('findSlot', () => {
  it('starts now when the calendar is empty', () => {
    expect(findSlot([], 30, { now: NOW })).toBe(at(26, 13, 30));
  });

  it('rounds up to the 15-minute grid', () => {
    expect(findSlot([], 30, { now: at(26, 13, 37) })).toBe(at(26, 13, 45));
  });

  it('waits until working hours', () => {
    expect(findSlot([], 30, { now: at(26, 7, 0) })).toBe(at(26, 9, 0));
  });

  it('skips busy blocks and uses the first gap that fits', () => {
    const tasks = [task(at(26, 13, 45), 75), task(at(26, 15, 30), 30)];
    expect(findSlot(tasks, 30, { now: NOW })).toBe(at(26, 15, 0));
    expect(findSlot(tasks, 60, { now: NOW })).toBe(at(26, 16, 0));
  });

  it('fits a gap before a busy block', () => {
    expect(findSlot([task(at(26, 14, 0), 60)], 30, { now: NOW })).toBe(at(26, 13, 30));
    expect(findSlot([task(at(26, 14, 0), 60)], 45, { now: NOW })).toBe(at(26, 15, 0));
  });

  it('rolls to the next day when today is full', () => {
    expect(findSlot([], 30, { now: at(26, 20, 50) })).toBe(at(27, 9, 0));
    expect(findSlot([task(at(26, 13, 30), 450)], 30, { now: NOW })).toBe(at(27, 9, 0));
  });

  it('ignores done tasks and the excluded id', () => {
    const busy = task(at(26, 13, 30), 60);
    expect(findSlot([task(at(26, 13, 30), 60, { status: 'done' })], 30, { now: NOW })).toBe(at(26, 13, 30));
    expect(findSlot([busy], 30, { now: NOW, exclude: busy.id })).toBe(at(26, 13, 30));
  });

  it('respects `after`', () => {
    expect(findSlot([], 30, { now: NOW, after: at(26, 16, 10) })).toBe(at(26, 16, 15));
  });

  it('returns null for a full day when limited to it', () => {
    expect(findSlot([task(at(28, 9, 0), 720)], 30, { now: NOW, onDate: at(28, 0), sameDay: true })).toBeNull();
  });

  it('returns null when nothing fits in two weeks', () => {
    expect(findSlot([], 13 * 60, { now: NOW })).toBeNull();
  });
});

describe('placeItem', () => {
  const base = { minutes: 30, deadline: false };

  it('puts a stated day and time on the calendar', () => {
    expect(placeItem({ ...base, date: '2026-10-27', time: '11:00' }, [], NOW)).toEqual({ start: at(27, 11), due: null });
  });

  it('sends a deadline to the backlog with a due date', () => {
    expect(placeItem({ ...base, date: '2026-10-30', time: null, deadline: true }, [], NOW)).toEqual({ start: null, due: '2026-10-30' });
    expect(placeItem({ ...base, date: null, time: null, deadline: true }, [], NOW)).toEqual({ start: null, due: '2026-10-26' });
  });

  it('keeps an item with nothing stated in the backlog', () => {
    expect(placeItem({ ...base, date: null, time: null }, [], NOW)).toEqual({ start: null, due: null });
  });

  it('puts a time with no day today if ahead, else tomorrow', () => {
    expect(placeItem({ ...base, date: null, time: '15:00' }, [], NOW)).toEqual({ start: at(26, 15), due: null });
    expect(placeItem({ ...base, date: null, time: '09:00' }, [], NOW)).toEqual({ start: at(27, 9), due: null });
  });

  it('finds a free slot on a stated day with no time', () => {
    const busy = [task(at(28, 9, 0), 60)];
    expect(placeItem({ ...base, date: '2026-10-28', time: null }, busy, NOW)).toEqual({ start: at(28, 10), due: null });
  });

  it('falls back to the backlog when the day is full or already past', () => {
    expect(placeItem({ ...base, date: '2026-10-28', time: null }, [task(at(28, 9), 720)], NOW)).toEqual({ start: null, due: '2026-10-28' });
    expect(placeItem({ ...base, date: '2026-10-20', time: '10:00' }, [], NOW)).toEqual({ start: null, due: '2026-10-20' });
  });

  it('ignores malformed dates and times', () => {
    expect(placeItem({ ...base, date: 'Friday', time: 'soon' }, [], NOW)).toEqual({ start: null, due: null });
  });
});

describe('cleanItem', () => {
  it('coerces model output into safe fields', () => {
    expect(cleanItem({ title: '  Call   the bank ', priority: '1', minutes: 40, date: '2026-10-27', time: '11:00', deadline: 'yes' }, 'raw'))
      .toEqual({ title: 'Call the bank', priority: 1, minutes: 45, date: '2026-10-27', time: '11:00', deadline: false, notes: '', label: null });
  });

  it('defaults bad values', () => {
    expect(cleanItem(null, 'the raw dump')).toEqual({ title: 'the raw dump', priority: 2, minutes: 30, date: null, time: null, deadline: false, notes: '', label: null });
    expect(cleanItem({ title: 'x', priority: 7, minutes: 9999 }, '').minutes).toBe(480);
    expect(cleanItem({ title: 'x', minutes: 5 }, '').minutes).toBe(15);
  });
});
