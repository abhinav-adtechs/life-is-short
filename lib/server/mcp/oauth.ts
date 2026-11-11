import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * The OAuth 2.1 pieces the MCP authorization spec asks of an authorization server, kept stateless where they can be:
 * a registered client (RFC 7591) is its own signed id, and the consent screen's request is signed too, so nothing is
 * stored until you press Allow. Codes and tokens live in the database as hashes (supabase/migrations/0009).
 * Everything is signed with keys derived from MCP_SERVER_KEY.
 */

export const SCOPE = 'tasks';
export const ACCESS_PREFIX = 'lis_at_';
export const REFRESH_PREFIX = 'lis_rt_';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** PKCE S256: base64url(sha256(verifier)). */
export const s256 = (verifier: string) => createHash('sha256').update(verifier, 'ascii').digest('base64url');
/** 256 random bits, URL-safe. */
export const randomToken = (prefix = '') => prefix + randomBytes(32).toString('base64url');

const subkey = (key: string, use: string) => createHmac('sha256', key).update(`life-is-short mcp ${use}`).digest();
const mac = (key: string, use: string, data: string) => createHmac('sha256', subkey(key, use)).update(data).digest('base64url');

export function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function seal(key: string, use: string, body: unknown): string {
  const data = b64(JSON.stringify(body));
  return `${data}.${mac(key, use, data)}`;
}
function open<T>(key: string, use: string, token: string): T | null {
  const [data, sig, extra] = token.split('.');
  if (!data || !sig || extra !== undefined || !sameString(sig, mac(key, use, data))) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T; } catch { return null; }
}

/* ---------- redirect URIs ---------- */

/** Claude's own callbacks. MCP_REDIRECT_HOSTS adds to it; `*` lets any HTTPS host through. Loopback is always allowed. */
export const DEFAULT_REDIRECT_HOSTS = ['claude.ai', 'claude.com'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function redirectHosts(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.MCP_REDIRECT_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...DEFAULT_REDIRECT_HOSTS, ...extra])];
}

/** Why a redirect URI can't be registered, or null when it can: HTTPS on an allowed host, or http on loopback. */
export function redirectProblem(uri: unknown, hosts: string[]): string | null {
  if (typeof uri !== 'string' || !uri || uri.length > 512) return 'each redirect URI must be a URL of at most 512 characters';
  let u: URL;
  try { u = new URL(uri); } catch { return `${uri} is not a URL`; }
  if (u.hash || uri.includes('#')) return 'a redirect URI cannot have a fragment';
  if (u.username || u.password) return 'a redirect URI cannot hold a user name or password';
  const host = u.hostname.toLowerCase();
  if (LOOPBACK.has(host) || LOOPBACK.has(`[${host}]`)) return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'loopback redirects must be http or https';
  if (u.protocol !== 'https:') return 'redirect URIs must use https (or http on localhost)';
  const ok = hosts.includes('*') || hosts.some(h => host === h || host.endsWith(`.${h}`));
  return ok ? null : `${host} isn't an allowed redirect host (set MCP_REDIRECT_HOSTS on the server to add it)`;
}

/**
 * Whether a redirect URI in an authorization request is one the client registered: the same string, or for a loopback
 * address the same but for the port, which native apps choose when they start (RFC 8252 §7.3, OAuth 2.1).
 */
export function redirectRegistered(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) return false;
  return registered.some(r => {
    try {
      const x = new URL(r);
      return x.protocol === u.protocol && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
    } catch { return false; }
  });
}

/* ---------- clients (RFC 7591), signed rather than stored ---------- */

export type AuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';
export const AUTH_METHODS: AuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic'];

export interface Client {
  /** Name, shown on the consent screen and in Settings → Claude. */
  n: string;
  /** Redirect URIs, exactly as registered. */
  r: string[];
  /** Token endpoint authentication. */
  m: AuthMethod;
  /** Issued at, seconds. */
  t: number;
}

const CLIENT_PREFIX = 'lis.';
export const clientId = (key: string, c: Client) => CLIENT_PREFIX + seal(key, 'client', c);
export function readClient(key: string, id: unknown): Client | null {
  if (typeof id !== 'string' || !id.startsWith(CLIENT_PREFIX) || id.length > 4096) return null;
  const c = open<Client>(key, 'client', id.slice(CLIENT_PREFIX.length));
  return c && Array.isArray(c.r) && typeof c.n === 'string' && AUTH_METHODS.includes(c.m) ? c : null;
}
/** A confidential client's secret: derived from its id, so it needn't be stored either. */
export const clientSecret = (key: string, id: string) => mac(key, 'secret', id);

