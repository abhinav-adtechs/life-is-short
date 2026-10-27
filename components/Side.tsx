'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtTime, fmtWhen, longDate } from '@/lib/format';
import { groupBacklog, type BacklogBy } from '@/lib/select';
import { DEFAULT_LENS } from '@/lib/labels';
import { endOf, MIN } from '@/lib/time';
import { usePlanner, useLists } from './Planner';
import { radio, radioKeys } from './Controls';
import { LensBar } from './Lens';
import { Matrix } from './Matrix';
import { ChatPanel, Composer } from './Chat';
import { CalendarIcon, CalendarPlusIcon, CaretIcon, CheckIcon, MoreIcon } from './icons';

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

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

/** What a backlog row's section doesn't already say: its label outside the label grouping, and Urgent outside the priority one. */
function useLead(t: Task) {
  const { prefs, labelOf } = usePlanner();
  const label = prefs.backlogBy === 'label' ? null : labelOf(t);
  const urgent = prefs.backlogBy !== 'priority' && t.priority === 1;
  if (!label && !urgent) return null;
  return <>{label?.name}{label && urgent ? ' · ' : ''}{urgent && <span className="hot">Urgent</span>}</>;
}

/* ---------- Now ---------- */

export function NowBlock({ phone }: { phone?: boolean }) {
  const { store, now, done, schedule, openEditor, labelOf } = usePlanner();
  const { focus: f } = useLists();
  const cur = f.now;
  let meta: React.ReactNode = 'Dump the next thing below.';
  if (!store.loaded) meta = '';
  else if (cur) {
    const label = labelOf(cur);
    meta = <>
      {label && <><span className="nlab" style={tint(label.color)}><i aria-hidden="true" />{label.name}</span> · </>}
      {PRI[cur.priority]} · {fmtDur(cur.minutes)}{f.live ? ` · until ${fmtTime(endOf(cur))}` : <Due t={cur} />}
    </>;
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
  const { completing, openEditor, slot, now, picked, labelOf } = usePlanner();
  const lead = useLead(t);
  const label = labelOf(t);
  const cls = 'row' + (t.status === 'done' || completing.has(t.id) ? ' done' : '') + (picked === t.id ? ' picked' : '') + (label ? ' lab' : '');
  return (
    <div className={cls} style={{ animationDelay: delay, ...tint(label?.color) }}>
      <Check t={t} />
      <button type="button" className="main" onClick={() => openEditor(t.id)}>
        <div className="rt"><span>{t.title}</span></div>
        {(kind !== 'open' || t.due || lead) && (
          <div className="rp">
            {kind === 'missed' && t.start != null ? fmtWhen(t.start, now)
              : kind === 'done' ? <>Done{t.doneAt ? ` · ${fmtWhen(t.doneAt, now)}` : ''}</>
              : <>{lead}<Due t={t} first={!lead} /></>}
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
  const { completing, openEditor, slot, now, picked, setPicked, drag, labelOf } = usePlanner();
  const lead = useLead(t);
  const label = labelOf(t);
  const lifting = drag.view?.id === t.id && drag.view.kind === 'row';
  const cls = 'row' + (t.status === 'done' || completing.has(t.id) ? ' done' : '') + (picked === t.id ? ' picked' : '')
    + (lifting ? ' lifting' : '') + (kind === 'missed' ? ' wide' : '') + (label ? ' lab' : '');
  const canDrag = kind !== 'done';
  return (
    <div className={cls} style={{ animationDelay: delay, ...tint(label?.color) }}>
      <Check t={t} small />
      <button type="button" className="pick" aria-pressed={picked === t.id}
        aria-label={kind === 'done' ? `Edit: ${t.title}` : undefined}
        title={kind === 'done' ? undefined : 'Drag onto the calendar, or click, then click a time. Double-click to edit.'}
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
            : <>{lead && <>{lead} · </>}{fmtDur(t.minutes)}<Due t={t} /></>}
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

const GROUPINGS: { value: BacklogBy; label: string; hint: string }[] = [
  { value: 'label', label: 'Label', hint: 'By label, then by when it’s due' },
  { value: 'time', label: 'Time', hint: 'By when it’s due, labels together' },
  { value: 'priority', label: 'Priority', hint: 'Urgent, Important, Later' },
];

/** How the backlog is split up. Follows you to your other devices. */
function GroupSwitch() {
  const { prefs, setPrefs } = usePlanner();
  return (
    <div className="seg mini" role="radiogroup" aria-label="Group the backlog by" onKeyDown={radioKeys}>
      {GROUPINGS.map(g => {
        const on = prefs.backlogBy === g.value;
        return <button key={g.value} type="button" {...radio(on)} className={on ? 'on' : ''} title={g.hint} onClick={() => setPrefs({ backlogBy: g.value })}>{g.label}</button>;
      })}
    </div>
  );
}

export function BacklogRows({ phone }: { phone?: boolean }) {
  const { store, prefs, labelOf, now, setLens } = usePlanner();
  const { backlog, missed, done, outside } = useLists();
  const [doneOpen, setDoneOpen] = useState(false);
  const stagger = useStagger(phone ? 0.22 : 0.16, phone ? 0.07 : 0.06);
  const Row = phone ? PhoneRow : LaptopRow;
  // Two axes: a section per label split by when it's due, or the other way round. A heading says each once instead of on every row.
  const groups = groupBacklog(backlog, prefs.backlogBy, { labels: prefs.labels, labelOf, now, weekStart: prefs.weekStart });
  let i = 0;
  return (
    <>
      {missed.length > 0 && <div className="gh in"><span>Missed</span><span>{missed.length}</span></div>}
      {missed.map(t => <Row key={t.id} t={t} kind="missed" delay={stagger(i++)} />)}
      {groups.map(g => (
        <Fragment key={g.key || '-'}>
          <div className="gh in"><span className={'ghn' + (g.color ? ' lab' : '')} style={tint(g.color)}>{g.color && <i aria-hidden="true" />}{g.name}</span><span>{g.count}</span></div>
          {g.subs.map(s => (
            <Fragment key={s.key}>
              {g.subs.length > 1 && <div className="gs">{s.name}</div>}
              {s.tasks.map(t => <Row key={t.id} t={t} kind="open" delay={stagger(i++)} />)}
            </Fragment>
          ))}
        </Fragment>
      ))}
      {store.loaded && !backlog.length && !missed.length && !outside && (
        <p className="empty in">Nothing waiting. Mention a day or time and it goes on the calendar; anything else waits here.</p>
      )}
      {outside > 0 && (
        <p className="mx-note">{outside} more outside this view. <button type="button" className="link inline" onClick={() => setLens(DEFAULT_LENS)}>Show everything</button></p>
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
          <LensBar phone />
          <div className="sh tabs in" style={{ animationDelay: '.16s' }}><span>Backlog · {backlog.length}</span><GroupSwitch /></div>
          <BacklogRows phone />
        </div>
      )}
      <div className="capwrap in" style={{ animationDelay: chat.open ? '0s' : '.3s' }}><Composer phone /></div>
    </>
  );
}

/** Laptop: what you missed, the matrix, and what's done. */
function LaptopBacklog() {
  const { missed, done } = useLists();
  const [doneOpen, setDoneOpen] = useState(false);
  const stagger = useStagger(0.16, 0.06);
  let i = 0;
  return (
    <>
      {missed.length > 0 && <div className="gh in"><span>Missed</span><span>{missed.length}</span></div>}
      {missed.map(t => <LaptopRow key={t.id} t={t} kind="missed" delay={stagger(i++)} />)}
      <Matrix />
      {done.length > 0 && (
        <>
          <div className="gh">
            <button type="button" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}><CaretIcon /> Done</button>
            <span>{done.length}</span>
          </div>
          {doneOpen && done.map(t => <LaptopRow key={t.id} t={t} kind="done" delay="0s" />)}
        </>
      )}
    </>
  );
}

export function LaptopSide() {
  const { now, openSettings, drag, split, chat } = usePlanner();
  const dropOk = drag.view?.kind === 'block' && drag.view.overBacklog;
  return (
    <aside className={'side' + (dropOk ? ' drop-ok' : '')} style={{ width: split.matrixW }} aria-label={chat.open ? 'Dump' : 'Now and backlog'} data-backlog={chat.open ? undefined : ''}>
      <div className="dateline in">
        <span className="date">{longDate(now)} · {fmtTime(now)}</span>
        <button type="button" className="ib quiet" aria-label="Settings" data-settings-button="" onClick={() => openSettings()}><MoreIcon size={18} /></button>
      </div>
      {chat.open ? <ChatPanel /> : (
        <>
          <Inbox />
          <NowBlock />
          <LensBar />
          <div className="rows"><LaptopBacklog /></div>
        </>
      )}
      <div className="capdock in" style={{ animationDelay: '.3s' }}><Composer /></div>
    </aside>
  );
}
