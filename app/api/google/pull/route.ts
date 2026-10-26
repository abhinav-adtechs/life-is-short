import { denyUnlessSignedIn } from '@/lib/server/auth';
import { googleConfigured, pull } from '@/lib/server/google';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!googleConfigured()) return Response.json({ reason: 'not-configured' }, { status: 503 });
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  const { blob, timeMin, timeMax, calendars, tasks } = await req.json().catch(() => ({})) as {
    blob?: string; timeMin?: string; timeMax?: string; calendars?: Record<string, unknown>; tasks?: boolean;
  };
  if (!blob || !timeMin || !timeMax || isNaN(Date.parse(timeMin)) || isNaN(Date.parse(timeMax))) {
    return Response.json({ reason: 'bad-request' }, { status: 400 });
  }
  // Your per-calendar choices from Settings: id → pull or not.
  const choices: Record<string, boolean> = {};
  if (calendars && typeof calendars === 'object') {
    for (const [id, on] of Object.entries(calendars).slice(0, 500)) if (typeof on === 'boolean') choices[id] = on;
  }
  try {
    return Response.json(await pull(blob, timeMin, timeMax, choices, tasks !== false));
  } catch (e) {
    const code = (e as { code?: string }).code;
    // invalid_grant: the user revoked access or the token expired; they need to connect again.
    if (code === 'invalid_grant') return Response.json({ reason: 'revoked' }, { status: 401 });
    console.error('google pull failed:', e instanceof Error ? e.message : e);
    return Response.json({ reason: 'pull-failed' }, { status: 502 });
  }
}
