import { newId, type Priority, type Task } from '../model';
import type { TaskRepo } from '../repo/types';
import { byBacklogWith, isEvent } from '../select';
import { normalizeLabels, pickLabel, type Label } from '../labels';
import { GOALS_KEY, MAX_GOAL_DEPTH, activeGoals, descendantsOf, findResult, flatResults, goalProgress, goalRanker, goalSection, goalTree, normalizeGoals, pickGoal, resultDone, topGoals, type Goal } from '../goals';
import { LOG_KEY, MAX_LOG, buildFlow, coalesce, describeEntry, logFromWrites, normalizeLog, planOf, repeatNode, toJson, toMermaid, type LogEntry, type Plan } from '../flow';
import { buildTree, toMermaidTree, treeJson, type TreeFlowJson } from '../flowTree';
import { OP_FIELDS, applyWorkflow, normalizeOps, opIssues, recordedIds, type WorkflowOp, type WorkflowOpKind, type WorkflowRefs } from '../workflow';
import { MAX_REPEATS, REPEATS_KEY, applyOps, describeRepeat, followTask, normalizeRepeats, occurrenceId, occurrenceOf, startRepeat, toRule, type Repeat, type RepeatOp, type Rule } from '../repeat';
import { SLIPS_KEY, mergeSlips, normalizeSlips, slipsFrom, type Change } from '../slips';
import { dayIn, dayStart, fromWallClock, isoIn, nextDay, parseWhen, validDay } from './when';

/*
 * What the MCP tools do (lib/server/mcp/server.ts), over the same TaskRepo the planner writes through
 * (lib/repo/types.ts). Writes follow the planner's rules (components/store.ts and Planner.tsx): each one is stamped
 * newer than what it replaces so open screens take it, a missed slot moved or deleted is noted for the review, an
 * edit to a repeat's open task carries on to the ones to come, and a change to a task on a goal goes in that goal's
 * chart history. Goals and their charts change through the app's own chart builder (lib/workflow.ts).
 */

export const PRIORITIES = ['urgent', 'important', 'later'] as const;
export type PriorityName = (typeof PRIORITIES)[number];
const PRI: Record<PriorityName, Priority> = { urgent: 1, important: 2, later: 3 };
const PRI_NAME: Record<Priority, PriorityName> = { 1: 'urgent', 2: 'important', 3: 'later' };

export type Status = 'open' | 'done';

/** One task as the tools return it: small, with your time zone's clock. */
export interface TaskSummary {
  id: string;
  title: string;
  status: Status;
  priority: PriorityName;
  /** The task's label (Work, Personal…), the app's take on a project. */
  project: string | null;
  /** The goal it moves, by title, or null for off-goal work. */
  goal: string | null;
  due: string | null;
  scheduled: string | null;
  minutes: number;
  updated: string;
  /** Pulled from Google: its title and time follow Google. */
  source?: 'google_calendar' | 'google_tasks';
  /** Made by a repeat. */
  repeating?: true;
}

export interface TaskDetail extends TaskSummary {
  notes: string;
  /** What you typed or said when it was added, when it came from the chat bar. */
  original_text?: string;
  created: string;
  done_at: string | null;
  /** The repeat it belongs to, in words. */
  repeat?: string;
  /** For a repeating task: its whole series, "rep:<id>", which update_task takes to change or stop it. */
  series?: string;
}

/** A tool's input was understood but can't be done; the message says why and what to do instead. */
export class TaskError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'invalid' | 'read_only') { super(message); }
}

export interface Ctx {
  repo: TaskRepo;
  /** The IANA zone dates and times are read and shown in. */
  tz: string;
  now?: () => number;
}

const clock = (c: Ctx) => (c.now ?? Date.now)();

async function labelsOf(c: Ctx): Promise<Label[]> {
  const prefs = await c.repo.getSetting<{ labels?: unknown }>('prefs');
  return normalizeLabels(prefs && typeof prefs === 'object' ? prefs.labels : undefined);
}

/** Your goals. A database from before supabase/migrations/0010 doesn't hand them out: then there are none. */
async function goalsOf(c: Ctx): Promise<Goal[]> {
  try {
    return normalizeGoals(await c.repo.getSetting(GOALS_KEY));
  } catch (e) {
    if (e instanceof Error && /not available/.test(e.message)) return [];
    throw e;
  }
}

async function load(c: Ctx) {
  const [tasks, labels, goals] = await Promise.all([c.repo.list(), labelsOf(c), goalsOf(c)]);
  return { tasks, labels, byLabel: new Map(labels.map(l => [l.id, l])), goals, byGoal: new Map(goals.map(g => [g.id, g])) };
}

const sourceOf = (t: Task): TaskSummary['source'] =>
  isEvent(t) ? 'google_calendar' : t.externalId?.startsWith('gtask:') ? 'google_tasks' : undefined;

export function summary(t: Task, labels: Map<string, Label>, tz: string, goals: Map<string, Goal> = new Map()): TaskSummary {
  const out: TaskSummary = {
    id: t.id, title: t.title, status: t.status, priority: PRI_NAME[t.priority] ?? 'important',
    project: (t.label && labels.get(t.label)?.name) || null, goal: (t.goal && goals.get(t.goal)?.title) || null, due: t.due, scheduled: t.start == null ? null : isoIn(t.start, tz),
    minutes: t.minutes, updated: isoIn(t.updatedAt || t.created, tz),
  };
  const source = sourceOf(t);
  if (source) out.source = source;
  if (occurrenceOf(t.id)) out.repeating = true;
  return out;
}

async function detail(c: Ctx, t: Task, labels: Map<string, Label>, goals?: Map<string, Goal>): Promise<TaskDetail> {
  const out: TaskDetail = {
    ...summary(t, labels, c.tz, goals), notes: t.notes || '', created: isoIn(t.created, c.tz), done_at: t.doneAt == null ? null : isoIn(t.doneAt, c.tz),
  };
  if (t.raw && t.raw !== t.title) out.original_text = t.raw;
  const o = occurrenceOf(t.id);
  if (o) {
    const r = normalizeRepeats(await c.repo.getSetting(REPEATS_KEY)).find(x => x.id === o.repeat);
    if (r) { out.repeat = describeRepeat(r); out.series = `rep:${r.id}`; }
  }
  return out;
}

