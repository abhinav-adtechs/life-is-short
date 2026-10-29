import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Our API routes spend your Gemini quota and touch your Google account, so they only answer you:
 * a verified session the database itself would show your data to (a 2FA code or Face ID in the last 24 hours,
 * plus the password or the PIN in the last 24 hours). Face ID isn't in the token's claims, so the database decides.
 * Returns a 401 response to send back, or null when the caller is allowed.
 * Without Supabase configured (local-only mode) they're open in development, and in production only with ALLOW_LOCAL_MODE=1.
 */
export async function denyUnlessSignedIn(req: Request): Promise<Response | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    const open = process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCAL_MODE === '1';
    return open ? null : Response.json({ reason: 'sign-in-not-configured' }, { status: 401 });
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return Response.json({ reason: 'signed-out' }, { status: 401 });
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return Response.json({ reason: 'signed-out' }, { status: 401 });
  // Ask the database the same question its row-level security asks.
  const asUser = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: status } = await asUser.rpc('pin_status');
  if (!(status as { unlocked?: boolean } | null)?.unlocked) return Response.json({ reason: 'locked' }, { status: 401 });
  return null;
}
