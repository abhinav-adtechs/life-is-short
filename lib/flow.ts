import type { Task } from './model';
import { flatResults, goalProgress, resultDone, type Goal, type KeyResult } from './goals';
import { isEvent } from './select';
import { DAY_MS, endOf, ymd } from './time';
import { describeRule, nextDue, occurrenceOf, repeatOver, repeatsDone, type Repeat } from './repeat';

/*
 * A goal's flow chart: the steps towards it and what has to happen before what.
 *
 * It's a precedence diagram (activity-on-node, the way project plans draw dependencies): the goal is the start, on the
 * left; every task on the goal is a step; an arrow from one step to another means the first has to be finished before
 * the second can start (finish-to-start). Steps with no arrow between them can run in parallel. Two more kinds of step:
 * "waiting on" one (something outside your control, like a reply or a signature) and the goal's key results, as
 * milestones the steps lead to. Steps sit in columns by how many steps come before them, so the chart lays itself out.
 *
 * What's stored is only the arrows, the waiting steps and where you've moved steps by hand, on the goal
 * (lib/goals.ts). The tasks and key results are the planner's own, so the chart is always up to date.
 */

/** Something you're waiting on that holds steps up: a reply, a signature, someone else's work. */
export interface Wait { id: string; title: string; done: boolean; created: number; doneAt: number | null }

/**
 * `from` has to be done before `to` can start. Ids are a task's id, a waiting step's, "kr:" and a key result's, or
 * "goal:" and a sub-goal's. `auto` marks one the goal's own structure draws (a key result under another, a sub-goal
 * for a key result): it isn't stored and can't be removed from the chart.
 */
export interface Link { from: string; to: string; auto?: true }

/** Where you put a step by hand: its top-left corner on the chart. Steps without one are laid out for you. */
export interface Pos { x: number; y: number }

export interface Plan { links: Link[]; waits: Wait[]; pos?: Record<string, Pos> }

export const EMPTY_PLAN: Plan = { links: [], waits: [] };
export const MAX_LINKS = 400;
export const MAX_POS = 400;
/** How far out a step can go, either way. */
export const POS_MAX = 20000;
export const MAX_WAITS = 60;
export const WAIT_TITLE_MAX = 120;

export const krNode = (k: Pick<KeyResult, 'id'>) => `kr:${k.id}`;
export const goalNode = (g: Pick<Goal, 'id'>) => `goal:${g.id}`;
export const newWaitId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const NODE_ID = /^(?:kr:|goal:)?[A-Za-z0-9_@:.-]{1,80}$/;
const WAIT_ID = /^w[A-Za-z0-9]{1,40}$/;

/**
 * A stored plan, cleaned up: well-formed waits, one copy of each arrow, no arrow to itself, none that closes a loop, and
 * positions in whole pixels on the chart.
 */
export function normalizePlan(raw: unknown): Plan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const waits: Wait[] = [];
  for (const x of Array.isArray(o.waits) ? o.waits : []) {
    const w = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const title = typeof w.title === 'string' ? w.title.replace(/\s+/g, ' ').trim().slice(0, WAIT_TITLE_MAX) : '';
    if (typeof w.id !== 'string' || !WAIT_ID.test(w.id) || !title || waits.some(v => v.id === w.id) || waits.length >= MAX_WAITS) continue;
    const done = w.done === true;
    waits.push({
      id: w.id, title, done,
      created: typeof w.created === 'number' && Number.isFinite(w.created) ? w.created : 0,
      doneAt: done && typeof w.doneAt === 'number' && Number.isFinite(w.doneAt) ? w.doneAt : null,
    });
  }
  const links: Link[] = [];
  for (const x of Array.isArray(o.links) ? o.links : []) {
    const l = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const from = typeof l.from === 'string' ? l.from : '', to = typeof l.to === 'string' ? l.to : '';
    if (!NODE_ID.test(from) || !NODE_ID.test(to) || from === to || links.length >= MAX_LINKS) continue;
    if (links.some(e => e.from === from && e.to === to) || wouldLoop(links, from, to)) continue;
    links.push({ from, to });
  }
  const pos: Record<string, Pos> = {};
  const rawPos = (o.pos && typeof o.pos === 'object' && !Array.isArray(o.pos) ? o.pos : {}) as Record<string, unknown>;
  const at = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(POS_MAX, Math.max(0, Math.round(v))) : null);
  for (const [id, v] of Object.entries(rawPos)) {
    const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const x = at(p.x), y = at(p.y);
    if (!NODE_ID.test(id) || x == null || y == null || Object.keys(pos).length >= MAX_POS) continue;
    pos[id] = { x, y };
  }
  return { links, waits, ...(Object.keys(pos).length ? { pos } : {}) };
}

