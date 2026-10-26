import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mapEvent, mapTask, type ExternalItem, type GEvent, type GTask } from '../google';

export const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
].join(' ');

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// The refresh token is stored in your settings row, sealed with a key only the server has.
const key = () => createHash('sha256').update('ds-google-token:' + (process.env.GOOGLE_CLIENT_SECRET || '')).digest();

export function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function unseal(blob: string): string {
  const b = Buffer.from(blob, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/** Google's consent screen. It always offers the account chooser so you can add a second or third account; `hint` pre-picks one to reconnect. */
export function authUrl(redirectUri: string, state: string, hint?: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  });
  if (hint) q.set('login_hint', hint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', ...params }),
  });
  const data = await res.json().catch(() => ({})) as Record<string, string>;
  if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || `token ${res.status}`), { code: data.error });
  return data;
}

/** Trade the one-time code for a refresh token. Returns it sealed, plus the Google account's email. */
export async function exchangeCode(code: string, redirectUri: string) {
  const t = await token({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from((t.id_token || '').split('.')[1] || '', 'base64url').toString('utf8')).email ?? null; } catch { email = null; }
  return { blob: seal(t.refresh_token), email };
}

async function get<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google ${res.status} for ${new URL(url).pathname}`);
  return res.json() as Promise<T>;
}

interface CalEntry { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; selected?: boolean; primary?: boolean; accessRole: string }

/** A calendar in the account, whether its events were asked for, and whether Google refused to list them. */
export interface PulledCalendar { id: string; name: string; color: string | null; role: string; primary: boolean; pulled: boolean; failed?: boolean }

/** Pulled unless you said otherwise: your own calendars (owner/writer) that are ticked in Google. Subscribed ones like holidays are off. */
const pullByDefault = (c: CalEntry) => (c.accessRole === 'owner' || c.accessRole === 'writer') && c.selected !== false;

/**
 * One account's events in the window, plus its Google Tasks, as planner items.
 * `choices` maps calendar id → pull or not, from Settings; calendars not in it use the default.
 */
export async function pull(blob: string, timeMin: string, timeMax: string, choices: Record<string, boolean> = {}, withTasks = true) {
  const { access_token: at } = await token({ refresh_token: unseal(blob), grant_type: 'refresh_token' });
  const now = Date.now();
  const items: ExternalItem[] = [];

  // Every calendar you can read (free/busy-only ones can't list events).
  const list = await get<{ items?: CalEntry[] }>('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250', at);
  const calendars: PulledCalendar[] = (list.items || []).map(c => ({
    id: c.id, name: c.summaryOverride || c.summary || c.id, color: /^#[0-9a-f]{6}$/i.test(c.backgroundColor || '') ? c.backgroundColor as string : null,
    role: c.accessRole, primary: c.primary === true, pulled: choices[c.id] ?? pullByDefault(c),
  }));
  // A few at a time, so an account with many calendars doesn't trip Google's rate limit.
  const queue = calendars.filter(c => c.pulled);
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let cal = queue.shift(); cal; cal = queue.shift()) {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      try {
        const evs = await get<{ items?: GEvent[] }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`, at);
        for (const ev of evs.items || []) { const it = mapEvent(ev, cal.id, now); if (it) items.push(it); }
      } catch (e) {
        // One unreadable calendar (a stale subscription, say) shouldn't stop the rest; the app says which.
        cal.failed = true;
        console.error('google calendar skipped:', e instanceof Error ? e.message : e);
      }
    }
  }));

  if (withTasks) {
    const lists = await get<{ items?: { id: string }[] }>('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100', at);
    const updatedMin = new Date(now - 30 * 864e5).toISOString();
    for (const l of lists.items || []) {
      const q = new URLSearchParams({ showCompleted: 'true', showHidden: 'true', maxResults: '100', updatedMin });
      const ts = await get<{ items?: GTask[] }>(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks?${q}`, at);
      for (const t of ts.items || []) { const it = mapTask(t); if (it) items.push(it); }
    }
  }
  return { items, calendars };
}

export async function revoke(blob: string) {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: unseal(blob) }),
    });
  } catch { /* already gone */ }
}
