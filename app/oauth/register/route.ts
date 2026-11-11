import { preflight } from '@/lib/server/mcp/config';
import { registerEndpoint } from '@/lib/server/mcp/endpoints';
import { oauthRoute } from '@/lib/server/mcp/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 7591 dynamic client registration. Nothing is stored: the client id is the signed registration. */
export const POST = oauthRoute(registerEndpoint);
export { preflight as OPTIONS };
