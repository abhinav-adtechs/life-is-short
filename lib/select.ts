import type { Task } from './model';
import { addDays, endOf, startOfDay, weekStart } from './time';

/** Backlog order: priority, then due date (sooner first), then `order`. */
export const byBacklog = (a: Task, b: Task) =>
  (a.priority - b.priority) || (a.due || '9999').localeCompare(b.due || '9999') || ((a.order || 0) - (b.order || 0));

export const backlogList = (tasks: Task[]) => tasks.filter(t => t.status === 'open' && t.start == null).sort(byBacklog);

/** Scheduled, still open, and already over. */
export const missedList = (tasks: Task[], now: number) =>
  tasks.filter(t => t.status === 'open' && t.start != null && endOf(t) <= now).sort((a, b) => (a.start as number) - (b.start as number));

export const doneList = (tasks: Task[]) =>
  tasks.filter(t => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

export interface Focus {
  now: Task | null;
  /** True when Now is on the calendar over the current time. */
  live: boolean;
  next: Task | null;
}

/**
 * Now = the open task scheduled over the current time, else the first backlog task.
 * Next = the next scheduled task today, else the next backlog task.
 */
export function focus(tasks: Task[], now: number): Focus {
  const sched = tasks.filter(t => t.status === 'open' && t.start != null).sort((a, b) => (a.start as number) - (b.start as number));
  const live = sched.find(t => (t.start as number) <= now && endOf(t) > now) || null;
  const bl = backlogList(tasks);
  const cur = live || bl[0] || null;
  const dayEnd = addDays(startOfDay(now), 1).getTime();
  const next = sched.find(t => (t.start as number) > now && (t.start as number) < dayEnd && t.id !== cur?.id)
    || bl.find(t => t.id !== cur?.id)
    || null;
  return { now: cur, live: !!live, next };
}

/** Anything with a place on the calendar: a task, or an item someone shared with you. */
type Timed = Pick<Task, 'start' | 'minutes'>;

/** Tasks that overlap the given day. */
export const tasksOn = <T extends Timed>(tasks: T[], d: Date | number) => {
  const s = startOfDay(d).getTime(), e = addDays(d, 1).getTime();
  return tasks.filter(t => t.start != null && t.start < e && endOf(t) > s);
};

/** Visible hour range: your day, stretched to fit anything scheduled outside it. */
export function hourRange(days: Date[], sched: Timed[], base: [number, number]) {
  let [h0, h1] = base;
  for (const d of days) {
    const ds = startOfDay(d).getTime(), de = addDays(d, 1).getTime();
    for (const t of tasksOn(sched, d)) {
      const s = Math.max(t.start as number, ds), e = Math.min(endOf(t), de);
      h0 = Math.min(h0, Math.floor((s - ds) / 3600000));
      h1 = Math.max(h1, Math.ceil((e - ds) / 3600000));
    }
  }
  return [h0, Math.min(24, h1)] as const;
}

export interface Laid<T extends Timed = Task> { task: T; lane: number; lanes: number }

/** Side-by-side lanes for overlapping blocks within one day. */
export function layoutDay<T extends Timed>(events: T[]): Laid<T>[] {
  const sorted = [...events].sort((a, b) => ((a.start as number) - (b.start as number)) || (b.minutes - a.minutes));
  const out: Laid<T>[] = [];
  let cluster: Laid<T>[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes: number[] = [];
    for (const ev of cluster) {
      let i = lanes.findIndex(end => end <= (ev.task.start as number));
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = endOf(ev.task);
      ev.lane = i;
    }
    for (const ev of cluster) ev.lanes = lanes.length;
    out.push(...cluster);
    cluster = []; clusterEnd = -Infinity;
  };
  for (const t of sorted) {
    if (cluster.length && (t.start as number) >= clusterEnd) flush();
    cluster.push({ task: t, lane: 0, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, endOf(t));
  }
  if (cluster.length) flush();
  return out;
}

/** A pulled Google Calendar event rather than a task of yours: it shows on the calendar, but it isn't yours to tick off. */
export const isEvent = (t: Pick<Task, 'externalId'>) => !!t.externalId?.startsWith('gcal:');

/**
 * The hours the calendar shows: your day, stretched a little for things just outside it (up to two hours before,
 * two and a half after). Anything further out is counted instead, per day, as "earlier" or "later".
 */
export function visibleRange(days: Date[], sched: Timed[], base: [number, number]) {
  let [h0, h1] = base;
  const spans = days.map(d => {
    const ds = startOfDay(d).getTime(), de = addDays(d, 1).getTime();
    return tasksOn(sched, d).map(t => ({ s: Math.max(0, ((t.start as number) - ds) / 60000), e: Math.min(1440, (Math.min(endOf(t), de) - ds) / 60000) }));
  });
  for (const list of spans) for (const { s, e } of list) {
    if (s < base[0] * 60 && s >= base[0] * 60 - 120) h0 = Math.min(h0, Math.floor(s / 60));
    if (e > base[1] * 60 && s >= base[0] * 60 && e <= base[1] * 60 + 150) h1 = Math.max(h1, Math.ceil(e / 60));
  }
  h1 = Math.min(24, h1);
  return {
    h0, h1,
    earlier: spans.map(list => list.filter(x => x.e <= h0 * 60).length),
    later: spans.map(list => list.filter(x => x.s >= h1 * 60).length),
  };
}

/** How the day and the week are going, and what's waiting. Your tasks only: Google events don't count. */
export function progress(tasks: Task[], now: number, firstDow = 1) {
  const day0 = startOfDay(now).getTime(), day1 = addDays(day0, 1).getTime();
  const wk0 = weekStart(now, firstDow).getTime(), wk1 = addDays(wk0, 7).getTime();
  // A scheduled task counts on its day; a backlog task counts on the day you ticked it off.
  const when = (t: Task) => t.start ?? (t.status === 'done' ? t.doneAt : null);
  const mine = tasks.filter(t => !isEvent(t));
  const tally = (a: number, b: number) => {
    const list = mine.filter(t => { const w = when(t); return w != null && w >= a && w < b; });
    return { done: list.filter(t => t.status === 'done').length, total: list.length };
  };
  const open = backlogList(mine);
  return { today: tally(day0, day1), week: tally(wk0, wk1), backlog: { open: open.length, urgent: open.filter(t => t.priority === 1).length } };
}
