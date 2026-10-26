import type { Priority, Task } from './model';
import { dayWord, fmtDur, fmtWhen, shortDate } from './format';
import { tasksOn } from './select';
import { MIN, addDays, fromYmd, startOfDay } from './time';

/** How much of the calendar a share shows. */
export type CalScope = 'none' | 'today' | 'upcoming' | 'all';

/** What a share lets someone see and do. Mirrors private.share_scope() in supabase/migrations/0005. */
export interface Scope {
  backlog: boolean;
  calendar: CalScope;
  /** Events and tasks pulled from Google. Calendars you switched off are never shared either way. */
  google: boolean;
  /** Titles, or only when you're busy. Applies to the calendar. */
  details: 'titles' | 'busy';
  /** They can suggest a backlog task or a calendar time, for you to approve. */
  suggest: boolean;
}

export const DEFAULT_SCOPE: Scope = { backlog: true, calendar: 'upcoming', google: true, details: 'titles', suggest: true };

/** Anything unknown is off, like the database. */
export function normalizeScope(raw: unknown): Scope {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    backlog: o.backlog === true,
    calendar: o.calendar === 'today' || o.calendar === 'upcoming' || o.calendar === 'all' ? o.calendar : 'none',
    google: o.google === true,
    details: o.details === 'busy' ? 'busy' : 'titles',
    suggest: o.suggest === true,
  };
}

/** A share has to show something. */
export const scopeOk = (s: Scope) => s.backlog || s.calendar !== 'none';

export const CAL_LABELS: Record<CalScope, string> = { none: 'Off', today: 'Today', upcoming: 'Upcoming', all: 'All' };
const CAL_TEXT: Record<CalScope, string> = { none: '', today: 'Today’s calendar', upcoming: 'Upcoming calendar', all: 'Whole calendar' };

/** "Backlog · Upcoming calendar · Busy only · Can suggest". */
export function scopeParts(s: Scope): string[] {
  const parts: string[] = [];
  if (s.backlog) parts.push('Backlog');
  if (s.calendar !== 'none') {
    parts.push(CAL_TEXT[s.calendar]);
    if (s.details === 'busy') parts.push('Busy only');
  }
  if (s.google) parts.push('Google items');
  if (s.suggest) parts.push('Can suggest');
  return parts;
}

/** How long a share lasts; null is no end. */
export const DURATIONS: { days: number | null; label: string }[] = [
  { days: 1, label: '1 day' }, { days: 7, label: '1 week' }, { days: 30, label: '30 days' }, { days: null, label: 'No end' },
];

export const isEmail = (s: unknown): s is string =>
  typeof s === 'string' && s.trim().length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** Digits in the code a viewer gets by email. Mirrors private.share_new_code(). */
export const CODE_LENGTH = 8;
export const isCode = (s: unknown): s is string => typeof s === 'string' && s.length === CODE_LENGTH && /^\d+$/.test(s);

/** The secret in a share link. */
export const isLink = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(s);

/** The link in the hash, so it never reaches server logs. */
export const shareUrl = (origin: string, link: string) => `${origin}/shared#${link}`;