const names = (labels: Label[]) => (labels.length ? labels.map(l => l.name).join(', ') : 'none set up');

/** A project name or id → a label id. Null clears it; unknown names say which ones exist. */
function labelFor(labels: Label[], v: string | null): string | null {
  if (v == null || !v.trim()) return null;
  const id = pickLabel(labels, v);
  if (!id) throw new TaskError(`There's no project called "${v}". Projects are the labels in Settings → Labels: ${names(labels)}.`, 'invalid');
  return id;
}

/** A goal's title (or a key word of it) or id → an active goal. Null or "none" is off-goal; unknown ones say which exist. */
function goalFor(goals: Goal[], v: string | null): Goal | null {
  if (v == null || !v.trim() || v.trim().toLowerCase() === 'none') return null;
  const id = pickGoal(goals, v);
  if (!id) {
    const live = activeGoals(goals).map(g => `"${g.title}"`).join(', ') || 'none set up';
    throw new TaskError(`There's no goal called "${v}". The user's goals (set in the app's Goals panel): ${live}.`, 'invalid');
  }
  return goals.find(g => g.id === id) ?? null;
}

/** What a task becomes on a goal: the goal, and the goal's section as its project unless one was given. */
/** What a task becomes on a goal: the goal, and its top goal's section unless a project was given. */
const onGoal = (g: Goal | null, projectGiven: boolean, goals: Goal[]): Partial<Task> => {
  const section = g ? goalSection({ goal: g.id }, new Map(goals.map(x => [x.id, x]))) : null;
  return g ? { goal: g.id, ...(section && !projectGiven ? { label: section } : {}) } : { goal: null };
};

function dayOrThrow(v: string, what: string): string {
  const d = validDay(v.trim());
  if (!d) throw new TaskError(`${what} must be a date like 2026-11-12, not "${v}".`, 'invalid');
  return d;
}

function whenOrThrow(v: string, tz: string, what: string): number {
  const ms = parseWhen(v, tz);
  if (ms == null) throw new TaskError(`${what} must be a date and time like 2026-11-12T15:00 (your time, ${tz}) or with an offset, not "${v}".`, 'invalid');
  return ms;
}

/** A date means its whole day, in your zone; a date-time means that minute. `end` is exclusive. */
function rangeEdge(v: string, tz: string, edge: 'from' | 'to'): number {
  const d = validDay(v.trim());
  if (d) return dayStart(edge === 'from' ? d : nextDay(d), tz);
  const ms = whenOrThrow(v, tz, edge === 'from' ? 'scheduled_after' : 'scheduled_before');
  return edge === 'from' ? ms : ms + 1;
}

function find(tasks: Task[], id: string): Task {
  const t = tasks.find(x => x.id === id);
  if (!t) throw new TaskError(`No task has the id "${id}". Use list_tasks to find it.`, 'not_found');
  return t;
}

/* ---------- writing, the way the planner does ---------- */

/** Write tasks and deletions, then do the planner's bookkeeping. Returns the tasks as written. */
async function write(c: Ctx, changes: Change[], log: LogEntry[] = []): Promise<Task[]> {
  const now = clock(c);
  const stamped: Change[] = changes.map(({ before, after }) => ({
    before, after: after && { ...after, updatedAt: Math.max(now, (before?.updatedAt || 0) + 1) },
  }));
  const puts = stamped.flatMap(x => (x.after ? [x.after] : []));
  const gone = stamped.flatMap(x => (!x.after && x.before ? [x.before.id] : []));
  if (puts.length) await c.repo.put(puts);
  if (gone.length) await c.repo.remove(gone);
  // The write is in; the bookkeeping is best effort, as on a device that's offline.
  const done = await Promise.allSettled([noteSlips(c, stamped, now), followRepeats(c, puts, now), noteLog(c, [...log, ...logFromWrites(stamped, now)])]);
  for (const r of done) {
    if (r.status === 'rejected') console.warn('mcp: saved, but could not update slips, repeats or chart history:', r.reason instanceof Error ? r.reason.message : r.reason);
  }
  return puts;
}

/** Add to the goals' chart history, laid over what's stored. A database from before 0011 doesn't let a connection write it. */
async function noteLog(c: Ctx, entries: LogEntry[]) {
  if (!entries.length) return;
  try {
    const stored = normalizeLog(await c.repo.getSetting(LOG_KEY));
    await c.repo.setSetting(LOG_KEY, coalesce([...stored, ...entries]).slice(-MAX_LOG));
  } catch (e) {
    if (e instanceof Error && /not available/.test(e.message)) return;
    throw e;
  }
}

async function noteSlips(c: Ctx, changes: Change[], now: number) {
  const found = slipsFrom(changes, now);
  if (!found.length) return;
  const stored = normalizeSlips(await c.repo.getSetting(SLIPS_KEY));
  await c.repo.setSetting(SLIPS_KEY, mergeSlips(stored, found, now));
}

async function followRepeats(c: Ctx, puts: Task[], now: number) {
  const mine = puts.filter(t => occurrenceOf(t.id));
  if (!mine.length) return;
  const list = normalizeRepeats(await c.repo.getSetting(REPEATS_KEY));
  const ops: RepeatOp[] = [];
  for (const t of mine) {
    const r = list.find(x => x.id === occurrenceOf(t.id)?.repeat);
    const next = r && followTask(r, t, now);
    if (next) ops.push({ kind: 'set', repeat: next });
  }
  if (ops.length) await c.repo.setSetting(REPEATS_KEY, applyOps(list, ops));
}

/* ---------- the tools ---------- */

export interface ListInput {
  status?: Status | 'any';
  project?: string;
  goal?: string;
  due_after?: string;
  due_before?: string;
  scheduled_after?: string;
  scheduled_before?: string;
  query?: string;
  include_events?: boolean;
  limit?: number;
  cursor?: string;
}

export interface ListOutput {
  tasks: TaskSummary[];
  total: number;
  next_cursor: string | null;
  today: string;
  timezone: string;
}

