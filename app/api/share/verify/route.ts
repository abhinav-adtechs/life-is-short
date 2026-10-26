import { isCode, isEmail, isLink } from '@/lib/share';
import { body, device, notConfigured, sessionCookie, shareConfigured, shareRpc } from '@/lib/server/share';

export const runtime = 'nodejs';

/**
 * Swap the emailed code for a view-only session, kept in an HttpOnly cookie. Every failure gets the same
 * answer (wrong email, no code, expired, wrong code, paused), so it can't tell anyone which emails have access.
 */
export async function POST(req: Request) {
  if (!shareConfigured()) return notConfigured();
  const { link, email, code } = await body<{ link: string; email: string; code: string }>(req);
  if (!isLink(link) || !isEmail(email) || !isCode(code)) return Response.json({ reason: 'wrong' }, { status: 401 });
  try {
    const r = await shareRpc<{ token?: string; expiresAt?: number; error?: string }>('share_sign_in', {
      p_link: link, p_email: email.trim(), p_code: code, p_device: device(req),
    });
    if (r?.error === 'key') return notConfigured();
    if (!r?.token || !r.expiresAt) return Response.json({ reason: 'wrong' }, { status: 401 });
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(req, r.token, r.expiresAt) } });
  } catch (e) {
    console.error('sharing sign-in failed:', e instanceof Error ? e.message : e);
    return Response.json({ reason: 'unavailable' }, { status: 502 });
  }
}
