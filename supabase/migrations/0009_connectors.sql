-- Connectors: let Claude (claude.ai → Settings → Connectors) read and change your tasks, through this app's MCP server
-- at /mcp (app/mcp, lib/server/mcp). Builds on 0004 (private.access_ok) and 0005 (private.ms). Run it after 0008, on the
-- primary and on the backup, so the weekly check can compare the two.
--
-- How it's locked down, in the same shape as sharing (0005):
--   * You connect Claude on a consent screen that only an unlocked session reaches (PIN + code, Face ID or a passkey,
--     in the last 24 hours). Pressing Allow makes a one-time code (5 minutes) bound to Claude's PKCE challenge.
--   * The app's server swaps that code for an access token (1 hour) and a refresh token (30 days, replaced every time
--     it's used). Only their sha256 is kept here. A code used twice, or a refresh token used again after it was
--     replaced, ends the connection.
--   * Every function a connection uses refuses a caller that doesn't present MCP_SERVER_KEY, the app server's secret;
--     the database keeps only its sha256. The anon key alone, the server key alone, or a token alone gets nothing.
--   * A connection sees your tasks and three settings: your labels (prefs), repeats and missed slots (slips). Never your
--     Google tokens, chat history, voice profile, shares or anything about signing in. It can't make Google items.
--   * Settings → Claude lists every connection, when it was last used, and disconnects it on the spot.

