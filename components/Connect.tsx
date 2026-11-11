'use client';

import { useState } from 'react';
import { postJson } from '@/lib/api';
import App from './App';
import { Shell } from './Auth';
import { ArrowIcon } from './icons';

const REASONS: Record<string, string> = {
  expired: 'This took too long, so the request ran out. Go back to Claude and connect again.',
  locked: 'Your session locked. Reload the page to unlock it, then try again.',
  'signed-out': 'You’re signed out. Reload the page to sign in, then try again.',
  'too-many': 'You already have 20 connections. Disconnect one in Settings → Claude, then try again.',
  key: 'The server isn’t set up for connections yet: the database doesn’t know MCP_SERVER_KEY (docs/setup.md).',
};

export interface ConnectProps {
  request?: string;
  clientName?: string;
  redirectHost?: string;
  denyUrl?: string;
  /** Why there's nothing to connect, when there isn't. */
  problem?: string;
}

/**
 * The consent screen of /oauth/authorize. It sits behind the planner's own sign-in (components/App.tsx): to connect
 * Claude you unlock exactly as you would to see your tasks, then press Allow.
 */
export default function Connect(p: ConnectProps) {
  if (p.problem || !p.request) {
    return (
      <Shell title="Can’t connect">
        <p className="nm">{p.problem || 'Start again from Claude.'}</p>
        <a className="btn sec" href="/app">Open Life is short</a>
      </Shell>
    );
  }
  return <App>{you => <Consent {...p} request={p.request!} email={you.email} />}</App>;
}

function Consent({ request, clientName = 'An app', redirectHost = '', denyUrl = '', email }: ConnectProps & { request: string; email: string | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const allow = async () => {
    setBusy(true); setMsg('');
    let tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
    try {
      const { status, data } = await postJson<{ redirect?: string; reason?: string }>('/oauth/approve', { request, tz });
      if (status === 200 && data?.redirect) { window.location.assign(data.redirect); return; }
      setMsg(REASONS[data?.reason ?? ''] ?? 'Couldn’t connect just now. Try again.');
    } catch {
      setMsg('Couldn’t reach the server. Check your connection and try again.');
    }
    setBusy(false);
  };

  return (
    <Shell title={`Connect ${clientName}?`}>
      <p className="nm">
        {clientName} wants to use Life is short{email ? <> as <strong>{email}</strong></> : null}. It will be able to:
      </p>
      <ul className="nm consent-list">
        <li>see your tasks, their notes and your labels</li>
        <li>add, change, tick off and delete tasks</li>
      </ul>
      <p className="msg">
        Not your Google account, chat history, shares or sign-in. It keeps access until you disconnect it in Settings → Claude,
        or it goes unused for 30 days.
      </p>
      {msg && <p className="msg" role="alert">{msg}</p>}
      <button type="button" className="btn pri" onClick={allow} disabled={busy}>{busy ? 'Connecting…' : 'Allow'}<ArrowIcon /></button>
      <button type="button" className="btn ghost" onClick={() => window.location.assign(denyUrl)} disabled={busy || !denyUrl}>Don’t allow</button>
      {redirectHost && <p className="msg">Either way you’ll go back to <strong>{redirectHost}</strong>.</p>}
    </Shell>
  );
}
