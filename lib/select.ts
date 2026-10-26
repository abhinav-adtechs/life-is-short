import type { Task } from './model';
import { addDays, endOf, startOfDay } from './time';

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