const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString('base64url');
function decodeCursor(v: string): number {
  const m = /^o:(\d{1,6})$/.exec(Buffer.from(v, 'base64url').toString('utf8'));
  if (!m) throw new TaskError('That cursor isn’t one list_tasks gave out. Leave it out to start from the first page.', 'invalid');
  return +m[1];
}

/** Open first, in the backlog's order (priority, goal work before off-goal, due date); done ones newest first. */
const byListOrder = (goals: Goal[]) => {
  const byBacklog = byBacklogWith(goalRanker(goals));
  return (a: Task, b: Task) =>
    a.status !== b.status ? (a.status === 'open' ? -1 : 1)
      : a.status === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) || a.id.localeCompare(b.id)
        : byBacklog(a, b) || (a.start ?? Infinity) - (b.start ?? Infinity) || a.id.localeCompare(b.id);
};
const byStart = (a: Task, b: Task) => (a.start as number) - (b.start as number) || a.id.localeCompare(b.id);

export async function listTasks(c: Ctx, f: ListInput): Promise<ListOutput> {
  const { tasks, labels, byLabel, goals, byGoal } = await load(c);
  const status = f.status ?? 'open';
  const label = f.project === undefined ? undefined : f.project.trim().toLowerCase() === 'none' ? null : labelFor(labels, f.project);
  // A task on a goal that's achieved or dropped counts as off-goal, as in the app.
  const live = new Set(activeGoals(goals).map(g => g.id));
  const goal = f.goal === undefined ? undefined : goalFor(goals, f.goal)?.id ?? null;
  const goalOf = (t: Task) => (t.goal && live.has(t.goal) ? t.goal : null);
  const dueAfter = f.due_after ? dayOrThrow(f.due_after, 'due_after') : null;
  const dueBefore = f.due_before ? dayOrThrow(f.due_before, 'due_before') : null;
  const from = f.scheduled_after ? rangeEdge(f.scheduled_after, c.tz, 'from') : null;
  const to = f.scheduled_before ? rangeEdge(f.scheduled_before, c.tz, 'to') : null;
  const words = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const timed = from != null || to != null;

  const hits = tasks.filter(t =>
    (status === 'any' || t.status === status)
    && (f.include_events || !isEvent(t))
    && (label === undefined || (t.label ?? null) === label)
    && (goal === undefined || goalOf(t) === goal)
    && (!dueAfter || (t.due != null && t.due >= dueAfter))
    && (!dueBefore || (t.due != null && t.due <= dueBefore))
    && (!timed || (t.start != null && (from == null || t.start >= from) && (to == null || t.start < to)))
    && words.every(w => `${t.title}\n${t.notes}`.toLowerCase().includes(w)),
  ).sort(timed ? byStart : byListOrder(goals));

  const limit = Math.max(1, Math.min(100, Math.floor(f.limit ?? 25)));
  const offset = f.cursor ? decodeCursor(f.cursor) : 0;
  const page = hits.slice(offset, offset + limit);
  const now = clock(c);
  return {
    tasks: page.map(t => summary(t, byLabel, c.tz, byGoal)), total: hits.length,
    next_cursor: offset + limit < hits.length ? encodeCursor(offset + limit) : null,
    today: dayIn(now, c.tz), timezone: c.tz,
  };
}

export async function getTask(c: Ctx, id: string): Promise<TaskDetail> {
  const { tasks, byLabel, byGoal } = await load(c);
  return detail(c, find(tasks, id), byLabel, byGoal);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" on the wall clock in `tz`. */
const clockIn = (ms: number, tz: string) => isoIn(ms, tz).slice(11, 16);

/** Epoch ms of `day` at "HH:MM" in `tz`. */
const atClock = (day: string, hhmm: string, tz: string) =>
  fromWallClock(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), +hhmm.slice(0, 2), +hhmm.slice(3, 5), 0, tz);

/** A repeat as the tools take it, as the planner's rule; unreadable ones say why. `was` fills in a weekly or monthly one's day. */
function ruleOrThrow(v: RepeatInput, today: string, was?: Rule): Rule {
  const rule = toRule(v);
  if (!rule) throw new TaskError('A repeat needs freq: day, week or month.', 'invalid');
  if (v.until != null && rule.until == null) throw new TaskError(`repeat.until must be a date like 2026-12-31, not "${v.until}".`, 'invalid');
  // Every week on no day in particular keeps the day it's on (or today's); every month, its date.
  if (rule.freq === 'week' && !rule.days.length && !rule.per && was?.freq === 'week' && was.days.length) rule.days = was.days;
  if (rule.freq === 'month' && rule.monthDay == null && !rule.per && was?.freq === 'month' && was.monthDay != null) rule.monthDay = was.monthDay;
  if (rule.freq === 'week' && !rule.days.length && !rule.per) rule.days = [new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))).getUTCDay()];
  if (rule.freq === 'month' && rule.monthDay == null && !rule.per) rule.monthDay = +today.slice(8, 10);
  return rule;
}

function timeOrThrow(v: string | null | undefined): string | null | undefined {
  if (v == null) return v;
  if (!HHMM.test(v)) throw new TaskError(`repeat.time must be a time of day like 09:30, not "${v}".`, 'invalid');
  return v;
}

/**
 * Make a task a repeat's first one, as the app's editor does: its id becomes the repeat's for its day (its scheduled or
 * due day, or today), and the series takes its fields. With a time, each one goes on the calendar then, this one too.
 */
function startSeries(t: Task, v: RepeatInput, now: number, tz: string): { repeat: Repeat; task: Task } {
  const today = dayIn(now, tz);
  const own = t.start != null ? dayIn(t.start, tz) : t.due;
  const day = own && own > today ? own : today;
  const asked = timeOrThrow(v.time);
  const time = asked !== undefined ? asked : t.start != null ? clockIn(t.start, tz) : null;
  const rule = ruleOrThrow(v, day);
  const repeat = { ...startRepeat({ title: t.title, notes: t.notes, priority: t.priority, minutes: t.minutes, label: t.label ?? null, goal: t.goal ?? null, raw: t.raw, rule, time, from: day }, now), made: day };
  const start = t.start ?? (time ? atClock(day, time, tz) : null);
  return { repeat, task: { ...t, id: occurrenceId(repeat.id, day), start, updatedAt: now } };
}

