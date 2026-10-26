'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtTime, fmtWhen, longDate } from '@/lib/format';
import { endOf, MIN } from '@/lib/time';
import { usePlanner, useLists } from './Planner';
import { useVoice } from './hooks';
import { CalendarIcon, CalendarPlusIcon, CaretIcon, CheckIcon, MicIcon, MoreIcon, StopIcon } from './icons';
import { Brand, Mark } from './Brand';
import { View } from './Scene';

/** Rows fade up in a stagger on first load; rows added later appear straight away. */
function useStagger(base: number, step: number) {
  const t0 = useRef(performance.now());
  return (i: number) => (performance.now() - t0.current < 1500 ? `${(base + i * step).toFixed(2)}s` : '0s');
}

/** "Due tomorrow", after a " · " unless it starts the line. */
function Due({ t, first }: { t: Task; first?: boolean }) {
  const { now } = usePlanner();
  if (!t.due) return null;
  const d = dueLabel(t.due, now);
  return <>{first ? null : ' · '}<span className={d.hot ? 'hot' : undefined}>{d.text}</span></>;
}

/* ---------- Now ---------- */

/** When the next task is: "in 5 min" within the hour, its time after that, or Backlog when it has none. */
function whenLabel(t: Task, now: number) {
  if (t.start == null) return 'Backlog';
  if (t.start - now < 3600000) return `in ${Math.max(1, Math.round((t.start - now) / MIN))} min`;
  return fmtTime(t.start);
}

export function NowBlock({ phone }: { phone?: boolean }) {
  const { store, now, done, schedule, openEditor } = usePlanner();
  const { focus: f } = useLists();
  const cur = f.now;
  let meta: React.ReactNode = 'Dump the next thing below.';
  if (!store.loaded) meta = '';
  else if (cur) {
    meta = <>{PRI[cur.priority]} · {fmtDur(cur.minutes)}{f.live ? ` · until ${fmtTime(endOf(cur))}` : <Due t={cur} />}</>;
  }
  const nextWhen = f.next ? whenLabel(f.next, now) : '';
  return (
    <section className="now in" aria-label="Now" aria-live="polite" style={{ animationDelay: phone ? '.08s' : '.06s' }}>
      <div className="nl"><i aria-hidden="true" />Now</div>
      {!store.loaded ? (
        <h1 className="nt quiet">Opening your list…</h1>
      ) : cur ? (
        <h1 className="nt" key={cur.id}><button type="button" onClick={() => openEditor(cur.id)}>{cur.title}</button></h1>
      ) : (
        <h1 className="nt">All clear.</h1>
      )}
      <div className="nm">{meta}</div>
      {cur && (
        <div className="acts">
          <button type="button" className="btn pri" onClick={() => done(cur.id)}>Done</button>
          <button type="button" className="btn sec" onClick={() => schedule(cur.id)}>Schedule</button>
        </div>
      )}
      {!phone && f.next && (
        <div className="next"><span>Next · {nextWhen}</span><button type="button" onClick={() => openEditor(f.next!.id)}>{f.next.title}</button></div>
      )}
    </section>
  );
}

/* ---------- Next, on a split-flap board (laptop, with a view) ---------- */

function Flaps({ text, max }: { text: string; max: number }) {
  const t = text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  // Keyed by the text, so a change flips every tile in.
  return (
    <span className="flaps" key={t} aria-hidden="true">
      {[...t.toUpperCase()].map((c, i) => (
        <span key={i} className={'flap' + (c === ' ' ? ' gap' : '')} style={{ animationDelay: `${(i * 0.03).toFixed(2)}s` }}>{c === ' ' ? '' : c}</span>
      ))}
    </span>
  );
}

export function NextBoard() {
  const { now, openEditor } = usePlanner();
  const { focus: f } = useLists();
  const next = f.next;
  const when = next ? whenLabel(next, now) : '';
  return (
    <button type="button" className="board in" disabled={!next} aria-label={next ? `Next, ${when}: ${next.title}` : 'Nothing next'}
      onClick={() => next && openEditor(next.id)}>
      <span className="bh"><span>Next</span>{next && <Flaps text={when} max={9} />}</span>
      <Flaps text={next ? next.title : 'Nothing next'} max={18} />
    </button>
  );
}

/* ---------- Backlog ---------- */

function Check({ t, small }: { t: Task; small?: boolean }) {
  const { done, completing } = usePlanner();
  const isDone = t.status === 'done' || completing.has(t.id);
  return (
    <button type="button" className="ck" aria-label={`${isDone ? 'Mark not done' : 'Mark done'}: ${t.title}`}
      onClick={() => { if (!completing.has(t.id)) done(t.id, true); }}>
      <span><CheckIcon size={small ? 10 : 11} /></span>
    </button>
  );
}

