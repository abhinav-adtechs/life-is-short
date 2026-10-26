'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtAgo, fmtWhen, shortTitle } from '@/lib/format';
import {
  CAL_LABELS, DEFAULT_SCOPE, DURATIONS, eventText, isEmail, requestTask, requestWhen, scopeOk, scopeParts, shareEnds, shareUrl, whoOf,
  type CalScope, type Scope, type Share, type SharedData, type ShareList, type ShareRequest,
} from '@/lib/share';
import { createShare, decideRequest, deleteShare, loadShares, previewShare, revokeShare, sharingProblem, updateShare } from '@/lib/share-client';
import { usePlanner } from './Planner';
import { useMedia } from './hooks';
import { BackIcon, CaretIcon } from './icons';
import { Choice, Opt } from './Controls';
import { SharedView } from './SharedView';

const PROBLEMS: Record<string, string> = {
  'server-key': 'Sharing isn’t set up on the server yet: SHARE_SERVER_KEY is missing. Links work once it’s added.',
  email: 'There’s no email service on the server (RESEND_API_KEY and SHARE_EMAIL_FROM), so nobody can get a sign-in code yet.',
  'no-key': 'The database doesn’t know the server’s key yet. Run private.set_share_key_hash in the SQL editor (see docs/setup.md).',
  'wrong-key': 'SHARE_SERVER_KEY doesn’t match the key the database holds, so nobody can sign in. See docs/setup.md.',
  unreachable: 'Couldn’t check the sharing setup on the server.',
};

const when = (ms: number, now: number) => (now - ms < 864e5 ? fmtAgo(ms, now) : fmtWhen(ms, now));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Settings → Sharing: who can see your planner and what, what they've done, and their suggestions.
 * Everything here comes from the database's share_* functions (supabase/migrations/0005).
 */
export function SharingSection() {
  const { refreshInbox } = usePlanner();
  const [list, setList] = useState<ShareList | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ share: Share; data: SharedData } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      setList(await loadShares());
      setFailed(null);
    } catch (e) {
      // Code deployed, database not migrated yet.
      setFailed(e instanceof Error && /function|schema cache/i.test(e.message) ? 'migration' : 'error');
    }
    setNow(Date.now());
    refreshInbox();
  }, [refreshInbox]);

  // Fresh while you're looking: someone may be signing in right now.
  useEffect(() => {
    reload();
    sharingProblem().then(setProblem);
    const timer = window.setInterval(() => { if (!document.hidden) reload(); }, 60000);
    const vis = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
  }, [reload]);

  const live = list?.shares.filter(s => s.live) ?? [];
  const ended = list?.shares.filter(s => !s.live) ?? [];
  const pending = list?.requests.filter(r => r.status === 'pending') ?? [];
  const signedIn = live.reduce((n, s) => n + s.sessions.length, 0);
  const lastSeen = Math.max(0, ...live.map(s => s.lastSeenAt ?? 0));

  return (
    <section id="set-sharing" className="sp-sec" aria-labelledby="set-sharing-h">
      <h2 id="set-sharing-h">Sharing</h2>
      <p className="lead">
        Let someone see your planner, view only. They sign in with a code sent to their email, see only what you pick, and can
        suggest tasks for you to approve. Notes and the words of your dumps are never shared.
      </p>
      {problem && PROBLEMS[problem] && failed !== 'migration' && <p className="sh-warn" role="status">{PROBLEMS[problem]}</p>}
      {failed === 'migration' && <p className="sh-warn" role="alert">Sharing needs the database update in supabase/migrations/0005_sharing.sql. Run it in the Supabase SQL editor.</p>}
      {failed === 'error' && <p className="sh-warn" role="alert">Couldn’t load your shares. <button type="button" className="link" onClick={reload}>Try again</button></p>}

      {list && (
        <p className="sh-sum" role="status">
          {live.length
            ? <>{plural(live.length, 'person', 'people')} can see your planner{signedIn ? ` · ${plural(signedIn, 'device')} signed in` : ''}{lastSeen ? ` · last viewed ${fmtAgo(lastSeen, now)}` : ''}</>
            : 'Nobody can see your planner.'}
        </p>
      )}

      {pending.length > 0 && (
        <>
          <div className="gh"><span>Suggestions waiting for you</span><span>{pending.length}</span></div>
          {pending.map(r => <RequestCard key={r.id} r={r} now={now} reload={reload} />)}
        </>
      )}

      {live.length > 0 && <div className="gh"><span>Who can see it</span><span>{live.length}</span></div>}
      {live.map(s => (
        <ShareCard key={s.id} s={s} now={now} fresh={fresh === s.id} reload={reload}
          onPreview={async () => {
            try { const data = await previewShare(s.id); if (data) setPreview({ share: s, data }); } catch { /* reload shows the error */ }
          }} />
      ))}

      {creating ? (
        <ShareForm onCancel={() => setCreating(false)} onSaved={id => { setCreating(false); setFresh(id); reload(); }} />
      ) : (
        <div className="sacts">
          <button type="button" className={'btn ' + (live.length ? 'sec' : 'pri')} disabled={!list} onClick={() => { setCreating(true); setFresh(null); }}>
            New share
          </button>
        </div>
      )}

      {list && <Activity list={list} now={now} />}

      {ended.length > 0 && <Ended shares={ended} now={now} reload={reload} />}

      {preview && <Preview share={preview.share} data={preview.data} onClose={() => setPreview(null)} />}
    </section>
  );
}

