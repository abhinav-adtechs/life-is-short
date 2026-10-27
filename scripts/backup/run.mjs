#!/usr/bin/env node
// Backup job, run by GitHub Actions.
//   node scripts/backup/run.mjs sync     daily: checks, then overwrite the backup if they pass
//   node scripts/backup/run.mjs verify   weekly: the same, and fail on warnings too so you get an email
//   node scripts/backup/run.mjs restore  by hand, in an emergency: copy the backup back into the primary
//                                        (needs RESTORE_TO_DB_URL, an admin connection to the primary,
//                                        and CONFIRM=overwrite-primary)
//
// Env: PRIMARY_DB_URL (backup_reader login), BACKUP_DB_URL (backup_writer login), OWNER_EMAIL,
//      optional SUPABASE_CA_CERT (PEM) to replace the bundled Supabase certificate authority, optional FORCE=true.
// Output is safe for public logs: check names and counts only.

import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { compareData, countLost, evaluate } from './checks.mjs';

// Keep dates and bigints exactly as stored so the copy hashes the same.
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(20, v => v);

const mode = ['verify', 'restore'].includes(process.argv[2]) ? process.argv[2] : 'sync';
const { PRIMARY_DB_URL, BACKUP_DB_URL, RESTORE_TO_DB_URL, CONFIRM, OWNER_EMAIL = '', SUPABASE_CA_CERT, FORCE } = process.env;

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
function summary() {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + lines.join('\n') + '\n```\n');
}

function ssl(url) {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url)) return false;
  // Always verify the server certificate against Supabase's own root CA ("Supabase Root 2021 CA",
  // public, valid to April 2031, from the dashboard's SSL download). SUPABASE_CA_CERT replaces it.
  return { ca: SUPABASE_CA_CERT || readFileSync(new URL('./supabase-ca-2021.crt', import.meta.url), 'utf8'), rejectUnauthorized: true };
}

async function connect(url, name) {
  const c = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: ssl(url), application_name: `life-is-short-${mode}` });
  try { await c.connect(); } catch (e) {
    const cert = /certificate|self[- ]signed/i.test(e.message);
    throw new Error(`Can't connect to the ${name} database${cert ? ': its certificate isn’t signed by the bundled Supabase CA. If Supabase has a new one (Project Settings → Database → SSL), add it as the SUPABASE_CA_CERT secret.' : '.'}`);
  }
  return c;
}

const snapshot = async c => (await c.query('select audit.snapshot() as s')).rows[0].s;

/** Replace `to`'s tasks and settings with `from`'s, owned by `toOwner`. One transaction: all or nothing. */
async function copy(from, fromOwner, to, toOwner, log) {
  const tasks = (await from.query('select * from public.tasks where user_id = $1 order by id', [fromOwner])).rows;
  const settings = (await from.query('select * from public.settings where user_id = $1 order by key', [fromOwner])).rows;
  await to.query('begin');
  try {
    await to.query('delete from public.tasks where user_id = $1 or $2', [toOwner, log != null]);
    await to.query('delete from public.settings where user_id = $1 or $2', [toOwner, log != null]);
    for (let i = 0; i < tasks.length; i += 200) {
      const chunk = tasks.slice(i, i + 200);
      const vals = [];
      const rows = chunk.map((t, j) => {
        vals.push(toOwner, t.id, t.title, t.raw, t.notes, t.priority, t.minutes, t.start, t.due, t.status, t.created, t.sort_order, t.done_at, t.external_id, t.updated_at);
        const b = j * 15;
        return `(${Array.from({ length: 15 }, (_, k) => `$${b + k + 1}`).join(',')})`;
      });
      await to.query(`insert into public.tasks (user_id, id, title, raw, notes, priority, minutes, start, due, status, created, sort_order, done_at, external_id, updated_at) values ${rows.join(',')}`, vals);
    }
    for (const s of settings) {
      await to.query('insert into public.settings (user_id, key, value, updated_at) values ($1, $2, $3::jsonb, $4)', [toOwner, s.key, JSON.stringify(s.value), s.updated_at]);
    }
    if (log) await to.query('insert into audit.sync_log (source, tasks, tasks_hash, settings) values ($1, $2, $3, $4)', [log.source, tasks.length, log.hash, settings.length]);
    await to.query('commit');
  } catch (e) {
    await to.query('rollback');
    throw e;
  }
  return { tasks: tasks.length, settings: settings.length };
}

