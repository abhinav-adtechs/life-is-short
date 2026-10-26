import { denyUnlessSignedIn } from '@/lib/server/auth';
import { canSendCodes, pingDatabase, shareConfigured } from '@/lib/server/share';

export const runtime = 'nodejs';

/** For Settings → Sharing: is everything in place for someone to sign in? Only answers you. */
export async function POST(req: Request) {
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  if (!shareConfigured()) return Response.json({ problem: 'server-key' });
  if (!canSendCodes()) return Response.json({ problem: 'email' });
  try {
    const db = await pingDatabase();
    return Response.json({ problem: db === 'ok' ? null : db });
  } catch {
    return Response.json({ problem: 'unreachable' });
  }
}
