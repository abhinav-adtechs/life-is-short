'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { localRepo } from '@/lib/repo/local';
import { supabaseRepo } from '@/lib/repo/supabase';
import { hasSupabase, supabase } from '@/lib/supabase';
import { mfaState } from '@/lib/mfa';
import { nextStep, type PinStatus } from '@/lib/pin';
import Planner from './Planner';
import { CodeCheck, CreatePin, EnrollTotp, PinUnlock, Shell, SignIn } from './Auth';

type State =
  | { phase: 'boot' }
  | { phase: 'signin'; notice?: string }
  | { phase: 'enroll' }
  | { phase: 'code'; factorId: string; email: string | null }
  | { phase: 'create-pin' }
  | { phase: 'pin'; factorId: string; email: string | null; codeDone: boolean; passkeys: number | null }
  | { phase: 'error' }
  | { phase: 'ready'; repo: TaskRepo; email: string | null; userId: string | null };

/**
 * Sign-in gate. First time on a device: password, then an authenticator code, then (once) choose a PIN.
 * After that, every 24 hours: the PIN and an authenticator code, never the password. Or a passkey, any time,
 * which stands in for all of it.
 * The database enforces the same rule (supabase/migrations/0004, 0007), so this is the friendly front of it.
 */
export default function App() {
  const [state, setState] = useState<State>({ phase: 'boot' });
  const repoRef = useRef<{ userId: string; repo: TaskRepo } | null>(null);
  const lockTimer = useRef(0);

  const check = useCallback(async () => {
    const sb = supabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { repoRef.current = null; setState(s => ({ phase: 'signin', notice: s.phase === 'signin' ? s.notice : undefined })); return; }
    const [{ data: aal }, { data: factors }, { data: status, error }] = await Promise.all([
      sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors(), sb.rpc('pin_status'),
    ]);
    if (error || !status) { setState({ phase: 'error' }); return; }
    const totp = factors?.totp.find(f => f.status === 'verified');
    const codeFresh = !!aal && mfaState({ aal: aal.currentLevel, amr: aal.currentAuthenticationMethods }) === 'fresh';
    const st = status as PinStatus;
    const step = nextStep({ hasFactor: !!totp, codeFresh, status: st });
    const email = session.user.email ?? null;
    clearTimeout(lockTimer.current);
    switch (step) {
      case 'enroll': setState({ phase: 'enroll' }); return;
      case 'code': setState({ phase: 'code', factorId: totp!.id, email }); return;
      case 'create-pin': setState({ phase: 'create-pin' }); return;
      case 'pin-code': case 'pin-only':
        setState({ phase: 'pin', factorId: totp!.id, email, codeDone: step === 'pin-only', passkeys: st.passkeys ?? null });
        return;
      case 'password':
        await sb.auth.signOut();
        setState({ phase: 'signin', notice: st.passkeys ? 'Sign in again with your passkey, or with your password to set up a PIN.' : 'Sign in with your password to set up your PIN.' });
        return;
    }
    if (repoRef.current?.userId !== session.user.id) repoRef.current = { userId: session.user.id, repo: supabaseRepo(sb, session.user.id) };
    setState({ phase: 'ready', repo: repoRef.current.repo, email, userId: session.user.id });
    // Lock again the moment the 24 hours run out.
    const left = Number(st.seconds_left ?? 0);
    lockTimer.current = window.setTimeout(check, Math.min(left * 1000 + 1000, 2 ** 31 - 1));
  }, []);

  useEffect(() => {
    if (!hasSupabase()) { setState({ phase: 'ready', repo: localRepo(), email: null, userId: null }); return; }
    const sb = supabase();
    check();
    const { data: sub } = sb.auth.onAuthStateChange(event => {
      // Token refreshes don't change who you are or how fresh your code is.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
      // Supabase calls must not run inside this callback; defer them.
      setTimeout(check, 0);
    });
    // Phones pause timers in the background; re-check when the app comes back.
    const vis = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { sub.subscription.unsubscribe(); document.removeEventListener('visibilitychange', vis); clearTimeout(lockTimer.current); };
  }, [check]);

  const signOut = () => { supabase().auth.signOut(); };
  const locked = async () => {
    // Five wrong PINs erased it: end every session and start again from the password.
    await supabase().auth.signOut({ scope: 'global' });
    setState({ phase: 'signin', notice: 'Too many wrong PINs. Sign in with your password and choose a new PIN.' });
  };

  switch (state.phase) {
    case 'boot': return <div className="boot" />;
    case 'signin': return <SignIn notice={state.notice} />;
    case 'enroll': return <EnrollTotp onSignOut={signOut} />;
    case 'code': return <CodeCheck factorId={state.factorId} email={state.email} onSignOut={signOut} />;
    case 'create-pin': return <CreatePin onDone={check} onSignOut={signOut} />;
    case 'pin': return <PinUnlock factorId={state.factorId} email={state.email} codeDone={state.codeDone} passkeys={state.passkeys} onDone={check} onLocked={locked} onSignOut={signOut} />;
    case 'error': return (
      <Shell title="Can’t reach your account">
        <p className="nm">Check your connection and try again.</p>
        <button type="button" className="btn pri" onClick={check}>Try again</button>
      </Shell>
    );
    default: return <Planner key={state.userId ?? 'local'} repo={state.repo} email={state.email} />;
  }
}
