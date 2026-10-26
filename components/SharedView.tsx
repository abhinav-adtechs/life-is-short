'use client';

import { useState } from 'react';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtHour, fmtRange, fmtTime, rangeLabel } from '@/lib/format';
import { viewDays, viewTitle } from '@/lib/calview';
import { hourRange, layoutDay, tasksOn } from '@/lib/select';
import { DOW, DOWL, MIN, MON, MONL, addDays, endOf, minsOf, startOfDay, ymd } from '@/lib/time';
import { todayDays, type SharedData, type SharedItem } from '@/lib/share';
import { ChevronLeft, ChevronRight } from './icons';

/**
 * What someone you share with sees: your backlog and calendar as the share allows, read-only.
 * Also your "See what they see" preview. Uses the planner's own calendar styles, without the handles.
 */
export function SharedView({ data, wide, now, top, extra }: {
  data: SharedData; wide: boolean; now: number; top: React.ReactNode; extra?: React.ReactNode;
}) {
  const backlog = data.backlog && <SharedBacklog items={data.backlog} now={now} />;
  if (wide && data.calendar) {
    return (
      <div className="vw two">
        <aside className="vw-side">{top}{backlog}{extra}</aside>
        <section className="vw-cal" aria-label="Calendar"><SharedCalendar data={data} wide now={now} /></section>
      </div>
    );
  }
  return (
    <div className="vw one">
      {top}
      {backlog}
      {data.calendar && <section className="vw-cal" aria-label="Calendar"><SharedCalendar data={data} wide={wide} now={now} /></section>}
      {extra}
    </div>
  );
}

