import { approveEndpoint } from '@/lib/server/mcp/endpoints';
import { oauthRoute } from '@/lib/server/mcp/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The consent screen's Allow: your session's token and the signed request in, the way back to Claude out. Same origin only. */
export const POST = oauthRoute(approveEndpoint);