/** A step's id on a chart, changed everywhere it's named: its arrows and where it was put. */
const renameStep = (p: Plan, from: string, to: string): Plan => {
  const name = (id: string) => (id === from ? to : id);
  const pos = p.pos && p.pos[from] ? (({ [from]: at, ...rest }) => ({ ...rest, [to]: at }))(p.pos) : p.pos;
  return { ...p, links: p.links.map(l => ({ ...l, from: name(l.from), to: name(l.to) })), ...(pos ? { pos } : {}) };
};

/** Save repeat changes first, so the task writes after them find the series as it now is. */
async function saveRepeats(c: Ctx, ops: RepeatOp[]) {
  if (!ops.length) return;
  const list = await repeatsOf(c);
  if (ops.some(o => o.kind === 'set' && !list.some(r => r.id === o.repeat.id)) && list.length >= MAX_REPEATS) {
    throw new TaskError(`There are already ${MAX_REPEATS} repeating tasks, the most there can be. Stop one first.`, 'invalid');
  }
  await c.repo.setSetting(REPEATS_KEY, applyOps(list, ops));
}

/**
 * How a task repeats, as the tools take it: change_goals' repeat, plus the time of day each one goes on the calendar
 * ("HH:MM" in the user's zone), or null for each to wait in the backlog, due its day.
 */
export interface RepeatInput {
  freq: string;
  every?: number;
  days?: string[];
  monthday?: number | null;
  until?: string | null;
  times?: number | null;
  per?: number | null;
  time?: string | null;
}

export interface CreateInput {
  title: string;
  description?: string;
  due?: string | null;
  priority?: PriorityName;
  project?: string | null;
  goal?: string | null;
  status?: Status;
  scheduled?: string | null;
  minutes?: number;
  /** Make it repeat. Its first one is this task; with scheduled, the series goes on the calendar at that time of day. */
  repeat?: RepeatInput;
}

export async function createTask(c: Ctx, v: CreateInput): Promise<TaskDetail> {
  const { labels, byLabel, goals, byGoal } = await load(c);
  const title = v.title.replace(/\s+/g, ' ').trim();
  if (!title) throw new TaskError('A task needs a title.', 'invalid');
  const now = clock(c);
  const done = v.status === 'done';
  const task: Task = {
    id: newId(), title: title.slice(0, 160), raw: '', notes: (v.description ?? '').trim(),
    priority: PRI[v.priority ?? 'important'], minutes: v.minutes ?? 30,
    start: v.scheduled ? whenOrThrow(v.scheduled, c.tz, 'scheduled') : null,
    due: v.due ? dayOrThrow(v.due, 'due') : null,
    status: done ? 'done' : 'open', created: now, order: now, doneAt: done ? now : null,
    label: labelFor(labels, v.project ?? null), updatedAt: now,
    ...onGoal(goalFor(goals, v.goal ?? null), v.project != null, goals),
  };
  if (!v.repeat) {
    const [saved] = await write(c, [{ before: null, after: task }]);
    return detail(c, saved, byLabel, byGoal);
  }
  if (done) throw new TaskError('A repeating task starts open: add it, then tick the first one off with complete_task.', 'invalid');
  const m = startSeries(task, v.repeat, now, c.tz);
  await saveRepeats(c, [{ kind: 'set', repeat: m.repeat }]);
  const [saved] = await write(c, [{ before: null, after: m.task }]);
  return detail(c, saved, byLabel, byGoal);
}

export interface UpdateInput {
  title?: string;
  description?: string;
  due?: string | null;
  priority?: PriorityName;
  project?: string | null;
  goal?: string | null;
  status?: Status;
  scheduled?: string | null;
  minutes?: number;
  /** Make it repeat, or change how its series repeats (and at what time); null stops the series. */
  repeat?: RepeatInput | null;
}

/** What Google keeps for an item it sends: change these in Google instead. */
const GOOGLE_OWNED = ['title', 'due', 'scheduled', 'minutes'] as const;