create table if not exists private.mcp_key (
  id         boolean primary key default true check (id),
  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

-- The code the consent screen sends back to Claude, swapped once for tokens.
create table if not exists private.mcp_codes (
  code_sha256  text primary key check (code_sha256 ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references auth.users (id) on delete cascade,
  client_id    text not null check (char_length(client_id) between 1 and 4096),
  client_name  text not null default '' check (char_length(client_name) <= 100),
  redirect_uri text not null check (char_length(redirect_uri) between 1 and 2000),
  challenge    text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource     text not null check (char_length(resource) between 1 and 2000),
  scope        text not null check (char_length(scope) <= 200),
  tz           text not null check (char_length(tz) <= 64),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  grant_id     uuid
);

-- One connection: a client you allowed, and the tokens it holds now.
create table if not exists private.mcp_grants (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  client_id           text not null check (char_length(client_id) between 1 and 4096),
  client_name         text not null default '' check (char_length(client_name) <= 100),
  redirect_host       text not null default '' check (char_length(redirect_host) <= 255),
  resource            text not null check (char_length(resource) between 1 and 2000),
  scope               text not null check (char_length(scope) <= 200),
  tz                  text not null check (char_length(tz) <= 64),
  access_sha256       text unique check (access_sha256 ~ '^[0-9a-f]{64}$'),
  access_expires_at   timestamptz,
  refresh_sha256      text unique check (refresh_sha256 ~ '^[0-9a-f]{64}$'),
  refresh_expires_at  timestamptz,
  prev_refresh_sha256 text,
  rotated_at          timestamptz,
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz,
  revoked_at          timestamptz
);
create index if not exists mcp_grants_user on private.mcp_grants (user_id);
create index if not exists mcp_grants_prev on private.mcp_grants (prev_refresh_sha256) where prev_refresh_sha256 is not null;

revoke all on private.mcp_key, private.mcp_codes, private.mcp_grants from public, anon, authenticated;

/* ---------- helpers ---------- */

-- The caller is this app's server: it knows MCP_SERVER_KEY.
create or replace function private.mcp_key_ok(p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(char_length(p_key) >= 32, false)
     and exists (select 1 from private.mcp_key k where k.key_sha256 = encode(sha256(convert_to(p_key, 'UTF8')), 'hex'))
$$;

create or replace function private.mcp_live(g private.mcp_grants)
returns boolean
language sql
stable
set search_path = ''
as $$ select g.revoked_at is null and g.refresh_expires_at > now() $$;

-- The live connection an access token belongs to. Raises for anything else, so no caller can mistake it for "no tasks".
create or replace function private.mcp_grant(p_key text, p_access_sha256 text)
returns private.mcp_grants
language plpgsql
stable
set search_path = ''
as $$
declare
  g private.mcp_grants;
begin
  if not private.mcp_key_ok(p_key) then raise exception 'mcp: wrong server key' using errcode = '28000'; end if;
  select * into g from private.mcp_grants x
  where x.access_sha256 = lower(coalesce(p_access_sha256, '')) and x.access_expires_at > now() and private.mcp_live(x);
  if not found then raise exception 'mcp: invalid token' using errcode = '28000'; end if;
  return g;
end;
$$;

-- Tokens for a connection: an hour of access, thirty days to refresh.
create or replace function private.mcp_tokens(g private.mcp_grants)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('grant', g.id, 'scope', g.scope, 'resource', g.resource, 'tz', g.tz,
    'expiresIn', greatest(0, extract(epoch from g.access_expires_at - now())::bigint))
$$;

create or replace function private.mcp_json(g private.mcp_grants)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', g.id, 'clientName', g.client_name, 'redirectHost', g.redirect_host, 'scope', g.scope,
    'createdAt', private.ms(g.created_at), 'lastUsedAt', private.ms(g.last_used_at), 'expiresAt', private.ms(g.refresh_expires_at))
$$;

revoke all on function private.mcp_key_ok(text), private.mcp_live(private.mcp_grants), private.mcp_grant(text, text),
  private.mcp_tokens(private.mcp_grants), private.mcp_json(private.mcp_grants) from public;

-- Run once in the SQL editor with the sha256 of MCP_SERVER_KEY (docs/setup.md). Not callable through the API.
create or replace function private.set_mcp_key_hash(hash text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if lower(coalesce(hash, '')) !~ '^[0-9a-f]{64}$' then return 'expected 64 hex characters: the sha256 of MCP_SERVER_KEY'; end if;
  insert into private.mcp_key (id, key_sha256) values (true, lower(hash))
  on conflict (id) do update set key_sha256 = excluded.key_sha256, updated_at = now();
  return 'ok';
end;
$$;
revoke all on function private.set_mcp_key_hash(text) from public;

/* ---------- yours: only a fully signed-in session ---------- */

-- You pressed Allow. The server calls this with your session and its key, so neither alone can make a code.
-- Returns 'ok', 'locked', 'key', 'invalid' or 'too-many'.
create or replace function public.mcp_authorize(p_key text, p_code_sha256 text, p_client_id text, p_client_name text,
  p_redirect_uri text, p_challenge text, p_resource text, p_scope text, p_tz text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  zone text := left(coalesce(nullif(trim(p_tz), ''), 'UTC'), 64);
begin
  if uid is null or not private.access_ok() then return 'locked'; end if;
  if not private.mcp_key_ok(p_key) then return 'key'; end if;
  if coalesce(p_code_sha256, '') !~ '^[0-9a-f]{64}$' or coalesce(p_challenge, '') !~ '^[A-Za-z0-9_-]{43}$'
     or char_length(coalesce(p_client_id, '')) not between 1 and 4096
     or char_length(coalesce(p_redirect_uri, '')) not between 1 and 2000
     or char_length(coalesce(p_resource, '')) not between 1 and 2000 then
    return 'invalid';
  end if;
  begin
    perform now() at time zone zone;
  exception when others then
    zone := 'UTC';
  end;
  if (select count(*) from private.mcp_grants x where x.user_id = uid and private.mcp_live(x)) >= 20 then return 'too-many'; end if;
  delete from private.mcp_codes where created_at < now() - interval '1 day';
  insert into private.mcp_codes (code_sha256, user_id, client_id, client_name, redirect_uri, challenge, resource, scope, tz, expires_at)
  values (p_code_sha256, uid, p_client_id, left(trim(coalesce(p_client_name, '')), 100), p_redirect_uri, p_challenge, p_resource,
          left(coalesce(p_scope, ''), 200), zone, now() + interval '5 minutes');
  return 'ok';
end;
$$;

-- Your live connections, newest first, for Settings → Claude. Null when this session isn't unlocked.
create or replace function public.mcp_connections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not private.access_ok() then return null; end if;
  return jsonb_build_object(
    'keySet', exists (select 1 from private.mcp_key),
    'connections', coalesce((select jsonb_agg(private.mcp_json(x) order by x.created_at desc)
      from private.mcp_grants x where x.user_id = uid and private.mcp_live(x)), '[]'::jsonb));
end;
$$;

-- Disconnect: its tokens stop working at once. Returns 'ok', 'locked' or 'not-found'.
create or replace function public.mcp_disconnect(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not private.access_ok() then return 'locked'; end if;
  update private.mcp_grants set revoked_at = now(), access_sha256 = null, refresh_sha256 = null
  where id = p_id and user_id = uid and revoked_at is null;
  return case when found then 'ok' else 'not-found' end;
end;
$$;

revoke all on function public.mcp_authorize(text, text, text, text, text, text, text, text, text), public.mcp_connections(),
  public.mcp_disconnect(uuid) from public, anon;
grant execute on function public.mcp_authorize(text, text, text, text, text, text, text, text, text), public.mcp_connections(),
  public.mcp_disconnect(uuid) to authenticated;

/* ---------- the connection's: only through this app's server (MCP_SERVER_KEY) ---------- */

-- Whether the server's key matches, for the setup check in Settings.
create or replace function public.mcp_ping(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when not exists (select 1 from private.mcp_key) then 'no-key' when private.mcp_key_ok(p_key) then 'ok' else 'wrong-key' end
$$;

-- Swap a code for tokens. The server has checked the client; this checks the code is fresh and unused, was made for
-- this client and redirect, and that the PKCE verifier matches (p_verifier_s256 is base64url(sha256(verifier))).
-- A code used twice ends the connection it made.
create or replace function public.mcp_redeem(p_key text, p_code_sha256 text, p_client_id text, p_redirect_uri text,
  p_verifier_s256 text, p_access_sha256 text, p_refresh_sha256 text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c private.mcp_codes;
  g private.mcp_grants;
begin
  if not private.mcp_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if coalesce(p_access_sha256, '') !~ '^[0-9a-f]{64}$' or coalesce(p_refresh_sha256, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  select * into c from private.mcp_codes where code_sha256 = lower(coalesce(p_code_sha256, '')) for update;
  if not found then return jsonb_build_object('error', 'invalid_grant'); end if;
  if c.used_at is not null then
    update private.mcp_grants set revoked_at = now(), access_sha256 = null, refresh_sha256 = null where id = c.grant_id and revoked_at is null;
    return jsonb_build_object('error', 'invalid_grant');
  end if;
  update private.mcp_codes set used_at = now() where code_sha256 = c.code_sha256;
  if c.expires_at <= now() or c.client_id <> coalesce(p_client_id, '') or c.redirect_uri <> coalesce(p_redirect_uri, '')
     or c.challenge <> coalesce(p_verifier_s256, '') then
    return jsonb_build_object('error', 'invalid_grant');
  end if;
  -- A client holds one connection: connecting it again replaces the last.
  update private.mcp_grants set revoked_at = now(), access_sha256 = null, refresh_sha256 = null
  where user_id = c.user_id and client_id = c.client_id and revoked_at is null;
  insert into private.mcp_grants (user_id, client_id, client_name, redirect_host, resource, scope, tz,
    access_sha256, access_expires_at, refresh_sha256, refresh_expires_at, last_used_at)
  values (c.user_id, c.client_id, c.client_name, coalesce(substring(c.redirect_uri from '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)'), ''),
    c.resource, c.scope, c.tz, lower(p_access_sha256), now() + interval '1 hour', lower(p_refresh_sha256), now() + interval '30 days', now())
  returning * into g;
  update private.mcp_codes set grant_id = g.id where code_sha256 = c.code_sha256;
  delete from private.mcp_grants where coalesce(revoked_at, refresh_expires_at) < now() - interval '30 days';
  return private.mcp_tokens(g);
end;
$$;

-- Swap a refresh token for new tokens; the old one stops working. Used again after that, it ends the connection
-- (someone else has it), unless it's within 30 seconds of being replaced: two requests that crossed, not a thief.
create or replace function public.mcp_refresh(p_key text, p_refresh_sha256 text, p_client_id text, p_access_sha256 text,
  p_new_refresh_sha256 text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old text := lower(coalesce(p_refresh_sha256, ''));
  g private.mcp_grants;
begin
  if not private.mcp_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  if coalesce(p_access_sha256, '') !~ '^[0-9a-f]{64}$' or coalesce(p_new_refresh_sha256, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  select * into g from private.mcp_grants x where x.refresh_sha256 = old for update;
  if not found then
    select * into g from private.mcp_grants x where x.prev_refresh_sha256 = old and x.revoked_at is null for update;
    if found and g.rotated_at < now() - interval '30 seconds' then
      update private.mcp_grants set revoked_at = now(), access_sha256 = null, refresh_sha256 = null where id = g.id;
    end if;
    return jsonb_build_object('error', 'invalid_grant');
  end if;
  if not private.mcp_live(g) or g.client_id <> coalesce(p_client_id, '') then return jsonb_build_object('error', 'invalid_grant'); end if;
  update private.mcp_grants set access_sha256 = lower(p_access_sha256), access_expires_at = now() + interval '1 hour',
    prev_refresh_sha256 = old, refresh_sha256 = lower(p_new_refresh_sha256), refresh_expires_at = now() + interval '30 days',
    rotated_at = now(), last_used_at = now()
  where id = g.id
  returning * into g;
  return private.mcp_tokens(g);
end;
$$;

-- What an access token may do, for the server's bearer check; null for any token that isn't live.
create or replace function public.mcp_access(p_key text, p_access_sha256 text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g private.mcp_grants;
begin
  if not private.mcp_key_ok(p_key) then return null; end if;
  select * into g from private.mcp_grants x
  where x.access_sha256 = lower(coalesce(p_access_sha256, '')) and x.access_expires_at > now() and private.mcp_live(x);
  if not found then return null; end if;
  -- At most one write a minute per connection.
  if g.last_used_at is null or g.last_used_at < now() - interval '1 minute' then
    update private.mcp_grants set last_used_at = now() where id = g.id;
  end if;
  return jsonb_build_object('grant', g.id, 'clientId', g.client_id, 'scope', g.scope, 'resource', g.resource, 'tz', g.tz,
    'expiresAt', private.ms(g.access_expires_at));
end;
$$;

-- RFC 7009: revoke the connection holding this access or refresh token. Always 'ok', so it says nothing about tokens.
create or replace function public.mcp_revoke_token(p_key text, p_token_sha256 text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t text := lower(coalesce(p_token_sha256, ''));
begin
  if not private.mcp_key_ok(p_key) then return 'key'; end if;
  if t ~ '^[0-9a-f]{64}$' then
    update private.mcp_grants set revoked_at = now(), access_sha256 = null, refresh_sha256 = null
    where (access_sha256 = t or refresh_sha256 = t) and revoked_at is null;
  end if;
  return 'ok';
end;
$$;

-- The connection's tasks, as rows of public.tasks (lib/repo/supabase.ts reads them).
create or replace function public.mcp_list(p_key text, p_access_sha256 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g private.mcp_grants := private.mcp_grant(p_key, p_access_sha256);
begin
  return coalesce((select jsonb_agg(to_jsonb(t) - 'user_id' order by t.id) from public.tasks t where t.user_id = g.user_id), '[]'::jsonb);
end;
$$;

-- Add or replace up to 100 tasks, as rows. A new row can't claim to come from Google, and a row keeps its Google id.
create or replace function public.mcp_put(p_key text, p_access_sha256 text, p_rows jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g private.mcp_grants := private.mcp_grant(p_key, p_access_sha256);
  n integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then raise exception 'mcp: expected up to 100 rows' using errcode = '22023'; end if;
  insert into public.tasks as t (user_id, id, title, raw, notes, priority, minutes, start, due, status, created, sort_order, done_at,
    external_id, label, updated_at)
  select g.user_id, r.id, r.title, coalesce(r.raw, ''), coalesce(r.notes, ''), r.priority, r.minutes, r.start, r.due, r.status,
    r.created, r.sort_order, r.done_at, null, r.label, r.updated_at
  from jsonb_to_recordset(p_rows) as r(id text, title text, raw text, notes text, priority smallint, minutes integer, start bigint,
    due date, status text, created bigint, sort_order bigint, done_at bigint, label text, updated_at bigint)
  on conflict (user_id, id) do update set title = excluded.title, raw = excluded.raw, notes = excluded.notes,
    priority = excluded.priority, minutes = excluded.minutes, start = excluded.start, due = excluded.due, status = excluded.status,
    created = excluded.created, sort_order = excluded.sort_order, done_at = excluded.done_at, label = excluded.label,
    updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.mcp_remove(p_key text, p_access_sha256 text, p_ids text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g private.mcp_grants := private.mcp_grant(p_key, p_access_sha256);
  n integer;
begin
  if coalesce(cardinality(p_ids), 0) > 100 then raise exception 'mcp: expected up to 100 ids' using errcode = '22023'; end if;
  delete from public.tasks where user_id = g.user_id and id = any (coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The settings a connection reads: your labels and hours (prefs), repeats and missed slots. Nothing else.
create or replace function public.mcp_setting(p_key text, p_access_sha256 text, p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g private.mcp_grants := private.mcp_grant(p_key, p_access_sha256);
begin
  if p_name not in ('prefs', 'repeats', 'slips') then raise exception 'mcp: setting not available' using errcode = '42501'; end if;
  return (select s.value from public.settings s where s.user_id = g.user_id and s.key = p_name);
end;
$$;

-- And the ones it writes: a changed task carries its repeat along, and a missed slot it moves is noted for the review.
create or replace function public.mcp_set_setting(p_key text, p_access_sha256 text, p_name text, p_value jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g private.mcp_grants := private.mcp_grant(p_key, p_access_sha256);
begin
  if p_name not in ('repeats', 'slips') then raise exception 'mcp: setting not available' using errcode = '42501'; end if;
  if jsonb_typeof(p_value) <> 'array' or pg_column_size(p_value) > 1048576 then raise exception 'mcp: expected a list' using errcode = '22023'; end if;
  insert into public.settings (user_id, key, value, updated_at) values (g.user_id, p_name, p_value, now())
  on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
  return 'ok';
end;
$$;

revoke all on function public.mcp_ping(text), public.mcp_redeem(text, text, text, text, text, text, text),
  public.mcp_refresh(text, text, text, text, text), public.mcp_access(text, text), public.mcp_revoke_token(text, text),
  public.mcp_list(text, text), public.mcp_put(text, text, jsonb), public.mcp_remove(text, text, text[]),
  public.mcp_setting(text, text, text), public.mcp_set_setting(text, text, text, jsonb)
  from public, authenticated;
grant execute on function public.mcp_ping(text), public.mcp_redeem(text, text, text, text, text, text, text),
  public.mcp_refresh(text, text, text, text, text), public.mcp_access(text, text), public.mcp_revoke_token(text, text),
  public.mcp_list(text, text), public.mcp_put(text, text, jsonb), public.mcp_remove(text, text, text[]),
  public.mcp_setting(text, text, text), public.mcp_set_setting(text, text, text, jsonb)
  to anon;

/* ---------- the weekly check also looks at connections ---------- */

create or replace function audit.snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out jsonb;
  events jsonb := '{}'::jsonb;
  sess jsonb := '{}'::jsonb;
  passkeys jsonb := '[]'::jsonb;
begin
  -- Supabase may not write auth audit rows to the database; treat that as "no data".
  begin
    select coalesce(jsonb_object_agg(action, n), '{}'::jsonb) into events
    from (select payload ->> 'action' as action, count(*) as n
          from auth.audit_log_entries
          where created_at > now() - interval '7 days'
          group by 1) e;
  exception when others then events := jsonb_build_object('unavailable', true);
  end;

  -- A passkey sign-in is aal1 (0007's, and Face ID's on the side), but it isn't a password that skipped 2FA.
  begin
    select jsonb_build_object(
      'count', count(*),
      'still_aal1', count(*) filter (where s.aal::text = 'aal1' and not exists (
          select 1 from auth.mfa_amr_claims c where c.session_id = s.id and c.authentication_method = 'passkey')),
      'distinct_ips', count(distinct s.ip),
      'distinct_agents', count(distinct s.user_agent)
    ) into sess
    from auth.sessions s where s.created_at > now() - interval '7 days';
  exception when others then sess := jsonb_build_object('unavailable', true);
  end;

  -- Supabase Auth's own table; a project from before passkeys doesn't have it.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', w.user_id, 'created_at', w.created_at, 'last_used_at', w.last_used_at
      ) order by w.created_at), '[]'::jsonb) into passkeys
    from auth.webauthn_credentials w;
  exception when others then passkeys := jsonb_build_object('unavailable', true);
  end;

  select jsonb_build_object(
    'at', now(),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'email_sha256', encode(sha256(convert_to(lower(coalesce(u.email, '')), 'UTF8')), 'hex'),
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at
      ) order by u.created_at) from auth.users u), '[]'::jsonb),
    'factors', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', f.user_id, 'type', f.factor_type::text, 'status', f.status::text,
        'created_at', f.created_at, 'updated_at', f.updated_at
      ) order by f.created_at) from auth.mfa_factors f), '[]'::jsonb),
    'passkeys', passkeys,
    'sessions_7d', sess,
    'auth_events_7d', events,
    'tables', coalesce((select jsonb_agg(jsonb_build_object('name', c.relname, 'rls', c.relrowsecurity) order by c.relname)
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')), '[]'::jsonb),
    'policies', coalesce((select jsonb_agg(jsonb_build_object(
        'table', p.tablename, 'name', p.policyname, 'permissive', p.permissive,
        'roles', to_jsonb(p.roles), 'cmd', p.cmd, 'qual', p.qual, 'with_check', p.with_check
      ) order by p.tablename, p.policyname) from pg_catalog.pg_policies p where p.schemaname = 'public'), '[]'::jsonb),
    'public_grants', coalesce((select jsonb_agg(distinct g.grantee || ':' || g.table_name || ':' || g.privilege_type)
        from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.grantee in ('anon', 'PUBLIC')), '[]'::jsonb),
    'public_functions', coalesce((select jsonb_agg(p.proname order by p.proname)
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'), '[]'::jsonb),
    'mfa_check_sha256', (select encode(sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid), 'UTF8')), 'hex')
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'mfa_fresh'),
    'mfa_check_src', (select p.prosrc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'mfa_fresh'),
    'login_roles', coalesce((select jsonb_agg(r.rolname order by r.rolname) from pg_catalog.pg_roles r where r.rolcanlogin), '[]'::jsonb),
    'realtime_tables', coalesce((select jsonb_agg(t.schemaname || '.' || t.tablename order by t.tablename)
        from pg_catalog.pg_publication_tables t where t.pubname = 'supabase_realtime'), '[]'::jsonb),
    'tasks', (select jsonb_build_object(
        'count', count(*),
        'open', count(*) filter (where status = 'open'),
        'updated_24h', count(*) filter (where updated_at > (extract(epoch from now()) * 1000)::bigint - 86400000),
        'max_updated_at', max(updated_at),
        'sha256', encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(
            id, title, raw, notes, priority, minutes, start, due, status, created, sort_order, done_at, external_id, updated_at, label
          )::text, E'\n' order by id), ''), 'UTF8')), 'hex')
      ) from public.tasks),
    'settings', (select jsonb_build_object(
        'count', count(*),
        'sha256', encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(key, value)::text, E'\n' order by key), ''), 'UTF8')), 'hex')
      ) from public.settings),
    'access_rule_src', (select p.prosrc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'access_ok'),
    'access_rule_sha256', (select encode(sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid), 'UTF8')), 'hex')
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'access_ok'),
    'pins', (select jsonb_build_object('count', count(*), 'failed', coalesce(sum(failed), 0), 'updated_at', max(updated_at)) from private.pins),
    'unlocks_7d', (select count(*) from private.unlocks where unlocked_at > now() - interval '7 days'),
    'face_id_7d', (select count(*) from private.face_ids where verified_at > now() - interval '7 days'),
    'sharing', jsonb_build_object(
      'key_set', exists (select 1 from private.share_key),
      'shares', (select count(*) from private.shares),
      'active', (select count(*) from private.shares x where private.share_live(x)),
      'sessions_live', (select count(*) from private.share_sessions x join private.shares s on s.id = x.share_id
                        where x.ended_at is null and x.expires_at > now() and private.share_live(s)),
      'sign_ins_7d', (select count(*) from private.share_events where kind = 'signed-in' and at > now() - interval '7 days'),
      'wrong_codes_7d', (select count(*) from private.share_events where kind = 'wrong-code' and at > now() - interval '7 days'),
      'pending', (select count(*) from private.share_requests where status = 'pending'),
      'key_updated_at', (select k.updated_at from private.share_key k),
      -- Compared between primary and backup, like the sign-in rules above.
      'functions_sha256', (select encode(sha256(convert_to(coalesce(string_agg(pg_catalog.pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname), ''), 'UTF8')), 'hex')
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and (p.proname like 'share\_%' or p.proname in ('ms', 'set_share_key_hash')))),
    -- A connection reads and changes your tasks without signing in each day, so each one is listed: when it was made
    -- and last used, never what it's called.
    'connectors', jsonb_build_object(
      'key_set', exists (select 1 from private.mcp_key),
      'key_updated_at', (select k.updated_at from private.mcp_key k),
      'connections', coalesce((select jsonb_agg(jsonb_build_object('created_at', x.created_at, 'last_used_at', x.last_used_at,
          'live', private.mcp_live(x)) order by x.created_at)
        from private.mcp_grants x where private.mcp_live(x) or x.created_at > now() - interval '8 days'), '[]'::jsonb),
      'functions_sha256', (select encode(sha256(convert_to(coalesce(string_agg(pg_catalog.pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname), ''), 'UTF8')), 'hex')
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and (p.proname like 'mcp\_%' or p.proname = 'set_mcp_key_hash'))),
    -- Only the viewer's six sharing functions and the connection's, which all want a server key, may be callable without signing in.
    'anon_functions', case when exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then coalesce((
        select jsonb_agg(p.proname order by p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and pg_catalog.has_function_privilege('anon', p.oid, 'execute')), '[]'::jsonb) end,
    'last_sync', (select to_jsonb(s) from audit.sync_log s order by s.synced_at desc limit 1)
  ) into out;
  return out;
end;
$$;

revoke all on function audit.snapshot() from public;
