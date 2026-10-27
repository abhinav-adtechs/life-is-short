import { describe, expect, it } from 'vitest';
import { weekStats } from './analytics';
import type { Task } from './model';

let n = 0;
const task = (extra: Partial<Task>): Task => ({
  id: 'id' + n++, title: 'x', raw: '', notes: '', priority: 2, minutes: 60, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
// Tuesday 27 October 2026, 5:35 PM.
const NOW = at(27, 17, 35);

describe('weekStats', () => {
  const tasks = [
    task({ start: at(26, 9, 30), minutes: 30, status: 'done', doneAt: at(26, 10), label: 'work' }),
    task({ start: at(26, 13, 45), minutes: 120, label: 'work' }),
    task({ start: at(27, 12, 30), minutes: 30, label: 'help' }),
    task({ status: 'done', doneAt: at(27, 9, 14) }),
    task({ start: at(28, 11), minutes: 120, label: 'work' }),
    task({ start: at(27, 14), minutes: 60, externalId: 'gcal:c:e1' }),
    task({ priority: 1, minutes: 30, due: '2026-10-26' }),
    task({ priority: 2, minutes: 15 }),
    task({ start: at(20, 9), minutes: 60 }),
  ];
  const s = weekStats(tasks, NOW, { labelOf: t => t.label ?? null });

  it('splits each day into done, missed and still to do', () => {
    expect(s.days.map(d => [d.done, d.missed, d.todo])).toEqual([[1, 1, 0], [1, 1, 0], [0, 0, 1], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect([s.done, s.total]).toEqual([2, 5]);
  });

  it('adds up scheduled time per label, and calendar events apart', () => {
    expect(Object.fromEntries(s.byLabel)).toEqual({ work: 270, help: 30 });
    expect(s.events).toBe(60);
  });

  it('weighs the backlog by priority and counts what slipped', () => {
    expect(s.byPriority).toEqual([{ priority: 1, count: 1, minutes: 30 }, { priority: 2, count: 1, minutes: 15 }, { priority: 3, count: 0, minutes: 0 }]);
    expect([s.open, s.estimate, s.overdue]).toEqual([2, 45, 1]);
    expect(s.missed).toBe(3);
  });
});
