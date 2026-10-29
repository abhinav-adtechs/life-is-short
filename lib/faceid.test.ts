import { describe, expect, it } from 'vitest';
import { credentialJSON, creationOptions, deviceName, faceIdError, fromB64url, isIPhoneOrIPad, requestOptions, toB64url } from './faceid';

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

  it('names the device', () => {
    expect(deviceName({ userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) ${SAFARI}` })).toBe('iPhone');
    expect(deviceName({ userAgent: `Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) ${SAFARI}` })).toBe('iPad');
    expect(deviceName({ userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI}` })).toBe('iPad');
  });

  it('leaves everything else out', () => {
    expect(isIPhoneOrIPad({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36', maxTouchPoints: 5 })).toBe(false);
    expect(isIPhoneOrIPad({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36', maxTouchPoints: 10 })).toBe(false);
    expect(isIPhoneOrIPad(undefined)).toBe(false);
  });
});

describe('base64url', () => {
  it('round-trips every length, without padding', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n * 11) % 256);
      const s = toB64url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect([...fromB64url(s)]).toEqual([...bytes]);
    }
    expect(toB64url(Uint8Array.from([251, 255, 191]).buffer)).toBe('-_-_');
  });
});

describe('WebAuthn options from Supabase', () => {
  it('turns the binary fields into bytes and keeps the rest', () => {
    const o = requestOptions({ challenge: 'AQID', allowCredentials: [{ id: 'BAU', type: 'public-key' }], ...{ rpId: 'plan.example', userVerification: 'preferred', timeout: 60000 } });
    expect([...(o.challenge as Uint8Array)]).toEqual([1, 2, 3]);
    expect([...(o.allowCredentials![0].id as Uint8Array)]).toEqual([4, 5]);
    expect(o).toMatchObject({ rpId: 'plan.example', userVerification: 'preferred', timeout: 60000 });
    // A passkey sign-in names no credential: the device offers its own.
    expect(requestOptions({ challenge: 'AQID' }).allowCredentials).toBeUndefined();
  });

  it('does the same for a new passkey, including the account id', () => {
    const o = creationOptions({
      challenge: 'AQID', user: { id: 'MTIz', name: 'me@example.com', displayName: 'me@example.com' },
      excludeCredentials: [{ id: 'BAU', type: 'public-key', transports: ['internal'] }],
      ...{ rp: { id: 'plan.example', name: 'Life is short' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] },
    });
    expect(new TextDecoder().decode(o.user.id as Uint8Array)).toBe('123');
    expect(o.user.name).toBe('me@example.com');
    expect([...(o.excludeCredentials![0].id as Uint8Array)]).toEqual([4, 5]);
    expect(o.excludeCredentials![0].transports).toEqual(['internal']);
    expect(o.rp).toEqual({ id: 'plan.example', name: 'Life is short' });
  });
});

describe('credentialJSON', () => {
  const buf = (...b: number[]) => Uint8Array.from(b).buffer;
  const base = { id: 'AQI', rawId: buf(1, 2), type: 'public-key', getClientExtensionResults: () => ({}), authenticatorAttachment: 'platform' };

  it('sends a Face ID answer with everything Supabase checks', () => {
    const response = { clientDataJSON: buf(123, 125), authenticatorData: buf(9), signature: buf(48, 69), userHandle: buf(117) };
    expect(credentialJSON({ ...base, response } as never)).toEqual({
      id: 'AQI', rawId: 'AQI', type: 'public-key',
      response: { clientDataJSON: 'e30', authenticatorData: 'CQ', signature: 'MEU', userHandle: 'dQ' },
      clientExtensionResults: {}, authenticatorAttachment: 'platform',
    });
  });

  it('sends a new passkey with its transports, and drops what is missing', () => {
    const response = { clientDataJSON: buf(123, 125), attestationObject: buf(163), getTransports: () => ['internal', 'hybrid'] };
    const json = credentialJSON({ ...base, authenticatorAttachment: null, response } as never) as unknown as { response: object; authenticatorAttachment?: string };
    expect(json.response).toEqual({ clientDataJSON: 'e30', attestationObject: 'ow', transports: ['internal', 'hybrid'] });
    expect(json.authenticatorAttachment).toBeUndefined();
    const noHandle = credentialJSON({ ...base, response: { clientDataJSON: buf(1), authenticatorData: buf(2), signature: buf(3), userHandle: null } } as never) as unknown as { response: object };
    expect(noHandle.response).not.toHaveProperty('userHandle');
  });
});

describe('faceIdError', () => {
  it('says what happened in plain words', () => {
    expect(faceIdError({ name: 'NotAllowedError' })).toMatch(/cancelled/);
    expect(faceIdError({ name: 'InvalidStateError' })).toMatch(/already set up/);
    expect(faceIdError({ code: 'passkey_disabled' })).toMatch(/passkeys in Supabase/);
    expect(faceIdError({ code: 'insufficient_aal' })).toMatch(/authenticator code first/);
    expect(faceIdError({ code: 'webauthn_challenge_expired' })).toMatch(/too long/);
    expect(faceIdError({ code: 'webauthn_credential_not_found' })).toMatch(/turned off/);
    expect(faceIdError({ status: 429 })).toMatch(/Too many/);
    expect(faceIdError(null)).toMatch(/didn’t work/);
  });
});
