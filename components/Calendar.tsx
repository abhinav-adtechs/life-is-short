'use client';

import { useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import type { CalView } from '@/lib/prefs';
import { layoutDay, tasksOn } from '@/lib/select';
import { fmtHour, fmtRange, fmtShort, fmtTime, shortTitle } from '@/lib/format';
import { VIEW_LABELS, monthGrid, stepDay, viewDays, viewTitle } from '@/lib/calview';
import { DOW, DOWL, MIN, MON, addDays, atMinutes, endOf, isWeekend, isoWeek, minsOf, startOfDay, ymd } from '@/lib/time';
import { hourOf } from './drag';
import { usePlanner, useLists } from './Planner';
import { BackIcon, ChevronLeft, ChevronRight, XIcon } from './icons';

const tint = (color: string | null) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/** Visible hour range: your day, stretched to fit anything scheduled outside it. */
function hourRange(days: Date[], sched: Task[], base: [number, number]) {
  let [h0, h1] = base;
  for (const d of days) {
    const ds = startOfDay(d).getTime(), de = addDays(d, 1).getTime();
    for (const t of tasksOn(sched, d)) {
      const s = Math.max(t.start as number, ds), e = Math.min(endOf(t), de);
      h0 = Math.min(h0, Math.floor((s - ds) / 3600000));
      h1 = Math.max(h1, Math.ceil((e - ds) / 3600000));
    }
  }
  return [h0, Math.min(24, h1)] as const;
}

/** Floor a click to the 15-minute slot under the pointer. */
function clickMinute(col: HTMLElement, clientY: number) {
  const r = col.getBoundingClientRect();
  const h0 = Number(col.dataset.h0 || 9), h1 = Number(col.dataset.h1 || 21);
  const m = h0 * 60 + Math.floor(((clientY - r.top) / hourOf(col)) * 60 / 15) * 15;
  return Math.max(h0 * 60, Math.min(h1 * 60 - 15, m));
}

function Block({ t, lane, lanes, dayStart, h0, hour }: { t: Task; lane: number; lanes: number; dayStart: number; h0: number; hour: number }) {
  const { drag, openEditor, unslot, now, colorOf, prefs } = usePlanner();
  const resizing = drag.view?.kind === 'resize' && drag.view.id === t.id;
  const minutes = resizing && drag.view?.minutes != null ? drag.view.minutes : t.minutes;
  const sMin = Math.max(0, ((t.start as number) - dayStart) / MIN);
  const eMin = Math.min(24 * 60, sMin + minutes + ((t.start as number) < dayStart ? ((t.start as number) - dayStart) / MIN : 0));
  const top = ((sMin - h0 * 60) / 60) * hour + 2;
  const h = Math.max(22, Math.round(((eMin - sMin) / 60) * hour) - 4);
  const small = minutes <= 30 || h < 30;
  const mid = !small && h < 52;
  // As many title lines as fit above the time, up to three.
  const fs = prefs.textSize;
  const lines = Math.max(1, Math.min(3, Math.floor((h - (mid ? 8 : 14) - 15.5 * fs) / (16.25 * fs))));
  const w = 100 / lanes;
  const live = t.status === 'open' && (t.start as number) <= now && endOf(t) > now;
  const moving = drag.view?.kind === 'block' && drag.view.id === t.id;
  const color = colorOf(t);
  const cls = 'block' + (small ? ' small' : '') + (mid ? ' mid' : '') + (t.status === 'done' ? ' done' : '') + (moving ? ' moving' : '')
    + (resizing ? ' resizing' : '') + (live ? ' live' : '') + (color ? ' tint' : '');
  const range = fmtRange(t.start as number, minutes);
  return (
    <div className={cls} data-block={t.id} role="button" tabIndex={0} aria-label={`${t.title}, ${range}. Press Enter to edit.`}
      style={{ ...tint(color), top, height: h, left: `calc(${(lane * w).toFixed(3)}% + 4px)`, width: `calc(${w.toFixed(3)}% - 8px)` }}
      onPointerDown={e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        drag.begin(e, 'block', t.id, { grabY: e.clientY - r.top + 2 });
      }}
      onClick={() => { if (!drag.ignoreClick()) openEditor(t.id); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(t.id); }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); unslot(t.id); }
      }}>
      <div className="bt" style={small ? undefined : { WebkitLineClamp: lines }}>{t.title}</div>
      <div className="bm">{range}</div>
      <button type="button" className="bx" aria-label={`Remove from calendar: ${t.title}`}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); unslot(t.id); }}>
        <XIcon />
      </button>
      <div className="rz" aria-hidden="true"
        onPointerDown={e => { e.stopPropagation(); drag.begin(e, 'resize', t.id, { startMin: sMin, minutes: t.minutes }); }} />
    </div>
  );
}

