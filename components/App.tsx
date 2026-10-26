'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { localRepo } from '@/lib/repo/local';
import { supabaseRepo } from '@/lib/repo/supabase';
import { hasSupabase, supabase } from '@/lib/supabase';
import { mfaState, msUntilStale } from '@/lib/mfa';
import Planner from './Planner';
import { CodeCheck, EnrollTotp, SignIn } from './Auth';

type State =
  | { phase: 'boot' }
  | { phase: 'signin' }
  | { phase: 'enroll' }
  | { phase: 'code'; factorId: string; email: string | null }
  | { phase: 'ready'; repo: TaskRepo; email: string | null; userId: string | null };

/**
 * Sign-in gate: password, then an authenticator code. After that, only the code is asked for,
 * once every 24 hours. The database enforces the same rule (supabase/migrations/0002).
 */
export default function App() {
  const [state, setState] = useState<State>({ phase: 'boot' });
  const repoRef = useRef<{ userId: string; repo: TaskRepo } | null>(null);
  const lockTimer = useRef(0);

  const check = useCallback(async () => {
    const sb = supabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { repoRef.current = null; setState({ phase: 'signin' }); return; }
    const [{ data: aal }, { data: factors }] = await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors()]);
    const totp = factors?.totp.find(f => f.status === 'verified');
    if (!totp) { setState({ phase: 'enroll' }); return; }
    const email = session.user.email ?? null;
    if (!aal || mfaState({ aal: aal.currentLevel, amr: aal.currentAuthenticationMethods }) !== 'fresh') {
      setState({ phase: 'code', factorId: totp.id, email });
      return;
    }
    if (repoRef.current?.userId !== session.user.id) repoRef.current = { userId: session.user.id, repo: supabaseRepo(sb, session.user.id) };
    setState({ phase: 'ready', repo: repoRef.current.repo, email, userId: session.user.id });
    // Lock again the moment the 24 hours run out.
    clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(check, Math.min(msUntilStale(aal.currentAuthenticationMethods) + 1000, 2 ** 31 - 1));
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

  if (state.phase === 'boot') return <div className="boot" />;
  if (state.phase === 'signin') return <SignIn />;
  if (state.phase === 'enroll') return <EnrollTotp onSignOut={signOut} />;
  if (state.phase === 'code') return <CodeCheck factorId={state.factorId} email={state.email} onSignOut={signOut} />;
  return <Planner key={state.userId ?? 'local'} repo={state.repo} email={state.email} />;
}
