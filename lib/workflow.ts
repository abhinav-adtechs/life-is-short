import type { Priority, Task } from './model';
import { newId } from './model';
import {
  MAX_ACTIVE, addGoal, addResult, findResult, flatResults, goalTree, makeGoal, newGoalId, newResultId, patchGoal, patchResult, rootOf, setGoalStatus,
  type Goal,
} from './goals';
import {
  goalNode, krNode, newWaitId, parallelLinks, patchWait, planOf, repeatNode, withLink, withWait, withoutLink, withoutStep, wouldLoop,
  type LogEntry, type Plan,
} from './flow';
import { describeRule, newRepeatId, occurrence, occurrenceOf, occursOn, repeatsDone, startRepeat, toRule, type Repeat, type RepeatOp } from './repeat';
import { ymd } from './time';

/*
 * Changing your goals and their charts by saying so: "after the lawyer call, get the board's approval; signing waits
 * on it", "add a key result: money in the bank", "make the exit a sub-goal's worth of steps".
 *
 * The model sees your goals as a tree, each with its key results, waiting steps, repeating tasks and arrows, every
 * step with a short ref (T1 for a task, W1 for something you're waiting on, R1 for a key result, S1 for a repeating
 * task, a goal's id for a sub-goal), and answers with a list of operations. They're checked and applied here, as one
 * change you can undo; one that doesn't make sense (a ref it made up, an arrow that would loop) is left out and said so.
 */

export type WorkflowOpKind =
  | 'add_goal' | 'edit_goal' | 'add_result' | 'edit_result' | 'remove_result'
  | 'add_step' | 'add_wait' | 'link' | 'unlink' | 'edit_step' | 'remove_step' | 'move_step';
const KINDS: WorkflowOpKind[] = ['add_goal', 'edit_goal', 'add_result', 'edit_result', 'remove_result', 'add_step', 'add_wait', 'link', 'unlink', 'edit_step', 'remove_step', 'move_step'];

/** One change, as the model gives it. Which fields count depends on `op` (see the prompt). */
export interface WorkflowOp {
  op: WorkflowOpKind;
  goal?: string; ref?: string; from?: string; to?: string; title?: string; text?: string; under?: string; parent?: string;
  for_result?: string; results?: string[]; by?: string | null; section?: string; key?: string;
  after?: string; before?: string; beside?: string; holds?: string; minutes?: number; priority?: Priority; done?: boolean;
  delete?: boolean; status?: 'active' | 'achieved' | 'dropped'; repeat?: unknown;
}

/** What the refs in the prompt stand for. */
export interface WorkflowRefs {
  /** T1… → task id. */
  tasks: Map<string, string>;
  /** W1… → a waiting step; R1… → a key result; S1… → a repeating task's series: the goal it's on, and its id. */
  waits: Map<string, { goal: string; id: string }>;
  results: Map<string, { goal: string; id: string }>;
  series: Map<string, { goal: string; id: string }>;
}

export const MAX_OPS = 40;
const str = (v: unknown, max = 160) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The model's operations, cleaned up: known kinds, strings where strings go, at most MAX_OPS. */
export function normalizeOps(raw: unknown): WorkflowOp[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowOp[] = [];
  for (const x of raw.slice(0, MAX_OPS)) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (!KINDS.includes(o.op as WorkflowOpKind)) continue;
    const op: WorkflowOp = { op: o.op as WorkflowOpKind };
    for (const k of ['goal', 'ref', 'from', 'to', 'title', 'text', 'under', 'parent', 'for_result', 'section', 'key', 'after', 'before', 'beside', 'holds'] as const) {
      const v = str(o[k]);
      if (v) op[k] = v;
    }
    if (Array.isArray(o.results)) op.results = o.results.map(r => str(r, 120)).filter((r): r is string => !!r).slice(0, 8);
    if (typeof o.by === 'string' && DAY.test(o.by)) op.by = o.by;
    else if (o.by === null) op.by = null;
    const m = Math.round(Number(o.minutes));
    if (Number.isFinite(m) && m > 0) op.minutes = Math.min(480, Math.max(15, Math.round(m / 15) * 15));
    if (o.priority === 1 || o.priority === 2 || o.priority === 3) op.priority = o.priority;
    if (typeof o.done === 'boolean') op.done = o.done;
    if (o.delete === true) op.delete = true;
    if (o.status === 'active' || o.status === 'achieved' || o.status === 'dropped') op.status = o.status;
    if (o.repeat && typeof o.repeat === 'object') op.repeat = o.repeat;
    out.push(op);
  }
  return out;
}

/* ---------- what the model sees ---------- */

