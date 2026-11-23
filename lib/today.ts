import type { Task } from './model';
import { descendantsOf, flatResults, resultDone, type Goal } from './goals';
import { isEvent } from './select';

/**
 * Today's plan: the goals you're focusing on today, and what each one produces by tonight, in plain words ("Term sheet
 * out to both leads"), with the tasks that make it. You agree it with Claude in the morning (the MCP tool plan_today)
 * and the day is planned: the calendar shows the outcomes across its top. Until then the day isn't planned and the
 * calendar shows nothing up there.
 *
 * Plans live in your synced settings under DAYS_KEY, one a day, the last MAX_DAYS days, so a day can be looked back on.
 */

export const DAYS_KEY = 'day-plans';
export const MAX_DAYS = 60;
/** Goals in focus on one day. */
export const MAX_FOCUS = 5;
export const OUTCOME_MAX = 140;
/** Tasks named for one outcome. */
export const MAX_STEPS = 8;

/** What one goal produces today. */
export interface Outcome {
  /** The goal's id. */
  goal: string;
  /** What's true by tonight, in plain words. */
  text: string;
  /** The tasks that make it, in order. Tasks on the goal that are on the calendar today count too. */
  tasks: string[];
}

export interface DayPlan {
  /** YYYY-MM-DD. */
  day: string;
  /** When it was planned. */
  at: number;
  /** Who planned it: Claude, over the connector, or you in the app. */
  by: 'claude' | 'app';
  /** The goals in focus, most important first. */
  focus: Outcome[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function cleanOutcome(raw: unknown): Outcome | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const goal = clean(o.goal, 40), text = clean(o.text, OUTCOME_MAX);
  if (!goal || !text) return null;
  const tasks = [...new Set((Array.isArray(o.tasks) ? o.tasks : []).map(t => clean(t, 80)).filter(Boolean))].slice(0, MAX_STEPS);
  return { goal, text, tasks };
}

/** Stored plans, cleaned up: junk dropped, one a day (the latest planned wins), oldest first, the last MAX_DAYS. */
export function normalizeDays(raw: unknown): DayPlan[] {
  const byDay = new Map<string, DayPlan>();
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (typeof o.day !== 'string' || !DAY.test(o.day)) continue;
    const seen = new Set<string>();
    const focus = (Array.isArray(o.focus) ? o.focus : []).map(cleanOutcome)
      .filter((f): f is Outcome => !!f && !seen.has(f.goal) && !!seen.add(f.goal)).slice(0, MAX_FOCUS);
    if (!focus.length) continue;
    const plan: DayPlan = { day: o.day, at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0, by: o.by === 'app' ? 'app' : 'claude', focus };
    const was = byDay.get(plan.day);
    if (!was || plan.at >= was.at) byDay.set(plan.day, plan);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-MAX_DAYS);
}

/** The plan for a day, or null while it isn't planned. */
export const planOn = (days: DayPlan[], day: string): DayPlan | null => days.find(p => p.day === day && p.focus.length > 0) ?? null;

export type DaysFn = (days: DayPlan[]) => DayPlan[];

/** Plan a day, in place of any plan it had. A plan with nothing in focus un-plans the day. */
export const setPlan = (plan: DayPlan): DaysFn => days =>
  normalizeDays([...days.filter(p => p.day !== plan.day), ...(plan.focus.length ? [plan] : [])]);

/** The day isn't planned any more. */
export const clearPlan = (day: string): DaysFn => days => days.filter(p => p.day !== day);

/* ---------- how an outcome is going ---------- */

export interface OutcomeView {
  outcome: Outcome;
  goal: Goal;
  /** Today's steps: the tasks named for it, then the goal's other tasks on the calendar today or ticked off today. */
  steps: Task[];
  /** How many of today's steps are done. */
  done: number;
  /** The goal's tasks (its sub-goals' too): done now, done by tonight if today's steps get done, and in all. */
  tasks: { done: number; tonight: number; all: number };
  /** The goal's key results (the top ones): done, and in all. */
  results: { done: number; all: number };
}

/**
 * How one of today's outcomes stands over the day [from, to): its steps and the goal's numbers. Counted by tasks and
 * key results, never by time. Null when its goal is gone.
 */
export function outcomeView(o: Outcome, goals: Goal[], tasks: Task[], from: number, to: number): OutcomeView | null {
  const goal = goals.find(g => g.id === o.goal);
  if (!goal) return null;
  const tree = new Set([goal.id, ...descendantsOf(goals, goal.id).map(g => g.id)]);
  const mine = tasks.filter(t => !isEvent(t));
  const byId = new Map(mine.map(t => [t.id, t]));
  const named = o.tasks.map(id => byId.get(id)).filter((t): t is Task => !!t);
  const ids = new Set(named.map(t => t.id));
  const today = (t: Task) => (t.start != null ? t.start >= from && t.start < to : t.status === 'done' && t.doneAt != null && t.doneAt >= from && t.doneAt < to);
  const more = mine.filter(t => t.goal && tree.has(t.goal) && !ids.has(t.id) && today(t))
    .sort((a, b) => (a.start ?? a.doneAt ?? 0) - (b.start ?? b.doneAt ?? 0));
  const steps = [...named, ...more];
  const onGoal = mine.filter(t => t.goal && tree.has(t.goal));
  const doneNow = onGoal.filter(t => t.status === 'done').length;
  const openSteps = steps.filter(t => t.status === 'open' && t.goal && tree.has(t.goal)).length;
  const tops = flatResults(goal.results).filter(x => !x.parent).map(x => x.kr);
  return {
    outcome: o, goal, steps,
    done: steps.filter(t => t.status === 'done').length,
    tasks: { done: doneNow, tonight: doneNow + openSteps, all: onGoal.length },
    results: { done: tops.filter(resultDone).length, all: tops.length },
  };
}

/**
 * The goals today moves, for the Today view. Planned: the plan's goals in focus, in its order, each with its outcome.
 * Not planned: your top goals with work on the calendar today or ticked off today, in your order, with no outcome
 * (`outcome.text` is empty). Goals with nothing today aren't in it either way: the view is only today's.
 */
export function movingToday(plan: DayPlan | null, goals: Goal[], tops: Goal[], tasks: Task[], from: number, to: number): OutcomeView[] {
  const view = (o: Outcome) => outcomeView(o, goals, tasks, from, to);
  if (plan) return plan.focus.flatMap(o => { const v = view(o); return v ? [v] : []; });
  return tops.flatMap(g => { const v = view({ goal: g.id, text: '', tasks: [] }); return v && v.steps.length ? [v] : []; });
}
