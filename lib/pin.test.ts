import { describe, expect, it } from 'vitest';
import { nextStep, unlockWays } from './pin';

const base = { signed_in: true, has_pin: true, unlocked: false, password_age: 200000, code_age: 200000 };

describe('nextStep', () => {
  it('first sign-in: password → authenticator setup → code → choose a PIN → in', () => {
    expect(nextStep({ hasFactor: false, codeFresh: false, status: { ...base, has_pin: false, password_age: 5 } })).toBe('enroll');
    expect(nextStep({ hasFactor: true, codeFresh: false, status: { ...base, has_pin: false, password_age: 30 } })).toBe('code');
    expect(nextStep({ hasFactor: true, codeFresh: true, status: { ...base, has_pin: false, unlocked: true, password_age: 40, code_age: 2 } })).toBe('create-pin');
    expect(nextStep({ hasFactor: true, codeFresh: true, status: { ...base, unlocked: true, password_age: 45, code_age: 5 } })).toBe('ready');
  });

  it('every later sign-in asks for the PIN and a code, not the password', () => {
    expect(nextStep({ hasFactor: true, codeFresh: false, status: base })).toBe('pin-code');
  });

  it('a wrong PIN right after a code asks for the PIN only', () => {
    expect(nextStep({ hasFactor: true, codeFresh: true, status: { ...base, code_age: 20 } })).toBe('pin-only');
    expect(nextStep({ hasFactor: true, codeFresh: true, status: { ...base, code_age: 900 } })).toBe('pin-code');
  });

  it('a password sign-in on a new device needs just the code', () => {
    expect(nextStep({ hasFactor: true, codeFresh: false, status: { ...base, password_age: 10 } })).toBe('code');
  });

  it('with no PIN (never set, or erased after 5 wrong tries) it falls back to the password', () => {
    expect(nextStep({ hasFactor: true, codeFresh: true, status: { ...base, has_pin: false } })).toBe('password');
  });

  it('a passkey sign-in goes straight in for 24 hours, no PIN or code', () => {
    const pk = { ...base, unlocked: true, passkey_age: 30, password_age: null, code_age: null };
    expect(nextStep({ hasFactor: true, codeFresh: false, status: pk })).toBe('ready');
    // Even with no PIN left: five wrong ones erased it, and the passkey still works.
    expect(nextStep({ hasFactor: true, codeFresh: false, status: { ...pk, has_pin: false } })).toBe('ready');
    // A day later it locks like any other session, and the PIN and code (or a passkey again) open it.
    expect(nextStep({ hasFactor: true, codeFresh: false, status: { ...pk, unlocked: false, passkey_age: 90000 } })).toBe('pin-code');
  });

  it('never shows data the database would refuse', () => {
    expect(nextStep({ hasFactor: true, codeFresh: false, status: { ...base, unlocked: false, passkey_age: 30 } })).not.toBe('ready');
    expect(nextStep({ hasFactor: true, codeFresh: false, status: { ...base, unlocked: true } })).not.toBe('ready');
    expect(nextStep({ hasFactor: true, codeFresh: true, status: { signed_in: false } })).toBe('password');
  });
});

describe('unlockWays', () => {
  it('leads with the quickest way you have, and always keeps the PIN and a code', () => {
    expect(unlockWays({ passkey: true, faceId: true, codeDone: false })).toEqual(['passkey', 'pin-face-id', 'pin-code']);
    expect(unlockWays({ passkey: true, faceId: false, codeDone: false })).toEqual(['passkey', 'pin-code']);
    expect(unlockWays({ passkey: false, faceId: true, codeDone: false })).toEqual(['pin-face-id', 'pin-code']);
    expect(unlockWays({ passkey: false, faceId: false, codeDone: false })).toEqual(['pin-code']);
  });

  it('asks only for the PIN once a code was just given', () => {
    expect(unlockWays({ passkey: true, faceId: true, codeDone: true })).toEqual(['pin-code']);
  });
});
