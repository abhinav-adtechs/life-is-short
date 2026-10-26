import { denyUnlessSignedIn } from '@/lib/server/auth';
import { exchangeCode, googleConfigured } from '@/lib/server/google';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!googleConfigured()) return Response.json({ reason: 'not-configured' }, { status: 503 });
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  const { code } = await req.json().catch(() => ({})) as { code?: string };
  if (!code) return Response.json({ reason: 'bad-request' }, { status: 400 });
  try {
    return Response.json(await exchangeCode(code, `${new URL(req.url).origin}/google/callback`));
  } catch (e) {
    return Response.json({ reason: 'exchange-failed', message: e instanceof Error ? e.message : 'Google sign-in failed' }, { status: 502 });
  }
}
