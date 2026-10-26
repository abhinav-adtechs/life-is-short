#!/usr/bin/env node
// Backup job, run by GitHub Actions.
//   node scripts/backup/run.mjs sync     daily: checks, then overwrite the backup if they pass
//   node scripts/backup/run.mjs verify   weekly: the same, and fail on warnings too so you get an email
//
// Env: PRIMARY_DB_URL (backup_reader login), BACKUP_DB_URL (backup_writer login), OWNER_EMAIL,
//      optional SUPABASE_CA_CERT (PEM) to pin Supabase's certificate authority, optional FORCE=true.
// Output is safe for public logs: check names and counts only.

import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import pg from 'pg';
import { compareData, evaluate } from './checks.mjs';

// Keep dates and bigints exactly as stored so the copy hashes the same.
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(20, v => v);

const mode = process.argv[2] === 'verify' ? 'verify' : 'sync';
const { PRIMARY_DB_URL, BACKUP_DB_URL, OWNER_EMAIL = '', SUPABASE_CA_CERT, FORCE } = process.env;

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
function summary() {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + lines.join('\n') + '\n```\n');
}

function ssl(url) {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url)) return false;
  // Always verify the server certificate; pin Supabase's CA when given.
  return SUPABASE_CA_CERT ? { ca: SUPABASE_CA_CERT, rejectUnauthorized: true } : { rejectUnauthorized: true };
}

async function connect(url, name) {
  const c = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: ssl(url), application_name: `dump-and-slot-${mode}` });
  try { await c.connect(); } catch (e) {
    const cert = /certificate|self[- ]signed/i.test(e.message);
    throw new Error(`Can't connect to the ${name} database${cert ? ': its certificate isn’t trusted. Add Supabase’s CA as the SUPABASE_CA_CERT secret.' : '.'}`);
  }
  return c;
}

const snapshot = async c => (await c.query('select audit.snapshot() as s')).rows[0].s;

async function copy(P, B, primaryOwnerId, ownerSha, primarySnap) {
  const tasks = (await P.query('select * from public.tasks where user_id = $1 order by id', [primaryOwnerId])).rows;
  const settings = (await P.query('select * from public.settings where user_id = $1 order by key', [primaryOwnerId])).rows;
  const backupOwner = (await B.query('select audit.owner_id($1) as id', [ownerSha])).rows[0]?.id;
  if (!backupOwner) throw new Error('The owner account is missing on the backup project.');
  await B.query('begin');
  try {
    await B.query('delete from public.tasks');
    await B.query('delete from public.settings');
    for (let i = 0; i < tasks.length; i += 200) {
      const chunk = tasks.slice(i, i + 200);
      const vals = [];
      const rows = chunk.map((t, j) => {
        vals.push(backupOwner, t.id, t.title, t.raw, t.notes, t.priority, t.minutes, t.start, t.due, t.status, t.created, t.sort_order, t.done_at, t.external_id, t.updated_at);
        const b = j * 15;
        return `(${Array.from({ length: 15 }, (_, k) => `$${b + k + 1}`).join(',')})`;
      });
      await B.query(`insert into public.tasks (user_id, id, title, raw, notes, priority, minutes, start, due, status, created, sort_order, done_at, external_id, updated_at) values ${rows.join(',')}`, vals);
    }
    for (const s of settings) {
      await B.query('insert into public.settings (user_id, key, value, updated_at) values ($1, $2, $3::jsonb, $4)', [backupOwner, s.key, JSON.stringify(s.value), s.updated_at]);
    }
    await B.query('insert into audit.sync_log (source, tasks, tasks_hash, settings) values ($1, $2, $3, $4)',
      ['primary', tasks.length, primarySnap.tasks.sha256, settings.length]);
    await B.query('commit');
  } catch (e) {
    await B.query('rollback');
    throw e;
  }
  return { tasks: tasks.length, settings: settings.length };
}

async function main() {
  if (!PRIMARY_DB_URL || !BACKUP_DB_URL) {
    say('Backup is not configured yet (PRIMARY_DB_URL / BACKUP_DB_URL secrets are missing). Nothing to do.');
    return 0;
  }
  const ownerSha = OWNER_EMAIL ? createHash('sha256').update(OWNER_EMAIL.trim().toLowerCase()).digest('hex') : '';
  const P = await connect(PRIMARY_DB_URL, 'primary');
  const B = await connect(BACKUP_DB_URL, 'backup');
  try {
    const [ps, bs] = await Promise.all([snapshot(P), snapshot(B)]);
    const { findings, primaryOwner, blocked } = evaluate({ primary: ps, backup: bs, ownerSha, force: FORCE === 'true' });
    say(`Dump & Slot backup ${mode} · primary ${ps.tasks.count} tasks · backup ${bs.tasks.count} tasks`);
    for (const x of findings) say(`${x.level.toUpperCase().padEnd(5)} ${x.check.padEnd(22)} ${x.detail}`);
    if (blocked) {
      say('');
      say('Not overwriting the backup: a check above BLOCKED it. The backup still holds the last good copy.');
      return 1;
    }
    const n = await copy(P, B, primaryOwner.id, ownerSha, ps);
    const after = await snapshot(B);
    const diff = compareData(ps, after);
    if (diff.length) {
      for (const d of diff) say(`BLOCK sync:verify            ${d}`);
      return 1;
    }
    say(`OK    sync                   backup overwritten with ${n.tasks} tasks and ${n.settings} settings; contents match the primary`);
    const warned = findings.some(x => x.level === 'warn');
    if (mode === 'verify' && warned) {
      say('');
      say('Weekly check: the backup is in sync, but there are warnings above worth a look.');
      return 1;
    }
    return 0;
  } finally {
    await Promise.allSettled([P.end(), B.end()]);
  }
}

main().then(code => { summary(); process.exit(code); }, e => { say(`ERROR ${e.message}`); summary(); process.exit(1); });
