'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtDur, fmtWhen, shortDate, setClock24 } from '@/lib/format';
import { atMinutes, fromYmd, pad, ymd } from '@/lib/time';
import { CODE_LENGTH, isEmail, isLink, requestWhen, suggestionError, type SharedData, type Suggestion } from '@/lib/share';
import { loadView, requestCode, sendSuggestion, signOutViewer, verifyCode } from '@/lib/share-viewer';
import { SharedView } from './SharedView';
import { Toast, type ToastState } from './Toast';
import { useMedia, useNow, useTrap } from './hooks';
import { XIcon } from './icons';
import { Shell } from './Auth';
import { Logo } from './Brand';

type Phase =
  | { p: 'boot' }
  | { p: 'no-link' }
  | { p: 'off' }
  | { p: 'email'; notice?: string }
  | { p: 'code'; email: string }
  | { p: 'ready'; data: SharedData }
  | { p: 'error' };

const EMAIL_KEY = 'lis.view.email';
const linkOf = () => window.location.hash.replace(/^#/, '');

/**
 * Someone's planner, shared with you: view only. Sign in with the email it was shared with and a code
 * sent there. You can suggest a backlog task or a time on their calendar; they approve or decline it.
 */
export default function SharedPlanner() {
  const [phase, setPhase] = useState<Phase>({ p: 'boot' });
  const [link, setLink] = useState('');

  const load = useCallback(async (l: string, quiet = false) => {
    const { status, data } = await loadView(l);
    if (status === 200 && data) {
      setClock24(data.clock === '24');
      setPhase({ p: 'ready', data });
      return;
    }
    if (status === 401) {
      setPhase(cur => (quiet && cur.p !== 'ready' ? cur : { p: 'email', notice: cur.p === 'ready' ? 'You’ve been signed out. Sign in again to keep viewing.' : undefined }));
      return;
    }
    if (status === 503) { setPhase({ p: 'off' }); return; }
    if (!quiet) setPhase({ p: 'error' });
  }, []);

  useEffect(() => {
    const start = () => {
      const l = linkOf();
      setLink(l);
      if (!isLink(l)) { setPhase({ p: 'no-link' }); return; }
      load(l);
    };
    start();
    window.addEventListener('hashchange', start);
    return () => window.removeEventListener('hashchange', start);
  }, [load]);

  // Keep it current while it's open; signs out here as soon as the share stops.
  useEffect(() => {
    if (phase.p !== 'ready') return;
    const again = () => { if (!document.hidden) load(link, true); };
    const timer = window.setInterval(again, 2 * 60000);
    document.addEventListener('visibilitychange', again);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', again); };
  }, [phase.p, link, load]);

  switch (phase.p) {
    case 'boot': return <div className="boot" />;
    case 'no-link': return <Notice title="This link isn’t complete" text="Open the full link you were sent. It ends with a long code after a #." />;
    case 'off': return <Notice title="Sharing is switched off" text="This planner isn’t being shared right now." />;
    case 'error': return <Notice title="Can’t reach the planner" text="Check your connection and try again." retry={() => { setPhase({ p: 'boot' }); load(link); }} />;
    case 'email': return <EmailStep link={link} notice={phase.notice} onSent={email => setPhase({ p: 'code', email })} />;
    case 'code': return <CodeStep link={link} email={phase.email} onBack={() => setPhase({ p: 'email' })} onDone={() => load(link)} />;
    default: return <Viewer link={link} data={phase.data} reload={() => load(link, true)} onSignedOut={() => setPhase({ p: 'email', notice: 'Signed out.' })} />;
  }
}

function Notice({ title, text, retry }: { title: string; text: string; retry?: () => void }) {
  return (
    <Shell title={title}>
      <p className="nm">{text}</p>
      {retry && <button type="button" className="btn pri" onClick={retry}>Try again</button>}
    </Shell>
  );
}

function EmailStep({ link, notice, onSent }: { link: string; notice?: string; onSent: (email: string) => void }) {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!isEmail(v)) { setMsg('Enter the email this was shared with.'); return; }
    setBusy(true); setMsg('');
    const { status } = await requestCode(link, v);
    setBusy(false);
    if (status === 200) {
      try { localStorage.setItem(EMAIL_KEY, v); } catch { /* a nicety */ }
      onSent(v);
      return;
    }
    setMsg(status === 503 ? 'Sharing isn’t available right now.' : 'Couldn’t send a code. Check your connection and try again.');
  }

  return (
    <Shell title="A shared planner" onSubmit={submit}>
      <div className="nm">Someone shared their planner with you, view only. Enter your email and we’ll send you a code.</div>
      {notice && <p className="msg" role="status">{notice}</p>}
      <div className="fld">
        <label htmlFor="v-em">Email</label>
        <input id="v-em" type="email" autoComplete="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      {msg && <p className="msg" role="alert">{msg}</p>}
    </Shell>
  );
}

