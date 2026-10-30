import { describe, expect, it } from 'vitest';
import { faceIdError, isIPhoneOrIPad } from './faceid';

const SAFARI = 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5';

describe('isIPhoneOrIPad', () => {
  it('knows iPhones and iPads, in any iOS browser', () => {
    expect(isIPhoneOrIPad({ userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) ${SAFARI} Mobile/15E148 Safari/604.1`, maxTouchPoints: 5 })).toBe(true);
    expect(isIPhoneOrIPad({ userAgent: `Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) ${SAFARI} Mobile/15E148 Safari/604.1`, maxTouchPoints: 5 })).toBe(true);
    expect(isIPhoneOrIPad({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1' })).toBe(true);
  });

  it('knows an iPad asking for the desktop site, which says it is a Mac, by its touch screen', () => {
    const ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI} Safari/605.1.15`;
    expect(isIPhoneOrIPad({ userAgent: ua, maxTouchPoints: 5 })).toBe(true);
    expect(isIPhoneOrIPad({ userAgent: ua, maxTouchPoints: 0 })).toBe(false);
  });

  it('leaves everything else out', () => {
    expect(isIPhoneOrIPad({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36', maxTouchPoints: 5 })).toBe(false);
    expect(isIPhoneOrIPad({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36', maxTouchPoints: 10 })).toBe(false);
    expect(isIPhoneOrIPad(undefined)).toBe(false);
  });
});

describe('faceIdError', () => {
  it('says what happened in plain words', () => {
    expect(faceIdError({ name: 'NotAllowedError' })).toMatch(/cancelled/);
    expect(faceIdError({ code: 'passkey_disabled' })).toMatch(/passkeys in Supabase/);
    expect(faceIdError({ code: 'webauthn_challenge_expired' })).toMatch(/too long/);
    expect(faceIdError({ code: 'webauthn_credential_not_found' })).toMatch(/removed from your account/);
    expect(faceIdError({ status: 429 })).toMatch(/Too many/);
    expect(faceIdError(null)).toMatch(/didn’t work/);
  });
});
