import 'server-only';
import { cors, mcpConfigured, notConfigured } from './config';

/** Run an OAuth endpoint: 503 until the server is set up, and an OAuth server_error rather than a crash page. */
export function oauthRoute(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (!mcpConfigured()) return notConfigured(req);
    try {
      return await fn(req);
    } catch (e) {
      console.error('oauth:', e instanceof Error ? e.message : e);
      return cors(req, Response.json({ error: 'server_error', error_description: 'Something went wrong on the server. Try again.' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }));
    }
  };
}
