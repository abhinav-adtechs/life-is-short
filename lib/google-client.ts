import { postJson } from './api';
import { PALETTE, isHex } from './color';
import { calendarOf, type ExternalItem } from './google';
import { addDays, startOfDay } from './time';

export const STATE_KEY = 'ds.google.state';
export const PENDING_KEY = 'ds.google.pending';
export const MAX_ACCOUNTS = 5;
export const ACCOUNT_COLORS = PALETTE;

/** What the callback hands the app: a sealed refresh token for one Google account. */
export interface GoogleConn { blob: string; email: string | null; connectedAt: number; pulledAt?: number | null }

/** One calendar in a connected account, as Google lists it, plus your choices for it. */
export interface GoogleCalendar {
  id: string;
  name: string;
  /** Google's own colour for it. */
  color: string | null;
  role: string;
  primary: boolean;
  /** Pull its events and show them. Off hides the ones already pulled and stops updating them. */
  pull: boolean;
  /** Label for its events; null takes the account's. */
  label: string | null;
}

/** A connected Google account. Several sit side by side and their events share one calendar. */
export interface GoogleAccount {
  id: string;
  blob: string;
  email: string | null;
  color: string;
  connectedAt: number;
  pulledAt: number | null;
  /** Show this account's events on the calendar. Hidden accounts are still pulled. */
  show: boolean;
  /** Pull this account's Google Tasks. */
  tasks: boolean;
  /** Default label for its events, so work and personal time each show in their label's colour. */
  label: string | null;
  /** Filled in by the first pull. */
  calendars: GoogleCalendar[];
  /** 'revoked' when Google ended access and you need to connect it again. */
  error: string | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);

function normCal(raw: unknown): GoogleCalendar | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return {
    id, name: str(o.name) || id, color: isHex(o.color) ? (o.color as string) : null, role: str(o.role) || 'reader',
    primary: o.primary === true, pull: o.pull !== false, label: str(o.label),
  };
}

function normAccount(raw: unknown, i: number): GoogleAccount | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const blob = str(o.blob);
  if (!blob) return null;
  const email = str(o.email);
  return {
    id: str(o.id) || email || `account-${i + 1}`, blob, email,
    color: isHex(o.color) ? (o.color as string) : ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
    connectedAt: num(o.connectedAt) ?? 0, pulledAt: num(o.pulledAt),
    show: o.show !== false, tasks: o.tasks !== false, label: str(o.label),
    calendars: Array.isArray(o.calendars) ? o.calendars.map(normCal).filter((c): c is GoogleCalendar => !!c) : [],
    error: str(o.error),
  };
}

/** The stored 'google' setting, old single-account shape or new, as a list of accounts. */
export function normalizeAccounts(raw: unknown): GoogleAccount[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.accounts) ? o.accounts : 'blob' in o ? [o] : [];
  const out: GoogleAccount[] = [];
  for (const raw of list) {
    const a = normAccount(raw, out.length);
    if (a && !out.some(x => x.id === a.id)) out.push(a);
  }
  return out;
}

export const storedAccounts = (accounts: GoogleAccount[]) => ({ v: 2, accounts });

/** Add a freshly connected account, or swap in the new token if that account is already here. */
export function addAccount(list: GoogleAccount[], conn: GoogleConn): { list: GoogleAccount[]; account: GoogleAccount | null } {
  const id = conn.email || `account-${conn.connectedAt}`;
  const cur = list.find(a => a.id === id || (conn.email && a.email === conn.email));
  if (cur) {
    const account = { ...cur, blob: conn.blob, error: null, connectedAt: conn.connectedAt };
    return { list: list.map(a => (a === cur ? account : a)), account };
  }
  if (list.length >= MAX_ACCOUNTS) return { list, account: null };
  const used = new Set(list.map(a => a.color));
  const account: GoogleAccount = {
    id, blob: conn.blob, email: conn.email, color: ACCOUNT_COLORS.find(c => !used.has(c)) || ACCOUNT_COLORS[list.length % ACCOUNT_COLORS.length],
    connectedAt: conn.connectedAt, pulledAt: null, show: true, tasks: true, label: null, calendars: [], error: null,
  };
  return { list: [...list, account], account };
}

/** A calendar as the pull route reports it. `pulled` is whether it was asked for; `failed` that Google wouldn't list its events. */
export interface ServerCalendar { id: string; name: string; color: string | null; role: string; primary: boolean; pulled: boolean; failed?: boolean }

