import type { SupabaseClient } from '@supabase/supabase-js';
import { native } from './native';

/**
 * Passkeys: Face ID, Touch ID, Windows Hello, a phone or a security key instead of the PIN and the authenticator code.
 * Supabase Auth keeps and checks them (`supabase.auth.passkey`); the database lets a passkey session in for 24 hours
 * (supabase/migrations/0007). Here: the browser's side of the ceremonies, always asking the device to check it's you.
 *
 * Supabase only *prefers* that check; a passkey without it would be the device alone. So the options are rewritten to
 * require it: a security key without a PIN can't be added, and every sign-in asks for the face, finger or device PIN.
 */

/* ---------- bytes ---------- */

export function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function toB64url(b: ArrayBuffer | ArrayBufferView): string {
  const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let bin = '';
  for (const x of u) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- options in, credentials out ---------- */

interface DescriptorJSON { id: string; type?: string; transports?: string[] }
type JSONObject = Record<string, unknown>;

// The server sends the WebAuthn options as JSON: binary fields as base64url, sometimes inside `publicKey`.
const unwrap = (json: unknown): JSONObject => {
  const o = (json ?? {}) as JSONObject;
  return (o.publicKey && typeof o.publicKey === 'object' ? o.publicKey : o) as JSONObject;
};
const descriptors = (list: unknown) => (Array.isArray(list) ? (list as DescriptorJSON[]) : [])
  .map(d => ({ ...d, type: 'public-key' as const, id: fromB64url(d.id) }));

/** Registration options for navigator.credentials.create(): a passkey that names the account, and checks it's you. */
export function creationOptions(json: unknown): PublicKeyCredentialCreationOptions {
  const o = unwrap(json);
  const user = o.user as { id: string; name: string; displayName: string };
  return {
    ...o,
    challenge: fromB64url(o.challenge as string),
    user: { ...user, id: fromB64url(user.id) },
    excludeCredentials: descriptors(o.excludeCredentials),
    authenticatorSelection: {
      ...(o.authenticatorSelection as AuthenticatorSelectionCriteria | undefined),
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
  } as PublicKeyCredentialCreationOptions;
}

/** Sign-in options for navigator.credentials.get(), always checking it's you. */
export function requestOptions(json: unknown): PublicKeyCredentialRequestOptions {
  const o = unwrap(json);
  return {
    ...o,
    challenge: fromB64url(o.challenge as string),
    allowCredentials: descriptors(o.allowCredentials),
    userVerification: 'required',
  } as PublicKeyCredentialRequestOptions;
}

type ServerCredential = Parameters<SupabaseClient['auth']['passkey']['verifyRegistration']>[0]['credential'];

const common = (c: PublicKeyCredential) => ({
  id: c.id,
  rawId: toB64url(c.rawId),
  type: 'public-key' as const,
  clientExtensionResults: c.getClientExtensionResults(),
  authenticatorAttachment: (c.authenticatorAttachment ?? undefined) as AuthenticatorAttachment | undefined,
});

/** A new passkey, as the server reads it. */
export function registrationJSON(c: PublicKeyCredential): ServerCredential {
  const r = c.response as AuthenticatorAttestationResponse;
  return {
    ...common(c),
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      attestationObject: toB64url(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : undefined,
    },
  } as ServerCredential;
}

/** A passkey's answer to a sign-in challenge, as the server reads it. */
export function authenticationJSON(c: PublicKeyCredential): ServerCredential {
  const r = c.response as AuthenticatorAssertionResponse;
  return {
    ...common(c),
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature),
      userHandle: r.userHandle ? toB64url(r.userHandle) : undefined,
    },
  } as ServerCredential;
}

/* ---------- what can go wrong ---------- */

export type PasskeyProblem =
  | 'unsupported' | 'cancelled' | 'disabled' | 'code-required' | 'exists' | 'too-many' | 'expired' | 'wrong-site' | 'unknown' | 'failed';

export type Outcome<T> = { ok: true; value: T } | { ok: false; problem: PasskeyProblem };

/** What a WebAuthn or Supabase error means for the person in front of it. */
export function problemOf(e: unknown): PasskeyProblem {
  const { name, code, status } = (e ?? {}) as { name?: string; code?: string; status?: number };
  switch (name) {
    // Closed the prompt, or it timed out. In the apps, also a domain the app isn't linked to.
    case 'NotAllowedError': case 'AbortError': return 'cancelled';
    // The device already holds a passkey for this account.
    case 'InvalidStateError': return 'exists';
    // Supabase's relying party ID doesn't cover this address.
    case 'SecurityError': return 'wrong-site';
    case 'NotSupportedError': return 'unsupported';
  }
  switch (code) {
    case 'insufficient_aal': return 'code-required';
    case 'webauthn_credential_exists': return 'exists';
    case 'too_many_passkeys': return 'too-many';
    case 'webauthn_challenge_expired': case 'webauthn_challenge_not_found': return 'expired';
    case 'webauthn_verification_failed': return 'unknown';
  }
  if (status === 404 || /disabled|not_enabled/.test(code ?? '')) return 'disabled';
  return 'failed';
}

