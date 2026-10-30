import { authenticationJSON, passkeysSupported, requestOptions } from './passkey';
import { sideClient, supabase } from './supabase';

/**
 * Face ID on iPhone and iPad: your PIN, then Face ID instead of the authenticator code. Face ID here is one of your
 * passkeys (lib/passkey.ts: add one in Settings → Account). To unlock, the app signs in with the passkey on the side;
 * that sign-in vouches for this device's own session in the database, then signs out (supabase/migrations/0008 says
 * why). The PIN is still asked for on top. A passkey also unlocks on its own (0007); this is the way with the PIN.
 *
 * Each challenge is fetched before the tap, so the tap goes straight to Face ID: Safari only shows it from a tap.
 */

/** An iPhone or iPad. iPadOS asks for desktop sites, so it says it's a Mac; a Mac has no touch screen. */
export function isIPhoneOrIPad(nav: { userAgent: string; maxTouchPoints?: number } | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  return /\b(iPhone|iPad|iPod)\b/.test(nav.userAgent) || (/\bMacintosh\b/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1);
}

/** This is an iPhone or iPad, and it can use its built-in Face ID passkeys here (in the apps, once they're linked to this site). */
export async function canUseFaceId(): Promise<boolean> {
  if (!isIPhoneOrIPad() || !passkeysSupported()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

/** What to say when Face ID didn't go through. */
export function faceIdError(e: { name?: string; code?: string; status?: number } | null | undefined): string {
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return 'Face ID was cancelled or didn’t recognise you. Try again, or use a code.';
  if (e?.code === 'webauthn_credential_not_found') return 'That passkey was removed from your account. Use a code, then add one again in Settings → Account.';
  if (e?.code === 'passkey_disabled') return 'Face ID isn’t switched on for this app yet: turn on passkeys in Supabase (see docs/setup.md).';
  if (e?.code === 'webauthn_challenge_expired' || e?.code === 'webauthn_challenge_not_found') return 'That took too long. Try again.';
  if (e?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  return 'Face ID didn’t work. Try again, or use a code.';
}

/* ---------- unlocking ---------- */

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

/** You have a passkey, and this device can use Face ID with it. */
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
    const { error } = await side.auth.passkey.verifyAuthentication({ challengeId: c.id, credential: authenticationJSON(cred) });
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
