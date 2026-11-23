import type { Task } from './model';
import { isEvent } from './select';
import { MIN, endOf, ymd } from './time';

/*
 * Today as one line, for the Today view: everything on the clock today in order (your tasks, your calendar's events,
 * the repeats still to come, and what you ticked off without a time, at the moment you did it), where now is, and the
 * free time left between them. What's today's but has no time yet (overdue, due today, or in today's plan) is kept
 * beside the line rather than on it.
 */

/** What an entry on the line is: one of your tasks, a calendar event, or a repeat that hasn't come round yet. */
export type EntryKind = 'task' | 'event' | 'repeat';

/**
 * Where an entry stands at this minute. `now` is on right now; `next` is the first thing still to come; `missed` is a
 * task whose slot ended without a tick; `over` is an event that's been and gone.
 */
export type EntryState = 'done' | 'now' | 'next' | 'later' | 'missed' | 'over';

export interface Entry {
  key: string;
  kind: EntryKind;
  task: Task;
  /** Where it sits on the line: its start, or when it was ticked off for a task done without a time. */
  at: number;
  /** When it ends; the same as `at` for a point. */
  end: number;
  state: EntryState;
  /** Ticked off today without ever being on the calendar: a point at the moment it was done. */
  point: boolean;
}

export type Row =
  | { type: 'entry'; entry: Entry }
  /** Free time still to come, between two things or before the end of your day. */
  | { type: 'free'; from: number; to: number }
  /** Now, when nothing's on: free until the next thing today (null when nothing else is on today). */
  | { type: 'now'; at: number; until: number | null };

/** Why something with no time belongs to today. */
export type AnytimeWhy = 'overdue' | 'due' | 'plan';

export interface Anytime { task: Task; why: AnytimeWhy }

export interface DayLine {
  rows: Row[];
  /** Today's with no time yet: overdue, then due today, then the plan's steps that aren't on the calendar. */
  anytime: Anytime[];
  /** Minutes of your day still free, from now (or the day's start) to the day's end. */
  free: number;
  /** Minutes of your day from now to its end that are spoken for. */
  booked: number;
}

export interface DayInput {
  /** Everything you can see: your tasks and your calendar's events. */
  tasks: Task[];
  /** The repeats still to come today, as the tasks they'll make. */
  upcoming?: Task[];
  now: number;
  /** The day, [from, to). */
  from: number;
  to: number;
  /** Your day, in hours: [start, end). Free time is only counted inside it. */
  hours: [number, number];
  /** The task ids today's plan names. */
  planSteps?: string[];
  /** The shortest free time worth showing, in minutes. */
  minFree?: number;
}

const WHY: Record<AnytimeWhy, number> = { overdue: 0, due: 1, plan: 2 };

/** Overlapping intervals merged, oldest first. */
function union(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of [...spans].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Today in order, with now and the free time marked, and what's today's with no time. */
export function dayLine({ tasks, upcoming = [], now, from, to, hours, planSteps = [], minFree = 15 }: DayInput): DayLine {
  const onDay = (t: Task) => t.start != null && t.start < to && endOf(t) > from;
  const list: Omit<Entry, 'state'>[] = [
    ...tasks.filter(onDay).map(t => ({ key: t.id, kind: (isEvent(t) ? 'event' : 'task') as EntryKind, task: t, at: t.start as number, end: endOf(t), point: false })),
    ...upcoming.filter(onDay).map(t => ({ key: `rep:${t.id}`, kind: 'repeat' as EntryKind, task: t, at: t.start as number, end: endOf(t), point: false })),
    ...tasks.filter(t => t.start == null && !isEvent(t) && t.status === 'done' && t.doneAt != null && t.doneAt >= from && t.doneAt < to)
      .map(t => ({ key: t.id, kind: 'task' as EntryKind, task: t, at: t.doneAt as number, end: t.doneAt as number, point: true })),
  ].sort((a, b) => (a.at - b.at) || (b.end - a.end) || a.task.title.localeCompare(b.task.title));

  const stateOf = (e: Omit<Entry, 'state'>): EntryState => {
    if (e.kind === 'event') return e.end <= now ? 'over' : e.at <= now ? 'now' : 'later';
    if (e.kind === 'repeat') return e.at <= now ? 'over' : 'later';
    if (e.task.status === 'done') return 'done';
    return e.end <= now ? 'missed' : e.at <= now ? 'now' : 'later';
  };
  const entries: Entry[] = list.map(e => ({ ...e, state: stateOf(e) }));
  const next = entries.find(e => e.state === 'later');
  if (next) next.state = 'next';

  // What still takes up time: not done, not over, not a point.
  const busy = (e: Entry) => !e.point && e.state !== 'done' && e.state !== 'over';
  const day0 = from + hours[0] * 60 * MIN, day1 = from + hours[1] * 60 * MIN;
  const start = Math.max(now, day0);
  const gap = minFree * MIN;

  const rows: Row[] = [];
  const isToday = now >= from && now < to;
  let nowPlaced = !isToday || entries.some(e => e.state === 'now');
  // The next thing that takes time: the now row is free until then (a task you finished early doesn't count).
  const ahead = entries.find(e => busy(e) && e.at > now) ?? null;
  // Free time is counted from here: never before now, never outside your day.
  let cursor = start;
  const placeNow = () => {
    rows.push({ type: 'now', at: now, until: ahead?.at ?? null });
    nowPlaced = true;
    // The time until the next thing is the now row's; with nothing ahead, so is the rest of the day.
    cursor = Math.max(cursor, ahead ? ahead.at : day1);
  };
  for (const e of entries) {
    if (!nowPlaced && e.at > now) placeNow();
    const end = Math.min(e.at, day1);
    if (busy(e) && end - cursor >= gap) rows.push({ type: 'free', from: cursor, to: end });
    rows.push({ type: 'entry', entry: e });
    if (busy(e)) cursor = Math.max(cursor, e.end);
  }
  if (!nowPlaced) placeNow();
  // The rest of your day.
  if (day1 - cursor >= gap) rows.push({ type: 'free', from: cursor, to: day1 });

  const taken = union(entries.filter(busy).map(e => [Math.max(e.at, start), Math.min(e.end, day1)]));
  const booked = Math.round(taken.reduce((n, [s, e]) => n + (e - s), 0) / MIN);
  const free = Math.max(0, Math.round((day1 - start) / MIN) - booked);

  const today = ymd(from);
  const plan = new Set(planSteps);
  const timed = new Set(entries.map(e => e.task.id));
  const anytime: Anytime[] = [];
  for (const t of tasks) {
    if (t.status !== 'open' || t.start != null || timed.has(t.id)) continue;
    // A calendar's all-day event reads as a deadline on its day; one from a day gone by isn't overdue.
    const why: AnytimeWhy | null = t.due === today ? 'due' : t.due && t.due < today && !isEvent(t) ? 'overdue' : plan.has(t.id) ? 'plan' : null;
    if (why) anytime.push({ task: t, why });
  }
  anytime.sort((a, b) => (WHY[a.why] - WHY[b.why]) || (a.task.priority - b.task.priority)
    || (a.task.due ?? '').localeCompare(b.task.due ?? '') || ((a.task.order || 0) - (b.task.order || 0)));

  return { rows, anytime, free, booked };
}
