#!/usr/bin/env node
// Turns an exported tasks JSON file into SQL you paste into the Supabase SQL editor.
// The output contains your tasks, so write it somewhere outside the repo.
//
//   node scripts/seed-sql.mjs ~/Downloads/my-tasks.json you@example.com > ~/seed.sql

import { readFileSync } from 'node:fs';

const [file, email] = process.argv.slice(2);
if (!file || !email) {
  console.error('Usage: node scripts/seed-sql.mjs <tasks.json> <account email>');
  process.exit(1);
}

const tasks = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(tasks)) throw new Error('Expected a JSON array of tasks');

const str = v => (v == null ? 'null::text' : `'${String(v).replace(/'/g, "''")}'::text`);
const big = v => (v == null ? 'null::bigint' : `${Math.round(Number(v))}::bigint`);
const date = v => (v == null ? 'null::date' : `'${String(v).replace(/[^0-9-]/g, '')}'::date`);
const int = v => `${Math.round(Number(v))}::int`;

const rows = tasks.map(t => `  (${[
  str(t.id), str(String(t.title).slice(0, 160)), str(t.raw ?? ''), str(t.notes ?? ''),
  int(t.priority), int(Math.min(480, Math.max(10, Number(t.minutes) || 30))), big(t.start), date(t.due),
  str(t.status === 'done' ? 'done' : 'open'), big(t.created), big(t.order ?? t.created), big(t.doneAt),
  str(t.externalId ?? null), big(Date.now()),
].join(', ')})`);

const cols = 'id, title, raw, notes, priority, minutes, start, due, status, created, sort_order, done_at, external_id, updated_at';
process.stdout.write(`-- ${tasks.length} tasks for ${email}. Safe to run again: existing ids are updated.
insert into public.tasks (user_id, ${cols})
select u.id, v.*
from auth.users u,
(values
${rows.join(',\n')}
) as v(${cols})
where u.email = ${str(email).replace('::text', '')}
on conflict (user_id, id) do update set
  title = excluded.title, raw = excluded.raw, notes = excluded.notes, priority = excluded.priority,
  minutes = excluded.minutes, start = excluded.start, due = excluded.due, status = excluded.status,
  created = excluded.created, sort_order = excluded.sort_order, done_at = excluded.done_at,
  external_id = excluded.external_id, updated_at = excluded.updated_at;

select count(*) as tasks_for_account from public.tasks t join auth.users u on u.id = t.user_id where u.email = ${str(email).replace('::text', '')};
`);
