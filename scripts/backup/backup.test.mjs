// Runs the real migrations in two in-memory Postgres databases (PGlite) with small stand-ins
// for Supabase's auth schema, then exercises 2FA enforcement, the breach checks and the copy.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { compareData, evaluate } from './checks.mjs';

const root = new URL('../../supabase/', import.meta.url);
const sql = f => readFileSync(new URL(f, root), 'utf8');
const EMAIL = 'Me@Example.com';
const OWNER_SHA = createHash('sha256').update(EMAIL.toLowerCase()).digest('hex');
const P_OWNER = '11111111-1111-1111-1111-111111111111';
const B_OWNER = '22222222-2222-2222-2222-222222222222';
const nowS = () => Math.floor(Date.now() / 1000);

// What Supabase provides that the migrations rely on.
const STUB = `
  create schema auth;
  create table auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, factor_type text, status text,
    created_at timestamptz default now() - interval '30 days', updated_at timestamptz default now() - interval '30 days');
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), aal text, ip inet, user_agent text);
  create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz default now());
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create role authenticated nologin; create role anon nologin;
  grant usage on schema public, auth to authenticated, anon;
  grant execute on function auth.jwt(), auth.uid() to authenticated, anon;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  create publication supabase_realtime;
`;

async function project(which) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of ['migrations/0001_init.sql', 'migrations/0002_require_fresh_2fa.sql', 'migrations/0003_audit_snapshot.sql']) await db.exec(sql(f));
  await db.exec(sql(which === 'primary' ? 'roles/primary_backup_reader.sql' : 'roles/backup_writer.sql'));
  const owner = which === 'primary' ? P_OWNER : B_OWNER;
  await db.exec(`insert into auth.users (id, email) values ('${owner}', '${EMAIL}')`);
  if (which === 'primary') {
    await db.exec(`insert into auth.mfa_factors (user_id, factor_type, status) values ('${owner}', 'totp', 'verified')`);
    const t = (id, title, extra = '') => `('${owner}', '${id}', '${title}', 2, 30, 1793001600000, 1793001600000, 1793001600000 ${extra})`;
    await db.exec(`insert into public.tasks (user_id, id, title, priority, minutes, created, sort_order, updated_at) values
      ${t('a1', 'Alpha')}, ${t('b2', 'Beta')}, ${t('c3', "It''s quoted")}`);
    await db.exec(`update public.tasks set due = '2026-10-30', notes = 'n' where id = 'b2'`);
    await db.exec(`insert into public.settings (user_id, key, value) values ('${owner}', 'google', '{"blob":"x","email":null}')`);
  }
  return db;
}

async function as(db, role, claims, query) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false);`);
  try { return await db.query(query); } finally { await db.exec('reset role'); }
}
const snap = async db => (await db.query('select audit.snapshot() as s')).rows[0].s;

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

describe('2FA in the database', () => {
  const fresh = { sub: P_OWNER, role: 'authenticated', aal: 'aal2', amr: [{ method: 'password', timestamp: nowS() - 60 }, { method: 'totp', timestamp: nowS() - 30 }] };
  const count = async claims => (await as(primary, 'authenticated', claims, 'select count(*)::int n from public.tasks')).rows[0].n;

  it('shows tasks to the owner after a code in the last 24 hours', async () => {
    expect(await count(fresh)).toBe(3);
  });
  it('shows nothing with the password alone', async () => {
    expect(await count({ ...fresh, aal: 'aal1', amr: [{ method: 'password', timestamp: nowS() }] })).toBe(0);
  });
  it('shows nothing once the code is more than 24 hours old', async () => {
    expect(await count({ ...fresh, amr: [{ method: 'totp', timestamp: nowS() - 86400 - 5 }] })).toBe(0);
  });
  it('shows nothing to someone else, even with fresh 2FA', async () => {
    expect(await count({ ...fresh, sub: B_OWNER })).toBe(0);
  });
  it('refuses writes with a stale code', async () => {
    const stale = { ...fresh, amr: [{ method: 'totp', timestamp: nowS() - 90000 }] };
    await expect(as(primary, 'authenticated', stale,
      `insert into public.tasks (user_id, id, title, priority, minutes, created, sort_order) values ('${P_OWNER}', 'zz', 'x', 2, 30, 0, 0)`)).rejects.toThrow();
  });
  it('gives signed-out visitors no access at all', async () => {
    await expect(as(primary, 'anon', {}, 'select count(*) from public.tasks')).rejects.toThrow(/permission denied/);
  });
  it('lets the backup login read but never write', async () => {
    expect((await as(primary, 'backup_reader', {}, 'select count(*)::int n from public.tasks')).rows[0].n).toBe(3);
    await expect(as(primary, 'backup_reader', {}, `delete from public.tasks`)).rejects.toThrow();
  });
});

describe('breach checks on real snapshots', () => {
  it('pass on a healthy pair, warning that the backup has no authenticator yet', async () => {
    const r = evaluate({ primary: await snap(primary), backup: await snap(backup), ownerSha: OWNER_SHA });
    expect(r.findings.filter(f => f.level === 'block')).toEqual([]);
    expect(r.findings.some(f => f.check === 'backup:2fa' && f.level === 'warn')).toBe(true);
    expect(r.primaryOwner.id).toBe(P_OWNER);
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
  it('block when the 2FA policy is dropped', async () => {
    expect(await tampered('drop policy "fresh 2fa" on public.tasks',
      `create policy "fresh 2fa" on public.tasks as restrictive for all to authenticated using ((select private.mfa_fresh())) with check ((select private.mfa_fresh()))`)).toContain('primary:policies');
  });
  it('block when the 2FA rule itself is weakened', async () => {
    const original = sql('migrations/0002_require_fresh_2fa.sql').match(/create or replace function private\.mfa_fresh\(\)[\s\S]*?\$\$;/)[0];
    expect(await tampered(`create or replace function private.mfa_fresh() returns boolean language sql stable set search_path = '' as $$ select true $$;`, original))
      .toEqual(expect.arrayContaining(['primary:2fa-rule', 'both:2fa-rule']));
  });
  it('block when another account appears', async () => {
    expect(await tampered(`insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'intruder@example.com')`,
      `delete from auth.users where email = 'intruder@example.com'`)).toContain('primary:users');
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

  it('weekly verify fails on warnings and passes once they are cleared', async () => {
    const r = await runJob('verify');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/WARN  backup:2fa/);
    await backup.exec(`insert into auth.mfa_factors (user_id, factor_type, status) values ('${B_OWNER}', 'totp', 'verified')`);
    const ok = await runJob('verify');
    expect(ok.out).toMatch(/contents match the primary/);
    expect(ok.code).toBe(0);
  }, 30000);

  it('does nothing when not configured', async () => {
    const r = await runJob('sync', { PRIMARY_DB_URL: '', BACKUP_DB_URL: '' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/not configured/);
  });
});
