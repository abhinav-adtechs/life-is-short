import type { Priority, Task } from './model';
import type { Slip } from './slips';
import { fmtTime, dayWord } from './format';
import { DAY_MS, DOW, DOWL, addDays, atMinutes, fromYmd, minsOf, pad, ymd } from './time';

/*
 * Repeating tasks: "order groceries every Monday and Thursday".
 *
 * A repeat is a task's template (title, priority, length, label, notes, and a time or none) and a rule for the days it
 * lands on. Repeats live in your synced settings, like your labels. Each day the rule lands on, the planner makes one
 * ordinary task from it, an occurrence, so the backlog, the calendar, Now and the review treat it like any other task.
 *
 * - On its day, not before: Tuesday's Next task is never Thursday's grocery order. With a time it goes on the calendar
 *   then, and the ones to come show faintly ahead; without one it waits in the backlog, due that day.
 * - One at a time: when the next one comes due, one still open from before is replaced, and counts as missed in the
 *   review. Skip a week and you have one "Order groceries", not two. One you moved to that day or later stays.
 * - An occurrence's id is its repeat's id and its day ("r….2026-11-02"), so two devices making it write the same row,
 *   and `made`, the last day handled, means one you deleted (skipped) doesn't come back.
 * - What the task is (title, priority, length, label, notes) belongs to the repeat: change it on the open one and the
 *   ones to come follow. When this one happens, and ticking it off, belong to this one.
 */

export type Freq = 'day' | 'week' | 'month';

/** Which days a repeat lands on. */
export interface Rule {
  freq: Freq;
  /** Every n days, weeks or months. */
  every: number;
  /** Weekly: the weekdays, 0 Sunday to 6 Saturday. */
  days: number[];
  /** Monthly: the day of the month, 1–31; a shorter month uses its last day. Null takes the first day's. */
  monthDay: number | null;
}

export interface Repeat {
  id: string;
  title: string;
  notes: string;
  priority: Priority;
  minutes: number;
  label: string | null;
  rule: Rule;
  /** "HH:MM": each one goes on the calendar then. Null: each waits in the backlog, due its day. */
  time: string | null;
  /** YYYY-MM-DD, the first day it can land on. "Every 2 weeks" counts from its week. */
  from: string;
  /** YYYY-MM-DD: every day up to this one is handled, so the next one lands after it. */
  made: string;
  /** What you said, for the editor's "From chat". */
  raw: string;
  created: number;
  updatedAt: number;
}

/** Settings key the repeats are kept under. */
export const REPEATS_KEY = 'repeats';
export const MAX_REPEATS = 100;
const MAX_EVERY: Record<Freq, number> = { day: 365, week: 52, month: 12 };

export const newRepeatId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- days ---------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Days since 1 Jan 1970 for a YYYY-MM-DD, on the calendar rather than the clock, so a change of clocks can't shift it. */
const dayNum = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
/** 0 Sunday to 6 Saturday; 1 Jan 1970 was a Thursday. */
const weekdayOf = (n: number) => (n + 4) % 7;
/** The Monday of the week holding day n. */
const mondayOf = (n: number) => n - ((n + 3) % 7);
export const shiftDay = (day: string, n: number) => ymd(addDays(fromYmd(day), n));
export const minsOfTime = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
export const timeOf = (ms: number) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** Whether the repeat lands on a day (YYYY-MM-DD). */
export function occursOn(r: Pick<Repeat, 'rule' | 'from'>, day: string): boolean {
  if (day < r.from) return false;
  const { freq, every } = r.rule;
  const d = dayNum(day), f = dayNum(r.from);
  if (freq === 'day') return (d - f) % every === 0;
  if (freq === 'week') {
    const days = r.rule.days.length ? r.rule.days : [weekdayOf(f)];
    // Weeks run Monday to Sunday, counted from the one holding the first day.
    return days.includes(weekdayOf(d)) && ((mondayOf(d) - mondayOf(f)) / 7) % every === 0;
  }
  const [y, m, dd] = day.split('-').map(Number);
  const [fy, fm, fd] = r.from.split('-').map(Number);
  if (((y - fy) * 12 + (m - fm)) % every) return false;
  return dd === Math.min(r.rule.monthDay ?? fd, new Date(y, m, 0).getDate());
}

