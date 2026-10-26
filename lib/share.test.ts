import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH, DEFAULT_SCOPE, deviceLabel, eventText, isCode, isEmail, isLink, normalizeScope, requestTask, requestWhen, scopeOk, scopeParts,
  shareEnds, shareUrl, suggestionError, todayDays, type ShareRequest,
} from './share';
import { fmtAgo, shortDate } from './format';

// Monday 26 October 2026, 13:30 local.
const NOW = new Date(2026, 9, 26, 13, 30).getTime();
const H = 3600000;

describe('scope', () => {
  it('switches off anything it doesn’t know, like the database', () => {
    expect(normalizeScope(null)).toEqual({ backlog: false, calendar: 'none', google: false, details: 'titles', suggest: false });
    expect(normalizeScope({ backlog: 'yes', calendar: 'everything', google: 1, details: 'all', suggest: true }))
      .toEqual({ backlog: false, calendar: 'none', google: false, details: 'titles', suggest: true });
    expect(normalizeScope(DEFAULT_SCOPE)).toEqual(DEFAULT_SCOPE);
  });

  it('has to show something', () => {
    expect(scopeOk(normalizeScope({ backlog: true }))).toBe(true);
    expect(scopeOk(normalizeScope({ calendar: 'today' }))).toBe(true);
    expect(scopeOk(normalizeScope({ google: true, suggest: true }))).toBe(false);
  });

  it('reads back in plain words', () => {
    expect(scopeParts(DEFAULT_SCOPE)).toEqual(['Backlog', 'Upcoming calendar', 'Google items', 'Can suggest']);
    expect(scopeParts({ backlog: false, calendar: 'today', google: false, details: 'busy', suggest: false })).toEqual(['Today’s calendar', 'Busy only']);
    // Busy only means nothing without the calendar.
    expect(scopeParts({ backlog: true, calendar: 'none', google: false, details: 'busy', suggest: false })).toEqual(['Backlog']);
  });
});

describe('links and emails', () => {
  it('keeps the link secret in the hash', () => {
    expect(shareUrl('https://x.app', 'A'.repeat(32))).toBe(`https://x.app/shared#${'A'.repeat(32)}`);
    expect(isLink('abc-_'.repeat(7))).toBe(true);
    expect(isLink('short')).toBe(false);
    expect(isLink('a'.repeat(31) + '/')).toBe(false);
  });

  it('codes are exactly 8 digits', () => {
    expect(CODE_LENGTH).toBe(8);
    expect(isCode('01234567')).toBe(true);
    expect(isCode('123456')).toBe(false);
    expect(isCode('1234567a')).toBe(false);
    expect(isCode(12345678)).toBe(false);
  });

  it('accepts ordinary emails only', () => {
    expect(isEmail(' Mum@Example.com ')).toBe(true);
    expect(isEmail('mum@example')).toBe(false);
    expect(isEmail('two words@example.com')).toBe(false);
    expect(isEmail(42)).toBe(false);
  });
});

describe('device labels', () => {
  it('names the browser and system, never more', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome on Mac');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge on Windows');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox on Linux');
    expect(deviceLabel('curl/8.0')).toBe('Unknown device');
    expect(deviceLabel(null)).toBe('Unknown device');
  });
});

const req = (over: Partial<ShareRequest> = {}): ShareRequest => ({
  id: '0a1b2c3d-0000-4000-8000-123456789abc', shareId: 's', kind: 'calendar', title: 'Lunch with Priya', note: 'At the usual place',
  start: NOW + 24 * H, minutes: 45, due: null, status: 'pending', createdAt: NOW, decidedAt: null, email: 'mum@example.com', name: 'Mum', ...over,
});

