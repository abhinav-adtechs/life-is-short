import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PASSKEY_PROBLEMS, addPasskey, authenticationJSON, creationOptions, endSession, fromB64url, passkeysEnabled, passkeysSupported,
  problemOf, registrationJSON, requestOptions, signInWithPasskey, toB64url,
} from './passkey';

const bytes = (...xs: number[]) => new Uint8Array(xs).buffer;
const list = (b: ArrayBuffer) => [...new Uint8Array(b)];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('base64url', () => {
  it('round-trips any bytes, without padding or + and /', () => {
    for (const xs of [[], [0], [251, 255], [1, 2, 3, 4, 5], Array.from({ length: 100 }, (_, i) => (i * 37) % 256)]) {
      const s = toB64url(new Uint8Array(xs));
      expect(s).not.toMatch(/[+/=]/);
      expect(list(fromB64url(s))).toEqual(xs);
    }
    expect(toB64url(bytes(251, 255))).toBe('-_8');
    expect(list(fromB64url('-_8'))).toEqual([251, 255]);
    expect(toB64url(new Uint8Array([9, 1, 2, 3]).subarray(1))).toBe('AQID');
  });
});

describe('options from the server', () => {
  const creation = {
    challenge: 'AQID', rp: { id: 'plan.example.com', name: 'Life is short' },
    user: { id: 'BAUG', name: 'me@example.com', displayName: 'me@example.com' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 300000,
    excludeCredentials: [{ id: 'BwgJ', type: 'public-key', transports: ['internal'] }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }, attestation: 'none',
  };

  it('a new passkey must name the account and check it’s you', () => {
    const o = creationOptions(creation);
    expect(list(o.challenge as ArrayBuffer)).toEqual([1, 2, 3]);
    expect(list(o.user.id as ArrayBuffer)).toEqual([4, 5, 6]);
    expect(o.user.name).toBe('me@example.com');
    expect(o.rp).toEqual(creation.rp);
    expect(o.excludeCredentials?.map(d => [d.type, list(d.id as ArrayBuffer), d.transports])).toEqual([['public-key', [7, 8, 9], ['internal']]]);
    expect(o.authenticatorSelection).toEqual({ residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
    expect(o.pubKeyCredParams).toEqual(creation.pubKeyCredParams);
  });

  it('reads options wrapped in publicKey too', () => {
    expect(list(creationOptions({ publicKey: creation }).challenge as ArrayBuffer)).toEqual([1, 2, 3]);
    expect(creationOptions({ ...creation, excludeCredentials: undefined, authenticatorSelection: undefined }).authenticatorSelection?.userVerification).toBe('required');
  });

  it('a sign-in always checks it’s you, even when the server only prefers it', () => {
    const o = requestOptions({ challenge: 'CgsM', rpId: 'plan.example.com', userVerification: 'preferred', allowCredentials: [] });
    expect(list(o.challenge as ArrayBuffer)).toEqual([10, 11, 12]);
    expect(o.rpId).toBe('plan.example.com');
    expect(o.userVerification).toBe('required');
    expect(o.allowCredentials).toEqual([]);
  });
});

describe('credentials to the server', () => {
  const credential = (response: object) => ({
    id: 'AQI', rawId: bytes(1, 2), type: 'public-key', authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({ credProps: { rk: true } }), response,
  }) as unknown as PublicKeyCredential;

  it('a new passkey goes as base64url, with its transports', () => {
    const json = registrationJSON(credential({ clientDataJSON: bytes(3), attestationObject: bytes(4, 5), getTransports: () => ['internal', 'hybrid'] }));
    expect(json).toEqual({
      id: 'AQI', rawId: 'AQI', type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: 'Aw', attestationObject: 'BAU', transports: ['internal', 'hybrid'] },
    });
  });

  it('a sign-in goes as base64url, with the account it names', () => {
    const json = authenticationJSON(credential({ clientDataJSON: bytes(3), authenticatorData: bytes(6), signature: bytes(7, 8), userHandle: bytes(9) }));
    expect(json.response).toEqual({ clientDataJSON: 'Aw', authenticatorData: 'Bg', signature: 'Bwg', userHandle: 'CQ' });
    const anon = authenticationJSON(credential({ clientDataJSON: bytes(3), authenticatorData: bytes(6), signature: bytes(7), userHandle: null }));
    expect((anon.response as { userHandle?: string }).userHandle).toBeUndefined();
  });
});

describe('problems', () => {
  it('reads the browser’s errors', () => {
    expect(problemOf(new DOMException('closed', 'NotAllowedError'))).toBe('cancelled');
    expect(problemOf(new DOMException('aborted', 'AbortError'))).toBe('cancelled');
    expect(problemOf(new DOMException('already there', 'InvalidStateError'))).toBe('exists');
    expect(problemOf(new DOMException('rp id', 'SecurityError'))).toBe('wrong-site');
  });

  it('reads Supabase’s errors', () => {
    expect(problemOf({ code: 'insufficient_aal', status: 403 })).toBe('code-required');
    expect(problemOf({ code: 'too_many_passkeys', status: 422 })).toBe('too-many');
    expect(problemOf({ code: 'webauthn_credential_exists' })).toBe('exists');
    expect(problemOf({ code: 'webauthn_challenge_expired' })).toBe('expired');
    expect(problemOf({ code: 'webauthn_verification_failed' })).toBe('unknown');
    expect(problemOf({ status: 404 })).toBe('disabled');
    expect(problemOf(new Error('boom'))).toBe('failed');
    expect(problemOf(null)).toBe('failed');
  });

  it('has words for every problem but closing the prompt', () => {
    for (const [k, v] of Object.entries(PASSKEY_PROBLEMS)) expect(Boolean(v)).toBe(k !== 'cancelled');
  });
});

describe('the ceremonies', () => {
  function browser(credentials: Partial<CredentialsContainer>, lisNative?: object) {
    vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {}, lisNative });
    vi.stubGlobal('navigator', { credentials });
  }
  const options = { challenge: 'AQID', rp: { name: 'L' }, user: { id: 'BAUG', name: 'me', displayName: 'me' }, pubKeyCredParams: [] };
  const made = { id: 'AQI', rawId: bytes(1, 2), getClientExtensionResults: () => ({}), response: { clientDataJSON: bytes(3), attestationObject: bytes(4) } };
  const used = { id: 'AQI', rawId: bytes(1, 2), getClientExtensionResults: () => ({}), response: { clientDataJSON: bytes(3), authenticatorData: bytes(4), signature: bytes(5), userHandle: bytes(6) } };

  it('needs WebAuthn, and inside the apps a link to this site', () => {
    expect(passkeysSupported()).toBe(false);
    browser({});
    expect(passkeysSupported()).toBe(true);
    browser({}, { platform: 'ios' });
    expect(passkeysSupported()).toBe(false);
    browser({}, { platform: 'ios', passkeys: true });
    expect(passkeysSupported()).toBe(true);
  });

  it('adds a passkey: challenge, the device, then the server', async () => {
    const create = vi.fn().mockResolvedValue(made);
    browser({ create });
    const passkey = {
      startRegistration: vi.fn().mockResolvedValue({ data: { challenge_id: 'c1', options, expires_at: 0 }, error: null }),
      verifyRegistration: vi.fn().mockResolvedValue({ data: { id: 'p1', friendly_name: 'iCloud Keychain', created_at: '' }, error: null }),
    };
    const r = await addPasskey({ auth: { passkey } } as never);
    expect(r).toEqual({ ok: true, value: { id: 'p1', name: 'iCloud Keychain' } });
    expect(create.mock.calls[0][0].publicKey.authenticatorSelection.userVerification).toBe('required');
    expect(passkey.verifyRegistration).toHaveBeenCalledWith({ challengeId: 'c1', credential: expect.objectContaining({ id: 'AQI', response: expect.objectContaining({ attestationObject: 'BA' }) }) });
  });

  it('says why it couldn’t, and stops at the first failure', async () => {
    browser({ create: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) });
    const passkey = {
      startRegistration: vi.fn().mockResolvedValue({ data: { challenge_id: 'c1', options }, error: null }),
      verifyRegistration: vi.fn(),
    };
    expect(await addPasskey({ auth: { passkey } } as never)).toEqual({ ok: false, problem: 'cancelled' });
    expect(passkey.verifyRegistration).not.toHaveBeenCalled();
    passkey.startRegistration.mockResolvedValue({ data: null, error: { code: 'insufficient_aal', status: 403 } });
    expect(await addPasskey({ auth: { passkey } } as never)).toEqual({ ok: false, problem: 'code-required' });
  });

  it('signs in, then signs the locked session it replaces out', async () => {
    const get = vi.fn().mockResolvedValue(used);
    browser({ get });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const passkey = {
      startAuthentication: vi.fn().mockResolvedValue({ data: { challenge_id: 'c2', options: { challenge: 'AQID' } }, error: null }),
      verifyAuthentication: vi.fn().mockResolvedValue({ data: { session: { access_token: 'new' }, user: {} }, error: null }),
    };
    expect(await signInWithPasskey({ auth: { passkey } } as never, 'old-token')).toEqual({ ok: true, value: null });
    expect(get.mock.calls[0][0].publicKey.userVerification).toBe('required');
    expect(passkey.verifyAuthentication.mock.calls[0][0].credential.response.userHandle).toBe('Bg');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls[0][0]).toBe('https://db.example.co/auth/v1/logout?scope=local');
    expect(fetch.mock.calls[0][1].headers).toEqual({ apikey: 'anon', Authorization: 'Bearer old-token' });
    vi.unstubAllEnvs();
  });

  it('keeps the locked session when the passkey doesn’t work', async () => {
    browser({ get: vi.fn().mockResolvedValue(used) });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const passkey = {
      startAuthentication: vi.fn().mockResolvedValue({ data: { challenge_id: 'c2', options: { challenge: 'AQID' } }, error: null }),
      verifyAuthentication: vi.fn().mockResolvedValue({ data: null, error: { code: 'webauthn_verification_failed', status: 400 } }),
    };
    expect(await signInWithPasskey({ auth: { passkey } } as never, 'old-token')).toEqual({ ok: false, problem: 'unknown' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the project’s settings', () => {
  it('asks Supabase once whether passkeys are on, and asks again after a failure', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response(JSON.stringify({ passkeys_enabled: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await passkeysEnabled('https://db.example.co', 'anon')).toBe(false);
    expect(await passkeysEnabled('https://db.example.co', 'anon')).toBe(true);
    expect(await passkeysEnabled('https://db.example.co', 'anon')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]).toEqual(['https://db.example.co/auth/v1/settings', { headers: { apikey: 'anon' } }]);
    expect(await passkeysEnabled('', '')).toBe(false);
  });

  it('signs a session out without its refresh token', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    await expect(endSession('tok', 'https://db.example.co', 'anon')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('https://db.example.co/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: 'anon', Authorization: 'Bearer tok' } });
  });
});