export interface RegistrationError { error: 'invalid_redirect_uri' | 'invalid_client_metadata'; error_description: string }

/** Check an RFC 7591 registration request and make the client, or say what's wrong. */
export function register(key: string, body: unknown, hosts: string[], now = Date.now()):
  { ok: true; response: Record<string, unknown> } | { ok: false; error: RegistrationError } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const bad = (error: RegistrationError['error'], d: string) => ({ ok: false as const, error: { error, error_description: d } });
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5) return bad('invalid_redirect_uri', 'redirect_uris must list 1 to 5 URIs');
  for (const u of uris) { const p = redirectProblem(u, hosts); if (p) return bad('invalid_redirect_uri', p); }
  const grants = b.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || grants.some(g => g !== 'authorization_code' && g !== 'refresh_token')) {
    return bad('invalid_client_metadata', 'grant_types may only be authorization_code and refresh_token');
  }
  const types = b.response_types ?? ['code'];
  if (!Array.isArray(types) || types.some(t => t !== 'code')) return bad('invalid_client_metadata', 'response_types may only be code');
  // RFC 7591's default is client_secret_basic.
  const method = (b.token_endpoint_auth_method ?? 'client_secret_basic') as AuthMethod;
  if (!AUTH_METHODS.includes(method)) return bad('invalid_client_metadata', `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(', ')}`);
  const name = (typeof b.client_name === 'string' ? b.client_name : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'An MCP client';
  const issued = Math.floor(now / 1000);
  const id = clientId(key, { n: name, r: uris as string[], m: method, t: issued });
  return {
    ok: true,
    response: {
      client_id: id, client_id_issued_at: issued, client_name: name, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: method,
      ...(method === 'none' ? {} : { client_secret: clientSecret(key, id), client_secret_expires_at: 0 }),
    },
  };
}

/** The client a token request comes from, checking its secret when it has one. */
export function authenticateClient(key: string, req: Request, form: URLSearchParams):
  { ok: true; id: string; client: Client } | { ok: false; basic: boolean } {
  const header = req.headers.get('authorization') || '';
  let id = form.get('client_id') || '', secret = form.get('client_secret');
  const basic = /^Basic\s+/i.test(header);
  if (basic) {
    const raw = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i < 0) return { ok: false, basic };
    try {
      id = decodeURIComponent(raw.slice(0, i).replace(/\+/g, ' '));
      secret = decodeURIComponent(raw.slice(i + 1).replace(/\+/g, ' '));
    } catch { return { ok: false, basic }; }
  }
  const client = readClient(key, id);
  if (!client) return { ok: false, basic };
  if (client.m !== 'none' && !(secret && sameString(secret, clientSecret(key, id)))) return { ok: false, basic };
  return { ok: true, id, client };
}

/* ---------- the consent screen's request ---------- */

export interface AuthRequest {
  /** client_id */
  c: string;
  /** Client name. */
  n: string;
  /** redirect_uri */
  r: string;
  /** code_challenge (S256) */
  ch: string;
  /** state, if any */
  s: string | null;
  /** The resource (this server's /mcp URL). */
  res: string;
  /** Expires, ms. */
  e: number;
}

/** Fifteen minutes to sign in and press Allow. */
export const REQUEST_TTL = 15 * 60000;
export const sealRequest = (key: string, r: AuthRequest) => seal(key, 'authorize', r);
export function openRequest(key: string, token: unknown, now = Date.now()): AuthRequest | null {
  if (typeof token !== 'string' || token.length > 12000) return null;
  const r = open<AuthRequest>(key, 'authorize', token);
  return r && typeof r.e === 'number' && r.e > now ? r : null;
}

/** Where to send the browser back, with the code or an error (RFC 6749 §4.1.2, plus RFC 9207's iss). */
export function redirectWith(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

/** A PKCE challenge or verifier, as RFC 7636 shapes them. */
export const isChallenge = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export const isVerifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(v);

/** The same resource, ignoring a trailing slash and a fragment (RFC 8707). */
export function sameResource(a: string, b: string): boolean {
  const norm = (s: string) => { try { const u = new URL(s); u.hash = ''; return u.toString().replace(/\/$/, ''); } catch { return null; } };
  const x = norm(a);
  return x != null && x === norm(b);
}
