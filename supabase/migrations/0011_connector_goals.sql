-- Claude builds your goals and their flow charts: a connection (0009) may now write your goals and add to their charts'
-- history, as well as read them (0010). Nothing else changes: it still never reaches your Google tokens, chat history,
-- voice profile, shares, sign-in or your other settings, and it still can't write prefs (labels, hours, look).
--
-- Run it after 0010, on the primary and on the backup: the weekly check compares the connector functions between the
-- two and blocks a sync when they differ.

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'goal') then
    raise exception 'Run supabase/migrations/0010_goals.sql first: 0011 builds on it.';
  end if;
end $$;

-- The settings a connection reads: your labels and hours (prefs), goals, their charts' history, repeats and missed slots.
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
  if p_name not in ('prefs', 'goals', 'goal-log', 'repeats', 'slips') then raise exception 'mcp: setting not available' using errcode = '42501'; end if;
  return (select s.value from public.settings s where s.user_id = g.user_id and s.key = p_name);
end;
$$;

-- And the ones it writes: goals and their charts, the charts' history, repeats (a changed task carries its repeat
-- along) and missed slots (moved off a slot, for the review). Each is a list, as the app keeps it.
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
  if p_name not in ('goals', 'goal-log', 'repeats', 'slips') then raise exception 'mcp: setting not available' using errcode = '42501'; end if;
  if jsonb_typeof(p_value) <> 'array' or pg_column_size(p_value) > 1048576 then raise exception 'mcp: expected a list' using errcode = '22023'; end if;
  insert into public.settings (user_id, key, value, updated_at) values (g.user_id, p_name, p_value, now())
  on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
  return 'ok';
end;
$$;

-- create or replace keeps each function's grants: the server's (anon) only, as 0009 set them.