/** Two years: enough for every rule there is to land at least once. */
const LOOK = 800;

/** The first day after `after` the repeat lands on. */
export function nextOn(r: Pick<Repeat, 'rule' | 'from'>, after: string): string | null {
  let day = after < r.from ? r.from : shiftDay(after, 1);
  for (let i = 0; i < LOOK; i++, day = shiftDay(day, 1)) if (occursOn(r, day)) return day;
  return null;
}

/** The last day in (after, through] the repeat lands on. */
export function lastOn(r: Pick<Repeat, 'rule' | 'from'>, after: string, through: string): string | null {
  let day = through;
  for (let i = 0; i < LOOK && day > after; i++, day = shiftDay(day, -1)) if (occursOn(r, day)) return day;
  return null;
}

/**
 * The first day of a new repeat: the day you gave, else today if it lands today and its time (if any) is still ahead,
 * else the next day it lands on. "Every other Monday" said on a Tuesday starts this coming Monday.
 */
export function firstDay(rule: Rule, time: string | null, now: number, date?: string | null): string {
  const today = ymd(now);
  if (date && YMD.test(date) && date >= today) return date;
  const r = { rule: { ...rule, every: 1 }, from: today };
  if (occursOn(r, today) && (!time || minsOfTime(time) > minsOf(now))) return today;
  return nextOn(r, today) ?? today;
}

/** Where a new repeat's first one goes: at its time on its first day, else in the backlog, due that day. */
export function placeFirst(rule: Rule, c: { date: string | null; time: string | null; deadline: boolean }, now: number) {
  const tm = /^(\d{1,2}):(\d{2})$/.exec(c.time || '');
  const time = !c.deadline && tm && +tm[1] < 24 && +tm[2] < 60 ? `${pad(+tm[1])}:${tm[2]}` : null;
  const day = firstDay(rule, time, now, c.date);
  return time ? { start: atMinutes(fromYmd(day), minsOfTime(time)), due: null } : { start: null, due: day };
}

/* ---------- occurrences ---------- */

const OCCURRENCE = /^(r[0-9a-z]{1,30})\.(\d{4}-\d{2}-\d{2})$/;
export const occurrenceId = (repeatId: string, day: string) => `${repeatId}.${day}`;

/** The repeat and day a task was made for, from its id; null for any other task. */
export function occurrenceOf(id: string): { repeat: string; day: string } | null {
  const m = OCCURRENCE.exec(id);
  return m ? { repeat: m[1], day: m[2] } : null;
}

/** The repeat's task for a day. */
export function occurrence(r: Repeat, day: string, now: number): Task {
  const start = r.time ? atMinutes(fromYmd(day), minsOfTime(r.time)) : null;
  return {
    id: occurrenceId(r.id, day), title: r.title, raw: r.raw, notes: r.notes, priority: r.priority, minutes: r.minutes,
    start, due: start == null ? day : null, status: 'open', created: now, order: now, doneAt: null, label: r.label, updatedAt: now,
  };
}

/** What a day brings: new occurrences, the ones they replace, and the misses to note. */
export interface Due {
  puts: Task[];
  /** Older ones still open, replaced by the new ones. */
  removes: string[];
  /** Each replaced one that had come due: its slot, or its day when it had no slot. */
  slips: Slip[];
  /** Repeat id → the day it's handled through now. */
  made: Map<string, string>;
}

/**
 * Bring every repeat up to today: the latest day it landed on since it was last handled gets its task, unless that's
 * already there. Days in between, when the planner wasn't open, are let go rather than piled up.
 */