/* ---------- suggestions ---------- */

function RequestCard({ r, now, reload }: { r: ShareRequest; now: number; reload: () => void }) {
  const { store, toast } = usePlanner();
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    // The task first (its id comes from the suggestion, so a second approval rewrites it), then the decision.
    const before = store.write([requestTask(r)]);
    const res = await decideRequest(r.id, 'approved').catch(() => null);
    setBusy(false);
    if (res !== 'ok') { store.restore(before); toast('Couldn’t approve it. Try again.'); return; }
    reload();
    toast(`Added: ${shortTitle(r.title)}${r.kind === 'calendar' && r.start != null ? ` · ${fmtWhen(r.start)}` : ''}`, () => {
      store.restore(before);
      decideRequest(r.id, 'pending').catch(() => null).then(reload);
    });
  };

  const decline = async () => {
    setBusy(true);
    const res = await decideRequest(r.id, 'declined').catch(() => null);
    setBusy(false);
    if (res !== 'ok') { toast('Couldn’t decline it. Try again.'); return; }
    reload();
    toast(`Declined: ${shortTitle(r.title)}`, () => { decideRequest(r.id, 'pending').catch(() => null).then(reload); });
  };

  const past = r.kind === 'calendar' && r.start != null && r.start < now;
  return (
    <div className="sh-card req">
      <div className="sh-h">
        <div className="who"><b>{r.title}</b><span>{requestWhen(r, now)}{past ? ' · that time has passed' : ''}</span></div>
      </div>
      <p className="sh-meta">From {whoOf(r)} · {when(r.createdAt, now)}</p>
      {r.note && <p className="sh-note">“{r.note}”</p>}
      <div className="sacts">
        <button type="button" className="btn pri" disabled={busy} onClick={approve}>{r.kind === 'calendar' ? 'Add to calendar' : 'Add to backlog'}</button>
        <button type="button" className="btn sec" disabled={busy} onClick={decline}>Decline</button>
      </div>
    </div>
  );
}

/* ---------- shares ---------- */

function LinkBox({ s, highlight }: { s: Share; highlight?: boolean }) {
  const { toast } = usePlanner();
  const url = typeof window === 'undefined' ? '' : shareUrl(window.location.origin, s.link);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = () => {
    const done = navigator.clipboard?.writeText(url);
    if (!done) { toast('Couldn’t copy. Select the link and copy it.'); return; }
    done.then(() => toast('Link copied'), () => toast('Couldn’t copy. Select the link and copy it.'));
  };
  return (
    <div className={'sh-link' + (highlight ? ' fresh' : '')}>
      <input readOnly aria-label={`Link for ${s.email}`} value={url} onFocus={e => e.currentTarget.select()} />
      <button type="button" className="btn pri" onClick={copy}>Copy link</button>
      {canShare && <button type="button" className="btn sec" onClick={() => navigator.share({ title: 'My planner', url }).catch(() => undefined)}>Share…</button>}
    </div>
  );
}

