import { isLink } from '@/lib/share';
import { body, clearCookie, device, notConfigured, sessionToken, shareConfigured, shareRpc } from '@/lib/server/share';

export const runtime = 'nodejs';

/** What this viewer may see right now. Also how the page finds out it's signed in. */
export async function POST(req: Request) {
  if (!shareConfigured()) return notConfigured();
  const { link } = await body<{ link: string }>(req);
  const token = sessionToken(req);
  if (!isLink(link) || !token) return Response.json({ reason: 'signed-out' }, { status: 401 });
  try {
    const r = await shareRpc<{ error?: string } & Record<string, unknown>>('share_view', { p_link: link, p_token: token, p_device: device(req) });
    if (r?.error === 'key') return notConfigured();
    if (!r || r.error) return Response.json({ reason: 'signed-out' }, { status: 401, headers: { 'Set-Cookie': clearCookie(req) } });
    return Response.json(r);
  } catch (e) {
    console.error('sharing view failed:', e instanceof Error ? e.message : e);
    return Response.json({ reason: 'unavailable' }, { status: 502 });
  }
}
