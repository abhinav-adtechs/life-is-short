-- Sharing: a view-only window into your planner for people you choose.
--
-- You add someone's email, pick what they can see and for how long, and get a link. They open it,
-- type that email and get a 6-digit code by email; the code starts a view-only session for 7 days.
-- They can also suggest a backlog task or a time on your calendar, which waits for you to approve.
--
-- Viewers never get a database account: auth.users still holds only you. Everything here lives in
-- the private schema, out of reach of the API, behind two sets of functions:
--   * yours (share_list, share_create, ...), only for a session the sign-in rule (private.access_ok) lets in;
--   * the viewer's (share_code, share_sign_in, share_view, ...), which only answer this app's server.
--     It proves itself with SHARE_SERVER_KEY; the database keeps a sha256 of that key, never the key.
-- A viewer only ever gets what the share allows: titles, times, lengths, priorities and due dates.
-- Never notes or the words of your dumps, and never events from Google calendars you switched off.

create table if not exists private.share_key (
  id         boolean primary key default true check (id),
  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

create table if not exists private.shares (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text not null check (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name       text not null default '' check (char_length(name) <= 60),  -- what you call them; never shown to them
  link       text not null unique check (char_length(link) >= 32),       -- the secret in the link
  scope      jsonb not null,
  tz         text not null,                                              -- your time zone, for "today"
  created_at timestamptz not null default now(),
  expires_at timestamptz,                                                -- null: no end
  revoked_at timestamptz
);
create index if not exists shares_user on private.shares (user_id);

-- At most one live code per share.
create table if not exists private.share_codes (
  share_id   uuid primary key references private.shares (id) on delete cascade,
  code_hash  text not null,
  sent_at    timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts   integer not null default 0
);

create table if not exists private.share_sessions (
  id           uuid primary key default gen_random_uuid(),
  share_id     uuid not null references private.shares (id) on delete cascade,
  token_sha256 text not null unique,
  device       text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  ended_at     timestamptz
);
create index if not exists share_sessions_share on private.share_sessions (share_id);

create table if not exists private.share_events (
  id         bigint generated always as identity primary key,
  share_id   uuid not null references private.shares (id) on delete cascade,
  session_id uuid references private.share_sessions (id) on delete set null,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('created', 'changed', 'revoked', 'code-sent', 'wrong-code', 'signed-in', 'viewed', 'suggested', 'signed-out')),
  device     text not null default ''
);
create index if not exists share_events_share on private.share_events (share_id, at desc);

create table if not exists private.share_requests (
  id         uuid primary key default gen_random_uuid(),
  share_id   uuid not null references private.shares (id) on delete cascade,
  kind       text not null check (kind in ('backlog', 'calendar')),
  title      text not null check (char_length(title) between 1 and 160),
  note       text not null default '' check (char_length(note) <= 500),
  start      bigint,                  -- epoch ms, calendar suggestions only
  minutes    integer check (minutes between 15 and 480),
  due        date,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (kind <> 'calendar' or (start is not null and minutes is not null))
);
create index if not exists share_requests_share on private.share_requests (share_id, created_at desc);

revoke all on private.share_key, private.shares, private.share_codes, private.share_sessions, private.share_events, private.share_requests
  from public, anon, authenticated;

/* ---------- helpers ---------- */

create or replace function private.ms(t timestamptz)
returns bigint
language sql
stable
set search_path = ''
as $$ select (extract(epoch from t) * 1000)::bigint $$;

create or replace function private.share_live(s private.shares)
returns boolean
language sql
stable
set search_path = ''
as $$ select s.revoked_at is null and (s.expires_at is null or s.expires_at > now()) $$;

-- What a share lets them see, with anything unknown switched off. Mirrors normalizeScope in lib/share.ts.
create or replace function private.share_scope(raw jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'backlog', coalesce(raw -> 'backlog' = 'true'::jsonb, false),
    'calendar', case when raw ->> 'calendar' in ('today', 'upcoming', 'all') then raw ->> 'calendar' else 'none' end,
    'google', coalesce(raw -> 'google' = 'true'::jsonb, false),
    'details', case when raw ->> 'details' = 'busy' then 'busy' else 'titles' end,
    'suggest', coalesce(raw -> 'suggest' = 'true'::jsonb, false)
  )
$$;

-- The caller is this app's server: it knows SHARE_SERVER_KEY.
create or replace function private.share_key_ok(p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(char_length(p_key) >= 32, false)
     and exists (select 1 from private.share_key k where k.key_sha256 = encode(sha256(convert_to(p_key, 'UTF8')), 'hex'))
$$;

create or replace function private.share_token()
returns text
language sql
volatile
set search_path = ''
as $$ select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_') $$;

-- 8 digits. With at most 10 wrong tries a day per share (share_locked), a guesser has about a 1 in 27,000 chance a year.
create or replace function private.share_new_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select lpad(((get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3)) % 100000000)::text, 8, '0')
  from (select extensions.gen_random_bytes(4) as b) r
$$;

-- Ten wrong codes in a day pause signing in to a share for the rest of that day.
create or replace function private.share_locked(p_share uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select count(*) from private.share_events e
          where e.share_id = p_share and e.kind = 'wrong-code' and e.at > now() - interval '24 hours') >= 10
$$;

create or replace function private.share_hash(salt text, secret text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(salt || ':' || coalesce(secret, ''), 'UTF8')), 'hex') $$;

