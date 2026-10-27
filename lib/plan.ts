import type { Task } from './model';
import type { CaptureOutcome } from './capture';
import type { Label } from './labels';
import { summarize } from './capture';
import { pad, ymd } from './time';

/**
 * One change the assistant proposes: a new task (no `before`) or a change to one you have.
 * Nothing is written until you accept; until then you can edit `after` or leave the change out.
 */
export interface Change {
  /** The task's id: a fresh one for a new task. */
  id: string;
  before: Task | null;
  after: Task;
  /** Left out of this plan: not written on accept, and dropped from the draft the model revises. */
  skip?: boolean;
}

export type ChangeKind = 'add' | 'done' | 'move' | 'edit';

const FIELDS = ['title', 'priority', 'minutes', 'start', 'due', 'notes', 'label', 'status', 'doneAt'] as const;
type Field = typeof FIELDS[number];

/** Fields an edit changes, in a stable order. */
export const changedFields = (before: Task, after: Task): Field[] => FIELDS.filter(k => (before[k] ?? null) !== (after[k] ?? null));

/** What a change does, for its label: a new task, a tick, a new time, or anything else. */
export function kindOf(c: Pick<Change, 'before' | 'after'>): ChangeKind {
  if (!c.before) return 'add';
  if (c.after.status === 'done' && c.before.status !== 'done') return 'done';
  return changedFields(c.before, c.after).includes('start') ? 'move' : 'edit';
}

/** Just the fields an edit changes, to lay over whatever the task is by the time you accept. */
export function patchOf(c: Pick<Change, 'before' | 'after'>): Partial<Task> {
  if (!c.before) return c.after;
  const out: Partial<Task> = {};
  for (const k of changedFields(c.before, c.after)) (out as Record<string, unknown>)[k] = c.after[k];
  return out;
}

/** A capture's writes as a plan: new tasks first, in the order said, then changes to tasks you have. */
export function changesOf(out: Pick<CaptureOutcome, 'puts' | 'before'>): Change[] {
  const list = out.puts.map(t => ({ id: t.id, before: out.before.get(t.id) ?? null, after: t }));
  return [...list.filter(c => !c.before), ...list.filter(c => c.before)];
}

const hhmm = (ms: number) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** When, in the prompt's terms: a start is a day and time, a due date alone is a deadline. */
function when(t: Pick<Task, 'start' | 'due'>) {
  if (t.start != null) return { date: ymd(t.start), time: hhmm(t.start), deadline: false };
  if (t.due) return { date: t.due, time: null, deadline: true };
  return { date: null, time: null, deadline: false };
}

/**
 * The plan as the {add, update} the model answers with, so it can revise it. Updates name tasks by the prompt's refs;
 * a change to a task the prompt doesn't list is left out, since the model couldn't name it back.
 */
export function draftOf(changes: Change[], refOf: Map<string, string>): { add: unknown[]; update: unknown[] } {
  const add: unknown[] = [], update: unknown[] = [];
  for (const c of changes) {
    if (c.skip) continue;
    const a = c.after;
    if (!c.before) {
      add.push({ title: a.title, priority: a.priority, minutes: a.minutes, ...when(a), notes: a.notes, label: a.label ?? null });
      continue;
    }
    const ref = refOf.get(c.id);
    if (!ref) continue;
    const b = c.before;
    const u: Record<string, unknown> = { ref };
    const f = changedFields(b, a);
    if (f.includes('title')) u.title = a.title;
    if (f.includes('priority')) u.priority = a.priority;
    if (f.includes('minutes')) u.minutes = a.minutes;
    if (f.includes('label') && a.label) u.label = a.label;
    if (f.includes('start') && a.start == null) u.unschedule = true;
    else if (f.includes('start') || f.includes('due')) Object.assign(u, when(a));
    // Notes from the model are added to what's there, so send only the new part.
    if (f.includes('notes') && a.notes) u.notes = b.notes && a.notes.startsWith(b.notes) ? a.notes.slice(b.notes.length).trim() : a.notes;
    if (a.status === 'done' && b.status !== 'done') u.done = true;
    if (Object.keys(u).length > 1) update.push(u);
  }
  return { add, update };
}

/**
 * The writes for an accepted plan. A change to an existing task lays only its changed fields over the task as it is now,
 * so an edit made elsewhere in the meantime survives; a task deleted meanwhile is left alone.
 */
export function commitChanges(
  changes: Change[], current: (id: string) => Task | undefined, now = Date.now(), labels: Label[] = [],
): { puts: Task[]; summary: string } {
  const puts: Task[] = [];
  const added: Task[] = [];
  let updated = 0, ticked = 0;
  for (const c of changes) {
    if (c.skip) continue;
    if (!c.before) {
      const t = { ...c.after, updatedAt: now };
      puts.push(t);
      added.push(t);
      continue;
    }
    const cur = current(c.id);
    const patch = patchOf(c);
    if (!cur || !Object.keys(patch).length) continue;
    if (patch.status === 'done') patch.doneAt = now;
    puts.push({ ...cur, ...patch, updatedAt: now });
    if (kindOf(c) === 'done') ticked++; else updated++;
  }
  return { puts, summary: summarize({ added, updated, ticked, now, labels }) };
}
