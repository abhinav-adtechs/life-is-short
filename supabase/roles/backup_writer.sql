-- BACKUP project only. The login the backup job uses to overwrite this copy.
-- It can replace rows in tasks and settings, log syncs, and call audit.snapshot();
-- it can't touch auth, schema or policies. The backup project holds no credentials
-- for the primary.
-- Set its password separately (never in git):
--   alter role backup_writer with password '<long random password>';

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'backup_writer') then
    create role backup_writer login noinherit;
  end if;
end $$;

alter role backup_writer set statement_timeout = '60s';

grant usage on schema public, audit to backup_writer;
grant select, insert, update, delete on public.tasks, public.settings to backup_writer;
grant select, insert on audit.sync_log to backup_writer;
grant execute on function audit.snapshot() to backup_writer;

-- Only to look up the owner's id by email when copying rows across.
create or replace function audit.owner_id(email_sha256 text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where encode(sha256(convert_to(lower(coalesce(email, '')), 'UTF8')), 'hex') = email_sha256 limit 1;
$$;
revoke all on function audit.owner_id(text) from public;
grant execute on function audit.owner_id(text) to backup_writer;

drop policy if exists "backup job writes" on public.tasks;
create policy "backup job writes" on public.tasks for all to backup_writer using (true) with check (true);
drop policy if exists "backup job writes" on public.settings;
create policy "backup job writes" on public.settings for all to backup_writer using (true) with check (true);
