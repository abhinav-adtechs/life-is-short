'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { hourRange, isEvent, layoutDay, tasksOn, visibleRange } from '@/lib/select';
import { fmtDur, fmtHour, fmtRange } from '@/lib/format';
import { DAYS, splitFor, type Days } from '@/lib/layout';
import { VIEW_LABELS, VIEW_FOR_DAYS, rangeTitle, stepDay, viewDays } from '@/lib/calview';
import { DOW, DOWL, MIN, MON, addDays, atMinutes, endOf, isWeekend, minsOf, startOfDay, weekStart, ymd } from '@/lib/time';
import { usePlanner, suggestOn } from './Planner';
import { ChevronLeft, ChevronRight, RepeatIcon } from './icons';

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
/** Room under the laptop's grid for the chat bar floating over it. */
const CHAT_CLEARANCE = 74;

/** Something on a day column: a task or event, a proposed change, the backlog task you're on, or where a pick would land. */
interface Item {
  key: string;
  start: number;
  minutes: number;
  title: string;
  meta: string;
  /** Block styles: task, event, done, missed, proposed, upcoming (a repeat's still to come), nowblk, preview, faded (moved by the plan), ticking. */
  cls: string[];
  color?: string | null;
  task?: Task;
  /** Real tasks and events open, drag and resize; proposals and previews don't. */
  live?: boolean;
  /** One of a repeat's: marked with the repeat glyph. */
  repeats?: boolean;
}

/** Everything a day column shows, before laying it out in lanes. */
function useItems() {
  const { tasks, now, onCalendar, colorOf, plan, picked, drag, lists, repeatOf, upcomingOn } = usePlanner();
  const sched = tasks.filter(t => t.start != null && onCalendar(t));
  const nowTask = lists.focus.now && lists.focus.now.start == null && picked !== lists.focus.now.id && drag.view?.id !== lists.focus.now.id ? lists.focus.now : null;
  return (d: Date): Item[] => {
    const out: Item[] = tasksOn(sched, d).map(t => {
      const ev = isEvent(t);
      const missed = !ev && t.status === 'open' && endOf(t) <= now;
      const color = colorOf(t);
      const cls = [ev ? 'event' : 'task'];
      if (color) cls.push('tint');
      if (t.status === 'done') cls.push('done');
      if (missed) cls.push('missed');
      if (plan.moves.has(t.id)) cls.push('faded');
      if (plan.ticks.has(t.id)) cls.push('ticking');
      if (drag.view?.kind === 'block' && drag.view.id === t.id) cls.push('lifted');
      return {
        key: t.id, start: t.start as number, minutes: t.minutes, title: t.title, meta: missed ? 'Missed · back to the backlog' : fmtRange(t.start as number, t.minutes),
        cls, color, task: t, live: true, repeats: !!repeatOf(t),
      };
    });
    for (const t of upcomingOn(d)) {
      const color = colorOf(t);
      out.push({ key: `rep:${t.id}`, start: t.start as number, minutes: t.minutes, title: t.title, meta: `Repeats · ${fmtRange(t.start as number, t.minutes)}`, cls: ['task', 'upcoming', ...(color ? ['tint'] : [])], color, repeats: true });
    }
    for (const t of tasksOn(plan.proposed, d)) {
      out.push({ key: `plan:${t.id}`, start: t.start as number, minutes: t.minutes, title: t.title, meta: `Proposed · ${fmtRange(t.start as number, t.minutes)}`, cls: ['task', 'proposed'] });
    }
    if (nowTask && ymd(d) === ymd(now)) {
      out.push({ key: `now:${nowTask.id}`, start: now, minutes: nowTask.minutes, title: nowTask.title, meta: `Now · ${fmtDur(nowTask.minutes)}`, cls: ['task', 'nowblk'], task: nowTask });
    }
    return out;
  };
}

