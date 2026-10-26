'use client';

import { useEffect, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { localRepo } from '@/lib/repo/local';
import { supabaseRepo } from '@/lib/repo/supabase';
import { hasSupabase, supabase } from '@/lib/supabase';
import Planner from './Planner';
import Login from './Login';

type State =
  | { phase: 'boot' }
  | { phase: 'login' }
  | { phase: 'ready'; repo: TaskRepo; email: string | null; userId: string | null };

export default function App() {
  const [state, setState] = useState<State>({ phase: 'boot' });

  useEffect(() => {
    if (!hasSupabase()) { setState({ phase: 'ready', repo: localRepo(), email: null, userId: null }); return; }
    const sb = supabase();
    let uid: string | null | undefined;
    const apply = (session: { user: { id: string; email?: string } } | null) => {
      const next = session?.user.id ?? null;
      if (next === uid) return; // token refreshes don't rebuild the repo
      uid = next;
      setState(session
        ? { phase: 'ready', repo: supabaseRepo(sb, session.user.id), email: session.user.email ?? null, userId: session.user.id }
        : { phase: 'login' });
    };
    sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => apply(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (state.phase === 'boot') return <div className="boot" />;
  if (state.phase === 'login') return <Login />;
  return <Planner key={state.userId ?? 'local'} repo={state.repo} email={state.email} />;
}
