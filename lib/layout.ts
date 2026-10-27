/**
 * The laptop screen is one split between the priority matrix and the calendar, stored as the share of the width the
 * calendar takes. Five presets show 1, 2, 3, 5 and 7 days; a dragged divider settles on the nearest when you let go.
 * At half the width or less, the calendar is narrow enough for the matrix to draw every task in its cell.
 */

export type Days = 1 | 2 | 3 | 5 | 7;

export const DAYS: Days[] = [1, 2, 3, 5, 7];
/** The calendar's share of the width for each number of days, in the same order as DAYS. */
export const PRESETS = [0.34, 0.42, 0.6, 0.72, 0.84];
export const DEFAULT_SPLIT = 0.6;
export const SPLIT_MIN = 0.3;
export const SPLIT_MAX = 0.88;

/** Days shown at this split. */
export function daysFor(f: number): Days {
  return f < 0.38 ? 1 : f < 0.51 ? 2 : f < 0.66 ? 3 : f < 0.78 ? 5 : 7;
}

/** The split that shows this many days. */
export const splitFor = (d: Days) => PRESETS[DAYS.indexOf(d)];

export const clampSplit = (f: number) => Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, f));

/** The preset nearest a split you let go of. */
export const snapSplit = (f: number) => PRESETS.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));

/** One preset over: 1 gives the calendar more room, -1 gives it less. */
export function stepSplit(f: number, dir: 1 | -1): number {
  const i = PRESETS.indexOf(snapSplit(f));
  return PRESETS[Math.max(0, Math.min(PRESETS.length - 1, i + dir))];
}

/** Narrow enough calendar that the matrix draws its tasks in their cells, rather than counts over a list. */
export const fullMatrix = (f: number) => f <= 0.5;

/** A stored split. Builds before the redesign kept the calendar's width in pixels: those start from the default. */
export function normalizeSplit(raw: unknown): number {
  return typeof raw === 'number' && isFinite(raw) ? clampSplit(raw) : DEFAULT_SPLIT;
}