async function restore(ownerSha) {
  if (!BACKUP_DB_URL || !RESTORE_TO_DB_URL) {
    say('Restore needs BACKUP_DB_URL and RESTORE_TO_DB_URL (an admin connection string for the primary).');
    return 1;
  }
  if (CONFIRM !== 'overwrite-primary') {
    say('Restore replaces every task in the primary with the backup. Run again with CONFIRM=overwrite-primary to go ahead.');
    return 1;
  }
  const B = await connect(BACKUP_DB_URL, 'backup');
  const T = await connect(RESTORE_TO_DB_URL, 'primary');
  try {
    const bs = await snapshot(B);
    const backupOwner = (await B.query('select audit.owner_id($1) as id', [ownerSha])).rows[0]?.id;
    const target = (await T.query('select id from auth.users where lower(email) = lower($1)', [OWNER_EMAIL.trim()])).rows[0]?.id;
    if (!backupOwner) { say('The owner account is missing on the backup.'); return 1; }
    if (!target) { say('The owner account is missing on the primary. Create it first (same email), then restore.'); return 1; }
    say(`Restoring ${bs.tasks.count} tasks from the backup (last synced ${bs.last_sync?.synced_at ?? 'never'}).`);
    const n = await copy(B, backupOwner, T, target, null);
    const diff = compareData(bs, await snapshot(T));
    if (diff.length) { for (const d of diff) say(`BLOCK restore:verify         ${d}`); return 1; }
    say(`OK    restore                primary now holds ${n.tasks} tasks and ${n.settings} settings, matching the backup`);
    return 0;
  } finally {
    await Promise.allSettled([B.end(), T.end()]);
  }
}

async function main() {
  if (mode === 'restore') return restore(OWNER_EMAIL ? createHash('sha256').update(OWNER_EMAIL.trim().toLowerCase()).digest('hex') : '');
  if (!PRIMARY_DB_URL || !BACKUP_DB_URL) {
    say('Backup is not configured yet (PRIMARY_DB_URL / BACKUP_DB_URL secrets are missing). Nothing to do.');
    return 0;
  }
  const ownerSha = OWNER_EMAIL ? createHash('sha256').update(OWNER_EMAIL.trim().toLowerCase()).digest('hex') : '';
  const P = await connect(PRIMARY_DB_URL, 'primary');
  const B = await connect(BACKUP_DB_URL, 'backup');
  try {
    const words = 'select id, title, notes, raw from public.tasks';
    const [ps, bs, pw, bw] = await Promise.all([snapshot(P), snapshot(B), P.query(words), B.query(words)]);
    const lost = countLost(pw.rows, bw.rows);
    const { findings, primaryOwner, blocked } = evaluate({ primary: ps, backup: bs, ownerSha, force: FORCE === 'true', lost });
    say(`Life is short backup ${mode} · primary ${ps.tasks.count} tasks · backup ${bs.tasks.count} tasks`);
    for (const x of findings) say(`${x.level.toUpperCase().padEnd(5)} ${x.check.padEnd(22)} ${x.detail}`);
    if (blocked) {
      say('');
      say('Not overwriting the backup: a check above BLOCKED it. The backup still holds the last good copy.');
      return 1;
    }
    const backupOwner = (await B.query('select audit.owner_id($1) as id', [ownerSha])).rows[0]?.id;
    if (!backupOwner) throw new Error('The owner account is missing on the backup project.');
    const n = await copy(P, primaryOwner.id, B, backupOwner, { source: 'primary', hash: ps.tasks.sha256 });
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
