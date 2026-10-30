/** What public.pin_status() reports for this session (supabase/migrations/0004, 0007). */
export interface PinStatus {
  signed_in: boolean;
  has_pin?: boolean;
  /** The database will show this session your data right now. */
  unlocked?: boolean;
  /** Seconds since this session used the password / an authenticator code / a passkey; null if never. */
  password_age?: number | null;
  code_age?: number | null;
  passkey_age?: number | null;
  /** How many passkeys you have; null when Supabase can't say. Missing before migration 0007. */
  passkeys?: number | null;
  /** Seconds until this session locks again. */
  seconds_left?: number;
}

export type Step =
  | 'enroll'      // set up the authenticator (first sign-in)
  | 'code'        // authenticator code only (right after a password sign-in)
  | 'create-pin'  // choose a PIN (first sign-in, after the code)
  | 'pin-code'    // PIN + authenticator code: every sign-in after the first
  | 'pin-only'    // PIN again, the code was just given
  | 'password'    // sign in with the password (no PIN yet, or it was erased)
  | 'ready';

/** Choosing a PIN needs a password sign-in this recent. Mirrors set_pin(). */
export const PIN_SETUP_WINDOW_S = 600;
/** A code this recent doesn't need to be typed again for a PIN retry. */
const CODE_REUSE_S = 300;

/**
 * The next sign-in screen.
 * First time on a device: password → code (→ choose a PIN, once). After that: PIN + code, every 24 hours.
 * A passkey sign-in skips all of it for 24 hours: it stands in for the PIN and the code.
 */
export function nextStep(a: { hasFactor: boolean; codeFresh: boolean; status: PinStatus }): Step {
  const s = a.status;
  if (!s.signed_in) return 'password';
  if (s.unlocked && (s.passkey_age ?? Infinity) < 86400) return 'ready';
  if (!a.hasFactor) return 'enroll';
  if (s.unlocked && a.codeFresh) return s.has_pin ? 'ready' : 'create-pin';
  const pwAge = s.password_age ?? Infinity;
  if (!s.has_pin) {
    if (pwAge >= PIN_SETUP_WINDOW_S) return 'password';
    return a.codeFresh ? 'create-pin' : 'code';
  }
  // Signed in with the password today on this device: the code is all that's missing.
  if (pwAge < 86400 && !a.codeFresh) return 'code';
  return a.codeFresh && (s.code_age ?? Infinity) < CODE_REUSE_S ? 'pin-only' : 'pin-code';
}
