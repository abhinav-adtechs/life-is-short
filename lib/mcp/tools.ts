import { newId, type Priority, type Task } from '../model';
import type { TaskRepo } from '../repo/types';
import { byBacklog, isEvent } from '../select';
import { normalizeLabels, pickLabel, type Label } from '../labels';
import { REPEATS_KEY, applyOps, describeRepeat, followTask, normalizeRepeats, occurrenceOf, type RepeatOp } from '../repeat';
import { SLIPS_KEY, mergeSlips, normalizeSlips, slipsFrom, type Change } from '../slips';
import { dayIn, dayStart, isoIn, nextDay, parseWhen, validDay } from './when';

/*
 * What the MCP tools do (lib/server/mcp/server.ts), over the same TaskRepo the planner writes through
 * (lib/repo/types.ts). Writes follow the planner's rules (components/store.ts and Planner.tsx): each one is stamped
 * newer than what it replaces so open screens take it, a missed slot moved or deleted is noted for the review, and an
 * edit to a repeat's open task carries on to the ones to come.
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

async function load(c: Ctx) {
  const [tasks, labels] = await Promise.all([c.repo.list(), labelsOf(c)]);
  return { tasks, labels, byLabel: new Map(labels.map(l => [l.id, l])) };
}

const sourceOf = (t: Task): TaskSummary['source'] =>
  isEvent(t) ? 'google_calendar' : t.externalId?.startsWith('gtask:') ? 'google_tasks' : undefined;

export function summary(t: Task, labels: Map<string, Label>, tz: string): TaskSummary {
  const out: TaskSummary = {
    id: t.id, title: t.title, status: t.status, priority: PRI_NAME[t.priority] ?? 'important',
    project: (t.label && labels.get(t.label)?.name) || null, due: t.due, scheduled: t.start == null ? null : isoIn(t.start, tz),
    minutes: t.minutes, updated: isoIn(t.updatedAt || t.created, tz),
  };
  const source = sourceOf(t);
  if (source) out.source = source;
  if (occurrenceOf(t.id)) out.repeating = true;
  return out;
}

async function detail(c: Ctx, t: Task, labels: Map<string, Label>): Promise<TaskDetail> {
  const out: TaskDetail = {
    ...summary(t, labels, c.tz), notes: t.notes || '', created: isoIn(t.created, c.tz), done_at: t.doneAt == null ? null : isoIn(t.doneAt, c.tz),
  };
  if (t.raw && t.raw !== t.title) out.original_text = t.raw;
  const o = occurrenceOf(t.id);
  if (o) {
    const r = normalizeRepeats(await c.repo.getSetting(REPEATS_KEY)).find(x => x.id === o.repeat);
    if (r) out.repeat = describeRepeat(r);
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
async function write(c: Ctx, changes: Change[]): Promise<Task[]> {
  const now = clock(c);
  const stamped: Change[] = changes.map(({ before, after }) => ({
    before, after: after && { ...after, updatedAt: Math.max(now, (before?.updatedAt || 0) + 1) },
  }));
  const puts = stamped.flatMap(x => (x.after ? [x.after] : []));
  const gone = stamped.flatMap(x => (!x.after && x.before ? [x.before.id] : []));
  if (puts.length) await c.repo.put(puts);
  if (gone.length) await c.repo.remove(gone);
  // The write is in; the bookkeeping is best effort, as on a device that's offline.
  await Promise.all([noteSlips(c, stamped, now), followRepeats(c, puts, now)]).catch(e => {
    console.warn('mcp: saved, but could not update slips or repeats:', e instanceof Error ? e.message : e);
  });
  return puts;
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

/** Open first, in the backlog's order (priority, then due date); done ones newest first. */
const byListOrder = (a: Task, b: Task) =>
  a.status !== b.status ? (a.status === 'open' ? -1 : 1)
    : a.status === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) || a.id.localeCompare(b.id)
      : byBacklog(a, b) || (a.start ?? Infinity) - (b.start ?? Infinity) || a.id.localeCompare(b.id);
const byStart = (a: Task, b: Task) => (a.start as number) - (b.start as number) || a.id.localeCompare(b.id);

export async function listTasks(c: Ctx, f: ListInput): Promise<ListOutput> {
  const { tasks, labels, byLabel } = await load(c);
  const status = f.status ?? 'open';
  const label = f.project === undefined ? undefined : f.project.trim().toLowerCase() === 'none' ? null : labelFor(labels, f.project);
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
    && (!dueAfter || (t.due != null && t.due >= dueAfter))
    && (!dueBefore || (t.due != null && t.due <= dueBefore))
    && (!timed || (t.start != null && (from == null || t.start >= from) && (to == null || t.start < to)))
    && words.every(w => `${t.title}\n${t.notes}`.toLowerCase().includes(w)),
  ).sort(timed ? byStart : byListOrder);

  const limit = Math.max(1, Math.min(100, Math.floor(f.limit ?? 25)));
  const offset = f.cursor ? decodeCursor(f.cursor) : 0;
  const page = hits.slice(offset, offset + limit);
  const now = clock(c);
  return {
    tasks: page.map(t => summary(t, byLabel, c.tz)), total: hits.length,
    next_cursor: offset + limit < hits.length ? encodeCursor(offset + limit) : null,
    today: dayIn(now, c.tz), timezone: c.tz,
  };
}

export async function getTask(c: Ctx, id: string): Promise<TaskDetail> {
  const { tasks, byLabel } = await load(c);
  return detail(c, find(tasks, id), byLabel);
}

export interface CreateInput {
  title: string;
  description?: string;
  due?: string | null;
  priority?: PriorityName;
  project?: string | null;
  status?: Status;
  scheduled?: string | null;
  minutes?: number;
}

export async function createTask(c: Ctx, v: CreateInput): Promise<TaskDetail> {
  const { labels, byLabel } = await load(c);
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
  };
  const [saved] = await write(c, [{ before: null, after: task }]);
  return detail(c, saved, byLabel);
}

export interface UpdateInput {
  title?: string;
  description?: string;
  due?: string | null;
  priority?: PriorityName;
  project?: string | null;
  status?: Status;
  scheduled?: string | null;
  minutes?: number;
}

/** What Google keeps for an item it sends: change these in Google instead. */
const GOOGLE_OWNED = ['title', 'due', 'scheduled', 'minutes'] as const;

export async function updateTask(c: Ctx, id: string, v: UpdateInput): Promise<TaskDetail & { changed: boolean }> {
  const { tasks, labels, byLabel } = await load(c);
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
  if (v.due !== undefined) next.due = v.due ? dayOrThrow(v.due, 'due') : null;
  if (v.scheduled !== undefined) next.start = v.scheduled ? whenOrThrow(v.scheduled, c.tz, 'scheduled') : null;
  if (v.minutes !== undefined) next.minutes = v.minutes;
  if (v.status !== undefined && v.status !== cur.status) {
    next.status = v.status;
    next.doneAt = v.status === 'done' ? now : null;
  }
  const keys = ['title', 'notes', 'priority', 'label', 'due', 'start', 'minutes', 'status', 'doneAt'] as const;
  if (keys.every(k => (next[k] ?? null) === (cur[k] ?? null))) return { ...(await detail(c, cur, byLabel)), changed: false };
  const [saved] = await write(c, [{ before: cur, after: next }]);
  return { ...(await detail(c, saved, byLabel)), changed: true };
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
