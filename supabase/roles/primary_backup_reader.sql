-- PRIMARY project only. A read-only login for the backup job (GitHub Actions).
-- It can read tasks and settings and call audit.snapshot(); it can't write anything.
-- Set its password separately (never in git):
--   alter role backup_reader with password '<long random password>';

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'backup_reader') then
    create role backup_reader login noinherit;
  end if;
end $$;

alter role backup_reader set default_transaction_read_only = on;
alter role backup_reader set statement_timeout = '60s';

grant usage on schema public, audit to backup_reader;
grant select on public.tasks, public.settings to backup_reader;
grant execute on function audit.snapshot() to backup_reader;

drop policy if exists "backup job reads" on public.tasks;
create policy "backup job reads" on public.tasks for select to backup_reader using (true);
drop policy if exists "backup job reads" on public.settings;
create policy "backup job reads" on public.settings for select to backup_reader using (true);
