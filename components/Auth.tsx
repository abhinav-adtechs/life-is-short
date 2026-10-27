'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { clockLine } from '@/lib/format';
import { Brand } from './Brand';
import { ArrowIcon } from './icons';
import { useNow } from './hooks';

/**
 * Every sign-in step: the name and the time across the top, and one card in the middle. The first step gets the
 * big title and the tagline. The theme is this device's, replayed before first paint.
 */
export function Shell({ title, hero, onSubmit, children }: {
  title: string; hero?: boolean; onSubmit?: (e: React.FormEvent) => void; children: React.ReactNode;
}) {
  const now = useNow();
  return (
    <main className="auth">
      <header className="auth-top"><Brand /><span className="clock num">{clockLine(now)}</span></header>
      <div className="auth-mid">
        {hero && <p className="auth-tag in">Dump it. Slot it. Do it.</p>}
        <h1 className={'auth-t in' + (hero ? ' hero' : '')}>{title}</h1>
        {hero && <p className="auth-lead in">One box to dump things into, and one answer on the screen: the task to do now.</p>}
        {onSubmit
          ? <form className="auth-card panel in" onSubmit={onSubmit}>{children}</form>
          : <div className="auth-card panel in">{children}</div>}
      </div>
    </main>
  );
}

/** First sign-in on a device: email and password. There's no sign-up or email link. */
export function SignIn({ notice }: { notice?: string }) {
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
    <Shell title="Life is short." hero onSubmit={submit}>
      {notice && <p className="msg" role="alert">{notice}</p>}
      <div className="fld">
        <label htmlFor="em">Email</label>
        <input id="em" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="fld">
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      </div>
      <button type="submit" className="btn pri" disabled={busy}>Continue<ArrowIcon /></button>
      {msg && <p className="msg" role="alert">{msg}</p>}
      <p className="msg">You’ll confirm with your authenticator app next.</p>
      <a className="legal-link" href="/privacy">Privacy</a>
    </Shell>
  );
}

function CodeField({ code, setCode, onCode, busy, focus = true }: { code: string; setCode: (v: string) => void; onCode: (code: string) => void; busy: boolean; focus?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) input.current?.focus(); }, [focus]);
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
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Life is short', issuer: 'Life is short' });
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
    <Shell title="Turn on 2FA" onSubmit={e => { e.preventDefault(); verify(code); }}>
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
    </Shell>
  );
}

/** Right after a password sign-in: the authenticator code. */
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
    <Shell title="Enter your code" onSubmit={e => { e.preventDefault(); verify(code); }}>
      <div className="nm">Open your authenticator app and enter the 6-digit code{email ? ` for ${email}` : ''}.</div>
      <CodeField code={code} setCode={setCode} onCode={verify} busy={busy} />
      {msg && <p className="msg" role="alert">{msg}</p>}
      <div className="minor"><button type="button" className="link" onClick={onSignOut}>Sign out</button></div>
    </Shell>
  );
}

function PinField({ id, label, value, onChange, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="fld">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="code" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,12}" minLength={6} maxLength={12}
        required autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 12))} />
    </div>
  );
}

/** Once, after the first password sign-in: choose the PIN used for every sign-in after this. */
export function CreatePin({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 6) { setMsg('Use at least 6 digits.'); return; }
    if (pin !== again) { setMsg('The two PINs don’t match.'); return; }
    setBusy(true); setMsg('');
    const { data, error } = await supabase().rpc('set_pin', { new_pin: pin });
    setBusy(false);
    if (error || data !== 'ok') {
      setMsg(data === 'password-required' ? 'For safety, choose the PIN within 10 minutes of signing in with your password. Sign out and sign in again.' : 'Couldn’t save the PIN. Try again.');
      return;
    }
    onDone();
  }

  return (
    <Shell title="Choose a PIN" onSubmit={save}>
      <div className="nm">From now on you’ll sign in with this PIN and your authenticator code, instead of your password. 6 to 12 digits.</div>
      <PinField id="pin1" label="PIN" value={pin} onChange={setPin} autoFocus />
      <PinField id="pin2" label="PIN again" value={again} onChange={setAgain} />
      <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Save PIN'}</button>
      {msg && <p className="msg" role="alert">{msg}</p>}
      <div className="minor"><button type="button" className="link" onClick={onSignOut}>Sign out</button></div>
    </Shell>
  );
}

/** Every sign-in after the first: the PIN and an authenticator code. `codeDone` skips the code when one was just given. */
export function PinUnlock({ factorId, email, codeDone, onDone, onLocked, onSignOut }: {
  factorId: string; email: string | null; codeDone: boolean; onDone: () => void; onLocked: () => void; onSignOut: () => void;
}) {
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function unlock(e?: React.FormEvent) {
    e?.preventDefault();
    if (pin.length < 6 || (!codeDone && code.length !== 6) || busy) return;
    setBusy(true); setMsg('');
    const sb = supabase();
    if (!codeDone) {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) { setMsg(codeError(error)); setCode(''); setBusy(false); return; }
    }
    const { data, error } = await sb.rpc('unlock_with_pin', { pin });
    setBusy(false);
    if (data === 'ok') { onDone(); return; }
    setPin('');
    if (data === 'locked') { onLocked(); return; }
    if (data === 'wrong') { setMsg('Wrong PIN. After 5 wrong tries you’ll need your password.'); onDone(); return; }
    setMsg(error ? 'Couldn’t check the PIN. Try again.' : 'Something changed; try again.');
    onDone();
  }

  return (
    <Shell title="Unlock" onSubmit={unlock}>
      <div className="nm">{codeDone ? 'Enter your PIN.' : `Enter your PIN and the code from your authenticator app${email ? ` (${email})` : ''}.`}</div>
      <PinField id="pin" label="PIN" value={pin} onChange={setPin} autoFocus />
      {!codeDone && <CodeField code={code} setCode={setCode} onCode={() => { /* wait for Unlock: the PIN may not be done */ }} busy={busy} focus={false} />}
      {codeDone && <button type="submit" className="btn pri" disabled={busy || pin.length < 6}>{busy ? 'Checking…' : 'Unlock'}</button>}
      {msg && <p className="msg" role="alert">{msg}</p>}
      <div className="minor">
        <button type="button" className="link" onClick={onSignOut}>Forgot your PIN? Sign in with your password</button>
      </div>
    </Shell>
  );
}
