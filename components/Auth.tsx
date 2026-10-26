'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Step 1: email and password. Accounts are created in the Supabase dashboard; there's no sign-up or email link. */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg('');
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    // Same message for every failure, so the form doesn't reveal which emails exist.
    if (error) setMsg(error.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'That email and password don’t match.');
    setBusy(false);
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="in">
        <h1>Dump &amp; Slot</h1>
        <div className="nm">Sign in. You’ll confirm with your authenticator app next.</div>
        <div className="fld">
          <label htmlFor="em">Email</label>
          <input id="em" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn pri" disabled={busy}>Continue</button>
        {msg && <p className="msg" role="alert">{msg}</p>}
      </form>
    </main>
  );
}

function CodeField({ code, setCode, onCode, busy }: { code: string; setCode: (v: string) => void; onCode: (code: string) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return (
    <>
      <div className="fld">
        <label htmlFor="otp">6-digit code</label>
        <input id="otp" ref={input} className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
          required value={code} onChange={e => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setCode(v);
            if (v.length === 6 && !busy) onCode(v);
          }} />
      </div>
      <button type="submit" className="btn pri" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Unlock'}</button>
    </>
  );
}

const codeError = (e: { status?: number; message?: string }) =>
  e.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'That code didn’t work. Codes change every 30 seconds; try the current one.';

/** One-time setup: scan the QR code into an authenticator app and confirm with a code. */
export function EnrollTotp({ onSignOut }: { onSignOut: () => void }) {
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const sb = supabase();
      // Clear any half-finished setup so the new one can use the same name.
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Dump & Slot', issuer: 'Dump & Slot' });
      if (error || !data) { setMsg(error?.message || 'Couldn’t start 2FA setup.'); return; }
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function verify(code: string) {
    if (!factor) return;
    if (code.length !== 6) return;
    setBusy(true); setMsg('');
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) { setMsg(codeError(error)); setCode(''); setBusy(false); }
  }

  return (
    <main className="login">
      <form className="in" onSubmit={e => { e.preventDefault(); verify(code); }}>
        <h1>Turn on 2FA</h1>
        <div className="nm">Scan this with an authenticator app (Google Authenticator, 1Password, Authy), then type the 6-digit code it shows.</div>
        {factor ? (
          <>
            <img className="qr" src={factor.qr} alt="QR code for your authenticator app" width={184} height={184} />
            <p className="msg">Can’t scan? Enter this key: <code className="secret">{factor.secret}</code></p>
            <CodeField code={code} setCode={setCode} onCode={verify} busy={busy} />
          </>
        ) : !msg && <p className="msg">Preparing…</p>}
        {msg && <p className="msg" role="alert">{msg}</p>}
        <div className="minor"><button type="button" className="link" onClick={onSignOut}>Sign out</button></div>
      </form>
    </main>
  );
}

/** Every 24 hours: only the authenticator code, not the password. */
export function CodeCheck({ factorId, email, onSignOut }: { factorId: string; email: string | null; onSignOut: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function verify(code: string) {
    if (code.length !== 6) return;
    setBusy(true); setMsg('');
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId, code });
    if (error) { setMsg(codeError(error)); setCode(''); setBusy(false); }
  }

  return (
    <main className="login">
      <form className="in" onSubmit={e => { e.preventDefault(); verify(code); }}>
        <h1>Enter your code</h1>
        <div className="nm">Open your authenticator app. A code is needed once every 24 hours{email ? ` for ${email}` : ''}.</div>
        <CodeField code={code} setCode={setCode} onCode={verify} busy={busy} />
        {msg && <p className="msg" role="alert">{msg}</p>}
        <div className="minor"><button type="button" className="link" onClick={onSignOut}>Sign out</button></div>
      </form>
    </main>
  );
}
