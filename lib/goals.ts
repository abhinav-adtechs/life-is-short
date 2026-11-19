import type { Task } from './model';
import { normalizePlan, type Plan } from './flow';
import { OFF_GOAL, isEvent } from './select';
import { endOf } from './time';

/**
 * Goals: the few specific outcomes you're working towards right now, like an objective with its key results. Each
 * sits in one of your sections (a label: Work, Personal…), and every task either moves a goal or is off-goal, which is
 * fine as long as you know it. Goals live in your synced settings under GOALS_KEY, in the order you rank them.
 *
 * They nest the way OKRs cascade: a goal (an objective) can have sub-goals, under the goal itself or under one of its
 * key results ("to get the shares transferred, close the lawyer's side"), and a key result can have key results of its
 * own. Progress rolls up: a key result is done when ticked or when everything under it is, and a goal's progress is
 * the mean of its key results and its sub-goals.
 */

/** A finish line for a goal: "Term sheet signed". Ticked when it's true. It can break down into key results of its own. */
export interface KeyResult { id: string; text: string; done: boolean; results?: KeyResult[] }

export type GoalStatus = 'active' | 'achieved' | 'dropped';

export interface Goal {
  id: string;
  /** Specific and finishable: "Give Sam an exit", not "Fundraising". */
  title: string;
  /** The section (label id) it belongs to; its tasks take that section. */
  section: string | null;
  /** What has to be true for it to count as done. */
  results: KeyResult[];
  /** The goal it's part of, for a sub-goal; null or missing for one of your top goals. */
  parent?: string | null;
  /** The parent's key result it's there for, if it serves one in particular. */
  parentKr?: string | null;
  /** YYYY-MM-DD to get it done by, or null. */
  by: string | null;
  status: GoalStatus;
  /** Its flow chart: the arrows between its steps and what it's waiting on (lib/flow.ts). Missing for none yet. */
  plan?: Plan;
  created: number;
  /** When it was achieved or dropped. */
  closedAt: number | null;
  updatedAt: number;
}

export const GOALS_KEY = 'goals';
/** How many top goals to focus on at once. More is allowed, with a nudge. Sub-goals don't count. */
export const FOCUS_GOALS = 5;
export const MAX_ACTIVE = 8;
export const MAX_GOALS = 160;
export const GOAL_TITLE_MAX = 80;
export const RESULT_MAX = 120;
/** Key results under one goal or one key result. */
export const MAX_RESULTS = 8;
/** How deep key results nest (3: a key result, its key results, and theirs), and how many a goal can have in all. */
export const MAX_KR_DEPTH = 3;
export const MAX_ALL_RESULTS = 40;
/** How deep sub-goals go under a top goal. */
export const MAX_GOAL_DEPTH = 4;

export const newGoalId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const newResultId = () => 'k' + Math.random().toString(36).slice(2, 8);

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Key results, cleaned up: each with an id unique in the goal, nested at most MAX_KR_DEPTH deep, MAX_ALL_RESULTS in all. */
function cleanResults(raw: unknown, depth: number, ids: Set<string>, count: { n: number }): KeyResult[] {
  const out: KeyResult[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const k = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const text = clean(k.text, RESULT_MAX);
    if (!text || out.length >= MAX_RESULTS || count.n >= MAX_ALL_RESULTS) continue;
    count.n++;
    let kid = typeof k.id === 'string' && ID.test(k.id) && !ids.has(k.id) ? k.id : `k${count.n}`;
    while (ids.has(kid)) kid += 'x';
    ids.add(kid);
    const sub = depth < MAX_KR_DEPTH ? cleanResults(k.results, depth + 1, ids, count) : [];
    out.push({ id: kid, text, done: k.done === true, ...(sub.length ? { results: sub } : {}) });
  }
  return out;
}

/**
 * Stored goals, cleaned up: junk dropped, duplicates and extras cut. A sub-goal's parent has to be there, not loop
 * back to it, and be at most MAX_GOAL_DEPTH up; its key result has to be the parent's. At most MAX_ACTIVE top goals are
 * active.
 */