/** Whether a plan holds anything worth keeping. */
export const planHasAny = (p: Plan) => p.links.length > 0 || p.waits.length > 0 || !!(p.pos && Object.keys(p.pos).length);

export const planOf = (g: Pick<Goal, 'plan'>): Plan => g.plan ?? EMPTY_PLAN;

/** Whether an arrow from → to would close a loop: `to` already leads to `from`, or they're the same step. */
export function wouldLoop(links: Link[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const l of links) next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
  const seen = new Set<string>(), stack = [to];
  while (stack.length) {
    const n = stack.pop() as string;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

/* ---------- the chart ---------- */

/** A task; something you're waiting on; a sub-goal (a "predefined process", with its own chart); a key result. */
export type StepKind = 'task' | 'wait' | 'goal' | 'milestone';
/** done; ready to start; blocked by a step before it; a milestone everything before which is done; a milestone still to reach. */
export type StepState = 'done' | 'ready' | 'blocked' | 'reached' | 'open';

export interface Step {
  id: string;
  kind: StepKind;
  title: string;
  task?: Task;
  result?: KeyResult;
  wait?: Wait;
  /** For a sub-goal: the goal, and how far along it is (0 to 1, or null with nothing to measure). */
  goal?: Goal;
  progress?: number | null;
  /** For a key result under another: how deep (0 at the top). */
  depth?: number;
  /**
   * For a repeating task: the whole series is one step ("rep:" and the repeat's id), with its rule, how many are done,
   * how many it needs (null with no count), and when the next one comes when none is open. `task` is the open one.
   */
  repeat?: { id: string; rule: string; done: number; times: number | null; next: string | null };
  /** Its length, for a task; for a sub-goal, the open work on it and under it; 0 for the others. */
  minutes: number;
  done: boolean;
  state: StepState;
  /** The steps it needs, and the ones it unblocks. */
  needs: string[];
  unblocks: string[];
  /** Its column (1 is next to the goal) and its place in that column, from the top. */
  col: number;
  row: number;
  critical: boolean;
}

export interface Flow {
  steps: Step[];
  byId: Map<string, Step>;
  /** The arrows between steps that are on the chart. */
  links: Link[];
  /** Steps nothing comes before: the goal leads straight to them. */
  roots: string[];
  cols: number;
  /** How many rows each column has, lanes included (index 0 is the goal's). */
  rows: number[];
  /**
   * An arrow that skips columns runs through a lane of its own in each column between, so it never passes behind a
   * step (the layered layout's "dummy nodes"): per arrow ("from>to"), the column and row of each lane, left to right.
   */
  lanes: Map<string, { col: number; row: number }[]>;
  /** The longest chain of work still to do, by length: its steps, its arrows ("from>to") and its minutes. */
  critical: { steps: string[]; links: Set<string>; minutes: number };
  counts: { steps: number; done: number; ready: number; blocked: number };
  /** Done tasks left off the chart: done a while ago and not tied to anything. */
  older: number;
}

/** How long a finished task stays on the chart without arrows, so the chart shows recent progress but not all of it. */
export const RECENT_DONE = 30 * DAY_MS;

export const linkKey = (l: Link) => `${l.from}>${l.to}`;

/** A task on the chart is done once ticked off; a meeting, once it's over. */
const taskDone = (t: Task, now: number) => (isEvent(t) ? t.start != null && endOf(t) <= now : t.status === 'done');

/** The chart step for a repeating task: the whole series. */
export const repeatNode = (r: Pick<Repeat, 'id'>) => `rep:${r.id}`;

/**
 * The goal's chart: its tasks, its waiting steps and its key results, with their arrows, states, columns and the
 * critical path. `all` keeps every finished task; otherwise ones done more than RECENT_DONE ago with no arrows are
 * counted in `older` instead. A repeating task (with `repeats` given) is one step for the whole series: done once the
 * repeat is over (done as many times as it had to be, or past its last day), so a repeat with no end never is.
 */
export function buildFlow(goal: Goal, tasks: Task[], now: number, opts: { all?: boolean; goals?: Goal[]; repeats?: Repeat[] } = {}): Flow {
  const plan = planOf(goal);
  const goals = opts.goals ?? [];
  const linked = new Set(plan.links.flatMap(l => [l.from, l.to]));
  const reps = new Map((opts.repeats ?? []).map(r => [r.id, r]));
  const series = new Map<string, Task[]>();
  const mine: Task[] = [];
  for (const t of tasks) {
    if (t.goal !== goal.id) continue;
    const o = occurrenceOf(t.id);
    if (o && reps.has(o.repeat)) series.set(o.repeat, [...(series.get(o.repeat) ?? []), t]);
    else mine.push(t);
  }
  // A repeat on this goal with nothing of it made yet still gets its step.
  for (const r of reps.values()) if (r.goal === goal.id && !series.has(r.id)) series.set(r.id, []);
  let older = 0;
  const steps: Step[] = [];
  const blank = { needs: [] as string[], unblocks: [] as string[], col: 0, row: 0, critical: false, state: 'ready' as StepState };
  // Open tasks first in backlog-ish order (priority, then when they were made), so new columns read top to bottom.
  const order = [...mine].sort((a, b) => (Number(taskDone(a, now)) - Number(taskDone(b, now))) || (a.priority - b.priority) || ((a.created || 0) - (b.created || 0)) || a.id.localeCompare(b.id));
  for (const t of order) {
    const done = taskDone(t, now);
    if (done && !opts.all && !linked.has(t.id) && now - (t.doneAt ?? t.start ?? 0) > RECENT_DONE) { older++; continue; }
    steps.push({ ...blank, needs: [], unblocks: [], id: t.id, kind: 'task', title: t.title, task: t, minutes: t.minutes, done });
  }
  const doneBy = repeatsDone(tasks), today = ymd(now);
  for (const [rid, list] of series) {
    const r = reps.get(rid) as Repeat;
    // The open one, the latest if there's more than one.
    const open = list.filter(t => t.status === 'open').sort((a, b) => b.id.localeCompare(a.id))[0];
    const done = doneBy.get(rid) ?? 0, over = repeatOver(r, done, today, !!open), id = repeatNode(r);
    if (over && !opts.all && !linked.has(id)) { older++; continue; }
    const left = r.rule.times ? Math.max(1, r.rule.times - done) : 1;
    steps.push({
      ...blank, needs: [], unblocks: [], id, kind: 'task', title: r.title, ...(open ? { task: open } : {}),
      repeat: { id: rid, rule: describeRule(r.rule), done, times: r.rule.times ?? null, next: open ? null : nextDue(r, now) },
      minutes: over ? 0 : r.minutes * left, done: over,
    });
  }
  for (const w of plan.waits) steps.push({ ...blank, needs: [], unblocks: [], id: w.id, kind: 'wait', title: w.title, wait: w, minutes: 0, done: w.done });
  // Sub-goals: one step each, with the open work on it and under it as its length.
  const under = (id: string): string[] => goals.filter(c => c.parent === id).flatMap(c => [c.id, ...under(c.id)]);
  const kids = goals.filter(c => c.parent === goal.id && c.status !== 'dropped');
  for (const c of kids) {
    const ids = new Set([c.id, ...under(c.id)]);
    const left = tasks.filter(t => t.goal && ids.has(t.goal) && t.status === 'open' && !isEvent(t)).reduce((n, t) => n + t.minutes, 0);
    steps.push({ ...blank, needs: [], unblocks: [], id: goalNode(c), kind: 'goal', title: c.title, goal: c, progress: goalProgress(c, goals), minutes: c.status === 'achieved' ? 0 : left, done: c.status === 'achieved' });
  }
  // Every key result, nested ones too.
  const flat = flatResults(goal.results);
  for (const { kr, depth } of flat) steps.push({ ...blank, needs: [], unblocks: [], id: krNode(kr), kind: 'milestone', title: kr.text, result: kr, depth, minutes: 0, done: resultDone(kr) });

  const byId = new Map(steps.map(s => [s.id, s]));
  // The goal's own structure: a key result leads to the one it's under; a sub-goal to the key result it's for.
  const auto: Link[] = [
    ...flat.filter(x => x.parent).map(x => ({ from: krNode(x.kr), to: `kr:${x.parent}`, auto: true as const })),
    ...kids.filter(c => c.parentKr && byId.has(`kr:${c.parentKr}`)).map(c => ({ from: goalNode(c), to: `kr:${c.parentKr}`, auto: true as const })),
  ];
  const links = [...auto, ...plan.links.filter(l => byId.has(l.from) && byId.has(l.to) && !auto.some(a => a.from === l.from && a.to === l.to))];
  for (const l of links) { (byId.get(l.to) as Step).needs.push(l.from); (byId.get(l.from) as Step).unblocks.push(l.to); }

  for (const s of steps) {
    const waiting = s.needs.some(id => !(byId.get(id) as Step).done);
    s.state = s.done ? 'done'
      : s.kind === 'milestone' ? (s.needs.length && !waiting ? 'reached' : 'open')
      : waiting ? 'blocked' : 'ready';
  }

  // Columns: a step goes one past the furthest step it needs; the goal is column 0. A milestone nothing leads to yet
  // waits in the last column.
  const col = new Map<string, number>();
  const colOf = (id: string, trail: Set<string>): number => {
    const known = col.get(id);
    if (known != null) return known;
    if (trail.has(id)) return 1;
    trail.add(id);
    const s = byId.get(id) as Step;
    const c = s.needs.length ? 1 + Math.max(...s.needs.map(n => colOf(n, trail))) : 1;
    trail.delete(id);
    col.set(id, c);
    return c;
  };
  const loose = (s: Step) => s.kind === 'milestone' && !s.needs.length && !s.unblocks.length;
  for (const s of steps) if (!loose(s)) s.col = colOf(s.id, new Set());
  const last = Math.max(1, ...steps.filter(s => s.col).map(s => s.col));
  for (const s of steps) if (!s.col) s.col = steps.some(x => x.col && x.kind !== 'milestone') ? last + 1 : last;
  const cols = Math.max(1, ...steps.map(s => s.col));

  // Rows. An arrow that skips columns gets a lane in each column it crosses, which is ordered like a step. Then each
  // column goes in the order of what comes before it (the mean row of those), a few sweeps either way, which keeps
  // arrows short and crossings few (the barycentre method of layered drawing).
  interface Slot { id: string; col: number; row: number; needs: string[]; unblocks: string[] }
  const slots = new Map<string, Slot>(steps.map(x => [x.id, x as Slot]));
  const laneIds = new Map<string, string[]>();
  for (const l of links) {
    const a = byId.get(l.from) as Step, b = byId.get(l.to) as Step;
    if (b.col - a.col < 2) continue;
    const ids: string[] = [];
    for (let c = a.col + 1; c < b.col; c++) ids.push(`${linkKey(l)}#${c}`);
    ids.forEach((id, i) => slots.set(id, { id, col: a.col + 1 + i, row: 0, needs: [i ? ids[i - 1] : l.from], unblocks: [i < ids.length - 1 ? ids[i + 1] : l.to] }));
    // The steps at either end see the lane instead of each other, for ordering.
    a.unblocks = a.unblocks.map(x => (x === l.to ? ids[0] : x));
    b.needs = b.needs.map(x => (x === l.from ? ids[ids.length - 1] : x));
    laneIds.set(linkKey(l), ids);
  }
  const all = [...slots.values()];
  const columns = Array.from({ length: cols + 1 }, (_, c) => all.filter(x => x.col === c));
  const place = () => columns.forEach(list => list.forEach((x, i) => { x.row = i; }));
  place();
  const mean = (ids: string[], fallback: number) => (ids.length ? ids.reduce((n, id) => n + (slots.get(id) as Slot).row, 0) / ids.length : fallback);
  for (let pass = 0; pass < 4; pass++) {
    for (let c = 2; c <= cols; c++) { columns[c] = [...columns[c]].sort((a, b) => mean(a.needs, a.row) - mean(b.needs, b.row) || a.row - b.row); place(); }
    for (let c = cols - 1; c >= 1; c--) { columns[c] = [...columns[c]].sort((a, b) => mean(a.unblocks, a.row) - mean(b.unblocks, b.row) || a.row - b.row); place(); }
  }
  // Back to the real steps on either end.
  for (const [key, ids] of laneIds) {
    const [from, to] = key.split('>');
    const a = byId.get(from) as Step, b = byId.get(to) as Step;
    a.unblocks = a.unblocks.map(x => (x === ids[0] ? to : x));
    b.needs = b.needs.map(x => (x === ids[ids.length - 1] ? from : x));
  }
  const lanes = new Map([...laneIds].map(([key, ids]) => [key, ids.map(id => { const x = slots.get(id) as Slot; return { col: x.col, row: x.row }; })]));
  const rows = columns.map(list => list.length);

  // The critical path: the chain with the most work left in it (the critical path method, on what's still to do).
  const left = (s: Step) => (s.done ? 0 : s.minutes);
  const best = new Map<string, { m: number; via: string | null }>();
  for (const s of [...steps].sort((a, b) => a.col - b.col)) {
    let via: string | null = null, m = 0;
    for (const n of s.needs) { const b = best.get(n); if (b && b.m > m) { m = b.m; via = n; } }
    best.set(s.id, { m: m + left(s), via });
  }
  let end: string | null = null, top = 0;
  for (const [id, b] of best) if (b.m > top) { top = b.m; end = id; }
  const chain: string[] = [];
  for (let id = end; id; id = best.get(id)?.via ?? null) chain.unshift(id);
  // Only what's still to do is critical: its open steps, and the arrows between two open steps.
  const open = (id: string) => !(byId.get(id) as Step).done;
  const path = chain.filter(open);
  const critical = path.length >= 2
    ? { steps: path, links: new Set(chain.slice(1).flatMap((id, i) => (open(id) && open(chain[i]) ? [`${chain[i]}>${id}`] : []))), minutes: top }
    : { steps: [], links: new Set<string>(), minutes: 0 };
  for (const id of critical.steps) (byId.get(id) as Step).critical = true;

  const work = steps.filter(s => s.kind !== 'milestone');
  return {
    steps, byId, links, roots: steps.filter(s => !s.needs.length && s.kind !== 'milestone').map(s => s.id), cols, rows, lanes, critical,
    counts: { steps: work.length, done: work.filter(s => s.done).length, ready: work.filter(s => s.state === 'ready').length, blocked: work.filter(s => s.state === 'blocked').length },
    older,
  };
}

/**
 * Open tasks held up by a step before them on their goal's chart, across all your active goals. A repeat's step holds
 * up its open one, and is done once the repeat is over.
 */
export function blockedTasks(goals: Goal[], tasks: Task[], now: number, repeats: Repeat[] = []): Set<string> {
  const out = new Set<string>();
  const byId = new Map(tasks.map(t => [t.id, t]));
  const reps = new Map(repeats.map(r => [repeatNode(r), r]));
  const doneBy = repeatsDone(tasks), today = ymd(now);
  const openOf = (rid: string) => tasks.filter(t => t.status === 'open' && occurrenceOf(t.id)?.repeat === rid);
  for (const g of goals) {
    const plan = planOf(g);
    if (g.status !== 'active' || !plan.links.length) continue;
    const waits = new Map(plan.waits.map(w => [w.id, w]));
    const krs = new Map(flatResults(g.results).map(({ kr }) => [krNode(kr), kr]));
    // A dropped sub-goal is off the chart, so it holds nothing up.
    const kids = new Map(goals.filter(c => c.parent === g.id && c.status !== 'dropped').map(c => [goalNode(c), c]));
    /** Whether a step on this goal is done; undefined when it isn't on this goal's chart. */
    const done = (id: string): boolean | undefined => {
      const t = byId.get(id);
      if (t) return t.goal === g.id ? taskDone(t, now) : undefined;
      const w = waits.get(id);
      if (w) return w.done;
      const c = kids.get(id);
      if (c) return c.status === 'achieved';
      const k = krs.get(id);
      if (k) return resultDone(k);
      const r = reps.get(id);
      return r ? repeatOver(r, doneBy.get(r.id) ?? 0, today, openOf(r.id).length > 0) : undefined;
    };
    for (const l of plan.links) {
      const r = reps.get(l.to);
      const held = r ? openOf(r.id) : [byId.get(l.to)];
      for (const t of held) {
        if (!t || t.goal !== g.id || t.status !== 'open') continue;
        if (done(l.from) === false) out.add(t.id);
      }
    }
  }
  return out;
}

/**
 * What's holding a goal up: its blocked steps, and the open steps right before them that aren't blocked themselves.
 * Finish those (or hear back on them) and things move.
 */
export function holdups(flow: Flow): { blocked: Step[]; by: Step[] } {
  const blocked = flow.steps.filter(s => s.state === 'blocked' && s.kind !== 'milestone');
  const by = new Map<string, Step>();
  for (const s of blocked) {
    for (const id of s.needs) {
      const n = flow.byId.get(id);
      if (n && !n.done && n.state !== 'blocked') by.set(n.id, n);
    }
  }
  return { blocked, by: [...by.values()] };
}

/* ---------- changing a plan ---------- */

/** A plan with one change, for patchGoal. Arrows that would loop, or that are already there, change nothing. */
export const withLink = (p: Plan, l: Link): Plan =>
  p.links.some(e => e.from === l.from && e.to === l.to) || wouldLoop(p.links, l.from, l.to) ? p : { ...p, links: [...p.links, l] };
export const withoutLink = (p: Plan, l: Link): Plan => ({ ...p, links: p.links.filter(e => !(e.from === l.from && e.to === l.to)) });
/** Take a step off the chart: its arrows go, and a waiting step goes with them, and where you'd put it. */
// Arrows the goal's structure draws aren't stored, so there's nothing to take off for those.
export const withoutStep = (p: Plan, id: string): Plan =>
  withPos({ links: p.links.filter(e => e.from !== id && e.to !== id), waits: p.waits.filter(w => w.id !== id), ...(p.pos ? { pos: p.pos } : {}) }, id, null);
/** Put a step at a place on the chart, or (null) let it be laid out again. */
export const withPos = (p: Plan, id: string, at: Pos | null): Plan => {
  const { [id]: _, ...rest } = p.pos ?? {};
  const pos = at ? { ...rest, [id]: { x: Math.min(POS_MAX, Math.max(0, Math.round(at.x))), y: Math.min(POS_MAX, Math.max(0, Math.round(at.y))) } } : rest;
  const { pos: __, ...base } = p;
  return Object.keys(pos).length ? { ...base, pos } : base;
};
/** Every step laid out for you again. */
export const withoutPos = (p: Plan): Plan => { const { pos: _, ...base } = p; return base; };
export const withWait = (p: Plan, w: Wait): Plan => ({ ...p, waits: [...p.waits.filter(x => x.id !== w.id), w] });
export const patchWait = (p: Plan, id: string, patch: Partial<Omit<Wait, 'id'>>): Plan => ({ ...p, waits: p.waits.map(w => (w.id === id ? { ...w, ...patch } : w)) });

/**
 * A new step alongside `id`: it needs what `id` needs and unblocks what `id` unblocks, so the two run in parallel.
 * Returns the arrows to add.
 */
export const parallelLinks = (p: Plan, id: string, fresh: string): Link[] => [
  ...p.links.filter(l => l.to === id).map(l => ({ from: l.from, to: fresh })),
  ...p.links.filter(l => l.from === id).map(l => ({ from: fresh, to: l.to })),
];

/* ---------- export ---------- */

const mm = (s: string) => s.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ');
const mmId = (id: string) => 'n_' + id.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * The chart as a Mermaid flowchart, the plain-text format GitHub, Notion and most docs tools draw: the goal as a stadium,
 * tasks as boxes, sub-goals as subroutines (the predefined-process box), waiting steps as flags and milestones as
 * diamonds, left to right.
 */
export function toMermaid(goal: Goal, flow: Flow): string {
  const shape = (s: Step) => {
    const t = mm(s.kind === 'wait' ? `Waiting on: ${s.title}` : s.repeat ? `${s.title} ↻ ${s.repeat.rule}` : s.title);
    return s.kind === 'milestone' ? `{"${t}"}` : s.kind === 'wait' ? `>"${t}"]` : s.kind === 'goal' ? `[["${t}"]]` : `["${t}"]`;
  };
  const lines = ['flowchart LR', `  goal(["${mm(goal.title)}"])`];
  for (const s of flow.steps) lines.push(`  ${mmId(s.id)}${shape(s)}${s.done ? ':::done' : s.state === 'blocked' ? ':::blocked' : ''}`);
  for (const id of flow.roots) lines.push(`  goal --> ${mmId(id)}`);
  for (const l of flow.links) lines.push(`  ${mmId(l.from)} ${l.auto ? '-.->' : '-->'} ${mmId(l.to)}`);
  lines.push('  classDef done fill:#e8f5e9,stroke:#2e7d32,color:#555;', '  classDef blocked stroke-dasharray: 4 3;');
  return lines.join('\n');
}

/** The chart as data: the goal, every step with its state, and every arrow. */
export function toJson(goal: Goal, flow: Flow) {
  return {
    goal: { id: goal.id, title: goal.title, by: goal.by, status: goal.status },
    steps: flow.steps.map(s => ({
      id: s.id, kind: s.kind, title: s.title, state: s.state, minutes: s.minutes || undefined,
      needs: s.needs.length ? s.needs : undefined, critical: s.critical || undefined,
      ...(s.kind === 'goal' && s.progress != null ? { progress: Math.round(s.progress * 100) / 100 } : {}),
      ...(s.repeat ? { repeats: s.repeat.rule, times_done: s.repeat.done } : {}),
    })),
    arrows: flow.links.map(l => ({ from: l.from, to: l.to, ...(l.auto ? { structure: true as const } : {}) })),
    critical_path: flow.critical.steps,
  };
}

/* ---------- the log ---------- */

/**
 * What happened to a goal's chart, one line each: a step added to it or taken off, an arrow drawn or removed, a step
 * finished or reopened, renamed, or a waiting step resolved. Kept in your synced settings under LOG_KEY, newest last.
 */
export type LogOp = 'add' | 'remove' | 'link' | 'unlink' | 'done' | 'reopen' | 'rename' | 'wait' | 'resolve' | 'unresolve' | 'tick' | 'untick';

export interface LogEntry {
  at: number;
  goal: string;
  op: LogOp;
  /** The step it's about, and its title then. */
  step?: string;
  title?: string;
  /** For an arrow: the step it starts from. */
  from?: string;
  fromTitle?: string;
  /** For a rename: what it was called before. */
  was?: string;
}

export const LOG_KEY = 'goal-log';
export const MAX_LOG = 4000;
const OPS = new Set<LogOp>(['add', 'remove', 'link', 'unlink', 'done', 'reopen', 'rename', 'wait', 'resolve', 'unresolve', 'tick', 'untick']);
const short = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 160) : undefined);