export async function updateTask(c: Ctx, id: string, v: UpdateInput): Promise<TaskDetail & { changed: boolean }> {
  if (id.startsWith('rep:')) return updateSeries(c, id.slice(4), v);
  const { tasks, labels, byLabel, goals, byGoal } = await load(c);
  const cur = find(tasks, id);
  const source = sourceOf(cur);
  const owned = GOOGLE_OWNED.filter(k => v[k] !== undefined);
  if (source && owned.length) {
    throw new TaskError(`"${cur.title}" comes from ${source === 'google_calendar' ? 'Google Calendar' : 'Google Tasks'}, so its ${owned.join(', ')} ${owned.length === 1 ? 'follows' : 'follow'} Google and would be put back on the next pull. You can change its priority, project, description or status here.`, 'read_only');
  }
  const now = clock(c);
  const next: Task = { ...cur };
  if (v.title !== undefined) {
    const title = v.title.replace(/\s+/g, ' ').trim();
    if (!title) throw new TaskError('A task needs a title.', 'invalid');
    next.title = title.slice(0, 160);
  }
  if (v.description !== undefined) next.notes = v.description.trim();
  if (v.priority !== undefined) next.priority = PRI[v.priority];
  if (v.project !== undefined) next.label = labelFor(labels, v.project);
  if (v.goal !== undefined) Object.assign(next, onGoal(goalFor(goals, v.goal), v.project !== undefined, goals));
  if (v.due !== undefined) next.due = v.due ? dayOrThrow(v.due, 'due') : null;
  if (v.scheduled !== undefined) next.start = v.scheduled ? whenOrThrow(v.scheduled, c.tz, 'scheduled') : null;
  if (v.minutes !== undefined) next.minutes = v.minutes;
  if (v.status !== undefined && v.status !== cur.status) {
    next.status = v.status;
    next.doneAt = v.status === 'done' ? now : null;
  }
  const keys = ['title', 'notes', 'priority', 'label', 'goal', 'due', 'start', 'minutes', 'status', 'doneAt'] as const;
  const same = keys.every(k => (next[k] ?? null) === (cur[k] ?? null));
  if (v.repeat !== undefined) {
    const o = occurrenceOf(cur.id);
    const series = o ? (await repeatsOf(c)).find(r => r.id === o.repeat) : undefined;
    if (series) {
      // Change or stop its series; this one changes as asked, as with the editor.
      const ops = seriesOps(series, v.repeat, now, c.tz);
      if (ops.length) {
        await saveRepeats(c, ops);
        const [saved] = await write(c, [{ before: cur, after: next }]);
        return { ...(await detail(c, saved, byLabel, byGoal)), changed: true };
      }
    } else if (v.repeat) {
      if (source) throw new TaskError(`"${cur.title}" comes from ${source === 'google_calendar' ? 'Google Calendar' : 'Google Tasks'}, so it can't repeat here. Make it repeat in Google.`, 'read_only');
      if (next.status === 'done') throw new TaskError('A done task can’t start repeating: reopen it first, or add a new repeating task.', 'invalid');
      if (o) throw new TaskError(`"${cur.title}" was one of a repeating task that has stopped. Add a new repeating task with create_task instead.`, 'invalid');
      // Its id becomes the repeat's, so it's written anew; on a goal, its arrows go to the series.
      const m = startSeries(next, v.repeat, now, c.tz);
      await saveRepeats(c, [{ kind: 'set', repeat: m.repeat }]);
      const g = cur.goal ? goals.find(x => x.id === cur.goal) : undefined;
      if (g?.plan && (g.plan.links.some(l => l.from === cur.id || l.to === cur.id) || g.plan.pos?.[cur.id])) {
        const node = repeatNode(m.repeat);
        await c.repo.setSetting(GOALS_KEY, goals.map(x => (x.id === g.id ? { ...x, plan: renameStep(planOf(x), cur.id, node), updatedAt: now } : x)));
      }
      const [saved] = await write(c, [{ before: cur, after: null }, { before: null, after: m.task }]);
      return { ...(await detail(c, saved, byLabel, byGoal)), changed: true };
    } else if (!o) {
      throw new TaskError(`"${cur.title}" doesn't repeat, so there's nothing to stop.`, 'invalid');
    }
  }
  if (same) return { ...(await detail(c, cur, byLabel, byGoal)), changed: false };
  const [saved] = await write(c, [{ before: cur, after: next }]);
  return { ...(await detail(c, saved, byLabel, byGoal)), changed: true };
}

/** What `repeat` does to a series: changes how (or when) it repeats, stops it with null, or nothing if it's the same. */
function seriesOps(r: Repeat, v: RepeatInput | null, now: number, tz: string): RepeatOp[] {
  if (v === null) return [{ kind: 'stop', id: r.id }];
  const rule = ruleOrThrow(v, dayIn(now, tz), r.rule);
  const asked = timeOrThrow(v.time);
  const time = asked !== undefined ? asked : r.time;
  if (JSON.stringify(rule) === JSON.stringify(r.rule) && time === r.time) return [];
  return [{ kind: 'set', repeat: { ...r, rule, time, updatedAt: now } }];
}

/**
 * Change a repeating task's whole series ("rep:<id>"), for when none of it is open: what each one is (title, notes,
 * priority, length, project) and how and when it repeats; repeat null stops it. Its open one, if any, follows.
 */
async function updateSeries(c: Ctx, rid: string, v: UpdateInput): Promise<TaskDetail & { changed: boolean }> {
  const { tasks, labels, byLabel, byGoal } = await load(c);
  const list = await repeatsOf(c);
  const r = list.find(x => x.id === rid);
  if (!r) throw new TaskError(`No repeating task has the id "rep:${rid}". get_task on one of its tasks shows its series.`, 'not_found');
  const wrong = (['status', 'scheduled', 'due', 'goal'] as const).filter(k => v[k] !== undefined);
  if (wrong.length) {
    throw new TaskError(`A series as a whole has no ${wrong.join(', ')}: ${wrong.includes('goal') ? 'move it to a goal with change_goals move_step; ' : ''}change one of its tasks by that task's own id, or how it repeats (and at what time) with repeat.`, 'invalid');
  }
  const now = clock(c);
  const next: Repeat = { ...r };
  if (v.title !== undefined) {
    const title = v.title.replace(/\s+/g, ' ').trim();
    if (!title) throw new TaskError('A task needs a title.', 'invalid');
    next.title = title.slice(0, 160);
  }
  if (v.description !== undefined) next.notes = v.description.trim();
  if (v.priority !== undefined) next.priority = PRI[v.priority];
  if (v.minutes !== undefined) next.minutes = v.minutes;
  if (v.project !== undefined) next.label = labelFor(labels, v.project);
  let ops: RepeatOp[] = [];
  if (v.repeat === null) ops = [{ kind: 'stop', id: r.id }];
  else {
    const how = v.repeat ? seriesOps(next, v.repeat, now, c.tz) : [];
    const after = how[0]?.kind === 'set' ? how[0].repeat : next;
    const fields = ['title', 'notes', 'priority', 'minutes', 'label', 'rule', 'time'] as const;
    if (fields.some(k => JSON.stringify(after[k] ?? null) !== JSON.stringify(r[k] ?? null))) ops = [{ kind: 'set', repeat: { ...after, updatedAt: now } }];
  }
  const open = tasks.filter(t => t.status === 'open' && occurrenceOf(t.id)?.repeat === r.id);
  const out = seriesDetail(ops[0]?.kind === 'set' ? ops[0].repeat : r, byLabel, byGoal, c.tz, ops[0]?.kind === 'stop');
  if (!ops.length) return { ...out, changed: false };
  await saveRepeats(c, ops);
  // Its open one follows what each one is.
  const set = ops[0].kind === 'set' ? ops[0].repeat : null;
  if (set) {
    const writes = open.map(t => ({ before: t, after: { ...t, title: set.title, notes: set.notes, priority: set.priority, minutes: set.minutes, label: set.label } }))
      .filter(x => (['title', 'notes', 'priority', 'minutes', 'label'] as const).some(k => (x.after[k] ?? null) !== (x.before[k] ?? null)));
    if (writes.length) await write(c, writes);
  }
  return { ...out, changed: true };
}

