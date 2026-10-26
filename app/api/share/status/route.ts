import { denyUnlessSignedIn } from '@/lib/server/auth';
import { canSendCodes, checkMailer, pingDatabase, shareConfigured } from '@/lib/server/share';

export const runtime = 'nodejs';

/** For Settings → Sharing: is everything in place for someone to sign in? Only answers you. */
export async function POST(req: Request) {
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  if (!shareConfigured()) return Response.json({ problem: 'server-key' });
  if (!canSendCodes()) return Response.json({ problem: 'email' });
  try {
    const db = await pingDatabase();
    if (db !== 'ok') return Response.json({ problem: db });
  } catch {
    return Response.json({ problem: 'unreachable' });
  }
  const mail = await checkMailer();
  return Response.json({ problem: mail === 'ok' ? null : mail === 'login-failed' ? 'email-login' : 'email-unreachable' });
}