export function normalizeLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LogEntry[] = [];
  for (const x of raw.slice(-MAX_LOG)) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || typeof o.goal !== 'string' || !o.goal || !OPS.has(o.op as LogOp)) continue;
    const e: LogEntry = { at: o.at, goal: o.goal.slice(0, 40), op: o.op as LogOp };
    for (const k of ['step', 'title', 'from', 'fromTitle', 'was'] as const) { const v = short(o[k]); if (v) e[k] = v; }
    out.push(e);
  }
  return out;
}

const q = (s?: string) => `“${s ?? 'a step'}”`;

/** One entry in words: "Added “Draft the SPA”", "“Agree the price” now comes before “Draft the SPA”". */
export function describeEntry(e: LogEntry): string {
  switch (e.op) {
    case 'add': return `Added ${q(e.title)}`;
    case 'remove': return `Took ${q(e.title)} off the chart`;
    case 'link': return `${q(e.fromTitle)} now comes before ${q(e.title)}`;
    case 'unlink': return `${q(e.title)} no longer waits for ${q(e.fromTitle)}`;
    case 'done': return `Finished ${q(e.title)}`;
    case 'reopen': return `Reopened ${q(e.title)}`;
    case 'rename': return `Renamed ${q(e.was)} to ${q(e.title)}`;
    case 'wait': return `Waiting on ${q(e.title)}`;
    case 'resolve': return `No longer waiting on ${q(e.title)}`;
    case 'unresolve': return `Waiting on ${q(e.title)} again`;
    case 'tick': return `Reached ${q(e.title)}`;
    case 'untick': return `Unticked ${q(e.title)}`;
  }
}

