import { isEmail, isLink } from '@/lib/share';
import { body, canSendCodes, device, notConfigured, sendCode, shareConfigured, shareRpc } from '@/lib/server/share';

export const runtime = 'nodejs';

/**
 * Email a sign-in code. The answer is the same whether or not that email can see the planner,
 * so the form can't be used to find out who it's shared with.
 */
export async function POST(req: Request) {
  if (!shareConfigured() || !canSendCodes()) return notConfigured();
  const { link, email } = await body<{ link: string; email: string }>(req);
  if (!isLink(link) || !isEmail(email)) return Response.json({ reason: 'bad-request' }, { status: 400 });
  try {
    const r = await shareRpc<{ sent?: boolean; email?: string; code?: string; error?: string }>('share_code', {
      p_link: link, p_email: email.trim(), p_device: device(req),
    });
    if (r?.error) return notConfigured();
    if (r?.sent && r.email && r.code && !(await sendCode(r.email, r.code))) {
      return Response.json({ reason: 'email-failed' }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('sharing code failed:', e instanceof Error ? e.message : e);
    return Response.json({ reason: 'unavailable' }, { status: 502 });
  }
}
