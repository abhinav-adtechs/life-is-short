import { denyUnlessSignedIn } from '@/lib/server/auth';
import { sortWithGemini } from '@/lib/server/sort';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Sort a dump with Gemini. No key, or any failure, tells the client to fall back to the keyword parser. */
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ reason: 'no-key' }, { status: 503 });
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  let prompt = '';
  try { prompt = String((await req.json() as { prompt?: unknown }).prompt || ''); } catch { /* bad body */ }
  if (!prompt || prompt.length > 40000) return Response.json({ reason: 'bad-request' }, { status: 400 });
  try {
    const out = await sortWithGemini(prompt, key);
    if (!out) return Response.json({ reason: 'unreadable-reply' }, { status: 502 });
    return Response.json(out);
  } catch (e) {
    console.error('sort failed:', e instanceof Error ? e.message : e);
    return Response.json({ reason: 'ai-error' }, { status: 502 });
  }
}
