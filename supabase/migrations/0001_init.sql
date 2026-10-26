-- Dump & Slot schema. Run once in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.tasks (
  user_id     uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id          text   not null,
  title       text   not null check (char_length(title) between 1 and 160),
  raw         text   not null default '',
  notes       text   not null default '',
  priority    smallint not null check (priority in (1, 2, 3)),
  minutes     integer  not null check (minutes between 10 and 480),
  start       bigint,                -- epoch ms; null = in the backlog
  due         date,                  -- deadline, separate from when it's scheduled
  status      text   not null default 'open' check (status in ('open', 'done')),
  created     bigint not null,
  sort_order  bigint not null,       -- "order" in the app; breaks ties in the backlog
  done_at     bigint,
  external_id text,                  -- e.g. gcal:<calendar>:<event>, gtask:<id>
  updated_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (user_id, id)
);

create index if not exists tasks_external on public.tasks (user_id, external_id) where external_id is not null;

alter table public.tasks enable row level security;
drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.settings (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        text not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.settings enable row level security;
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Realtime: lets the phone and laptop see each other's changes within seconds.
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;
