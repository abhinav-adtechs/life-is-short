-- PIN + authenticator code for every sign-in after the first.
--
-- First sign-in on a device: email + password, then an authenticator code, then (once) choose a PIN.
-- After that, every 24 hours: the PIN and an authenticator code. Never the password again,
-- unless the PIN is wrong 5 times in a row, which erases it.
--
-- The database enforces it: rows are only visible to a session that passed an authenticator code
-- in the last 24 hours AND either signed in with the password or unlocked with the PIN in the
-- last 24 hours. The PIN is stored as a bcrypt hash and checked here, never in the browser.

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.pins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  pin_hash   text not null,
  failed     integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists private.unlocks (
  session_id  uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  unlocked_at timestamptz not null default now()
);

revoke all on private.pins, private.unlocks from public;

-- Seconds since this session last used a sign-in method ('password', 'totp'), or null.
create or replace function private.amr_age(method text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select extract(epoch from now())::bigint - max((a ->> 'timestamp')::bigint)
  from jsonb_array_elements(
         case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
       ) as a
  where jsonb_typeof(a) = 'object' and a ->> 'method' = method and jsonb_typeof(a -> 'timestamp') = 'number';
$$;

-- The rule every row is checked against.
create or replace function private.access_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.mfa_fresh()
     and (
       coalesce(private.amr_age('password') < 86400, false)
       or exists (
         select 1 from private.unlocks u
         where u.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
           and u.user_id = auth.uid()
           and u.unlocked_at > now() - interval '24 hours'
       )
     );
$$;

revoke all on function private.amr_age(text), private.access_ok() from public;
grant execute on function private.amr_age(text), private.access_ok() to authenticated;

drop policy if exists "fresh 2fa" on public.tasks;
drop policy if exists "unlocked" on public.tasks;
create policy "unlocked" on public.tasks as restrictive for all to authenticated
  using ((select private.access_ok())) with check ((select private.access_ok()));

drop policy if exists "fresh 2fa" on public.settings;
drop policy if exists "unlocked" on public.settings;
create policy "unlocked" on public.settings as restrictive for all to authenticated
  using ((select private.access_ok())) with check ((select private.access_ok()));

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
  unlocked bigint;
begin
  if uid is null then
    return jsonb_build_object('signed_in', false);
  end if;
  select extract(epoch from now() - u.unlocked_at)::bigint into unlocked
  from private.unlocks u where u.session_id = sid and u.user_id = uid;
  return jsonb_build_object(
    'signed_in', true,
    'has_pin', exists (select 1 from private.pins where user_id = uid),
    'unlocked', private.access_ok(),
    'password_age', pw,
    'code_age', code,
    -- Seconds until this session locks again.
    'seconds_left', greatest(0, least(86400 - coalesce(code, 86400), 86400 - least(coalesce(pw, 86400), coalesce(unlocked, 86400))))
  );
end;
$$;

-- Choose or change the PIN: only right after a password sign-in (10 minutes) and an authenticator code.
create or replace function public.set_pin(new_pin text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if uid is null then return 'signed-out'; end if;
  if not private.mfa_fresh() then return 'code-required'; end if;
  if coalesce(private.amr_age('password'), 999999) > 600 then return 'password-required'; end if;
  if new_pin is null or new_pin !~ '^[0-9]{6,12}$' then return 'invalid'; end if;
  insert into private.pins (user_id, pin_hash, failed, updated_at)
  values (uid, extensions.crypt(new_pin, extensions.gen_salt('bf', 10)), 0, now())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, failed = 0, updated_at = now();
  if sid is not null then
    insert into private.unlocks (session_id, user_id) values (sid, uid)
    on conflict (session_id) do update set user_id = excluded.user_id, unlocked_at = now();
  end if;
  return 'ok';
end;
$$;

-- Unlock this session with the PIN, after an authenticator code. Five wrong PINs erase it.
-- Returns a status instead of raising, so the failed-attempt count is never rolled back.
create or replace function public.unlock_with_pin(pin text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  p private.pins;
begin
  if uid is null or sid is null then return 'signed-out'; end if;
  if not private.mfa_fresh() then return 'code-required'; end if;
  select * into p from private.pins where user_id = uid for update;
  if not found then return 'no-pin'; end if;
  if p.pin_hash = extensions.crypt(coalesce(pin, ''), p.pin_hash) then
    update private.pins set failed = 0 where user_id = uid;
    insert into private.unlocks (session_id, user_id) values (sid, uid)
    on conflict (session_id) do update set user_id = excluded.user_id, unlocked_at = now();
    delete from private.unlocks where unlocked_at < now() - interval '2 days';
    return 'ok';
  end if;
  if p.failed + 1 >= 5 then
    delete from private.pins where user_id = uid;
    delete from private.unlocks where user_id = uid;
    return 'locked';
  end if;
  update private.pins set failed = p.failed + 1 where user_id = uid;
  return 'wrong';
end;
$$;

revoke all on function public.pin_status(), public.set_pin(text), public.unlock_with_pin(text) from public, anon;
grant execute on function public.pin_status(), public.set_pin(text), public.unlock_with_pin(text) to authenticated;

-- The weekly check also looks at the access rule and PIN activity.
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
    'access_rule_src', (select p.prosrc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'access_ok'),
    'access_rule_sha256', (select encode(sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid), 'UTF8')), 'hex')
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'access_ok'),
    'pins', (select jsonb_build_object('count', count(*), 'failed', coalesce(sum(failed), 0), 'updated_at', max(updated_at)) from private.pins),
    'unlocks_7d', (select count(*) from private.unlocks where unlocked_at > now() - interval '7 days'),
    'last_sync', (select to_jsonb(s) from audit.sync_log s order by s.synced_at desc limit 1)
  ) into out;
  return out;
end;
$$;

revoke all on function audit.snapshot() from public;