const q = (s: string) => `"${s.replace(/\s+/g, ' ').replace(/"/g, "'").slice(0, 100)}"`;

/**
 * Your active goals as the model sees them, parents first: each with its key results, waiting steps, repeating tasks,
 * the tasks on it (by their refs from the task list) and its arrows. `taskRefs` are the task list's refs (T1…).
 */
export function chartsForPrompt(goals: Goal[], tasks: Task[], taskRefs: Map<string, string>, repeats: Repeat[], now: number): { lines: string[]; refs: WorkflowRefs } {
  const refs: WorkflowRefs = { tasks: taskRefs, waits: new Map(), results: new Map(), series: new Map() };
  const refOfTask = new Map([...taskRefs].map(([r, id]) => [id, r]));
  const byId = new Map(tasks.map(t => [t.id, t]));
  const done = repeatsDone(tasks);
  const lines: string[] = [];
  let w = 0, k = 0, s = 0;
  for (const { goal: g, depth } of goalTree(goals, x => x.status === 'active')) {
    const pad = '  '.repeat(depth);
    const nodeRef = new Map<string, string>();
    lines.push(`${pad}- ${g.id} ${q(g.title)}${g.parent ? ` (sub-goal of ${g.parent}${g.parentKr ? `, for its key result ${q(findResult(goals.find(p => p.id === g.parent)?.results ?? [], g.parentKr)?.text ?? '')}` : ''})` : ''}${g.by ? `, by ${g.by}` : ''}`);
    const krs = flatResults(g.results);
    if (krs.length) {
      const parts = krs.map(({ kr, parent }) => {
        const r = `R${++k}`;
        refs.results.set(r, { goal: g.id, id: kr.id });
        nodeRef.set(krNode(kr), r);
        const up = parent ? [...nodeRef].find(([n]) => n === `kr:${parent}`)?.[1] : null;
        return `${r} ${q(kr.text)}${kr.done ? ' (done)' : ''}${up ? ` under ${up}` : ''}`;
      });
      lines.push(`${pad}  key results: ${parts.join('; ')}`);
    }
    const plan = planOf(g);
    if (plan.waits.length) {
      lines.push(`${pad}  waiting on: ${plan.waits.map(x => { const r = `W${++w}`; refs.waits.set(r, { goal: g.id, id: x.id }); nodeRef.set(x.id, r); return `${r} ${q(x.title)}${x.done ? ' (resolved)' : ''}`; }).join('; ')}`);
    }
    const reps = repeats.filter(r => r.goal === g.id);
    if (reps.length) {
      lines.push(`${pad}  repeating: ${reps.map(r => { const ref = `S${++s}`; refs.series.set(ref, { goal: g.id, id: r.id }); nodeRef.set(repeatNode(r), ref); return `${ref} ${q(r.title)} (${describeRule(r.rule)}, ${done.get(r.id) ?? 0} done)`; }).join('; ')}`);
    }
    const mine = tasks.filter(t => t.goal === g.id && t.status === 'open' && !occurrenceOf(t.id));
    for (const t of mine) { const r = refOfTask.get(t.id); if (r) nodeRef.set(t.id, r); }
    if (mine.length) lines.push(`${pad}  open tasks on it: ${mine.map(t => refOfTask.get(t.id) ?? q(t.title)).join(', ')}`);
    for (const c of goals.filter(x => x.parent === g.id && x.status !== 'dropped')) nodeRef.set(goalNode(c), c.id);
    const name = (id: string) => nodeRef.get(id) ?? (byId.get(id) ? `${q(byId.get(id)?.title ?? '')}${byId.get(id)?.status === 'done' ? ' (done)' : ''}` : null);
    const arrows = plan.links.map(l => { const a = name(l.from), b = name(l.to); return a && b ? `${a} → ${b}` : null; }).filter(Boolean);
    if (arrows.length) lines.push(`${pad}  arrows: ${arrows.join('; ')}`);
  }
  void now;
  return { lines, refs };
}