/** "Safari on iPhone", for the activity log. Never the full user agent. */
export function deviceLabel(ua: string | null | undefined): string {
  const u = ua || '';
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /CrOS/.test(u) ? 'ChromeOS'
    : /Macintosh|Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : '';
  const browser = /Edg(A|iOS)?\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\/|FxiOS\//.test(u) ? 'Firefox'
    : /SamsungBrowser\//.test(u) ? 'Samsung Internet' : /Chrome\/|CriOS\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

/* ---------- your side: share_list() ---------- */

export interface ShareSession { device: string; createdAt: number; lastSeenAt: number; expiresAt: number }

export interface Share {
  id: string;
  /** What you call them. Never shown to them. */
  name: string;
  email: string;
  link: string;
  scope: Scope;
  tz: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  live: boolean;
  lastSeenAt: number | null;
  views: number;
  /** Signed in right now. */
  sessions: ShareSession[];
  pending: number;
  /** Ten wrong codes in a day: signing in is paused until the day has passed. */
  locked: boolean;
}

export type RequestStatus = 'pending' | 'approved' | 'declined';

export interface ShareRequest {
  id: string;
  shareId: string;
  kind: 'backlog' | 'calendar';
  title: string;
  note: string;
  start: number | null;
  minutes: number | null;
  due: string | null;
  status: RequestStatus;
  createdAt: number;
  decidedAt: number | null;
  email: string;
  name: string;
}

export type EventKind = 'created' | 'changed' | 'revoked' | 'code-sent' | 'wrong-code' | 'signed-in' | 'viewed' | 'suggested' | 'signed-out';

export interface ShareEvent { shareId: string; at: number; kind: EventKind; device: string }

export interface ShareList { keySet: boolean; shares: Share[]; requests: ShareRequest[]; events: ShareEvent[] }

export const whoOf = (s: { name: string; email: string }) => s.name || s.email;

/** One line of the activity log. */
export function eventText(e: ShareEvent, s: { name: string; email: string } | undefined): string {
  const who = s ? whoOf(s) : 'Someone';
  const email = s?.email || 'a removed share';
  switch (e.kind) {
    case 'created': return `You started sharing with ${who}`;
    case 'changed': return `You changed what ${who} can see`;
    case 'revoked': return `You stopped sharing with ${who}`;
    case 'code-sent': return `Sign-in code sent to ${email}`;
    case 'wrong-code': return `Wrong code entered for ${email}`;
    case 'signed-in': return `${who} signed in`;
    case 'viewed': return `${who} viewed your planner`;
    case 'suggested': return `${who} suggested a task`;
    case 'signed-out': return `${who} signed out`;
  }
}

/** "Ends Mon 3 Nov", "Ended …", "Stopped …" or "No end date". */
export function shareEnds(s: Pick<Share, 'expiresAt' | 'revokedAt'>, now = Date.now()): string {
  if (s.revokedAt) return `Stopped ${shortDate(s.revokedAt, now)}`;
  if (s.expiresAt == null) return 'No end date';
  return `${s.expiresAt > now ? 'Ends' : 'Ended'} ${shortDate(s.expiresAt, now)}`;
}

/** "Wednesday, 2:00 PM · 1 h" or "Backlog · due Tomorrow". */
export function requestWhen(r: Pick<ShareRequest, 'kind' | 'start' | 'minutes' | 'due'>, now = Date.now()): string {
  if (r.kind === 'calendar' && r.start != null) return `${fmtWhen(r.start, now)} · ${fmtDur(r.minutes ?? 30)}`;
  return r.due ? `Backlog · due ${dayWord(fromYmd(r.due).getTime(), now)}` : 'Backlog';
}

/**
 * The task an approved suggestion becomes. Its id comes from the suggestion's, so approving it on two
 * devices (or twice) writes the same task instead of two.
 */
export function requestTask(r: ShareRequest, now = Date.now()): Task {
  const who = whoOf(r);
  return {
    id: 's' + r.id.replace(/-/g, ''),
    title: r.title.slice(0, 160),
    raw: '',
    notes: `Suggested by ${who}${r.note ? `: ${r.note}` : ''}`,
    priority: 2 as Priority,
    minutes: Math.min(480, Math.max(15, r.minutes ?? 30)),
    start: r.kind === 'calendar' ? r.start : null,
    due: r.due,
    status: 'open',
    created: now,
    order: now,
    doneAt: null,
    externalId: null,
  };
}

/* ---------- their side: share_view() ---------- */

export interface SharedItem { start: number; minutes: number; title: string | null; done: boolean; google: boolean }
export interface SharedBacklogItem { title: string; priority: Priority; minutes: number; due: string | null }
export interface ViewerRequest { id: string; kind: 'backlog' | 'calendar'; title: string; start: number | null; minutes: number | null; due: string | null; status: RequestStatus; createdAt: number }

/** What a viewer gets, and what your preview shows. */
export interface SharedData {
  scope: Scope;
  tz: string;
  email: string;
  expiresAt: number | null;
  /** Server time when this was read. */
  now: number;
  hours: { start: number; end: number };
  weekStart: 0 | 1 | 6;
  clock: '12' | '24';
  backlog: SharedBacklogItem[] | null;
  /** from/to bound what may be shown; null is open-ended (the past year, or the year ahead). */
  calendar: { from: number | null; to: number | null; items: SharedItem[] } | null;
  /** Viewer only. */
  requests?: ViewerRequest[];
  sessionEndsAt?: number;
}

/**
 * The viewer's days for a today-only share. Today on the owner's clock can touch two of the viewer's
 * days in another time zone: keep the ones with something on, or the one the owner's day mostly falls on.
 */
export function todayDays(from: number, to: number, items: Pick<SharedItem, 'start' | 'minutes'>[]): Date[] {
  const days: Date[] = [];
  for (let d = startOfDay(from); d <= startOfDay(to - 1); d = addDays(d, 1)) days.push(d);
  const busy = days.filter(d => tasksOn(items, d).length > 0);
  return busy.length ? busy : [startOfDay((from + to) / 2)];
}

/** A suggestion as the viewer's form sends it. */
export interface Suggestion { kind: 'backlog' | 'calendar'; title: string; note: string; start: number | null; minutes: number | null; due: string | null }

/** The form's checks, before the database repeats them. Returns an error message or null. */
export function suggestionError(s: Suggestion, now = Date.now()): string | null {
  if (!s.title.trim()) return 'Give it a title.';
  if (s.kind === 'calendar') {
    if (s.start == null || !isFinite(s.start)) return 'Pick a day and a start time.';
    if (s.start < now - 60 * MIN) return 'That time has passed.';
    if (s.minutes == null || s.minutes < 15 || s.minutes > 480) return 'Pick a length.';
  }
  return null;
}
