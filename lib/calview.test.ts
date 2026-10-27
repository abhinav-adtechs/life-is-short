import { afterEach, describe, expect, it } from 'vitest';
import { stepDay, viewDays } from './calview';
import { fmtHour, fmtRange, fmtTime, setClock24 } from './format';
import { findSlot, placeItem } from './place';
import { buildPrompt } from './prompt';
import { addMonths, isoWeek, weekStart, ymd } from './time';

const D = (s: string) => new Date(s + 'T00:00:00');
const keys = (ds: Date[]) => ds.map(ymd);
const P = { weekStart: 1 as const, fiveDay: 'workweek' as const, weekNumbers: false };
// Monday 26 October 2026, 13:30 local.
const NOW = new Date(2026, 9, 26, 13, 30).getTime();

describe('weeks and months', () => {
  it('starts weeks on Monday, Sunday or Saturday', () => {
    expect(ymd(weekStart(D('2026-10-28'), 1))).toBe('2026-10-26');
    expect(ymd(weekStart(D('2026-10-28'), 0))).toBe('2026-10-25');
    expect(ymd(weekStart(D('2026-10-28'), 6))).toBe('2026-10-24');
    expect(ymd(weekStart(D('2026-10-25'), 1))).toBe('2026-10-19');
  });

  it('adds months without spilling past the month end', () => {
    expect(ymd(addMonths(D('2026-01-31'), 1))).toBe('2026-02-28');
    expect(ymd(addMonths(D('2026-03-15'), -3))).toBe('2025-12-15');
  });

  it('numbers weeks the ISO way', () => {
    expect(isoWeek(D('2026-10-26'))).toBe(44);
    expect(isoWeek(D('2026-01-01'))).toBe(1);
    expect(isoWeek(D('2027-01-01'))).toBe(53);
  });
});

describe('viewDays', () => {
  it('shows one day, the 7-day week, or Monday to Friday', () => {
    expect(keys(viewDays('day', D('2026-10-28'), P))).toEqual(['2026-10-28']);
    expect(keys(viewDays('week', D('2026-10-28'), P))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(keys(viewDays('work', D('2026-10-31'), P))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  });

  it('keeps the work week inside a Sunday-start week', () => {
    expect(keys(viewDays('work', D('2026-10-25'), { ...P, weekStart: 0 }))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  });

  it('rolls five days from the chosen day', () => {
    expect(keys(viewDays('work', D('2026-10-30'), { ...P, fiveDay: 'rolling' }))).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  });
});

describe('stepDay', () => {
  it('moves by a day, a week or five days', () => {
    expect(ymd(stepDay('day', D('2026-10-26'), 1, P))).toBe('2026-10-27');
    expect(ymd(stepDay('week', D('2026-10-26'), -1, P))).toBe('2026-10-19');
    expect(ymd(stepDay('work', D('2026-10-26'), 1, { ...P, fiveDay: 'rolling' }))).toBe('2026-10-31');
  });
});

describe('24-hour clock', () => {
  afterEach(() => setClock24(false));
  it('formats times, ranges and gutter hours', () => {
    const t = new Date(2026, 9, 26, 14, 5).getTime();
    expect(fmtTime(t)).toBe('2:05 PM');
    expect(fmtHour(9)).toBe('9 AM');
    setClock24(true);
    expect(fmtTime(t)).toBe('14:05');
    expect(fmtRange(t, 30)).toBe('14:05 – 14:35');
    expect(fmtHour(9)).toBe('09:00');
  });
});

describe('working hours', () => {
  it('slot inside your day instead of 9 to 9', () => {
    expect(findSlot([], 30, { now: new Date(2026, 9, 26, 6, 0).getTime(), hours: { start: 7 * 60, end: 18 * 60 } })).toBe(new Date(2026, 9, 26, 7, 0).getTime());
    expect(findSlot([], 30, { now: new Date(2026, 9, 26, 17, 50).getTime(), hours: { start: 7 * 60, end: 18 * 60 } })).toBe(new Date(2026, 9, 27, 7, 0).getTime());
    expect(placeItem({ date: '2026-10-28', time: null, deadline: false, minutes: 60 }, [], NOW, { start: 8 * 60, end: 12 * 60 }))
      .toEqual({ start: new Date(2026, 9, 28, 8, 0).getTime(), due: null });
  });

  it('tells the model your hours', () => {
    expect(buildPrompt('x', NOW, [], { start: 7 * 60, end: 22 * 60 + 30 })).toContain('Working hours are 07:00 to 22:30.');
    expect(buildPrompt('x', NOW)).toContain('Working hours are 09:00 to 21:00.');
  });
});
