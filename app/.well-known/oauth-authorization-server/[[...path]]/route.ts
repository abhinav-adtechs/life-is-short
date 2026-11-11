import { authServerMetadata, cors, mcpConfigured, preflight, publicOrigin } from '@/lib/server/mcp/config';

export const dynamic = 'force-dynamic';

/** RFC 8414: where to register, sign in and get tokens for /mcp. Also answers clients that add /mcp to the path. */
export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (!mcpConfigured() || (path.length && path.join('/') !== 'mcp')) return cors(req, Response.json({ error: 'not_found' }, { status: 404 }));
  return cors(req, Response.json(authServerMetadata(publicOrigin(req))));
}

export { preflight as OPTIONS };