function ShareCard({ s, now, fresh, reload, onPreview }: { s: Share; now: number; fresh: boolean; reload: () => void; onPreview: () => void }) {
  const { toast } = usePlanner();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [linkOpen, setLinkOpen] = useState(fresh);
  useEffect(() => { if (fresh) setLinkOpen(true); }, [fresh]);
  const devices = [...new Set(s.sessions.map(x => x.device || 'Unknown device'))];

  const stop = async () => {
    const res = await revokeShare(s.id).catch(() => null);
    toast(res === 'ok' ? `Stopped sharing with ${whoOf(s)}. They were signed out.` : 'Couldn’t stop sharing. Try again.');
    reload();
  };
  const signOutAll = async () => {
    const res = await updateShare(s.id, { endSessions: true }).catch(() => null);
    toast(res === 'ok' ? `Signed ${whoOf(s)} out. They can sign in again with a new code.` : 'Couldn’t sign them out. Try again.');
    reload();
  };

  return (
    <div className={'sh-card' + (fresh ? ' fresh' : '')}>
      <div className="sh-h">
        <div className="who"><b>{whoOf(s)}</b><span>{s.name ? `${s.email} · ` : ''}{shareEnds(s, now)}</span></div>
        <button type="button" className="btn sec" aria-expanded={linkOpen} onClick={() => setLinkOpen(o => !o)}>Link</button>
      </div>
      {linkOpen && (
        <>
          <LinkBox s={s} highlight={fresh} />
          <p className="note">{fresh ? 'Your link is ready. ' : ''}Send it to {s.email}. They sign in with a code sent to that address, so the link alone isn’t enough.</p>
        </>
      )}
      <p className="sh-scope">{scopeParts(s.scope).join(' · ')}</p>
      <p className="sh-meta">
        {s.lastSeenAt ? `Last viewed ${when(s.lastSeenAt, now)}` : 'Not opened yet'}
        {s.views ? ` · ${plural(s.views, 'visit')}` : ''}
        {devices.length ? ` · Signed in on ${devices.join(', ')}` : ''}
        {s.pending ? ` · ${plural(s.pending, 'suggestion')} waiting` : ''}
      </p>
      {editing && <ShareForm share={s} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      <div className="acct-f">
        {confirm ? (
          <>
            <span>Stop sharing with {whoOf(s)}? The link stops working and they’re signed out.</span>
            <button type="button" className="btn sec" onClick={stop}>Stop sharing</button>
            <button type="button" className="link" onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="link" onClick={onPreview}>See what they see</button>
            {!editing && <button type="button" className="link" onClick={() => setEditing(true)}>Change</button>}
            {s.sessions.length > 0 && <button type="button" className="link" onClick={signOutAll}>Sign them out</button>}
            <button type="button" className="link armed" onClick={() => setConfirm(true)}>Stop sharing</button>
          </>
        )}
      </div>
    </div>
  );
}

type Duration = number | null | 'keep';

/** New share, or changes to one: who, what they see, and for how long. */
function ShareForm({ share, onCancel, onSaved }: { share?: Share; onCancel: () => void; onSaved: (id: string) => void }) {
  const { toast } = usePlanner();
  const [email, setEmail] = useState(share?.email ?? '');
  const [name, setName] = useState(share?.name ?? '');
  const [scope, setScope] = useState<Scope>(share?.scope ?? DEFAULT_SCOPE);
  const [days, setDays] = useState<Duration>(share ? 'keep' : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (patch: Partial<Scope>) => setScope(s => ({ ...s, ...patch }));
  const durations: { value: Duration; label: string }[] = [
    ...(share ? [{ value: 'keep' as const, label: 'Keep' }] : []),
    ...DURATIONS.map(d => ({ value: d.days as Duration, label: d.label })),
  ];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!share && !isEmail(email)) { setMsg('Enter their email address.'); return; }
    if (!scopeOk(scope)) { setMsg('Pick the backlog, the calendar or both.'); return; }
    setBusy(true); setMsg('');
    try {
      if (share) {
        const res = await updateShare(share.id, { name, scope, ...(days === 'keep' ? {} : { days }) });
        if (res !== 'ok') throw new Error(res || '');
        toast(`Saved. ${whoOf({ name, email: share.email })} sees the change next time they look.`);
        onSaved(share.id);
      } else {
        const res = await createShare({ email, name, scope, days: days === 'keep' ? null : days });
        if (!res?.id) {
          setMsg(res?.error === 'too-many' ? 'That’s the most shares at once. Stop one first.' : res?.error === 'invalid-email' ? 'That email doesn’t look right.' : 'Couldn’t create the share. Try again.');
          return;
        }
        onSaved(res.id);
      }
    } catch {
      setMsg('Couldn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sh-form" onSubmit={save} autoComplete="off">
      {!share && (
        <div className="fld"><label htmlFor="sh-email">Their email</label>
          <input id="sh-email" type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></div>
      )}
      <div className="fld"><label htmlFor={`sh-name-${share?.id ?? 'new'}`}>Name (optional, only you see it)</label>
        <input id={`sh-name-${share?.id ?? 'new'}`} maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mum" /></div>

      <p className="flabel sh-what">What they can see</p>
      <Opt label="Backlog" note="Open tasks that aren’t on the calendar yet." toggle={{ checked: scope.backlog, onChange: backlog => set({ backlog }) }} />
      <Opt label="Calendar" note="Today: just today. Upcoming: today onward. All: the past year too." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={scope.calendar} onChange={(calendar: CalScope) => set({ calendar })}
            options={(['none', 'today', 'upcoming', 'all'] as CalScope[]).map(v => ({ value: v, label: CAL_LABELS[v] }))} />
        )}
      </Opt>
      {scope.calendar !== 'none' && (
        <Opt label="Calendar details" note="Busy only shows when you’re busy, without titles." stack>
          {({ labelId }) => (
            <Choice labelledBy={labelId} value={scope.details} onChange={details => set({ details })}
              options={[{ value: 'titles', label: 'Titles' }, { value: 'busy', label: 'Busy only' }]} />
          )}
        </Opt>
      )}
      <Opt label="Items from Google" note="Events and Google Tasks pulled from your accounts. Calendars you switched off and hidden accounts are never shared."
        toggle={{ checked: scope.google, onChange: google => set({ google }) }} />
      <Opt label="Suggestions" note="They can suggest a backlog task or a time on your calendar. Nothing changes until you approve it."
        toggle={{ checked: scope.suggest, onChange: suggest => set({ suggest }) }} />
      <Opt label="How long" note={share ? `Now: ${shareEnds(share).toLowerCase()}. A new length counts from today.` : 'You can stop sharing at any time.'} stack>
        {({ labelId }) => <Choice labelledBy={labelId} value={days} onChange={setDays} options={durations} />}
      </Opt>

      <div className="sacts">
        <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : share ? 'Save changes' : 'Create link'}</button>
        <button type="button" className="btn sec" onClick={onCancel}>Cancel</button>
      </div>
      {msg && <p className="note" role="alert">{msg}</p>}
    </form>
  );
}

