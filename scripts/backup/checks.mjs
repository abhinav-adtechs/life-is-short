// Breach and sanity checks on two audit.snapshot() results (primary and backup).
// Pure: no I/O, so it's unit-tested. Every `detail` is safe for public CI logs:
// check names and counts only, never emails, IPs or task content.

const SUPABASE_LOGIN_ROLES = new Set([
  'postgres', 'authenticator', 'pgbouncer', 'dashboard_user', 'cli_login_postgres',
  'backup_reader', 'backup_writer',
]);
const BLOCKING_EVENTS = ['user_signedup', 'user_invited', 'user_deleted', 'invite_accepted', 'user_repeated_signup'];
const WARNING_EVENTS = [
  'user_recovery_requested', 'user_updated_password', 'user_modified', 'user_reauthenticate_requested',
  'factor_unenrolled', 'factor_deleted', 'recovery_codes_deleted', 'identity_unlinked',
];
const DAY = 864e5;
/** Functions the app calls; anything else in the public schema is a surprise. */
const PUBLIC_FUNCTIONS = new Set(['pin_status', 'set_pin', 'unlock_with_pin']);
/** Sharing (migration 0005). Allowed, but not required: a project without it just shares nothing. */
const VIEWER_FUNCTIONS = new Set(['share_ping', 'share_code', 'share_sign_in', 'share_view', 'share_request', 'share_sign_out']);
const SHARE_FUNCTIONS = new Set([
  'share_list', 'share_create', 'share_update', 'share_revoke', 'share_delete', 'share_decide', 'share_inbox', 'share_preview',
  ...VIEWER_FUNCTIONS,
]);

/** Expected policies per table, by project. The `qual` must mention these to count. */
function expectedPolicies(which) {
  const job = which === 'primary'
    ? { name: 'backup job reads', permissive: 'PERMISSIVE', roles: ['backup_reader'], cmd: 'SELECT' }
    : { name: 'backup job writes', permissive: 'PERMISSIVE', roles: ['backup_writer'], cmd: 'ALL' };
  const per = table => [
    { table, name: table === 'tasks' ? 'own tasks' : 'own settings', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'ALL', mentions: 'auth.uid()' },
    { table, name: 'unlocked', permissive: 'RESTRICTIVE', roles: ['authenticated'], cmd: 'ALL', mentions: 'access_ok' },
    { table, ...job },
  ];
  return [...per('settings'), ...per('tasks')];
}

