import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mcpRpc = vi.fn();
const userRpc = vi.fn();
vi.mock('./db', () => ({ mcpRpc, userRpc }));
const denyUnlessSignedIn = vi.fn();
vi.mock('../auth', () => ({ denyUnlessSignedIn }));

const KEY = 'k'.repeat(44);
const saved = { key: process.env.MCP_SERVER_KEY, app: process.env.APP_URL };
process.env.MCP_SERVER_KEY = KEY;
delete process.env.APP_URL;
afterAll(() => { process.env.MCP_SERVER_KEY = saved.key; if (saved.app) process.env.APP_URL = saved.app; });

const { authorize, approveEndpoint, registerEndpoint, tokenEndpoint, verifier } = await import('./endpoints');
const { register, redirectHosts, s256, sha256hex, clientSecret } = await import('./oauth');

const ORIGIN = 'https://tasks.example.com';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(50);
const client = (m = 'none') => {
  const r = register(KEY, { client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: m }, redirectHosts({}));
  if (!r.ok) throw new Error('register');
  return r.response as { client_id: string; client_secret?: string };
};
const query = (o: Record<string, string>) => new URLSearchParams({
  response_type: 'code', redirect_uri: CLAUDE, code_challenge: s256(VERIFIER), code_challenge_method: 'S256', state: 'xyz',
  resource: `${ORIGIN}/mcp`, ...o,
});
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } });

beforeEach(() => { mcpRpc.mockReset(); userRpc.mockReset(); denyUnlessSignedIn.mockReset(); });

describe('authorize', () => {
  it('asks you, for a client this server registered', () => {
    const c = client();
    const a = authorize(ORIGIN, query({ client_id: c.client_id }));
    expect(a).toMatchObject({ kind: 'consent', clientName: 'Claude', redirectHost: 'claude.ai' });
    if (a.kind !== 'consent') return;
    const deny = new URL(a.denyUrl);
    expect([...deny.searchParams]).toEqual([['error', 'access_denied'], ['error_description', 'You chose not to connect.'], ['state', 'xyz'], ['iss', ORIGIN]]);
  });
  it('never redirects for a client or redirect it doesn’t know', () => {
    expect(authorize(ORIGIN, query({ client_id: 'lis.forged.x' }))).toMatchObject({ kind: 'error' });
    expect(authorize(ORIGIN, query({ client_id: client().client_id, redirect_uri: 'https://claude.ai/elsewhere' }))).toMatchObject({ kind: 'error' });
  });
  it('sends other problems back to the client', () => {
    const id = client().client_id;
    const err = (o: Record<string, string>) => {
      const a = authorize(ORIGIN, query({ client_id: id, ...o }));
      return a.kind === 'redirect' ? new URL(a.url).searchParams.get('error') : a.kind;
    };
    expect(err({ response_type: 'token' })).toBe('unsupported_response_type');
    expect(err({ code_challenge_method: 'plain' })).toBe('invalid_request');
    expect(err({ code_challenge: 'short' })).toBe('invalid_request');
    expect(err({ resource: 'https://other.example/mcp' })).toBe('invalid_target');
  });
});

describe('approve', () => {
  const consent = () => {
    const a = authorize(ORIGIN, query({ client_id: client().client_id }));
    if (a.kind !== 'consent') throw new Error('consent');
    return a.request;
  };
  const approve = (request: string) => approveEndpoint(new Request(`${ORIGIN}/oauth/approve`, {
    method: 'POST', body: JSON.stringify({ request, tz: 'Asia/Kolkata' }), headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
  }));

  it('needs an unlocked session', async () => {
    denyUnlessSignedIn.mockResolvedValue(Response.json({ reason: 'locked' }, { status: 401 }));
    expect((await approve(consent())).status).toBe(401);
    expect(userRpc).not.toHaveBeenCalled();
  });
  it('makes a code bound to the challenge, and sends you back with it', async () => {
    denyUnlessSignedIn.mockResolvedValue(null);
    userRpc.mockResolvedValue('ok');
    const res = await approve(consent());
    const back = new URL((await res.json()).redirect);
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe(ORIGIN);
    const code = back.searchParams.get('code')!;
    expect(userRpc).toHaveBeenCalledWith('user-jwt', 'mcp_authorize', expect.objectContaining({
      p_code_sha256: sha256hex(code), p_challenge: s256(VERIFIER), p_redirect_uri: CLAUDE, p_resource: `${ORIGIN}/mcp`, p_tz: 'Asia/Kolkata',
    }));
  });
  it('refuses a request it didn’t sign', async () => {
    denyUnlessSignedIn.mockResolvedValue(null);
    expect((await approve('forged.request')).status).toBe(400);
  });
});

