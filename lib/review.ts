import type { Priority, Task } from './model';
import { PRI } from './model';
import type { Label } from './labels';
import type { WorkHours } from './place';
import { slipKey, type Slip } from './slips';
import { fmtDur, fmtTime, shortDate } from './format';
import { DAY_MS, DOW, DOWL, MIN, MON, MONL, addDays, addMonths, atMinutes, endOf, fromYmd, isoWeek, startOfDay, weekStart, ymd } from './time';

/*
 * The review: everything the planner knows, added up for a day, a week or a month.
 *
 * Time is each task's length, counted when it's ticked off, plus Google events once they're over. A task with a time
 * on the calendar is due in that slot; one without a time but with a deadline is due that day. Either way it's on time
 * if it's done by the end of that day, late after, and missed while it's still open once its slot (or day) is over.
 * A missed slot you then reslotted or deleted still counts as missed, from the slips (lib/slips.ts).
 */

export type Span = 'day' | 'week' | 'month';
export const SPANS: { id: Span; name: string }[] = [{ id: 'day', name: 'Day' }, { id: 'week', name: 'Week' }, { id: 'month', name: 'Month' }];

/** [start, end) in epoch ms, on local day boundaries. */
export interface Period { span: Span; start: number; end: number }

/** The day, week (from your first day of the week) or month holding `at`. */
export function periodOf(span: Span, at: number, firstDow = 1): Period {
  const d = startOfDay(at);
  if (span === 'day') return { span, start: d.getTime(), end: addDays(d, 1).getTime() };
  if (span === 'week') { const s = weekStart(d, firstDow); return { span, start: s.getTime(), end: addDays(s, 7).getTime() }; }
  return { span, start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
}

/** n periods later (or earlier, for a negative n). */
export function shiftPeriod(p: Period, n: number, firstDow = 1): Period {
  const at = p.span === 'day' ? addDays(p.start, n) : p.span === 'week' ? addDays(p.start, 7 * n) : addMonths(p.start, n);
  return periodOf(p.span, at.getTime(), firstDow);
}

export const daysIn = (p: Period) => {
  const out: number[] = [];
  for (let d = startOfDay(p.start); d.getTime() < p.end; d = addDays(d, 1)) out.push(d.getTime());
  return out;
};

const WORD: Record<Span, string> = { day: 'day', week: 'week', month: 'month' };
/** "the week before". */
export const before = (span: Span) => `the ${WORD[span]} before`;

/**
 * What a period is held up against: the whole one before it, or, while it's still under way, the one before up to
 * the same point, so a Tuesday isn't measured against a whole week. `vs` follows "vs", `than` follows "more".
 */
export function versus(span: Span, partial: boolean) {
  if (!partial) return { vs: before(span), than: before(span) };
  const at = span === 'day' ? 'this time yesterday' : `this point last ${WORD[span]}`;
  return { vs: at, than: `by ${at}` };
}

/** What the page's title says: "This week" over "26 Oct – 1 Nov". */
export function periodName(p: Period, now: number, o: { firstDow?: number; weekNumbers?: boolean } = {}): { title: string; sub: string } {
  const cur = periodOf(p.span, now, o.firstDow);
  const ago = Math.round((cur.start - p.start) / (p.span === 'day' ? DAY_MS : p.span === 'week' ? 7 * DAY_MS : 30.4 * DAY_MS));
  const s = new Date(p.start), last = addDays(p.end, -1);
  const year = s.getFullYear() !== new Date(now).getFullYear() ? ` ${s.getFullYear()}` : '';
  if (p.span === 'day') {
    return { title: `${DOWL[s.getDay()]}, ${s.getDate()} ${MONL[s.getMonth()]}${year}`, sub: ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : ago < 0 ? 'Ahead' : `${ago} days ago` };
  }
  if (p.span === 'week') {
    const range = `${s.getDate()} ${MON[s.getMonth()]} – ${last.getDate()} ${MON[last.getMonth()]}${year}`;
    const wk = o.weekNumbers ? ` · Week ${isoWeek(s)}` : '';
    return { title: ago === 0 ? 'This week' : ago === 1 ? 'Last week' : `Week of ${s.getDate()} ${MON[s.getMonth()]}${year}`, sub: range + wk };
  }
  return { title: `${MONL[s.getMonth()]} ${s.getFullYear()}`, sub: ago === 0 ? 'This month' : ago === 1 ? 'Last month' : `${daysIn(p).length} days` };
}

/** A short name for a period in the trend: "Tue 27", "26 Oct", "Oct". */
export function periodTick(p: Period): string {
  const s = new Date(p.start);
  if (p.span === 'day') return `${DOW[s.getDay()]} ${s.getDate()}`;
  if (p.span === 'week') return `${s.getDate()} ${MON[s.getMonth()]}`;
  return MON[s.getMonth()];
}

/* ---------- what each task tells us ---------- */

export type Source = 'own' | 'gtask' | 'gcal';
export type Outcome = 'onTime' | 'late' | 'missed' | 'pending';

export const sourceOf = (t: Pick<Task, 'externalId'>): Source =>
  t.externalId?.startsWith('gcal:') ? 'gcal' : t.externalId?.startsWith('gtask:') ? 'gtask' : 'own';

/** When something was due: a slot on the calendar, or a deadline's day. Done by `deadline` is on time. */
interface Commit { at: number; deadline: number; slot: boolean; outcome: Outcome }

interface Fact {
  t: Task;
  /** Label id, '' for none. */
  label: string;
  source: Source;
  /** A Google event with a time: its time counts once it's over, and it's never missed. */
  event: boolean;
  /** When it counts: a task's done time, an event's start. Null until it's done or over. */
  when: number | null;
  /** When the time went: the slot if it was done the same day, else its length up to the moment it was ticked off. */
  workAt: number;
  commit: Commit | null;
}

/** One line in the review's lists. */
export interface Item {
  id: string;
  title: string;
  label: string;
  priority: Priority;
  minutes: number;
  source: Source;
  /** The slot or the deadline's day; for done items, when it was ticked off. */
  at: number;
  slot: boolean;
  doneAt: number | null;
  /** For missed items: still waiting under Missed, moved to another time, or deleted. */
  how?: 'open' | 'moved' | 'dropped';
}

/** A commitment that came due, from a task or a slip. */
interface Due { item: Item; outcome: Outcome; day: string }

function factOf(t: Task, label: string, now: number): Fact {
  const source = sourceOf(t);
  const event = source === 'gcal' && t.start != null;
  let when: number | null = null, workAt = 0;
  if (event) {
    if (endOf(t) <= now) when = workAt = t.start as number;
  } else if (t.status === 'done' && t.doneAt != null) {
    when = t.doneAt;
    const d0 = startOfDay(t.doneAt).getTime();
    workAt = t.start != null && t.start <= t.doneAt && t.start >= d0 ? t.start : Math.max(d0, t.doneAt - t.minutes * MIN);
  }
  let commit: Commit | null = null;
  // A Google event without a time (a birthday, a holiday) is a note, not something you can miss.
  if (source !== 'gcal' && (t.start != null || t.due)) {
    const slot = t.start != null;
    const at = slot ? t.start as number : fromYmd(t.due as string).getTime();
    const deadline = addDays(startOfDay(at), 1).getTime();
    const outcome: Outcome = t.status === 'done'
      ? (t.doneAt == null || t.doneAt < deadline ? 'onTime' : 'late')
      : (slot ? endOf(t) <= now : now >= deadline) ? 'missed' : 'pending';
    commit = { at, deadline, slot, outcome };
  }
  return { t, label, source, event, when, workAt, commit };
}

const itemOf = (f: Fact, at: number): Item => ({
  id: f.t.id, title: f.t.title, label: f.label, priority: f.t.priority, minutes: f.t.minutes, source: f.source,
  at, slot: f.t.start != null, doneAt: f.t.status === 'done' ? f.t.doneAt : null,
  how: f.commit?.outcome === 'missed' ? 'open' : undefined,
});

/** Spread a stretch of minutes over the hours of its day, from `at`. What runs past midnight stays in the last hour. */
function spreadHours(at: number, minutes: number, into: number[]) {
  const d0 = startOfDay(at).getTime();
  let m = Math.max(0, Math.floor((at - d0) / MIN)), left = minutes;
  while (left > 0) {
    const h = Math.min(23, Math.floor(m / 60));
    const take = h === 23 ? left : Math.min(left, 60 - (m % 60));
    into[h] += take;
    left -= take;
    m += take;
  }
}

/* ---------- the engine ---------- */

export interface ReviewInput {
  tasks: Task[];
  slips?: Slip[];
  labels: Label[];
  /** The task's label id: its own, or a Google event's calendar's or account's. Defaults to its own. */
  labelOf?: (t: Task) => string | null;
  now: number;
  /** First day of the week: 0 Sunday, 1 Monday, 6 Saturday. */
  firstDow?: number;
  /** Your day, in minutes from midnight: how much a day can hold. */
  hours?: WorkHours;
}

interface Ctx {
  facts: Fact[];
  dues: Due[];
  /** Days anything was ticked off, for streaks. */
  doneDays: Set<string>;
  labels: Label[];
  now: number;
  firstDow: number;
  hours: WorkHours;
}

function context(input: ReviewInput): Ctx {
  const known = new Set(input.labels.map(l => l.id));
  const labelOf = input.labelOf ?? ((t: Task) => t.label ?? null);
  const lab = (id: string | null | undefined) => (id && known.has(id) ? id : '');
  const facts = input.tasks.map(t => factOf(t, lab(labelOf(t)), input.now));
  const dues: Due[] = [];
  for (const f of facts) if (f.commit) dues.push({ item: itemOf(f, f.commit.at), outcome: f.commit.outcome, day: ymd(f.commit.at) });
  // A slip whose task is back on that very slot is told by the task itself.
  const current = new Map(input.tasks.map(t => [t.id, t.start]));
  const seen = new Set<string>();
  for (const s of input.slips ?? []) {
    const k = slipKey(s);
    if (seen.has(k) || current.get(s.id) === s.start) continue;
    seen.add(k);
    dues.push({
      item: { id: s.id, title: s.title, label: lab(s.label), priority: s.priority, minutes: s.minutes, source: 'own', at: s.start, slot: true, doneAt: null, how: s.how },
      outcome: 'missed', day: ymd(s.start),
    });
  }
  const doneDays = new Set(facts.filter(f => f.when != null && !f.event).map(f => ymd(f.when as number)));
  return { facts, dues, doneDays, labels: input.labels, now: input.now, firstDow: input.firstDow ?? 1, hours: input.hours ?? { start: 9 * 60, end: 21 * 60 } };
}

export interface Tally { count: number; minutes: number }
const tally = (): Tally => ({ count: 0, minutes: 0 });
const add = (t: Tally, minutes: number) => { t.count++; t.minutes += minutes; };

export interface Outcomes { onTime: number; late: number; missed: number; pending: number }
/** Came due: done on time, done late, or missed. What's still to come doesn't count yet. */
export const cameDue = (o: Outcomes) => o.onTime + o.late + o.missed;

export interface ScorePart { id: 'completion' | 'onTime' | 'steady' | 'priorities'; name: string; value: number; weight: number; note: string }
export interface Score { value: number; grade: string; parts: ScorePart[] }

/** What a period adds up to. The trend and the comparison with the period before need only this much. */
export interface Summary {
  period: Period;
  /** Tasks ticked off in the period, with their length. */
  done: Tally;
  /** Google events that were over in the period. */
  held: Tally;
  outcomes: Outcomes;
  /** Done (on time or late) of what came due. */
  completion: number | null;
  onTimeRate: number | null;
  /** Days something was ticked off, and days that had something due or done. */
  activeDays: number;
  busyDays: number;
  /** Minutes by label id ('' for none), tasks and events together. */
  byLabel: Record<string, number>;
  score: Score | null;
}

export const GRADES: [number, string][] = [[85, 'Excellent'], [70, 'Strong'], [55, 'Steady'], [40, 'Mixed'], [0, 'Rough']];
export const gradeOf = (v: number) => (GRADES.find(([min]) => v >= min) as [number, string])[1];

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Out of 100: how much of what came due got done (40), on its day (20), how many of your busy days you got something
 * done (20), and how the Urgent and Important work fared, Urgent counting double (20). Parts with nothing to go on
 * drop out and the rest are scaled up. A period with nothing due and nothing done has no score.
 */
function scoreOf(o: Outcomes, activeDays: number, busyDays: number, pri: Record<Priority, Outcomes>): Score | null {
  const due = cameDue(o);
  const parts: ScorePart[] = [];
  if (due) {
    parts.push({ id: 'completion', name: 'Done', value: (o.onTime + o.late) / due, weight: 40, note: `${o.onTime + o.late} of ${due} that came due` });
    parts.push({ id: 'onTime', name: 'On time', value: o.onTime / due, weight: 20, note: `${o.onTime} of ${due} on their day` });
  }
  if (busyDays) parts.push({ id: 'steady', name: 'Steady', value: activeDays / busyDays, weight: 20, note: `${activeDays} of ${busyDays} busy day${busyDays === 1 ? '' : 's'}` });
  const u = pri[1], i = pri[2];
  const want = 2 * cameDue(u) + cameDue(i);
  if (want) {
    const got = 2 * (u.onTime + u.late) + (i.onTime + i.late);
    parts.push({ id: 'priorities', name: 'Priorities', value: got / want, weight: 20, note: `${u.onTime + u.late + i.onTime + i.late} of ${cameDue(u) + cameDue(i)} Urgent and Important` });
  }
  if (!parts.length || (!due && !activeDays)) return null;
  const w = parts.reduce((s, p) => s + p.weight, 0);
  const value = Math.round((parts.reduce((s, p) => s + p.weight * p.value, 0) / w) * 100);
  return { value, grade: gradeOf(value), parts };
}

const inP = (p: Period, ms: number | null): ms is number => ms != null && ms >= p.start && ms < p.end;
const outcomes = (): Outcomes => ({ onTime: 0, late: 0, missed: 0, pending: 0 });

function summarize(c: Ctx, p: Period): Summary {
  const done = tally(), held = tally(), o = outcomes();
  const pri: Record<Priority, Outcomes> = { 1: outcomes(), 2: outcomes(), 3: outcomes() };
  const byLabel: Record<string, number> = {};
  const active = new Set<string>(), busy = new Set<string>();
  for (const f of c.facts) {
    if (!inP(p, f.when)) continue;
    add(f.event ? held : done, f.t.minutes);
    byLabel[f.label] = (byLabel[f.label] ?? 0) + f.t.minutes;
    if (!f.event) { const d = ymd(f.when); active.add(d); busy.add(d); }
  }
  for (const d of c.dues) {
    if (!inP(p, d.item.at)) continue;
    o[d.outcome]++;
    pri[d.item.priority][d.outcome]++;
    if (d.outcome !== 'pending') busy.add(d.day);
  }
  const due = cameDue(o);
  return {
    period: p, done, held, outcomes: o,
    completion: due ? (o.onTime + o.late) / due : null,
    onTimeRate: due ? o.onTime / due : null,
    activeDays: active.size, busyDays: busy.size, byLabel,
    score: scoreOf(o, active.size, busy.size, pri),
  };
}

export interface LabelRow {
  id: string;
  name: string;
  color: string | null;
  done: Tally;
  held: Tally;
  minutes: number;
  /** Of all the time in the period. */
  share: number;
  outcomes: Outcomes;
}

export interface PriorityRow { priority: Priority; name: string; done: Tally; outcomes: Outcomes }

/** One column of the activity chart: an hour of the day, or a day of the week or month. */
export interface Bucket {
  start: number;
  end: number;
  /** Minutes by label id. */
  byLabel: Record<string, number>;
  minutes: number;
  done: number;
  held: number;
  missed: number;
}

export interface Review extends Summary {
  /** The period before, up to the same point while this one is under way. */
  prev: Summary;
  compared: { vs: string; than: string };
  /** The periods leading up to this one, oldest first, ending with it. */
  trend: Summary[];
  labels: LabelRow[];
  priorities: PriorityRow[];
  sources: Record<Source, Tally>;
  /** Done tasks by length: up to 30 min, 45 min to 1.5 h, 2 h and more. */
  sizes: { quick: Tally; medium: Tally; deep: Tally };
  buckets: Bucket[];
  /** Task minutes by hour of the day, and by day of the week (0 is Sunday). */
  hours: number[];
  weekdays: number[];
  /** The hour you get the most done in, if anything was. */
  peakHour: number | null;
  /** The day with the most time in it (week and month). */
  best: Bucket | null;
  /** Days in a row with something ticked off, up to the period's last day (or today, for the current one). */
  streak: number;
  /** The longest run of such days inside the period. */
  bestRun: number;
  /** Your own tasks first captured in the period. */
  created: number;
  /** Median time from capture to done, for your own tasks done in the period. */
  leadTime: number | null;
  /** Minutes slotted on the calendar in the period (slots you then missed included), against what your days hold. */
  load: { planned: number; capacity: number };
  lists: { done: Item[]; missed: Item[]; late: Item[]; pending: Item[] };
  /** As things stand now, whatever the period. */
  backlog: { open: number; minutes: number; overdue: number; missed: number; oldest: number | null };
  insights: string[];
}

export const TREND_LENGTH: Record<Span, number> = { day: 14, week: 8, month: 6 };

export function review(input: ReviewInput, p: Period): Review {
  const c = context(input);
  const base = summarize(c, p);
  const trend = Array.from({ length: TREND_LENGTH[p.span] }, (_, i) => TREND_LENGTH[p.span] - 1 - i)
    .map(n => (n ? summarize(c, shiftPeriod(p, -n, c.firstDow)) : base));
  const prior = shiftPeriod(p, -1, c.firstDow);
  const partial = p.start <= c.now && c.now < p.end;
  const prev = partial ? summarize(c, { ...prior, end: Math.min(prior.end, prior.start + (c.now - p.start)) }) : trend[trend.length - 2];

  const sources: Record<Source, Tally> = { own: tally(), gtask: tally(), gcal: tally() };
  const sizes = { quick: tally(), medium: tally(), deep: tally() };
  const priorities: PriorityRow[] = ([1, 2, 3] as const).map(n => ({ priority: n, name: PRI[n], done: tally(), outcomes: outcomes() }));
  const rows = new Map<string, LabelRow>([...c.labels.map(l => ({ id: l.id, name: l.name, color: l.color as string | null })), { id: '', name: 'No label', color: null }]
    .map(l => [l.id, { ...l, done: tally(), held: tally(), minutes: 0, share: 0, outcomes: outcomes() }]));
  const days = daysIn(p);
  const buckets: Bucket[] = p.span === 'day'
    ? Array.from({ length: 24 }, (_, h) => ({ start: atMinutes(p.start, h * 60), end: atMinutes(p.start, (h + 1) * 60), byLabel: {}, minutes: 0, done: 0, held: 0, missed: 0 }))
    : days.map(d => ({ start: d, end: addDays(d, 1).getTime(), byLabel: {}, minutes: 0, done: 0, held: 0, missed: 0 }));
  const bucketAt = (ms: number) => buckets.find(b => ms >= b.start && ms < b.end) ?? null;
  const hours = new Array(24).fill(0) as number[], weekdays = new Array(7).fill(0) as number[];
  const lists: Review['lists'] = { done: [], missed: [], late: [], pending: [] };
  const leads: number[] = [];
  let planned = 0, created = 0;

  for (const f of c.facts) {
    const t = f.t, m = t.minutes;
    if (inP(p, t.start)) planned += m;
    if (f.source === 'own' && inP(p, t.created)) created++;
    if (!inP(p, f.when)) continue;
    const row = rows.get(f.label) as LabelRow;
    row.minutes += m;
    add(sources[f.source], m);
    if (f.event) add(row.held, m);
    else {
      add(row.done, m);
      add(priorities[t.priority - 1].done, m);
      add(m <= 30 ? sizes.quick : m <= 90 ? sizes.medium : sizes.deep, m);
      spreadHours(f.workAt, m, hours);
      weekdays[new Date(f.when).getDay()] += m;
      lists.done.push(itemOf(f, f.when));
      if (f.source === 'own' && t.created > 0 && f.when >= t.created) leads.push(f.when - t.created);
    }
    // Hours: spread over the stretch it took. Days: all of it on the day it counts.
    if (p.span === 'day') {
      const per = new Array(24).fill(0) as number[];
      spreadHours(f.workAt, m, per);
      per.forEach((v, h) => { if (v) { buckets[h].byLabel[f.label] = (buckets[h].byLabel[f.label] ?? 0) + v; buckets[h].minutes += v; } });
      const b = buckets[new Date(f.workAt).getHours()];
      if (f.event) b.held++; else b.done++;
    } else {
      const b = bucketAt(f.when);
      if (b) { b.byLabel[f.label] = (b.byLabel[f.label] ?? 0) + m; b.minutes += m; if (f.event) b.held++; else b.done++; }
    }
  }
  for (const d of c.dues) {
    const it = d.item;
    if (!inP(p, it.at)) continue;
    planned += it.how === 'moved' || it.how === 'dropped' ? it.minutes : 0;
    (rows.get(it.label) as LabelRow).outcomes[d.outcome]++;
    priorities[it.priority - 1].outcomes[d.outcome]++;
    if (d.outcome === 'missed') {
      lists.missed.push(it);
      // A deadline has a day but no hour, so on the hour chart only slots get a mark.
      const b = p.span === 'day' && !it.slot ? null : bucketAt(it.at);
      if (b) b.missed++;
    } else if (d.outcome === 'late') lists.late.push(it);
    else if (d.outcome === 'pending') lists.pending.push(it);
  }

  const total = [...rows.values()].reduce((s, r) => s + r.minutes, 0);
  const labels = [...rows.values()]
    .map(r => ({ ...r, share: total ? r.minutes / total : 0 }))
    .filter(r => r.minutes || cameDue(r.outcomes) || r.outcomes.pending);
  for (const l of Object.values(lists)) l.sort((a: Item, b: Item) => a.at - b.at);

  // Streaks: a day still under way doesn't break one.
  const last = Math.min(p.end, c.now + 1);
  let streak = 0;
  for (let d = startOfDay(last - 1); ; d = addDays(d, -1)) {
    if (c.doneDays.has(ymd(d))) streak++;
    else if (!(streak === 0 && ymd(d) === ymd(c.now))) break;
    if (streak > 3660) break;
  }
  let bestRun = 0, run = 0;
  for (const d of days) { run = c.doneDays.has(ymd(d)) ? run + 1 : 0; bestRun = Math.max(bestRun, run); }

  const peak = hours.reduce((bi, v, i) => (v > hours[bi] ? i : bi), 0);
  const best = p.span === 'day' ? null : buckets.reduce<Bucket | null>((b, x) => (x.minutes > (b?.minutes ?? 0) ? x : b), null);
  leads.sort((a, b) => a - b);
  const leadTime = leads.length ? (leads.length % 2 ? leads[(leads.length - 1) / 2] : (leads[leads.length / 2 - 1] + leads[leads.length / 2]) / 2) : null;

  const today = ymd(c.now);
  const open = c.facts.filter(f => f.source !== 'gcal' && f.t.status === 'open');
  const backlog = {
    open: open.filter(f => f.t.start == null).length,
    minutes: open.filter(f => f.t.start == null).reduce((s, f) => s + f.t.minutes, 0),
    overdue: open.filter(f => f.t.start == null && f.t.due != null && f.t.due < today).length,
    missed: open.filter(f => f.commit?.slot && f.commit.outcome === 'missed').length,
    oldest: open.filter(f => f.source === 'own' && f.t.created > 0).reduce<number | null>((m, f) => (m == null || f.t.created < m ? f.t.created : m), null),
  };

  const r: Review = {
    ...base, prev, compared: versus(p.span, partial), trend, labels, priorities, sources, sizes, buckets, hours, weekdays,
    peakHour: hours[peak] > 0 ? peak : null, best, streak, bestRun, created, leadTime,
    load: { planned, capacity: Math.max(0, c.hours.end - c.hours.start) * days.length },
    lists, backlog, insights: [],
  };
  r.insights = insights(r, c.now);
  return r;
}

/* ---------- what it says ---------- */

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "2 d", "5 h", "40 min". */
export function fmtSpan(ms: number) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** "10 to 11 AM", "11 AM to noon", or "14:00 to 15:00" on the 24-hour clock. */
export function hourRange(h: number) {
  const name = (x: number) => {
    const s = fmtTime(atMinutes(new Date(2000, 0, 3), x * 60));
    if (!/[AP]M$/.test(s)) return s;
    return x % 24 === 12 ? 'noon' : x % 24 === 0 ? 'midnight' : s.replace(':00', '');
  };
  const a = name(h), b = name(h + 1);
  // Both ends in the morning (or afternoon): say so once.
  const m = /^(\d+) ([AP]M)$/.exec(a);
  return m && b.endsWith(m[2]) ? `${m[1]} to ${b}` : `${a} to ${b}`;
}

const compare = (n: number, was: number, than: string) =>
  (n === was ? `the same as ${than}` : `${Math.abs(n - was)} ${n > was ? 'more' : 'fewer'} than ${than}`);

/** Plain sentences about the period, the most telling first. */
export function insights(r: Review, now: number): string[] {
  const span = r.period.span, than = r.compared.than, out: string[] = [];
  const o = r.outcomes, due = cameDue(o);
  const time = r.done.minutes + r.held.minutes;
  if (!r.done.count && !due && !r.held.count) {
    if (r.period.start > now) return [`This ${WORD[span]} hasn’t started yet.`];
    if (now < r.period.end) return [`Nothing has come due or been ticked off yet this ${WORD[span]}.${o.pending ? ` ${o.pending} still to come.` : ''}`];
    return [`A quiet ${WORD[span]}: nothing came due and nothing was ticked off.`];
  }

  if (r.done.count || r.prev.done.count) out.push(`You finished ${plural(r.done.count, 'task')}, ${compare(r.done.count, r.prev.done.count, than)}.`);

  const urgentMissed = r.lists.missed.filter(i => i.priority === 1).length;
  if (o.missed) {
    const moved = r.lists.missed.filter(i => i.how !== 'open').length;
    const after = !moved ? '' : moved === o.missed ? (moved === 1 ? ' It was moved or dropped afterwards.' : ' All were moved or dropped afterwards.') : ` ${moved} ${moved === 1 ? 'was' : 'were'} moved or dropped afterwards.`;
    out.push(`${plural(o.missed, 'task')} missed ${o.missed === 1 ? 'its' : 'their'} slot or deadline${urgentMissed ? `, ${urgentMissed} of them Urgent` : ''}.${after}`);
  } else if (due) {
    out.push(o.late ? `Nothing missed outright, though ${plural(o.late, 'task')} finished after ${o.late === 1 ? 'its' : 'their'} day.` : 'Nothing missed: everything that came due got done on its day.');
  }

  const top = [...r.labels].sort((a, b) => b.minutes - a.minutes)[0];
  if (top && top.minutes && time) {
    const was = r.prev.byLabel[top.id] ?? 0, prevTime = r.prev.done.minutes + r.prev.held.minutes;
    const share = top.minutes / time, prevShare = prevTime ? was / prevTime : null;
    const name = top.id ? top.name : 'Unlabelled work';
    if (prevShare != null && Math.abs(share - prevShare) >= 0.1) out.push(`${name} took ${pct(share)} of your time, ${share > prevShare ? 'up' : 'down'} from ${pct(prevShare)} ${than}.`);
    else if (r.labels.filter(l => l.minutes).length > 1) out.push(`${name} took the most time: ${fmtDur(top.minutes)}, ${pct(share)} of it.`);
  }

  if (r.best && span !== 'day' && r.best.minutes) {
    const d = new Date(r.best.start);
    out.push(`Your fullest day was ${span === 'week' ? DOWL[d.getDay()] : shortDate(r.best.start, now)}: ${fmtDur(r.best.minutes)} of work.`);
  }
  if (r.peakHour != null && span !== 'day' && r.done.count >= 3) out.push(`You get the most done from ${hourRange(r.peakHour)}.`);

  if (r.held.minutes && time) out.push(`Meetings took ${fmtDur(r.held.minutes)}, ${pct(r.held.minutes / time)} of your time.`);

  if (r.created || r.done.count) {
    const net = r.created - r.done.count;
    out.push(`You added ${plural(r.created, 'task')} and finished ${r.done.count}: ${net > 0 ? `the list grew by ${net}` : net < 0 ? `the list shrank by ${-net}` : 'the list held steady'}.`);
  }
  if (r.leadTime != null && span !== 'day') out.push(`A typical task went from capture to done in ${fmtSpan(r.leadTime)}.`);
  if (r.period.start <= now && now < r.period.end && r.streak >= 3) out.push(`You’re on a ${r.streak}-day streak.`);
  if (r.load.capacity && r.load.planned > r.load.capacity) out.push(`You planned ${fmtDur(r.load.planned)} into ${fmtDur(r.load.capacity)} of working hours: more than your days hold.`);
  return out;
}
