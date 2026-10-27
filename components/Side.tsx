'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtTime, fmtWhen, longDate } from '@/lib/format';
import { endOf, MIN } from '@/lib/time';
import { usePlanner, useLists } from './Planner';
import { ChatPanel, Composer } from './Chat';
import { CalendarIcon, CalendarPlusIcon, CaretIcon, CheckIcon, MoreIcon } from './icons';

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

export function NowBlock({ phone }: { phone?: boolean }) {
  const { store, now, done, schedule, openEditor } = usePlanner();
  const { focus: f } = useLists();
  const cur = f.now;
  let meta: React.ReactNode = 'Dump the next thing below.';
  if (!store.loaded) meta = '';
  else if (cur) {
    meta = <>{PRI[cur.priority]} · {fmtDur(cur.minutes)}{f.live ? ` · until ${fmtTime(endOf(cur))}` : <Due t={cur} />}</>;
  }
  let nextWhen = '';
  if (f.next) {
    if (f.next.start == null) nextWhen = 'Backlog';
    else if (f.next.start - now < 3600000) nextWhen = `in ${Math.max(1, Math.round((f.next.start - now) / MIN))} min`;
    else nextWhen = fmtTime(f.next.start);
  }
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

export function BacklogRows({ phone }: { phone?: boolean }) {
  const { store } = usePlanner();
  const { backlog, missed, done } = useLists();
  const [doneOpen, setDoneOpen] = useState(false);
  const stagger = useStagger(phone ? 0.22 : 0.16, phone ? 0.07 : 0.06);
  const Row = phone ? PhoneRow : LaptopRow;
  // The backlog is ranked by priority already; a heading per priority says so once instead of on every row.
  const groups = ([1, 2, 3] as const).map(p => ({ p, list: backlog.filter(t => t.priority === p) })).filter(g => g.list.length);
  let i = 0;
  return (
    <>
      {missed.length > 0 && <div className="gh in"><span>Missed</span><span>{missed.length}</span></div>}
      {missed.map(t => <Row key={t.id} t={t} kind="missed" delay={stagger(i++)} />)}
      {groups.map(({ p, list }) => (
        <Fragment key={p}>
          <div className="gh in"><span>{PRI[p]}</span><span>{list.length}</span></div>
          {list.map(t => <Row key={t.id} t={t} kind="open" delay={stagger(i++)} />)}
        </Fragment>
      ))}
      {store.loaded && !backlog.length && !missed.length && (
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
  const { now, setPhoneView, openSettings, chat } = usePlanner();
  const { backlog } = useLists();
  // The conversation and the list are different pages: each opens at its top.
  useEffect(() => { window.scrollTo(0, 0); }, [chat.open]);
  return (
    <>
      {chat.open ? <ChatPanel phone /> : (
        <div className="screen">
          <header className="hdr in">
            <span className="date">{longDate(now)}</span>
            <div className="tools">
              <button type="button" className="ib quiet" aria-label="Settings" data-settings-button="" onClick={() => openSettings()}><MoreIcon /></button>
              <button type="button" className="ib" aria-label="Open calendar" onClick={() => setPhoneView('calendar')}><CalendarIcon /></button>
            </div>
          </header>
          <Inbox />
          <NowBlock phone />
          <div className="sh in" style={{ animationDelay: '.16s' }}><span>Backlog</span><span>{backlog.length}</span></div>
          <BacklogRows phone />
        </div>
      )}
      <div className="capwrap in" style={{ animationDelay: chat.open ? '0s' : '.3s' }}><Composer phone /></div>
    </>
  );
}

export function LaptopSide() {
  const { now, openSettings, drag, chat } = usePlanner();
  const { backlog } = useLists();
  const dropOk = drag.view?.kind === 'block' && drag.view.overBacklog;
  return (
    <aside className={'side' + (dropOk ? ' drop-ok' : '')} aria-label={chat.open ? 'Dump' : 'Now and backlog'} data-backlog={chat.open ? undefined : ''}>
      <div className="dateline in">
        <span className="date">{longDate(now)} · {fmtTime(now)}</span>
        <button type="button" className="ib quiet" aria-label="Settings" data-settings-button="" onClick={() => openSettings()}><MoreIcon size={18} /></button>
      </div>
      {chat.open ? <ChatPanel /> : (
        <>
          <Inbox />
          <NowBlock />
          <div className="sh in" style={{ animationDelay: '.12s' }}><span>Backlog · {backlog.length}</span><em>Drag onto the calendar</em></div>
          <div className="rows"><BacklogRows /></div>
        </>
      )}
      <div className="capdock in" style={{ animationDelay: '.3s' }}><Composer /></div>
    </aside>
  );
}
