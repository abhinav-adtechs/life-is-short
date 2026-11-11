// Connectors (supabase/migrations/0009) against the real migrations in PGlite: who can call what, the code and
// token lifecycle, and what a connection can read and change.
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { as, migrated } from './pglite.mjs';
import { evaluate } from '../backup/checks.mjs';

const OWNER = '22222222-2222-2222-2222-222222222222';
const KEY = 'm'.repeat(40);
const sha = s => createHash('sha256').update(s).digest('hex');
const s256 = v => createHash('sha256').update(v).digest('base64url');
const rand = () => randomBytes(32).toString('base64url');
const nowS = () => Math.floor(Date.now() / 1000);
/** A fully signed-in session: password and an authenticator code a minute ago. */
const me = { sub: OWNER, role: 'authenticated', session_id: 'bbbbbbbb-0000-0000-0000-000000000001', aal: 'aal2',
  amr: [{ method: 'password', timestamp: nowS() - 60 }, { method: 'totp', timestamp: nowS() - 60 }] };
/** Password only: the database shows this session nothing. */
const half = { ...me, aal: 'aal1', amr: [{ method: 'password', timestamp: nowS() - 60 }] };
const CLIENT = 'lis_client_example';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const RESOURCE = 'https://tasks.example.com/mcp';

let db;
const one = async (role, claims, q, params) => Object.values((await as(db, role, claims, q, params)).rows[0])[0];
const owner = (q, params) => one('authenticated', me, q, params);
const server = (q, params) => one('anon', {}, q, params);

