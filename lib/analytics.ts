import type { Priority, Task } from './model';
import { backlogList, isEvent, missedList } from './select';
import { addDays, endOf, startOfDay, weekStart, ymd } from './time';

export interface DayBar { day: Date; done: number; missed: number; todo: number; total: number }

/**
 * The week at a glance, for Analytics: each day's tasks (done, missed, still to do), the time scheduled per label
 * and in calendar events, and what waits in the backlog by priority. Your tasks only; Google events count as time.
 */
export function weekStats(tasks: Task[], now: number, o: { firstDow?: number; labelOf: (t: Task) => string | null }) {
  const wk0 = weekStart(now, o.firstDow ?? 1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk0, i));
  const keys = days.map(d => ymd(d));
  const mine = tasks.filter(t => !isEvent(t));
  // A scheduled task counts on its day; a backlog task on the day you ticked it off.
  const dayOf = (t: Task) => (t.start != null ? ymd(t.start) : t.status === 'done' && t.doneAt != null ? ymd(t.doneAt) : null);
  const bars: DayBar[] = days.map((day, i) => {
    const list = mine.filter(t => dayOf(t) === keys[i]);
    const done = list.filter(t => t.status === 'done').length;
    const missed = list.filter(t => t.status === 'open' && t.start != null && endOf(t) <= now).length;
    return { day, done, missed, todo: list.length - done - missed, total: list.length };
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
    missed: missedList(mine, now).length,
  };
}
