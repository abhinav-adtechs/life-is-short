import { preflight } from '@/lib/server/mcp/config';
import { tokenEndpoint } from '@/lib/server/mcp/endpoints';
import { oauthRoute } from '@/lib/server/mcp/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Swap a code (with its PKCE verifier) or a refresh token for tokens. */
export const POST = oauthRoute(tokenEndpoint);
export { preflight as OPTIONS };