-- "Safari on iPhone": a short label from the server, kept to plain characters.
create or replace function private.share_device(d text)
returns text
language sql
immutable
set search_path = ''
as $$ select left(regexp_replace(coalesce(d, ''), '[^A-Za-z0-9 .()/,-]', '', 'g'), 60) $$;

-- The live session behind a viewer's cookie, on the share behind their link.
create or replace function private.share_session(p_link text, p_token text)
returns private.share_sessions
language sql
stable
set search_path = ''
as $$
  select x.* from private.share_sessions x join private.shares s on s.id = x.share_id
  where x.token_sha256 = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and s.link = p_link and x.ended_at is null and x.expires_at > now() and private.share_live(s)
$$;

/**
 * Everything one share shows, as of now. Calendar items only carry a title when the share shows titles.
 * Google items only come when the share includes them, and never from a calendar you switched off or an
 * account you hid from your calendar (the planner's isOff and onCalendar).
 */
create or replace function private.share_payload(p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  s private.shares;
  sc jsonb;
  prefs jsonb;
  google jsonb;
  shown_cals text[];
  hidden_cals text[];
  day0 timestamp;
  now_ms bigint := private.ms(now());
  from_ms bigint;
  to_ms bigint;
  lo bigint;
  hi bigint;
  busy boolean;
  show_done boolean;
  backlog_json jsonb;
  cal_json jsonb;
begin
  select * into s from private.shares where id = p_id;
  if not found then return null; end if;
  sc := private.share_scope(s.scope);
  select value into prefs from public.settings where user_id = s.user_id and key = 'prefs';
  select value into google from public.settings where user_id = s.user_id and key = 'google';

  -- Each Google calendar has one source, as the planner sees it (sourceIndex in lib/google-client.ts): the account
  -- pulling it wins, then the one it's the main calendar of, then the first. Its events show when that source
  -- pulls it and its account is shown on the calendar. An account that hasn't pulled yet lists no calendars;
  -- its main calendar's id is its email.
  with acc as (
    select a, ai from jsonb_array_elements(case
      when jsonb_typeof(google -> 'accounts') = 'array' then google -> 'accounts'
      when jsonb_typeof(google) = 'object' and google ? 'blob' then jsonb_build_array(google)
      else '[]'::jsonb end) with ordinality as t(a, ai)
    where jsonb_typeof(a -> 'blob') = 'string'
  ), listed as (
    select c ->> 'id' as cal, ai, ci,
      (case when coalesce(c ->> 'pull', 'true') <> 'false' then 2 else 0 end)
        + (case when c -> 'primary' = 'true'::jsonb or c ->> 'id' = a ->> 'email' then 1 else 0 end) as rank,
      coalesce(c ->> 'pull', 'true') <> 'false' and coalesce(a ->> 'show', 'true') <> 'false' as shown
    from acc, jsonb_array_elements(case when jsonb_typeof(a -> 'calendars') = 'array' then a -> 'calendars' else '[]'::jsonb end)
      with ordinality as u(c, ci)
    where jsonb_typeof(c -> 'id') = 'string'
  ), source as (
    select distinct on (cal) cal, shown from listed order by cal, rank desc, ai, ci
  ), unlisted as (
    select distinct on (a ->> 'email') a ->> 'email' as cal, coalesce(a ->> 'show', 'true') <> 'false' as shown
    from acc where a ->> 'email' is not null and a ->> 'email' not in (select cal from listed)
    order by a ->> 'email', ai
  ), visible as (
    select * from source union all select * from unlisted
  )
  select coalesce(array_agg(cal) filter (where shown), '{}'), coalesce(array_agg(cal) filter (where not shown), '{}')
  into shown_cals, hidden_cals from visible;

  if sc -> 'backlog' = 'true'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object('title', b.title, 'priority', b.priority, 'minutes', b.minutes, 'due', b.due)
      order by b.priority, b.due, b.sort_order), '[]'::jsonb)
    into backlog_json
    from (
      select t.* from public.tasks t
      cross join lateral (select case when t.external_id like 'gcal:%'
        then nullif(regexp_replace(substr(t.external_id, 6), ':[^:]*$', ''), substr(t.external_id, 6)) end as cal) x
      where t.user_id = s.user_id and t.status = 'open' and t.start is null
        and (t.external_id is null or (sc -> 'google' = 'true'::jsonb and (x.cal is null or x.cal = any(shown_cals) or not x.cal = any(hidden_cals))))
      order by t.priority, t.due, t.sort_order
      limit 500
    ) b;
  end if;

  if sc ->> 'calendar' <> 'none' then
    -- Today, on your clock.
    day0 := date_trunc('day', now() at time zone s.tz);
    from_ms := case when sc ->> 'calendar' in ('today', 'upcoming') then private.ms(day0 at time zone s.tz) end;
    to_ms := case when sc ->> 'calendar' = 'today' then private.ms((day0 + interval '1 day') at time zone s.tz) end;
    lo := coalesce(from_ms, now_ms - 366 * 86400000::bigint);
    hi := coalesce(to_ms, now_ms + 366 * 86400000::bigint);
    busy := sc ->> 'details' = 'busy';
    show_done := coalesce(prefs ->> 'showDone', 'true') <> 'false';
    select jsonb_build_object('from', from_ms, 'to', to_ms, 'items', coalesce(jsonb_agg(jsonb_build_object(
        'start', c.start, 'minutes', c.minutes,
        'title', case when busy then null else c.title end,
        'done', not busy and c.status = 'done',
        'google', not busy and c.external_id is not null
      ) order by c.start), '[]'::jsonb))
    into cal_json
    from (
      select t.* from public.tasks t
      cross join lateral (select case when t.external_id like 'gcal:%'
        then nullif(regexp_replace(substr(t.external_id, 6), ':[^:]*$', ''), substr(t.external_id, 6)) end as cal) x
      where t.user_id = s.user_id and t.start is not null and t.start < hi and t.start + t.minutes * 60000 > lo
        and (show_done or t.status = 'open')
        and (t.external_id is null or (sc -> 'google' = 'true'::jsonb and (x.cal is null or x.cal = any(shown_cals) or not x.cal = any(hidden_cals))))
      order by abs(t.start - now_ms)
      limit 2000
    ) c;
  end if;

  return jsonb_build_object(
    'scope', sc,
    'tz', s.tz,
    'email', s.email,
    'expiresAt', private.ms(s.expires_at),
    'now', now_ms,
    'hours', jsonb_build_object(
      'start', case when jsonb_typeof(prefs -> 'dayStart') = 'number' then least(22, greatest(0, (prefs ->> 'dayStart')::numeric::int)) else 9 end,
      'end', case when jsonb_typeof(prefs -> 'dayEnd') = 'number' then least(24, greatest(2, (prefs ->> 'dayEnd')::numeric::int)) else 21 end),
    'weekStart', case when prefs ->> 'weekStart' in ('0', '1', '6') then (prefs ->> 'weekStart')::int else 1 end,
    'clock', case when prefs ->> 'clock' = '24' then '24' else '12' end,
    'backlog', backlog_json,
    'calendar', cal_json
  );
