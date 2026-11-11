import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const {
  authenticateClient, clientSecret, isVerifier, openRequest, readClient, redirectHosts, redirectProblem, redirectRegistered, register, s256, sameResource, sealRequest,
} = await import('./oauth');

const KEY = 'k'.repeat(44);
const HOSTS = redirectHosts({});
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

describe('redirect URIs', () => {
  it('take Claude’s callbacks and loopback, and nothing else unless the server says so', () => {
    expect(redirectProblem(CLAUDE, HOSTS)).toBeNull();
    expect(redirectProblem('https://claude.com/api/mcp/auth_callback', HOSTS)).toBeNull();
    expect(redirectProblem('http://localhost:6274/oauth/callback', HOSTS)).toBeNull();
    expect(redirectProblem('http://127.0.0.1:33418/callback', HOSTS)).toBeNull();
    expect(redirectProblem('https://evil.example/cb', HOSTS)).toMatch(/isn't an allowed redirect host/);
    expect(redirectProblem('http://claude.ai/cb', HOSTS)).toMatch(/must use https/);
    expect(redirectProblem('https://claude.ai.evil.example/cb', HOSTS)).toMatch(/isn't an allowed/);
    expect(redirectProblem(`${CLAUDE}#x`, HOSTS)).toMatch(/fragment/);
    expect(redirectProblem('javascript:alert(1)', HOSTS)).toMatch(/must use https/);
    expect(redirectProblem('https://evil.example/cb', redirectHosts({ MCP_REDIRECT_HOSTS: 'evil.example' }))).toBeNull();
    expect(redirectProblem('https://any.example/cb', ['*'])).toBeNull();
  });
});

describe('matching a redirect to the registration', () => {
  it('is exact, except for a loopback port, which a native app picks when it starts', () => {
    const reg = [CLAUDE, 'http://127.0.0.1:6276/oauth/callback'];
    expect(redirectRegistered(reg, CLAUDE)).toBe(true);
    expect(redirectRegistered(reg, 'http://127.0.0.1:6274/oauth/callback')).toBe(true);
    expect(redirectRegistered(reg, 'http://127.0.0.1:6274/other')).toBe(false);
    expect(redirectRegistered(reg, 'http://localhost:6274/oauth/callback')).toBe(false);
    expect(redirectRegistered(reg, 'https://claude.ai/api/mcp/auth_callback/x')).toBe(false);
    expect(redirectRegistered(reg, 'https://claude.ai:444/api/mcp/auth_callback')).toBe(false);
  });
});

describe('registering a client', () => {
  it('signs the registration into the client id, with a secret for a confidential client', () => {
    const r = register(KEY, { client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'client_secret_post' }, HOSTS, 1_800_000_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.response.client_id as string;
    expect(r.response).toMatchObject({ client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'client_secret_post',
      client_secret: clientSecret(KEY, id), client_secret_expires_at: 0, client_id_issued_at: 1_800_000_000 });
    expect(readClient(KEY, id)).toEqual({ n: 'Claude', r: [CLAUDE], m: 'client_secret_post', t: 1_800_000_000 });
    // Another key, or a changed id, isn't ours.
    expect(readClient('x'.repeat(44), id)).toBeNull();
    expect(readClient(KEY, id.slice(0, -2) + 'AA')).toBeNull();
  });

  it('a public client gets no secret', () => {
    const r = register(KEY, { redirect_uris: ['http://localhost:6274/oauth/callback'], token_endpoint_auth_method: 'none' }, HOSTS);
    expect(r.ok && r.response).toMatchObject({ client_name: 'An MCP client', token_endpoint_auth_method: 'none' });
    expect(r.ok && 'client_secret' in r.response).toBe(false);
  });

  it('refuses what it can’t serve', () => {
    expect(register(KEY, {}, HOSTS)).toMatchObject({ ok: false, error: { error: 'invalid_redirect_uri' } });
    expect(register(KEY, { redirect_uris: ['https://evil.example/cb'] }, HOSTS)).toMatchObject({ ok: false, error: { error: 'invalid_redirect_uri' } });
    expect(register(KEY, { redirect_uris: [CLAUDE], grant_types: ['client_credentials'] }, HOSTS)).toMatchObject({ ok: false, error: { error: 'invalid_client_metadata' } });
    expect(register(KEY, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'private_key_jwt' }, HOSTS)).toMatchObject({ ok: false });
  });
});

describe('client authentication at the token endpoint', () => {
  const make = (m: string) => {
    const r = register(KEY, { redirect_uris: [CLAUDE], token_endpoint_auth_method: m }, HOSTS);
    if (!r.ok) throw new Error('register');
    return r.response as { client_id: string; client_secret?: string };
  };
  const req = (auth?: string) => new Request('https://x.example/oauth/token', { method: 'POST', headers: auth ? { authorization: auth } : {} });

  it('takes a public client by id, and a confidential one only with its secret', () => {
    const pub = make('none');
    expect(authenticateClient(KEY, req(), new URLSearchParams({ client_id: pub.client_id }))).toMatchObject({ ok: true });
    const post = make('client_secret_post');
    expect(authenticateClient(KEY, req(), new URLSearchParams({ client_id: post.client_id }))).toMatchObject({ ok: false });
    expect(authenticateClient(KEY, req(), new URLSearchParams({ client_id: post.client_id, client_secret: 'nope' }))).toMatchObject({ ok: false });
    expect(authenticateClient(KEY, req(), new URLSearchParams({ client_id: post.client_id, client_secret: post.client_secret! }))).toMatchObject({ ok: true });
    const basic = make('client_secret_basic');
    const header = 'Basic ' + Buffer.from(`${encodeURIComponent(basic.client_id)}:${encodeURIComponent(basic.client_secret!)}`).toString('base64');
    expect(authenticateClient(KEY, req(header), new URLSearchParams())).toMatchObject({ ok: true, id: basic.client_id });
    expect(authenticateClient(KEY, req('Basic ' + Buffer.from(`${basic.client_id}:wrong`).toString('base64')), new URLSearchParams())).toEqual({ ok: false, basic: true });
    expect(authenticateClient(KEY, req(), new URLSearchParams({ client_id: 'made-up' }))).toMatchObject({ ok: false });
  });
});

describe('the consent request', () => {
  const r = { c: 'lis.x', n: 'Claude', r: CLAUDE, ch: 'a'.repeat(43), s: 'st', res: 'https://x.example/mcp', e: 2_000_000_000_000 };
  it('round-trips while it’s fresh, and not when changed or old', () => {
    const sealed = sealRequest(KEY, r);
    expect(openRequest(KEY, sealed, 1_900_000_000_000)).toEqual(r);
    expect(openRequest(KEY, sealed, 2_000_000_000_001)).toBeNull();
    const [data, sig] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...r, r: 'https://evil.example/cb' })).toString('base64url');
    expect(openRequest(KEY, `${forged}.${sig}`, 1_900_000_000_000)).toBeNull();
    expect(openRequest(KEY, `${data}.${sig}.x`, 1_900_000_000_000)).toBeNull();
  });
});

describe('PKCE and resources', () => {
  it('matches RFC 7636’s example', () => {
    expect(s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(isVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(true);
    expect(isVerifier('short')).toBe(false);
  });
  it('compares resources without a trailing slash or fragment', () => {
    expect(sameResource('https://x.example/mcp/', 'https://x.example/mcp')).toBe(true);
    expect(sameResource('https://x.example/mcp#a', 'https://x.example/mcp')).toBe(true);
    expect(sameResource('https://y.example/mcp', 'https://x.example/mcp')).toBe(false);
    expect(sameResource('nonsense', 'https://x.example/mcp')).toBe(false);
  });
});