export function normalizeGoals(raw: unknown): Goal[] {
  if (!Array.isArray(raw)) return [];
  const out: Goal[] = [];
  const asked = new Map<string, { parent: unknown; kr: unknown }>();
  for (const x of raw) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    const title = clean(o.title, GOAL_TITLE_MAX);
    if (!id || !title || out.length >= MAX_GOALS || out.some(g => g.id === id)) continue;
    const status: GoalStatus = o.status === 'achieved' || o.status === 'dropped' ? o.status : 'active';
    asked.set(id, { parent: o.parent, kr: o.parentKr });
    out.push({
      id, title,
      section: typeof o.section === 'string' && ID.test(o.section) ? o.section : null,
      results: cleanResults(o.results, 1, new Set(), { n: 0 }),
      by: typeof o.by === 'string' && DAY.test(o.by) ? o.by : null,
      status,
      ...(o.plan ? (p => (p.links.length || p.waits.length ? { plan: p } : {}))(normalizePlan(o.plan)) : {}),
      created: num(o.created, 0),
      closedAt: status === 'active' ? null : num(o.closedAt, num(o.updatedAt, 0)),
      updatedAt: num(o.updatedAt, 0),
    });
  }
  // Parents, once every goal is known. One that would loop, or sit too deep, becomes a top goal.
  const byId = new Map(out.map(g => [g.id, g]));
  for (const g of out) {
    const want = asked.get(g.id) as { parent: unknown; kr: unknown };
    if (typeof want.parent !== 'string' || !byId.has(want.parent) || want.parent === g.id) continue;
    let depth = 1, loops = false;
    for (let up = byId.get(want.parent); up; up = up.parent ? byId.get(up.parent) : undefined) {
      if (up.id === g.id) { loops = true; break; }
      if (++depth > MAX_GOAL_DEPTH + 1) { loops = true; break; }
    }
    if (loops) continue;
    g.parent = want.parent;
    const p = byId.get(want.parent) as Goal;
    if (typeof want.kr === 'string' && findResult(p.results, want.kr)) g.parentKr = want.kr;
  }
  for (const g of out) {
    if (!g.parent) continue;
    const up = ancestorsOf(byId, g);
    // A sub-goal is in its top goal's section.
    g.section = (up[up.length - 1] ?? g).section;
    // An active sub-goal under a closed goal went with it.
    const closed = g.status === 'active' ? up.find(a => a.status !== 'active') : undefined;
    if (closed) { g.status = closed.status; g.closedAt = closed.closedAt; }
  }
  let active = 0;
  for (const g of out) {
    if (g.parent || g.status !== 'active' || ++active <= MAX_ACTIVE) continue;
    g.status = 'dropped';
    g.closedAt = g.updatedAt;
  }
  return out;
}

/* ---------- the tree ---------- */

export const isTop = (g: Pick<Goal, 'parent'>) => !g.parent;

/** A goal's sub-goals, in your order. */
export const childrenOf = (goals: Goal[], id: string) => goals.filter(g => g.parent === id);

/** Every goal under this one, depth first. */
export function descendantsOf(goals: Goal[], id: string): Goal[] {
  return childrenOf(goals, id).flatMap(c => [c, ...descendantsOf(goals, c.id)]);
}

/** The goals above this one, nearest first. */
export function ancestorsOf(index: Map<string, Goal>, g: Goal): Goal[] {
  const out: Goal[] = [];
  for (let up = g.parent ? index.get(g.parent) : undefined; up && out.length <= MAX_GOAL_DEPTH; up = up.parent ? index.get(up.parent) : undefined) out.push(up);
  return out;
}

/** The top goal a goal is part of: itself, for a top goal. */
export const rootOf = (index: Map<string, Goal>, g: Goal) => ancestorsOf(index, g).pop() ?? g;

