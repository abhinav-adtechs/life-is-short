import { isEvent } from './select';
import type { Goal } from './goals';
import type { Step } from './flow';
import type { FlowTree } from './flowTree';

/*
 * A goal's route: its map read top to bottom, for a card on the main page and for a phone. What to do now, what else is
 * ready, what you're waiting on, what's still ahead on the way to the finish, the sub-goals, and what's done.
 *
 * The one to do now ("Up next") is the first step on the critical path you can start: a sub-goal there means the first
 * one you can start inside it. Failing that, the ready step on the calendar soonest, then the most urgent.
 */

export interface RouteItem {
  step: Step;
  /** The chart it's on: the goal's own, or a sub-goal's. */
  tree: FlowTree;
  /** The sub-goal it's on, when that's not the goal itself. */
  on: Goal | null;
}

export interface Route {
  next: RouteItem | null;
  /** What the next one opens up once it's done: steps it's the last thing in the way of. */
  opens: Step[];
  /** Everything else you can do now, on the goal and in its sub-goals. */
  ready: RouteItem[];
  /** What you're waiting on, on the goal and in its sub-goals. */
  waiting: RouteItem[];
  /** On the goal's own chart: the steps still locked and the key results still to reach, in the order they come. */
  ahead: RouteItem[];
  /** Its sub-goals, open ones first, each with its own chart. */
  subs: { step: Step; tree: FlowTree }[];
  /** On the goal's own chart: what's done, the latest first. */
  done: RouteItem[];
}

/** A step you can do something about right now: a task that's open, not a meeting, and nothing in its way. */
export const actionable = (s: Step) => s.kind === 'task' && s.state === 'ready' && !s.done && !!s.task && s.task.status === 'open' && !isEvent(s.task);

const order = (a: Step, b: Step) => a.col - b.col || a.row - b.row;

/** Ready steps the way to take them: on the calendar soonest, then most urgent, then as the chart has them. */
const byWhen = (a: Step, b: Step) =>
  (a.task?.start ?? Infinity) - (b.task?.start ?? Infinity) || (a.task?.priority ?? 2) - (b.task?.priority ?? 2) || order(a, b);

/** Every chart in the tree, the goal's own first, with the sub-goal each is for. */
function charts(tree: FlowTree): { tree: FlowTree; on: Goal | null }[] {
  const out: { tree: FlowTree; on: Goal | null }[] = [];
  const walk = (t: FlowTree, on: Goal | null) => {
    out.push({ tree: t, on });
    for (const s of t.flow.steps) {
      const sub = t.subs.get(s.id);
      if (sub && !s.done) walk(sub, sub.goal);
    }
  };
  walk(tree, null);
  return out;
}

/** The one to do now on a goal's tree, or null when there's nothing you can start. */
export function pickNext(tree: FlowTree, on: Goal | null = null): RouteItem | null {
  const { flow } = tree;
  // Along the critical path: the first step you can start, or the first you can start in a sub-goal there.
  for (const id of flow.critical.steps) {
    const s = flow.byId.get(id);
    if (!s || s.state !== 'ready') continue;
    if (actionable(s)) return { step: s, tree, on };
    const sub = tree.subs.get(id);
    if (sub) { const hit = pickNext(sub, sub.goal); if (hit) return hit; }
  }
  const ready = flow.steps.filter(actionable).sort(byWhen);
  if (ready.length) return { step: ready[0], tree, on };
  for (const s of [...flow.steps].sort(order)) {
    const sub = tree.subs.get(s.id);
    if (!sub || s.done || s.state === 'blocked') continue;
    const hit = pickNext(sub, sub.goal);
    if (hit) return hit;
  }
  return null;
}

/** The goal's route, from its tree (lib/flowTree.ts buildTree). */
export function routeOf(tree: FlowTree): Route {
  const next = pickNext(tree);
  const all = charts(tree);
  const opens = next
    ? next.step.unblocks.map(id => next.tree.flow.byId.get(id) as Step).filter(s => s && !s.done && s.needs.every(n => n === next.step.id || next.tree.flow.byId.get(n)?.done))
    : [];
  const ready = all.flatMap(c => c.tree.flow.steps.filter(s => actionable(s) && s !== next?.step).sort(byWhen).map(step => ({ step, tree: c.tree, on: c.on })));
  const waiting = all.flatMap(c => c.tree.flow.steps.filter(s => s.kind === 'wait' && !s.done).sort(order).map(step => ({ step, tree: c.tree, on: c.on })));
  const own = tree.flow.steps;
  const ahead = own.filter(s => !s.done && s.kind !== 'goal' && s.kind !== 'wait' && (s.kind === 'milestone' || s.state === 'blocked'))
    .sort(order).map(step => ({ step, tree, on: null }));
  const subs = own.filter(s => s.kind === 'goal').sort((a, b) => Number(a.done) - Number(b.done) || order(a, b))
    .map(step => ({ step, tree: tree.subs.get(step.id) as FlowTree })).filter(x => x.tree);
  const when = (s: Step) => s.task?.doneAt ?? s.wait?.doneAt ?? 0;
  const done = own.filter(s => s.done && s.kind !== 'goal').sort((a, b) => when(b) - when(a)).map(step => ({ step, tree, on: null }));
  return { next, opens, ready, waiting, ahead, subs, done };
}
