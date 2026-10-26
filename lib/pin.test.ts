import { describe, expect, it } from 'vitest';
import { nextStep } from './pin';

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

  it('never shows data the database would refuse', () => {
    expect(nextStep({ hasFactor: true, codeFresh: false, status: { ...base, unlocked: true } })).not.toBe('ready');
    expect(nextStep({ hasFactor: true, codeFresh: true, status: { signed_in: false } })).toBe('password');
  });
});