/** The goals as a tree, depth first in your order: each with how deep it is (0 for a top goal). */
export function goalTree(goals: Goal[], keep: (g: Goal) => boolean = () => true): { goal: Goal; depth: number }[] {
  const walk = (parent: string | null, depth: number): { goal: Goal; depth: number }[] =>
    goals.filter(g => (g.parent ?? null) === parent && keep(g)).flatMap(g => [{ goal: g, depth }, ...walk(g.id, depth + 1)]);
  return walk(null, 0);
}

/** A key result anywhere in a goal's tree, by id. */
export function findResult(results: KeyResult[], id: string): KeyResult | null {
  for (const r of results) {
    if (r.id === id) return r;
    const sub = r.results ? findResult(r.results, id) : null;
    if (sub) return sub;
  }
  return null;
}

/** Every key result, depth first: each with how deep it is (0 at the top) and the one it's under. */
export function flatResults(results: KeyResult[], depth = 0, parent: string | null = null): { kr: KeyResult; depth: number; parent: string | null }[] {
  return results.flatMap(kr => [{ kr, depth, parent }, ...flatResults(kr.results ?? [], depth + 1, kr.id)]);
}

/** Change, add under, or remove (null) key results anywhere in the tree. */
export function mapResults(results: KeyResult[], f: (kr: KeyResult) => KeyResult | null): KeyResult[] {
  const out: KeyResult[] = [];
  for (const r of results) {
    const next = f(r);
    if (!next) continue;
    const sub = next.results ? mapResults(next.results, f) : undefined;
    out.push(sub && sub.length ? { ...next, results: sub } : (({ results: _, ...rest }) => rest)(next));
  }
  return out;
}

/** A key result is done when ticked, or when everything under it is. */
export const resultDone = (kr: KeyResult): boolean => kr.done || (!!kr.results?.length && kr.results.every(resultDone));

/** How far along a key result is, 0 to 1: done, or the mean of what's under it. */
export const resultProgress = (kr: KeyResult): number =>
  resultDone(kr) ? 1 : kr.results?.length ? kr.results.reduce((n, r) => n + resultProgress(r), 0) / kr.results.length : 0;

/**
 * How far along a goal is, 0 to 1: the mean of its key results and the sub-goals that serve the goal as a whole. A key
 * result counts its own sub-results and the sub-goals that serve it; an achieved sub-goal counts as all the way, a
 * dropped one not at all. Null with nothing to count. An achieved goal is 1.
 */
export function goalProgress(g: Goal, goals: Goal[]): number | null {
  if (g.status === 'achieved') return 1;
  const subs = childrenOf(goals, g.id).filter(c => c.status !== 'dropped');
  const mean = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
  const kr = (r: KeyResult): number => {
    if (resultDone(r)) return 1;
    const parts = [...(r.results ?? []).map(kr), ...subs.filter(c => c.parentKr === r.id).map(c => goalProgress(c, goals) ?? 0)];
    return parts.length ? mean(parts) : 0;
  };
  const parts = [
    ...g.results.map(kr),
    ...subs.filter(c => !(c.parentKr && findResult(g.results, c.parentKr))).map(c => goalProgress(c, goals) ?? 0),
  ];
  return parts.length ? mean(parts) : null;
}

/** A goal's open key results as lines, each under its parents ("Shares transferred › Board approves"); leaves only. */
export function openResults(g: Goal): string[] {
  const walk = (l: KeyResult[], path: string): string[] =>
    l.filter(r => !resultDone(r)).flatMap(r => (r.results?.some(x => !resultDone(x)) ? walk(r.results, `${path}${r.text} › `) : [`${path}${r.text}`]));
  return walk(g.results, '');
}

/** A key result's text as an outline line under its parents: "Shares transferred › Board approves". */
export const resultPath = (g: Goal, id: string): string => {
  const hit = flatResults(g.results).find(x => x.kr.id === id);
  if (!hit) return '';
  return hit.parent ? `${resultPath(g, hit.parent)} › ${hit.kr.text}` : hit.kr.text;
};