function checkProject(snap, which, ownerSha, f) {
  const P = which === 'primary' ? 'primary' : 'backup';
  const users = snap.users || [];
  const owner = users.find(u => u.email_sha256 === ownerSha);
  if (!ownerSha) f.block(`${P}:owner`, 'OWNER_EMAIL is not set, so the account can’t be checked');
  else if (!owner) f.block(`${P}:owner`, 'the owner account is missing');
  if (users.length !== 1) f.block(`${P}:users`, `${users.length} accounts exist (expected exactly 1)`);

  const factors = snap.factors || [];
  const s = snap.sessions_7d || {};
  const pins = snap.pins || { count: 0, failed: 0 };
  if (which === 'backup') {
    // The backup has no app: nobody should ever sign in to it.
    if (factors.length) f.warn(`${P}:2fa`, `${factors.length} authenticator(s) set up on the backup, which has no app`);
    if (!s.unavailable && s.count > 0) f.warn(`${P}:sessions`, `${s.count} sign-in(s) in 7 days on the backup, which has no app`);
    if (pins.count > 0) f.warn(`${P}:pin`, 'a PIN was set on the backup, which has no app');
  } else {
    const strangers = factors.filter(x => !owner || x.user_id !== owner.id);
    if (strangers.length) f.block(`${P}:2fa`, `${strangers.length} authenticator factor(s) belong to another account`);
    const verified = factors.filter(x => owner && x.user_id === owner.id && x.type === 'totp' && x.status === 'verified');
    if (verified.length !== 1) f.block(`${P}:2fa`, `${verified.length} verified authenticator factors (expected 1)`);
    const unverified = factors.filter(x => x.status !== 'verified').length;
    if (unverified) f.warn(`${P}:2fa`, `${unverified} unfinished authenticator setup(s)`);
    const nowMs = Date.parse(snap.at) || Date.now();
    const recent = factors.filter(x => nowMs - Date.parse(x.updated_at || x.created_at) < 8 * DAY).length;
    if (recent) f.warn(`${P}:2fa`, `${recent} authenticator factor(s) added or changed in the last 8 days`);
    if (!s.unavailable && s.still_aal1 > 0) f.warn(`${P}:sessions`, `${s.still_aal1} sign-in(s) in 7 days passed the password but not 2FA`);
    if (!s.unavailable) f.info(`${P}:sessions`, `${s.count || 0} sign-ins in 7 days from ${s.distinct_ips || 0} IP(s), ${s.distinct_agents || 0} device(s)`);
    if (!pins.count) f.warn(`${P}:pin`, 'no PIN set yet');
    if (pins.failed > 0) f.warn(`${P}:pin`, `${pins.failed} wrong PIN attempt(s) since the last unlock`);
    if (pins.updated_at && nowMs - Date.parse(pins.updated_at) < 8 * DAY) f.info(`${P}:pin`, 'PIN set or changed in the last 8 days');
  }

  const ev = snap.auth_events_7d || {};
  if (!ev.unavailable) {
    for (const a of BLOCKING_EVENTS) if (ev[a]) f.block(`${P}:auth-events`, `${ev[a]} "${a}" event(s) in 7 days`);
    for (const a of WARNING_EVENTS) if (ev[a]) f.warn(`${P}:auth-events`, `${ev[a]} "${a}" event(s) in 7 days`);
  }

  const tables = snap.tables || [];
  const names = tables.map(t => t.name).sort().join(',');
  if (names !== 'settings,tasks') f.block(`${P}:tables`, `public tables are [${names}] (expected settings,tasks)`);
  for (const t of tables) if (!t.rls) f.block(`${P}:rls`, `row-level security is OFF on ${t.name}`);

  const want = expectedPolicies(which);
  const have = snap.policies || [];
  for (const w of want) {
    const p = have.find(x => x.table === w.table && x.name === w.name);
    if (!p) { f.block(`${P}:policies`, `policy "${w.name}" on ${w.table} is missing`); continue; }
    const roles = [...(p.roles || [])].sort().join(',');
    if (p.permissive !== w.permissive || p.cmd !== w.cmd || roles !== w.roles.join(',')) {
      f.block(`${P}:policies`, `policy "${w.name}" on ${w.table} was changed`);
    }
    if (w.mentions && !`${p.qual} ${p.with_check}`.includes(w.mentions)) f.block(`${P}:policies`, `policy "${w.name}" on ${w.table} no longer checks ${w.mentions}`);
  }
  for (const p of have) if (!want.some(w => w.table === p.table && w.name === p.name)) f.block(`${P}:policies`, `unexpected policy "${p.name}" on ${p.table}`);

  if ((snap.public_grants || []).length) f.block(`${P}:grants`, `signed-out visitors have ${snap.public_grants.length} privilege(s) on public tables`);
  const extraFns = (snap.public_functions || []).filter(n => !PUBLIC_FUNCTIONS.has(n) && !SHARE_FUNCTIONS.has(n));
  if (extraFns.length) f.warn(`${P}:functions`, `${extraFns.length} unexpected function(s) in the public schema`);
  for (const n of PUBLIC_FUNCTIONS) if (!(snap.public_functions || []).includes(n)) f.block(`${P}:functions`, `the ${n} function is missing`);

  const src = snap.mfa_check_src || '';
  if (!src.includes("'totp'") || !src.includes('86400') || !src.includes("'aal2'")) f.block(`${P}:2fa-rule`, 'the database 2FA rule (private.mfa_fresh) is missing or was changed');
  const rule = snap.access_rule_src || '';
  if (!rule.includes('mfa_fresh') || !rule.includes('unlocks') || !rule.includes("'password'") || !rule.includes('86400')) {
    f.block(`${P}:access-rule`, 'the sign-in rule (private.access_ok) is missing or was changed');
  }

  const roles = (snap.login_roles || []).filter(r => !SUPABASE_LOGIN_ROLES.has(r) && !r.startsWith('supabase_'));
  if (roles.length) f.warn(`${P}:roles`, `${roles.length} unexpected database login role(s)`);

  const rt = (snap.realtime_tables || []).filter(t => t !== 'public.tasks');
  if (rt.length) f.warn(`${P}:realtime`, `${rt.length} extra table(s) broadcast over realtime`);

  // Signed-out visitors may only call the viewer's sharing functions, and those only answer the app's server.
  const anonFns = (snap.anon_functions || []).filter(n => !VIEWER_FUNCTIONS.has(n));
  if (anonFns.length) f.block(`${P}:functions`, `signed-out visitors can call ${anonFns.length} function(s) they shouldn't`);

  const sh = snap.sharing;
  if (sh && which === 'backup') {
    if (sh.key_set || sh.shares > 0) f.warn(`${P}:sharing`, 'sharing was set up on the backup, which has no app');
  } else if (sh) {
    f.info(`${P}:sharing`, `${sh.active} active share(s), ${sh.sessions_live} viewer session(s), ${sh.sign_ins_7d} viewer sign-in(s) in 7 days`);
    if (sh.wrong_codes_7d >= 10) f.warn(`${P}:sharing`, `${sh.wrong_codes_7d} wrong viewer code(s) in 7 days`);
    const nowMs = Date.parse(snap.at) || Date.now();
    if (sh.key_updated_at && nowMs - Date.parse(sh.key_updated_at) < 8 * DAY) f.warn(`${P}:sharing`, 'the sharing server key was set or changed in the last 8 days');
  }
  return owner;
}

