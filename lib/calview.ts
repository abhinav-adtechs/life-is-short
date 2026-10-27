import type { Prefs } from './prefs';
import type { Days } from './layout';
import { DOW, DOWL, MON, addDays, isoWeek, startOfDay, weekStart } from './time';

/** How many days the calendar shows. On a laptop the split decides; Week is the week as you start it. */
export type CalView = 'day' | 'two' | 'three' | 'work' | 'week';

type ViewPrefs = Pick<Prefs, 'weekStart' | 'fiveDay' | 'weekNumbers'>;

export const VIEW_FOR_DAYS: Record<Days, CalView> = { 1: 'day', 2: 'two', 3: 'three', 5: 'work', 7: 'week' };

const span = (from: Date, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

/** The days a view shows around `day`. */
export function viewDays(view: CalView, day: Date | number, p: ViewPrefs): Date[] {
  if (view === 'day') return [startOfDay(day)];
  if (view === 'two') return span(startOfDay(day), 2);
  if (view === 'three') return span(startOfDay(day), 3);
  if (view === 'work' && p.fiveDay === 'rolling') return span(startOfDay(day), 5);
  const week = span(weekStart(day, p.weekStart), 7);
  // Work week: Monday to Friday of the week as you start it.
  return view === 'work' ? week.filter(d => d.getDay() >= 1 && d.getDay() <= 5) : week;
}

/** The day to show after pressing next (dir 1) or previous (dir -1). */
export function stepDay(view: CalView, day: Date | number, dir: 1 | -1, p: ViewPrefs): Date {
  if (view === 'day') return addDays(day, dir);
  if (view === 'two') return addDays(day, dir * 2);
  if (view === 'three') return addDays(day, dir * 3);
  return addDays(day, dir * (view === 'work' && p.fiveDay === 'rolling' ? 5 : 7));
}

/** The calendar's title: "Tuesday 27 Oct" for a day, "Tue 27 – Thu 29 Oct" for a run of them. */
export function rangeTitle(days: Date[], p: Pick<Prefs, 'weekNumbers'>): string {
  const a = days[0], b = days[days.length - 1];
  const wk = p.weekNumbers ? ` · Week ${isoWeek(addDays(a, 3))}` : '';
  if (days.length === 1) return `${DOWL[a.getDay()]} ${a.getDate()} ${MON[a.getMonth()]}${p.weekNumbers ? ` · Week ${isoWeek(a)}` : ''}`;
  const first = `${DOW[a.getDay()]} ${a.getDate()}${a.getMonth() !== b.getMonth() ? ` ${MON[a.getMonth()]}` : ''}`;
  return `${first} – ${DOW[b.getDay()]} ${b.getDate()} ${MON[b.getMonth()]}${wk}`;
}

export const VIEW_LABELS: Record<CalView, string> = { day: 'Day', two: '2 days', three: '3 days', work: '5 days', week: 'Week' };