/** Google's latest calendar list, keeping your on/off and label choices for calendars you already had. */
export function mergeCalendars(mine: GoogleCalendar[], fromGoogle: ServerCalendar[]): GoogleCalendar[] {
  const prev = new Map(mine.map(c => [c.id, c]));
  return fromGoogle.map(c => {
    const p = prev.get(c.id);
    return { id: c.id, name: c.name, color: c.color, role: c.role, primary: c.primary, pull: p ? p.pull : c.pulled, label: p?.label ?? null };
  }).sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

export interface Source { account: GoogleAccount; calendar: GoogleCalendar | null }

/**
 * Which account (and calendar) each pulled calendar id belongs to. When accounts share a calendar,
 * the one pulling it wins, then the one it's the main calendar of, then the first.
 */
export function sourceIndex(accounts: GoogleAccount[]): Map<string, Source> {
  const m = new Map<string, Source>();
  const rank = (a: GoogleAccount, c: GoogleCalendar) => (c.pull ? 2 : 0) + (c.primary || c.id === a.email ? 1 : 0);
  for (const account of accounts) for (const calendar of account.calendars) {
    const cur = m.get(calendar.id);
    if (!cur?.calendar || rank(account, calendar) > rank(cur.account, cur.calendar)) m.set(calendar.id, { account, calendar });
  }
  // Before an account's first pull its calendar list is empty; its primary calendar's id is its email.
  for (const account of accounts) if (account.email && !m.has(account.email)) m.set(account.email, { account, calendar: null });
  return m;
}

export const sourceOf = (index: Map<string, Source>, externalId: string | null | undefined) => {
  const cal = calendarOf(externalId);
  return cal ? index.get(cal) ?? null : null;
};

/** Calendars whose events go when this account is removed: its own, unless another account still pulls them. */
export function ownCalendars(accounts: GoogleAccount[], id: string): Set<string> {
  const me = accounts.find(a => a.id === id);
  if (!me) return new Set();
  // An account that hasn't pulled yet will pull its main calendar, whose id is its email.
  const others = new Set(accounts.filter(a => a.id !== id)
    .flatMap(a => (a.calendars.length ? a.calendars.filter(c => c.pull).map(c => c.id) : a.email ? [a.email] : [])));
  return new Set([...me.calendars.map(c => c.id), ...(me.email ? [me.email] : [])].filter(c => !others.has(c)));
}

/** Send you to Google's consent screen. `hint` pre-picks an account when reconnecting one. */
export async function startGoogleConnect(hint?: string | null): Promise<string | null> {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const { status, data } = await postJson<{ url?: string; reason?: string }>('/api/google/auth-url', { state, hint: hint || undefined });
  if (status === 200 && data?.url) { window.location.assign(data.url); return null; }
  if (data?.reason === 'not-configured') return 'Google isn’t set up on the server yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).';
  return 'Couldn’t start Google sign-in. Try again.';
}

export type PullResult = { items: ExternalItem[]; calendars: ServerCalendar[] } | { error: string; revoked?: boolean };

/** Today through the next month of one account's events, plus its Google Tasks. */
export async function fetchGoogleItems(acct: GoogleAccount, now = Date.now()): Promise<PullResult> {
  const timeMin = startOfDay(now).toISOString();
  const timeMax = addDays(startOfDay(now), 31).toISOString();
  const calendars = Object.fromEntries(acct.calendars.map(c => [c.id, c.pull]));
  const who = acct.email || 'a Google account';
  try {
    const { status, data } = await postJson<{ items?: ExternalItem[]; calendars?: ServerCalendar[]; reason?: string }>(
      '/api/google/pull', { blob: acct.blob, timeMin, timeMax, calendars, tasks: acct.tasks }, 30000);
    if (status === 200 && data?.items) return { items: data.items, calendars: data.calendars || [] };
    if (data?.reason === 'revoked') return { error: `Google access ended for ${who}. Reconnect it in Settings.`, revoked: true };
    if (data?.reason === 'not-configured') return { error: 'Google isn’t set up on the server.' };
    return { error: `Couldn’t pull ${who}. Try again later.` };
  } catch {
    return { error: 'Couldn’t reach the server to pull from Google.' };
  }
}

export async function disconnectGoogle(acct: Pick<GoogleAccount, 'blob'>) {
  try { await postJson('/api/google/disconnect', { blob: acct.blob }); } catch { /* revoke is best effort */ }
}
