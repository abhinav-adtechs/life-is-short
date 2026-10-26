import { denyUnlessSignedIn } from '@/lib/server/auth';
import { googleConfigured, revoke } from '@/lib/server/google';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  const { blob } = await req.json().catch(() => ({})) as { blob?: string };
  if (blob && googleConfigured()) await revoke(blob);
  return Response.json({ ok: true });
}