/** A series, described the way a task is: its id is "rep:<id>". */
function seriesDetail(r: Repeat, labels: Map<string, Label>, goals: Map<string, Goal>, tz: string, stopped: boolean): TaskDetail {
  return {
    id: `rep:${r.id}`, title: r.title, status: 'open', priority: PRI_NAME[r.priority] ?? 'important',
    project: (r.label && labels.get(r.label)?.name) || null, goal: (r.goal && goals.get(r.goal)?.title) || null,
    due: null, scheduled: null, minutes: r.minutes, updated: isoIn(r.updatedAt || r.created, tz), repeating: true,
    notes: r.notes, created: isoIn(r.created, tz), done_at: null,
    repeat: stopped ? `Stopped: ${describeRepeat(r)}` : describeRepeat(r), series: `rep:${r.id}`,
  };
}

export const completeTask = (c: Ctx, id: string) => updateTask(c, id, { status: 'done' });
export const reopenTask = (c: Ctx, id: string) => updateTask(c, id, { status: 'open' });

export async function deleteTask(c: Ctx, id: string): Promise<{ deleted: { id: string; title: string } }> {
  const { tasks } = await load(c);
  const cur = find(tasks, id);
  const source = sourceOf(cur);
  if (source) {
    throw new TaskError(`"${cur.title}" comes from ${source === 'google_calendar' ? 'Google Calendar' : 'Google Tasks'} and would come back on the next pull. Delete it in Google, or mark it done here with complete_task.`, 'read_only');
  }
  await write(c, [{ before: cur, after: null }]);
  return { deleted: { id: cur.id, title: cur.title } };
}

/* ---------- goals ---------- */

export interface GoalSummary {
  id: string;
  title: string;
  /** The section (label) it sits in, by name. */
  section: string | null;
  status: Goal['status'];
  /** Rank among the active top goals, 1 first; null for sub-goals and for achieved and dropped ones. */
  rank: number | null;
  /** The goal it's a sub-goal of, or null for a top goal. */
  parent: string | null;
  /** The key result of its parent it serves (an id in the parent's done_when), or null. */
  parent_kr: string | null;
  /** How far along it is, 0 to 1, from its key results and sub-goals; null with neither. */
  progress: number | null;
  /** YYYY-MM-DD to get it done by, or null. */
  by: string | null;
  /** What has to be true for it to count as done: its key results, depth first, each with the one it's under. */
  done_when: { id: string; text: string; done: boolean; under: string | null }[];
  open_tasks: number;
  done_tasks: number;
  /**
   * Its flow chart: every step (tasks on it, things it's waiting on, and its done-when lines as milestones) with its
   * state and what it needs first, the arrows between them, and the critical path.
   */
  flow: Pick<ReturnType<typeof toJson>, 'steps' | 'arrows' | 'critical_path'>;
}

/** Your repeats, or none on a database that doesn't hand them out. */
async function repeatsOf(c: Ctx): Promise<Repeat[]> {
  try { return normalizeRepeats(await c.repo.getSetting(REPEATS_KEY)); } catch { return []; }
}

/** How each goal is described: the same in list_goals, get_goal and change_goals. */
function goalSummarizer(goals: Goal[], tasks: Task[], byLabel: Map<string, Label>, repeats: Repeat[], now: number) {
  const tops = topGoals(goals);
  const index = new Map(goals.map(g => [g.id, g]));
  const mine = tasks.filter(t => !isEvent(t));
  const count = (id: string, status: Status) => mine.filter(t => t.goal === id && t.status === status).length;
  return (g: Goal): GoalSummary => ({
    id: g.id, title: g.title, section: (() => { const s = goalSection({ goal: g.id }, index); return (s && byLabel.get(s)?.name) || null; })(),
    status: g.status, rank: g.status === 'active' && !g.parent ? tops.indexOf(g) + 1 : null, by: g.by,
    parent: g.parent ?? null, parent_kr: g.parentKr ?? null,
    progress: (p => (p == null ? null : Math.round(p * 100) / 100))(goalProgress(g, goals)),
    done_when: flatResults(g.results).map(({ kr, parent }) => ({ id: kr.id, text: kr.text, done: resultDone(kr), under: parent })),
    open_tasks: count(g.id, 'open'), done_tasks: count(g.id, 'done'),
    flow: (({ steps, arrows, critical_path }) => ({ steps, arrows, critical_path }))(toJson(g, buildFlow(g, tasks, now, { goals, repeats }))),
  });
}

/** The user's goals, most important first; with include_closed, the achieved and dropped ones after them. */
export async function listGoals(c: Ctx, f: { include_closed?: boolean } = {}): Promise<{ goals: GoalSummary[]; off_goal_open_tasks: number }> {
  const { tasks, byLabel, goals } = await load(c);
  const now = clock(c);
  // A repeating task is one step on its goal's chart; without the repeats, each of its tasks is one.
  const repeats = await repeatsOf(c);
  const live = activeGoals(goals);
  // Each goal followed by its sub-goals.
  const tree = goalTree(goals, g => g.status === 'active').map(x => x.goal);
  const shown = f.include_closed ? [...tree, ...goals.filter(g => !tree.includes(g))] : tree;
  const describe = goalSummarizer(goals, tasks, byLabel, repeats, now);
  return {
    goals: shown.map(describe),
    off_goal_open_tasks: tasks.filter(t => !isEvent(t) && t.status === 'open' && !(t.goal && live.some(g => g.id === t.goal))).length,
  };
}

/** A goal by id or title, any status; unknown ones say which exist. */
function findGoal(goals: Goal[], v: string): Goal {
  const want = v.trim().replace(/^goal:/, '');
  const hit = goals.find(g => g.id === want) ?? goals.find(g => g.id === pickGoal(goals, want))
    ?? goals.find(g => g.title.toLowerCase() === want.toLowerCase());
  if (hit) return hit;
  const live = activeGoals(goals).map(g => `"${g.title}" (${g.id})`).join(', ') || 'none yet';
  throw new TaskError(`There's no goal "${v}". The user's goals: ${live}.`, 'not_found');
}