/**
 * Tidy the log: a step renamed within a few minutes of being added (you typed its title) reads as added under its
 * name, rather than "Added “New step”" and a rename.
 */
export function coalesce(entries: LogEntry[], within = 5 * 60000): LogEntry[] {
  const out: LogEntry[] = [];
  for (const e of entries) {
    if (e.op === 'rename' && e.step) {
      let i = out.length - 1;
      while (i >= 0 && !(out[i].step === e.step && out[i].goal === e.goal)) i--;
      const prev = out[i];
      if (prev && (prev.op === 'add' || prev.op === 'wait') && e.at - prev.at <= within) { out[i] = { ...prev, title: e.title }; continue; }
    }
    out.push(e);
  }
  return out;
}

/** What a set of task writes did to your goals' charts: tasks added to a goal or taken off, finished, reopened, renamed. */
export function logFromWrites(changes: { before: Task | null; after: Task | null }[], now: number): LogEntry[] {
  const out: LogEntry[] = [];
  for (const { before: b, after: a } of changes) {
    const was = b?.goal ?? null, is = a?.goal ?? null;
    if (was && was !== is) out.push({ at: now, goal: was, op: 'remove', step: (b as Task).id, title: (b as Task).title });
    if (is && is !== was) out.push({ at: now, goal: is, op: a && a.status === 'done' && (!b || b.status !== 'done') ? 'done' : 'add', step: (a as Task).id, title: (a as Task).title });
    if (!a || !b || !is || is !== was) continue;
    if (a.status !== b.status) out.push({ at: now, goal: is, op: a.status === 'done' ? 'done' : 'reopen', step: a.id, title: a.title });
    if (a.title !== b.title) out.push({ at: now, goal: is, op: 'rename', step: a.id, title: a.title, was: b.title });
  }
  return out;
}
