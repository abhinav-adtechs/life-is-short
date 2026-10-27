import type { ParsedItem, Priority, Task } from './model';
import { PRI, newId as defaultNewId } from './model';
import { pickLabel, type Label } from './labels';
import { cleanItem, placeItem, type WorkHours } from './place';
import { localParse } from './parse';
import type { PromptTask } from './prompt';
import { byBacklog } from './select';
import { dueLabel, fmtWhen } from './format';
import { pad, ymd } from './time';

/** Why the keyword parser was used instead of the model. */
export type Via = 'ai' | 'no-key' | 'ai-error' | 'empty';

export interface AiResult { add: unknown[]; update: unknown[] }

const hhmm = (ms: number) => `${ymd(ms)} ${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** The open tasks the model gets to see, with short refs (T1, T2…) so it can update instead of duplicating. */
export function promptContext(tasks: Task[], labelOf: (t: Task) => string | null = t => t.label ?? null) {
  const open = tasks.filter(t => t.status === 'open')
    .sort((a, b) => ((a.start ?? 9e15) - (b.start ?? 9e15)) || byBacklog(a, b)).slice(0, 120);
  const refs = new Map(open.map((t, i) => ['T' + (i + 1), t.id]));
  const ctx: PromptTask[] = open.map((t, i) => ({
    ref: 'T' + (i + 1), title: t.title, priority: t.priority,
    start: t.start != null ? hhmm(t.start) : null, due: t.due, label: labelOf(t),
  }));
  return { refs, ctx };
}

export interface CaptureOutcome {
  /** Tasks to write (new or changed). */
  puts: Task[];
  /** Previous state of every touched id: the task, or null if it was new. Restoring these is Undo. */
  before: Map<string, Task | null>;
  added: Task[];
  updated: number;
  ticked: number;
  via: Via;
  summary: string;
}

/**
 * Apply a dump: the model's {add, update} when it gave something usable, otherwise the keyword parser.
 * Pure: returns the writes and an undo map, the caller does the storing.
 */
export function applyCapture(args: {
  text: string;
  tasks: Task[];
  refs: Map<string, string>;
  result: AiResult | null;
  via: Via;
  now?: number;
  newId?: () => string;
  hours?: WorkHours;
  labels?: Label[];
}): CaptureOutcome {
  const now = args.now ?? Date.now();
  const makeId = args.newId ?? defaultNewId;
  const labels = args.labels ?? [];
  const { text } = args;
  const raw = text.slice(0, 600);
  let via = args.via;
  let adds: unknown[];
  let updates: unknown[];
  if (args.result && (args.result.add.length || args.result.update.length)) {
    adds = args.result.add; updates = args.result.update;
  } else {
    adds = localParse(text, now, labels); updates = [];
    if (via === 'ai') via = 'empty';
  }

  const byId = new Map(args.tasks.map(t => [t.id, t]));
  const before = new Map<string, Task | null>();
  const puts = new Map<string, Task>();
  const current = () => args.tasks.map(t => puts.get(t.id) || t).concat([...puts.values()].filter(t => !byId.has(t.id)));
  let updated = 0, ticked = 0;

  for (const raw of updates.slice(0, 40)) {
    const u = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const tid = args.refs.get(String(u.ref || '').trim().toUpperCase());
    const cur = tid ? (puts.get(tid) || byId.get(tid)) : undefined;
    if (!tid || !cur) continue;
    const patch: Partial<Task> = {};
    if (typeof u.title === 'string' && u.title.trim()) patch.title = u.title.replace(/\s+/g, ' ').trim().slice(0, 160);
    if ([1, 2, 3].includes(Number(u.priority))) patch.priority = Number(u.priority) as Priority;
    if (Number(u.minutes) > 0) patch.minutes = Math.min(480, Math.max(15, Math.round(Number(u.minutes) / 15) * 15));
    if (typeof u.notes === 'string' && u.notes.trim() && !(cur.notes || '').includes(u.notes.trim())) {
      patch.notes = [cur.notes, u.notes.trim()].filter(Boolean).join('\n').slice(0, 2000);
    }
    const label = pickLabel(labels, u.label);
    if (label && label !== cur.label) patch.label = label;
    if (u.unschedule === true) patch.start = null;
    if (u.date || u.time) {
      const c = {
        minutes: patch.minutes || cur.minutes,
        date: typeof u.date === 'string' ? u.date : null,
        time: typeof u.time === 'string' ? u.time : null,
        deadline: u.deadline === true,
      };
      const pl = placeItem(c, current().filter(t => t.id !== tid), now, args.hours);
      if (c.deadline) patch.due = pl.due;
      else if (pl.start != null) patch.start = pl.start;
      else if (pl.due) patch.due = pl.due;
    }
    if (u.done === true) { patch.status = 'done'; patch.doneAt = now; }
    if (!Object.keys(patch).length) continue;
    if (u.done === true) ticked++; else updated++;
    if (!before.has(tid)) before.set(tid, byId.get(tid) || null);
    puts.set(tid, { ...cur, ...patch, updatedAt: now });
  }

  const added: Task[] = [];
  adds.slice(0, 25).forEach((item, i) => {
    const c: ParsedItem = cleanItem(item, text);
    const id = makeId();
    const pl = placeItem(c, current(), now, args.hours);
    const task: Task = {
      id, title: c.title, raw, notes: c.notes, priority: c.priority, minutes: c.minutes,
      start: pl.start, due: pl.due, status: 'open', created: now, order: now + i, doneAt: null, updatedAt: now,
      label: pickLabel(labels, c.label),
    };
    before.set(id, null);
    puts.set(id, task);
    added.push(task);
  });

  const parts: string[] = [];
  const n = added.length, onCal = added.filter(t => t.start != null).length;
  if (n === 1) {
    const t = added[0];
    const label = labels.find(l => l.id === t.label);
    parts.push(t.start != null
      ? `On the calendar · ${label ? label.name + ' · ' : ''}${fmtWhen(t.start, now)}`
      : `In the backlog · ${label ? label.name + ' · ' : ''}${PRI[t.priority]}${t.due ? ' · ' + dueLabel(t.due, now).text.toLowerCase() : ''}`);
  } else if (n) parts.push(`${n} added: ${onCal} on the calendar, ${n - onCal} in the backlog`);
  if (updated) parts.push(`${updated} updated`);
  if (ticked) parts.push(`${ticked} ticked off`);
  if (via === 'no-key') parts.push('sorted by keywords (no AI key)');
  else if (via === 'ai-error') parts.push('sorted by keywords (AI unavailable)');
  else if (via === 'empty') parts.push('sorted by keywords');

  return {
    puts: [...puts.values()], before, added, updated, ticked, via,
    summary: parts.join(' · ') || 'Nothing to add from that',
  };
}
