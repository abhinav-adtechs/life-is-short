import { preflight } from '@/lib/server/mcp/config';
import { revokeEndpoint } from '@/lib/server/mcp/endpoints';
import { oauthRoute } from '@/lib/server/mcp/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 7009: end the connection a token belongs to. */
export const POST = oauthRoute(revokeEndpoint);
export { preflight as OPTIONS };
