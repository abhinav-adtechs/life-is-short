import { postJson } from './api';
import type { ExternalItem } from './google';
import { addDays, startOfDay } from './time';

export const STATE_KEY = 'ds.google.state';
export const PENDING_KEY = 'ds.google.pending';

/** Stored in your settings: the sealed refresh token and when we last pulled. */
export interface GoogleConn { blob: string; email: string | null; connectedAt: number; pulledAt?: number | null }

/** Send you to Google's consent screen. Returns an error message if that can't start. */
export async function startGoogleConnect(): Promise<string | null> {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const { status, data } = await postJson<{ url?: string; reason?: string }>('/api/google/auth-url', { state });
  if (status === 200 && data?.url) { window.location.assign(data.url); return null; }
  if (data?.reason === 'not-configured') return 'Google isn’t set up on the server yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).';
  return 'Couldn’t start Google sign-in. Try again.';
}

/** Today through the next month of events, plus Google Tasks. */
export async function fetchGoogleItems(conn: GoogleConn, now = Date.now()): Promise<{ items: ExternalItem[] } | { error: string; revoked?: boolean }> {
  const timeMin = startOfDay(now).toISOString();
  const timeMax = addDays(startOfDay(now), 31).toISOString();
  try {
    const { status, data } = await postJson<{ items?: ExternalItem[]; reason?: string }>('/api/google/pull', { blob: conn.blob, timeMin, timeMax }, 30000);
    if (status === 200 && data?.items) return { items: data.items };
    if (data?.reason === 'revoked') return { error: 'Google access ended. Connect again in Settings.', revoked: true };
    if (data?.reason === 'not-configured') return { error: 'Google isn’t set up on the server.' };
    return { error: 'Couldn’t pull from Google. Try again later.' };
  } catch {
    return { error: 'Couldn’t reach the server to pull from Google.' };
  }
}

export async function disconnectGoogle(conn: GoogleConn) {
  try { await postJson('/api/google/disconnect', { blob: conn.blob }); } catch { /* revoke is best effort */ }
}
