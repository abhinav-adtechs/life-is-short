import { cors, mcpConfigured, preflight, publicOrigin, resourceMetadata } from '@/lib/server/mcp/config';

export const dynamic = 'force-dynamic';

/** RFC 9728: /mcp is protected by this site's own authorization server. Served at the root and at /mcp's own path. */
export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (!mcpConfigured() || (path.length && path.join('/') !== 'mcp')) return cors(req, Response.json({ error: 'not_found' }, { status: 404 }));
  return cors(req, Response.json(resourceMetadata(publicOrigin(req))));
}

export { preflight as OPTIONS };
