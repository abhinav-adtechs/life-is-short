// Runs the real migrations in two in-memory Postgres databases (PGlite) with small stand-ins
// for Supabase's auth schema, then exercises 2FA enforcement, the breach checks and the copy.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { MIGRATIONS, as, migrated, sql } from '../db/pglite.mjs';
import { compareData, countLost, evaluate } from './checks.mjs';

const EMAIL = 'Me@Example.com';
const OWNER_SHA = createHash('sha256').update(EMAIL.toLowerCase()).digest('hex');
const P_OWNER = '11111111-1111-1111-1111-111111111111';
const B_OWNER = '22222222-2222-2222-2222-222222222222';
const nowS = () => Math.floor(Date.now() / 1000);

async function project(which) {
  const db = await migrated();
  await db.exec(sql(which === 'primary' ? 'roles/primary_backup_reader.sql' : 'roles/backup_writer.sql'));
  const owner = which === 'primary' ? P_OWNER : B_OWNER;
  await db.exec(`insert into auth.users (id, email) values ('${owner}', '${EMAIL}')`);
  if (which === 'primary') {
    await db.exec(`insert into auth.mfa_factors (user_id, factor_type, status) values ('${owner}', 'totp', 'verified')`);
    const t = (id, title, extra = '') => `('${owner}', '${id}', '${title}', 2, 30, 1793001600000, 1793001600000, 1793001600000 ${extra})`;
    await db.exec(`insert into public.tasks (user_id, id, title, priority, minutes, created, sort_order, updated_at) values
      ${t('a1', 'Alpha')}, ${t('b2', 'Beta')}, ${t('c3', "It''s quoted")}`);
    await db.exec(`update public.tasks set due = '2026-10-30', notes = 'n', label = 'work' where id = 'b2'`);
    await db.exec(`insert into public.settings (user_id, key, value) values ('${owner}', 'google', '{"blob":"x","email":null}')`);
  }
  return db;
}

const snap = async db => (await db.query('select audit.snapshot() as s')).rows[0].s;
/** A function as the last migration to define it left it, to put back after a test tampers with it. */
const latestDef = name => MIGRATIONS.map(f => sql(f).match(new RegExp(`create or replace function ${name.replace('.', '\\.')}\\(\\)[\\s\\S]*?\\$\\$;`)))
  .filter(Boolean).pop()[0];