/** Allow, as the consent screen does, and return the code and its verifier. */
async function allow({ claims = me, key = KEY, client = CLIENT } = {}) {
  const code = rand(), verifier = rand();
  const r = await one('authenticated', claims, 'select public.mcp_authorize($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [key, sha(code), client, 'Claude', REDIRECT, s256(verifier), RESOURCE, 'tasks', 'Asia/Kolkata']);
  return { r, code, verifier };
}
const redeem = (code, verifier, { client = CLIENT, redirect = REDIRECT, access = rand(), refresh = rand() } = {}) =>
  server('select public.mcp_redeem($1, $2, $3, $4, $5, $6, $7)', [KEY, sha(code), client, redirect, s256(verifier), sha(access), sha(refresh)])
    .then(out => ({ out, access, refresh }));
/** A fresh connection: its access and refresh tokens. */
async function connect(client = CLIENT) {
  const { code, verifier } = await allow({ client });
  const { out, access, refresh } = await redeem(code, verifier, { client });
  expect(out).toMatchObject({ scope: 'tasks', resource: RESOURCE, tz: 'Asia/Kolkata' });
  return { access, refresh, grant: out.grant };
}
const access = token => server('select public.mcp_access($1, $2)', [KEY, sha(token)]);
const list = token => server('select public.mcp_list($1, $2)', [KEY, sha(token)]);

const row = (id, title, extra = {}) => ({ id, title, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null, status: 'open',
  created: 1, sort_order: 1, done_at: null, external_id: null, label: null, updated_at: 5, ...extra });

beforeAll(async () => {
  db = await migrated();
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'me@example.com')`);
  await db.query('select private.set_mcp_key_hash($1)', [sha(KEY)]);
  await db.query(`insert into public.tasks (user_id, id, title, notes, priority, minutes, start, status, created, sort_order, external_id)
    values ($1, 'mine', 'Write the report', 'a note', 1, 60, null, 'open', 1, 1, null),
           ($1, 'meet', 'Team meeting', '', 2, 30, 1800000000000, 'open', 1, 2, 'gcal:work@example.com:ev1')`, [OWNER]);
  await db.query(`insert into public.settings (user_id, key, value) values ($1, 'prefs', '{"labels":[{"id":"work","name":"Work","color":"#336699"}]}'),
    ($1, 'google', '{"accounts":[{"blob":"sealed refresh token"}]}'), ($1, 'history', '[{"text":"private chat"}]')`, [OWNER]);
}, 60000);

describe('who can call what', () => {
  it('only an unlocked session that the server vouches for can allow a connection', async () => {
    expect((await allow({ claims: half })).r).toBe('locked');
    expect((await allow({ key: 'x'.repeat(40) })).r).toBe('key');
    expect((await allow()).r).toBe('ok');
    await expect(as(db, 'anon', {}, `select public.mcp_authorize('k', 'c', 'c', '', 'r', 'ch', 'res', 's', 'UTC')`)).rejects.toThrow(/permission denied/);
  });
  it('your connections list only answers a fully signed-in session', async () => {
    expect(await one('authenticated', half, 'select public.mcp_connections()')).toBeNull();
    expect(await one('authenticated', half, `select public.mcp_disconnect('00000000-0000-0000-0000-000000000000')`)).toBe('locked');
    await expect(as(db, 'anon', {}, 'select public.mcp_connections()')).rejects.toThrow(/permission denied/);
  });
  it('the connection functions only answer the server, which knows the key', async () => {
    expect(await server('select public.mcp_ping($1)', [KEY])).toBe('ok');
    expect(await server('select public.mcp_ping($1)', ['x'.repeat(40)])).toBe('wrong-key');
    const { access: token } = await connect('lis_client_keycheck');
    await expect(as(db, 'anon', {}, 'select public.mcp_list($1, $2)', ['x'.repeat(40), sha(token)])).rejects.toThrow(/wrong server key/);
    expect(await server('select public.mcp_access($1, $2)', ['x'.repeat(40), sha(token)])).toBeNull();
    // A signed-in app session can't call them at all.
    await expect(as(db, 'authenticated', me, 'select public.mcp_list($1, $2)', [KEY, sha(token)])).rejects.toThrow(/permission denied/);
  });
  it('nobody reaches the tables directly', async () => {
    await expect(as(db, 'authenticated', me, 'select * from private.mcp_grants')).rejects.toThrow(/permission denied/);
    await expect(as(db, 'anon', {}, 'select * from private.mcp_codes')).rejects.toThrow(/permission denied/);
  });
});

describe('codes', () => {
  it('swap once for tokens, with the right verifier, client and redirect', async () => {
    const a = await allow();
    expect((await redeem(a.code, rand())).out).toEqual({ error: 'invalid_grant' });
    // A failed try uses the code up.
    expect((await redeem(a.code, a.verifier)).out).toEqual({ error: 'invalid_grant' });
    const b = await allow();
    expect((await redeem(b.code, b.verifier, { client: 'someone else' })).out).toEqual({ error: 'invalid_grant' });
    const c = await allow();
    expect((await redeem(c.code, c.verifier, { redirect: 'https://evil.example/cb' })).out).toEqual({ error: 'invalid_grant' });
    const d = await allow();
    const ok = await redeem(d.code, d.verifier);
    expect(ok.out).toMatchObject({ scope: 'tasks', resource: RESOURCE, expiresIn: 3600 });
    expect(await access(ok.access)).toMatchObject({ clientId: CLIENT, scope: 'tasks', resource: RESOURCE, tz: 'Asia/Kolkata' });
  });
  it('a code used twice ends the connection it made', async () => {
    const a = await allow();
    const first = await redeem(a.code, a.verifier);
    expect(await access(first.access)).not.toBeNull();
    expect((await redeem(a.code, a.verifier)).out).toEqual({ error: 'invalid_grant' });
    expect(await access(first.access)).toBeNull();
  });
  it('run out after five minutes', async () => {
    const a = await allow();
    await db.query(`update private.mcp_codes set expires_at = now() - interval '1 second' where code_sha256 = $1`, [sha(a.code)]);
    expect((await redeem(a.code, a.verifier)).out).toEqual({ error: 'invalid_grant' });
  });
  it('connecting the same client again replaces its last connection', async () => {
    const first = await connect('lis_client_twice');
    const second = await connect('lis_client_twice');
    expect(await access(first.access)).toBeNull();
    expect(await access(second.access)).not.toBeNull();
  });
});

describe('tokens', () => {
  const refresh = (old, { client = CLIENT, a = rand(), r = rand() } = {}) =>
    server('select public.mcp_refresh($1, $2, $3, $4, $5)', [KEY, sha(old), client, sha(a), sha(r)]).then(out => ({ out, access: a, refresh: r }));

  it('refreshing replaces both tokens', async () => {
    const c = await connect('lis_client_refresh');
    const next = await refresh(c.refresh, { client: 'lis_client_refresh' });
    expect(next.out).toMatchObject({ grant: c.grant, expiresIn: 3600 });
    expect(await access(c.access)).toBeNull();
    expect(await access(next.access)).not.toBeNull();
    // Another client can't use it.
    expect((await refresh(next.refresh, { client: 'other' })).out).toEqual({ error: 'invalid_grant' });
  });
  it('an old refresh token, used again, ends the connection; within 30 seconds it is only refused', async () => {
    const c = await connect('lis_client_reuse');
    const next = await refresh(c.refresh, { client: 'lis_client_reuse' });
    expect((await refresh(c.refresh, { client: 'lis_client_reuse' })).out).toEqual({ error: 'invalid_grant' });
    expect(await access(next.access)).not.toBeNull();
    await db.query(`update private.mcp_grants set rotated_at = now() - interval '1 minute' where id = $1`, [c.grant]);
    expect((await refresh(c.refresh, { client: 'lis_client_reuse' })).out).toEqual({ error: 'invalid_grant' });
    expect(await access(next.access)).toBeNull();
  });
  it('access tokens last an hour', async () => {
    const c = await connect('lis_client_hour');
    await db.query(`update private.mcp_grants set access_expires_at = now() - interval '1 second' where id = $1`, [c.grant]);
    expect(await access(c.access)).toBeNull();
    await expect(list(c.access)).rejects.toThrow(/invalid token/);
  });
  it('revoking either token ends the connection', async () => {
    const c = await connect('lis_client_revoke');
    expect(await server('select public.mcp_revoke_token($1, $2)', [KEY, sha(c.refresh)])).toBe('ok');
    expect(await access(c.access)).toBeNull();
    expect(await server('select public.mcp_revoke_token($1, $2)', [KEY, sha('unknown')])).toBe('ok');
  });
});

describe('what a connection can do', () => {
  let token;
  beforeAll(async () => { ({ access: token } = await connect('lis_client_tasks')); });

  it('reads your tasks as rows', async () => {
    const rows = await list(token);
    expect(rows.map(r => r.id).sort()).toEqual(['meet', 'mine']);
    expect(rows.find(r => r.id === 'mine')).toMatchObject({ title: 'Write the report', notes: 'a note', priority: 1 });
    expect(rows[0]).not.toHaveProperty('user_id');
  });
  it('adds and changes tasks, but never makes or changes a Google id', async () => {
    const rows = [row('new1', 'From Claude', { external_id: 'gcal:fake:x', label: 'work' }), row('meet', 'Team meeting', { priority: 1, external_id: null })];
    expect(await server('select public.mcp_put($1, $2, $3::jsonb)', [KEY, sha(token), JSON.stringify(rows)])).toBe(2);
    const now = await list(token);
    expect(now.find(r => r.id === 'new1')).toMatchObject({ title: 'From Claude', external_id: null, label: 'work' });
    expect(now.find(r => r.id === 'meet')).toMatchObject({ priority: 1, external_id: 'gcal:work@example.com:ev1' });
  });
  it('the table still checks every row', async () => {
    await expect(server('select public.mcp_put($1, $2, $3::jsonb)', [KEY, sha(token), JSON.stringify([row('bad', '')])])).rejects.toThrow(/check/);
    await expect(server('select public.mcp_put($1, $2, $3::jsonb)', [KEY, sha(token), JSON.stringify([row('bad', 'x', { minutes: 5000 })])])).rejects.toThrow(/check/);
  });
  it('deletes tasks', async () => {
    expect(await server('select public.mcp_remove($1, $2, $3)', [KEY, sha(token), ['new1', 'nope']])).toBe(1);
    expect((await list(token)).map(r => r.id)).not.toContain('new1');
  });
  it('reads your labels, repeats and slips, and writes only repeats and slips', async () => {
    expect(await server('select public.mcp_setting($1, $2, $3)', [KEY, sha(token), 'prefs'])).toMatchObject({ labels: [{ id: 'work' }] });
    expect(await server('select public.mcp_setting($1, $2, $3)', [KEY, sha(token), 'repeats'])).toBeNull();
    for (const name of ['google', 'history', 'voice']) {
      await expect(server('select public.mcp_setting($1, $2, $3)', [KEY, sha(token), name])).rejects.toThrow(/not available/);
    }
    expect(await server('select public.mcp_set_setting($1, $2, $3, $4::jsonb)', [KEY, sha(token), 'slips', '[]'])).toBe('ok');
    await expect(server('select public.mcp_set_setting($1, $2, $3, $4::jsonb)', [KEY, sha(token), 'prefs', '[]'])).rejects.toThrow(/not available/);
    await expect(server('select public.mcp_set_setting($1, $2, $3, $4::jsonb)', [KEY, sha(token), 'repeats', '{}'])).rejects.toThrow(/expected a list/);
  });
  it('a made-up token gets nothing', async () => {
    await expect(list(rand())).rejects.toThrow(/invalid token/);
    await expect(server('select public.mcp_put($1, $2, $3::jsonb)', [KEY, sha(rand()), '[]'])).rejects.toThrow(/invalid token/);
  });
});

describe('your connections', () => {
  it('lists live ones, and Disconnect ends one at once', async () => {
    const c = await connect('lis_client_settings');
    const before = await owner('select public.mcp_connections()');
    expect(before.keySet).toBe(true);
    const mine = before.connections.find(x => x.id === c.grant);
    expect(mine).toMatchObject({ clientName: 'Claude', redirectHost: 'claude.ai', scope: 'tasks' });
    expect(mine.expiresAt - Date.now()).toBeGreaterThan(29 * 864e5);
    expect(await owner('select public.mcp_disconnect($1)', [c.grant])).toBe('ok');
    expect(await access(c.access)).toBeNull();
    expect((await owner('select public.mcp_connections()')).connections.map(x => x.id)).not.toContain(c.grant);
    expect(await owner('select public.mcp_disconnect($1)', [c.grant])).toBe('not-found');
  });
  it('stops at 20 live connections', async () => {
    const live = (await owner('select public.mcp_connections()')).connections.length;
    for (let i = live; i < 20; i++) await connect(`lis_client_many_${i}`);
    expect((await allow({ client: 'lis_client_one_more' })).r).toBe('too-many');
  });
});

describe('the weekly check', () => {
  it('sees connections as dates only, and lets the server functions through', async () => {
    const snap = (await db.query('select audit.snapshot() as s')).rows[0].s;
    expect(snap.connectors.key_set).toBe(true);
    expect(snap.connectors.connections.length).toBeGreaterThan(0);
    expect(Object.keys(snap.connectors.connections[0]).sort()).toEqual(['created_at', 'last_used_at', 'live']);
    expect(snap.connectors.functions_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.anon_functions).toEqual(expect.arrayContaining(['mcp_access', 'mcp_list', 'mcp_put']));
    expect(snap.anon_functions).not.toContain('mcp_connections');
    const { findings } = evaluate({ primary: snap, backup: snap, ownerSha: sha('me@example.com') });
    expect(findings.filter(f => f.check.endsWith(':functions'))).toEqual([]);
    expect(findings.find(f => f.check === 'primary:connectors' && f.level === 'warn')?.detail).toMatch(/connection\(s\) to Claude added in the last 8 days/);
    expect(findings.find(f => f.check === 'backup:connectors')?.level).toBe('warn');
  });
});

describe('primary and backup', () => {
  it('block when the connector functions differ between them', async () => {
    const snap = (await db.query('select audit.snapshot() as s')).rows[0].s;
    const backup = { ...snap, connectors: { ...snap.connectors, key_set: false, connections: [], functions_sha256: '0'.repeat(64) } };
    const { findings } = evaluate({ primary: snap, backup, ownerSha: sha('me@example.com') });
    expect(findings).toContainEqual(expect.objectContaining({ level: 'block', check: 'both:connectors' }));
    expect(findings.find(f => f.check === 'backup:connectors')).toBeUndefined();
  });
});
