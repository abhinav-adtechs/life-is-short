-- Data is only readable or writable by a session that passed 2FA (aal2) with an
-- authenticator code in the last 24 hours. A stolen password alone gets nothing.
-- Mirrors lib/mfa.ts.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.mfa_fresh()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1
       from jsonb_array_elements(
              case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
            ) as a
       where jsonb_typeof(a) = 'object'
         and a ->> 'method' = 'totp'
         and jsonb_typeof(a -> 'timestamp') = 'number'
         and (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 86400
     );
$$;

revoke all on function private.mfa_fresh() from public;
grant execute on function private.mfa_fresh() to authenticated;

-- Restrictive policies are ANDed with the owner policies from 0001.
drop policy if exists "fresh 2fa" on public.tasks;
create policy "fresh 2fa" on public.tasks as restrictive for all to authenticated
  using ((select private.mfa_fresh())) with check ((select private.mfa_fresh()));

drop policy if exists "fresh 2fa" on public.settings;
create policy "fresh 2fa" on public.settings as restrictive for all to authenticated
  using ((select private.mfa_fresh())) with check ((select private.mfa_fresh()));

-- Signed-out visitors get no table privileges at all (RLS would already deny them).
revoke all on public.tasks, public.settings from anon;