describe('suggestions', () => {
  it('become a task with a fixed id, so approving twice writes it once', () => {
    const t = requestTask(req(), NOW);
    expect(t).toMatchObject({ id: 's0a1b2c3d000040008000123456789abc', title: 'Lunch with Priya', start: NOW + 24 * H, minutes: 45, priority: 2, status: 'open' });
    expect(t.notes).toBe('Suggested by Mum: At the usual place');
    expect(requestTask(req(), NOW + 5000).id).toBe(t.id);
  });

  it('a backlog suggestion waits in the backlog with its due date', () => {
    const t = requestTask(req({ kind: 'backlog', start: null, minutes: null, due: '2026-10-30', note: '', name: '' }), NOW);
    expect(t).toMatchObject({ start: null, minutes: 30, due: '2026-10-30', notes: 'Suggested by mum@example.com' });
  });

  it('say when they’re for', () => {
    expect(requestWhen(req(), NOW)).toBe('Tomorrow, 1:30 PM · 45 min');
    expect(requestWhen(req({ kind: 'backlog', start: null, due: '2026-10-30' }), NOW)).toBe('Backlog · due Friday');
    expect(requestWhen(req({ kind: 'backlog', start: null }), NOW)).toBe('Backlog');
  });

  it('the form checks before sending', () => {
    const base = { kind: 'calendar' as const, title: 'Call', note: '', start: NOW + H, minutes: 30, due: null };
    expect(suggestionError(base, NOW)).toBeNull();
    expect(suggestionError({ ...base, title: '  ' }, NOW)).toBe('Give it a title.');
    expect(suggestionError({ ...base, start: null }, NOW)).toBe('Pick a day and a start time.');
    expect(suggestionError({ ...base, start: NOW - 2 * H }, NOW)).toBe('That time has passed.');
    expect(suggestionError({ ...base, kind: 'backlog', start: null, minutes: null }, NOW)).toBeNull();
  });
});

describe('a today-only share in another time zone', () => {
  // Tests run in Asia/Kolkata. The owner's today in New York (UTC-4) runs 9:30 AM to 9:30 AM here.
  const from = new Date(2026, 9, 26, 9, 30).getTime(), to = from + 24 * H;
  const day = (ms: number) => new Date(ms).getDate();

  it('shows the viewer’s days that have something on', () => {
    expect(todayDays(from, to, [{ start: from + H, minutes: 60 }]).map(d => d.getTime())).toEqual([new Date(2026, 9, 26).getTime()]);
    expect(todayDays(from, to, [{ start: from + H, minutes: 60 }, { start: to - H, minutes: 30 }]).map(d => day(d.getTime()))).toEqual([26, 27]);
  });

  it('with nothing on, the day the owner’s day mostly falls on', () => {
    expect(todayDays(from, to, []).map(d => day(d.getTime()))).toEqual([26]);
    // The same time zone: just today.
    const local = new Date(2026, 9, 26).getTime();
    expect(todayDays(local, local + 24 * H, []).map(d => day(d.getTime()))).toEqual([26]);
  });
});

describe('your view of a share', () => {
  it('says when it ends', () => {
    expect(shareEnds({ expiresAt: null, revokedAt: null }, NOW)).toBe('No end date');
    expect(shareEnds({ expiresAt: NOW + 7 * 24 * H, revokedAt: null }, NOW)).toBe('Ends Mon 2 Nov');
    expect(shareEnds({ expiresAt: NOW - 24 * H, revokedAt: null }, NOW)).toBe('Ended Sun 25 Oct');
    expect(shareEnds({ expiresAt: null, revokedAt: NOW }, NOW)).toBe('Stopped Mon 26 Oct');
    expect(shortDate(new Date(2027, 0, 4).getTime(), NOW)).toBe('Mon 4 Jan 2027');
  });

  it('reads the log in plain words', () => {
    const s = { name: 'Mum', email: 'mum@example.com' };
    expect(eventText({ shareId: 'x', at: NOW, kind: 'viewed', device: '' }, s)).toBe('Mum viewed your planner');
    expect(eventText({ shareId: 'x', at: NOW, kind: 'wrong-code', device: '' }, s)).toBe('Wrong code entered for mum@example.com');
    expect(eventText({ shareId: 'x', at: NOW, kind: 'signed-in', device: '' }, { name: '', email: 'a@b.co' })).toBe('a@b.co signed in');
    expect(eventText({ shareId: 'x', at: NOW, kind: 'signed-in', device: '' }, undefined)).toBe('Someone signed in');
  });

  it('says how long ago', () => {
    expect(fmtAgo(NOW - 20000, NOW)).toBe('just now');
    expect(fmtAgo(NOW - 5 * 60000, NOW)).toBe('5 min ago');
    expect(fmtAgo(NOW - 3 * H, NOW)).toBe('3 h ago');
    expect(fmtAgo(NOW - 50 * H, NOW)).toBe('2 d ago');
  });
});
