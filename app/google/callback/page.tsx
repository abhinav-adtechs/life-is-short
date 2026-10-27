'use client';

import { useEffect, useState } from 'react';
import { postJson } from '@/lib/api';
import { PENDING_KEY, STATE_KEY } from '@/lib/google-client';

/** Google sends you back here after you allow access. Swap the code for a sealed token and hand it to the app. */
export default function GoogleCallback() {
  const [msg, setMsg] = useState('Connecting Google…');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const code = q.get('code'), state = q.get('state'), err = q.get('error');
    const expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    if (err) { setMsg(err === 'access_denied' ? 'Google access was not allowed.' : `Google said: ${err}`); return; }
    if (!code || !state || state !== expected) { setMsg('That sign-in link expired. Try connecting again from Settings.'); return; }
    postJson<{ blob?: string; email?: string | null; message?: string }>('/api/google/exchange', { code }).then(({ status, data }) => {
      if (status !== 200 || !data?.blob) { setMsg(data?.message || 'Could not connect Google. Try again from Settings.'); return; }
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ blob: data.blob, email: data.email ?? null, connectedAt: Date.now() }));
      // Back to the Google section of Settings, where the new account shows up.
      window.location.replace('/app#settings/google');
    }).catch(() => setMsg('Could not reach the server. Try again from Settings.'));
  }, []);
  return (
    <main className="login"><div className="in"><h1 className="nt" style={{ marginTop: 0 }}>{msg}</h1>
      <p className="nm"><a className="link" href="/app">Back to your planner</a></p></div></main>
  );
}
