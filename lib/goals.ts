import type { Task } from './model';
import { OFF_GOAL, isEvent } from './select';
import { endOf } from './time';

/**
 * Goals: the few specific outcomes you're working towards right now, like an objective with its key results. Each
 * sits in one of your sections (a label: Work, Personal…), and every task either moves a goal or is off-goal, which is
 * fine as long as you know it. Goals live in your synced settings under GOALS_KEY, in the order you rank them.
 */

/** A finish line for a goal: "Term sheet signed". Ticked when it's true. */
export interface KeyResult { id: string; text: string; done: boolean }

export type GoalStatus = 'active' | 'achieved' | 'dropped';

export interface Goal {
  id: string;
  /** Specific and finishable: "Give Sam an exit", not "Fundraising". */
  title: string;
  /** The section (label id) it belongs to; its tasks take that section. */
  section: string | null;
  /** What has to be true for it to count as done. */
  results: KeyResult[];
  /** YYYY-MM-DD to get it done by, or null. */
  by: string | null;
  status: GoalStatus;
  created: number;
  /** When it was achieved or dropped. */
  closedAt: number | null;
  updatedAt: number;
}

export const GOALS_KEY = 'goals';
/** How many goals to focus on at once. More is allowed, with a nudge. */
export const FOCUS_GOALS = 5;
export const MAX_ACTIVE = 8;
export const MAX_GOALS = 80;
export const GOAL_TITLE_MAX = 80;
export const RESULT_MAX = 120;
export const MAX_RESULTS = 6;

export const newGoalId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const newResultId = () => 'k' + Math.random().toString(36).slice(2, 8);

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Stored goals, cleaned up: junk dropped, duplicates and extras cut, at most MAX_ACTIVE active. */
export function normalizeGoals(raw: unknown): Goal[] {
  if (!Array.isArray(raw)) return [];
  const out: Goal[] = [];
  let active = 0;
  for (const x of raw) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    const title = clean(o.title, GOAL_TITLE_MAX);
    if (!id || !title || out.length >= MAX_GOALS || out.some(g => g.id === id)) continue;
    let status: GoalStatus = o.status === 'achieved' || o.status === 'dropped' ? o.status : 'active';
    if (status === 'active' && ++active > MAX_ACTIVE) status = 'dropped';
    const results: KeyResult[] = [];
    for (const r of Array.isArray(o.results) ? o.results : []) {
      const k = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      const text = clean(k.text, RESULT_MAX);
      if (!text || results.length >= MAX_RESULTS) continue;
      const kid = typeof k.id === 'string' && ID.test(k.id) && !results.some(e => e.id === k.id) ? k.id : `k${results.length + 1}`;
      results.push({ id: kid, text, done: k.done === true });
    }
    out.push({
      id, title,
      section: typeof o.section === 'string' && ID.test(o.section) ? o.section : null,
      results,
      by: typeof o.by === 'string' && DAY.test(o.by) ? o.by : null,
      status,
      created: num(o.created, 0),
      closedAt: status === 'active' ? null : num(o.closedAt, num(o.updatedAt, 0)),
      updatedAt: num(o.updatedAt, 0),
    });
  }
  return out;
}

export const activeGoals = (goals: Goal[]) => goals.filter(g => g.status === 'active');

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
 * How a task sits among your goals for the backlog's order (lib/select.ts): 0 for one on your top goal, 1 for the
 * next, and so on; OFF_GOAL for off-goal work, or one on a goal that's achieved or dropped.
 */
export function goalRanker(goals: Goal[]) {
  const rank = new Map(activeGoals(goals).map((g, i) => [g.id, i]));
  return (t: Pick<Task, 'goal'>) => (t.goal ? rank.get(t.goal) ?? OFF_GOAL : OFF_GOAL);
}

/** The goal a task moves, while that goal is still one you're working on; achieved and dropped ones count as off-goal. */
export function activeGoalOf(t: Pick<Task, 'goal'>, index: Map<string, Goal>): Goal | null {
  const g = t.goal ? index.get(t.goal) : undefined;
  return g && g.status === 'active' ? g : null;
}

/** The section a task takes from its goal, or null when its own (or its calendar's) applies. */
export function goalSection(t: Pick<Task, 'goal'>, index: Map<string, Goal>): string | null {
  const g = t.goal ? index.get(t.goal) : undefined;
  return g?.section ?? null;
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

/** Key results ticked, as "2 of 3", or null with none set. */
export const resultsLine = (g: Goal) => (g.results.length ? `${g.results.filter(r => r.done).length} of ${g.results.length}` : null);

/* ---------- changes, as pure functions of the list ---------- */

export type GoalsFn = (list: Goal[]) => Goal[];

export const addGoal = (g: Goal): GoalsFn => list => (list.some(x => x.id === g.id) ? list : [...list, g]);

export const patchGoal = (id: string, patch: Partial<Omit<Goal, 'id'>>, now = Date.now()): GoalsFn => list =>
  list.map(g => (g.id === id ? { ...g, ...patch, updatedAt: now } : g));

/** Achieve, drop or bring back a goal. Bringing one back puts it last among the active ones. */
export const setGoalStatus = (id: string, status: GoalStatus, now = Date.now()): GoalsFn => list => {
  const g = list.find(x => x.id === id);
  if (!g || g.status === status) return list;
  const next = { ...g, status, closedAt: status === 'active' ? null : now, updatedAt: now };
  const rest = list.filter(x => x.id !== id);
  if (status !== 'active') return list.map(x => (x.id === id ? next : x));
  const lastActive = rest.reduce((n, x, i) => (x.status === 'active' ? i : n), -1);
  return [...rest.slice(0, lastActive + 1), next, ...rest.slice(lastActive + 1)];
};

/** Move an active goal up (-1) or down (+1) among the active ones. */
export const moveGoal = (id: string, by: -1 | 1): GoalsFn => list => {
  const live = list.filter(g => g.status === 'active');
  const i = live.findIndex(g => g.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= live.length) return list;
  [live[i], live[j]] = [live[j], live[i]];
  let k = 0;
  return list.map(g => (g.status === 'active' ? live[k++] : g));
};

export const removeGoal = (id: string): GoalsFn => list => list.filter(g => g.id !== id);

/** A new goal, ready to add. */
export function makeGoal(v: { title: string; section: string | null; results?: string[]; by?: string | null }, now = Date.now(), id = newGoalId()): Goal {
  return {
    id, title: clean(v.title, GOAL_TITLE_MAX), section: v.section,
    results: (v.results ?? []).map(t => clean(t, RESULT_MAX)).filter(Boolean).slice(0, MAX_RESULTS).map(text => ({ id: newResultId(), text, done: false })),
    by: v.by && DAY.test(v.by) ? v.by : null, status: 'active', created: now, closedAt: null, updatedAt: now,
  };
}
