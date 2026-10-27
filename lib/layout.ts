import type { CalView } from './prefs';

/**
 * The laptop screen is one split between the backlog matrix and the calendar. Auto sizes it to fit the backlog's
 * columns; Pinned keeps the width you chose, by picking a number of days or by dragging the divider.
 * However it's set, the number of days follows the calendar's width.
 */
export interface Split { mode: 'auto' | 'pinned'; cal: number }

export type Days = 1 | 3 | 5 | 7;

/** Calendar width for each number of days: the day picker pins to these, and a dragged divider settles on them. */
export const SNAP: Record<Days, number> = { 1: 380, 3: 620, 5: 820, 7: 1020 };
export const DEFAULT_SPLIT: Split = { mode: 'pinned', cal: SNAP[3] };

export const CAL_MIN = 360;
export const MATRIX_MIN = 420;
/** The calendar's gutter and padding, and the least a day column needs. */
const CAL_CHROME = 104, DAY_MIN = 120;
/** The matrix: side padding, the label column (narrower in a small matrix), and the width each priority column asks for in Auto. */
export const M_PAD = 56, M_HEAD = 140, M_HEAD_NARROW = 118, M_COL = 236, M_FOLD = 58;
const MAGNET = 48;

/** As many days as fit, each at least DAY_MIN wide. */
export function daysFor(calW: number): Days {
  for (const d of [7, 5, 3] as const) if ((calW - CAL_CHROME) / d >= DAY_MIN) return d;
  return 1;
}

/** Calendar width for a screen this wide. Auto leaves the matrix room for its columns; both sides keep a minimum. */
export function calendarWidth(total: number, split: Split, columns: number): number {
  const max = Math.max(CAL_MIN, total - MATRIX_MIN);
  const want = split.mode === 'auto' ? total - (M_PAD + M_HEAD + columns * M_COL) : split.cal;
  return Math.round(Math.max(CAL_MIN, Math.min(max, want)));
}

/** A width let go near Day, 3 days, 5 days or Week settles there. */
export function snapWidth(w: number): number {
  let best = w, gap = Infinity;
  for (const s of Object.values(SNAP)) if (Math.abs(s - w) < gap) { gap = Math.abs(s - w); best = s; }
  return gap <= MAGNET ? best : Math.round(w);
}

export const VIEW_FOR_DAYS: Record<Days, CalView> = { 1: 'day', 3: 'three', 5: 'work', 7: 'week' };
export const DAYS_FOR_VIEW: Partial<Record<CalView, Days>> = { day: 1, three: 3, work: 5, week: 7 };

export type Density = 'cards' | 'titles' | 'counts';
/** When the matrix is tight: keep every column as numbers, or fold the lowest priorities into slim columns. */
export type Tight = 'counts' | 'fold';

export interface MatrixLayout {
  density: Density;
  /** Columns drawn in full, and columns folded down to counts, by priority. */
  open: number[];
  folded: number[];
  headW: number;
}

/**
 * How the matrix draws its priority columns in this much width. Space only changes how it's drawn, never what's in it:
 * cards, then titles only, then counts (or, with Fold, the lowest priorities fold into slim counted columns).
 */
export function matrixLayout(matrixW: number, columns: number[], tight: Tight): MatrixLayout {
  const headW = matrixW >= 640 ? M_HEAD : M_HEAD_NARROW;
  const open = [...columns], folded: number[] = [];
  const per = () => (matrixW - M_PAD - headW - folded.length * M_FOLD) / Math.max(1, open.length);
  const fits = () => (per() >= 185 ? 'cards' : per() >= 115 ? 'titles' : null);
  let density: Density | null = fits();
  if (!density) {
    if (tight === 'fold') {
      while (open.length > 1 && per() < 115) folded.unshift(open.pop() as number);
      density = fits() ?? 'titles';
    } else density = 'counts';
  }
  return { density, open, folded, headW };
}