/* ---------- key results as an outline, for typing them ---------- */

export interface ResultDraft { text: string; results?: ResultDraft[] }

/** Key results as indented lines, two spaces a level. */
export const outlineOf = (results: KeyResult[], depth = 0): string =>
  results.map(r => `${'  '.repeat(depth)}${r.text}${r.results?.length ? `\n${outlineOf(r.results, depth + 1)}` : ''}`).join('\n');

/** Indented lines (spaces, tabs or "- " bullets) as nested key results. A line indented further than the one above it goes under it. */
export function parseOutline(text: string): ResultDraft[] {
  const root: ResultDraft[] = [];
  const stack: { indent: number; list: ResultDraft[] }[] = [{ indent: -1, list: root }];
  for (const line of text.split('\n')) {
    const m = /^(\s*)(?:[-*•]\s+)?(.*)$/.exec(line.replace(/\t/g, '  ')) as RegExpExecArray;
    const body = m[2].trim();
    if (!body) continue;
    const indent = m[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const item: ResultDraft = { text: body };
    parent.list.push(item);
    // What's under it, should a deeper line follow, but never past MAX_KR_DEPTH levels: deeper lines join the last level.
    if (stack.length < MAX_KR_DEPTH) { item.results = []; stack.push({ indent, list: item.results }); }
  }
  const prune = (l: ResultDraft[]): ResultDraft[] => l.map(d => (d.results?.length ? { text: d.text, results: prune(d.results) } : { text: d.text }));
  return prune(root);
}

/** Typed key results over the ones a goal has: one with the same text under the same parent keeps its id and tick. */
export function mergeResults(old: KeyResult[], drafts: ResultDraft[]): KeyResult[] {
  const used = new Set<string>();
  return drafts.slice(0, MAX_RESULTS).map(d => {
    const was = old.find(r => r.text === clean(d.text, RESULT_MAX) && !used.has(r.id));
    if (was) used.add(was.id);
    const sub = mergeResults(was?.results ?? [], d.results ?? []);
    return { id: was?.id ?? newResultId(), text: clean(d.text, RESULT_MAX), done: was?.done ?? false, ...(sub.length ? { results: sub } : {}) };
  }).filter(r => r.text);
}

export const activeGoals = (goals: Goal[]) => goals.filter(g => g.status === 'active');
/** The active top goals, in your order: the matrix's rows. */
export const topGoals = (goals: Goal[]) => goals.filter(g => g.status === 'active' && isTop(g));

/** A goal's id from the model or the parser: an active goal's id, or failing that a title it names. */
export function pickGoal(goals: Goal[], v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const live = activeGoals(goals);
  return live.find(g => g.id === v.trim())?.id ?? goalNamed(live, v)?.id ?? null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The active goal a #tag names: its whole title, its id, or its first word that isn't a filler. */
export function goalNamed(goals: Goal[], word: string): Goal | null {
  const w = squash(word);
  if (!w) return null;
  const live = activeGoals(goals);
  return live.find(g => squash(g.title) === w || squash(g.id) === w)
    ?? live.find(g => keyWords(g.title).includes(w))
    ?? null;
}

const FILLER = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'my', 'get', 'give', 'make', 'do', 'be', 'in', 'on', 'by', 'with']);
const keyWords = (title: string) => title.split(/\s+/).map(squash).filter(w => w.length > 1 && !FILLER.has(w));

/**
 * How a task sits among your goals for the backlog's order (lib/select.ts): 0 for one on your top goal (or any goal
 * under it), 1 for the next, and so on; OFF_GOAL for off-goal work, or one on a goal that's achieved or dropped.
 */