/** Words for each problem. Closing the prompt needs none. */
export const PASSKEY_PROBLEMS: Record<PasskeyProblem, string> = {
  unsupported: 'This browser can’t use passkeys.',
  cancelled: '',
  disabled: 'Passkeys aren’t turned on for this planner. They’re switched on in Supabase (see docs/setup.md).',
  'code-required': 'Enter your authenticator code first.',
  exists: 'This device already has a passkey for your account.',
  'too-many': 'You have as many passkeys as Supabase allows. Remove one first.',
  expired: 'That took too long. Try again.',
  'wrong-site': 'Passkeys are set up for another address. Check the relying party ID in Supabase (see docs/setup.md).',
  unknown: 'That passkey didn’t work. It may have been removed from your account.',
  failed: 'Couldn’t use the passkey. Try again.',
};

/* ---------- the ceremonies ---------- */

/**
 * This browser can make and use passkeys. In the iPhone, iPad and Mac apps only when the app is linked to this site
 * (signed with webcredentials for it, docs/apple.md): without that, every prompt fails.
 */
export function passkeysSupported(): boolean {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential !== 'function' || !navigator.credentials) return false;
  const app = native();
  return !app || app.passkeys === true;
}

let enabled: Promise<boolean> | null = null;
/** Whether passkeys are switched on in this Supabase project (its public settings say). Asked once per page. */
export function passkeysEnabled(url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY): Promise<boolean> {
  if (!url || !anon) return Promise.resolve(false);
  enabled ??= fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } })
    .then(r => (r.ok ? r.json() : null))
    .then(s => s?.passkeys_enabled === true)
    .catch(() => { enabled = null; return false; });
  return enabled;
}

/** Make a passkey on this device and add it to your account. Needs a session that passed the code (aal2). */
export async function addPasskey(sb: SupabaseClient): Promise<Outcome<{ id: string; name: string }>> {
  if (!passkeysSupported()) return { ok: false, problem: 'unsupported' };
  try {
    const { data: start, error } = await sb.auth.passkey.startRegistration();
    if (error || !start) return { ok: false, problem: problemOf(error) };
    const credential = await navigator.credentials.create({ publicKey: creationOptions(start.options) });
    if (!credential) return { ok: false, problem: 'cancelled' };
    const { data, error: verifyError } = await sb.auth.passkey.verifyRegistration({
      challengeId: start.challenge_id, credential: registrationJSON(credential as PublicKeyCredential),
    });
    if (verifyError || !data) return { ok: false, problem: problemOf(verifyError) };
    return { ok: true, value: { id: data.id, name: data.friendly_name || 'Passkey' } };
  } catch (e) {
    return { ok: false, problem: problemOf(e) };
  }
}

/**
 * Sign in with a passkey: the device picks the account. Supabase saves the new session and announces SIGNED_IN.
 * `replacing` is the access token of a locked session this one takes over from; it's signed out once the new one is in.
 */
export async function signInWithPasskey(sb: SupabaseClient, replacing?: string): Promise<Outcome<null>> {
  if (!passkeysSupported()) return { ok: false, problem: 'unsupported' };
  try {
    const { data: start, error } = await sb.auth.passkey.startAuthentication();
    if (error || !start) return { ok: false, problem: problemOf(error) };
    const credential = await navigator.credentials.get({ publicKey: requestOptions(start.options) });
    if (!credential) return { ok: false, problem: 'cancelled' };
    const { data, error: verifyError } = await sb.auth.passkey.verifyAuthentication({
      challengeId: start.challenge_id, credential: authenticationJSON(credential as PublicKeyCredential),
    });
    if (verifyError || !data?.session) return { ok: false, problem: problemOf(verifyError) };
    if (replacing) void endSession(replacing);
    return { ok: true, value: null };
  } catch (e) {
    return { ok: false, problem: problemOf(e) };
  }
}

/** Sign one session out on the server, by its access token, without touching the session this page now holds. */
export async function endSession(accessToken: string, url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY): Promise<void> {
  if (!url || !anon) return;
  await fetch(`${url}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${accessToken}` } })
    .catch(() => { /* it was locked anyway; the server drops it in time */ });
}
