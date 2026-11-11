import 'server-only';
import { buildOAuthProtectedResourceMetadata, getOAuthProtectedResourceMetadataUrl, type OAuthMetadata, type OAuthProtectedResourceMetadata } from '@modelcontextprotocol/server';
import { AUTH_METHODS, SCOPE } from './oauth';

/*
 * Where the MCP server lives and what it needs. It's on only with Supabase (tasks in your browser alone aren't
 * reachable from a server) and a server key of at least 32 characters, MCP_SERVER_KEY.
 */

export const serverKey = () => process.env.MCP_SERVER_KEY || '';
export const mcpConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && serverKey().length >= 32);

/**
 * This site's public origin. APP_URL wins (set it in production so the issuer never changes); otherwise the host the
 * request came to, as a proxy that ends TLS (Vercel, Fly, Render, a Cloudflare Tunnel) reports it.
 */
export const publicOrigin = (req: Request, env: Record<string, string | undefined> = process.env) => originOf(req.headers, new URL(req.url), env);

/** The same, from a page's request headers. */
export function originOf(headers: Headers, url?: URL, env: Record<string, string | undefined> = process.env): string {
  if (env.APP_URL) return new URL(env.APP_URL).origin;
  const first = (h: string) => headers.get(h)?.split(',')[0].trim() || '';
  const host = first('x-forwarded-host') || first('host') || url?.host || 'localhost';
  const proto = first('x-forwarded-proto') || url?.protocol.replace(/:$/, '') || 'http';
  return new URL(`${proto === 'https' ? 'https' : 'http'}://${host}`).origin;
}

const local = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

/** The MCP endpoint, which is also the resource tokens are issued for (RFC 8707). */
export const resourceUrl = (origin: string) => new URL('/mcp', origin);

/** RFC 8414 authorization server metadata. */
export function authServerMetadata(origin: string): OAuthMetadata {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://github.com/abhinav-adtechs/life-is-short#connect-claude',
  } as OAuthMetadata;
}

/** RFC 9728 protected resource metadata for /mcp. */
export function resourceMetadata(origin: string): OAuthProtectedResourceMetadata {
  return buildOAuthProtectedResourceMetadata({
    oauthMetadata: authServerMetadata(origin),
    resourceServerUrl: resourceUrl(origin),
    scopesSupported: [SCOPE],
    resourceName: 'Life is short',
    // http only for a copy on this machine; anywhere else the issuer must be https.
    dangerouslyAllowInsecureIssuerUrl: local(origin),
  });
}

export const resourceMetadataUrl = (origin: string) => getOAuthProtectedResourceMetadataUrl(resourceUrl(origin));

/** CORS for the endpoints clients call from a browser (the MCP Inspector, say). Bearer tokens only, never cookies. */
export function cors(req: Request, res: Response): Response {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', req.headers.get('access-control-request-headers') || 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id');
  h.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version');
  h.set('Access-Control-Max-Age', '600');
  h.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export const preflight = (req: Request) => cors(req, new Response(null, { status: 204 }));
export const notConfigured = (req: Request) =>
  cors(req, Response.json({ error: 'temporarily_unavailable', error_description: 'The MCP server is not set up here: it needs Supabase and MCP_SERVER_KEY (docs/setup.md).' }, { status: 503 }));
