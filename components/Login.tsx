'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Email + password, with a magic link as a fallback. Accounts are created in the Supabase dashboard. */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setMsg('');
    const sb = supabase();
    if (mode === 'password') {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMsg(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message);
    } else {
      const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } });
      setMsg(error ? error.message : 'Check your email for a sign-in link.');
    }
    setBusy(false);
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="in">
        <h1>Dump &amp; Slot</h1>
        <div className="nm">Sign in to see your tasks on every device.</div>
        <div className="fld">
          <label htmlFor="em">Email</label>
          <input id="em" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        {mode === 'password' && (
          <div className="fld">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        )}
        <button type="submit" className="btn pri" disabled={busy}>{mode === 'password' ? 'Sign in' : 'Email me a link'}</button>
        <div className="minor">
          <button type="button" className="link" onClick={() => { setMode(mode === 'password' ? 'link' : 'password'); setMsg(''); }}>
            {mode === 'password' ? 'Email me a sign-in link instead' : 'Use my password'}
          </button>
        </div>
        {msg && <p className="msg" role="status">{msg}</p>}
      </form>
    </main>
  );
}