function PhoneRow({ t, kind, delay }: { t: Task; kind: 'open' | 'missed' | 'done'; delay: string }) {
  const { completing, openEditor, slot, now, picked } = usePlanner();
  const cls = 'row' + (t.status === 'done' || completing.has(t.id) ? ' done' : '') + (picked === t.id ? ' picked' : '');
  return (
    <div className={cls} style={{ animationDelay: delay }}>
      <Check t={t} />
      <button type="button" className="main" onClick={() => openEditor(t.id)}>
        <div className="rt"><span>{t.title}</span></div>
        {(kind !== 'open' || t.due) && (
          <div className="rp">
            {kind === 'missed' && t.start != null ? fmtWhen(t.start, now)
              : kind === 'done' ? <>Done{t.doneAt ? ` · ${fmtWhen(t.doneAt, now)}` : ''}</>
              : <Due t={t} first />}
          </div>
        )}
      </button>
      {kind === 'missed'
        ? <button type="button" className="txt reslot" onClick={() => slot(t.id)}>Reslot</button>
        : <span className="rd">{fmtDur(t.minutes)}</span>}
    </div>
  );
}

function LaptopRow({ t, kind, delay }: { t: Task; kind: 'open' | 'missed' | 'done'; delay: string }) {
  const { completing, openEditor, slot, now, picked, setPicked, drag } = usePlanner();
  const lifting = drag.view?.id === t.id && drag.view.kind === 'row';
  const cls = 'row' + (t.status === 'done' || completing.has(t.id) ? ' done' : '') + (picked === t.id ? ' picked' : '')
    + (lifting ? ' lifting' : '') + (kind === 'missed' ? ' wide' : '');
  const canDrag = kind !== 'done';
  return (
    <div className={cls} style={{ animationDelay: delay }}>
      <Check t={t} small />
      <button type="button" className="pick" aria-pressed={picked === t.id}
        aria-label={kind === 'done' ? `Edit: ${t.title}` : undefined}
        title={kind === 'done' ? undefined : 'Click, then click a time. Double-click to edit.'}
        onPointerDown={canDrag ? e => drag.begin(e, 'row', t.id) : undefined}
        onClick={() => {
          if (drag.ignoreClick()) return;
          if (kind === 'done') openEditor(t.id);
          else setPicked(picked === t.id ? null : t.id);
        }}
        onDoubleClick={() => { setPicked(null); openEditor(t.id); }}
        onKeyDown={e => { if (e.key === 'e' || e.key === 'E') { e.preventDefault(); openEditor(t.id); } }}>
        <span className="rt"><span>{t.title}</span></span>
        <span className="rp">
          {kind === 'missed' && t.start != null ? <>{fmtWhen(t.start, now)} · {fmtDur(t.minutes)}</>
            : kind === 'done' ? <>Done{t.doneAt ? ` · ${fmtWhen(t.doneAt, now)}` : ''}</>
            : <>{fmtDur(t.minutes)}<Due t={t} /></>}
        </span>
      </button>
      {kind === 'missed' ? (
        <button type="button" className="txt reslot" aria-label={`Reslot: ${t.title}`} title="Next free slot" onClick={() => slot(t.id)}>Reslot</button>
      ) : kind === 'open' ? (
        <button type="button" className="sched" aria-label={`Put in the next free slot: ${t.title}`} title="Next free slot" onClick={() => slot(t.id)}>
          <CalendarPlusIcon />
        </button>
      ) : <span />}
    </div>
  );
}

function SortingRow({ text, phone }: { text: string; phone?: boolean }) {
  return (
    <div className="row sorting" aria-live="polite">
      <span className="ck" aria-hidden="true"><span /></span>
      <div className={phone ? 'main' : 'pick'}>
        <div className="rt"><span>{text}</span></div>
        <div className="rp">Sorting…</div>
      </div>
      <span />
    </div>
  );
}

export function BacklogRows({ phone }: { phone?: boolean }) {
  const { pending, store } = usePlanner();
  const { backlog, missed, done } = useLists();
  const [doneOpen, setDoneOpen] = useState(false);
  const stagger = useStagger(phone ? 0.22 : 0.16, phone ? 0.07 : 0.06);
  const Row = phone ? PhoneRow : LaptopRow;
  // The backlog is ranked by priority already; a heading per priority says so once instead of on every row.
  const groups = ([1, 2, 3] as const).map(p => ({ p, list: backlog.filter(t => t.priority === p) })).filter(g => g.list.length);
  let i = 0;
  return (
    <>
      {pending.map(p => <SortingRow key={p.id} text={p.text} phone={phone} />)}
      {missed.length > 0 && <div className="gh in"><span>Missed</span><span>{missed.length}</span></div>}
      {missed.map(t => <Row key={t.id} t={t} kind="missed" delay={stagger(i++)} />)}
      {groups.map(({ p, list }) => (
        <Fragment key={p}>
          <div className="gh in"><span>{PRI[p]}</span><span>{list.length}</span></div>
          {list.map(t => <Row key={t.id} t={t} kind="open" delay={stagger(i++)} />)}
        </Fragment>
      ))}
      {store.loaded && !backlog.length && !missed.length && !pending.length && (
        <p className="empty in">Nothing waiting. Mention a day or time and it goes on the calendar; anything else waits here.</p>
      )}
      {done.length > 0 && (
        <>
          <div className="gh">
            <button type="button" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}><CaretIcon /> Done</button>
            <span>{done.length}</span>
          </div>
          {doneOpen && done.map(t => <Row key={t.id} t={t} kind="done" delay="0s" />)}
        </>
      )}
    </>
  );
}

