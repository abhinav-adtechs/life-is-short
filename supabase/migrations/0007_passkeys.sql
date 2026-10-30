-- Passkeys: Face ID, Touch ID, Windows Hello, a phone or a security key, instead of the PIN and the authenticator code.
--
-- Supabase Auth keeps the passkeys (auth.webauthn_credentials) and checks them; signing in with one gives a session
-- whose amr says 'passkey'. A passkey proves two things at once, the device you hold and that it's you (the face,
-- finger or device PIN that unlocks it), and it only answers this site, so it can't be phished. So it stands in for
-- the PIN and the authenticator code: a session that signed in with a passkey in the last 24 hours sees your data,
-- like one that passed both. After 24 hours it locks like any other.
--
-- Adding or removing a passkey needs a session that passed the authenticator code: Supabase asks for aal2 to manage
-- passkeys while 2FA is on. The weekly check lists them.
--
-- Run this on the primary and on the backup (the backup job compares the sign-in rule between them), then turn
-- passkeys on in the Supabase dashboard (docs/setup.md).

-- The rule every row is checked against.
create or replace function private.access_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
       private.mfa_fresh()
       and (
         coalesce(private.amr_age('password') < 86400, false)
         or exists (
           select 1 from private.unlocks u
           where u.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
             and u.user_id = auth.uid()
             and u.unlocked_at > now() - interval '24 hours'
         )
       )
     )
     or coalesce(private.amr_age('passkey') < 86400, false);
$$;

revoke all on function private.access_ok() from public;
grant execute on function private.access_ok() to authenticated;

-- Where this session stands, for the sign-in screens. Reveals nothing about the PIN itself.
create or replace function public.pin_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  pw bigint := private.amr_age('password');
  code bigint := private.amr_age('totp');
  pk bigint := private.amr_age('passkey');
  unlocked bigint;
  passkeys bigint;
begin
  if uid is null then
    return jsonb_build_object('signed_in', false);
  end if;
  select extract(epoch from now() - u.unlocked_at)::bigint into unlocked
  from private.unlocks u where u.session_id = sid and u.user_id = uid;
  -- How many passkeys you have, so the lock screen can offer one. Null when Supabase can't say.
  begin
    select count(*) into passkeys from auth.webauthn_credentials w where w.user_id = uid;
  exception when others then passkeys := null;
  end;
  return jsonb_build_object(
    'signed_in', true,
    'has_pin', exists (select 1 from private.pins where user_id = uid),
    'unlocked', private.access_ok(),
    'password_age', pw,
    'code_age', code,
    'passkey_age', pk,
    'passkeys', passkeys,
    -- Seconds until this session locks again: whichever way in lasts longer.
    'seconds_left', greatest(0,
      least(86400 - coalesce(code, 86400), 86400 - least(coalesce(pw, 86400), coalesce(unlocked, 86400))),
      86400 - coalesce(pk, 86400))
  );
end;
$$;

revoke all on function public.pin_status() from public, anon;
grant execute on function public.pin_status() to authenticated;

/* ---------- the weekly check lists passkeys ---------- */

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
    -- Only the viewer's six functions may be callable without signing in.
    'anon_functions', case when exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then coalesce((
        select jsonb_agg(p.proname order by p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and pg_catalog.has_function_privilege('anon', p.oid, 'execute')), '[]'::jsonb) end,
    'last_sync', (select to_jsonb(s) from audit.sync_log s order by s.synced_at desc limit 1)
  ) into out;
  return out;
end;
$$;

revoke all on function audit.snapshot() from public;
