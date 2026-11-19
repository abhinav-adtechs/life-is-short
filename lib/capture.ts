import type { ParsedItem, Priority, Task } from './model';
import { PRI, newId as defaultNewId } from './model';
import { pickLabel, type Label } from './labels';
import { pickGoal, type Goal } from './goals';
import { cleanItem, placeItem, type WorkHours } from './place';
import { localParse } from './parse';
import { describeRepeat, placeFirst, sameRule, toRule, type Repeat, type Rule } from './repeat';
import type { PromptTask } from './prompt';
import { byBacklog } from './select';
import { dueLabel, fmtWhen } from './format';
import { pad, ymd } from './time';

/** Why the keyword parser was used instead of the model. */
export type Via = 'ai' | 'no-key' | 'ai-error' | 'empty';

/** The model's answer. `heard` is what it took a dictation to mean; `learn` is checked by lib/voice.ts before use. */
export interface AiResult { add: unknown[]; update: unknown[]; reply?: string; heard?: string; learn?: unknown; workflow?: unknown[] }

const hhmm = (ms: number) => `${ymd(ms)} ${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/**
 * The open tasks the model gets to see, with short refs (T1, T2…) so it can update instead of duplicating.
 * A repeating one says how it repeats, so the model can change that or stop it.
 */
export function promptContext(
  tasks: Task[], labelOf: (t: Task) => string | null = t => t.label ?? null, repeatOf: (t: Task) => Repeat | null = () => null,
  goalOf: (t: Task) => string | null = t => t.goal ?? null,
) {
  const open = tasks.filter(t => t.status === 'open')
    .sort((a, b) => ((a.start ?? 9e15) - (b.start ?? 9e15)) || byBacklog(a, b)).slice(0, 120);
  const refs = new Map(open.map((t, i) => ['T' + (i + 1), t.id]));
  const ctx: PromptTask[] = open.map((t, i) => {
    const r = repeatOf(t);
    return {
      ref: 'T' + (i + 1), title: t.title, priority: t.priority,
      start: t.start != null ? hhmm(t.start) : null, due: t.due, label: labelOf(t), goal: goalOf(t),
      ...(r ? { repeats: describeRepeat(r) } : {}),
    };
  });
  return { refs, ctx };
}

export interface CaptureOutcome {
  /** Tasks to write (new or changed). */
  puts: Task[];
  /** Tasks that repeat from now on, by id, with their rule; null for one that stops repeating. */
  repeats: Map<string, Rule | null>;
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
  /** Your goals: a task the model puts on an active one takes its id and its section. */
  goals?: Goal[];
  /** The model's answer replaces a draft, so an empty answer means drop everything rather than fall back to keywords. */
  revise?: boolean;
  /** How a task repeats, for one of a repeat's: only those can stop repeating. */
  ruleOf?: (id: string) => Rule | null;
}): CaptureOutcome {
  const now = args.now ?? Date.now();
  const makeId = args.newId ?? defaultNewId;
  const labels = args.labels ?? [];
  const goals = args.goals ?? [];
  /** A goal, and its section as the label when it has one. */
  const onGoal = (id: string): Partial<Task> => {
    const g = goals.find(x => x.id === id);
    return { goal: id, ...(g?.section ? { label: g.section } : {}) };
  };
  const { text } = args;
  const raw = text.slice(0, 600);
  let via = args.via;
  let adds: unknown[];
  let updates: unknown[];
  if (args.result && (args.revise || args.result.add.length || args.result.update.length)) {
    adds = args.result.add; updates = args.result.update;
  } else {
    adds = localParse(text, now, labels, goals); updates = [];
    if (via === 'ai') via = 'empty';
  }

  const byId = new Map(args.tasks.map(t => [t.id, t]));
  const before = new Map<string, Task | null>();
  const puts = new Map<string, Task>();
  const repeats = new Map<string, Rule | null>();
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
    if (u.goal === 'none' && cur.goal) patch.goal = null;
    else {
      const goal = pickGoal(goals, u.goal);
      if (goal && goal !== cur.goal) Object.assign(patch, onGoal(goal));
    }
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
    // A pulled Google item keeps Google's id, so it can't become a repeat's.
    const rule = cur.externalId ? null : toRule(u.repeat), had = args.ruleOf?.(tid) ?? null;
    if (rule && !sameRule(rule, had)) repeats.set(tid, rule);
    else if (u.stop_repeat === true && had) repeats.set(tid, null);
    if (!Object.keys(patch).length && !repeats.has(tid)) continue;
    if (u.done === true) ticked++; else updated++;
    if (!before.has(tid)) before.set(tid, byId.get(tid) || null);
    puts.set(tid, { ...cur, ...patch, updatedAt: now });
  }

  const added: Task[] = [];
  adds.slice(0, 25).forEach((item, i) => {
    const c: ParsedItem = cleanItem(item, text);
    const id = makeId();
    // A repeat starts on its first day: on the calendar at its time, else in the backlog, due then.
    const pl = c.repeat ? placeFirst(c.repeat, c, now) : placeItem(c, current(), now, args.hours);
    if (c.repeat) repeats.set(id, c.repeat);
    const goal = pickGoal(goals, c.goal);
    const task: Task = {
      id, title: c.title, raw, notes: c.notes, priority: c.priority, minutes: c.minutes,
      start: pl.start, due: pl.due, status: 'open', created: now, order: now + i, doneAt: null, updatedAt: now,
      label: pickLabel(labels, c.label), goal: null,
      ...(goal ? onGoal(goal) : {}),
    };
    before.set(id, null);
    puts.set(id, task);
    added.push(task);
  });

  return {
    puts: [...puts.values()], repeats, before, added, updated, ticked, via,
    summary: summarize({ added, updated, ticked, via, now, labels, goals }),
  };
}

export const NOTHING = 'Nothing to add from that';

/** "On the calendar · Tomorrow, 11:00 AM", "3 added: 1 on the calendar, 2 in the backlog · 1 ticked off". */
export function summarize(r: { added: Task[]; updated: number; ticked: number; via?: Via; now?: number; labels?: Label[]; goals?: Goal[] }): string {
  const now = r.now ?? Date.now();
  const { added, updated, ticked, via, labels = [], goals = [] } = r;
  const parts: string[] = [];
  const n = added.length, onCal = added.filter(t => t.start != null).length;
  if (n === 1) {
    const t = added[0];
    const label = labels.find(l => l.id === t.label);
    const goal = goals.find(g => g.id === t.goal);
    const where = goal ? `${goal.title} · ` : label ? `${label.name} · ` : '';
    parts.push(t.start != null
      ? `On the calendar · ${where}${fmtWhen(t.start, now)}`
      : `In the backlog · ${where}${PRI[t.priority]}${t.due ? ' · ' + dueLabel(t.due, now).text.toLowerCase() : ''}`);
  } else if (n) {
    const onGoal = goals.length ? added.filter(t => t.goal).length : 0;
    parts.push(`${n} added: ${onCal} on the calendar, ${n - onCal} in the backlog${onGoal ? `, ${onGoal === n ? 'all' : onGoal} on goals` : ''}`);
  }
  if (updated) parts.push(`${updated} updated`);
  if (ticked) parts.push(`${ticked} ticked off`);
  if (via === 'no-key') parts.push('sorted by keywords (no AI key)');
  else if (via === 'ai-error') parts.push('sorted by keywords (AI unavailable)');
  else if (via === 'empty') parts.push('sorted by keywords');
  return parts.join(' · ') || NOTHING;
}
