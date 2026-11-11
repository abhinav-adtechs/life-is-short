import 'server-only';
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { denyUnlessSignedIn } from '../auth';
import { cors, publicOrigin, resourceUrl, serverKey } from './config';
import { mcpRpc, userRpc } from './db';
import {
  ACCESS_PREFIX, REFRESH_PREFIX, REQUEST_TTL, SCOPE, authenticateClient, isChallenge, isVerifier, openRequest, randomToken,
  readClient, redirectHosts, redirectRegistered, redirectWith, register, s256, sameResource, sealRequest, sha256hex,
} from './oauth';

/*
 * The authorization server's endpoints (app/oauth/*) and the bearer check in front of /mcp. The route files only
 * hand requests to these.
 */

/* ---------- /mcp: is this access token live? ---------- */

interface Access { grant: string; clientId: string; scope: string; resource: string; tz: string; expiresAt: number }

export const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    const a = token.startsWith(ACCESS_PREFIX) ? await mcpRpc<Access | null>('mcp_access', { p_access_sha256: sha256hex(token) }) : null;
    if (!a) throw new OAuthError(OAuthErrorCode.InvalidToken, 'This token is not valid, or it has expired or been revoked.');
    return {
      token, clientId: a.clientId, scopes: a.scope.split(/\s+/).filter(Boolean), expiresAt: Math.floor(a.expiresAt / 1000),
      resource: new URL(a.resource), extra: { tz: a.tz, grant: a.grant },
    };
  },
};

/* ---------- /oauth/register (RFC 7591) ---------- */

export async function registerEndpoint(req: Request): Promise<Response> {
  let body: unknown = null;
  try { body = await req.json(); } catch { /* answered below */ }
  const r = register(serverKey(), body, redirectHosts());
  return cors(req, r.ok ? Response.json(r.response, { status: 201 }) : Response.json(r.error, { status: 400 }));
}

/* ---------- /oauth/authorize: what the consent screen shows ---------- */

export type Authorize =
  /** Nowhere safe to send the browser back to: show this. */
  | { kind: 'error'; message: string }
  /** Tell the client what's wrong, at its redirect URI. */
  | { kind: 'redirect'; url: string }
  /** Ask you. */
  | { kind: 'consent'; request: string; clientName: string; redirectHost: string; denyUrl: string };

/** Check an authorization request (OAuth 2.1 §4.1.1 with PKCE, RFC 8707's resource). */
export function authorize(origin: string, q: URLSearchParams, now = Date.now()): Authorize {
  const key = serverKey();
  const client = readClient(key, q.get('client_id'));
  if (!client) return { kind: 'error', message: 'This link to connect isn’t one this app made, or the server’s key has changed since. Start again from Claude.' };
  const redirect = q.get('redirect_uri') ?? (client.r.length === 1 ? client.r[0] : null);
  if (!redirect || !redirectRegistered(client.r, redirect)) return { kind: 'error', message: 'This link sends you somewhere the app wasn’t told about. Start again from Claude.' };
  const state = q.get('state');
  const back = (error: string, description: string): Authorize =>
    ({ kind: 'redirect', url: redirectWith(redirect, { error, error_description: description, state, iss: origin }) });
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (q.get('code_challenge_method') !== 'S256' || !isChallenge(q.get('code_challenge'))) {
    return back('invalid_request', 'PKCE is required: code_challenge with code_challenge_method=S256.');
  }
  if (state != null && state.length > 2000) return back('invalid_request', 'state is too long.');
  const resource = resourceUrl(origin).toString();
  const asked = q.get('resource');
  if (asked && !sameResource(asked, resource)) return back('invalid_target', `This server only issues tokens for ${resource}.`);
  const request = sealRequest(key, { c: q.get('client_id')!, n: client.n, r: redirect, ch: q.get('code_challenge')!, s: state, res: resource, e: now + REQUEST_TTL });
  return { kind: 'consent', request, clientName: client.n, redirectHost: new URL(redirect).host, denyUrl: redirectWith(redirect, { error: 'access_denied', error_description: 'You chose not to connect.', state, iss: origin }) };
}

/* ---------- /oauth/approve: you pressed Allow ---------- */

const REASONS: Record<string, number> = { locked: 401, key: 503, invalid: 400, 'too-many': 409 };