function DayCol({ d, h0, h1, sched, hour }: { d: Date; h0: number; h1: number; sched: Task[]; hour: number }) {
  const { now, drag, picked, place, store, prefs } = usePlanner();
  const [hover, setHover] = useState<number | null>(null);
  const key = ymd(d);
  const dayStart = startOfDay(d).getTime();
  const isToday = key === ymd(now);
  const height = (h1 - h0) * hour;
  const pickedTask = picked ? store.get(picked) : undefined;

  // Drop target: where a dragged task would land, or where a picked one would go on click.
  let target: { min: number; len: number } | null = null;
  if (drag.view && drag.view.kind !== 'resize' && drag.view.target?.day === key && drag.view.target.min >= 0) {
    target = { min: drag.view.target.min, len: store.get(drag.view.id)?.minutes ?? 30 };
  } else if (pickedTask && hover != null) {
    target = { min: hover, len: pickedTask.minutes };
  }

  const placeAt = (min: number) => { if (picked) place(picked, atMinutes(d, min)); };
  const nowMin = minsOf(now);

  return (
    <div className={'daycol' + (prefs.shadeWeekends && isWeekend(d) ? ' wkend' : '')} data-day={key} data-h0={h0} data-h1={h1} data-hour={hour} style={{ height }}
      onPointerMove={pickedTask ? e => { if (e.pointerType === 'mouse') setHover(clickMinute(e.currentTarget, e.clientY)); } : undefined}
      onPointerLeave={() => setHover(null)}
      onClick={picked ? e => placeAt(clickMinute(e.currentTarget, e.clientY)) : undefined}>
      {Array.from({ length: h1 - h0 }, (_, i) => h0 + i).map(h => (
        <div className="cell" key={h}>
          {picked && (
            <button type="button" className="place" aria-label={`Place at ${DOWL[d.getDay()]} ${fmtHour(h)}`}
              onClick={e => {
                e.stopPropagation();
                // Pointer clicks land on the 15-minute slot under the pointer; keyboard uses the hour.
                const col = e.currentTarget.closest('[data-day]') as HTMLElement;
                placeAt(e.detail > 0 ? clickMinute(col, e.clientY) : h * 60);
              }}>Place here</button>
          )}
        </div>
      ))}
      {isToday && nowMin >= h0 * 60 && nowMin <= h1 * 60 && (
        <div className="nowline" style={{ top: ((nowMin - h0 * 60) / 60) * hour }}><i /></div>
      )}
      {target && (
        <div className="drop" style={{ top: ((target.min - h0 * 60) / 60) * hour + 2, height: Math.max(22, (target.len / 60) * hour - 4) }}>
          {fmtRange(atMinutes(d, target.min), target.len)}
        </div>
      )}
      {layoutDay(tasksOn(sched, d)).map(({ task, lane, lanes }) => (
        <Block key={task.id} t={task} lane={lane} lanes={lanes} dayStart={dayStart} h0={h0} hour={hour} />
      ))}
    </div>
  );
}