/** The operations the model can use, for both prompts. */
export const OPS_GUIDE = [
  'Operations, each an object with "op" and the fields it uses (leave the rest out). A step is any ref: T1 (a task), W1 (something they wait on), R1 (a key result), S1 (a repeating task), a goal id (a sub-goal, as a step of its parent), or the "key" you gave something you add in this reply. A goal is its id, or the "key" of one you add.',
  '- add_goal {title, parent: goal for a sub-goal, else omit; for_result: the parent\'s key result it serves (ref or text); results: its key results as texts; by: YYYY-MM-DD; key}',
  '- edit_goal {goal, title, by, status: "achieved", "dropped" or "active"}',
  '- add_result {goal, text, under: a key result it goes under (ref or text); key}: a key result ("done when")',
  '- edit_result {ref, text, done}; remove_result {ref}',
  '- add_step {goal, title, minutes, priority: 1 urgent, 2 important, 3 later; after: the step it follows; before: the step it leads to; beside: a step it runs in parallel with; repeat: {freq, every, days, monthday, until, times, per} for a repeating task; key}: a new task on the goal',
  '- add_wait {goal, title, holds: the step it holds up; key}: something outside their control the plan waits on (a reply, a signature)',
  '- link {from, to}: "to" can only start once "from" is done. unlink {from, to} takes an arrow away.',
  '- edit_step {ref, title, minutes, priority, done}: rename it, change it, or tick it off (done true) / reopen it (done false); for W1, done means it came through',
  '- remove_step {ref, delete}: off the chart. A task goes off the goal (delete true deletes it, only when they say delete); a sub-goal is dropped; a repeating task stops.',
  '- move_step {ref, goal, after}: put an existing task (off-goal, or on another goal) on this goal, after a step if they say',
  'Change only what they ask for, in as few operations as it takes, in order (add a thing before linking it). Use the refs above; never make one up. Titles are short, without the schedule.',
];

/**
 * The prompt for changing goals and charts from what they said. `focus` is the goal whose chart they're looking at:
 * unless they name another goal, changes are to that one.
 */
export function workflowPrompt(a: {
  text: string; now: number; goals: Goal[]; tasks: Task[]; repeats: Repeat[]; focus?: string | null; spoken?: boolean;
  taskRefs: Map<string, string>; taskLines: string[];
}): { prompt: string; refs: WorkflowRefs } {
  const { lines, refs } = chartsForPrompt(a.goals, a.tasks, a.taskRefs, a.repeats, a.now);
  const focus = a.focus ? a.goals.find(g => g.id === a.focus) : null;
  const prompt = [
    'You change the user\'s goals and the flow charts of steps towards them, in their personal planner, from what they say.',
    `Today is ${ymd(a.now)}.`,
    'Their active goals, sub-goals indented under the goal they are part of, each with what is on its chart:',
    ...(lines.length ? lines : ['(none yet)']),
    'Their open tasks (ref | task | goal):',
    ...(a.taskLines.length ? a.taskLines : ['(none)']),
    focus ? `They are looking at the chart of ${focus.id} ${q(focus.title)}: unless they name another goal, every change is to that one.` : '',
    ...OPS_GUIDE,
    a.spoken ? 'They said this out loud, so it may have slips: read it as they meant it, and put that in "heard".' : '',
    'Answer with JSON: {"heard": what they said as they meant it ("" when typed), "reply": one short line saying what you changed, or asking what they meant when it is unclear, "ops": [...]}.',
    `What they said: ${JSON.stringify(a.text.slice(0, 4000))}`,
  ].filter(Boolean).join('\n');
  return { prompt, refs };
}

/** The tasks as the workflow prompt lists them: ref | title | goal. */
export const taskLinesFor = (tasks: Task[], taskRefs: Map<string, string>) => {
  const byId = new Map(tasks.map(t => [t.id, t]));
  return [...taskRefs].map(([r, id]) => { const t = byId.get(id); return t ? `${r} | ${t.title.replace(/\s+/g, ' ').slice(0, 120)} | ${t.goal || 'off-goal'}` : null; }).filter((x): x is string => !!x);
};

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });
/** One operation, for the model's structured output. */
export const OP_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: KINDS },
    goal: { type: 'string' }, ref: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' },
    under: { type: 'string' }, parent: { type: 'string' }, for_result: { type: 'string' }, results: { type: 'array', items: { type: 'string' } },
    by: { ...nullable('string'), description: 'YYYY-MM-DD' }, section: { type: 'string' }, key: { type: 'string' },
    after: { type: 'string' }, before: { type: 'string' }, beside: { type: 'string' }, holds: { type: 'string' },
    minutes: { type: 'integer', minimum: 15, maximum: 480 }, priority: { type: 'integer', minimum: 1, maximum: 3 }, done: { type: 'boolean' }, delete: { type: 'boolean' },
    status: { type: 'string', enum: ['active', 'achieved', 'dropped'] },
    repeat: {
      type: 'object',
      properties: {
        freq: { type: 'string', enum: ['day', 'week', 'month'] }, every: { type: 'integer', minimum: 1, maximum: 52 },
        days: { type: 'array', items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } },
        monthday: nullable('integer'), until: nullable('string'), times: nullable('integer'), per: nullable('integer'),
      },
      required: ['freq'],
    },
  },
  required: ['op'],
};

