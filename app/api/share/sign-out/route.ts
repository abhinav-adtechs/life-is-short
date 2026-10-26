import { isLink } from '@/lib/share';
import { body, clearCookie, device, shareConfigured, sessionToken, shareRpc } from '@/lib/server/share';

export const runtime = 'nodejs';

/** End this viewer's session. The cookie goes whatever the database says. */
export async function POST(req: Request) {
  const { link } = await body<{ link: string }>(req);
  const token = sessionToken(req);
  if (shareConfigured() && isLink(link) && token) {
    try { await shareRpc<string>('share_sign_out', { p_link: link, p_token: token, p_device: device(req) }); } catch { /* signed out here anyway */ }
  }
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(req) } });
}