end;
$$;

create or replace function private.share_json(s private.shares)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'email', s.email, 'link', s.link, 'scope', private.share_scope(s.scope), 'tz', s.tz,
    'createdAt', private.ms(s.created_at), 'expiresAt', private.ms(s.expires_at), 'revokedAt', private.ms(s.revoked_at),
    'live', private.share_live(s),
    'lastSeenAt', (select private.ms(max(x.last_seen_at)) from private.share_sessions x where x.share_id = s.id),
    'views', (select count(*) from private.share_events e where e.share_id = s.id and e.kind = 'viewed'),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('device', x.device, 'createdAt', private.ms(x.created_at),
          'lastSeenAt', private.ms(x.last_seen_at), 'expiresAt', private.ms(x.expires_at)) order by x.last_seen_at desc)
      from private.share_sessions x
      where x.share_id = s.id and x.ended_at is null and x.expires_at > now() and private.share_live(s)), '[]'::jsonb),
    'pending', (select count(*) from private.share_requests r where r.share_id = s.id and r.status = 'pending'),
    'locked', private.share_locked(s.id)
  )
$$;

revoke all on function private.ms(timestamptz), private.share_live(private.shares), private.share_scope(jsonb), private.share_key_ok(text),
  private.share_token(), private.share_new_code(), private.share_hash(text, text), private.share_device(text),
  private.share_session(text, text), private.share_payload(uuid), private.share_json(private.shares), private.share_locked(uuid) from public;