/** One block. Titles take as many lines as fit; the time shows under them when there's room. */
function Block({ it, top, height, lane, lanes, phone }: { it: Item; top: number; height: number; lane: number; lanes: number; phone?: boolean }) {
  const { drag, openEditor, unslot, picked, prefs } = usePlanner();
  const t = it.task;
  const lh = (phone ? 18 : 16) * prefs.textSize;
  const showMeta = height >= (phone ? 44 : 40) && lanes < 3 && !!it.meta;
  const lines = Math.max(1, Math.floor((height - 8) / lh) - (showMeta ? 1 : 0));
  const w = 100 / lanes;
  const inset = phone ? 4 : 3;
  const style: React.CSSProperties = {
    ...tint(it.color), top, height,
    left: `calc(${(lane * w).toFixed(3)}% + ${inset}px)`, width: `calc(${w.toFixed(3)}% - ${inset * 2}px)`,
  };
  const cls = 'blk ' + it.cls.join(' ') + (height < 26 ? ' small' : '');
  const body = (
    <>
      <div className="blk-t">
        {it.cls[0] === 'task' && <span className="blk-ring" aria-hidden="true" />}
        <span className="blk-title" style={{ WebkitLineClamp: lines }}>{it.title}</span>
        {it.repeats && <span className="blk-rep" title="Repeats"><RepeatIcon size={11} /></span>}
      </div>
      {showMeta && <div className="blk-m num">{it.meta}</div>}
    </>
  );
  if (!t) return <div className={cls} style={style} role="img" aria-label={`${it.title}, ${it.meta}`} title={it.cls.includes('upcoming') ? `${it.title} · repeats, and comes on its day` : undefined}>{body}</div>;
  // The backlog task you're on, shown at now: open it, or drag it to a time.
  if (!it.live) {
    return (
      <div className={cls} style={style} role="button" tabIndex={0} aria-label={`Now: ${it.title}. Press Enter to edit.`}
        onPointerDown={e => { if (!picked) drag.begin(e, 'row', t.id); }}
        onClick={e => { if (picked || drag.ignoreClick()) return; e.stopPropagation(); openEditor(t.id); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openEditor(t.id); } }}>
        {body}
      </div>
    );
  }
  const canResize = t.status === 'open' && !it.cls.includes('done');
  return (
    <div className={cls} style={style} data-block={t.id} role="button" tabIndex={0}
      aria-label={`${t.title}, ${fmtRange(t.start as number, t.minutes)}${it.cls.includes('missed') ? ', missed' : ''}. Press Enter to edit, Delete to send it to the backlog.`}
      title={`${t.title} · click to edit`}
      onPointerDown={e => {
        if (picked) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        drag.begin(e, 'block', t.id, { grabY: e.clientY - r.top });
      }}
      onClick={e => { if (picked || drag.ignoreClick()) return; e.stopPropagation(); openEditor(t.id); }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(t.id); }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); unslot(t.id); }
      }}>
      {body}
      {canResize && (
        <div className="rz" aria-hidden="true"
          onPointerDown={e => { e.stopPropagation(); drag.begin(e, 'resize', t.id, { startMin: minsOf(t.start as number), minutes: t.minutes }); }} />
      )}
    </div>
  );
}

/** Lay a day's items into side-by-side lanes and place them on the grid. Something running in from yesterday starts at midnight. */
function DayBlocks({ d, items, h0, h1, hour, phone }: { d: Date; items: Item[]; h0: number; h1: number; hour: number; phone?: boolean }) {
  const ds = startOfDay(d).getTime();
  const span = (x: Item) => { const s = (x.start - ds) / MIN; return [Math.max(0, s), Math.min(24 * 60, s + x.minutes)]; };
  const shown = items.filter(x => { const [s, e] = span(x); return s < h1 * 60 && e > h0 * 60; });
  return (
    <>
      {layoutDay(shown).map(({ task: it, lane, lanes }) => {
        const [s, e] = span(it);
        const top = ((Math.max(s, h0 * 60) - h0 * 60) / 60) * hour + 1;
        const height = Math.max(18, ((Math.min(e, h1 * 60) - Math.max(s, h0 * 60)) / 60) * hour - 2);
        return <Block key={it.key} it={it} top={top} height={height} lane={lane} lanes={lanes} phone={phone} />;
      })}
    </>
  );
}

/** The current time: an accent line with a dot, and in Tide, the rest of today as water under it. */
function NowLine({ top }: { top: number }) {
  return (
    <>
      <div className="wash" style={{ top }} aria-hidden="true" />
      <div className="wave" style={{ top }} aria-hidden="true" />
      <div className="nowline" style={{ top }} aria-hidden="true"><i /></div>
    </>
  );
}

/** Where a pick (centred on the pointer) would start, on the 15-minute grid, kept inside the visible hours. */
function pickMinute(col: HTMLElement, clientY: number, h0: number, h1: number, hour: number, len: number) {
  const r = col.getBoundingClientRect();
  const at = h0 * 60 + ((clientY - r.top) / hour) * 60 - len / 2;
  return Math.max(h0 * 60, Math.min(h1 * 60 - Math.min(len, (h1 - h0) * 60), Math.round(at / 15) * 15));
}