let primary, backup, pServer, bServer;
const PORTS = [54391, 54392];
const url = port => `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

function runJob(mode, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/backup/run.mjs', mode], {
      env: { PATH: process.env.PATH, PRIMARY_DB_URL: url(PORTS[0]), BACKUP_DB_URL: url(PORTS[1]), OWNER_EMAIL: EMAIL, ...env },
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
}

beforeAll(async () => {
  [primary, backup] = await Promise.all([project('primary'), project('backup')]);
  pServer = new PGLiteSocketServer({ db: primary, port: PORTS[0] });
  bServer = new PGLiteSocketServer({ db: backup, port: PORTS[1] });
  await Promise.all([pServer.start(), bServer.start()]);
}, 60000);
afterAll(async () => { await Promise.allSettled([pServer?.stop(), bServer?.stop()]); });

describe('sign-in rule in the database', () => {
  const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';
  const S2 = 'aaaaaaaa-0000-0000-0000-000000000002';
  // A session's claims: seconds since the password and since the last authenticator code.
  const session = (sid, pwAgo, codeAgo, extra = {}) => ({
    sub: P_OWNER, role: 'authenticated', session_id: sid, aal: codeAgo == null ? 'aal1' : 'aal2',
    amr: [...(pwAgo == null ? [] : [{ method: 'password', timestamp: nowS() - pwAgo }]), ...(codeAgo == null ? [] : [{ method: 'totp', timestamp: nowS() - codeAgo }])],
    ...extra,
  });
  const count = async c => (await as(primary, 'authenticated', c, 'select count(*)::int n from public.tasks')).rows[0].n;
  const rpc = async (c, q) => Object.values((await as(primary, 'authenticated', c, q)).rows[0])[0];

  it('first sign-in: password and a code show your tasks', async () => {
    expect(await count(session(S1, 60, 30))).toBe(3);
  });
  it('the password alone shows nothing', async () => {
    expect(await count(session(S1, 5, null))).toBe(0);
  });
  it('a PIN can only be chosen right after a password sign-in and a code', async () => {
    expect(await rpc(session(S1, 5, null), `select public.set_pin('123456')`)).toBe('code-required');
    expect(await rpc(session(S1, 3600, 10), `select public.set_pin('123456')`)).toBe('password-required');
    expect(await rpc(session(S1, 60, 30), `select public.set_pin('12')`)).toBe('invalid');
    expect(await rpc(session(S1, 60, 30), `select public.set_pin('482915')`)).toBe('ok');
    const stored = (await primary.query('select pin_hash from private.pins')).rows[0].pin_hash;
    expect(stored).toMatch(/^\$2[ab]\$10\$/);
    expect(stored).not.toContain('482915');
  });
  it('the next day, the code alone is not enough', async () => {
    expect(await count(session(S2, 90000, 20))).toBe(0);
  });
  it('the next day, PIN + code unlocks; a wrong PIN does not, and counts', async () => {
    const s = session(S2, 90000, 20);
    expect(await rpc(s, `select public.unlock_with_pin('000000')`)).toBe('wrong');
    expect((await primary.query('select failed from private.pins')).rows[0].failed).toBe(1);
    expect(await count(s)).toBe(0);
    expect(await rpc(s, `select public.unlock_with_pin('482915')`)).toBe('ok');
    expect((await primary.query('select failed from private.pins')).rows[0].failed).toBe(0);
    expect(await count(s)).toBe(3);
  });
  it('an unlock is for that session only', async () => {
    expect(await count(session('aaaaaaaa-0000-0000-0000-000000000003', 90000, 20))).toBe(0);
  });
  it('a PIN without a fresh code unlocks nothing', async () => {
    expect(await rpc(session(S2, 90000, 90000), `select public.unlock_with_pin('482915')`)).toBe('code-required');
    expect(await count(session(S2, 90000, 90000))).toBe(0);
  });
  it('reports where a session stands', async () => {
    const st = await rpc(session(S2, 90000, 20), 'select public.pin_status()');
    expect(st).toMatchObject({ signed_in: true, has_pin: true, unlocked: true });
    expect(st.seconds_left).toBeGreaterThan(86000);
    expect(await rpc(session('aaaaaaaa-0000-0000-0000-000000000009', 90000, 20), 'select public.pin_status()')).toMatchObject({ has_pin: true, unlocked: false, seconds_left: 0 });
  });
  it('five wrong PINs erase it, and only the password can set a new one', async () => {
    const s = session('aaaaaaaa-0000-0000-0000-000000000004', 90000, 20);
    for (let i = 0; i < 4; i++) expect(await rpc(s, `select public.unlock_with_pin('111111')`)).toBe('wrong');
    expect(await rpc(s, `select public.unlock_with_pin('111111')`)).toBe('locked');
    expect((await primary.query('select count(*)::int n from private.pins')).rows[0].n).toBe(0);
    expect(await count(session(S2, 90000, 20))).toBe(0);
    expect(await rpc(s, `select public.unlock_with_pin('482915')`)).toBe('no-pin');
    expect(await rpc(session(S1, 30, 10), `select public.set_pin('482915')`)).toBe('ok');
  });
  // A session that signed in with a passkey `ago` seconds ago: Supabase gives it aal1 and amr 'passkey'.
  const S5 = 'aaaaaaaa-0000-0000-0000-000000000005';
  const passkey = (ago, extra = {}) => ({ sub: P_OWNER, role: 'authenticated', session_id: S5, aal: 'aal1', amr: [{ method: 'passkey', timestamp: nowS() - ago }], ...extra });
  it('a passkey sign-in shows your tasks for 24 hours, without the PIN or a code', async () => {
    expect(await count(passkey(60))).toBe(3);
    expect(await count(passkey(86500))).toBe(0);
    expect(await count(passkey(60, { sub: B_OWNER }))).toBe(0);
    expect(await count({ ...passkey(60), amr: [{ method: 'passkey', timestamp: 'now' }] })).toBe(0);
  });
  it('reports a passkey session and how many passkeys you have', async () => {
    await primary.exec(`insert into auth.webauthn_credentials (user_id, friendly_name) values ('${P_OWNER}', 'iCloud Keychain'), ('${B_OWNER}', 'Someone else')`);
    try {
      const st = await rpc(passkey(60), 'select public.pin_status()');
      expect(st).toMatchObject({ signed_in: true, unlocked: true, passkeys: 1, password_age: null, code_age: null });
      expect(st.passkey_age).toBeGreaterThanOrEqual(60);
      expect(st.seconds_left).toBeGreaterThan(86000);
      expect(await rpc(passkey(86500), 'select public.pin_status()')).toMatchObject({ unlocked: false, seconds_left: 0, passkeys: 1 });
      expect(await rpc(session(S2, 90000, 20), 'select public.pin_status()')).toMatchObject({ passkey_age: null });
    } finally { await primary.exec('delete from auth.webauthn_credentials'); }
  });
  it('a passkey doesn’t choose a PIN: that still takes the password and a code', async () => {
    expect(await rpc(passkey(60), `select public.set_pin('482915')`)).toBe('code-required');
    const stepped = { ...passkey(60), aal: 'aal2', amr: [...passkey(60).amr, { method: 'totp', timestamp: nowS() - 5 }] };
    expect(await rpc(stepped, `select public.set_pin('482915')`)).toBe('password-required');
    });
  // Face ID: a passkey sign-in on the side (aal1 to Supabase, no password), which vouches for the device's own session.
  const side = (ago = 5) => ({ sub: P_OWNER, role: 'authenticated', session_id: 'cccccccc-0000-0000-0000-00000000000f', aal: 'aal1', amr: [{ method: 'passkey', timestamp: nowS() - ago }] });
  const DEVICE = 'aaaaaaaa-0000-0000-0000-000000000006';
  const device = session(DEVICE, 200000, 200000); // signed in with the password and a code days ago: aal2, locked
  const vouch = async (claims, sid = DEVICE) => rpc(claims, `select public.face_id_unlock('${sid}')`);
  it('Face ID renews the device’s own session; the PIN is still needed', async () => {
    await primary.exec(`insert into auth.sessions (id, user_id, aal) values ('${DEVICE}', '${P_OWNER}', 'aal2')`);
    expect(await count(device)).toBe(0);
    expect(await rpc(device, `select public.unlock_with_pin('482915')`)).toBe('code-required');
    expect(await vouch(side())).toBe('ok');
    expect(await count(device)).toBe(0);
    const st = await rpc(device, 'select public.pin_status()');
    expect(st).toMatchObject({ has_pin: true, unlocked: false, code_fresh: true });
    expect(st.code_age).toBeLessThan(60);
    expect(await rpc(device, `select public.unlock_with_pin('000000')`)).toBe('wrong');
    expect(await rpc(device, `select public.unlock_with_pin('482915')`)).toBe('ok');
    expect(await count(device)).toBe(3);
    expect(await rpc(device, 'select public.pin_status()')).toMatchObject({ unlocked: true, code_fresh: true });
    expect((await rpc(device, 'select public.pin_status()')).seconds_left).toBeGreaterThan(86000);
  });
  it('the side session is a passkey sign-in like any other (0007): it reads your tasks, but the PIN can’t unlock it', async () => {
    expect(await count(side())).toBe(3);
    expect(await rpc(side(), `select public.unlock_with_pin('482915')`)).toBe('code-required');
  });
  it('only a passkey sign-in from the last two minutes can vouch', async () => {
    expect(await vouch(side(300))).toBe('face-id-required');
    expect(await vouch(session(S1, 30, 10))).toBe('face-id-required');
  });
  it('only for a session of yours that passed a code once', async () => {
    const half = 'aaaaaaaa-0000-0000-0000-000000000007';
    await primary.exec(`insert into auth.sessions (id, user_id, aal) values ('${half}', '${P_OWNER}', 'aal1'), ('aaaaaaaa-0000-0000-0000-000000000008', '${B_OWNER}', 'aal2')`);
    expect(await vouch(side(), half)).toBe('not-this-session');
    expect(await vouch(side(), 'aaaaaaaa-0000-0000-0000-000000000008')).toBe('not-this-session');
    expect(await vouch(side(), 'aaaaaaaa-0000-0000-0000-0000000000ff')).toBe('not-this-session');
    expect(await vouch({ ...side(), sub: B_OWNER })).toBe('not-this-session');
    await primary.exec(`delete from auth.sessions where id <> '${DEVICE}'`);
  });
  it('Face ID lasts 24 hours, and can’t choose a PIN', async () => {
    expect(await rpc(device, `select public.set_pin('111111')`)).toBe('password-required');
    await primary.exec(`update private.face_ids set verified_at = now() - interval '25 hours'`);
    expect(await count(device)).toBe(0);
    expect(await rpc(device, 'select public.pin_status()')).toMatchObject({ code_fresh: false, unlocked: false });
    await primary.exec('delete from private.face_ids; delete from auth.sessions');
  });
  it('Face ID records are out of reach from the app', async () => {
    await expect(as(primary, 'authenticated', session(S1, 30, 10), 'select * from private.face_ids')).rejects.toThrow(/permission denied/);
    await expect(as(primary, 'anon', {}, `select public.face_id_unlock('${DEVICE}')`)).rejects.toThrow(/permission denied/);
  });
  it('the PIN table is out of reach from the app', async () => {
    await expect(as(primary, 'authenticated', session(S1, 30, 10), 'select * from private.pins')).rejects.toThrow(/permission denied/);
  });
  it('shows nothing to someone else, even fully signed in', async () => {
    expect(await count(session(S1, 30, 10, { sub: B_OWNER }))).toBe(0);
  });
  it('gives signed-out visitors no access at all', async () => {
    await expect(as(primary, 'anon', {}, 'select count(*) from public.tasks')).rejects.toThrow(/permission denied/);
    await expect(as(primary, 'anon', {}, `select public.unlock_with_pin('482915')`)).rejects.toThrow(/permission denied/);
  });
  it('lets the backup login read but never write', async () => {
    expect((await as(primary, 'backup_reader', {}, 'select count(*)::int n from public.tasks')).rows[0].n).toBe(3);
    await expect(as(primary, 'backup_reader', {}, `delete from public.tasks`)).rejects.toThrow();
  });
});

describe('breach checks on real snapshots', () => {
  it('pass on a healthy pair with no warnings', async () => {
    const r = evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA });
    expect(r.findings.filter(f => f.level !== 'info')).toEqual([]);
    expect(r.primaryOwner.id).toBe(P_OWNER);
  });
  it('warn when anyone signs in to the backup, which has no app', async () => {
    await backup.exec(`insert into auth.mfa_factors (user_id, factor_type, status) values ('${B_OWNER}', 'totp', 'verified')`);
    try {
      const r = evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA });
      expect(r.findings).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'warn', check: 'backup:2fa' })]));
    } finally { await backup.exec('delete from auth.mfa_factors'); }
  });
  it('warn on wrong PIN attempts', async () => {
    await primary.exec('update private.pins set failed = 2');
    try {
      const r = evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA });
      expect(r.findings).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'warn', check: 'primary:pin', detail: '2 wrong PIN attempt(s) since the last unlock' })]));
    } finally { await primary.exec('update private.pins set failed = 0'); }
  });

  it('warn about a passkey added this week, and on the backup', async () => {
    await primary.exec(`insert into auth.webauthn_credentials (user_id, created_at) values ('${P_OWNER}', now() - interval '2 days'), ('${P_OWNER}', default)`);
    await backup.exec(`insert into auth.webauthn_credentials (user_id) values ('${B_OWNER}')`);
    try {
      const r = evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA });
      expect(r.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ level: 'warn', check: 'primary:passkeys', detail: '1 passkey(s) added in the last 8 days' }),
        expect.objectContaining({ level: 'info', check: 'primary:passkeys', detail: '2 passkey(s), 0 Face ID unlock(s) in 7 days' }),
        expect.objectContaining({ level: 'warn', check: 'backup:passkeys' }),
      ]));
      expect(r.blocked).toBe(false);
    } finally { await primary.exec('delete from auth.webauthn_credentials'); await backup.exec('delete from auth.webauthn_credentials'); }
  });
  it('read a project from before passkeys as having none, and say the passkeys couldn’t be read', () => {
    const r = evaluate({ primary: { passkeys: { unavailable: true } }, backup: {}, ownerSha: OWNER_SHA });
    expect(r.findings.filter(f => f.check.endsWith(':passkeys'))).toEqual([
      { level: 'info', check: 'primary:passkeys', detail: 'couldn’t read the passkeys (auth.webauthn_credentials)' },
    ]);
  });

  it('count what a sync would lose by comparing the rows, not timestamps', () => {
    const b = [{ id: 'a', title: 'A', notes: '', raw: 'a' }, { id: 'b', title: 'B', notes: null, raw: null }, { id: 'c', title: 'C', notes: 'n', raw: '' }];
    expect(countLost(b.map(t => ({ ...t, status: 'done', start: 1 })), b)).toBe(0);
    expect(countLost([{ ...b[0], title: 'A!' }, { ...b[1], notes: '' }, b[2]], b)).toBe(1);
    expect(countLost([b[0], { id: 'new', title: 'N' }], b)).toBe(2);
  });
  it('guard against mass rewrites only when the backup differs', async () => {
    const [p, b] = [await snap(primary), await snap(backup)];
    const bulk = { count: 20, open: 20, updated_24h: 20, max_updated_at: 1, sha256: 'same' };
    const run = (pt, bt, lost) => evaluate({ primary: { ...p, tasks: pt }, backup: { ...b, tasks: bt }, ownerSha: OWNER_SHA, lost }).findings.map(f => f.check);
    expect(run(bulk, { ...bulk }, 20)).not.toContain('data:mass-change');
    expect(run(bulk, { ...bulk, sha256: 'older' }, 20)).toContain('data:mass-change');
    // Everything edited today, but only ticks and moves: nothing would be lost.
    expect(run(bulk, { ...bulk, sha256: 'older' }, 0)).not.toContain('data:mass-change');
    expect(run({ ...bulk, count: 2, updated_24h: 0, sha256: 'new' }, { ...bulk })).toContain('data:mass-deletion');
  });

  const tampered = async (attack, undo) => {
    await primary.exec(attack);
    try { return evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA }).findings.filter(f => f.level === 'block').map(f => f.check); }
    finally { await primary.exec(undo); }
  };
  it('block when RLS is switched off', async () => {
    expect(await tampered('alter table public.tasks disable row level security', 'alter table public.tasks enable row level security')).toContain('primary:rls');
  });
  it('block when a policy opens the table', async () => {
    expect(await tampered(`create policy "open" on public.tasks for select to authenticated using (true)`, 'drop policy "open" on public.tasks')).toContain('primary:policies');
  });
  it('block when the sign-in policy is dropped', async () => {
    expect(await tampered('drop policy "unlocked" on public.tasks',
      `create policy "unlocked" on public.tasks as restrictive for all to authenticated using ((select private.access_ok())) with check ((select private.access_ok()))`)).toContain('primary:policies');
  });
  it('block when the sign-in rule is weakened', async () => {
    expect(await tampered(`create or replace function private.access_ok() returns boolean language sql stable security definer set search_path = '' as $$ select private.mfa_fresh() $$;`, latestDef('private.access_ok')))
      .toEqual(expect.arrayContaining(['primary:access-rule', 'both:access-rule']));
  });
  it('block when the 2FA rule itself is weakened', async () => {
    expect(await tampered(`create or replace function private.mfa_fresh() returns boolean language sql stable set search_path = '' as $$ select true $$;`, latestDef('private.mfa_fresh')))
      .toEqual(expect.arrayContaining(['primary:2fa-rule', 'both:2fa-rule']));
  });
  it('count Face ID unlocks, and take a passkey that was used as used, not new', async () => {
    const run = async () => evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA }).findings;
    await primary.exec(`insert into auth.webauthn_credentials (user_id) values ('${P_OWNER}')`);
    await primary.exec(`insert into private.face_ids (session_id, user_id) values ('${'aaaaaaaa-0000-0000-0000-0000000000ee'}', '${P_OWNER}')`);
    try {
      expect((await run()).filter(f => f.level !== 'info')).toEqual([]);
      expect(await run()).toEqual(expect.arrayContaining([{ level: 'info', check: 'primary:passkeys', detail: '1 passkey(s), 1 Face ID unlock(s) in 7 days' }]));
      // Used today: its row changes, but it isn't new.
      await primary.exec(`update auth.webauthn_credentials set updated_at = now(), last_used_at = now()`);
      expect((await run()).filter(f => f.level !== 'info')).toEqual([]);
    } finally {
      await primary.exec('delete from auth.webauthn_credentials; delete from private.face_ids');
    }
  });
  it('don’t take a passkey sign-in (Face ID’s too) for a password that skipped 2FA', async () => {
    const [face, half] = ['bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'];
    await primary.exec(`insert into auth.sessions (id, user_id, aal) values ('${face}', '${P_OWNER}', 'aal1'), ('${half}', '${P_OWNER}', 'aal1');
      insert into auth.mfa_amr_claims (session_id, authentication_method) values ('${face}', 'passkey'), ('${half}', 'password')`);
    try {
      const found = evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA }).findings.filter(f => f.check === 'primary:sessions');
      expect(found).toEqual([
        { level: 'warn', check: 'primary:sessions', detail: '1 sign-in(s) in 7 days passed the password but not 2FA' },
        { level: 'info', check: 'primary:sessions', detail: '2 sign-ins in 7 days from 0 IP(s), 0 device(s)' },
      ]);
    } finally {
      await primary.exec('delete from auth.mfa_amr_claims; delete from auth.sessions');
    }
  });
  it('block when another account appears', async () => {
    expect(await tampered(`insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'intruder@example.com')`,
      `delete from auth.users where email = 'intruder@example.com'`)).toContain('primary:users');
  });
  it('block when a passkey belongs to another account', async () => {
    expect(await tampered(`insert into auth.webauthn_credentials (user_id) values ('33333333-3333-3333-3333-333333333333')`,
      'delete from auth.webauthn_credentials')).toContain('primary:passkeys');
  });
  it('block when the authenticator is removed', async () => {
    expect(await tampered(`update auth.mfa_factors set status = 'unverified'`, `update auth.mfa_factors set status = 'verified'`)).toContain('primary:2fa');
  });
  it('block when signed-out visitors get access', async () => {
    expect(await tampered('grant select on public.tasks to anon', 'revoke select on public.tasks from anon')).toContain('primary:grants');
  });
  it('block on a sign-up event', async () => {
    expect(await tampered(`insert into auth.audit_log_entries (payload) values ('{"action":"user_signedup"}')`,
      `delete from auth.audit_log_entries`)).toContain('primary:auth-events');
  });
});

describe('backup job end to end', () => {
  it('copies everything across and the copy matches', async () => {
    const r = await runJob('sync');
    expect(r.out).toMatch(/backup overwritten with 3 tasks and 1 settings; contents match the primary/);
    expect(r.code).toBe(0);
    const rows = (await backup.query(`select user_id, count(*)::int n from public.tasks group by 1`)).rows;
    expect(rows).toEqual([{ user_id: B_OWNER, n: 3 }]);
    expect(compareData(await snap(primary), await snap(backup))).toEqual([]);
    expect((await backup.query(`select label from public.tasks where id = 'b2'`)).rows[0].label).toBe('work');
    // A label that drifts is a difference too.
    await backup.exec(`update public.tasks set label = 'personal' where id = 'b2'`);
    expect(compareData(await snap(primary), await snap(backup))).toEqual([expect.stringMatching(/tasks differ/)]);
    await backup.exec(`update public.tasks set label = 'work' where id = 'b2'`);
    expect((await backup.query('select count(*)::int n from audit.sync_log')).rows[0].n).toBe(1);
    // Public CI logs never carry task text or emails.
    expect(r.out).not.toMatch(/Alpha|Beta|quoted|example\.com/i);
  }, 30000);

  it('refuses to overwrite when a breach check fails, keeping the last good copy', async () => {
    await primary.exec('alter table public.settings disable row level security');
    await primary.exec(`delete from public.tasks where id = 'a1'`);
    try {
      const r = await runJob('sync');
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/BLOCK primary:rls/);
      expect((await backup.query('select count(*)::int n from public.tasks')).rows[0].n).toBe(3);
    } finally {
      await primary.exec('alter table public.settings enable row level security');
    }
  }, 30000);

  it('refuses when the backup was edited after the last sync, unless forced', async () => {
    await backup.exec(`update public.tasks set updated_at = (extract(epoch from now()) * 1000)::bigint + 60000 where id = 'b2'`);
    const r = await runJob('sync');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/BLOCK data:backup-in-use/);
    const forced = await runJob('sync', { FORCE: 'true' });
    expect(forced.code).toBe(0);
    expect((await backup.query('select count(*)::int n from public.tasks')).rows[0].n).toBe(2);
  }, 30000);

  it('lets a busy day through but refuses a mass rewrite, even backdated', async () => {
    const old = 1793001600000;
    const extra = Array.from({ length: 11 }, (_, i) => `('${P_OWNER}', 'x${i}', 'Extra ${i}', 2, 30, ${old}, ${old}, ${old})`);
    await primary.exec(`insert into public.tasks (user_id, id, title, priority, minutes, created, sort_order, updated_at) values ${extra.join(',')}`);
    try {
      expect((await runJob('sync')).code).toBe(0);
      await primary.exec(`update public.tasks set status = 'done', done_at = ${old}, updated_at = (extract(epoch from now()) * 1000)::bigint`);
      const busy = await runJob('sync');
      expect(busy.out).not.toMatch(/mass-change/);
      expect(busy.code).toBe(0);
      await primary.exec(`update public.tasks set title = 'scrambled', updated_at = ${old} where id like 'x%'`);
      const r = await runJob('sync');
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/BLOCK data:mass-change\s+11 of the backup's 13 tasks would be deleted or rewritten/);
      expect((await backup.query(`select count(*)::int n from public.tasks where title = 'scrambled'`)).rows[0].n).toBe(0);
    } finally {
      await primary.exec(`delete from public.tasks where id like 'x%'; update public.tasks set status = 'open', done_at = null`);
      expect((await runJob('sync', { FORCE: 'true' })).code).toBe(0);
    }
  }, 60000);

  it('weekly verify fails on warnings and passes once they are cleared', async () => {
    await primary.exec('update private.pins set failed = 1');
    const r = await runJob('verify');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/WARN  primary:pin/);
    await primary.exec('update private.pins set failed = 0');
    const ok = await runJob('verify');
    expect(ok.out).toMatch(/contents match the primary/);
    expect(ok.code).toBe(0);
  }, 30000);

  it('restore puts the backup back into the primary, only when confirmed', async () => {
    await primary.exec(`delete from public.tasks`);
    const refused = await runJob('restore', { RESTORE_TO_DB_URL: url(PORTS[0]) });
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/CONFIRM=overwrite-primary/);
    expect((await primary.query('select count(*)::int n from public.tasks')).rows[0].n).toBe(0);
    const r = await runJob('restore', { RESTORE_TO_DB_URL: url(PORTS[0]), CONFIRM: 'overwrite-primary' });
    expect(r.out).toMatch(/primary now holds 2 tasks and 1 settings, matching the backup/);
    expect(r.code).toBe(0);
    expect((await primary.query('select user_id, count(*)::int n from public.tasks group by 1')).rows).toEqual([{ user_id: P_OWNER, n: 2 }]);
    expect(compareData(await snap(primary), await snap(backup))).toEqual([]);
  }, 30000);

  it('does nothing when not configured', async () => {
    const r = await runJob('sync', { PRIMARY_DB_URL: '', BACKUP_DB_URL: '' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/not configured/);
  });
});