function SharedBacklog({ items, now }: { items: NonNullable<SharedData['backlog']>; now: number }) {
  return (
    <section className="vw-bl" aria-label="Backlog">
      <div className="sh"><span>Backlog</span><span>{items.length}</span></div>
      {items.length ? (
        <ul className="vw-rows">
          {items.map((t, i) => {
            const due = t.due ? dueLabel(t.due, now) : null;
            return (
              <li key={i} className="vw-row">
                <span className="rt">{t.title}</span>
                <span className="rp">{PRI[t.priority]} · {fmtDur(t.minutes)}{due && <> · <span className={due.hot ? 'hot' : undefined}>{due.text}</span></>}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="empty">Nothing waiting in the backlog.</p>}
    </section>
  );
}

const VIEW_PREFS = (data: SharedData) => ({ weekStart: data.weekStart, fiveDay: 'workweek' as const, weekNumbers: false });

/** The calendar, read-only: a week on a laptop, a day on a phone, and only the days the share covers. */
function SharedCalendar({ data, wide, now }: { data: SharedData; wide: boolean; now: number }) {
  const cal = data.calendar!;
  const today = data.scope.calendar === 'today';
  const first = cal.from != null ? startOfDay(cal.from) : null;
  const last = cal.to != null ? startOfDay(cal.to - 1) : null;
  const [day, setDay] = useState(() => startOfDay(Math.max(now, cal.from ?? now)));
  const view = wide && !today ? 'week' : 'day';
  const days: Date[] = [];
  if (today && cal.from != null && cal.to != null) days.push(...todayDays(cal.from, cal.to, cal.items));
  else days.push(...viewDays(view, day, VIEW_PREFS(data)).filter(d => (!first || d >= first) && (!last || d <= last)));
  if (!days.length) days.push(day);
  const step = view === 'week' ? 7 : 1;
  const canPrev = !today && (!first || days[0] > first);
  const canNext = !today && (!last || days[days.length - 1] < last);
  const title = today
    ? { title: 'Today', sub: days.length > 1 ? rangeLabel(days[0], days[days.length - 1]) : `${DOWL[days[0].getDay()]} ${days[0].getDate()} ${MONL[days[0].getMonth()]}` }
    : viewTitle(view === 'week' && days.length > 1 ? 'week' : 'day', days[0], now, VIEW_PREFS(data));
  const shown = days.some(d => tasksOn(cal.items, d).length > 0);

  return (
    <>
      <div className="ctop">
        <div className="ctitle"><h2>{title.title}</h2><span>{title.sub}</span></div>
        {!today && (
          <div className="navg">
            <button type="button" className="ib" aria-label={`Previous ${view}`} disabled={!canPrev} onClick={() => setDay(addDays(day, -step))}><ChevronLeft /></button>
            <button type="button" className="tdy" onClick={() => setDay(startOfDay(now))}>Today</button>
            <button type="button" className="ib" aria-label={`Next ${view}`} disabled={!canNext} onClick={() => setDay(addDays(day, step))}><ChevronRight /></button>
          </div>
        )}
      </div>
      {!shown && <p className="empty vw-none">{days.length > 1 ? 'Nothing on the calendar these days.' : 'Nothing on the calendar this day.'}</p>}
      {days.length > 1 && <SharedHeads days={days} now={now} gutter={wide ? 56 : 40} />}
      <SharedGrid days={days} items={cal.items} hours={data.hours} now={now} gutter={days.length > 1 && !wide ? 40 : wide ? 56 : 48} />
    </>
  );
}

function SharedHeads({ days, now, gutter }: { days: Date[]; now: number; gutter: number }) {
  const todayKey = ymd(now);
  return (
    <div className="whead" style={{ gridTemplateColumns: `${gutter}px repeat(${days.length}, minmax(0, 1fr))` }}>
      <span />
      {days.map(d => (
        <div key={ymd(d)} className={'dh' + (ymd(d) === todayKey ? ' today' : '')} aria-label={`${DOWL[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`}>
          <span>{DOW[d.getDay()].toUpperCase()}</span> <b>{d.getDate()}</b>
        </div>
      ))}
    </div>
  );
}

const HOUR = 52;

function SharedGrid({ days, items, hours, now, gutter }: { days: Date[]; items: SharedItem[]; hours: SharedData['hours']; now: number; gutter: number }) {
  const [h0, h1] = hourRange(days, items, [hours.start, Math.max(hours.start + 1, hours.end)]);
  const height = (h1 - h0) * HOUR;
  const nowMin = minsOf(now);
  const nowVisible = days.some(d => ymd(d) === ymd(now)) && nowMin >= h0 * 60 && nowMin <= h1 * 60;
  return (
    <div className="wbody vw-grid" style={{ gridTemplateColumns: `${gutter}px repeat(${days.length}, minmax(0, 1fr))`, '--hour': `${HOUR}px` } as React.CSSProperties}>
      <div className="gut" aria-hidden="true" style={{ height }}>
        {Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).map(h => {
          if (nowVisible && Math.abs(nowMin - h * 60) < 12) return null;
          return <span key={h} style={{ top: h === h1 ? height - 4 : (h - h0) * HOUR }}>{fmtHour(h)}</span>;
        })}
        {nowVisible && <span className="nowt" style={{ top: ((nowMin - h0 * 60) / 60) * HOUR }}>{fmtTime(now, false)}</span>}
      </div>
      {days.map(d => {
        const dayStart = startOfDay(d).getTime();
        return (
          <div key={ymd(d)} className="daycol" style={{ height }}>
            {Array.from({ length: h1 - h0 }, (_, i) => <div className="cell" key={i} />)}
            {ymd(d) === ymd(now) && nowMin >= h0 * 60 && nowMin <= h1 * 60 && (
              <div className="nowline" style={{ top: ((nowMin - h0 * 60) / 60) * HOUR }}><i /></div>
            )}
            {layoutDay(tasksOn(items, d)).map(({ task: t, lane, lanes }, i) => {
              const sMin = Math.max(0, (t.start - dayStart) / MIN);
              const eMin = Math.min(24 * 60, (endOf(t) - dayStart) / MIN);
              const top = ((sMin - h0 * 60) / 60) * HOUR + 2;
              const h = Math.max(22, Math.round(((eMin - sMin) / 60) * HOUR) - 4);
              const small = t.minutes <= 30 || h < 30;
              const w = 100 / lanes;
              const range = fmtRange(t.start, t.minutes);
              return (
                <div key={i} className={'block static' + (small ? ' small' : h < 52 ? ' mid' : '') + (t.done ? ' done' : '') + (t.title == null ? ' busy' : '')}
                  role="img" aria-label={`${t.title ?? 'Busy'}, ${range}`}
                  style={{ top, height: h, left: `calc(${(lane * w).toFixed(3)}% + 4px)`, width: `calc(${w.toFixed(3)}% - 8px)` }}>
                  <div className="bt">{t.title ?? 'Busy'}</div>
                  <div className="bm">{range}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