/** One day on the laptop grid: a drop target, a click target while a task is picked, and its blocks. */
function DayCol({ d, h0, h1, hour, items }: { d: Date; h0: number; h1: number; hour: number; items: Item[] }) {
  const { now, drag, picked, place, store, prefs } = usePlanner();
  const [hover, setHover] = useState<number | null>(null);
  const key = ymd(d);
  const pickedTask = picked ? store.get(picked) : undefined;
  let preview: Item | null = null;
  const dragged = drag.view && drag.view.kind !== 'resize' && drag.view.target?.day === key ? store.get(drag.view.id) : undefined;
  if (dragged && drag.view?.target) {
    const at = atMinutes(d, drag.view.target.min);
    preview = { key: 'preview', start: at, minutes: dragged.minutes, title: dragged.title, meta: fmtRange(at, dragged.minutes), cls: ['task', 'preview'] };
  } else if (pickedTask && hover != null) {
    const at = atMinutes(d, hover);
    preview = { key: 'preview', start: at, minutes: pickedTask.minutes, title: pickedTask.title, meta: fmtRange(at, pickedTask.minutes), cls: ['task', 'preview'] };
  }
  const isToday = key === ymd(now);
  const nowMin = minsOf(now);
  return (
    <div className={'col' + (prefs.shadeWeekends && isWeekend(d) ? ' wk' : '') + (pickedTask ? ' armed' : '')}
      data-day={key} data-h0={h0} data-h1={h1} data-hour={hour}
      onPointerMove={pickedTask ? e => { if (e.pointerType === 'mouse') setHover(pickMinute(e.currentTarget, e.clientY, h0, h1, hour, pickedTask.minutes)); } : undefined}
      onPointerLeave={() => setHover(null)}
      onClick={pickedTask ? e => place(pickedTask.id, atMinutes(d, pickMinute(e.currentTarget, e.clientY, h0, h1, hour, pickedTask.minutes))) : undefined}>
      {isToday && nowMin >= h0 * 60 && nowMin <= h1 * 60 && <NowLine top={((nowMin - h0 * 60) / 60) * hour} />}
      <DayBlocks d={d} items={preview ? [...items, preview] : items} h0={h0} h1={h1} hour={hour} />
    </div>
  );
}

/** Measure an element's height, so the grid can fit your day into it. */
function useHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  const measure = useCallback(() => { if (ref.current) setH(ref.current.clientHeight); }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure]);
  return { ref, h };
}

/** Day, 2 days, 3 days, 5 days or Week; picking one moves the divider to fit them. */
function DaysSwitch({ narrow }: { narrow: boolean }) {
  const { split, setSplit } = usePlanner();
  const opts = DAYS.map(d => ({ d, label: narrow ? String(d) : VIEW_LABELS[VIEW_FOR_DAYS[d]] }));
  return (
    <>
      {narrow && <span className="muted sm">Days</span>}
      <div className="seg" role="radiogroup" aria-label="Days on the calendar">
        {opts.map(o => (
          <button key={o.d} type="button" role="radio" aria-checked={split.days === o.d} aria-label={VIEW_LABELS[VIEW_FOR_DAYS[o.d]]}
            onClick={() => setSplit(splitFor(o.d as Days))}>{o.label}</button>
        ))}
      </div>
    </>
  );
}

/** "Click a time" while a task is picked, with its length, a way out, and the next free slot as a shortcut. */
function PickStrip({ phone }: { phone?: boolean }) {
  const { picked, setPicked, store, slot } = usePlanner();
  const t = picked ? store.get(picked) : undefined;
  if (!t) return null;
  return (
    <div className="pick" role="status">
      <b>{phone ? 'Tap a time' : 'Click a time'}</b>
      <span className="ell">for “{t.title}” · {fmtDur(t.minutes)}</span>
      <span className="kbd">esc</span>
      <button type="button" className="btn text sm" onClick={() => slot(t.id)}>Next free slot</button>
      <button type="button" className="btn ghost sm" onClick={() => setPicked(null)}>Cancel</button>
    </div>
  );
}

/**
 * The laptop calendar. Your day fills the panel, stretched a little for things just outside it; anything further out
 * is counted on its day ("2 earlier"), and clicking the count shows every hour. Weekends are shaded.
 */