/**
 * @param {object} a
 * @param {object} a.primary   audit.snapshot() from the primary
 * @param {object} a.backup    audit.snapshot() from the backup
 * @param {string} a.ownerSha  sha256 of the owner's lowercased email
 * @param {boolean} [a.force]  skip the data guards (never the security checks)
 * @param {number} [a.lost]     backup tasks this sync would delete or rewrite, from countLost()
 * @returns {{findings: {level: 'block'|'warn'|'info', check: string, detail: string}[], primaryOwner: object|undefined, blocked: boolean}}
 */
export function evaluate({ primary, backup, ownerSha, force = false, lost = 0 }) {
  const findings = [];
  const f = {
    block: (check, detail) => findings.push({ level: 'block', check, detail }),
    warn: (check, detail) => findings.push({ level: 'warn', check, detail }),
    info: (check, detail) => findings.push({ level: 'info', check, detail }),
  };
  const primaryOwner = checkProject(primary, 'primary', ownerSha, f);
  checkProject(backup, 'backup', ownerSha, f);

  if (primary.mfa_check_sha256 && backup.mfa_check_sha256 && primary.mfa_check_sha256 !== backup.mfa_check_sha256) {
    f.block('both:2fa-rule', 'the database 2FA rule differs between primary and backup');
  }
  if (primary.access_rule_sha256 && backup.access_rule_sha256 && primary.access_rule_sha256 !== backup.access_rule_sha256) {
    f.block('both:access-rule', 'the sign-in rule differs between primary and backup');
  }
  const ps = primary.sharing?.functions_sha256, bs = backup.sharing?.functions_sha256;
  if (ps && bs && ps !== bs) f.block('both:sharing', 'the sharing functions differ between primary and backup');
  for (const name of ['own tasks', 'unlocked']) {
    const a = (primary.policies || []).find(p => p.table === 'tasks' && p.name === name);
    const b = (backup.policies || []).find(p => p.table === 'tasks' && p.name === name);
    if (a && b && (a.qual !== b.qual || a.with_check !== b.with_check)) f.warn('both:policies', `policy "${name}" reads differently on primary and backup`);
  }

  // Data guards: don't overwrite a good backup with the results of an attack or an accident.
  const P = primary.tasks || {}, B = backup.tasks || {};
  const lastSync = backup.last_sync ? Date.parse(backup.last_sync.synced_at) : null;
  const guard = (check, detail) => (force ? f.warn(check, `${detail} (overridden with force)`) : f.block(check, detail));
  if (lastSync && Number(B.max_updated_at || 0) > lastSync) guard('data:backup-in-use', 'the backup has edits made after the last sync; promote it or clear it before syncing');
  // Nothing to guard when the backup already holds exactly what the primary has.
  const same = !!P.sha256 && P.sha256 === B.sha256;
  if (!same && B.count >= 6 && P.count < B.count * 0.5) guard('data:mass-deletion', `primary has ${P.count} tasks, backup has ${B.count}`);
  if (!same && B.count >= 6 && lost > Math.max(10, B.count * 0.6)) guard('data:mass-change', `${lost} of the backup's ${B.count} tasks would be deleted or rewritten`);
  if (lastSync && (Date.parse(primary.at) || Date.now()) - lastSync > 3 * DAY) f.warn('data:backup-stale', 'the last successful sync was more than 3 days ago');

  return { findings, primaryOwner, blocked: findings.some(x => x.level === 'block') };
}

/**
 * Backup tasks a sync would lose: gone from the primary, or with their words changed.
 * Ticking off and moving don't count. Compares the rows themselves, because updated_at
 * is set by the browser and an intruder could backdate it.
 */
export function countLost(primaryRows, backupRows) {
  const now = new Map(primaryRows.map(t => [t.id, t]));
  const words = t => [t.title, t.notes, t.raw].map(v => v ?? '').join('\u0000');
  return backupRows.filter(b => !now.has(b.id) || words(now.get(b.id)) !== words(b)).length;
}

/** After copying: the backup must hold exactly what the primary had. */
export function compareData(primary, backup) {
  const problems = [];
  if (primary.tasks?.sha256 !== backup.tasks?.sha256) problems.push(`tasks differ (primary ${primary.tasks?.count}, backup ${backup.tasks?.count})`);
  if (primary.settings?.sha256 !== backup.settings?.sha256) problems.push(`settings differ (primary ${primary.settings?.count}, backup ${backup.settings?.count})`);
  return problems;
}
