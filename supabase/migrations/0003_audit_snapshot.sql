-- audit.snapshot(): one JSON summary of everything the weekly breach check looks at.
-- Runs as its owner (security definer) so the backup job's limited login can call it
-- without being able to read auth tables directly. It returns no secrets: emails are
-- hashed, IPs are only counted, and task content is only hashed.

create schema if not exists audit;
revoke all on schema audit from public;

create table if not exists audit.sync_log (
  synced_at   timestamptz not null default now(),
  source      text not null,          -- 'primary'
  tasks       integer not null,
  tasks_hash  text not null,
  settings    integer not null
);
revoke all on audit.sync_log from public;

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

  begin
    select jsonb_build_object(
      'count', count(*),
      'still_aal1', count(*) filter (where aal::text = 'aal1'),
      'distinct_ips', count(distinct ip),
      'distinct_agents', count(distinct user_agent)
    ) into sess
    from auth.sessions where created_at > now() - interval '7 days';
  exception when others then sess := jsonb_build_object('unavailable', true);
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
            id, title, raw, notes, priority, minutes, start, due, status, created, sort_order, done_at, external_id, updated_at
          )::text, E'\n' order by id), ''), 'UTF8')), 'hex')
      ) from public.tasks),
    'settings', (select jsonb_build_object(
        'count', count(*),
        'sha256', encode(sha256(convert_to(coalesce(string_agg(jsonb_build_array(key, value)::text, E'\n' order by key), ''), 'UTF8')), 'hex')
      ) from public.settings),
    'last_sync', (select to_jsonb(s) from audit.sync_log s order by s.synced_at desc limit 1)
  ) into out;
  return out;
end;
$$;

revoke all on function audit.snapshot() from public;