export function LaptopCalendar() {
  const { day, setDay, view, prefs, now, split, tasks, onCalendar, plan, upcomingOn } = usePlanner();
  const days = viewDays(view, day, prefs);
  const [allHours, setAllHours] = useState(false);
  const itemsOf = useItems();
  const sched = [...tasks.filter(t => t.start != null && onCalendar(t)), ...plan.proposed, ...days.flatMap(upcomingOn)];
  const base: [number, number] = [prefs.dayStart, prefs.dayEnd];
  const fit = visibleRange(days, sched, base);
  const [h0, h1] = allHours ? hourRange(days, sched, base) : [fit.h0, fit.h1];
  const { ref, h } = useHeight<HTMLDivElement>();
  const hour = Math.max(allHours ? 28 : 20, (h - CHAT_CLEARANCE) / (h1 - h0));
  const cols = `52px repeat(${days.length}, minmax(0, 1fr))`;
  const todayKey = ymd(now);
  const unit = days.length === 7 ? 'week' : days.length === 1 ? 'day' : `${days.length} days`;
  const hidden = !allHours && (fit.earlier.some(Boolean) || fit.later.some(Boolean));
  return (
    <section className="cal panel" aria-label="Calendar">
      <div className="cal-bar">
        <button type="button" className="ib" aria-label={`Previous ${unit}`} onClick={() => setDay(stepDay(view, day, -1, prefs))}><ChevronLeft /></button>
        <button type="button" className="btn sec sm" onClick={() => setDay(startOfDay(Date.now()))}>Today</button>
        <button type="button" className="ib" aria-label={`Next ${unit}`} onClick={() => setDay(stepDay(view, day, 1, prefs))}><ChevronRight /></button>
        <h2 className="cal-title ell">{rangeTitle(days, prefs)}</h2>
        <span className="spacer" />
        <DaysSwitch narrow={split.calW < 720} />
      </div>
      <PickStrip />
      <div className="cal-heads" style={{ gridTemplateColumns: cols }}>
        <span className="cal-fit">{allHours && <button type="button" className="link sm" title="Back to your day" onClick={() => setAllHours(false)}>Fit</button>}</span>
        {days.map((d, i) => {
          const isToday = ymd(d) === todayKey;
          const more = [fit.earlier[i] ? `${fit.earlier[i]} earlier` : '', fit.later[i] ? `${fit.later[i]} later` : ''].filter(Boolean).join(' · ');
          return (
            <div key={ymd(d)} className={'dh' + (isToday ? ' today' : '')}>
              <span className="dh-w">{DOW[d.getDay()]}</span>
              <span className="dh-n num" aria-label={`${d.getDate()} ${MON[d.getMonth()]}${isToday ? ', today' : ''}`}>{d.getDate()}</span>
              {more && hidden && <button type="button" className="dh-more" title="Show every hour" onClick={() => setAllHours(true)}>{more}</button>}
            </div>
          );
        })}
      </div>
      <div className="cal-body" ref={ref}>
        <div className="cal-grid" style={{ gridTemplateColumns: cols, height: (h1 - h0) * hour, '--hour': `${hour}px` } as React.CSSProperties}>
          <div className="gut" aria-hidden="true">
            {Array.from({ length: h1 - h0 - 1 }, (_, i) => h0 + i + 1).map(hh => <span key={hh} style={{ top: (hh - h0) * hour }}>{fmtHour(hh)}</span>)}
          </div>
          {days.map(d => <DayCol key={ymd(d)} d={d} h0={h0} h1={h1} hour={hour} items={itemsOf(d)} />)}
        </div>
      </div>
    </section>
  );
}

/* ---------- phone ---------- */

/**
 * The phone's calendar tab: this week as a strip of days, then one day's timeline, opened at now. While a task is
 * picked, the best free slot shows dashed: tap it, or tap any other time.
 */
