import type { Task } from './model';
import { MIN, addDays, endOf, startOfDay, ymd } from './time';
import { BACKLOG_GRACE, isEvent } from './select';
import { isHex, mix } from './color';
import type { ThemeId } from './prefs';

/*
 * What the iPhone and iPad widgets show (apple/Widgets, docs/apple.md → Widgets). The planner hands the app a small
 * picture of the day through the bridge (lib/native.ts → sendWidget), the app keeps it where its widgets can read it,
 * and the widgets work out Now and Next from it for themselves as the day goes on
 * (apple/Core/Sources/LifeIsShortCore/WidgetTimeline.swift, the same rules as lib/select.ts → focus). So a widget stays
 * right between visits: a slot starts, the next one ends, a missed one goes back to the backlog.
 *
 * apple/Core/Sources/LifeIsShortCore/WidgetSnapshot.swift reads it, with the same limits.
 */

export const WIDGET_VERSION = 1;
/** Things on the calendar it carries: from an hour ago (a missed slot's grace) to the end of tomorrow. */
export const MAX_TIMED = 30;
/** The top of the backlog it carries, in the order Now picks from. */
export const MAX_BACKLOG = 8;
export const TITLE_MAX = 120;
export const GOAL_MAX = 80;
export const MAX_OUTCOMES = 5;

export interface WidgetItem {
  id: string;
  title: string;
  /** Epoch ms when it's on the calendar; absent for the backlog. */
  start?: number;
  minutes: number;
  priority: 1 | 2 | 3;
  /** YYYY-MM-DD deadline. */
  due?: string;
  /** The goal it moves. */
  goal?: string;
  /** Its section's colour, #RRGGBB. */
  color?: string;
  /** A Google Calendar event: busy time, not a task to do. */
  event?: true;
  /** On the backlog, but held up by a step before it on its goal's chart. */
  blocked?: true;
}

export interface WidgetOutcome {
  goal: string;
  color?: string;
  /** What's true by tonight. */
  text: string;
  /** Today's steps: done, and in all. */
  done: number;
  steps: number;
}

export type WidgetTheme = Extract<ThemeId, 'tide' | 'day' | 'night'>;

export interface WidgetSnapshot {
  v: typeof WIDGET_VERSION;
  /** When it was made, epoch ms, and the day it was made on (YYYY-MM-DD, here): today's plan and counts are for it. */
  at: number;
  day: string;
  /** The planner's look: the theme in the light and in the dark, and the accent on each. */
  look: { light: WidgetTheme; dark: WidgetTheme; accentLight: string; accentDark: string };
  /** Your day's hours, from Settings → Calendar. */
  hours: { start: number; end: number };
  /** On the calendar, by start; then the backlog, in the order Now picks from. */
  items: WidgetItem[];
  /** Today's tasks: done, and in all. */
  today: { done: number; total: number };
  /** Today's outcomes once it's planned (lib/today.ts); null while it isn't. */
  outcomes: WidgetOutcome[] | null;
}

export interface WidgetInput {
  /** Your tasks and Google's events, without the ones from calendars you switched off. */
  tasks: Task[];
  /** The backlog in the order Now picks from: what can start first, then what's held up (lib/select.ts → focusOrder). */
  backlog: Task[];
  blocked: Set<string>;
  now: number;
  goalOf: (t: Task) => { title: string } | null;
  colorOf: (t: Task) => string | null | undefined;
  today: { done: number; total: number };
  outcomes: WidgetOutcome[] | null;
  theme: ThemeId | null;
  /** The accent on each of the two themes (lib/prefs.ts → accentColor), and whether you picked it. */
  accent: { light: string; dark: string; picked: boolean };
  hours: { start: number; end: number };
}

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
const colour = (c: string | null | undefined) => (c && isHex(c) ? c.toUpperCase() : undefined);

function item(t: Task, input: WidgetInput): WidgetItem {
  const goal = input.goalOf(t);
  const color = colour(input.colorOf(t));
  return {
    id: t.id,
    title: clean(t.title, TITLE_MAX) || 'Untitled',
    ...(t.start != null ? { start: t.start } : {}),
    minutes: t.minutes,
    priority: t.priority,
    ...(t.due ? { due: t.due } : {}),
    ...(goal ? { goal: clean(goal.title, GOAL_MAX) } : {}),
    ...(color ? { color } : {}),
    ...(isEvent(t) ? { event: true as const } : {}),
    ...(t.start == null && input.blocked.has(t.id) ? { blocked: true as const } : {}),
  };
}

/**
 * The light theme you see (Tide or Day train) and its dark pair (Night train). Night train on its own stays night;
 * "match the device" is Tide by day.
 */
export function widgetLook(theme: ThemeId | null): { light: WidgetTheme; dark: WidgetTheme } {
  if (theme === 'night') return { light: 'night', dark: 'night' };
  return { light: theme === 'day' ? 'day' : 'tide', dark: 'night' };
}

/** Today in the widget's terms: what's on the calendar from a missed slot's grace to the end of tomorrow, and the top of the backlog. */
export function widgetSnapshot(input: WidgetInput): WidgetSnapshot {
  const { now } = input;
  const from = now - BACKLOG_GRACE;
  const to = addDays(startOfDay(now), 2).getTime();
  const timed = input.tasks
    .filter(t => t.status === 'open' && t.start != null && endOf(t) > from && t.start < to)
    .sort((a, b) => ((a.start as number) - (b.start as number)) || (a.minutes - b.minutes))
    .slice(0, MAX_TIMED);
  const backlog = input.backlog.filter(t => t.status === 'open' && t.start == null && !isEvent(t)).slice(0, MAX_BACKLOG);
  const look = widgetLook(input.theme);
  // A picked accent is lifted a little to sit in the dark, as globals.css does for Night train.
  const dark = input.accent.picked ? mix(input.accent.dark, '#FFFFFF', 0.15) : input.accent.dark;
  return {
    v: WIDGET_VERSION,
    at: now,
    day: ymd(now),
    look: { ...look, accentLight: input.accent.light.toUpperCase(), accentDark: dark.toUpperCase() },
    hours: { start: input.hours.start, end: input.hours.end },
    items: [...timed, ...backlog].map(t => item(t, input)),
    today: { done: input.today.done, total: input.today.total },
    outcomes: input.outcomes ? input.outcomes.slice(0, MAX_OUTCOMES).map(o => ({
      goal: clean(o.goal, GOAL_MAX),
      ...(colour(o.color) ? { color: colour(o.color) } : {}),
      text: clean(o.text, TITLE_MAX),
      done: o.done,
      steps: o.steps,
    })) : null,
  };
}

/** The snapshot without the moment it was made: two that match say the same thing, so the app needn't hear it again. */
export const widgetKey = (s: WidgetSnapshot | null) => (s ? JSON.stringify({ ...s, at: 0 }) : 'none');

/** Long enough for a burst of changes (a plan approved, a drag) to settle into one update. */
export const WIDGET_SETTLE = 0.8 * 1000;
/** Even when nothing changed, the app hears from the planner this often while it's open, so the widgets know it's fresh. */
export const WIDGET_HEARTBEAT = 30 * MIN;
