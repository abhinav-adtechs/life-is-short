import { describe, expect, it } from 'vitest';
import { MFA_WINDOW_S, lastCodeAt, mfaState, msUntilStale } from './mfa';

const NOW = 1_800_000_000;

describe('mfaState', () => {
  it('is fresh right after a code at aal2', () => {
    expect(mfaState({ aal: 'aal2', amr: [{ method: 'password', timestamp: NOW - 50 }, { method: 'totp', timestamp: NOW - 40 }] }, NOW)).toBe('fresh');
  });

  it('goes stale 24 hours after the last code', () => {
    const amr = [{ method: 'totp', timestamp: NOW - MFA_WINDOW_S }];
    expect(mfaState({ aal: 'aal2', amr }, NOW - 1)).toBe('fresh');
    expect(mfaState({ aal: 'aal2', amr }, NOW)).toBe('stale');
  });

  it('needs a code when only the password was used', () => {
    expect(mfaState({ aal: 'aal1', amr: [{ method: 'password', timestamp: NOW }] }, NOW)).toBe('stale');
  });

  it('does not trust a totp entry without aal2', () => {
    expect(mfaState({ aal: 'aal1', amr: [{ method: 'totp', timestamp: NOW }] }, NOW)).toBe('stale');
  });

  it('uses the most recent code and ignores junk', () => {
    const amr = ['password', null, { method: 'totp', timestamp: NOW - 90000 }, { method: 'totp', timestamp: NOW - 10 }, { method: 'totp', timestamp: 'x' }];
    expect(lastCodeAt(amr)).toBe(NOW - 10);
    expect(mfaState({ aal: 'aal2', amr }, NOW)).toBe('fresh');
    expect(lastCodeAt('nope')).toBeNull();
  });
});

describe('msUntilStale', () => {
  it('counts down to the 24-hour mark', () => {
    expect(msUntilStale([{ method: 'totp', timestamp: NOW }], NOW * 1000 + 1000)).toBe(MFA_WINDOW_S * 1000 - 1000);
    expect(msUntilStale([], NOW * 1000)).toBe(0);
  });
});
