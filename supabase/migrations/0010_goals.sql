-- Goals: the few specific outcomes you're working towards, and the tasks that move each one.
--
-- The goals themselves (title, section, key results, target date, order) live in your synced settings under 'goals';
-- a task keeps the id of the goal it moves, or null for off-goal work. Run this after 0009, on the primary and on the
-- backup, before deploying the app that writes goals: the backup job copies the new column, and the weekly check
-- compares it.

-- The connector functions below come from 0009; without it, stop here and say so.
do $$ begin
  if to_regclass('private.mcp_grants') is null then
    raise exception 'Run supabase/migrations/0009_connectors.sql first: 0010 builds on it.';
  end if;
end $$;

alter table public.tasks add column if not exists goal text check (goal is null or char_length(goal) between 1 and 40);

/* ---------- Claude (0009) keeps a task's goal, and can read your goals ---------- */

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
    external_id, label, goal, updated_at)
  select g.user_id, r.id, r.title, coalesce(r.raw, ''), coalesce(r.notes, ''), r.priority, r.minutes, r.start, r.due, r.status,
    r.created, r.sort_order, r.done_at, null, r.label, r.goal, r.updated_at
  from jsonb_to_recordset(p_rows) as r(id text, title text, raw text, notes text, priority smallint, minutes integer, start bigint,
    due date, status text, created bigint, sort_order bigint, done_at bigint, label text, goal text, updated_at bigint)
  on conflict (user_id, id) do update set title = excluded.title, raw = excluded.raw, notes = excluded.notes,
    priority = excluded.priority, minutes = excluded.minutes, start = excluded.start, due = excluded.due, status = excluded.status,
    created = excluded.created, sort_order = excluded.sort_order, done_at = excluded.done_at, label = excluded.label, goal = excluded.goal,
    updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The settings a connection reads: your labels and hours (prefs), goals, repeats and missed slots. Nothing else.
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
  if p_name not in ('prefs', 'goals', 'repeats', 'slips') then raise exception 'mcp: setting not available' using errcode = '42501'; end if;
  return (select s.value from public.settings s where s.user_id = g.user_id and s.key = p_name);
end;
$$;

/* ---------- the weekly check compares goals too ---------- */

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
            id, title, raw, notes, priority, minutes, start, due, status, created, sort_order, done_at, external_id, updated_at, label, goal
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
