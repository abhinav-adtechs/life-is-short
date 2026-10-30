import type { Priority, Task } from './model';
import { isEvent } from './select';
import { DAY_MS, endOf } from './time';

/**
 * A slot you missed. Reslotting a missed task (or deleting it) moves it off that slot, and the task alone can no
 * longer say it was missed, so the review keeps a note of the slot here. Your own tasks only: a Google event that
 * ended isn't something you missed. A repeating task still open when the next one replaces it (lib/repeat.ts) is
 * noted here too, with its slot, or with its day when it had none.
 */
export interface Slip {
  id: string;
  /** The slot it missed, or the start of the day it was due. With the id, this names the slip. */
  start: number;
  minutes: number;
  title: string;
  label: string | null;
  priority: Priority;
  /** When it was moved off the slot, deleted or replaced. */
  at: number;
  how: 'moved' | 'dropped' | 'replaced';
  /** Due that day rather than at a time. */
  due?: true;
}

/** One write to a task: what it was and what it is now (null when it didn't exist, or was deleted). */
export interface Change { before: Task | null; after: Task | null }

/** Settings key the slips are kept under. */
export const SLIPS_KEY = 'slips';
export const KEEP_SLIPS = 2000;
const KEEP_DAYS = 400;

export const slipKey = (s: { id: string; start: number }) => `${s.id}@${s.start}`;

/** Open, on the calendar, and its slot is over: what goes back to the backlog. A Google Calendar event is never missed. */
export const isMissed = (t: Task, now: number) => !isEvent(t) && t.status === 'open' && t.start != null && endOf(t) <= now;

/** The slips in a set of writes: a missed task moved to another time or the backlog, or deleted. Ticking it off isn't a slip. */
export function slipsFrom(changes: Change[], now: number): Slip[] {
  const out: Slip[] = [];
  for (const { before: b, after: a } of changes) {
    if (!b || !isMissed(b, now)) continue;
    if (a && (a.status === 'done' || a.start === b.start)) continue;
    out.push({
      id: b.id, start: b.start as number, minutes: b.minutes, title: b.title, label: b.label ?? null, priority: b.priority,
      at: now, how: a ? 'moved' : 'dropped',
    });
  }
  return out;
}

const PRIS = new Set([1, 2, 3]);

/** Stored slips, cleaned up: well-formed, one per slot, newest slot first. */
export function normalizeSlips(raw: unknown): Slip[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, Slip>();
  for (const x of raw) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || typeof o.start !== 'number' || !isFinite(o.start)) continue;
    const s: Slip = {
      id: o.id.slice(0, 64), start: o.start,
      minutes: typeof o.minutes === 'number' && o.minutes > 0 ? Math.min(1440, Math.round(o.minutes)) : 30,
      title: typeof o.title === 'string' ? o.title.slice(0, 160) : '',
      label: typeof o.label === 'string' ? o.label : null,
      priority: (PRIS.has(o.priority as number) ? o.priority : 2) as Priority,
      at: typeof o.at === 'number' && isFinite(o.at) ? o.at : o.start,
      how: o.how === 'dropped' || o.how === 'replaced' ? o.how : 'moved',
      ...(o.due === true ? { due: true as const } : {}),
    };
    const k = slipKey(s), had = out.get(k);
    // The same slot slipped twice (Undo, then reslot again) is one slip: keep the first. Replacing a repeating task
    // removes it, which reads as deleting it too: the replacement says more.
    if (!had || s.at < had.at || (s.at === had.at && s.how === 'replaced')) out.set(k, s);
  }
  return [...out.values()].sort((a, b) => b.start - a.start);
}

/** Two lists as one, trimmed to the last 400 days and the newest 2000 slips. */
export function mergeSlips(a: Slip[], b: Slip[], now: number): Slip[] {
  return normalizeSlips([...a, ...b]).filter(s => s.start >= now - KEEP_DAYS * DAY_MS).slice(0, KEEP_SLIPS);
}