export function PhoneCalendar() {
  const { day, setDay, prefs, now, tasks, onCalendar, plan, picked, place, store, busyTasks, hours, upcomingOn } = usePlanner();
  const itemsOf = useItems();
  const timeline = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const d = startOfDay(day);
  const hour = prefs.hourHeight;
  const sched = [...tasks.filter(t => t.start != null && onCalendar(t)), ...plan.proposed, ...upcomingOn(d)];
  const r = visibleRange([d], sched, [prefs.dayStart, prefs.dayEnd]);
  const { h0, h1 } = r;
  const isToday = ymd(d) === ymd(now);
  const pickedTask = picked ? store.get(picked) : undefined;
  const past = d.getTime() < startOfDay(now).getTime();
  const sugMin = pickedTask && !past ? suggestOn(busyTasks(), pickedTask, d, hours, now) : null;
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(d, prefs.weekStart), i));
  const busyDays = new Set(sched.filter(t => t.status === 'open').map(t => ymd(t.start as number)));
  const items = itemsOf(d);
  const more = [r.earlier[0] ? `${r.earlier[0]} earlier` : '', r.later[0] ? `${r.later[0]} later` : ''].filter(Boolean).join(' · ');

  // Open at now, or at the suggested slot while picking.
  const target = sugMin ?? (isToday ? minsOf(now) : null);
  useEffect(() => {
    const el = timeline.current;
    const scroller = el?.closest('.ph-scroll') as HTMLElement | null;
    if (!el || !scroller || target == null) return;
    const y = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + ((target - h0 * 60) / 60) * hour;
    scroller.scrollTo({ top: Math.max(0, y - 200) });
    // When the day or the pick changes, not on every minute.
  }, [ymd(d), picked, h0]); // eslint-disable-line react-hooks/exhaustive-deps

  const tapAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickedTask) return;
    place(pickedTask.id, atMinutes(d, pickMinute(e.currentTarget, e.clientY, h0, h1, hour, pickedTask.minutes)));
  };

  return (
    <>
      <div className="week" role="group" aria-label="This week">
        {week.map(w => {
          const sel = ymd(w) === ymd(d), tdy = ymd(w) === ymd(now);
          return (
            <button key={ymd(w)} type="button" aria-pressed={sel} className={'wd' + (tdy ? ' today' : '')} onClick={() => setDay(w)}
              aria-label={`${DOW[w.getDay()]} ${w.getDate()} ${MON[w.getMonth()]}${tdy ? ', today' : ''}`}>
              <span className="wd-w">{DOW[w.getDay()]}</span>
              <span className="wd-n num">{w.getDate()}</span>
              <i className={busyDays.has(ymd(w)) ? 'on' : undefined} />
            </button>
          );
        })}
      </div>
      <div className="dayrow">
        <span className="dayrow-t">{isToday ? 'Today' : DOWL[d.getDay()]}</span>
        <span className="muted sm">{DOW[d.getDay()]} {d.getDate()} {MON[d.getMonth()]}{more ? ` · ${more}` : ''}</span>
        <span className="spacer" />
        {!isToday && <button type="button" className="btn sec" onClick={() => setDay(startOfDay(Date.now()))}>Today</button>}
      </div>
      <div className="ph-card tl-card">
        <div ref={timeline} className={'tl col' + (prefs.shadeWeekends && isWeekend(d) ? ' wk' : '') + (pickedTask ? ' armed' : '')}
          data-day={ymd(d)} data-h0={h0} data-h1={h1} data-hour={hour}
          style={{ height: (h1 - h0) * hour, '--hour': `${hour}px` } as React.CSSProperties}
          onClick={tapAt}
          onPointerDown={e => { if (e.pointerType === 'touch') swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }}
          onPointerUp={e => {
            const s = swipe.current; swipe.current = null;
            if (!s || s.id !== e.pointerId) return;
            const dx = e.clientX - s.x, dy = e.clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dy) < 40) setDay(stepDay('day', d, dx < 0 ? 1 : -1, prefs));
          }}
          onPointerCancel={() => { swipe.current = null; }}>
          {Array.from({ length: h1 - h0 - 1 }, (_, i) => h0 + i + 1).map(hh => <span key={hh} className="tl-h" aria-hidden="true" style={{ top: (hh - h0) * hour }}>{fmtHour(hh)}</span>)}
          <DayBlocks d={d} items={items} h0={h0} h1={h1} hour={hour} phone />
          {pickedTask && sugMin != null && (
            <button type="button" className="suggest" style={{ top: ((sugMin - h0 * 60) / 60) * hour + 1, height: Math.max(44, (pickedTask.minutes / 60) * hour - 2) }}
              onClick={e => { e.stopPropagation(); place(pickedTask.id, atMinutes(d, sugMin)); }}>
              <b>Suggested · {fmtRange(atMinutes(d, sugMin), pickedTask.minutes)}</b>
              <span>Tap to place it here</span>
            </button>
          )}
          {isToday && minsOf(now) >= h0 * 60 && minsOf(now) <= h1 * 60 && <NowLine top={((minsOf(now) - h0 * 60) / 60) * hour} />}
        </div>
      </div>
    </>
  );
}

