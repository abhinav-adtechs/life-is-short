import type { SupabaseClient } from '@supabase/supabase-js';
import { sideClient, supabase } from './supabase';

/**
 * Face ID on iPhone and iPad, instead of the authenticator code: a passkey for this account, kept in iCloud Keychain.
 * To unlock, the app signs in with the passkey on the side; that sign-in vouches for this device's own session in the
 * database, then signs out (supabase/migrations/0007 says why). The PIN is still asked for on top.
 * Supabase only lets a session that passed a code add a passkey.
 *
 * Each challenge is fetched before the tap, so the tap goes straight to Face ID: Safari only shows it from a tap.
 */

/** An iPhone or iPad. iPadOS asks for desktop sites, so it says it's a Mac; a Mac has no touch screen. */
export function isIPhoneOrIPad(nav: { userAgent: string; maxTouchPoints?: number } | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  return /\b(iPhone|iPad|iPod)\b/.test(nav.userAgent) || (/\bMacintosh\b/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
}

/** 'iPhone' or 'iPad', for the words on screen. */
export const deviceName = (nav: { userAgent: string } = globalThis.navigator) => (/\b(iPhone|iPod)\b/.test(nav.userAgent) ? 'iPhone' : 'iPad');

/** This is an iPhone or iPad, and its browser can use its built-in Face ID passkeys here. */
export async function canUseFaceId(): Promise<boolean> {
  if (!isIPhoneOrIPad() || typeof PublicKeyCredential === 'undefined') return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

/* ---------- WebAuthn options and answers travel as JSON, with binary fields in base64url ---------- */

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')), c => c.charCodeAt(0));
}

export function toB64url(b: ArrayBuffer | ArrayBufferView): string {
  const bytes = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The rest of each options object (rp, pubKeyCredParams, timeout...) passes through as it came.
interface CredentialRef { id: string; type: string; transports?: string[] }
export interface RequestJSON { challenge: string; allowCredentials?: CredentialRef[] }
export interface CreationJSON { challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: CredentialRef[] }

const credentialRef = (c: CredentialRef) => ({ ...c, id: fromB64url(c.id) });

export function requestOptions(o: RequestJSON): PublicKeyCredentialRequestOptions {
  return { ...o, challenge: fromB64url(o.challenge), allowCredentials: o.allowCredentials?.map(credentialRef) } as unknown as PublicKeyCredentialRequestOptions;
}

export function creationOptions(o: CreationJSON): PublicKeyCredentialCreationOptions {
  return {
    ...o, challenge: fromB64url(o.challenge), user: { ...o.user, id: fromB64url(o.user.id) },
    excludeCredentials: o.excludeCredentials?.map(credentialRef),
  } as unknown as PublicKeyCredentialCreationOptions;
}

const BINARY = ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle', 'attestationObject'] as const;
type Answer = Parameters<SupabaseClient['auth']['passkey']['verifyAuthentication']>[0]['credential'];

/** A new or used passkey's answer, as Supabase reads it (what toJSON() gives, where Safari doesn't have it). */
export function credentialJSON(c: Pick<PublicKeyCredential, 'id' | 'rawId' | 'type' | 'response' | 'getClientExtensionResults'> & { authenticatorAttachment?: string | null }): Answer {
  const r = c.response as unknown as Partial<Record<(typeof BINARY)[number], ArrayBuffer | null>> & { getTransports?: () => string[] };
  const response: Record<string, unknown> = {};
  for (const k of BINARY) if (r[k]) response[k] = toB64url(r[k]);
  if (typeof r.getTransports === 'function') response.transports = r.getTransports();
  return {
    id: c.id, rawId: toB64url(c.rawId), type: c.type, response,
    clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment ?? undefined,
  } as unknown as Answer;
}

/** What to say when Face ID didn't go through. */
export function faceIdError(e: { name?: string; code?: string; status?: number } | null | undefined): string {
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return 'Face ID was cancelled or didn’t recognise you. Try again, or use a code.';
  if (e?.name === 'InvalidStateError' || e?.code === 'webauthn_credential_exists') return 'Face ID is already set up on this device.';
  if (e?.code === 'webauthn_credential_not_found') return 'Face ID was turned off for this account. Use a code, then set it up again in Settings.';
  if (e?.code === 'passkey_disabled') return 'Face ID isn’t switched on for this app yet: turn on passkeys in Supabase (see docs/setup.md).';
  if (e?.code === 'insufficient_aal') return 'Unlock with your authenticator code first, then set up Face ID.';
  if (e?.code === 'webauthn_challenge_expired' || e?.code === 'webauthn_challenge_not_found') return 'That took too long. Try again.';
  if (e?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  return 'Face ID didn’t work. Try again, or use a code.';
}

/* ---------- unlocking, and setting it up ---------- */

export interface Challenge<T> { id: string; publicKey: T; expires: number }

const fresh = <T>(c: Challenge<T> | null): c is Challenge<T> => !!c && c.expires * 1000 > Date.now() + 10_000;

/** A sign-in challenge for the unlock screen. Anyone can ask for one; only your passkey can answer it. */
export async function unlockChallenge(): Promise<Challenge<PublicKeyCredentialRequestOptions> | null> {
  try {
    const { data } = await supabase().auth.passkey.startAuthentication();
    return data ? { id: data.challenge_id, publicKey: requestOptions(data.options), expires: data.expires_at } : null;
  } catch {
    return null;
  }
}

/** Face ID is set up for this account, and this device can use it. */
export async function faceIdReady(): Promise<boolean> {
  if (!(await canUseFaceId())) return false;
  const { data } = await supabase().auth.passkey.list();
  return !!data?.length;
}

/**
 * Face ID, then this device's session counts as having passed it for 24 hours. Returns an error message, or null.
 * Pass the challenge fetched before the tap; an expired one is fetched again (Safari may then want a second tap).
 */
export async function unlockWithFaceId(ready: Challenge<PublicKeyCredentialRequestOptions> | null): Promise<string | null> {
  try {
    const c = fresh(ready) ? ready : await unlockChallenge();
    if (!c) return 'Couldn’t reach your account. Check your connection and try again.';
    const cred = await navigator.credentials.get({ publicKey: c.publicKey }) as PublicKeyCredential | null;
    if (!cred) return faceIdError(null);
    const { data: own } = await supabase().auth.getClaims();
    const session = own?.claims.session_id;
    if (!session) return 'You’re signed out. Sign in with your password.';
    const side = sideClient();
    const { error } = await side.auth.passkey.verifyAuthentication({ challengeId: c.id, credential: credentialJSON(cred) });
    if (error) return faceIdError(error);
    const { data } = await side.rpc('face_id_unlock', { p_session: session });
    await side.auth.signOut({ scope: 'local' });
    if (data === 'ok') return null;
    // Only a sign-in that once passed a code can be renewed this way.
    return data === 'not-this-session' ? 'Face ID can’t unlock this sign-in yet. Use a code this time.' : faceIdError(null);
  } catch (e) {
    return faceIdError(e as { name?: string });
  }
}

/** Step one of setting it up: ask Supabase for a passkey to make. Only a session that passed a code gets one. */
export async function setupChallenge(): Promise<{ challenge: Challenge<PublicKeyCredentialCreationOptions> } | { error: string }> {
  const { data, error } = await supabase().auth.passkey.startRegistration();
  if (!data) return { error: faceIdError(error) };
  return { challenge: { id: data.challenge_id, publicKey: creationOptions(data.options), expires: data.expires_at } };
}

/** Step two, from a tap: Face ID makes the passkey and Supabase keeps its public half. Returns an error message, or null. */
export async function setUpFaceId(c: Challenge<PublicKeyCredentialCreationOptions>): Promise<string | null> {
  if (!fresh(c)) return faceIdError({ code: 'webauthn_challenge_expired' });
  try {
    const cred = await navigator.credentials.create({ publicKey: c.publicKey }) as PublicKeyCredential | null;
    if (!cred) return faceIdError(null);
    const { error } = await supabase().auth.passkey.verifyRegistration({ challengeId: c.id, credential: credentialJSON(cred) });
    return error ? faceIdError(error) : null;
  } catch (e) {
    return faceIdError(e as { name?: string });
  }
}