-- SQL editor only: install the sha256 (hex) of SHARE_SERVER_KEY. See docs/setup.md.
create or replace function private.set_share_key_hash(hash text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if lower(coalesce(hash, '')) !~ '^[0-9a-f]{64}$' then return 'expected 64 hex characters: the sha256 of SHARE_SERVER_KEY'; end if;
  insert into private.share_key (id, key_sha256) values (true, lower(hash))
  on conflict (id) do update set key_sha256 = excluded.key_sha256, updated_at = now();
  return 'ok';
end;
$$;
revoke all on function private.set_share_key_hash(text) from public;

/* ---------- yours: only a fully signed-in session ---------- */

create or replace function public.share_list()
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
    'keySet', exists (select 1 from private.share_key),
    'shares', coalesce((select jsonb_agg(private.share_json(x) order by x.created_at desc) from private.shares x where x.user_id = uid), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'shareId', r.share_id, 'kind', r.kind, 'title', r.title, 'note', r.note,
          'start', r.start, 'minutes', r.minutes, 'due', r.due, 'status', r.status,
          'createdAt', private.ms(r.created_at), 'decidedAt', private.ms(r.decided_at), 'email', x.email, 'name', x.name)
        order by r.created_at desc)
      from private.share_requests r join private.shares x on x.id = r.share_id
      where x.user_id = uid and (r.status = 'pending' or r.created_at > now() - interval '30 days')), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('shareId', e.share_id, 'at', private.ms(e.at), 'kind', e.kind, 'device', e.device) order by e.at desc, e.id desc)
      from (select e.* from private.share_events e join private.shares x on x.id = e.share_id
            where x.user_id = uid order by e.at desc, e.id desc limit 200) e), '[]'::jsonb)
  );
