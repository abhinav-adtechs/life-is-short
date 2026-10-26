import { denyUnlessSignedIn } from '@/lib/server/auth';
import { authUrl, googleConfigured } from '@/lib/server/google';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!googleConfigured()) return Response.json({ reason: 'not-configured' }, { status: 503 });
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  const { state, hint } = await req.json().catch(() => ({})) as { state?: string; hint?: string };
  if (!state || state.length > 200) return Response.json({ reason: 'bad-request' }, { status: 400 });
  const redirectUri = `${new URL(req.url).origin}/google/callback`;
  const email = typeof hint === 'string' && hint.length <= 320 && hint.includes('@') ? hint : undefined;
  return Response.json({ url: authUrl(redirectUri, state, email) });
}