/* ---------- activity ---------- */

function Activity({ list, now }: { list: ShareList; now: number }) {
  const [all, setAll] = useState(false);
  const byId = new Map(list.shares.map(s => [s.id, s]));
  const shown = all ? list.events : list.events.slice(0, 12);
  return (
    <>
      <div className="gh"><span>Activity</span><span>{list.events.length ? (list.events.length >= 200 ? 'latest 200' : list.events.length) : ''}</span></div>
      {list.events.length ? (
        <ul className="sh-log">
          {shown.map((e, i) => (
            <li key={`${e.at}-${i}`} className={e.kind === 'wrong-code' ? 'warn' : undefined}>
              <span>{eventText(e, byId.get(e.shareId))}</span>
              <em>{e.device ? `${e.device} · ` : ''}{when(e.at, now)}</em>
            </li>
          ))}
        </ul>
      ) : <p className="note">Every sign-in, view, wrong code and suggestion shows up here.</p>}
      {list.events.length > shown.length && <div className="sacts"><button type="button" className="link" onClick={() => setAll(true)}>Show all activity</button></div>}
    </>
  );
}

function Ended({ shares, now, reload }: { shares: Share[]; now: number; reload: () => void }) {
  const { toast } = usePlanner();
  const [open, setOpen] = useState(false);
  const forget = async (s: Share) => {
    const res = await deleteShare(s.id).catch(() => null);
    toast(res === 'ok' ? `Removed ${whoOf(s)} and their activity` : 'Couldn’t remove it. Try again.');
    reload();
  };
  return (
    <>
      <div className="gh">
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}><CaretIcon /> Ended</button>
        <span>{shares.length}</span>
      </div>
      {open && shares.map(s => (
        <div key={s.id} className="sh-card ended">
          <div className="sh-h">
            <div className="who"><b>{whoOf(s)}</b><span>{s.name ? `${s.email} · ` : ''}{shareEnds(s, now)}</span></div>
            <button type="button" className="link" onClick={() => forget(s)}>Remove</button>
          </div>
          <p className="sh-meta">{scopeParts(s.scope).join(' · ')}{s.lastSeenAt ? ` · last viewed ${when(s.lastSeenAt, now)}` : ' · never opened'}</p>
        </div>
      ))}
    </>
  );
}

/* ---------- preview ---------- */

/** Exactly what they see right now, full screen over Settings. */
function Preview({ share, data, onClose }: { share: Share; data: SharedData; onClose: () => void }) {
  const wide = useMedia('(min-width: 860px)');
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => { page.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    // Esc closes the preview, not Settings behind it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const top = (
    <header className="vw-top">
      <div className="vw-h"><h1>Shared planner</h1><span className="vw-pill">View only</span></div>
      <p className="vw-sub">Signed in as {share.email} · {data.expiresAt ? shareEnds(share) : 'No end date'}</p>
      {data.scope.suggest && <p className="note">They also see buttons to suggest a task{data.calendar ? ' or a time' : ''}.</p>}
    </header>
  );
  return (
    <div className="setpage vw-preview" role="dialog" aria-modal="true" aria-labelledby="pv-h" tabIndex={-1} ref={page}>
      <header className="sp-top">
        <button type="button" className="ib" aria-label="Back to Sharing" onClick={onClose}><BackIcon /></button>
        <h1 id="pv-h">What {whoOf(share)} sees</h1>
        <span className="sp-saved">Right now, as they’d see it</span>
      </header>
      <SharedView data={data} wide={wide} now={Date.now()} top={top} />
    </div>
  );
}