/** The time grid: a gutter plus one column per day. Shared by the day, 5-day and week views on phone and laptop. */
function Grid({ days, gutter }: { days: Date[]; gutter: number }) {
  const { tasks, now, drag, picked, prefs, onCalendar } = usePlanner();
  const sched = tasks.filter(t => t.start != null && onCalendar(t));
  const hour = prefs.hourHeight;
  const [h0, h1] = hourRange(days, sched, [prefs.dayStart, prefs.dayEnd]);
  const height = (h1 - h0) * hour;
  const showsToday = days.some(d => ymd(d) === ymd(now));
  const nowMin = minsOf(now);
  const nowVisible = showsToday && nowMin >= h0 * 60 && nowMin <= h1 * 60;
  const dragging = drag.view && drag.view.kind !== 'resize';
  return (
    <div className={'wbody' + (dragging ? ' dragging' : '') + (picked ? ' armed' : '')}
      style={{ gridTemplateColumns: `${gutter}px repeat(${days.length}, minmax(0, 1fr))`, '--hour': `${hour}px` } as React.CSSProperties}>
      <div className="gut" aria-hidden="true" style={{ height }}>
        {Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).map(h => {
          // Hide an hour label the current-time label would sit on.
          if (nowVisible && Math.abs(nowMin - h * 60) < 12 * (56 / hour)) return null;
          const top = h === h1 ? height - 4 : (h - h0) * hour;
          return <span key={h} style={{ top }}>{fmtHour(h)}</span>;
        })}
        {nowVisible && <span className="nowt" style={{ top: ((nowMin - h0 * 60) / 60) * hour }}>{fmtTime(now, false)}</span>}
      </div>
      {days.map(d => <DayCol key={ymd(d)} d={d} h0={h0} h1={h1} sched={sched} hour={hour} />)}
    </div>
  );
}

/** Day names over the time grid; each opens that day. */
function DayHeads({ days, gutter }: { days: Date[]; gutter: number }) {
  const { now, setDay, setView } = usePlanner();
  const todayKey = ymd(now);
  return (
    <div className="whead in" style={{ animationDelay: '.14s', gridTemplateColumns: `${gutter}px repeat(${days.length}, minmax(0, 1fr))` }}>
      <span />
      {days.map(d => (
        <div key={ymd(d)} className={'dh' + (ymd(d) === todayKey ? ' today' : '')}>
          <button type="button" aria-label={`Open ${DOWL[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`}
            onClick={() => { setDay(d); setView('day'); }}>
            <span>{DOW[d.getDay()].toUpperCase()}</span> <b>{d.getDate()}</b>
          </button>
        </div>
      ))}
    </div>
  );
}

