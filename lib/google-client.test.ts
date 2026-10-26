import { describe, expect, it } from 'vitest';
import { ACCOUNT_COLORS, MAX_ACCOUNTS, addAccount, mergeCalendars, normalizeAccounts, ownCalendars, sourceIndex, sourceOf, type GoogleAccount } from './google-client';

const conn = (email: string, blob = 'b-' + email) => ({ blob, email, connectedAt: 1 });
const cal = (id: string, o: Partial<GoogleAccount['calendars'][number]> = {}) => ({ id, name: id, color: null, role: 'owner', primary: false, pull: true, ...o });

describe('normalizeAccounts', () => {
  it('moves the old single connection into a list', () => {
    const list = normalizeAccounts({ blob: 'x', email: 'me@gmail.com', connectedAt: 5, pulledAt: 9 });
    expect(list).toEqual([{ id: 'me@gmail.com', blob: 'x', email: 'me@gmail.com', color: ACCOUNT_COLORS[0], connectedAt: 5, pulledAt: 9, show: true, tasks: true, calendars: [], error: null }]);
  });

  it('reads the new shape, drops junk and duplicates', () => {
    const list = normalizeAccounts({ v: 2, accounts: [{ id: 'a', blob: 'x', email: 'a@x' }, { id: 'a', blob: 'y' }, { email: 'no-blob' }, null, { blob: 'z', email: 'b@x', show: false, calendars: [{ id: 'c1', pull: false }, {}] }] });
    expect(list.map(a => a.id)).toEqual(['a', 'b@x']);
    expect(list[1]).toMatchObject({ show: false, color: ACCOUNT_COLORS[1], calendars: [{ id: 'c1', name: 'c1', pull: false }] });
    expect(normalizeAccounts(null)).toEqual([]);
  });
});

describe('addAccount', () => {
  it('appends new accounts with unused colours', () => {
    let { list } = addAccount([], conn('a@x'));
    ({ list } = addAccount(list, conn('b@x')));
    expect(list.map(a => [a.id, a.color])).toEqual([['a@x', ACCOUNT_COLORS[0]], ['b@x', ACCOUNT_COLORS[1]]]);
  });

  it('swaps the token in for an account that reconnects, keeping its choices', () => {
    const start = normalizeAccounts({ accounts: [{ id: 'a@x', email: 'a@x', blob: 'old', color: '#123456', show: false, error: 'revoked' }] });
    const { list, account } = addAccount(start, conn('a@x', 'new'));
    expect(list).toHaveLength(1);
    expect(account).toMatchObject({ blob: 'new', color: '#123456', show: false, error: null });
  });

  it(`stops at ${MAX_ACCOUNTS} accounts`, () => {
    let list: GoogleAccount[] = [];
    for (let i = 0; i < MAX_ACCOUNTS; i++) list = addAccount(list, conn(`u${i}@x`)).list;
    expect(addAccount(list, conn('extra@x'))).toEqual({ list, account: null });
  });
});

describe('calendars', () => {
  it('keeps your choices and takes Google’s names and colours', () => {
    const merged = mergeCalendars([cal('hol', { pull: true }), cal('gone')], [
      { id: 'hol', name: 'Holidays', color: '#16a765', role: 'reader', primary: false, pulled: false },
      { id: 'me@x', name: 'Me', color: '#9fe1e7', role: 'owner', primary: true, pulled: true },
    ]);
    expect(merged).toEqual([
      { id: 'me@x', name: 'Me', color: '#9fe1e7', role: 'owner', primary: true, pull: true },
      { id: 'hol', name: 'Holidays', color: '#16a765', role: 'reader', primary: false, pull: true },
    ]);
  });

  it('maps pulled events back to their account, before and after the first pull', () => {
    const accts = normalizeAccounts({ accounts: [
      { id: 'a', email: 'a@x', blob: '1', calendars: [cal('a@x'), cal('team')] },
      { id: 'b', email: 'b@x', blob: '2', calendars: [cal('team'), cal('b@x')] },
      { id: 'c', email: 'c@x', blob: '3' },
    ] });
    const idx = sourceIndex(accts);
    expect(sourceOf(idx, 'gcal:team:e1')?.account.id).toBe('a');
    expect(sourceOf(idx, 'gcal:b@x:e1')?.account.id).toBe('b');
    expect(sourceOf(idx, 'gcal:c@x:e1')).toMatchObject({ calendar: null });
    expect(sourceOf(idx, 'gcal:c@x:e1')?.account.id).toBe('c');
    expect(sourceOf(idx, 'gtask:1')).toBeNull();
    expect([...ownCalendars(accts, 'b')]).toEqual(['b@x']);
  });

  it('credits a shared calendar to the account that pulls it, and its owner, not whoever is listed first', () => {
    // Work (connected first) can read the personal calendar; the personal account owns and pulls it.
    const accts = normalizeAccounts({ accounts: [
      { id: 'work', email: 'w@x', blob: '1', calendars: [cal('w@x', { primary: true }), cal('me@gmail.com', { role: 'reader', pull: false })] },
      { id: 'me', email: 'me@gmail.com', blob: '2', calendars: [cal('me@gmail.com', { primary: true })] },
    ] });
    const src = sourceOf(sourceIndex(accts), 'gcal:me@gmail.com:e1');
    expect(src?.account.id).toBe('me');
    expect(src?.calendar?.pull).toBe(true);
    expect([...ownCalendars(accts, 'me')]).toEqual(['me@gmail.com']);
    expect([...ownCalendars(accts, 'work')]).toEqual(['w@x']);
  });
});