export async function approveEndpoint(req: Request): Promise<Response> {
  const denied = await denyUnlessSignedIn(req);
  if (denied) return denied;
  let body: { request?: unknown; tz?: unknown } = {};
  try { body = await req.json(); } catch { /* answered below */ }
  const r = openRequest(serverKey(), body.request);
  if (!r) return Response.json({ reason: 'expired' }, { status: 400 });
  const code = randomToken();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const status = await userRpc<string>(token, 'mcp_authorize', {
    p_code_sha256: sha256hex(code), p_client_id: r.c, p_client_name: r.n, p_redirect_uri: r.r, p_challenge: r.ch,
    p_resource: r.res, p_scope: SCOPE, p_tz: typeof body.tz === 'string' ? body.tz.slice(0, 64) : 'UTC',
  });
  if (status !== 'ok') return Response.json({ reason: status }, { status: REASONS[status] ?? 500 });
  return Response.json({ redirect: redirectWith(r.r, { code, state: r.s, iss: publicOrigin(req) }) });
}

/* ---------- /oauth/token ---------- */

const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
function oauthError(req: Request, error: string, description: string, status = 400, extra: Record<string, string> = {}) {
  return cors(req, Response.json({ error, error_description: description }, { status, headers: { ...noStore, ...extra } }));
}

/** The body of a token or revocation request: a form, as OAuth says, or JSON, which some clients send. */
async function formOf(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get('content-type') || '';
  const text = await req.text().catch(() => '');
  if (/application\/json/i.test(type)) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === 'string') as [string, string][]);
    } catch { return new URLSearchParams(); }
  }
  return new URLSearchParams(text);
}

interface Tokens { grant: string; scope: string; resource: string; expiresIn: number; error?: undefined }
type Issued = Tokens | { error: string };

export async function tokenEndpoint(req: Request): Promise<Response> {
  const form = await formOf(req);
  const key = serverKey();
  const who = authenticateClient(key, req, form);
  if (!who.ok) return oauthError(req, 'invalid_client', 'Unknown client, or the wrong client secret.', 401, who.basic ? { 'WWW-Authenticate': 'Basic realm="oauth"' } : {});
  const resource = resourceUrl(publicOrigin(req)).toString();
  const asked = form.get('resource');
  if (asked && !sameResource(asked, resource)) return oauthError(req, 'invalid_target', `This server only issues tokens for ${resource}.`);

  const access = randomToken(ACCESS_PREFIX), refresh = randomToken(REFRESH_PREFIX);
  let out: Issued;
  switch (form.get('grant_type')) {
    case 'authorization_code': {
      const code = form.get('code'), verifier = form.get('code_verifier'), redirect = form.get('redirect_uri');
      if (!code || !redirect) return oauthError(req, 'invalid_request', 'code and redirect_uri are required.');
      if (!isVerifier(verifier)) return oauthError(req, 'invalid_request', 'A PKCE code_verifier is required.');
      out = await mcpRpc<Issued>('mcp_redeem', {
        p_code_sha256: sha256hex(code), p_client_id: who.id, p_redirect_uri: redirect, p_verifier_s256: s256(verifier),
        p_access_sha256: sha256hex(access), p_refresh_sha256: sha256hex(refresh),
      });
      break;
    }
    case 'refresh_token': {
      const old = form.get('refresh_token');
      if (!old) return oauthError(req, 'invalid_request', 'refresh_token is required.');
      out = await mcpRpc<Issued>('mcp_refresh', {
        p_refresh_sha256: sha256hex(old), p_client_id: who.id, p_access_sha256: sha256hex(access), p_new_refresh_sha256: sha256hex(refresh),
      });
      break;
    }
    default:
      return oauthError(req, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }
  if (out.error === 'key') return oauthError(req, 'server_error', 'The database doesn’t know this server’s key (docs/setup.md).', 500);
  if (out.error !== undefined) return oauthError(req, out.error, out.error === 'invalid_grant' ? 'The code or refresh token is invalid, used or expired.' : 'The request was malformed.');
  if (!sameResource(out.resource, resource)) return oauthError(req, 'invalid_grant', 'This grant was made for another server.');
  return cors(req, Response.json({
    access_token: access, token_type: 'Bearer', expires_in: out.expiresIn, refresh_token: refresh, scope: out.scope,
  }, { headers: noStore }));
}

/* ---------- /oauth/revoke (RFC 7009) ---------- */

export async function revokeEndpoint(req: Request): Promise<Response> {
  const form = await formOf(req);
  const token = form.get('token');
  if (!token) return oauthError(req, 'invalid_request', 'token is required.');
  await mcpRpc('mcp_revoke_token', { p_token_sha256: sha256hex(token) });
  return cors(req, new Response(null, { status: 200, headers: noStore }));
}
