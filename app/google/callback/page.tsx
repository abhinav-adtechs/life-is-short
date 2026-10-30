'use client';

import { useEffect, useState } from 'react';
import { postJson } from '@/lib/api';
import { PENDING_KEY, STATE_KEY } from '@/lib/google-client';
import { appReturnUrl } from '@/lib/native';

/** Google sends you back here after you allow access. Swap the code for a sealed token and hand it to the app. */
export default function GoogleCallback() {
  const [msg, setMsg] = useState('Connecting Google…');
  const [backToApp, setBackToApp] = useState<string | null>(null);
  useEffect(() => {
    // Started in the iPhone, iPad or Mac app: this is the system's sign-in sheet. The app finishes the connection.
    const back = appReturnUrl(window.location.search);
    if (back) {
      setBackToApp(back);
      setMsg('Back to Life is short…');
      window.location.replace(back);
      return;
    }
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
    <main className="auth">
      <div className="auth-mid"><h1 className="auth-t in">{msg}</h1><p className="nm">{backToApp
        ? <a className="link" href={backToApp}>Open Life is short</a>
        : <a className="link" href="/app">Back to your planner</a>}</p></div>
    </main>
  );
}
