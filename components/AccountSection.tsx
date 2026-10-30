'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { dayWord, fmtAgo } from '@/lib/format';
import { native } from '@/lib/native';
import { PASSKEY_PROBLEMS, addPasskey, passkeysEnabled, passkeysSupported, problemOf } from '@/lib/passkey';
import { usePlanner } from './Planner';
import { Opt } from './Controls';
import { KeyIcon } from './icons';
import { codeError, rememberPasskey } from './Auth';

interface Passkey { id: string; friendly_name?: string; created_at: string; last_used_at?: string }

const nameOf = (p: Passkey) => p.friendly_name || 'Passkey';
const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);

/**
 * Settings → Account: every way in, in one place, like a Google account's sign-in options. Passkeys, the authenticator
 * app, the PIN, the password, signing out. The authenticator can be moved to a new app but never removed, so there's
 * always a second step, whatever passkeys come and go.
 * Supabase asks for a fresh authenticator code (aal2) before adding or removing a passkey, moving the authenticator or
 * changing the password; a passkey sign-in doesn't count as one, so those ask for a code first.
 */
export function AccountSection() {
  const { email } = usePlanner();
  return (
    <section id="set-account" className="set-sec" aria-labelledby="set-account-h">
      <div className="set-h"><h3 id="set-account-h">Account</h3>{email && <span className="muted sm">signed in as {email}</span>}</div>
      <p className="note">
        Ways in: a passkey on its own; or your PIN with Face ID (on an iPhone or iPad) or a code from your authenticator app.
        A new device starts with your password and a code, or a passkey. Your authenticator app always stays, so there’s
        always a second step.
      </p>
      <Passkeys />
      <Authenticator />
      <PinRow />
      <PasswordRow />
      <SignOutRow />
    </section>
  );
}