/** How many levels of charts get_goal can show: the goal's own, and one for each level of sub-goals under it. */
export const MAX_CHART_DEPTH = MAX_GOAL_DEPTH + 1;

export interface GoalDetail extends Omit<GoalSummary, 'flow'> {
  /** Its flow chart; with depth over 1, each sub-goal's step has that sub-goal's own chart inside it. */
  flow: TreeFlowJson;
  /** The chart as a Mermaid flowchart, to draw it. */
  mermaid: string;
  /** What happened to the chart lately, newest last. */
  history: { at: string; what: string }[];
}

/**
 * One goal in full: its summary and chart, the chart as Mermaid, and its recent history. With `depth` over 1, each
 * sub-goal on the chart comes with its own chart inside it, that many levels down, and the Mermaid has a subgraph for
 * each; 1 (the default) is the goal's own chart alone.
 */
export async function getGoal(c: Ctx, f: { goal: string; history?: number; depth?: number }): Promise<GoalDetail> {
  const { tasks, byLabel, goals } = await load(c);
  const now = clock(c);
  const repeats = await repeatsOf(c);
  const g = findGoal(goals, f.goal);
  let log: LogEntry[] = [];
  try { log = normalizeLog(await c.repo.getSetting(LOG_KEY)); } catch { /* a database from before 0011: no history to show */ }
  const keep = Math.max(0, Math.min(50, Math.floor(f.history ?? 15)));
  const mine = coalesce(log.filter(e => e.goal === g.id));
  const depth = Math.max(1, Math.min(MAX_CHART_DEPTH, Math.floor(f.depth ?? 1)));
  const base = goalSummarizer(goals, tasks, byLabel, repeats, now)(g);
  const tree = depth > 1 ? buildTree(g, tasks, now, { goals, repeats, depth }) : null;
  return {
    ...base,
    ...(tree ? { flow: treeJson(tree) } : {}),
    mermaid: tree ? toMermaidTree(tree) : toMermaid(g, buildFlow(g, tasks, now, { goals, repeats })),
    history: keep ? mine.slice(-keep).map(e => ({ at: isoIn(e.at, c.tz), what: describeEntry(e) })) : [],
  };
}

export interface DeleteGoalOutput {
  /** The goal deleted, and how many sub-goals went with it. */
  deleted: { id: string; title: string; sub_goals: number };
  /** What happened, one line each: what was deleted, and what became of its tasks and repeating tasks. */
  changed: string[];
  skipped: string[];
}

/**
 * Delete a goal and every goal under it, for good: change_goals' delete_goal, as its own tool. Its open tasks go
 * off-goal, or with with_tasks are deleted (never Google's) and its repeating tasks stop; done tasks stay.
 */
export async function deleteGoal(c: Ctx, f: { goal: string; with_tasks?: boolean }): Promise<DeleteGoalOutput> {
  const { goals } = await load(c);
  const g = findGoal(goals, f.goal);
  const subs = descendantsOf(goals, g.id).length;
  const out = await changeGoals(c, { ops: [{ op: 'delete_goal', goal: g.id, ...(f.with_tasks ? { with_tasks: true } : {}) }] });
  return { deleted: { id: g.id, title: g.title, sub_goals: subs }, changed: out.changed, skipped: out.skipped };
}

/* ---------- building goals and their charts ---------- */

/** Fields of an operation that name a goal or a step. */
const REF_FIELDS = ['goal', 'ref', 'from', 'to', 'under', 'parent', 'for_result', 'after', 'before', 'beside', 'holds'] as const;

/**
 * The chart builder's refs (lib/workflow.ts) as the ids list_goals and get_goal show: a task's id, a waiting step's
 * id, "kr:" and a key result's id (or "<goal id>/kr:<id>" where two goals share one), "rep:" and a repeat's id for a
 * repeating task, and a goal's id, with or without "goal:", for a sub-goal.
 */
export function refsFor(goals: Goal[], tasks: Task[], repeats: Repeat[]): WorkflowRefs {
  const refs: WorkflowRefs = { tasks: new Map(tasks.map(t => [t.id, t.id])), waits: new Map(), results: new Map(), series: new Map() };
  const seen = new Map<string, number>();
  for (const g of goals) {
    for (const w of planOf(g).waits) refs.waits.set(w.id, { goal: g.id, id: w.id });
    for (const { kr } of flatResults(g.results)) {
      refs.results.set(`${g.id}/kr:${kr.id}`, { goal: g.id, id: kr.id });
      seen.set(kr.id, (seen.get(kr.id) ?? 0) + 1);
    }
  }
  for (const g of goals) {
    for (const { kr } of flatResults(g.results)) {
      if (seen.get(kr.id) !== 1) continue;
      refs.results.set(`kr:${kr.id}`, { goal: g.id, id: kr.id });
      if (!refs.tasks.has(kr.id)) refs.results.set(kr.id, { goal: g.id, id: kr.id });
    }
  }
  for (const r of repeats) if (r.goal) refs.series.set(`rep:${r.id}`, { goal: r.goal, id: r.id });
  return refs;
}

export interface ChangeOutput {
  /** What changed, one line each. */
  changed: string[];
  /** What couldn't be done, and why. */
  skipped: string[];
  /** The goals this touched, as list_goals shows them, with the ids of anything new on their charts. */
  goals: GoalSummary[];
}

/**
 * What keeping the goals in shape (normalizeGoals) took out of a change: the chart builder checks its limits first, so
 * this should say nothing, but if it ever has to cut something, it's said rather than lost.
 */
