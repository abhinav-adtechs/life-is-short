// In-memory Postgres (PGlite) with small stand-ins for what Supabase provides, for tests that run
// the real migrations.
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = new URL('../../supabase/', import.meta.url);
export const sql = f => readFileSync(new URL(f, root), 'utf8');
/** Every migration, in order. */
export const MIGRATIONS = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => `migrations/${f}`);

// What Supabase provides that the migrations rely on.
export const STUB = `
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, factor_type text, status text,
    created_at timestamptz default now() - interval '30 days', updated_at timestamptz default now() - interval '30 days');
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), aal text, ip inet, user_agent text);
  create table auth.mfa_amr_claims (session_id uuid, authentication_method text, created_at timestamptz default now(), updated_at timestamptz default now());
  create table auth.webauthn_credentials (id uuid primary key default gen_random_uuid(), user_id uuid, credential_id bytea, public_key bytea,
    friendly_name text not null default '', created_at timestamptz default now() - interval '30 days',
    updated_at timestamptz default now() - interval '30 days', last_used_at timestamptz);
  create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz default now());
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create role authenticated nologin; create role anon nologin;
  grant usage on schema public, auth to authenticated, anon;
  grant execute on function auth.jwt(), auth.uid() to authenticated, anon;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  create publication supabase_realtime;
`;

/** A fresh database with the stand-ins and every migration applied. */
export async function migrated() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const f of MIGRATIONS) await db.exec(sql(f));
  return db;
}

/** Run a query as an API role with the given JWT claims. */
export async function as(db, role, claims, query, params) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false);`);
  try { return await db.query(query, params); } finally { await db.exec('reset role'); }
}