export const WORKFLOW_SCHEMA = {
  type: 'object',
  properties: {
    heard: { type: 'string' },
    reply: { type: 'string' },
    ops: { type: 'array', items: OP_SCHEMA },
  },
  required: ['reply', 'ops'],
};

/* ---------- applying them ---------- */

export interface WorkflowState { goals: Goal[]; tasks: Task[]; repeats: Repeat[]; now: number }

/** Where new ids come from: replaceable, so applying the same operations twice gives the same ids. */
export interface WorkflowIds { task: () => string; goal: () => string; kr: () => string; wait: () => string; repeat: () => string }
export const freshIds = (): WorkflowIds => ({ task: newId, goal: newGoalId, kr: newResultId, wait: newWaitId, repeat: newRepeatId });

/** Ids that are recorded the first time and played back after, for laying the same change over newer goals. */
export function recordedIds(): WorkflowIds & { replay: () => WorkflowIds } {
  const seen: Record<keyof WorkflowIds, string[]> = { task: [], goal: [], kr: [], wait: [], repeat: [] };
  const fresh = freshIds();
  const rec = (k: keyof WorkflowIds) => () => { const id = fresh[k](); seen[k].push(id); return id; };
  return {
    task: rec('task'), goal: rec('goal'), kr: rec('kr'), wait: rec('wait'), repeat: rec('repeat'),
    replay: () => {
      const at: Record<keyof WorkflowIds, number> = { task: 0, goal: 0, kr: 0, wait: 0, repeat: 0 };
      const play = (k: keyof WorkflowIds) => () => seen[k][at[k]++] ?? fresh[k]();
      return { task: play('task'), goal: play('goal'), kr: play('kr'), wait: play('wait'), repeat: play('repeat') };
    },
  };
}

export interface WorkflowResult {
  goals: Goal[];
  /** Tasks to write (new or changed), and to delete. */
  writes: Task[];
  removes: string[];
  repeatOps: RepeatOp[];
  /** For the charts' history. Changes to tasks are noted on their own when they're written. */
  log: LogEntry[];
  /** What changed, in words, one line each; and what couldn't be done, and why. */
  lines: string[];
  skipped: string[];
}