export function goalRanker(goals: Goal[]) {
  const index = new Map(goals.map(g => [g.id, g]));
  const rank = new Map(topGoals(goals).map((g, i) => [g.id, i]));
  return (t: Pick<Task, 'goal'>) => {
    const g = t.goal ? index.get(t.goal) : undefined;
    return g && g.status === 'active' ? rank.get(rootOf(index, g).id) ?? OFF_GOAL : OFF_GOAL;
  };
}

/** The goal a task moves, while that goal is still one you're working on; achieved and dropped ones count as off-goal. */
export function activeGoalOf(t: Pick<Task, 'goal'>, index: Map<string, Goal>): Goal | null {
  const g = t.goal ? index.get(t.goal) : undefined;
  return g && g.status === 'active' ? g : null;
}

/** The section a task takes from its goal (a sub-goal's top goal), or null when its own (or its calendar's) applies. */
export function goalSection(t: Pick<Task, 'goal'>, index: Map<string, Goal>): string | null {
  const g = t.goal ? index.get(t.goal) : undefined;
  return g ? rootOf(index, g).section ?? null : null;
}

/** Time for one goal ('' is off-goal) over a span. */
export interface GoalTally {
  /** Minutes done: tasks ticked off and meetings that have happened. */
  spent: number;
  /** Minutes still on the calendar in the span, not done yet. */
  planned: number;
  /** Tasks ticked off and meetings held. */
  done: number;
}

const blank = (): GoalTally => ({ spent: 0, planned: 0, done: 0 });

/**
 * Where the time went in [from, to): per goal id, '' for off-goal. A task counts on its slot, or if it never had one,
 * on the day it was ticked off. A Google meeting counts once it's over; one still to come, and a task still open on
 * the calendar, count as planned.
 */
export function tallyGoals(tasks: Task[], from: number, to: number, now: number, goalOf: (t: Task) => string = t => t.goal ?? '') {
  const out = new Map<string, GoalTally>();
  const at = (k: string) => { let v = out.get(k); if (!v) { v = blank(); out.set(k, v); } return v; };
  for (const t of tasks) {
    const k = goalOf(t);
    if (isEvent(t)) {
      if (t.start == null || t.start >= to || endOf(t) <= from) continue;
      if (endOf(t) <= now) { at(k).spent += t.minutes; at(k).done++; } else at(k).planned += t.minutes;
      continue;
    }
    if (t.status === 'done') {
      const when = t.start ?? t.doneAt;
      if (when == null || when < from || when >= to) continue;
      at(k).spent += t.minutes; at(k).done++;
      continue;
    }
    if (t.start != null && t.start >= from && t.start < to) at(k).planned += t.minutes;
  }
  return out;
}

/** The share of done time that went to goals: 0 to 1, or null with nothing done. */
export function onGoalShare(tally: Map<string, GoalTally>): number | null {
  let on = 0, off = 0;
  for (const [k, v] of tally) { if (k) on += v.spent; else off += v.spent; }
  return on + off ? on / (on + off) : null;
}

/** Key results done, as "2 of 3", or null with none set. */
export const resultsLine = (g: Goal) => (g.results.length ? `${g.results.filter(resultDone).length} of ${g.results.length}` : null);

/* ---------- changes, as pure functions of the list ---------- */

export type GoalsFn = (list: Goal[]) => Goal[];

export const addGoal = (g: Goal): GoalsFn => list => (list.some(x => x.id === g.id) ? list : [...list, g]);

/** Change a goal. A new section goes to the goals under it too: a sub-goal is in its top goal's section. */
export const patchGoal = (id: string, patch: Partial<Omit<Goal, 'id'>>, now = Date.now()): GoalsFn => list => {
  const under = 'section' in patch ? new Set(descendantsOf(list, id).map(g => g.id)) : new Set<string>();
  return list.map(g => (g.id === id ? { ...g, ...patch, updatedAt: now } : under.has(g.id) ? { ...g, section: patch.section ?? null, updatedAt: now } : g));
};

/**
 * Achieve, drop or bring back a goal. Closing one closes the open goals under it the same way; bringing one back
 * brings back the goals above it too, and a top goal comes back last among the active ones.
 */