describe('token', () => {
  const issued = { grant: 'g1', scope: 'tasks', resource: `${ORIGIN}/mcp`, expiresIn: 3600 };

  it('swaps a code for tokens, checking PKCE in the database', async () => {
    const c = client();
    mcpRpc.mockResolvedValue(issued);
    const res = await tokenEndpoint(post('/oauth/token', new URLSearchParams({
      grant_type: 'authorization_code', code: 'the-code', redirect_uri: CLAUDE, code_verifier: VERIFIER, client_id: c.client_id,
    }).toString()));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'tasks' });
    expect(body.access_token).toMatch(/^lis_at_[A-Za-z0-9_-]{43}$/);
    expect(body.refresh_token).toMatch(/^lis_rt_[A-Za-z0-9_-]{43}$/);
    expect(mcpRpc).toHaveBeenCalledWith('mcp_redeem', {
      p_code_sha256: sha256hex('the-code'), p_client_id: c.client_id, p_redirect_uri: CLAUDE, p_verifier_s256: s256(VERIFIER),
      p_access_sha256: sha256hex(body.access_token), p_refresh_sha256: sha256hex(body.refresh_token),
    });
  });

  it('refreshes, for a confidential client with its secret', async () => {
    const c = client('client_secret_basic');
    mcpRpc.mockResolvedValue(issued);
    const basic = 'Basic ' + Buffer.from(`${encodeURIComponent(c.client_id)}:${encodeURIComponent(clientSecret(KEY, c.client_id))}`).toString('base64');
    const res = await tokenEndpoint(post('/oauth/token', 'grant_type=refresh_token&refresh_token=lis_rt_old', { authorization: basic }));
    expect(res.status).toBe(200);
    expect(mcpRpc).toHaveBeenCalledWith('mcp_refresh', expect.objectContaining({ p_refresh_sha256: sha256hex('lis_rt_old'), p_client_id: c.client_id }));
    const wrong = await tokenEndpoint(post('/oauth/token', `grant_type=refresh_token&refresh_token=x&client_id=${encodeURIComponent(c.client_id)}`));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe('invalid_client');
  });

  it('passes on what the database says about a bad code', async () => {
    mcpRpc.mockResolvedValue({ error: 'invalid_grant' });
    const res = await tokenEndpoint(post('/oauth/token', new URLSearchParams({
      grant_type: 'authorization_code', code: 'used', redirect_uri: CLAUDE, code_verifier: VERIFIER, client_id: client().client_id,
    }).toString()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('refuses a missing verifier, another resource and other grants without asking the database', async () => {
    const id = client().client_id;
    const call = (o: Record<string, string>) => tokenEndpoint(post('/oauth/token', new URLSearchParams({ client_id: id, ...o }).toString())).then(r => r.json());
    expect((await call({ grant_type: 'authorization_code', code: 'c', redirect_uri: CLAUDE })).error).toBe('invalid_request');
    expect((await call({ grant_type: 'authorization_code', code: 'c', redirect_uri: CLAUDE, code_verifier: VERIFIER, resource: 'https://other.example/mcp' })).error).toBe('invalid_target');
    expect((await call({ grant_type: 'client_credentials' })).error).toBe('unsupported_grant_type');
    expect(mcpRpc).not.toHaveBeenCalled();
  });
});

describe('register', () => {
  it('answers 201 with the client, or 400 with why not', async () => {
    const ok = await registerEndpoint(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', body: JSON.stringify({ redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' }) }));
    expect(ok.status).toBe(201);
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    const bad = await registerEndpoint(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', body: 'not json' }));
    expect(bad.status).toBe(400);
  });
});

describe('the bearer check', () => {
  it('only asks the database about tokens this server could have made', async () => {
    await expect(verifier.verifyAccessToken('eyJhbGciOi.supabase.jwt')).rejects.toThrow(/not valid/);
    expect(mcpRpc).not.toHaveBeenCalled();
    mcpRpc.mockResolvedValue({ grant: 'g', clientId: 'c', scope: 'tasks', resource: `${ORIGIN}/mcp`, tz: 'UTC', expiresAt: 1_900_000_000_000 });
    expect(await verifier.verifyAccessToken('lis_at_abc')).toMatchObject({ clientId: 'c', scopes: ['tasks'], expiresAt: 1_900_000_000, extra: { tz: 'UTC' } });
    mcpRpc.mockResolvedValue(null);
    await expect(verifier.verifyAccessToken('lis_at_revoked')).rejects.toThrow(/not valid/);
  });
});
