// Sharing (supabase/migrations/0005) against the real migrations in PGlite: who can call what,
// the email code, what a viewer sees for each scope, suggestions, and the activity log.
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { as, migrated } from './pglite.mjs';
import { evaluate } from '../backup/checks.mjs';

const OWNER = '11111111-1111-1111-1111-111111111111';
const KEY = 'k'.repeat(40);
const KEY_SHA = createHash('sha256').update(KEY).digest('hex');
const nowS = () => Math.floor(Date.now() / 1000);
const H = 3600000;
/** A fully signed-in session: password and an authenticator code a minute ago. */
const me = { sub: OWNER, role: 'authenticated', session_id: 'aaaaaaaa-0000-0000-0000-000000000001', aal: 'aal2',
  amr: [{ method: 'password', timestamp: nowS() - 60 }, { method: 'totp', timestamp: nowS() - 60 }] };
/** Password only: the database shows this session nothing. */
const half = { ...me, aal: 'aal1', amr: [{ method: 'password', timestamp: nowS() - 60 }] };

let db;
const one = async (role, claims, q, params) => Object.values((await as(db, role, claims, q, params)).rows[0])[0];
const owner = (q, params) => one('authenticated', me, q, params);
const server = (q, params) => one('anon', {}, q, params);

async function share(email, scope, days = null) {
  return owner('select public.share_create($1, $2, $3::jsonb, $4, $5)', [email, 'Them', JSON.stringify(scope), days, 'Asia/Kolkata']);
}
async function signIn(link, email) {
  const sent = await server('select public.share_code($1, $2, $3, $4)', [KEY, link, email, 'Safari on iPhone']);
  expect(sent).toMatchObject({ sent: true });
  const r = await server('select public.share_sign_in($1, $2, $3, $4, $5)', [KEY, link, email, sent.code, 'Safari on iPhone']);
  expect(r.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  return r.token;
}
const view = (link, token) => server('select public.share_view($1, $2, $3, $4)', [KEY, link, token, 'Safari on iPhone']);
const ago = ms => Date.now() - ms;
const later = ms => Date.now() + ms;

beforeAll(async () => {
  db = await migrated();
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'me@example.com')`);
  await db.exec(`insert into auth.mfa_factors (user_id, factor_type, status) values ('${OWNER}', 'totp', 'verified')`);
  await db.query('select private.set_share_key_hash($1)', [KEY_SHA]);
  const t = (id, title, start, extra = {}) => ({ id, title, start, notes: 'private note', raw: 'private dump', priority: 2, minutes: 60, ...extra });
  const tasks = [
    t('b1', 'Backlog one', null, { priority: 1 }),
    t('b2', 'Backlog two', null, { due: '2026-12-01' }),
    t('d1', 'Finished thing', null, { status: 'done' }),
    t('c1', 'In an hour', later(H)),
    t('c2', 'Next week', later(7 * 24 * H)),
    t('c3', 'Last month', ago(30 * 24 * H)),
    t('g1', 'Team meeting', later(2 * H), { external_id: 'gcal:work@example.com:ev1' }),
    t('g2', 'Holiday', later(3 * H), { external_id: 'gcal:holidays#group.v.calendar.google.com:ev2' }),
    t('g3', 'Hidden account event', later(4 * H), { external_id: 'gcal:hidden@example.com:ev3' }),
    t('gt', 'Google task', null, { external_id: 'gtask:abc' }),
  ];
  for (const x of tasks) {
    await db.query(`insert into public.tasks (user_id, id, title, notes, raw, priority, minutes, start, due, status, created, sort_order, external_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, 1, $11)`,
    [OWNER, x.id, x.title, x.notes, x.raw, x.priority, x.minutes, x.start, x.due ?? null, x.status ?? 'open', x.external_id ?? null]);
  }
  // Your Google accounts: the holidays calendar is switched off, and one account is hidden from the calendar.
  await db.query(`insert into public.settings (user_id, key, value) values ($1, 'google', $2::jsonb)`, [OWNER, JSON.stringify({ v: 2, accounts: [
    { id: 'work@example.com', blob: 'x', email: 'work@example.com', show: true, calendars: [
      { id: 'work@example.com', pull: true }, { id: 'holidays#group.v.calendar.google.com', pull: false }] },
    { id: 'hidden@example.com', blob: 'y', email: 'hidden@example.com', show: false, calendars: [] },
  ] })]);
}, 60000);

describe('who can call what', () => {
  it('your functions only answer a fully signed-in session', async () => {
    expect(await one('authenticated', half, 'select public.share_list()')).toBeNull();
    expect(await one('authenticated', half, `select public.share_create('a@b.co', '', '{"backlog":true}', null, 'UTC')`)).toEqual({ error: 'locked' });
    expect(await one('authenticated', half, 'select public.share_inbox()')).toBe(0);
    await expect(as(db, 'anon', {}, 'select public.share_list()')).rejects.toThrow(/permission denied/);
  });
  it('the viewer functions only answer the server, which knows the key', async () => {
    expect(await server('select public.share_ping($1)', [KEY])).toBe('ok');
    expect(await server('select public.share_ping($1)', ['x'.repeat(40)])).toBe('wrong-key');
    expect(await server(`select public.share_code($1, 'link', 'a@b.co', '')`, ['x'.repeat(40)])).toEqual({ error: 'key' });
    // A signed-in app session can't call them at all.
    await expect(as(db, 'authenticated', me, `select public.share_ping('x')`)).rejects.toThrow(/permission denied/);
  });
  it('nobody reaches the tables directly', async () => {
    await expect(as(db, 'authenticated', me, 'select * from private.shares')).rejects.toThrow(/permission denied/);
    await expect(as(db, 'anon', {}, 'select * from private.share_sessions')).rejects.toThrow(/permission denied/);
  });
});

describe('creating and changing a share', () => {
  it('checks the email and that it shows something', async () => {
    expect(await share('not an email', { backlog: true })).toEqual({ error: 'invalid-email' });
    expect(await share('a@b.co', { backlog: false, calendar: 'none' })).toEqual({ error: 'invalid-scope' });
    expect(await share('a@b.co', { backlog: true }, 0)).toEqual({ error: 'invalid-duration' });
  });
  it('returns a long random link and lists the share', async () => {
    const r = await share('Friend@Example.com', { backlog: true, calendar: 'today', google: true, details: 'titles', suggest: true }, 7);
    expect(r.link).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const list = await owner('select public.share_list()');
    const s = list.shares.find(x => x.id === r.id);
    expect(s).toMatchObject({ email: 'friend@example.com', name: 'Them', live: true, views: 0, sessions: [], pending: 0,
      scope: { backlog: true, calendar: 'today', google: true, details: 'titles', suggest: true } });
    expect(s.expiresAt - Date.now()).toBeGreaterThan(6.9 * 24 * H);
    expect(list.keySet).toBe(true);
    expect(list.events.find(e => e.shareId === r.id)).toMatchObject({ kind: 'created' });
  });
  it('changes scope, name and duration, and keeps what is left out', async () => {
    const { id } = await share('change@example.com', { backlog: true }, 1);
    expect(await owner(`select public.share_update($1, '{"scope":{"calendar":"all"},"days":null}'::jsonb)`, [id])).toBe('ok');
    const s = (await owner('select public.share_list()')).shares.find(x => x.id === id);
    expect(s).toMatchObject({ name: 'Them', expiresAt: null, scope: { backlog: false, calendar: 'all' } });
    expect(await owner(`select public.share_update($1, '{"scope":{}}'::jsonb)`, [id])).toBe('invalid-scope');
    expect(await owner(`select public.share_update($1, '{"days":"soon"}'::jsonb)`, [id])).toBe('invalid-duration');
  });
});

describe('signing in with an emailed code', () => {
  let link;
  beforeAll(async () => { ({ link } = await share('viewer@example.com', { backlog: true })); });

  it('only makes a code for the share’s own email, and says the same either way', async () => {
    expect(await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'someone@else.com', ''])).toEqual({ sent: false });
    expect(await server('select public.share_code($1, $2, $3, $4)', [KEY, 'x'.repeat(32), 'viewer@example.com', ''])).toEqual({ sent: false });
  });
  it('stores only a hash of the code, and limits how often one is sent', async () => {
    const r = await server('select public.share_code($1, $2, $3, $4)', [KEY, link, ' Viewer@Example.com ', '']);
    expect(r).toMatchObject({ sent: true, email: 'viewer@example.com' });
    expect(r.code).toMatch(/^\d{6}$/);
    const stored = (await db.query('select code_hash from private.share_codes')).rows.map(x => x.code_hash);
    expect(stored.join()).not.toContain(r.code);
    // Another one straight away is refused.
    expect(await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'viewer@example.com', ''])).toEqual({ sent: false });
  });
  it('five wrong codes burn it', async () => {
    await db.exec(`update private.share_codes set sent_at = now() - interval '2 minutes'`);
    const { code } = await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'viewer@example.com', '']);
    const wrong = code === '000000' ? '111111' : '000000';
    const tryCode = c => server('select public.share_sign_in($1, $2, $3, $4, $5)', [KEY, link, 'viewer@example.com', c, '']);
    for (let i = 0; i < 4; i++) expect(await tryCode(wrong)).toEqual({ error: 'wrong' });
    expect(await tryCode(wrong)).toEqual({ error: 'expired' });
    expect(await tryCode(code)).toEqual({ error: 'expired' });
  });
  it('an expired code does nothing', async () => {
    await db.exec(`update private.share_codes set sent_at = now() - interval '20 minutes'`);
    await db.exec(`delete from private.share_events where kind = 'code-sent'`);
    const { code } = await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'viewer@example.com', '']);
    await db.exec(`update private.share_codes set expires_at = now() - interval '1 second'`);
    expect(await server('select public.share_sign_in($1, $2, $3, $4, $5)', [KEY, link, 'viewer@example.com', code, ''])).toEqual({ error: 'expired' });
  });
  it('no more than five codes an hour', async () => {
    await db.exec(`delete from private.share_events where kind = 'code-sent'; delete from private.share_codes`);
    for (let i = 0; i < 5; i++) {
      expect(await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'viewer@example.com', ''])).toMatchObject({ sent: true });
      await db.exec(`update private.share_codes set sent_at = now() - interval '2 minutes'`);
    }
    expect(await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'viewer@example.com', ''])).toEqual({ sent: false });
    await db.exec(`delete from private.share_events where kind = 'code-sent'; delete from private.share_codes`);
  });
  it('the right code starts a session that can only see its own link', async () => {
    const token = await signIn(link, 'viewer@example.com');
    expect(await view(link, token)).toMatchObject({ email: 'viewer@example.com' });
    const other = await share('other@example.com', { backlog: true });
    expect(await view(other.link, token)).toEqual({ error: 'signed-out' });
    expect(await view(link, 'x'.repeat(32))).toEqual({ error: 'signed-out' });
    // Only a hash of the session token is kept.
    expect((await db.query('select token_sha256 from private.share_sessions')).rows.map(x => x.token_sha256).join()).not.toContain(token);
  });
});

describe('what a viewer sees', () => {
  const titles = list => (list || []).map(x => x.title);

  it('backlog only: open, unscheduled tasks in order, with no notes or dump text', async () => {
    const { link } = await share('b@example.com', { backlog: true });
    const v = await view(link, await signIn(link, 'b@example.com'));
    expect(titles(v.backlog)).toEqual(['Backlog one', 'Backlog two']);
    expect(v.calendar).toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/private note|private dump|Them/);
    expect(v.backlog[1]).toEqual({ title: 'Backlog two', priority: 2, minutes: 60, due: '2026-12-01' });
  });
  it('Google items only when included, never from a calendar switched off or an account hidden', async () => {
    const { link } = await share('g@example.com', { backlog: true, calendar: 'upcoming', google: true });
    const v = await view(link, await signIn(link, 'g@example.com'));
    expect(titles(v.backlog)).toEqual(['Backlog one', 'Backlog two', 'Google task']);
    expect(titles(v.calendar.items)).toEqual(['In an hour', 'Team meeting', 'Next week']);
    expect(v.calendar.items.find(x => x.title === 'Team meeting')).toMatchObject({ google: true, done: false });

    const off = await share('n@example.com', { backlog: true, calendar: 'upcoming', google: false });
    const w = await view(off.link, await signIn(off.link, 'n@example.com'));
    expect(titles(w.backlog)).toEqual(['Backlog one', 'Backlog two']);
    expect(titles(w.calendar.items)).toEqual(['In an hour', 'Next week']);
  });
  it('today: just today on your clock', async () => {
    const { link } = await share('t@example.com', { calendar: 'today' });
    const v = await view(link, await signIn(link, 't@example.com'));
    expect(v.calendar.to - v.calendar.from).toBeGreaterThanOrEqual(23 * H);
    expect(v.calendar.to - v.calendar.from).toBeLessThanOrEqual(25 * H);
    expect(v.calendar.items.every(x => x.start < v.calendar.to && x.start + x.minutes * 60000 > v.calendar.from)).toBe(true);
    expect(titles(v.calendar.items)).not.toContain('Next week');
    expect(v.backlog).toBeNull();
  });
  it('all: the past too', async () => {
    const { link } = await share('a@example.com', { calendar: 'all' });
    const v = await view(link, await signIn(link, 'a@example.com'));
    expect(titles(v.calendar.items)).toEqual(['Last month', 'In an hour', 'Next week']);
    expect(v.calendar.from).toBeNull();
  });
  it('busy only: times without titles', async () => {
    const { link } = await share('busy@example.com', { calendar: 'upcoming', google: true, details: 'busy' });
    const v = await view(link, await signIn(link, 'busy@example.com'));
    expect(v.calendar.items.length).toBe(3);
    expect(v.calendar.items.every(x => x.title === null && x.done === false && x.google === false)).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/Team meeting|In an hour/);
  });
  it('follows your "show done tasks" setting on the calendar', async () => {
    await db.exec(`update public.tasks set status = 'done' where id = 'c1'`);
    await db.query(`insert into public.settings (user_id, key, value) values ($1, 'prefs', '{"showDone":false,"dayStart":7,"dayEnd":19,"weekStart":0,"clock":"24"}')`, [OWNER]);
    try {
      const { link } = await share('done@example.com', { calendar: 'upcoming' });
      const v = await view(link, await signIn(link, 'done@example.com'));
      expect(titles(v.calendar.items)).toEqual(['Next week']);
      expect(v).toMatchObject({ hours: { start: 7, end: 19 }, weekStart: 0, clock: '24' });
    } finally {
      await db.exec(`update public.tasks set status = 'open' where id = 'c1'; delete from public.settings where key = 'prefs'`);
    }
  });
  it('a preview shows you the same thing, without logging a view', async () => {
    const { id, link } = await share('p@example.com', { backlog: true });
    const p = await owner('select public.share_preview($1)', [id]);
    expect(titles(p.backlog)).toEqual(['Backlog one', 'Backlog two']);
    expect(await one('authenticated', half, 'select public.share_preview($1)', [id])).toBeNull();
    const s = (await owner('select public.share_list()')).shares.find(x => x.link === link);
    expect(s.views).toBe(0);
  });
});

describe('stopping a share', () => {
  it('signs them out at once and kills the link', async () => {
    const { id, link } = await share('stop@example.com', { backlog: true });
    const token = await signIn(link, 'stop@example.com');
    expect((await owner('select public.share_list()')).shares.find(x => x.id === id).sessions).toHaveLength(1);
    expect(await owner('select public.share_delete($1)', [id])).toBe('live');
    expect(await owner('select public.share_revoke($1)', [id])).toBe('ok');
    expect(await view(link, token)).toEqual({ error: 'signed-out' });
    expect(await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'stop@example.com', ''])).toEqual({ sent: false });
    expect(await owner(`select public.share_update($1, '{"days":null}'::jsonb)`, [id])).toBe('not-found');
    expect(await owner('select public.share_delete($1)', [id])).toBe('ok');
    expect((await owner('select public.share_list()')).shares.find(x => x.id === id)).toBeUndefined();
  });
  it('an expired share stops working, and shortening one shortens its sessions', async () => {
    const { id, link } = await share('short@example.com', { backlog: true }, 30);
    const token = await signIn(link, 'short@example.com');
    expect(await owner(`select public.share_update($1, '{"days":1}'::jsonb)`, [id])).toBe('ok');
    const ends = (await db.query(`select max(x.expires_at) as e from private.share_sessions x join private.shares s on s.id = x.share_id where s.link = $1`, [link])).rows[0].e;
    expect(new Date(ends).getTime() - Date.now()).toBeLessThanOrEqual(24 * H + 1000);
    await db.query(`update private.shares set expires_at = now() - interval '1 second' where id = $1`, [id]);
    expect(await view(link, token)).toEqual({ error: 'signed-out' });
  });
  it('signing them out everywhere keeps the share', async () => {
    const { id, link } = await share('out@example.com', { backlog: true });
    const token = await signIn(link, 'out@example.com');
    expect(await owner(`select public.share_update($1, '{"endSessions":true}'::jsonb)`, [id])).toBe('ok');
    expect(await view(link, token)).toEqual({ error: 'signed-out' });
    expect(await view(link, await signIn(link, 'out@example.com'))).toMatchObject({ email: 'out@example.com' });
  });
});

describe('suggestions', () => {
  let id, link, token;
  const suggest = req => server('select public.share_request($1, $2, $3, $4::jsonb, $5)', [KEY, link, token, JSON.stringify(req), 'Chrome on Mac']);
  beforeAll(async () => {
    ({ id, link } = await share('s@example.com', { backlog: true, calendar: 'today', suggest: true }));
    token = await signIn(link, 's@example.com');
  });

  it('checks what is suggested', async () => {
    expect(await suggest({ kind: 'backlog', title: '   ' })).toBe('invalid');
    expect(await suggest({ kind: 'other', title: 'x' })).toBe('invalid');
    expect(await suggest({ kind: 'calendar', title: 'x' })).toBe('invalid');
    expect(await suggest({ kind: 'calendar', title: 'x', start: ago(48 * H), minutes: 30 })).toBe('invalid');
    expect(await suggest({ kind: 'backlog', title: 'x', due: '2026-02-31' })).toBe('invalid');
  });
  it('lands for you to decide, and shows the viewer where it stands', async () => {
    expect(await suggest({ kind: 'backlog', title: '  Buy   milk ', note: 'the oat one', due: '2026-11-02' })).toBe('ok');
    expect(await suggest({ kind: 'calendar', title: 'Lunch', start: later(24 * H), minutes: 50 })).toBe('ok');
    expect(await owner('select public.share_inbox()')).toBe(2);
    const list = await owner('select public.share_list()');
    const lunch = list.requests.find(r => r.title === 'Lunch');
    expect(lunch).toMatchObject({ kind: 'calendar', minutes: 45, status: 'pending', email: 's@example.com', name: 'Them', shareId: id });
    expect(list.requests.find(r => r.title === 'Buy milk')).toMatchObject({ note: 'the oat one', due: '2026-11-02', start: null });
    expect(await owner('select public.share_decide($1, $2)', [lunch.id, 'approved'])).toBe('ok');
    expect(await owner('select public.share_decide($1, $2)', [lunch.id, 'maybe'])).toBe('invalid');
    expect(await owner('select public.share_inbox()')).toBe(1);
    const v = await view(link, token);
    expect(v.requests.map(r => [r.title, r.status])).toEqual([['Lunch', 'approved'], ['Buy milk', 'pending']]);
    expect(JSON.stringify(v.requests)).not.toContain('oat');
    // Undo puts it back.
    expect(await owner('select public.share_decide($1, $2)', [lunch.id, 'pending'])).toBe('ok');
    expect(await owner('select public.share_inbox()')).toBe(2);
  });
  it('only for what the share shows, and only when it allows suggestions', async () => {
    const quiet = await share('q@example.com', { backlog: true, suggest: false });
    const t = await signIn(quiet.link, 'q@example.com');
    expect(await server('select public.share_request($1, $2, $3, $4::jsonb, $5)', [KEY, quiet.link, t, '{"kind":"backlog","title":"x"}', ''])).toBe('not-allowed');
    const cal = await share('c@example.com', { calendar: 'today', suggest: true });
    const u = await signIn(cal.link, 'c@example.com');
    expect(await server('select public.share_request($1, $2, $3, $4::jsonb, $5)', [KEY, cal.link, u, '{"kind":"backlog","title":"x"}', ''])).toBe('not-allowed');
  });
  it('a signed-out viewer can’t suggest', async () => {
    expect(await server('select public.share_request($1, $2, $3, $4::jsonb, $5)', [KEY, link, 'nope'.repeat(8), '{"kind":"backlog","title":"x"}', ''])).toBe('signed-out');
  });
  it('no more than 20 waiting at once', async () => {
    for (let i = 0; i < 18; i++) expect(await suggest({ kind: 'backlog', title: `t${i}` })).toBe('ok');
    expect(await suggest({ kind: 'backlog', title: 'one too many' })).toBe('too-many');
  });
});

describe('the activity log', () => {
  it('records sign-ins, views (at most every 30 minutes), wrong codes and suggestions, with the device', async () => {
    const { id, link } = await share('log@example.com', { backlog: true, suggest: true });
    const token = await signIn(link, 'log@example.com');
    await view(link, token);
    await view(link, token);
    const { code } = await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'log@example.com', 'Firefox on Windows']);
    await server('select public.share_sign_in($1, $2, $3, $4, $5)', [KEY, link, 'log@example.com', code === '999999' ? '000000' : '999999', 'Firefox on Windows']);
    await server('select public.share_sign_out($1, $2, $3, $4)', [KEY, link, token, 'Safari on iPhone']);
    const list = await owner('select public.share_list()');
    const kinds = list.events.filter(e => e.shareId === id).map(e => e.kind).reverse();
    expect(kinds).toEqual(['created', 'code-sent', 'signed-in', 'viewed', 'code-sent', 'wrong-code', 'signed-out']);
    expect(list.events.find(e => e.shareId === id && e.kind === 'viewed').device).toBe('Safari on iPhone');
    const s = list.shares.find(x => x.id === id);
    expect(s).toMatchObject({ views: 1, sessions: [] });
    expect(s.lastSeenAt).toBeGreaterThan(Date.now() - 60000);
    expect(await view(link, token)).toEqual({ error: 'signed-out' });
  });
  it('keeps junk out of the device label', async () => {
    const { link } = await share('dev@example.com', { backlog: true });
    await server('select public.share_code($1, $2, $3, $4)', [KEY, link, 'dev@example.com', '<script>alert(1)</script>' + 'x'.repeat(100)]);
    const d = (await db.query(`select device from private.share_events where kind = 'code-sent' order by at desc limit 1`)).rows[0].device;
    expect(d).not.toMatch(/[<>]/);
    expect(d.length).toBeLessThanOrEqual(60);
  });
});

describe('the weekly check', () => {
  it('reports sharing as counts, and warns on many wrong codes', async () => {
    const snap = (await db.query('select audit.snapshot() as s')).rows[0].s;
    expect(snap.sharing).toMatchObject({ key_set: true });
    expect(snap.sharing.active).toBeGreaterThan(5);
    const r = evaluate({ primary: snap, backup: { ...snap, sharing: { key_set: false, shares: 0 } }, ownerSha: '' });
    const sharing = r.findings.filter(f => f.check.endsWith(':sharing'));
    expect(sharing).toEqual([expect.objectContaining({ level: 'info', check: 'primary:sharing' })]);
    expect(r.findings.filter(f => f.check.endsWith(':functions'))).toEqual([]);
    const noisy = evaluate({ primary: { ...snap, sharing: { ...snap.sharing, wrong_codes_7d: 12 } }, backup: snap, ownerSha: '' });
    expect(noisy.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warn', check: 'primary:sharing' }),
      expect.objectContaining({ level: 'warn', check: 'backup:sharing' }),
    ]));
  });
});
