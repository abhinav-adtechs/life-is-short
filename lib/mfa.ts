/** How long one authenticator code keeps the planner unlocked. Mirrored in SQL by private.mfa_fresh(). */
export const MFA_WINDOW_S = 24 * 3600;

interface Claims { aal?: unknown; amr?: unknown }

/** Unix seconds of the last authenticator-code check in a session's `amr`, or null if there wasn't one. */
export function lastCodeAt(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let last: number | null = null;
  for (const e of amr) {
    if (!e || typeof e !== 'object') continue;
    const { method, timestamp } = e as { method?: unknown; timestamp?: unknown };
    if (method === 'totp' && typeof timestamp === 'number' && (last == null || timestamp > last)) last = timestamp;
  }
  return last;
}

/**
 * 'fresh' when the session passed 2FA (aal2) with a code in the last 24 hours.
 * 'stale' when it needs a new code; the password isn't asked for again.
 */
export function mfaState(claims: Claims, nowS = Math.floor(Date.now() / 1000)): 'fresh' | 'stale' {
  const at = lastCodeAt(claims.amr);
  return claims.aal === 'aal2' && at != null && nowS - at < MFA_WINDOW_S ? 'fresh' : 'stale';
}

/** Milliseconds until the current code expires (0 if it already has). */
export function msUntilStale(amr: unknown, nowMs = Date.now()): number {
  const at = lastCodeAt(amr);
  return at == null ? 0 : Math.max(0, (at + MFA_WINDOW_S) * 1000 - nowMs);
}