export function dueNow(repeats: Repeat[], tasks: Task[], now: number): Due {
  const today = ymd(now);
  const have = new Set(tasks.map(t => t.id));
  const out: Due = { puts: [], removes: [], slips: [], made: new Map() };
  for (const r of repeats) {
    if (r.made >= today) continue;
    out.made.set(r.id, today);
    const day = lastOn(r, r.made, today);
    if (!day) continue;
    const id = occurrenceId(r.id, day);
    if (!have.has(id)) out.puts.push(occurrence(r, day, now));
    const d0 = fromYmd(day).getTime();
    for (const t of tasks) {
      const o = occurrenceOf(t.id);
      if (!o || o.repeat !== r.id || o.day >= day || t.status !== 'open') continue;
      const when = t.start ?? (t.due ? fromYmd(t.due).getTime() : null);
      if (when != null && when >= d0) continue;
      out.removes.push(t.id);
      // Without a slot or a day it never came due here: a slot it missed was noted when it left for the backlog.
      if (when == null) continue;
      out.slips.push({
        id: t.id, start: when, minutes: t.minutes, title: t.title, label: t.label ?? null, priority: t.priority,
        at: now, how: 'replaced', ...(t.start == null ? { due: true } : {}),
      });
    }
  }
  return out;
}

/** The timed ones still to come on a day, not made yet: faint on the calendar, and busy time for slotting. */
export function upcomingOn(repeats: Repeat[], day: string, now: number): Task[] {
  if (day <= ymd(now)) return [];
  return repeats.filter(r => r.time && day > r.made && occursOn(r, day)).map(r => occurrence(r, day, now));
}

/** The timed ones to come over the next `days` days, for slotting around. */
export const upcoming = (repeats: Repeat[], now: number, days = 14) =>
  Array.from({ length: days }, (_, i) => upcomingOn(repeats, ymd(addDays(now, i + 1)), now)).flat();

/** The next day it lands on that doesn't have its task yet. */
export const nextDue = (r: Repeat, now: number) => nextOn(r, r.made > ymd(now) ? r.made : ymd(now));

/* ---------- making and changing ---------- */

/** What a repeat is made of: a task's fields, a rule, a time, and its first day. */
export type RepeatSpec = Pick<Repeat, 'title' | 'notes' | 'priority' | 'minutes' | 'label' | 'raw' | 'rule' | 'time' | 'from'>;

/**
 * A new repeat. Its first day's task, when that's today or earlier, is made by whoever starts it (so Undo can take it
 * back), so it counts as handled through today; otherwise through the day before the first.
 */
export function startRepeat(s: RepeatSpec, now: number, id = newRepeatId()): Repeat {
  const today = ymd(now);
  const f = dayNum(s.from);
  const rule = { ...s.rule };
  if (rule.freq === 'week' && !rule.days.length) rule.days = [weekdayOf(f)];
  if (rule.freq === 'month' && rule.monthDay == null) rule.monthDay = +s.from.slice(8, 10);
  return {
    id, title: s.title, notes: s.notes, priority: s.priority, minutes: s.minutes, label: s.label ?? null, raw: s.raw.slice(0, 600),
    rule, time: s.time, from: s.from, made: s.from <= today ? today : shiftDay(s.from, -1), created: now, updatedAt: now,
  };
}

/** The template fields a task has: what an edit to an open occurrence passes on to its repeat. */
const FIELDS = ['title', 'notes', 'priority', 'minutes', 'label'] as const;

/** The repeat with an open occurrence's title, priority, length, label and notes; null when nothing differs. */
export function followTask(r: Repeat, t: Task, now: number): Repeat | null {
  if (t.status !== 'open' || FIELDS.every(k => (r[k] ?? null) === (t[k] ?? null))) return null;
  return { ...r, title: t.title, notes: t.notes, priority: t.priority, minutes: t.minutes, label: t.label ?? null, updatedAt: now };
}

/**
 * Turn a task into a repeat's current one. Its id has to become an occurrence's, so the task is written anew and the
 * old one removed. It counts as the repeat's task for its own day (today, if that's past or it has none), and the
 * rule takes that as its first day.
 */
