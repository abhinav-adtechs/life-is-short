import type { CalView, Prefs } from './prefs';
import { dayWord, rangeLabel } from './format';
import { DAY_MS, DOWL, MON, MONL, addDays, addMonths, isoWeek, startOfDay, weekStart } from './time';

type ViewPrefs = Pick<Prefs, 'weekStart' | 'fiveDay' | 'weekNumbers'>;

const span = (from: Date, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

/** The days a time-grid view shows around `day`. Month isn't a time grid; see monthGrid. */
export function viewDays(view: CalView, day: Date | number, p: ViewPrefs): Date[] {
  if (view === 'day' || view === 'month') return [startOfDay(day)];
  if (view === 'three') return span(startOfDay(day), 3);
  if (view === 'work' && p.fiveDay === 'rolling') return span(startOfDay(day), 5);
  const week = span(weekStart(day, p.weekStart), 7);
  // Work week: Monday to Friday of the week as you start it.
  return view === 'work' ? week.filter(d => d.getDay() >= 1 && d.getDay() <= 5) : week;
}

/** Whole weeks covering the month of `day`: 4 to 6 rows of 7 days. */
export function monthGrid(day: Date | number, firstDow: number): Date[][] {
  const d = new Date(day);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const rows: Date[][] = [];
  for (let s = weekStart(first, firstDow); s <= last; s = addDays(s, 7)) rows.push(span(s, 7));
  return rows;
}

/** The day to show after pressing next (dir 1) or previous (dir -1). */
export function stepDay(view: CalView, day: Date | number, dir: 1 | -1, p: ViewPrefs): Date {
  if (view === 'month') { const d = addMonths(day, dir); d.setDate(1); return d; }
  if (view === 'day') return addDays(day, dir);
  if (view === 'three') return addDays(day, dir * 3);
  return addDays(day, dir * (view === 'work' && p.fiveDay === 'rolling' ? 5 : 7));
}

const weekWord = (from: Date, now: number, first: number) => {
  const diff = Math.round((from.getTime() - weekStart(now, first).getTime()) / (7 * DAY_MS));
  return diff === 0 ? 'This week' : diff === 1 ? 'Next week' : diff === -1 ? 'Last week' : `Week of ${from.getDate()} ${MON[from.getMonth()]}`;
};

/** Heading and subheading for the calendar's current view. */
export function viewTitle(view: CalView, day: Date, now: number, p: ViewPrefs): { title: string; sub: string } {
  if (view === 'day') {
    return { title: dayWord(day.getTime(), now), sub: `${DOWL[day.getDay()]} ${day.getDate()} ${MONL[day.getMonth()]}` + (p.weekNumbers ? ` · Week ${isoWeek(day)}` : '') };
  }
  if (view === 'month') {
    const n = new Date(now);
    const diff = (day.getFullYear() - n.getFullYear()) * 12 + day.getMonth() - n.getMonth();
    const title = MONL[day.getMonth()] + (day.getFullYear() !== n.getFullYear() ? ` ${day.getFullYear()}` : '');
    return { title, sub: diff === 0 ? 'This month' : diff === 1 ? 'Next month' : diff === -1 ? 'Last month' : String(day.getFullYear()) };
  }
  const days = viewDays(view, day, p);
  const first = days[0], last = days[days.length - 1];
  const wk = p.weekNumbers ? ` · Week ${isoWeek(addDays(weekStart(first, p.weekStart), 3))}` : '';
  if (view === 'three' || (view === 'work' && p.fiveDay === 'rolling')) {
    const today = startOfDay(now).getTime() === first.getTime();
    return { title: today ? `Next ${days.length} days` : `From ${dayWord(first.getTime(), now)}`, sub: rangeLabel(first, last) + wk };
  }
  return { title: weekWord(weekStart(first, p.weekStart), now, p.weekStart), sub: rangeLabel(first, last) + wk };
}

export const VIEW_LABELS: Record<CalView, string> = { day: 'Day', three: '3 days', work: '5 days', week: 'Week', month: 'Month' };
