import type { ParsedItem, Priority, Task } from './model';
import { MIN, WORK_END, WORK_START, addDays, atMinutes, ceil15, endOf, fromYmd, minsOf, startOfDay, ymd } from './time';

type Slottable = Pick<Task, 'id' | 'status' | 'start' | 'minutes'>;

export interface SlotOpts {
  now?: number;
  /** Earliest start, e.g. the end of the task being pushed. */
  after?: number;
  /** Day to start looking from. */
  onDate?: Date | number;
  /** Only look on that one day. */
  sameDay?: boolean;
  /** Task id to ignore (the one being moved). */
  exclude?: string;
  /** Your day in minutes from midnight. Defaults to 9:00–21:00. */
  hours?: WorkHours;
}

export interface WorkHours { start: number; end: number }

/** First gap of `mins` inside your working hours that no open scheduled task covers, on the 15-minute grid. */
export function findSlot(tasks: Slottable[], mins: number, opts: SlotOpts = {}): number | null {
  const now = opts.now ?? Date.now();
  const after = Math.max(now, opts.after ?? 0);
  let day = startOfDay(opts.onDate ?? after);
  const span = opts.sameDay ? 1 : 14;
  const busy = tasks.filter(t => t.id !== opts.exclude && t.status === 'open' && t.start != null)
    .map(t => [t.start as number, endOf(t)] as const).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < span; i++, day = addDays(day, 1)) {
    const end = atMinutes(day, opts.hours?.end ?? WORK_END);
    let cursor = ceil15(Math.max(atMinutes(day, opts.hours?.start ?? WORK_START), after));
    if (cursor >= end) continue;
    for (const [s, e] of busy) {
      if (e <= cursor) continue;
      if (s >= end) break;
      if (s >= cursor + mins * MIN) return cursor;
      cursor = ceil15(Math.max(cursor, e));
    }
    if (cursor + mins * MIN <= end) return cursor;
  }
  return null;
}

/** Coerce one parsed item (from the model or the fallback) into safe fields. */
export function cleanItem(it: unknown, raw: string): ParsedItem {
  const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
  const title = String(o.title || '').replace(/\s+/g, ' ').trim().slice(0, 160) || String(raw).replace(/\s+/g, ' ').slice(0, 160);
  let priority = Math.round(Number(o.priority));
  if (![1, 2, 3].includes(priority)) priority = 2;
  let minutes = Number(o.minutes);
  if (!isFinite(minutes) || minutes <= 0) minutes = 30;
  minutes = Math.min(480, Math.max(15, Math.round(minutes / 15) * 15));
  return {
    title, priority: priority as Priority, minutes,
    notes: String(o.notes || '').trim().slice(0, 1000),
    date: typeof o.date === 'string' ? o.date : null,
    time: typeof o.time === 'string' ? o.time : null,
    deadline: o.deadline === true,
    // Checked against your labels when the task is made.
    label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : null,
  };
}

/** Calendar vs backlog: a stated day or time goes on the calendar; a deadline or nothing goes to the backlog. */
export function placeItem(
  c: Pick<ParsedItem, 'date' | 'time' | 'deadline' | 'minutes'>,
  tasks: Slottable[],
  nowArg?: number,
  hours?: WorkHours,
): { start: number | null; due: string | null } {
  const now = nowArg ?? Date.now();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(c.date || '') ? c.date : null;
  const tm = /^(\d{1,2}):(\d{2})$/.exec(c.time || '');
  const mins = tm ? (+tm[1]) * 60 + (+tm[2]) : null;
  if (c.deadline) return { start: null, due: date || ymd(now) };
  if (!date && mins == null) return { start: null, due: null };
  let day = date ? fromYmd(date) : startOfDay(now);
  if (!date && mins != null && mins <= minsOf(now)) day = addDays(day, 1);
  if (day.getTime() < startOfDay(now).getTime()) return { start: null, due: date };
  if (mins != null && mins < 24 * 60) return { start: atMinutes(day, mins), due: null };
  const slot = findSlot(tasks, c.minutes, { onDate: day, sameDay: true, now, hours });
  return slot != null ? { start: slot, due: null } : { start: null, due: date };
}
