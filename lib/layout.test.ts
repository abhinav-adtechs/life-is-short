import { describe, expect, it } from 'vitest';
import { DAYS, DEFAULT_SPLIT, PRESETS, SPLIT_MAX, SPLIT_MIN, clampSplit, daysFor, fullMatrix, normalizeSplit, snapSplit, splitFor, stepSplit } from './layout';
import { DEFAULT_PREFS, normalizePrefs, syncable } from './prefs';
import { progress, visibleRange } from './select';
import { rangeTitle, stepDay, viewDays } from './calview';
import type { Task } from './model';

const P = { weekStart: 1, fiveDay: 'rolling', weekNumbers: false } as const;

describe('the split', () => {
  it('shows 1, 2, 3, 5 and 7 days at its presets', () => {
    expect(PRESETS.map(daysFor)).toEqual(DAYS);
    for (const d of DAYS) expect(daysFor(splitFor(d))).toBe(d);
  });

  it('starts at 60%, three days', () => {
    expect(DEFAULT_SPLIT).toBe(0.6);
    expect(daysFor(DEFAULT_SPLIT)).toBe(3);
    expect(DEFAULT_PREFS.split).toBe(0.6);
  });

  it('settles a dragged divider on the nearest preset', () => {
    expect(snapSplit(0.63)).toBe(0.6);
    expect(snapSplit(0.79)).toBe(0.84);
    expect(snapSplit(0.4)).toBe(0.42);
  });

  it('steps through the presets with the arrow keys, and stops at the ends', () => {
    expect(stepSplit(0.6, 1)).toBe(0.72);
    expect(stepSplit(0.6, -1)).toBe(0.42);
    expect(stepSplit(0.84, 1)).toBe(0.84);
    expect(stepSplit(0.34, -1)).toBe(0.34);
  });

  it('keeps both sides some room', () => {
    expect(clampSplit(0.1)).toBe(SPLIT_MIN);
    expect(clampSplit(0.99)).toBe(SPLIT_MAX);
  });

  it('draws the whole matrix at half the width or less', () => {
    expect(fullMatrix(0.42)).toBe(true);
    expect(fullMatrix(0.5)).toBe(true);
    expect(fullMatrix(0.6)).toBe(false);
  });

  it('starts an old pixel width from the default, and keeps the split on this device', () => {
    expect(normalizeSplit({ mode: 'pinned', cal: 620 })).toBe(DEFAULT_SPLIT);
    expect(normalizePrefs({ split: 0.72 }).split).toBe(0.72);
    expect(syncable(normalizePrefs({ split: 0.72 }))).not.toHaveProperty('split');
  });
});

describe('calendar days', () => {
  const tue = new Date(2026, 9, 27);
  it('shows the day and the ones after it, and steps by as many', () => {
    expect(viewDays('two', tue, P).map(d => d.getDate())).toEqual([27, 28]);
    expect(viewDays('three', tue, P).map(d => d.getDate())).toEqual([27, 28, 29]);
    expect(viewDays('work', tue, P).map(d => d.getDate())).toEqual([27, 28, 29, 30, 31]);
    expect(stepDay('two', tue, 1, P).getDate()).toBe(29);
    expect(stepDay('three', tue, 1, P).getDate()).toBe(30);
  });

  it('titles a run of days, and one day in full', () => {
    expect(rangeTitle(viewDays('three', tue, P), P)).toBe('Tue 27 – Thu 29 Oct');
    expect(rangeTitle(viewDays('week', tue, P), P)).toBe('Mon 26 Oct – Sun 1 Nov');
    expect(rangeTitle([tue], P)).toBe('Tuesday 27 Oct');
    expect(rangeTitle(viewDays('three', tue, P), { weekNumbers: true })).toBe('Tue 27 – Thu 29 Oct · Week 44');
  });
});

let n = 0;
const task = (extra: Partial<Task>): Task => ({
  id: 'id' + n++, title: 'x', raw: '', notes: '', priority: 2, minutes: 60, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe('the hours the calendar shows', () => {
  const days = [new Date(2026, 9, 27), new Date(2026, 9, 28)];
  it('is your day when nothing falls outside it', () => {
    expect(visibleRange(days, [task({ start: at(27, 10) })], [9, 21])).toEqual({ h0: 9, h1: 21, earlier: [0, 0], later: [0, 0] });
  });

  it('stretches a little for things just outside, and counts the rest', () => {
    const r = visibleRange(days, [task({ start: at(27, 21, 30) }), task({ start: at(28, 0) }), task({ start: at(28, 7, 30), minutes: 30 })], [9, 21]);
    expect(r).toEqual({ h0: 7, h1: 23, earlier: [0, 1], later: [0, 0] });
  });

  it('counts what starts long after your day as later', () => {
    expect(visibleRange(days, [task({ start: at(27, 23, 45), minutes: 15 })], [9, 21]).later).toEqual([1, 0]);
  });
});

describe('progress', () => {
  const now = at(27, 17, 35);
  it('counts today and this week, your tasks only, and what waits in the backlog', () => {
    const tasks = [
      task({ start: at(27, 10), status: 'done', doneAt: at(27, 11) }),
      task({ start: at(27, 12, 30) }),
      task({ start: at(27, 9), status: 'done', doneAt: at(27, 10), externalId: 'gcal:c:e' }),
      task({ status: 'done', doneAt: at(27, 9, 14) }),
      task({ start: at(26, 9, 30), status: 'done', doneAt: at(26, 10) }),
      task({ start: at(29, 9, 30) }),
      task({ priority: 1 }), task({ priority: 1 }), task({ priority: 2 }),
    ];
    expect(progress(tasks, now)).toEqual({ today: { done: 2, total: 3 }, week: { done: 3, total: 5 }, backlog: { open: 3, urgent: 2 } });
  });
});