export function makeRepeating(t: Task, rule: Rule, time: string | null, now: number, id = newRepeatId()) {
  const today = ymd(now);
  const own = t.start != null ? ymd(t.start) : t.due;
  const day = own && own > today ? own : today;
  const r = { ...startRepeat({ ...t, label: t.label ?? null, rule, time, from: day }, now, id), made: day };
  return { repeat: r, task: { ...t, id: occurrenceId(r.id, day), updatedAt: now }, removes: [t.id] };
}

/** A change to your repeats: one added or changed, or one stopped. */
export type RepeatOp = { kind: 'set'; repeat: Repeat } | { kind: 'stop'; id: string };

export function applyOps(list: Repeat[], ops: RepeatOp[]): Repeat[] {
  let out = list;
  for (const op of ops) {
    if (op.kind === 'stop') { out = out.filter(r => r.id !== op.id); continue; }
    out = out.some(r => r.id === op.repeat.id) ? out.map(r => (r.id === op.repeat.id ? op.repeat : r)) : [...out, op.repeat];
  }
  return out;
}

/** What puts `list` back after `ops`: for Undo. */
export function undoOps(list: Repeat[], ops: RepeatOp[]): RepeatOp[] {
  const ids = [...new Set(ops.map(op => (op.kind === 'stop' ? op.id : op.repeat.id)))];
  return ids.map(id => {
    const was = list.find(r => r.id === id);
    return was ? { kind: 'set' as const, repeat: was } : { kind: 'stop' as const, id };
  });
}

/** Handled through these days: never moves a repeat back, so two devices saying so agree. */
export const markMade = (made: Map<string, string>) => (list: Repeat[]) =>
  list.map(r => { const d = made.get(r.id); return d && d > r.made ? { ...r, made: d } : r; });

/* ---------- reading and saying it ---------- */

const DAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** A rule from the model or your settings: {freq, every, days, monthDay}, tolerating names and loose numbers. Null when it isn't one. */
export function toRule(v: unknown): Rule | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const f = String(o.freq ?? '').toLowerCase();
  const freq: Freq | null = /^(day|daily)$/.test(f) ? 'day' : /^(week|weekly)$/.test(f) ? 'week' : /^(month|monthly)$/.test(f) ? 'month' : null;
  if (!freq) return null;
  const n = Math.round(Number(o.every ?? 1));
  const every = Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_EVERY[freq]) : 1;
  const days = freq !== 'week' || !Array.isArray(o.days) ? [] : [...new Set(o.days.map(d => (
    typeof d === 'number' ? d : DAY_NAMES[String(d).toLowerCase().slice(0, 3)]
  )).filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  const md = Math.round(Number(o.monthDay ?? o.monthday));
  const monthDay = freq === 'month' && md >= 1 && md <= 31 ? md : null;
  return { freq, every, days, monthDay };
}

/** The rule as the prompt shows it to the model, with weekday names. */
export const ruleForModel = (r: Rule) => ({ freq: r.freq, every: r.every, days: r.days.map(d => DAY_KEYS[d]), monthday: r.monthDay });

const PRIS = new Set([1, 2, 3]);
const ID = /^r[0-9a-z]{1,30}$/;

/** Stored repeats, cleaned up: well-formed, one per id. */
export function normalizeRepeats(raw: unknown): Repeat[] {
  if (!Array.isArray(raw)) return [];
  const out: Repeat[] = [];
  for (const x of raw) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const rule = toRule(o.rule);
    const title = typeof o.title === 'string' ? o.title.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    const from = typeof o.from === 'string' && YMD.test(o.from) ? o.from : null;
    if (typeof o.id !== 'string' || !ID.test(o.id) || !rule || !title || !from || out.some(r => r.id === o.id)) continue;
    const minutes = Number(o.minutes);
    out.push({
      id: o.id, title, rule, from,
      notes: typeof o.notes === 'string' ? o.notes.slice(0, 2000) : '',
      priority: (PRIS.has(o.priority as number) ? o.priority : 2) as Priority,
      minutes: Number.isFinite(minutes) ? Math.min(480, Math.max(10, Math.round(minutes))) : 30,
      label: typeof o.label === 'string' && o.label ? o.label.slice(0, 40) : null,
      time: typeof o.time === 'string' && HHMM.test(o.time) ? o.time : null,
      made: typeof o.made === 'string' && YMD.test(o.made) ? o.made : shiftDay(from, -1),
      raw: typeof o.raw === 'string' ? o.raw.slice(0, 600) : '',
      created: typeof o.created === 'number' && Number.isFinite(o.created) ? o.created : 0,
      updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : 0,
    });
    if (out.length >= MAX_REPEATS) break;
  }
  return out;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const everyN = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : n === 2 ? `Every other ${unit}` : `Every ${n} ${unit}s`);

