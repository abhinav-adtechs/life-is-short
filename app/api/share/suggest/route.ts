import { isLink } from '@/lib/share';
import { body, device, notConfigured, sessionToken, shareConfigured, shareRpc } from '@/lib/server/share';

export const runtime = 'nodejs';

/** A viewer's suggestion: a backlog task or a time on the calendar, waiting for the owner's approval. */
export async function POST(req: Request) {
  if (!shareConfigured()) return notConfigured();
  const { link, suggestion } = await body<{ link: string; suggestion: Record<string, unknown> }>(req);
  const token = sessionToken(req);
  if (!isLink(link) || !token) return Response.json({ reason: 'signed-out' }, { status: 401 });
  if (!suggestion || typeof suggestion !== 'object' || JSON.stringify(suggestion).length > 2000) {
    return Response.json({ reason: 'invalid' }, { status: 400 });
  }
  const { kind, title, note, start, minutes, due } = suggestion;
  try {
    const r = await shareRpc<string>('share_request', {
      p_link: link, p_token: token, p_req: { kind, title, note, start, minutes, due }, p_device: device(req),
    });
    if (r === 'key') return notConfigured();
    if (r === 'ok') return Response.json({ ok: true });
    return Response.json({ reason: r || 'invalid' }, { status: r === 'signed-out' ? 401 : r === 'too-many' ? 429 : r === 'not-allowed' ? 403 : 400 });
  } catch (e) {
    console.error('sharing suggestion failed:', e instanceof Error ? e.message : e);
    return Response.json({ reason: 'unavailable' }, { status: 502 });
  }
}
