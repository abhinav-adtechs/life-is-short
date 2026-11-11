import { createMcpHandler, requireBearerAuth } from '@modelcontextprotocol/server';
import { cors, mcpConfigured, notConfigured, preflight, publicOrigin, resourceMetadataUrl, resourceUrl } from '@/lib/server/mcp/config';
import { verifier } from '@/lib/server/mcp/endpoints';
import { SCOPE } from '@/lib/server/mcp/oauth';
import { buildServer } from '@/lib/server/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The MCP server (Streamable HTTP), for Claude's custom connectors: paste https://<this site>/mcp into
 * claude.ai → Settings → Connectors → Add custom connector. Every request needs an OAuth access token from
 * /oauth/token; without one it answers 401 with where to get one (RFC 9728), which is how Claude finds the sign-in.
 * Stateless: a fresh server per request, bound to that token's connection.
 */
const handler = createMcpHandler(ctx => {
  if (!ctx.authInfo) throw new Error('mcp: no token');
  return buildServer(ctx.authInfo);
}, { onerror: e => console.error('mcp:', e.message) });

async function serve(req: Request): Promise<Response> {
  if (!mcpConfigured()) return notConfigured(req);
  const origin = publicOrigin(req);
  const gate = requireBearerAuth({
    verifier, expectedResource: resourceUrl(origin), resourceMetadataUrl: resourceMetadataUrl(origin), requiredScopes: [SCOPE],
  });
  const auth = await gate(req);
  if (auth instanceof Response) return cors(req, auth);
  return cors(req, await handler.fetch(req, { authInfo: auth }));
}

export { serve as GET, serve as POST, serve as DELETE, preflight as OPTIONS };