/** Supabase wants a fresh authenticator code for this. Entering one also signs your other passkey sessions out. */
function ConfirmCode({ why, onDone, onCancel }: { why: string; onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true); setMsg('');
    const sb = supabase();
    const { data } = await sb.auth.mfa.listFactors();
    const totp = data?.totp.find(f => f.status === 'verified');
    const { error } = totp ? await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code }) : { error: { message: 'no authenticator' } };
    setBusy(false);
    if (error) { setMsg(codeError(error)); setCode(''); return; }
    onDone();
  };

  return (
    <form className="set-form step" onSubmit={submit} autoComplete="off">
      <p className="note">Enter the 6-digit code from your authenticator app to {why}.</p>
      <div className="fld">
        <label htmlFor="step-code">6-digit code</label>
        <input id="step-code" className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus
          value={code} onChange={e => setCode(digits(e.target.value, 6))} />
      </div>
      {msg && <p className="msg" role="alert">{msg}</p>}
      <div className="acts">
        <button type="submit" className="btn pri sm" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm'}</button>
        <button type="button" className="btn sec sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------- passkeys ---------- */

type Ask = { why: string; then: 'add' | (() => void) };

function Passkeys() {
  const { toast } = usePlanner();
  const [on, setOn] = useState<boolean | null>(null);
  const [list, setList] = useState<Passkey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [ready, setReady] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const canAdd = passkeysSupported();

  const load = useCallback(async () => {
    const { data, error } = await supabase().auth.passkey.list();
    if (error) {
      if (problemOf(error) === 'disabled') setOn(false); else setFailed(true);
      return;
    }
    setFailed(false);
    setList([...(data ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
  }, []);

  useEffect(() => {
    passkeysEnabled().then(yes => { setOn(yes); if (yes) load(); });
  }, [load]);

  const add = async () => {
    setBusy(true); setMsg('');
    const r = await addPasskey(supabase());
    setBusy(false);
    if (r.ok) {
      rememberPasskey();
      setReady(false); setFresh(r.value.id);
      toast(`Passkey added: ${r.value.name}`);
      load();
      return;
    }
    // Making a passkey needs your touch or face, so after the code it waits for another tap rather than starting itself.
    if (r.problem === 'code-required') { setAsk({ why: 'add a passkey', then: 'add' }); return; }
    setMsg(PASSKEY_PROBLEMS[r.problem]);
  };

  const remove = async (p: Passkey) => {
    const { error } = await supabase().auth.passkey.delete({ passkeyId: p.id });
    if (error) {
      if (problemOf(error) === 'code-required') setAsk({ why: `remove ${nameOf(p)}`, then: () => remove(p) });
      else toast('Couldn’t remove the passkey. Try again.');
      return;
    }
    toast(`Removed ${nameOf(p)}. Delete it from your device’s passwords too.`);
    load();
  };

  const rename = async (p: Passkey, name: string) => {
    const { error } = await supabase().auth.passkey.update({ passkeyId: p.id, friendlyName: name });
    if (error) { toast('Couldn’t rename the passkey. Try again.'); return false; }
    load();
    return true;
  };

  const host = typeof location === 'undefined' ? '' : location.hostname;
  const origin = typeof location === 'undefined' ? '' : location.origin;

  return (
    <Opt label="Passkeys" stack
      note="Face ID, Touch ID, Windows Hello, your phone or a security key. On its own, a passkey stands in for the PIN and code for 24 hours, and it can’t be phished. On an iPhone or iPad it can also follow your PIN, instead of a code.">
      {() => (
        <div className="pk">
          {on === false && (
            <p className="warnbox" role="status">
              Passkeys are off for this planner. Turn them on in Supabase, under Authentication → Passkeys, with the relying
              party ID <b>{host}</b> and the origin <b>{origin}</b>. docs/setup.md has the steps.
            </p>
          )}
          {on && !list && !failed && <p className="note">Checking your passkeys…</p>}
          {failed && <p className="warnbox" role="alert">Couldn’t load your passkeys. <button type="button" className="link" onClick={load}>Try again</button></p>}
          {list && list.length === 0 && <p className="note">No passkeys yet.</p>}
          {list?.map(p => <PasskeyCard key={p.id} p={p} fresh={fresh === p.id} onRename={name => rename(p, name)} onRemove={() => remove(p)} />)}
          {ask && (
            <ConfirmCode why={ask.why} onCancel={() => setAsk(null)}
              onDone={() => { const then = ask.then; setAsk(null); if (then === 'add') setReady(true); else then(); }} />
          )}
          {on && list && !ask && (
            canAdd ? (
              <div className="acts">
                <button type="button" className={'btn sm ' + (list.length && !ready ? 'sec' : 'pri')} disabled={busy} onClick={add}>
                  <KeyIcon size={14} />{busy ? 'Waiting for your device…' : 'Add a passkey'}
                </button>
                {ready && <span className="note">Code accepted. Add your passkey now.</span>}
              </div>
            ) : (
              <p className="note">
                {native()
                  ? 'This copy of the app isn’t linked to your site yet, so it can’t make or use passkeys (docs/apple.md). Add one in your browser.'
                  : 'This browser can’t make passkeys. Add one on another device.'}
              </p>
            )
          )}
          {msg && <p className="msg" role="alert">{msg}</p>}
        </div>
      )}
    </Opt>
  );
}

function PasskeyCard({ p, fresh, onRename, onRemove }: { p: Passkey; fresh: boolean; onRename: (name: string) => Promise<boolean>; onRemove: () => void }) {
  const [editing, setEditing] = useState(fresh);
  const [name, setName] = useState(nameOf(p));
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (fresh) setEditing(true); }, [fresh]);
  const used = p.last_used_at ? `last used ${fmtAgo(Date.parse(p.last_used_at))}` : 'not used yet';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === nameOf(p)) { setEditing(false); return; }
    if (await onRename(n)) setEditing(false);
  };

  return (
    <div className={'sh-card pk-card' + (fresh ? ' fresh' : '')}>
      {editing ? (
        <form className="set-form" onSubmit={save}>
          <div className="fld">
            <label htmlFor={`pk-${p.id}`}>{fresh ? 'Name it, so you know which device it’s on' : 'Name'}</label>
            <input id={`pk-${p.id}`} value={name} maxLength={120} autoFocus onChange={e => setName(e.target.value)} />
          </div>
          <div className="acts">
            <button type="submit" className="btn pri sm">Save</button>
            <button type="button" className="btn sec sm" onClick={() => { setName(nameOf(p)); setEditing(false); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="sh-h"><div className="who"><b>{nameOf(p)}</b><span>Added {dayWord(Date.parse(p.created_at))} · {used}</span></div></div>
      )}
      {!editing && (
        <div className="acct-f">
          {confirm ? (
            <>
              <span>Remove {nameOf(p)}? It won’t open the planner any more.</span>
              <button type="button" className="btn sec sm" onClick={() => { setConfirm(false); onRemove(); }}>Remove</button>
              <button type="button" className="link" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="link" onClick={() => setEditing(true)}>Rename</button>
              <button type="button" className="link armed" onClick={() => setConfirm(true)}>Remove</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- the authenticator app ---------- */

/** Move the codes to a new app or phone: set up the new one, confirm a code from it, then the old one is removed. */
function Authenticator() {
  const { toast } = usePlanner();
  const [since, setSince] = useState<string | null>(null);
  const [step, setStep] = useState<null | 'confirm' | { id: string; qr: string; secret: string }>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase().auth.mfa.listFactors().then(({ data }) => setSince(data?.totp.find(f => f.status === 'verified')?.created_at ?? null));
  }, [step]);

  const start = async () => {
    setBusy(true); setMsg('');
    const sb = supabase();
    // Clear a half-finished move first.
    const { data: list } = await sb.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.factor_type === 'totp' && f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
    // Supabase wants a name of its own for each factor.
    const friendlyName = `Life is short ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName, issuer: 'Life is short' });
    setBusy(false);
    if (error?.code === 'insufficient_aal') { setStep('confirm'); return; }
    if (error || !data) { setMsg('Couldn’t start. Try again.'); return; }
    setStep({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!step || typeof step !== 'object' || code.length !== 6 || busy) return;
    setBusy(true); setMsg('');
    const sb = supabase();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: step.id, code });
    if (error) { setBusy(false); setMsg(codeError(error)); setCode(''); return; }
    // The new app works: retire the old one, so there's only ever one way to get codes.
    const { data: list } = await sb.auth.mfa.listFactors();
    let left = 0;
    for (const f of list?.all ?? []) {
      if (f.factor_type !== 'totp' || f.id === step.id) continue;
      const { error: gone } = await sb.auth.mfa.unenroll({ factorId: f.id });
      if (gone) left++;
    }
    setBusy(false); setCode('');
    if (left) { setMsg('The new app works, but the old one couldn’t be removed. Try again, or remove it in Supabase.'); return; }
    setStep(null);
    toast('Moved. Codes come from the new app now; delete Life is short from the old one.');
  };

  const cancel = async () => {
    if (step && typeof step === 'object') await supabase().auth.mfa.unenroll({ factorId: step.id });
    setStep(null); setCode(''); setMsg('');
  };

  return (
    <>
      <Opt label="Authenticator app" note={`Always on, so there’s always a second step: for a new device’s first sign-in, the PIN, and changes like these. It can move to a new app, but not be removed.${since ? ` Set up ${dayWord(Date.parse(since))}.` : ''}`}>
        {() => !step && <button type="button" className="btn sec sm" disabled={busy} onClick={start}>Move to a new app</button>}
      </Opt>
      {step === 'confirm' && <ConfirmCode why="move your codes to a new app" onCancel={() => setStep(null)} onDone={() => { setStep(null); start(); }} />}
      {step && typeof step === 'object' && (
        <form className="set-form step" onSubmit={finish} autoComplete="off">
          <p className="note">Scan this with the new app, then type the code it shows. Until then the old app keeps working.</p>
          <img className="qr" src={step.qr} alt="QR code for your new authenticator app" width={168} height={168} />
          <p className="note">Can’t scan? Enter this key: <code className="secret">{step.secret}</code></p>
          <div className="fld">
            <label htmlFor="move-code">Code from the new app</label>
            <input id="move-code" className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              value={code} onChange={e => setCode(digits(e.target.value, 6))} />
          </div>
          <div className="acts">
            <button type="submit" className="btn pri sm" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Use the new app'}</button>
            <button type="button" className="btn sec sm" onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <p className="msg" role="alert">{msg}</p>}
    </>
  );
}

/* ---------- PIN, password, signing out ---------- */

function PinRow() {
  const { toast } = usePlanner();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [pwRecent, setPwRecent] = useState(false);

  // A PIN can only be changed within 10 minutes of a password sign-in (the database checks this too).
  useEffect(() => {
    supabase().rpc('pin_status').then(({ data }) => setPwRecent((data?.password_age ?? Infinity) < 600));
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{6,12}$/.test(pin)) { toast('Use 6 to 12 digits.'); return; }
    if (pin !== pin2) { toast('The two PINs don’t match.'); return; }
    const { data, error } = await supabase().rpc('set_pin', { new_pin: pin });
    if (error || data !== 'ok') { toast(data === 'password-required' ? 'Sign out and sign in with your password first, then change the PIN within 10 minutes.' : 'Couldn’t change the PIN.'); return; }
    toast('PIN changed');
    setPin(''); setPin2(''); setOpen(false);
  };

  return (
    <>
      <Opt label="PIN" note="Unlocks the planner with a code from your authenticator app, or with Face ID on an iPhone or iPad.">
        {() => !open && <button type="button" className="btn sec sm" onClick={() => setOpen(true)}>Change PIN</button>}
      </Opt>
      {open && (pwRecent ? (
        <form onSubmit={save} autoComplete="off" className="set-form step">
          <div className="fld"><label htmlFor="new-pin">New PIN (6 to 12 digits)</label>
            <input id="new-pin" type="password" inputMode="numeric" value={pin} onChange={e => setPin(digits(e.target.value, 12))} /></div>
          <div className="fld"><label htmlFor="new-pin2">New PIN again</label>
            <input id="new-pin2" type="password" inputMode="numeric" value={pin2} onChange={e => setPin2(digits(e.target.value, 12))} /></div>
          <div className="acts"><button type="submit" className="btn pri sm">Save PIN</button>
            <button type="button" className="btn sec sm" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="set-form step">
          <p className="note">To change your PIN, sign out and sign in again with your password, then come back here within 10 minutes.</p>
          <div className="acts"><button type="button" className="btn sec sm" onClick={() => setOpen(false)}>OK</button></div>
        </div>
      ))}
    </>
  );
}

function PasswordRow() {
  const { toast } = usePlanner();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [ask, setAsk] = useState(false);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pw.length < 8) { toast('Use at least 8 characters.'); return; }
    const { error } = await supabase().auth.updateUser({ password: pw });
    if (error?.code === 'insufficient_aal') { setAsk(true); return; }
    toast(error ? error.message : 'Password updated');
    if (!error) { setPw(''); setOpen(false); }
  };

  return (
    <>
      <Opt label="Password" note="For signing in on a new device without a passkey.">
        {() => !open && <button type="button" className="btn sec sm" onClick={() => setOpen(true)}>Change password</button>}
      </Opt>
      {open && !ask && (
        <form onSubmit={save} autoComplete="off" className="set-form step">
          <div className="fld"><label htmlFor="new-pw">New password</label>
            <input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
          <div className="acts"><button type="submit" className="btn pri sm">Save password</button>
            <button type="button" className="btn sec sm" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {ask && <ConfirmCode why="change your password" onCancel={() => setAsk(false)} onDone={() => { setAsk(false); save(); }} />}
    </>
  );
}

function SignOutRow() {
  const [everywhere, setEverywhere] = useState(false);
  return (
    <div className="acct-f">
      {everywhere ? (
        <>
          <span>Sign out on every device, this one too?</span>
          <button type="button" className="btn sec sm" onClick={() => supabase().auth.signOut({ scope: 'global' })}>Sign out everywhere</button>
          <button type="button" className="link" onClick={() => setEverywhere(false)}>Cancel</button>
        </>
      ) : (
        <>
          <button type="button" className="btn sec sm" onClick={() => supabase().auth.signOut()}>Sign out</button>
          <button type="button" className="link" onClick={() => setEverywhere(true)}>Sign out everywhere</button>
        </>
      )}
    </div>
  );
}