/** Month view: whole weeks, a few tasks per day. Click a day to open it; with a task picked, click to put it there. */
function MonthView({ compact }: { compact?: boolean }) {
  const { day, now, tasks, prefs, setDay, setView, picked, placeOnDay, drag, openEditor, onCalendar, colorOf } = usePlanner();
  const rows = monthGrid(day, prefs.weekStart);
  const month = day.getMonth();
  const todayKey = ymd(now);
  const sched = tasks.filter(t => t.start != null && onCalendar(t));
  const dragging = drag.view && drag.view.kind !== 'resize';
  const open = (d: Date) => { setDay(d); setView('day'); };
  return (
    <div className={'month' + (prefs.weekNumbers ? ' wn' : '') + (compact ? ' compact' : '') + (dragging ? ' dragging' : '') + (picked ? ' armed' : '')}>
      <div className="mhead" aria-hidden="true">
        {prefs.weekNumbers && <span className="mwk" aria-hidden="true" />}
        {rows[0].map(d => <span key={d.getDay()}>{(compact ? DOW[d.getDay()].slice(0, 1) : DOW[d.getDay()]).toUpperCase()}</span>)}
      </div>
      {rows.map(row => (
        <div className="mrow" key={ymd(row[0])}>
          {prefs.weekNumbers && <span className="mwk" aria-hidden="true">{isoWeek(row[3])}</span>}
          {row.map(d => {
            const key = ymd(d);
            const list = tasksOn(sched, d).sort((a, b) => (a.start as number) - (b.start as number));
            // Three lines fit: three tasks, or two and "+N more".
            const visible = list.length > 3 ? 2 : list.length;
            const over = !!dragging && drag.view?.target?.day === key;
            const cls = 'mcell' + (d.getMonth() !== month ? ' out' : '') + (key === todayKey ? ' today' : '')
              + (prefs.shadeWeekends && isWeekend(d) ? ' wkend' : '') + (over ? ' drop-day' : '');
            return (
              <div key={key} className={cls} data-day={key} data-month=""
                onClick={() => { if (drag.ignoreClick()) return; if (picked) placeOnDay(picked, key); else open(d); }}>
                <button type="button" className="mnum" aria-label={`Open ${DOWL[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${list.length ? `, ${list.length} on the calendar` : ''}`}
                  onClick={e => { e.stopPropagation(); if (picked) placeOnDay(picked, key); else open(d); }}>{d.getDate()}</button>
                {compact ? (
                  list.length > 0 && (
                    <span className="mdots" aria-hidden="true">
                      {list.slice(0, 4).map(t => <i key={t.id} className={t.status === 'done' ? 'done' : undefined} style={tint(colorOf(t))} />)}
                    </span>
                  )
                ) : (
                  <>
                    {list.slice(0, visible).map(t => {
                      const color = colorOf(t);
                      const moving = drag.view?.kind === 'block' && drag.view.id === t.id;
                      return (
                        <button key={t.id} type="button" style={tint(color)}
                          className={'mchip' + (color ? ' tint' : '') + (t.status === 'done' ? ' done' : '') + (moving ? ' moving' : '')}
                          aria-label={`${t.title}, ${fmtRange(t.start as number, t.minutes)}. Opens the task.`}
                          onPointerDown={e => drag.begin(e, 'block', t.id, { grabY: 0 })}
                          onClick={e => { e.stopPropagation(); if (!drag.ignoreClick()) openEditor(t.id); }}>
                          <time>{fmtShort(t.start as number)}</time><span>{t.title}</span>
                        </button>
                      );
                    })}
                    {list.length > visible && (
                      <button type="button" className="mmore" onClick={e => { e.stopPropagation(); open(d); }}>+{list.length - visible} more</button>
                    )}
                  </>
                )}
                {picked && (
                  <button type="button" className="place" aria-label={`Place on ${DOWL[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`}
                    onClick={e => { e.stopPropagation(); placeOnDay(picked, key); }}>Place here</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ArmBanner({ verb }: { verb: string }) {
  const { picked, setPicked, store, openEditor, view } = usePlanner();
  const t = picked ? store.get(picked) : undefined;
  if (!t) return null;
  return (
    <div className="arm" role="status">
      <span>{verb} a {view === 'month' ? 'day' : 'time'} for</span><b>{shortTitle(t.title)}</b>
      <button type="button" onClick={() => { setPicked(null); openEditor(t.id); }}>Edit</button>
      <button type="button" onClick={() => setPicked(null)}>Cancel</button>
    </div>
  );
}

const VIEWS: CalView[] = ['day', 'work', 'week', 'month'];

function ViewSwitch({ full }: { full?: boolean }) {
  const { view, setView } = usePlanner();
  return (
    <div className={'seg' + (full ? ' full' : '')} role="group" aria-label="Calendar view">
      {VIEWS.map(v => (
        <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{VIEW_LABELS[v]}</button>
      ))}
    </div>
  );
}

/** Navigation for whatever view is showing. */
function useNav() {
  const { day, setDay, view, prefs, now } = usePlanner();
  const unit = view === 'day' ? 'day' : view === 'month' ? 'month' : view === 'work' && prefs.fiveDay === 'rolling' ? '5 days' : 'week';
  return {
    ...viewTitle(view, startOfDay(day), now, prefs),
    prevLabel: `Previous ${unit}`,
    nextLabel: `Next ${unit}`,
    prev: () => setDay(stepDay(view, day, -1, prefs)),
    next: () => setDay(stepDay(view, day, 1, prefs)),
    today: () => setDay(startOfDay(Date.now())),
  };
}

function Nav() {
  const nav = useNav();
  return (
    <div className="navg">
      <button type="button" className="ib" aria-label={nav.prevLabel} onClick={nav.prev}><ChevronLeft /></button>
      <button type="button" className="tdy" onClick={nav.today}>Today</button>
      <button type="button" className="ib" aria-label={nav.nextLabel} onClick={nav.next}><ChevronRight /></button>
    </div>
  );
}

/** Connected accounts, each a toggle for showing its events. */
function Legend() {
  const { accounts, changeAccount } = usePlanner();
  if (!accounts.length) return null;
  return (
    <div className="legend in" role="group" aria-label="Google accounts on the calendar" style={{ animationDelay: '.1s' }}>
      {accounts.map(a => (
        <button key={a.id} type="button" className="lg" aria-pressed={a.show} style={tint(a.color)}
          title={a.show ? 'Hide its events' : 'Show its events'} onClick={() => changeAccount(a.id, { show: !a.show })}>
          <i aria-hidden="true" />{a.email || 'Google account'}{a.error ? ' · reconnect' : ''}
        </button>
      ))}
    </div>
  );
}

export function LaptopCalendar() {
  const { day, view, prefs } = usePlanner();
  const nav = useNav();
  const days = viewDays(view, day, prefs);
  return (
    <section className="cal" aria-label="Calendar">
      <div className="ctop in" style={{ animationDelay: '.08s' }}>
        <div className="ctitle"><h2>{nav.title}</h2><span>{nav.sub}</span></div>
        <div className="tools">
          <ArmBanner verb="Click" />
          <Nav />
          <ViewSwitch />
        </div>
      </div>
      <Legend />
      {view === 'month' ? (
        <div className="in" style={{ animationDelay: '.14s' }}><MonthView /></div>
      ) : (
        <>
          <DayHeads days={days} gutter={56} />
          <div className="in" style={{ animationDelay: '.2s' }}>
            <Grid days={days} gutter={56} />
          </div>
        </>
      )}
    </section>
  );
}

export function PhoneCalendar() {
  const { day, setDay, view, prefs, setPhoneView, picked, setPicked } = usePlanner();
  const { backlog, missed, focus: f } = useLists();
  const nav = useNav();
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const trayTasks = [...(f.now && f.now.start == null ? [f.now] : []), ...missed, ...backlog];
  const days = viewDays(view, day, prefs);
  const gutter = days.length > 1 ? 40 : 48;
  return (
    <>
      <div className="cv">
        <div className="cvh in">
          <button type="button" className="ib float" aria-label="Back to the list" onClick={() => { setPhoneView('list'); setPicked(null); }}><BackIcon /></button>
          <div className="ttl">{nav.title}<span>{nav.sub}</span></div>
          <Nav />
        </div>
        <div className="cvs in"><ViewSwitch full /></div>
        <ArmBanner verb="Tap" />
        <div className="daygrid in" style={{ animationDelay: '.08s' }}
          onPointerDown={e => { if (e.pointerType === 'touch') swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }}
          onPointerUp={e => {
            const s = swipe.current; swipe.current = null;
            if (!s || s.id !== e.pointerId) return;
            const dx = e.clientX - s.x, dy = e.clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dy) < 40) setDay(stepDay(view, day, dx < 0 ? 1 : -1, prefs));
          }}
          onPointerCancel={() => { swipe.current = null; }}>
          {view === 'month' ? <MonthView compact /> : (
            <>
              {days.length > 1 && <DayHeads days={days} gutter={gutter} />}
              <Grid days={days} gutter={gutter} />
            </>
          )}
        </div>
      </div>
      <div className="tray">
        <div className="tl">{trayTasks.length ? `Tap a task, then tap a ${view === 'month' ? 'day' : 'time'}` : 'Backlog is empty'}</div>
        <div className="ts">
          {trayTasks.map(t => (
            <button key={t.id} type="button" className="chip" aria-pressed={picked === t.id}
              onClick={() => setPicked(picked === t.id ? null : t.id)}>{t.title}</button>
          ))}
        </div>
      </div>
    </>
  );
}
