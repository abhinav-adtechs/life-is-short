import type { Priority, Task } from './model';
import { backlogList, isEvent } from './select';
import type { Slip } from './slips';
import { addDays, endOf, startOfDay, weekStart, ymd } from './time';

export interface DayBar { day: Date; done: number; missed: number; todo: number; total: number }

/**
 * The week at a glance, for Analytics: each day's tasks (done, missed, still to do), the time scheduled per label
 * and in calendar events, and what waits in the backlog by priority. Your tasks only; Google events count as time.
 * A missed task goes back to the backlog, so its slot is counted from the slips (lib/slips.ts).
 */
export function weekStats(tasks: Task[], now: number, o: { firstDow?: number; labelOf: (t: Task) => string | null; slips?: Slip[] }) {
  const wk0 = weekStart(now, o.firstDow ?? 1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk0, i));
  const keys = days.map(d => ymd(d));
  const mine = tasks.filter(t => !isEvent(t));
  // A scheduled task counts on its day; a backlog task on the day you ticked it off.
  const dayOf = (t: Task) => (t.start != null ? ymd(t.start) : t.status === 'done' && t.doneAt != null ? ymd(t.doneAt) : null);
  // A slip whose task is back on that very slot is counted by the task itself.
  const slotOf = new Map(tasks.map(t => [t.id, t.start]));
  const slipped = (o.slips ?? []).filter(s => slotOf.get(s.id) !== s.start);
  const bars: DayBar[] = days.map((day, i) => {
    const list = mine.filter(t => dayOf(t) === keys[i]);
    const done = list.filter(t => t.status === 'done').length;
    const over = list.filter(t => t.status === 'open' && t.start != null && endOf(t) <= now).length;
    const missed = over + slipped.filter(s => ymd(s.start) === keys[i]).length;
    const todo = list.length - done - over;
    return { day, done, missed, todo, total: done + missed + todo };
  });
  const inWeek = (t: Task) => t.start != null && keys.includes(ymd(t.start));
  const byLabel = new Map<string, number>();
  for (const t of mine.filter(inWeek)) { const k = o.labelOf(t) ?? ''; byLabel.set(k, (byLabel.get(k) ?? 0) + t.minutes); }
  const events = tasks.filter(t => isEvent(t) && inWeek(t)).reduce((a, t) => a + t.minutes, 0);
  const open = backlogList(mine);
  const byPriority = ([1, 2, 3] as Priority[]).map(p => {
    const list = open.filter(t => t.priority === p);
    return { priority: p, count: list.length, minutes: list.reduce((a, t) => a + t.minutes, 0) };
  });
  const today = ymd(startOfDay(now));
  return {
    days: bars,
    done: bars.reduce((a, b) => a + b.done, 0),
    total: bars.reduce((a, b) => a + b.total, 0),
    byLabel, events, byPriority,
    open: open.length,
    estimate: open.reduce((a, t) => a + t.minutes, 0),
    overdue: open.filter(t => t.due != null && t.due < today).length,
    /** Slots missed this week. */
    missed: bars.reduce((a, b) => a + b.missed, 0),
  };
}
