import type { Task } from './model';
import { PRI } from './model';
import type { Label } from './labels';
import { addDays, endOf, startOfDay, weekStart, ymd } from './time';

/** Backlog order: priority, then due date (sooner first), then `order`. */
export const byBacklog = (a: Task, b: Task) =>
  (a.priority - b.priority) || (a.due || '9999').localeCompare(b.due || '9999') || ((a.order || 0) - (b.order || 0));

export const backlogList = (tasks: Task[]) => tasks.filter(t => t.status === 'open' && t.start == null).sort(byBacklog);

/** Scheduled, still open, and already over. */
export const missedList = (tasks: Task[], now: number) =>
  tasks.filter(t => t.status === 'open' && t.start != null && endOf(t) <= now).sort((a, b) => (a.start as number) - (b.start as number));

export const doneList = (tasks: Task[]) =>
  tasks.filter(t => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

/** The backlog's time axis. A backlog task has no time on the calendar, so it sits where its due date falls. */
export type TimeBucket = 'overdue' | 'today' | 'week' | 'next' | 'later' | 'anytime';

export const TIME_BUCKETS: { id: TimeBucket; name: string }[] = [
  { id: 'overdue', name: 'Overdue' }, { id: 'today', name: 'Today' }, { id: 'week', name: 'This week' },
  { id: 'next', name: 'Next week' }, { id: 'later', name: 'Further out' }, { id: 'anytime', name: 'Anytime' },
];

/** Where a due date falls from today. Weeks begin on your first day of the week; no due date is Anytime. */
export function timeBucket(due: string | null, now: number, firstDow = 1): TimeBucket {
  if (!due) return 'anytime';
  const today = ymd(now), week = weekStart(now, firstDow);
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due <= ymd(addDays(week, 6))) return 'week';
  if (due <= ymd(addDays(week, 13))) return 'next';
  return 'later';
}

export type BacklogBy = 'label' | 'time' | 'priority';

/** One backlog section. `subs` splits it along the other axis; a section with one sub shows no subheadings. */
export interface BacklogGroup {
  key: string;
  name: string;
  /** The label's colour, for label sections. */
  color: string | null;
  count: number;
  subs: { key: string; name: string; tasks: Task[] }[];
}

/**
 * The backlog on two axes, label and time. By label: a section per label in your order, unlabelled last, each split
 * by when it's due. By time: a section per stretch of time, labels kept together inside. By priority: as before.
 * `tasks` comes in backlog order, which each sub keeps.
 */
export function groupBacklog(tasks: Task[], by: BacklogBy, o: { labels: Label[]; labelOf: (t: Task) => Label | null; now: number; weekStart?: number }): BacklogGroup[] {
  const when = new Map(tasks.map(t => [t.id, timeBucket(t.due, o.now, o.weekStart)]));
  const lab = new Map(tasks.map(t => [t.id, o.labelOf(t)?.id ?? '']));
  const flat = (key: string, name: string, list: Task[]): BacklogGroup => ({ key, name, color: null, count: list.length, subs: [{ key: '', name: '', tasks: list }] });
  if (by === 'priority') {
    return ([1, 2, 3] as const).map(p => flat(`p${p}`, PRI[p], tasks.filter(t => t.priority === p))).filter(g => g.count);
  }
  if (by === 'time') {
    const pos = new Map(o.labels.map((l, i) => [l.id, i]));
    const rank = (t: Task) => pos.get(lab.get(t.id) as string) ?? o.labels.length;
    return TIME_BUCKETS.map(b => flat(b.id, b.name, tasks.filter(t => when.get(t.id) === b.id).sort((x, y) => rank(x) - rank(y))))
      .filter(g => g.count);
  }
  const sections = [...o.labels.map(l => ({ key: l.id, name: l.name, color: l.color as string | null })), { key: '', name: 'No label', color: null }];
  return sections.map(s => {
    const mine = tasks.filter(t => lab.get(t.id) === s.key);
    const subs = TIME_BUCKETS.map(b => ({ key: b.id, name: b.name, tasks: mine.filter(t => when.get(t.id) === b.id) })).filter(x => x.tasks.length);
    return { ...s, count: mine.length, subs };
  }).filter(g => g.count);
}

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