export const setGoalStatus = (id: string, status: GoalStatus, now = Date.now()): GoalsFn => list => {
  const g = list.find(x => x.id === id);
  if (!g || g.status === status) return list;
  const index = new Map(list.map(x => [x.id, x]));
  const touched = new Set([id, ...(status === 'active'
    ? ancestorsOf(index, g).filter(a => a.status !== 'active').map(a => a.id)
    : descendantsOf(list, id).filter(d => d.status === 'active').map(d => d.id))]);
  const set = (x: Goal): Goal => ({ ...x, status, closedAt: status === 'active' ? null : now, updatedAt: now });
  const next = list.map(x => (touched.has(x.id) ? set(x) : x));
  if (status !== 'active') return next;
  // Back among the active top goals, last.
  const top = next.find(x => touched.has(x.id) && isTop(x));
  if (!top || top.id !== rootOf(index, g).id) return next;
  const rest = next.filter(x => x.id !== top.id);
  const lastActive = rest.reduce((n, x, i) => (x.status === 'active' && isTop(x) ? i : n), -1);
  return [...rest.slice(0, lastActive + 1), top, ...rest.slice(lastActive + 1)];
};

/** Move an active goal up (-1) or down (+1) among the active goals beside it (same parent). */
export const moveGoal = (id: string, by: -1 | 1): GoalsFn => list => {
  const g = list.find(x => x.id === id);
  if (!g) return list;
  const same = (x: Goal) => x.status === 'active' && (x.parent ?? null) === (g.parent ?? null);
  const live = list.filter(same);
  const i = live.findIndex(x => x.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= live.length) return list;
  [live[i], live[j]] = [live[j], live[i]];
  let k = 0;
  return list.map(x => (same(x) ? live[k++] : x));
};

/** Delete a goal and every goal under it. */
export const removeGoal = (id: string): GoalsFn => list => {
  const gone = new Set([id, ...descendantsOf(list, id).map(g => g.id)]);
  return list.filter(g => !gone.has(g.id));
};

/** Add a key result under another (or at the top, with `under` null). */
export const addResult = (goal: string, under: string | null, text: string, now = Date.now(), id = newResultId()): GoalsFn => list =>
  list.map(g => {
    if (g.id !== goal) return g;
    const kr: KeyResult = { id, text: clean(text, RESULT_MAX), done: false };
    const results = under == null ? [...g.results, kr] : mapResults(g.results, r => (r.id === under ? { ...r, results: [...(r.results ?? []), kr] } : r));
    return { ...g, results, updatedAt: now };
  });

/** Change a key result anywhere in a goal's tree, or remove it (and what's under it) with null. */
export const patchResult = (goal: string, id: string, patch: Partial<Pick<KeyResult, 'text' | 'done'>> | null, now = Date.now()): GoalsFn => list =>
  list.map(g => (g.id !== goal ? g : { ...g, results: mapResults(g.results, r => (r.id !== id ? r : patch ? { ...r, ...patch } : null)), updatedAt: now }));

/** A new goal, ready to add: a top goal, or one under `parent` (and its key result `parentKr`). */
export function makeGoal(v: {
  title: string; section: string | null; results?: (string | ResultDraft)[]; by?: string | null; parent?: string | null; parentKr?: string | null;
}, now = Date.now(), id = newGoalId()): Goal {
  const drafts = (v.results ?? []).map(r => (typeof r === 'string' ? { text: r } : r));
  return {
    id, title: clean(v.title, GOAL_TITLE_MAX), section: v.section,
    results: mergeResults([], drafts).slice(0, MAX_RESULTS),
    by: v.by && DAY.test(v.by) ? v.by : null, status: 'active', created: now, closedAt: null, updatedAt: now,
    ...(v.parent ? { parent: v.parent, ...(v.parentKr ? { parentKr: v.parentKr } : {}) } : {}),
  };
}
