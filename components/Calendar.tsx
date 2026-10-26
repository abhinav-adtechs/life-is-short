'use client';

import { useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { layoutDay, tasksOn } from '@/lib/select';
import { dayWord, fmtRange, fmtTime, rangeLabel, shortTitle } from '@/lib/format';
import { DOW, DOWL, MIN, MON, MONL, addDays, atMinutes, endOf, minsOf, startOfDay, weekStart, ymd } from '@/lib/time';
import { HOUR } from './drag';
import { usePlanner, useLists } from './Planner';
import { BackIcon, ChevronLeft, ChevronRight, XIcon } from './icons';

const fmtH = (h: number) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;

/** Visible hour range: working hours, stretched to fit anything scheduled outside them. */
function hourRange(days: Date[], sched: Task[]) {
  let h0 = 9, h1 = 21;
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
  const m = h0 * 60 + Math.floor(((clientY - r.top) / HOUR) * 60 / 15) * 15;
  return Math.max(h0 * 60, Math.min(h1 * 60 - 15, m));
}

function Block({ t, lane, lanes, dayStart, h0 }: { t: Task; lane: number; lanes: number; dayStart: number; h0: number }) {
  const { drag, openEditor, unslot, now } = usePlanner();
  const resizing = drag.view?.kind === 'resize' && drag.view.id === t.id;
  const minutes = resizing && drag.view?.minutes != null ? drag.view.minutes : t.minutes;
  const sMin = Math.max(0, ((t.start as number) - dayStart) / MIN);
  const eMin = Math.min(24 * 60, sMin + minutes + ((t.start as number) < dayStart ? ((t.start as number) - dayStart) / MIN : 0));
  const top = ((sMin - h0 * 60) / 60) * HOUR + 2;
  const h = Math.max(22, Math.round(((eMin - sMin) / 60) * HOUR) - 4);
  const small = minutes <= 30;
  const mid = !small && h < 52;
  // As many title lines as fit above the time, up to three.
  const lines = Math.max(1, Math.min(3, Math.floor((h - (mid ? 8 : 14) - 15.5) / 16.25)));
  const w = 100 / lanes;
  const live = t.status === 'open' && (t.start as number) <= now && endOf(t) > now;
  const moving = drag.view?.kind === 'block' && drag.view.id === t.id;
  const cls = 'block' + (small ? ' small' : '') + (mid ? ' mid' : '') + (t.status === 'done' ? ' done' : '') + (moving ? ' moving' : '')
    + (resizing ? ' resizing' : '') + (live ? ' live' : '');
  const range = fmtRange(t.start as number, minutes);
  return (
    <div className={cls} data-block={t.id} role="button" tabIndex={0} aria-label={`${t.title}, ${range}. Press Enter to edit.`}
      style={{ top, height: h, left: `calc(${(lane * w).toFixed(3)}% + 4px)`, width: `calc(${w.toFixed(3)}% - 8px)` }}
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

function DayCol({ d, h0, h1, sched }: { d: Date; h0: number; h1: number; sched: Task[] }) {
  const { now, drag, picked, place, store } = usePlanner();
  const [hover, setHover] = useState<number | null>(null);
  const key = ymd(d);
  const dayStart = startOfDay(d).getTime();
  const isToday = key === ymd(now);
  const height = (h1 - h0) * HOUR;
  const pickedTask = picked ? store.get(picked) : undefined;

  // Drop target: where a dragged task would land, or where a picked one would go on click.
  let target: { min: number; len: number } | null = null;
  if (drag.view && drag.view.kind !== 'resize' && drag.view.target?.day === key) {
    target = { min: drag.view.target.min, len: store.get(drag.view.id)?.minutes ?? 30 };
  } else if (pickedTask && hover != null) {
    target = { min: hover, len: pickedTask.minutes };
  }

  const placeAt = (min: number) => { if (picked) place(picked, atMinutes(d, min)); };
  const nowMin = minsOf(now);

  return (
    <div className="daycol" data-day={key} data-h0={h0} data-h1={h1} style={{ height }}
      onPointerMove={pickedTask ? e => { if (e.pointerType === 'mouse') setHover(clickMinute(e.currentTarget, e.clientY)); } : undefined}
      onPointerLeave={() => setHover(null)}
      onClick={picked ? e => placeAt(clickMinute(e.currentTarget, e.clientY)) : undefined}>
      {Array.from({ length: h1 - h0 }, (_, i) => h0 + i).map(h => (
        <div className="cell" key={h}>
          {picked && (
            <button type="button" className="place" aria-label={`Place at ${DOWL[d.getDay()]} ${fmtH(h)}`}
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
        <div className="nowline" style={{ top: ((nowMin - h0 * 60) / 60) * HOUR }}><i /></div>
      )}
      {target && (
        <div className="drop" style={{ top: ((target.min - h0 * 60) / 60) * HOUR + 2, height: Math.max(22, (target.len / 60) * HOUR - 4) }}>
          {fmtRange(atMinutes(d, target.min), target.len)}
        </div>
      )}
      {layoutDay(tasksOn(sched, d)).map(({ task, lane, lanes }) => (
        <Block key={task.id} t={task} lane={lane} lanes={lanes} dayStart={dayStart} h0={h0} />
      ))}
    </div>
  );
}

/** The time grid: a gutter plus one column per day. Shared by the laptop week/day view and the phone day view. */
function Grid({ days, gutter }: { days: Date[]; gutter: number }) {
  const { tasks, now, drag, picked } = usePlanner();
  const sched = tasks.filter(t => t.start != null);
  const [h0, h1] = hourRange(days, sched);
  const height = (h1 - h0) * HOUR;
  const showsToday = days.some(d => ymd(d) === ymd(now));
  const nowMin = minsOf(now);
  const nowVisible = showsToday && nowMin >= h0 * 60 && nowMin <= h1 * 60;
  const dragging = drag.view && drag.view.kind !== 'resize';
  return (
    <div className={'wbody' + (dragging ? ' dragging' : '') + (picked ? ' armed' : '')}
      style={{ gridTemplateColumns: `${gutter}px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div className="gut" aria-hidden="true" style={{ height }}>
        {Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).map(h => {
          // Hide an hour label the current-time label would sit on.
          if (nowVisible && Math.abs(nowMin - h * 60) < 12) return null;
          const top = h === h1 ? height - 4 : (h - h0) * HOUR;
          return <span key={h} style={{ top }}>{fmtH(h)}</span>;
        })}
        {nowVisible && <span className="nowt" style={{ top: ((nowMin - h0 * 60) / 60) * HOUR }}>{fmtTime(now, false)}</span>}
      </div>
      {days.map(d => <DayCol key={ymd(d)} d={d} h0={h0} h1={h1} sched={sched} />)}
    </div>
  );
}

function ArmBanner({ verb }: { verb: string }) {
  const { picked, setPicked, store, openEditor } = usePlanner();
  const t = picked ? store.get(picked) : undefined;
  if (!t) return null;
  return (
    <div className="arm" role="status">
      <span>{verb} a time for</span><b>{shortTitle(t.title)}</b>
      <button type="button" onClick={() => { setPicked(null); openEditor(t.id); }}>Edit</button>
      <button type="button" onClick={() => setPicked(null)}>Cancel</button>
    </div>
  );
}

export function LaptopCalendar() {
  const { day, setDay, calMode, setCalMode, now } = usePlanner();
  const week = calMode === 'week';
  const days = week ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i)) : [startOfDay(day)];
  const todayKey = ymd(now);
  const step = week ? 7 : 1;
  let title: string, sub: string;
  if (week) {
    const diff = Math.round((weekStart(day).getTime() - weekStart(now).getTime()) / (7 * 864e5));
    title = diff === 0 ? 'This week' : diff === 1 ? 'Next week' : diff === -1 ? 'Last week' : `Week of ${days[0].getDate()} ${MON[days[0].getMonth()]}`;
    sub = rangeLabel(days[0], days[6]);
  } else {
    title = dayWord(day.getTime(), now);
    sub = `${DOWL[day.getDay()]} ${day.getDate()} ${MONL[day.getMonth()]}`;
  }
  return (
    <section className="cal" aria-label="Calendar">
      <div className="ctop in" style={{ animationDelay: '.08s' }}>
        <div className="ctitle"><h2>{title}</h2><span>{sub}</span></div>
        <div className="tools">
          <ArmBanner verb="Click" />
          <div className="navg">
            <button type="button" className="ib" aria-label={week ? 'Previous week' : 'Previous day'} onClick={() => setDay(addDays(day, -step))}><ChevronLeft /></button>
            <button type="button" className="tdy" onClick={() => setDay(startOfDay(Date.now()))}>Today</button>
            <button type="button" className="ib" aria-label={week ? 'Next week' : 'Next day'} onClick={() => setDay(addDays(day, step))}><ChevronRight /></button>
          </div>
          <div className="seg" role="group" aria-label="Calendar view">
            <button type="button" className={week ? '' : 'on'} aria-pressed={!week} onClick={() => setCalMode('day')}>Day</button>
            <button type="button" className={week ? 'on' : ''} aria-pressed={week} onClick={() => setCalMode('week')}>Week</button>
          </div>
        </div>
      </div>
      <div className="whead in" style={{ animationDelay: '.14s', gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map(d => (
          <div key={ymd(d)} className={'dh' + (ymd(d) === todayKey ? ' today' : '')}>
            <button type="button" aria-label={`Open ${DOWL[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`}
              onClick={() => { setDay(d); setCalMode('day'); }}>
              {DOW[d.getDay()].toUpperCase()} <b>{d.getDate()}</b>
            </button>
          </div>
        ))}
      </div>
      <div className="in" style={{ animationDelay: '.2s' }}>
        <Grid days={days} gutter={56} />
      </div>
    </section>
  );
}

export function PhoneCalendar() {
  const { day, setDay, now, setPhoneView, picked, setPicked } = usePlanner();
  const { backlog, missed, focus: f } = useLists();
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const trayTasks = [...(f.now && f.now.start == null ? [f.now] : []), ...missed, ...backlog];
  return (
    <>
      <div className="cv">
        <div className="cvh in">
          <button type="button" className="ib" aria-label="Back to the list" onClick={() => { setPhoneView('list'); setPicked(null); }}><BackIcon /></button>
          <div className="ttl">{dayWord(day.getTime(), now)}<span>{DOWL[day.getDay()]}, {day.getDate()} {MONL[day.getMonth()]}</span></div>
          <div className="navg">
            <button type="button" className="ib" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}><ChevronLeft /></button>
            <button type="button" className="tdy" onClick={() => setDay(startOfDay(Date.now()))}>Today</button>
            <button type="button" className="ib" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}><ChevronRight /></button>
          </div>
        </div>
        <ArmBanner verb="Tap" />
        <div className="daygrid in" style={{ animationDelay: '.08s' }}
          onPointerDown={e => { if (e.pointerType === 'touch') swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }}
          onPointerUp={e => {
            const s = swipe.current; swipe.current = null;
            if (!s || s.id !== e.pointerId) return;
            const dx = e.clientX - s.x, dy = e.clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dy) < 40) setDay(addDays(day, dx < 0 ? 1 : -1));
          }}
          onPointerCancel={() => { swipe.current = null; }}>
          <Grid days={[startOfDay(day)]} gutter={48} />
        </div>
      </div>
      <div className="tray">
        <div className="tl">{trayTasks.length ? 'Tap a task, then tap a time' : 'Backlog is empty'}</div>
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