/* ---------- Capture ---------- */

const DRAFT = 'ds.draft';

export function CaptureBar({ phone }: { phone?: boolean }) {
  const { capture, toast } = usePlanner();
  const [text, setTextState] = useState('');
  const textRef = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const setText = (v: string) => {
    textRef.current = v; setTextState(v);
    try { localStorage.setItem(DRAFT, v); } catch { /* draft is a nicety */ }
  };
  useEffect(() => { try { const d = localStorage.getItem(DRAFT); if (d) { textRef.current = d; setTextState(d); } } catch { /* none */ } }, []);
  const voice = useVoice({
    getValue: () => textRef.current,
    setValue: setText,
    focusField: () => input.current?.focus(),
    hint: msg => toast(msg),
  });
  const id = phone ? 'dump-ph' : 'dump-lp';
  return (
    <form className={'cap' + (phone ? '' : ' in')} style={phone ? undefined : { animationDelay: '.3s' }} autoComplete="off"
      onSubmit={e => {
        e.preventDefault();
        const v = textRef.current.trim();
        if (!v) { input.current?.focus(); return; }
        voice.stopVoice();
        setText('');
        capture(v);
      }}>
      <div className="field">
        <label className="sr" htmlFor={id}>Dump a task</label>
        <input id={id} ref={input} type="text" enterKeyHint="send" placeholder={voice.listening ? 'Listening…' : 'Dump a task…'}
          value={text} onChange={e => setText(e.target.value)} />
      </div>
      <button type="button" className={'mic' + (voice.listening ? ' on' : '')} aria-pressed={voice.listening}
        aria-label={voice.listening ? 'Stop listening' : 'Speak a task'} onClick={voice.startVoice}>
        {voice.listening ? <StopIcon size={phone ? 18 : 16} /> : <MicIcon size={phone ? 22 : 20} />}
      </button>
    </form>
  );
}

/* ---------- layouts ---------- */

/** Suggestions from people you share with: a quiet way into Settings → Sharing. */
function Inbox() {
  const { inbox, openSettings } = usePlanner();
  if (!inbox) return null;
  return (
    <button type="button" className="inbox" onClick={() => openSettings('sharing')}>
      <i aria-hidden="true" />{inbox} suggestion{inbox === 1 ? '' : 's'}
    </button>
  );
}

export function PhoneScreen() {
  const { now, setPhoneView, openSettings } = usePlanner();
  const { backlog } = useLists();
  return (
    <>
      <div className="screen">
        <div className="hero">
          <View kind="strip" />
          <header className="hdr in">
            <span className="date"><Mark size={22} />{longDate(now)}</span>
            <div className="tools">
              <button type="button" className="ib quiet" aria-label="Settings" data-settings-button="" onClick={() => openSettings()}><MoreIcon /></button>
              <button type="button" className="ib" aria-label="Open calendar" onClick={() => setPhoneView('calendar')}><CalendarIcon /></button>
            </div>
          </header>
          <NowBlock phone />
        </div>
        <section className="blist in" aria-label="Backlog" style={{ animationDelay: '.16s' }}>
          <Inbox />
          <div className="sh"><span>Backlog</span><span>{backlog.length}</span></div>
          <BacklogRows phone />
        </section>
      </div>
      <div className="capwrap in" style={{ animationDelay: '.3s' }}><CaptureBar phone /></div>
    </>
  );
}

/** Across the top on a laptop: the name, the date and time, and Settings. */
export function LaptopTop() {
  const { now, openSettings } = usePlanner();
  return (
    <header className="top in">
      <Brand />
      <div className="end">
        <span className="date">{longDate(now)} · {fmtTime(now)}</span>
        <button type="button" className="ib" aria-label="Settings" data-settings-button="" onClick={() => openSettings()}><MoreIcon size={18} /></button>
      </div>
    </header>
  );
}

export function LaptopSide() {
  const { drag } = usePlanner();
  const { backlog } = useLists();
  const dropOk = drag.view?.kind === 'block' && drag.view.overBacklog;
  return (
    <aside className={'side' + (dropOk ? ' drop-ok' : '')} aria-label="Backlog" data-backlog="">
      <NextBoard />
      <Inbox />
      <div className="sh in" style={{ animationDelay: '.12s' }}><span>Backlog · {backlog.length}</span><em>Drag onto the calendar</em></div>
      <div className="rows"><BacklogRows /></div>
      <CaptureBar />
    </aside>
  );
}