function CodeStep({ link, email, onBack, onDone }: { link: string; email: string; onBack: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [resent, setResent] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  async function verify(c: string) {
    if (c.length !== CODE_LENGTH || busy) return;
    setBusy(true); setMsg('');
    const { status } = await verifyCode(link, email, c);
    if (status === 200) { onDone(); return; }
    setBusy(false); setCode('');
    setMsg(status === 401 ? 'That code didn’t work. Check the latest email, or send a new code. Codes last 10 minutes.' : 'Couldn’t check the code. Try again.');
  }

  async function resend() {
    if (Date.now() - resent < 60000) { setMsg('A new code can go once a minute.'); return; }
    setResent(Date.now()); setMsg('');
    const { status } = await requestCode(link, email);
    setMsg(status === 200 ? 'If that email can view this planner, a new code is on its way.' : 'Couldn’t send a new code. Try again.');
  }

  return (
    <Shell title="Check your email" onSubmit={e => { e.preventDefault(); verify(code); }}>
      <div className="nm">If {email} can view this planner, a {CODE_LENGTH}-digit code is on its way. It works for 10 minutes.
        If none arrives, check spam or ask whoever shared it.</div>
      <div className="fld">
        <label htmlFor="v-otp">{CODE_LENGTH}-digit code</label>
        <input id="v-otp" ref={input} className="code" inputMode="numeric" autoComplete="one-time-code" pattern={`[0-9]{${CODE_LENGTH}}`} maxLength={CODE_LENGTH}
          required value={code} onChange={e => {
            const v = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
            setCode(v);
            if (v.length === CODE_LENGTH) verify(v);
          }} />
      </div>
      <button type="submit" className="btn pri" disabled={busy || code.length !== CODE_LENGTH}>{busy ? 'Checking…' : 'View planner'}</button>
      {msg && <p className="msg" role="alert">{msg}</p>}
      <div className="minor">
        <button type="button" className="link" onClick={onBack}>Use a different email</button>
        <button type="button" className="link" onClick={resend}>Send a new code</button>
      </div>
    </Shell>
  );
}

const STATUS: Record<string, string> = { pending: 'Waiting', approved: 'Added', declined: 'Declined' };

function Viewer({ link, data, reload, onSignedOut }: { link: string; data: SharedData; reload: () => void; onSignedOut: () => void }) {
  const wide = useMedia('(min-width: 860px)');
  const now = useNow();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [suggesting, setSuggesting] = useState<Suggestion['kind'] | null>(null);
  const say = useCallback((msg: string) => setToast({ key: Date.now(), msg }), []);
  const kinds = [...(data.scope.backlog ? ['backlog' as const] : []), ...(data.calendar ? ['calendar' as const] : [])];
  const canSuggest = data.scope.suggest && kinds.length > 0;
  let localZone = '';
  try { localZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* unknown */ }

  const signOut = async () => { await signOutViewer(link); onSignedOut(); };

  const top = (
    <header className="vw-top">
      <div className="vw-h">
        <Logo size={24} />
        <h1>Shared planner</h1>
        <span className="vw-pill">View only</span>
        <button type="button" className="link" onClick={signOut}>Sign out</button>
      </div>
      <p className="vw-sub">
        Signed in as {data.email} · {data.expiresAt ? `Shared until ${shortDate(data.expiresAt, now)}` : 'No end date'}
        {localZone && localZone !== data.tz ? ' · Times are in your time zone' : ''}
      </p>
      {canSuggest && (
        <div className="vw-acts">
          {kinds.includes('backlog') && <button type="button" className="btn sec sm" onClick={() => setSuggesting('backlog')}>Suggest a task</button>}
          {kinds.includes('calendar') && <button type="button" className="btn sec sm" onClick={() => setSuggesting('calendar')}>Suggest a time</button>}
        </div>
      )}
    </header>
  );

  const mine = data.requests || [];
  const extra = mine.length > 0 && (
    <section className="vw-sug" aria-label="Your suggestions">
      <div className="gh"><span className="gh-t">Your suggestions<span className="gh-n num">{mine.length}</span></span></div>
      <ul className="vw-rows">
        {mine.map(r => (
          <li key={r.id} className="vw-row">
            <span className="rt">{r.title}</span>
            <span className="rp"><span className={'st ' + r.status}>{STATUS[r.status]}</span> · {requestWhen(r, now)}</span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <SharedView data={data} wide={wide} now={now} top={top} extra={extra} />
      {suggesting && (
        <SuggestSheet link={link} kinds={kinds} initial={suggesting} wide={wide} onClose={() => setSuggesting(null)}
          onSent={() => { setSuggesting(null); say('Sent. You’ll see here when it’s added.'); reload(); }}
          onSignedOut={() => { setSuggesting(null); onSignedOut(); }} />
      )}
      {toast && <div className="dock ph solo"><Toast key={toast.key} state={toast} onDone={() => setToast(null)} /></div>}
    </>
  );
}

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];

function SuggestSheet({ link, kinds, initial, wide, onClose, onSent, onSignedOut }: {
  link: string; kinds: Suggestion['kind'][]; initial: Suggestion['kind']; wide: boolean;
  onClose: () => void; onSent: () => void; onSignedOut: () => void;
}) {
  const [kind, setKind] = useState(initial);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => ymd(Date.now()));
  const [time, setTime] = useState(() => { const d = new Date(Date.now() + 3600000); return `${pad(d.getHours())}:00`; });
  const [minutes, setMinutes] = useState(30);
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const sheet = useRef<HTMLDivElement>(null);
  useTrap(sheet);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const start = kind === 'calendar' && date && time ? atMinutes(fromYmd(date), Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) : null;
    const s: Suggestion = { kind, title: title.replace(/\s+/g, ' ').trim().slice(0, 160), note: note.trim().slice(0, 500), start,
      minutes: kind === 'calendar' ? minutes : null, due: kind === 'backlog' && due ? due : null };
    const err = suggestionError(s);
    if (err) { setMsg(err); return; }
    setBusy(true); setMsg('');
    const { status, data } = await sendSuggestion(link, s);
    setBusy(false);
    if (status === 200) { onSent(); return; }
    if (status === 401) { onSignedOut(); return; }
    setMsg(data?.reason === 'too-many' ? 'You have a lot of suggestions waiting. Wait until some are looked at.'
      : data?.reason === 'not-allowed' ? 'This planner doesn’t take suggestions right now.'
      : status === 400 ? 'Check the details and try again.' : 'Couldn’t send it. Try again.');
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={sheet} className={wide ? 'side' : 'sheet'} role="dialog" aria-modal="true" aria-labelledby="sg-h" tabIndex={-1}>
        {!wide && <div className="grab" aria-hidden="true" />}
        <div className="side-h">
          <h2 id="sg-h">{kind === 'calendar' ? 'Suggest a time' : 'Suggest a task'}</h2>
          <span className="spacer" />
          {wide && <span className="kbd">esc</span>}
          <button type="button" className={'ib' + (wide ? '' : ' bare touch')} aria-label="Close" onClick={onClose}><XIcon size={wide ? 14 : 16} /></button>
        </div>
        <form className="side-b sg" onSubmit={send} autoComplete="off">
          {kinds.length > 1 && (
            <div className="seg fill" role="radiogroup" aria-label="Where it goes">
              {kinds.map(k => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                  {k === 'calendar' ? 'Calendar' : 'Backlog'}
                </button>
              ))}
            </div>
          )}
          <div className="fld">
            <label htmlFor="sg-title">What</label>
            <textarea id="sg-title" className="ed-title" rows={2} maxLength={160} autoFocus value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
          </div>
          {kind === 'calendar' ? (
            <>
              <div className="two">
                <div className="fld"><label htmlFor="sg-date">Day</label><input id="sg-date" type="date" min={ymd(Date.now())} value={date} onChange={e => setDate(e.target.value)} /></div>
                <div className="fld"><label htmlFor="sg-time">Start</label><input id="sg-time" type="time" step={900} value={time} onChange={e => setTime(e.target.value)} /></div>
              </div>
              <div className="fld">
                <label htmlFor="sg-len">Length</label>
                <select id="sg-len" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
                  {LENGTHS.map(m => <option key={m} value={m}>{fmtDur(m)}</option>)}
                </select>
              </div>
              {date && time && <p className="note">{fmtWhen(atMinutes(fromYmd(date), Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))))}, in your time zone.</p>}
            </>
          ) : (
            <div className="fld"><label htmlFor="sg-due">Due by (optional)</label><input id="sg-due" type="date" min={ymd(Date.now())} value={due} onChange={e => setDue(e.target.value)} /></div>
          )}
          <div className="fld">
            <label htmlFor="sg-note">Note (optional)</label>
            <textarea id="sg-note" rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="acts">
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Sending…' : 'Send suggestion'}</button>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
          {msg && <p className="note" role="alert">{msg}</p>}
          <p className="note">Nothing changes until they approve it.</p>
        </form>
      </div>
    </>
  );
}