end;
$$;

-- p_days: 1 to 3650, or null for no end. p_tz: your IANA time zone, for "today".
create or replace function public.share_create(p_email text, p_name text, p_scope jsonb, p_days integer, p_tz text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  em text := lower(trim(coalesce(p_email, '')));
  sc jsonb := private.share_scope(p_scope);
  zone text := left(coalesce(nullif(trim(p_tz), ''), 'UTC'), 64);
  s private.shares;
begin
  if uid is null or not private.access_ok() then return jsonb_build_object('error', 'locked'); end if;
  if char_length(em) > 254 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('error', 'invalid-email'); end if;
  if not (sc -> 'backlog' = 'true'::jsonb or sc ->> 'calendar' <> 'none') then return jsonb_build_object('error', 'invalid-scope'); end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then return jsonb_build_object('error', 'invalid-duration'); end if;
  begin
    perform now() at time zone zone;
  exception when others then
    zone := 'UTC';
  end;
  if (select count(*) from private.shares x where x.user_id = uid and private.share_live(x)) >= 50 then
    return jsonb_build_object('error', 'too-many');
  end if;
  insert into private.shares (user_id, email, name, link, scope, tz, expires_at)
  values (uid, em, left(trim(coalesce(p_name, '')), 60), private.share_token(), sc, zone,
          case when p_days is null then null else now() + make_interval(days => p_days) end)
  returning * into s;
  insert into private.share_events (share_id, kind) values (s.id, 'created');
  return jsonb_build_object('id', s.id, 'link', s.link);
end;
$$;

-- Change a share that's not stopped. p_patch may hold: name, scope, days (a number, or null for no end),
-- endSessions (true signs them out everywhere). Keys left out stay as they are.
create or replace function public.share_update(p_id uuid, p_patch jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s private.shares;
  sc jsonb;
  n_days numeric;
begin
  if uid is null or not private.access_ok() then return 'locked'; end if;
  select * into s from private.shares where id = p_id and user_id = uid and revoked_at is null for update;
  if not found then return 'not-found'; end if;
  if p_patch ? 'scope' then
    sc := private.share_scope(p_patch -> 'scope');
    if not (sc -> 'backlog' = 'true'::jsonb or sc ->> 'calendar' <> 'none') then return 'invalid-scope'; end if;
    s.scope := sc;
  end if;
  if p_patch ? 'name' then s.name := left(trim(coalesce(p_patch ->> 'name', '')), 60); end if;
  if p_patch ? 'days' then
    if jsonb_typeof(p_patch -> 'days') = 'number' then
      n_days := (p_patch ->> 'days')::numeric;
      if n_days < 1 or n_days > 3650 then return 'invalid-duration'; end if;
      s.expires_at := now() + make_interval(days => n_days::int);
    elsif jsonb_typeof(p_patch -> 'days') = 'null' then
      s.expires_at := null;
    else
      return 'invalid-duration';
    end if;
  end if;
  update private.shares set name = s.name, scope = s.scope, expires_at = s.expires_at where id = s.id;
  -- A shorter share shortens the sessions on it.
  update private.share_sessions set expires_at = least(expires_at, coalesce(s.expires_at, expires_at)) where share_id = s.id and ended_at is null;
  if p_patch -> 'endSessions' = 'true'::jsonb then
    update private.share_sessions set ended_at = now() where share_id = s.id and ended_at is null;
    delete from private.share_codes where share_id = s.id;
  end if;
  insert into private.share_events (share_id, kind) values (s.id, 'changed');
  return 'ok';
end;
$$;

-- Stop sharing: the link stops working and anyone signed in through it is signed out at once.
create or replace function public.share_revoke(p_id uuid)
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
  update private.shares set revoked_at = now() where id = p_id and user_id = uid and revoked_at is null;
  if not found then return 'not-found'; end if;
  update private.share_sessions set ended_at = now() where share_id = p_id and ended_at is null;
  delete from private.share_codes where share_id = p_id;
  insert into private.share_events (share_id, kind) values (p_id, 'revoked');
  return 'ok';
end;
$$;

-- Forget a share that has ended, with its activity and suggestions.
create or replace function public.share_delete(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s private.shares;
begin
  if uid is null or not private.access_ok() then return 'locked'; end if;
  select * into s from private.shares where id = p_id and user_id = uid;
  if not found then return 'not-found'; end if;
  if private.share_live(s) then return 'live'; end if;
  delete from private.shares where id = p_id;
  return 'ok';
end;
$$;

-- Approve or decline a suggestion; 'pending' puts it back (Undo). The planner adds the task itself.
create or replace function public.share_decide(p_id uuid, p_status text)
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
  if p_status is null or p_status not in ('approved', 'declined', 'pending') then return 'invalid'; end if;
  update private.share_requests r
  set status = p_status, decided_at = case when p_status = 'pending' then null else now() end
  from private.shares x
  where x.id = r.share_id and x.user_id = uid and r.id = p_id;
  if not found then return 'not-found'; end if;
  return 'ok';
end;
$$;

-- Suggestions waiting for you, for the badge in the planner.
create or replace function public.share_inbox()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null or not private.access_ok() then 0 else (
    select count(*)::int from private.share_requests r join private.shares x on x.id = r.share_id
    where x.user_id = auth.uid() and r.status = 'pending') end
$$;

-- Exactly what a share shows right now, for "See what they see". Not logged as a view.
create or replace function public.share_preview(p_id uuid)
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
  if not exists (select 1 from private.shares where id = p_id and user_id = uid) then return null; end if;
  return private.share_payload(p_id);
end;
$$;

revoke all on function public.share_list(), public.share_create(text, text, jsonb, integer, text), public.share_update(uuid, jsonb),
  public.share_revoke(uuid), public.share_delete(uuid), public.share_decide(uuid, text), public.share_inbox(), public.share_preview(uuid)
  from public, anon;
grant execute on function public.share_list(), public.share_create(text, text, jsonb, integer, text), public.share_update(uuid, jsonb),
  public.share_revoke(uuid), public.share_delete(uuid), public.share_decide(uuid, text), public.share_inbox(), public.share_preview(uuid)
  to authenticated;

/* ---------- the viewer's: only through this app's server (SHARE_SERVER_KEY) ---------- */

-- Whether the server's key matches, for the setup check in Settings.
create or replace function public.share_ping(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when not exists (select 1 from private.share_key) then 'no-key' when private.share_key_ok(p_key) then 'ok' else 'wrong-key' end
$$;

-- A new 8-digit code for a live share's email, for the server to send. Ten minutes, five tries;
-- one a minute and five an hour per share, and none after 10 wrong codes in a day.
-- Says nothing about whether an email has access.
create or replace function public.share_code(p_key text, p_link text, p_email text, p_device text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s private.shares;
  code text;
begin
  if not private.share_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  -- One at a time per share, so the limits below hold under concurrent requests.
  select * into s from private.shares x where x.link = p_link and x.email = lower(trim(coalesce(p_email, ''))) and private.share_live(x) for update;
  if not found then return jsonb_build_object('sent', false); end if;
  if private.share_locked(s.id)
     or exists (select 1 from private.share_events e where e.share_id = s.id and e.kind = 'code-sent' and e.at > now() - interval '1 minute')
     or (select count(*) from private.share_events e where e.share_id = s.id and e.kind = 'code-sent' and e.at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('sent', false);
  end if;
  code := private.share_new_code();
  insert into private.share_codes (share_id, code_hash, sent_at, expires_at, attempts)
  values (s.id, private.share_hash(s.id::text, code), now(), now() + interval '10 minutes', 0)
  on conflict (share_id) do update set code_hash = excluded.code_hash, sent_at = excluded.sent_at, expires_at = excluded.expires_at, attempts = 0;
  insert into private.share_events (share_id, kind, device) values (s.id, 'code-sent', private.share_device(p_device));
  return jsonb_build_object('sent', true, 'email', s.email, 'code', code);
end;
$$;

-- Swap a code for a session token (7 days, never past the share's end). Returns a status instead of
-- raising, so a wrong try is always counted.
create or replace function public.share_sign_in(p_key text, p_link text, p_email text, p_code text, p_device text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s private.shares;
  c private.share_codes;
  token text;
  sid uuid;
  ends timestamptz;
  dev text := private.share_device(p_device);
begin
  if not private.share_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  select * into s from private.shares x where x.link = p_link and x.email = lower(trim(coalesce(p_email, ''))) and private.share_live(x) for update;
  if not found then return jsonb_build_object('error', 'wrong'); end if;
  if private.share_locked(s.id) then return jsonb_build_object('error', 'locked'); end if;
  select * into c from private.share_codes where share_id = s.id for update;
  if not found or c.expires_at <= now() then return jsonb_build_object('error', 'expired'); end if;
  if c.code_hash is distinct from private.share_hash(s.id::text, p_code) then
    insert into private.share_events (share_id, kind, device) values (s.id, 'wrong-code', dev);
    if c.attempts + 1 >= 5 then
      delete from private.share_codes where share_id = s.id;
      return jsonb_build_object('error', 'expired');
    end if;
    update private.share_codes set attempts = c.attempts + 1 where share_id = s.id;
    return jsonb_build_object('error', 'wrong');
  end if;
  delete from private.share_codes where share_id = s.id;
  token := private.share_token();
  ends := least(now() + interval '7 days', coalesce(s.expires_at, 'infinity'::timestamptz));
  insert into private.share_sessions (share_id, token_sha256, device, expires_at)
  values (s.id, encode(sha256(convert_to(token, 'UTF8')), 'hex'), dev, ends)
  returning id into sid;
  insert into private.share_events (share_id, session_id, kind, device) values (s.id, sid, 'signed-in', dev);
  delete from private.share_sessions where share_id = s.id and (ended_at < now() - interval '30 days' or expires_at < now() - interval '30 days');
  return jsonb_build_object('token', token, 'expiresAt', private.ms(ends));
end;
$$;

-- What the viewer sees, plus their own suggestions. Logs a view at most every 30 minutes per session.
create or replace function public.share_view(p_key text, p_link text, p_token text, p_device text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x private.share_sessions;
begin
  if not private.share_key_ok(p_key) then return jsonb_build_object('error', 'key'); end if;
  x := private.share_session(p_link, p_token);
  if x.id is null then return jsonb_build_object('error', 'signed-out'); end if;
  update private.share_sessions set last_seen_at = now() where id = x.id;
  if not exists (select 1 from private.share_events e where e.session_id = x.id and e.kind = 'viewed' and e.at > now() - interval '30 minutes') then
    insert into private.share_events (share_id, session_id, kind, device) values (x.share_id, x.id, 'viewed', private.share_device(p_device));
  end if;
  return private.share_payload(x.share_id) || jsonb_build_object(
    'sessionEndsAt', private.ms(x.expires_at),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'start', r.start, 'minutes', r.minutes,
          'due', r.due, 'status', r.status, 'createdAt', private.ms(r.created_at)) order by r.created_at desc)
      from (select * from private.share_requests r where r.share_id = x.share_id
              and (r.status = 'pending' or r.created_at > now() - interval '30 days')
            order by r.created_at desc limit 50) r), '[]'::jsonb));
end;
$$;

-- A suggestion: {kind: 'backlog' | 'calendar', title, note, start (ms), minutes, due (YYYY-MM-DD)}.
-- Only what the share shows can be suggested, and only when it allows suggestions.
create or replace function public.share_request(p_key text, p_link text, p_token text, p_req jsonb, p_device text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x private.share_sessions;
  s private.shares;
  sc jsonb;
  v_kind text := p_req ->> 'kind';
  v_title text := left(regexp_replace(trim(coalesce(p_req ->> 'title', '')), '\s+', ' ', 'g'), 160);
  v_note text := left(trim(coalesce(p_req ->> 'note', '')), 500);
  v_start bigint;
  v_minutes integer;
  v_due date;
  now_ms bigint := private.ms(now());
begin
  if not private.share_key_ok(p_key) then return 'key'; end if;
  x := private.share_session(p_link, p_token);
  if x.id is null then return 'signed-out'; end if;
  select * into s from private.shares where id = x.share_id;
  sc := private.share_scope(s.scope);
  if v_kind is null or v_kind not in ('backlog', 'calendar') or v_title = '' then return 'invalid'; end if;
  if sc -> 'suggest' <> 'true'::jsonb
     or (v_kind = 'backlog' and sc -> 'backlog' <> 'true'::jsonb)
     or (v_kind = 'calendar' and sc ->> 'calendar' = 'none') then
    return 'not-allowed';
  end if;
  if v_kind = 'calendar' then
    if jsonb_typeof(p_req -> 'start') is distinct from 'number' or jsonb_typeof(p_req -> 'minutes') is distinct from 'number' then return 'invalid'; end if;
    if (p_req ->> 'start')::numeric not between now_ms - 3600000 and now_ms + 731 * 86400000::bigint
       or (p_req ->> 'minutes')::numeric not between 15 and 480 then
      return 'invalid';
    end if;
    v_start := (p_req ->> 'start')::numeric::bigint;
    v_minutes := round((p_req ->> 'minutes')::numeric / 15) * 15;
  end if;
  if coalesce(p_req ->> 'due', '') <> '' then
    if p_req ->> 'due' !~ '^\d{4}-\d{2}-\d{2}$' then return 'invalid'; end if;
    begin
      v_due := (p_req ->> 'due')::date;
    exception when others then
      return 'invalid';
    end;
    if v_due not between current_date - 366 and current_date + 3660 then return 'invalid'; end if;
  end if;
  if (select count(*) from private.share_requests r where r.share_id = s.id and r.status = 'pending') >= 20
     or (select count(*) from private.share_requests r where r.share_id = s.id and r.created_at > now() - interval '1 day') >= 50 then
    return 'too-many';
  end if;
  insert into private.share_requests (share_id, kind, title, note, start, minutes, due)
  values (s.id, v_kind, v_title, v_note, v_start, v_minutes, v_due);
  insert into private.share_events (share_id, session_id, kind, device) values (s.id, x.id, 'suggested', private.share_device(p_device));
  return 'ok';
end;
$$;

create or replace function public.share_sign_out(p_key text, p_link text, p_token text, p_device text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x private.share_sessions;
begin
  if not private.share_key_ok(p_key) then return 'key'; end if;
  x := private.share_session(p_link, p_token);
  if x.id is null then return 'ok'; end if;
  update private.share_sessions set ended_at = now() where id = x.id;
  insert into private.share_events (share_id, session_id, kind, device) values (x.share_id, x.id, 'signed-out', private.share_device(p_device));
  return 'ok';
end;
$$;

revoke all on function public.share_ping(text), public.share_code(text, text, text, text), public.share_sign_in(text, text, text, text, text),
  public.share_view(text, text, text, text), public.share_request(text, text, text, jsonb, text), public.share_sign_out(text, text, text, text)
  from public, authenticated;
grant execute on function public.share_ping(text), public.share_code(text, text, text, text), public.share_sign_in(text, text, text, text, text),
  public.share_view(text, text, text, text), public.share_request(text, text, text, jsonb, text), public.share_sign_out(text, text, text, text)
  to anon;

/* ---------- the weekly check also looks at sharing ---------- */

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