/** "Every day", "Every weekday", "Every Mon and Thu", "Every other week on Monday", "Every month on the 1st". */
export function describeRule(rule: Rule): string {
  if (rule.freq === 'day') return everyN(rule.every, 'day');
  if (rule.freq === 'month') return `${everyN(rule.every, 'month')}${rule.monthDay ? ` on the ${ordinal(rule.monthDay)}` : ''}`;
  // Monday first, Sunday last.
  const days = [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const key = days.join();
  const what = key === '1,2,3,4,5' ? 'weekday' : key === '6,0' ? 'weekend' : null;
  if (!days.length) return everyN(rule.every, 'week');
  if (rule.every === 1) {
    if (days.length === 7) return 'Every day';
    if (what) return `Every ${what}`;
    return `Every ${days.length === 1 ? DOWL[days[0]] : andList(days.map(d => DOW[d]))}`;
  }
  const on = what ? `${what}s` : days.length === 1 ? DOWL[days[0]] : andList(days.map(d => DOW[d]));
  return `${everyN(rule.every, 'week')} on ${on}`;
}

export const sameRule = (a: Rule | null, b: Rule | null) => !!a && !!b && a.freq === b.freq && a.every === b.every
  && a.days.join() === b.days.join() && (a.monthDay ?? null) === (b.monthDay ?? null);

/** The weekday of a YYYY-MM-DD, 0 Sunday to 6 Saturday. */
export const weekdayOfDay = (day: string) => weekdayOf(dayNum(day));

/**
 * Rules to pick from for a task whose first day is `day`: not repeating, every day, weekdays, weekly and every other
 * week on that weekday, monthly on that date, and `cur` when it's none of those.
 */
export function repeatChoices(cur: Rule | null, day: string): { key: string; name: string; rule: Rule | null }[] {
  const wd = weekdayOfDay(day);
  const presets: Rule[] = [
    { freq: 'day', every: 1, days: [], monthDay: null },
    { freq: 'week', every: 1, days: [1, 2, 3, 4, 5], monthDay: null },
    { freq: 'week', every: 1, days: [wd], monthDay: null },
    { freq: 'week', every: 2, days: [wd], monthDay: null },
    { freq: 'month', every: 1, days: [], monthDay: +day.slice(8, 10) },
  ];
  const out = [{ key: '', name: 'Doesn’t repeat', rule: null as Rule | null }, ...presets.map((rule, i) => ({ key: String(i + 1), name: describeRule(rule), rule }))];
  if (cur && !presets.some(p => sameRule(p, cur))) out.splice(1, 0, { key: 'cur', name: describeRule(cur), rule: cur });
  return out;
}

/** The rule and its time: "Every Mon and Thu · 7:00 AM". */
export const describeRepeat = (r: Pick<Repeat, 'rule' | 'time'>) =>
  `${describeRule(r.rule)}${r.time ? ` · ${fmtTime(atMinutes(0, minsOfTime(r.time)))}` : ''}`;

/** A day as a sentence says it: "today", "tomorrow", "Thursday", "Thu 12 Nov". */
export function dayName(day: string, now: number): string {
  const word = dayWord(fromYmd(day).getTime(), now);
  return word === 'Today' || word === 'Tomorrow' ? word.toLowerCase() : word;
}

/** When it next gets a task, as a day name. */
export function nextWhen(r: Repeat, now: number): string | null {
  const day = nextDue(r, now);
  return day ? dayName(day, now) : null;
}

/* ---------- the keyword parser's part ---------- */

const NUM: Record<string, number> = { other: 2, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const N = '(?:other|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d{1,3})';
const WDN = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun';
const DAY = `(?:${WDN})`;
const DAYS = `${DAY}(?:\\s*(?:,|and|&|/|\\+)?\\s*${DAY})*`;
const PLURAL = '(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)';
/** "daily", "weekly" and "monthly" only as an adverb: "vitamins daily at 9", not "daily standup". */
const ADV = '(?=\\s*(?:$|[,.;!?]|at\\b|on\\b|in\\b|from\\b|starting\\b|@|\\d))';
const nOf = (s: string | undefined) => (s ? NUM[s.toLowerCase()] ?? Number(s) : 1);
const daysIn = (s: string) => [...new Set((s.toLowerCase().match(new RegExp(`${PLURAL.slice(3, -1)}|${WDN}`, 'g')) ?? [])
  .map(w => DAY_NAMES[w.slice(0, 3)]))].sort((a, b) => a - b);

const PATTERNS: [RegExp, (m: RegExpMatchArray) => Rule][] = [
  [new RegExp(`\\b(?:every|each)\\s+(${N}\\s+)?(?:week\\s+on\\s+|weeks\\s+on\\s+)?(${DAYS})\\b`, 'i'),
    m => ({ freq: 'week', every: nOf(m[1]?.trim()), days: daysIn(m[2]), monthDay: null })],
  [new RegExp(`\\b(?:on\\s+)?(${PLURAL}(?:\\s*(?:,|and|&|/|\\+)?\\s*${PLURAL})*)\\b`, 'i'),
    m => ({ freq: 'week', every: 1, days: daysIn(m[1]), monthDay: null })],
  [/\b(?:every|each|on)\s+(?:week\s*days?|work\s*days?)\b|\bweekdays\b/i, () => ({ freq: 'week', every: 1, days: [1, 2, 3, 4, 5], monthDay: null })],
  [/\b(?:every|each|on)\s+weekends?\b|\bweekends\b/i, () => ({ freq: 'week', every: 1, days: [0, 6], monthDay: null })],
  [new RegExp(`\\b(?:every|each)\\s+(${N}\\s+)?days?\\b|\\beveryday\\b|\\bdaily${ADV}`, 'i'), m => ({ freq: 'day', every: nOf(m[1]?.trim()), days: [], monthDay: null })],
  [new RegExp(`\\b(?:every|each)\\s+(${N}\\s+)?weeks?\\b|\\bonce a week\\b|\\bweekly${ADV}`, 'i'), m => ({ freq: 'week', every: nOf(m[1]?.trim()), days: [], monthDay: null })],
  [/\bfortnightly\b|\bbiweekly\b/i, () => ({ freq: 'week', every: 2, days: [], monthDay: null })],
  [new RegExp(`\\b(?:of\\s+)?(?:every|each)\\s+(${N}\\s+)?months?\\b|\\bonce a month\\b|\\bmonthly${ADV}`, 'i'), m => ({ freq: 'month', every: nOf(m[1]?.trim()), days: [], monthDay: null })],
];

/**
 * The repeat in one dumped item, if it says one ("every Monday and Thursday", "daily", "on weekdays", "every other
 * week", "on the 1st of every month"), and the item without it. "Every morning" is daily and keeps "morning" for the time.
 */
export function takeRepeat(text: string): { rule: Rule; rest: string } | null {
  const pod = /\b(?:every|each)\s+(morning|afternoon|evening)\b/i.exec(text);
  if (pod) return { rule: { freq: 'day', every: 1, days: [], monthDay: null }, rest: text.replace(pod[0], pod[1]) };
  for (const [re, make] of PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const rule = make(m);
    if (rule.freq === 'week' && rule.days.length === 7 && rule.every === 1) Object.assign(rule, { freq: 'day', days: [] });
    return { rule, rest: text.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim() };
  }
  return null;
}