type Node = { kind: 'task' | 'wait' | 'kr' | 'goal' | 'series'; goal: string | null; node: string; id: string; title: string };
/** What each operation does, for saying what couldn't be done. */
const DOING: Record<WorkflowOpKind, string> = {
  add_goal: 'add the goal', edit_goal: 'change the goal', add_result: 'add the key result', edit_result: 'change the key result',
  remove_result: 'delete the key result', add_step: 'add the step', add_wait: 'add what it waits on', link: 'draw the arrow', unlink: 'take the arrow away',
  edit_step: 'change the step', remove_step: 'remove the step', move_step: 'move the step',
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const short = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;

/**
 * Apply the operations to your goals, tasks and repeats, in order. Pure: it returns the new goals, the task writes and
 * deletes, the repeat changes, the history and what happened in words. `focus` is the goal an operation without one
 * means.
 */
export function applyWorkflow(ops: WorkflowOp[], st: WorkflowState, refs: WorkflowRefs, opts: { focus?: string | null; ids?: WorkflowIds } = {}): WorkflowResult {
  const ids = opts.ids ?? freshIds();
  const now = st.now, today = ymd(now);
  let goals = st.goals;
  const taskBy = new Map(st.tasks.map(t => [t.id, t]));
  const writes = new Map<string, Task>();
  const removes = new Set<string>();
  const repeatOps: RepeatOp[] = [];
  const repeats = new Map(st.repeats.map(r => [r.id, r]));
  const log: LogEntry[] = [];
  const lines: string[] = [];
  const skipped: string[] = [];
  const keys = new Map<string, Node>();
  const goalKeys = new Map<string, string>();

  const task = (id: string) => writes.get(id) ?? taskBy.get(id) ?? null;
  const write = (t: Task) => { writes.set(t.id, t); };
  const goalOf = (id: string | null | undefined) => (id ? goals.find(g => g.id === id) ?? null : null);
  const findGoal = (v: string | undefined): Goal | null => {
    const id = v ? goalKeys.get(v) ?? v : opts.focus ?? undefined;
    if (!id) return null;
    return goalOf(id) ?? goals.find(g => g.status === 'active' && norm(g.title) === norm(id)) ?? null;
  };
  const sectionOf = (g: Goal) => rootOf(new Map(goals.map(x => [x.id, x])), g).section;
  const plan = (gid: string, f: (p: Plan) => Plan) => { goals = goals.map(g => (g.id === gid ? { ...g, plan: f(planOf(g)), updatedAt: now } : g)); };
  const note = (e: Omit<LogEntry, 'at'>) => log.push({ at: now, ...e });

  /** A step, by ref, by the key of something added in this reply, or by its name on the goal (then anywhere). */
  const resolve = (v: string | undefined, gid?: string | null): Node | null => {
    if (!v) return null;
    const k = keys.get(v);
    if (k) return k;
    const tid = refs.tasks.get(v);
    if (tid) {
      const t = task(tid);
      if (!t) return null;
      const o = occurrenceOf(t.id), r = o ? repeats.get(o.repeat) : null;
      if (r && r.goal) return { kind: 'series', goal: r.goal, node: repeatNode(r), id: r.id, title: r.title };
      return { kind: 'task', goal: t.goal ?? null, node: t.id, id: t.id, title: t.title };
    }
    const w = refs.waits.get(v);
    if (w) { const x = planOf(goalOf(w.goal) ?? { plan: undefined }).waits.find(y => y.id === w.id); return x ? { kind: 'wait', goal: w.goal, node: w.id, id: w.id, title: x.title } : null; }
    const kr = refs.results.get(v);
    if (kr) { const x = findResult(goalOf(kr.goal)?.results ?? [], kr.id); return x ? { kind: 'kr', goal: kr.goal, node: `kr:${kr.id}`, id: kr.id, title: x.text } : null; }
    const s = refs.series.get(v);
    if (s) { const r = repeats.get(s.id); return r ? { kind: 'series', goal: s.goal, node: `rep:${s.id}`, id: s.id, title: r.title } : null; }
    const sub = goalOf(goalKeys.get(v) ?? v);
    if (sub) return { kind: 'goal', goal: sub.parent ?? null, node: goalNode(sub), id: sub.id, title: sub.title };
    // By name.
    const n = norm(v);
    const g = goalOf(gid);
    if (g) {
      const kr2 = flatResults(g.results).find(x => norm(x.kr.text) === n);
      if (kr2) return { kind: 'kr', goal: g.id, node: krNode(kr2.kr), id: kr2.kr.id, title: kr2.kr.text };
      const w2 = planOf(g).waits.find(x => norm(x.title) === n);
      if (w2) return { kind: 'wait', goal: g.id, node: w2.id, id: w2.id, title: w2.title };
    }
    const all = [...writes.values(), ...st.tasks.filter(t => !writes.has(t.id))].filter(t => t.status === 'open' && !removes.has(t.id));
    const t = all.find(x => x.goal === gid && norm(x.title) === n) ?? all.find(x => norm(x.title) === n);
    if (t) return resolve(refOf(t.id) ?? '', gid) ?? { kind: 'task', goal: t.goal ?? null, node: t.id, id: t.id, title: t.title };
    const g2 = goals.find(x => x.status === 'active' && norm(x.title) === n);
    return g2 ? { kind: 'goal', goal: g2.parent ?? null, node: goalNode(g2), id: g2.id, title: g2.title } : null;
  };
  const refOf = (tid: string) => [...refs.tasks].find(([, id]) => id === tid)?.[0] ?? null;

  /** Put a task on a goal, in its top goal's section. */
  const onGoal = (t: Task, g: Goal) => { const sec = sectionOf(g); write({ ...t, goal: g.id, ...(sec ? { label: sec } : {}), updatedAt: now }); };

  /** An arrow on a goal's chart. Both ends have to be on it; a task that isn't comes onto it. */
  const link = (g: Goal, a: Node, b: Node): boolean => {
    for (const n of [a, b]) {
      if (n.goal === g.id) continue;
      if (n.kind === 'task') { const t = task(n.id); if (t) { onGoal(t, g); n.goal = g.id; continue; } }
      skipped.push(`${short(n.title)} isn’t on ${short(g.title)}, so it can’t have an arrow there.`);
      return false;
    }
    const cur = planOf(goalOf(g.id) as Goal);
    if (cur.links.some(l => l.from === a.node && l.to === b.node)) return true;
    if (wouldLoop(cur.links, a.node, b.node)) { skipped.push(`${short(b.title)} after ${short(a.title)} would make a loop.`); return false; }
    plan(g.id, p => withLink(p, { from: a.node, to: b.node }));
    note({ goal: g.id, op: 'link', step: b.node, title: b.title, from: a.node, fromTitle: a.title });
    return true;
  };
  const chartOf = (op: WorkflowOp, ...ns: (Node | null)[]) => findGoal(op.goal) ?? goalOf(ns.find(n => n?.goal)?.goal ?? null);

  for (const op of ops) {
    const miss = (what: string) => skipped.push(`Couldn’t ${DOING[op.op]}: ${what}.`);
    switch (op.op) {
      case 'add_goal': {
        if (!op.title) { miss('it has no title'); break; }
        const parent = op.parent ? findGoal(op.parent) : null;
        if (op.parent && !parent) { miss(`there’s no goal ${op.parent} to put it under`); break; }
        if (!parent && goals.filter(g => g.status === 'active' && !g.parent).length >= MAX_ACTIVE) { miss(`${MAX_ACTIVE} goals at once is the most; achieve or drop one first`); break; }
        const kr = parent && op.for_result ? resolve(op.for_result, parent.id) : null;
        const g = makeGoal({
          title: op.title, section: parent ? sectionOf(parent) : op.section ?? null, results: op.results ?? [], by: op.by ?? null,
          parent: parent?.id ?? null, parentKr: kr?.kind === 'kr' ? kr.id : null,
        }, now, ids.goal());
        goals = addGoal(g)(goals);
        if (op.key) goalKeys.set(op.key, g.id);
        goalKeys.set(g.title, g.id);
        if (parent) note({ goal: parent.id, op: 'add', step: goalNode(g), title: g.title });
        lines.push(parent ? `New sub-goal ${short(g.title)} under ${short(parent.title)}${kr ? `, for ${short(kr.title)}` : ''}` : `New goal ${short(g.title)}`);
        break;
      }
      case 'edit_goal': {
        const g = findGoal(op.goal);
        if (!g) { miss(`there’s no goal ${op.goal ?? ''}`); break; }
        const patch: Partial<Goal> = {};
        if (op.title) patch.title = op.title.slice(0, 80);
        if (op.by !== undefined) patch.by = op.by;
        if (Object.keys(patch).length) { goals = patchGoal(g.id, patch, now)(goals); lines.push(`${short(g.title)}${patch.title ? ` is now ${short(patch.title)}` : ''}${patch.by !== undefined ? `, ${patch.by ? `by ${patch.by}` : 'no date'}` : ''}`); }
        if (op.status && op.status !== g.status) { goals = setGoalStatus(g.id, op.status, now)(goals); lines.push(`${short(g.title)}: ${op.status}`); }
        break;
      }
      case 'add_result': {
        const g = findGoal(op.goal);
        const text = op.text ?? op.title;
        if (!g || !text) { miss(!g ? `there’s no goal ${op.goal ?? ''}` : 'it has no text'); break; }
        const under = op.under ? resolve(op.under, g.id) : null;
        const id = ids.kr();
        goals = addResult(g.id, under?.kind === 'kr' && under.goal === g.id ? under.id : null, text, now, id)(goals);
        const n: Node = { kind: 'kr', goal: g.id, node: `kr:${id}`, id, title: text };
        if (op.key) keys.set(op.key, n);
        note({ goal: g.id, op: 'add', step: n.node, title: text });
        lines.push(`${short(g.title)}: key result ${short(text)}${under?.kind === 'kr' ? ` under ${short(under.title)}` : ''}`);
        break;
      }
      case 'edit_result': case 'remove_result': {
        const n = resolve(op.ref, opts.focus);
        if (!n || n.kind !== 'kr' || !n.goal) { miss(`there’s no key result “${op.ref ?? ''}”`); break; }
        if (op.op === 'remove_result') {
          const g = goalOf(n.goal) as Goal;
          const kr = findResult(g.results, n.id);
          const gone = kr ? flatResults([kr]).map(x => krNode(x.kr)) : [n.node];
          goals = patchResult(n.goal, n.id, null, now)(goals);
          plan(n.goal, p => gone.reduce(withoutStep, p));
          note({ goal: n.goal, op: 'remove', step: n.node, title: n.title });
          lines.push(`Key result ${short(n.title)} deleted`);
          break;
        }
        const patch: { text?: string; done?: boolean } = {};
        if (op.text ?? op.title) patch.text = (op.text ?? op.title as string).slice(0, 120);
        if (op.done !== undefined) patch.done = op.done;
        goals = patchResult(n.goal, n.id, patch, now)(goals);
        if (op.done !== undefined) note({ goal: n.goal, op: op.done ? 'tick' : 'untick', step: n.node, title: n.title });
        lines.push(`Key result ${short(n.title)}${patch.text ? ` is now ${short(patch.text)}` : ''}${op.done !== undefined ? (op.done ? ' ticked' : ' unticked') : ''}`);
        break;
      }
      case 'add_step': {
        const g = findGoal(op.goal);
        if (!g || !op.title) { miss(!g ? `there’s no goal ${op.goal ?? ''}` : 'it has no title'); break; }
        const sec = sectionOf(g);
        const base = { title: op.title, priority: op.priority ?? 2 as Priority, minutes: op.minutes ?? 30 };
        const rule = op.repeat ? toRule(op.repeat) : null;
        let n: Node;
        if (rule) {
          const r = startRepeat({ ...base, notes: '', label: sec ?? null, goal: g.id, raw: op.title, rule, time: null, from: today }, now, ids.repeat());
          repeatOps.push({ kind: 'set', repeat: r });
          repeats.set(r.id, r);
          if (occursOn(r, today)) write(occurrence(r, today, now));
          n = { kind: 'series', goal: g.id, node: repeatNode(r), id: r.id, title: r.title };
        } else {
          const t: Task = {
            id: ids.task(), ...base, raw: op.title, notes: '', start: null, due: null, status: 'open', created: now, order: now, doneAt: null,
            goal: g.id, label: sec ?? null, updatedAt: now,
          };
          write(t);
          n = { kind: 'task', goal: g.id, node: t.id, id: t.id, title: t.title };
        }
        if (op.key) keys.set(op.key, n);
        keys.set(n.title, n);
        const after = op.after ? resolve(op.after, g.id) : null, before = op.before ? resolve(op.before, g.id) : null, beside = op.beside ? resolve(op.beside, g.id) : null;
        if (op.after && !after) skipped.push(`No step ${op.after} for ${short(n.title)} to follow.`);
        if (after) link(g, after, n);
        if (before) link(g, n, before);
        if (beside) for (const l of parallelLinks(planOf(goalOf(g.id) as Goal), beside.node, n.node)) plan(g.id, p => withLink(p, l));
        lines.push(`${short(g.title)}: ${rule ? 'repeating ' : ''}step ${short(n.title)}${rule ? ` (${describeRule(rule)})` : ''}${after ? ` after ${short(after.title)}` : ''}${before ? `, before ${short(before.title)}` : ''}${beside ? ` alongside ${short(beside.title)}` : ''}`);
        break;
      }
      case 'add_wait': {
        const g = findGoal(op.goal);
        const title = op.title ?? op.text;
        if (!g || !title) { miss(!g ? `there’s no goal ${op.goal ?? ''}` : 'it has no title'); break; }
        const w = { id: ids.wait(), title: title.slice(0, 120), done: false, created: now, doneAt: null };
        plan(g.id, p => withWait(p, w));
        note({ goal: g.id, op: 'wait', step: w.id, title: w.title });
        const n: Node = { kind: 'wait', goal: g.id, node: w.id, id: w.id, title: w.title };
        if (op.key) keys.set(op.key, n);
        keys.set(w.title, n);
        const holds = op.holds ? resolve(op.holds, g.id) : null;
        if (holds) link(g, n, holds);
        lines.push(`${short(g.title)}: waiting on ${short(w.title)}${holds ? `, before ${short(holds.title)}` : ''}`);
        break;
      }
      case 'link': case 'unlink': {
        const a = resolve(op.from, opts.focus), b = resolve(op.to, opts.focus);
        if (!a || !b) { miss(`there’s no step “${!a ? op.from ?? '' : op.to ?? ''}”`); break; }
        const g = chartOf(op, b, a);
        if (!g) { miss('there’s no goal to draw it on'); break; }
        if (op.op === 'link') { if (link(g, a, b)) lines.push(`${short(b.title)} now waits on ${short(a.title)}`); break; }
        const had = planOf(g).links.some(l => l.from === a.node && l.to === b.node);
        if (!had) { miss(`there’s no arrow from ${short(a.title)} to ${short(b.title)}`); break; }
        plan(g.id, p => withoutLink(p, { from: a.node, to: b.node }));
        note({ goal: g.id, op: 'unlink', step: b.node, title: b.title, from: a.node, fromTitle: a.title });
        lines.push(`${short(b.title)} no longer waits on ${short(a.title)}`);
        break;
      }
      case 'edit_step': {
        const n = resolve(op.ref, opts.focus);
        if (!n) { miss(`there’s no step “${op.ref ?? ''}”`); break; }
        const title = op.title?.slice(0, 160);
        const said: string[] = [];
        if (n.kind === 'task') {
          const t = task(n.id) as Task;
          const patch: Partial<Task> = {};
          if (title) patch.title = title;
          if (op.minutes) patch.minutes = op.minutes;
          if (op.priority) patch.priority = op.priority;
          if (op.done !== undefined) Object.assign(patch, { status: op.done ? 'done' : 'open', doneAt: op.done ? now : null });
          write({ ...t, ...patch, updatedAt: now });
        } else if (n.kind === 'wait' && n.goal) {
          plan(n.goal, p => patchWait(p, n.id, { ...(title ? { title } : {}), ...(op.done !== undefined ? { done: op.done, doneAt: op.done ? now : null } : {}) }));
          if (op.done !== undefined) note({ goal: n.goal, op: op.done ? 'resolve' : 'unresolve', step: n.id, title: n.title });
        } else if (n.kind === 'kr' && n.goal) {
          goals = patchResult(n.goal, n.id, { ...(title ? { text: title.slice(0, 120) } : {}), ...(op.done !== undefined ? { done: op.done } : {}) }, now)(goals);
        } else if (n.kind === 'goal') {
          if (title) goals = patchGoal(n.id, { title: title.slice(0, 80) }, now)(goals);
          if (op.done !== undefined) goals = setGoalStatus(n.id, op.done ? 'achieved' : 'active', now)(goals);
        } else if (n.kind === 'series') {
          const r = repeats.get(n.id) as Repeat;
          const next = { ...r, ...(title ? { title } : {}), ...(op.minutes ? { minutes: op.minutes } : {}), ...(op.priority ? { priority: op.priority } : {}), updatedAt: now };
          if (title || op.minutes || op.priority) { repeatOps.push({ kind: 'set', repeat: next }); repeats.set(r.id, next); }
          // Ticking a repeating task ticks the one that's open.
          const open = [...taskBy.values()].filter(t => t.status === 'open' && occurrenceOf(t.id)?.repeat === r.id).sort((x, y) => y.id.localeCompare(x.id))[0];
          if (op.done && open) write({ ...open, ...(title ? { title } : {}), status: 'done', doneAt: now, updatedAt: now });
          else if (open && title) write({ ...open, title, updatedAt: now });
        }
        if (title && title !== n.title) said.push(`is now ${short(title)}`);
        if (op.done !== undefined) said.push(op.done ? 'done' : 'reopened');
        if (op.minutes) said.push(`${op.minutes} min`);
        if (op.priority) said.push(['urgent', 'important', 'later'][op.priority - 1]);
        lines.push(`${short(n.title)} ${said.join(', ') || 'unchanged'}`);
        break;
      }
      case 'remove_step': {
        const n = resolve(op.ref, opts.focus);
        if (!n) { miss(`there’s no step “${op.ref ?? ''}”`); break; }
        if (n.goal) plan(n.goal, p => withoutStep(p, n.node));
        if (n.kind === 'task') {
          const t = task(n.id) as Task;
          if (op.delete) { removes.add(t.id); writes.delete(t.id); lines.push(`${short(n.title)} deleted`); }
          else { write({ ...t, goal: null, updatedAt: now }); lines.push(`${short(n.title)} taken off its goal`); }
        } else if (n.kind === 'wait') lines.push(`No longer waiting on ${short(n.title)}`);
        else if (n.kind === 'kr' && n.goal) { goals = patchResult(n.goal, n.id, null, now)(goals); lines.push(`Key result ${short(n.title)} deleted`); }
        else if (n.kind === 'goal') { goals = setGoalStatus(n.id, 'dropped', now)(goals); lines.push(`Sub-goal ${short(n.title)} dropped`); }
        else if (n.kind === 'series') {
          const r = repeats.get(n.id) as Repeat;
          if (op.delete) repeatOps.push({ kind: 'stop', id: r.id }); else repeatOps.push({ kind: 'set', repeat: { ...r, goal: null, updatedAt: now } });
          lines.push(op.delete ? `${short(n.title)} stopped repeating` : `${short(n.title)} taken off its goal`);
        }
        if (n.goal) note({ goal: n.goal, op: 'remove', step: n.node, title: n.title });
        break;
      }
      case 'move_step': {
        const n = resolve(op.ref, opts.focus), g = findGoal(op.goal);
        if (!n || !g) { miss(!n ? `there’s no step “${op.ref ?? ''}”` : `there’s no goal ${op.goal ?? ''}`); break; }
        if (n.kind === 'task') onGoal(task(n.id) as Task, g);
        else if (n.kind === 'series') { const r = repeats.get(n.id) as Repeat; repeatOps.push({ kind: 'set', repeat: { ...r, goal: g.id, updatedAt: now } }); }
        else { miss(`${short(n.title)} can’t move to another goal`); break; }
        const moved: Node = { ...n, goal: g.id };
        const after = op.after ? resolve(op.after, g.id) : null;
        if (after) link(g, after, moved);
        lines.push(`${short(n.title)} moved to ${short(g.title)}${after ? ` after ${short(after.title)}` : ''}`);
        break;
      }
    }
  }
  return { goals, writes: [...writes.values()].filter(t => !removes.has(t.id)), removes: [...removes], repeatOps, log, lines, skipped };
}
