import type { SharedData, Suggestion } from './share';

/**
 * The viewer's side: our /api/share routes. No Supabase here; the session is an HttpOnly cookie
 * the server set, so this page never sees it.
 */

async function call<T>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    let data: T | null = null;
    try { data = await res.json() as T; } catch { data = null; }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

type Reason = { reason?: string };

export const loadView = (link: string) => call<SharedData & Reason>('/api/share/view', { link });
export const requestCode = (link: string, email: string) => call<Reason>('/api/share/code', { link, email });
export const verifyCode = (link: string, email: string, code: string) => call<Reason>('/api/share/verify', { link, email, code });
export const sendSuggestion = (link: string, suggestion: Suggestion) => call<Reason>('/api/share/suggest', { link, suggestion });
export const signOutViewer = (link: string) => call<Reason>('/api/share/sign-out', { link });