export function cutByLimits(changed: Goal[], kept: Goal[]): string[] {
  const out: string[] = [];
  const byId = new Map(kept.map(g => [g.id, g]));
  for (const g of changed) {
    const k = byId.get(g.id);
    const q = `“${g.title}”`;
    if (!k) { out.push(`${q} couldn’t be kept: it’s past what the app holds.`); continue; }
    if ((k.parent ?? null) !== (g.parent ?? null)) out.push(`${q} couldn’t stay where it was put, so it’s ${k.parent ? `under “${byId.get(k.parent)?.title ?? k.parent}”` : 'a top goal'}.`);
    else if ((k.parentKr ?? null) !== (g.parentKr ?? null)) out.push(`${q} serves its parent as a whole: the key result it was put under isn’t there.`);
    if (k.status !== g.status) out.push(`${q} is ${k.status}: ${k.status === 'dropped' ? 'it was past the most top goals at once' : 'its parent is'}.`);
    const lost = flatResults(g.results).filter(x => !findResult(k.results, x.kr.id));
    if (lost.length) out.push(`${q} couldn’t keep ${lost.map(x => `“${x.kr.text}”`).join(', ')}: past how many key results a goal holds, or how deep.`);
    const a = planOf(g), b = planOf(k);
    if (b.waits.length < a.waits.length || b.links.length < a.links.length) out.push(`${q}’s chart couldn’t keep everything: past how many steps or arrows a chart holds.`);
  }
  return out;
}

const googleOwned = (t: Task | undefined) => !!t && (isEvent(t) || !!t.externalId?.startsWith('gtask:'));

/**
 * Change goals and their flow charts: the chart builder's operations (lib/workflow.ts), applied as the app applies
 * them. `goal` is the goal an operation without one means. Writes, in the app's order: goals, repeats, then tasks, and
 * the chart history.
 */
export async function changeGoals(c: Ctx, f: { ops: unknown[]; goal?: string }): Promise<ChangeOutput> {
  const { tasks, labels, byLabel, goals } = await load(c);
  const now = clock(c);
  const repeats = await repeatsOf(c);
  const focus = f.goal ? findGoal(goals, f.goal).id : null;
  // A step can be named the way list_goals shows it: a sub-goal as "goal:<id>".
  const raw = (Array.isArray(f.ops) ? f.ops : []).map(o => {
    const x = { ...(o && typeof o === 'object' ? o as Record<string, unknown> : {}) };
    for (const k of REF_FIELDS) if (typeof x[k] === 'string') x[k] = (x[k] as string).replace(/^goal:/, '');
    // "none" for no parent (a top goal), no key result in particular, the top of the key results, no section.
    for (const k of ['parent', 'for_result', 'under', 'section'] as const) if (typeof x[k] === 'string' && (x[k] as string).trim().toLowerCase() === 'none') x[k] = null;
    // Priorities as the other tools take them; a section by its name, as the app shows it.
    if (typeof x.priority === 'string' && x.priority in PRI) x.priority = PRI[x.priority as PriorityName];
    // Checked only where the operation uses it: anywhere else it's listed as a field it doesn't take.
    const takes = (k: keyof WorkflowOp) => (OP_FIELDS[x.op as WorkflowOpKind] ?? []).includes(k);
    if (typeof x.section === 'string' && takes('section')) x.section = labelFor(labels, x.section);
    // A deadline as create_task takes one.
    if (typeof x.due === 'string' && takes('due')) x.due = dayOrThrow(x.due, 'due');
    return x;
  });
  const ops = normalizeOps(raw);
  if (!ops.length) throw new TaskError('No operations to apply. Each needs an "op" the chart builder knows (add_goal, add_step, link…).', 'invalid');
  // Whatever an operation carries that it can't use, said up front: a field it doesn't take, a value it can't read.
  const skipped: string[] = raw.flatMap((x, i) => opIssues(x).map(m => `Operation ${i + 1}: ${m}`));
  const byId = new Map(tasks.map(t => [t.id, t]));
  // Google keeps a pulled item's title, length and very being: renaming or deleting it here would be undone by the next pull.
  const allowed = ops.filter((op: WorkflowOp) => {
    const t = op.ref ? byId.get(op.ref) : undefined;
    if (!googleOwned(t)) return true;
    if ((op.op === 'edit_step' && (op.title || op.minutes)) || (op.op === 'remove_step' && op.delete)) {
      skipped.push(`“${t?.title}” comes from Google, so its title, length and whether it exists follow Google. Change it there, or tick it off.`);
      return false;
    }
    return true;
  });
  const refs = refsFor(goals, tasks, repeats);
  const out = applyWorkflow(allowed, { goals, tasks, repeats, now, labels: new Map(labels.map(l => [l.id, l.name])) }, refs, { focus, ids: recordedIds() });

  const nextGoals = normalizeGoals(out.goals);
  skipped.push(...cutByLimits(out.goals, nextGoals));
  if (JSON.stringify(nextGoals) !== JSON.stringify(goals)) await c.repo.setSetting(GOALS_KEY, nextGoals);
  if (out.repeatOps.length) await c.repo.setSetting(REPEATS_KEY, applyOps(await repeatsOf(c), out.repeatOps));
  const changes: Change[] = [
    ...out.removes.flatMap(id => (byId.get(id) ? [{ before: byId.get(id) as Task, after: null }] : [])),
    ...out.writes.map(t => ({ before: byId.get(t.id) ?? null, after: t })),
  ];
  await write(c, changes, out.log);

  // The goals it touched: changed, or with a task added, moved or removed.
  const before = new Map(goals.map(g => [g.id, JSON.stringify(g)]));
  const touched = new Set(nextGoals.filter(g => before.get(g.id) !== JSON.stringify(g)).map(g => g.id));
  for (const ch of changes) for (const t of [ch.before, ch.after]) if (t?.goal) touched.add(t.goal);
  for (const op of out.repeatOps) {
    const r = op.kind === 'set' ? op.repeat : repeats.find(x => x.id === op.id);
    for (const gid of [r?.goal, repeats.find(x => x.id === r?.id)?.goal]) if (gid) touched.add(gid);
  }
  // Described as they are now, so the ids of anything new are there to build on.
  const describe = goalSummarizer(nextGoals, await c.repo.list(), byLabel, await repeatsOf(c), clock(c));
  return {
    changed: out.lines, skipped: [...skipped, ...out.skipped],
    goals: nextGoals.filter(g => touched.has(g.id)).slice(0, 6).map(describe),
  };
}
