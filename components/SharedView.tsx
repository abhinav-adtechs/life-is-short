'use client';

import { useState } from 'react';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtHour, fmtRange } from '@/lib/format';
import { rangeTitle, viewDays } from '@/lib/calview';
import { hourRange, layoutDay, tasksOn } from '@/lib/select';
import { DOW, MIN, MON, addDays, endOf, minsOf, startOfDay, ymd } from '@/lib/time';
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
      <div className="gh"><span className="gh-t">Backlog<span className="gh-n num">{items.length}</span></span></div>
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
      ) : <p className="mx-empty">Nothing waiting in the backlog.</p>}
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
  const title = today ? 'Today' : rangeTitle(days, { weekNumbers: false });
  const shown = days.some(d => tasksOn(cal.items, d).length > 0);

  return (
    <>
      <div className="cal-bar">
        {!today && (
          <>
            <button type="button" className="ib" aria-label={`Previous ${view}`} disabled={!canPrev} onClick={() => setDay(addDays(day, -step))}><ChevronLeft /></button>
            <button type="button" className="btn sec sm" onClick={() => setDay(startOfDay(now))}>Today</button>
            <button type="button" className="ib" aria-label={`Next ${view}`} disabled={!canNext} onClick={() => setDay(addDays(day, step))}><ChevronRight /></button>
          </>
        )}
        <h2 className="cal-title ell">{title}</h2>
      </div>
      {!shown && <p className="mx-empty vw-none">{days.length > 1 ? 'Nothing on the calendar these days.' : 'Nothing on the calendar this day.'}</p>}
      <SharedHeads days={days} now={now} />
      <SharedGrid days={days} items={cal.items} hours={data.hours} now={now} />
    </>
  );
}

function SharedHeads({ days, now }: { days: Date[]; now: number }) {
  const todayKey = ymd(now);
  return (
    <div className="cal-heads" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
      <span />
      {days.map(d => (
        <div key={ymd(d)} className={'dh' + (ymd(d) === todayKey ? ' today' : '')}>
          <span className="dh-w">{DOW[d.getDay()]}</span><span className="dh-n num" aria-label={`${d.getDate()} ${MON[d.getMonth()]}`}>{d.getDate()}</span>
        </div>
      ))}
    </div>
  );
}

const HOUR = 52;

function SharedGrid({ days, items, hours, now }: { days: Date[]; items: SharedItem[]; hours: SharedData['hours']; now: number }) {
  const [h0, h1] = hourRange(days, items, [hours.start, Math.max(hours.start + 1, hours.end)]);
  const height = (h1 - h0) * HOUR;
  const nowMin = minsOf(now);
  return (
    <div className="cal-grid vw-grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`, height, '--hour': `${HOUR}px` } as React.CSSProperties}>
      <div className="gut" aria-hidden="true">
        {Array.from({ length: h1 - h0 - 1 }, (_, i) => h0 + i + 1).map(h => <span key={h} style={{ top: (h - h0) * HOUR }}>{fmtHour(h)}</span>)}
      </div>
      {days.map(d => {
        const dayStart = startOfDay(d).getTime();
        return (
          <div key={ymd(d)} className="col">
            {ymd(d) === ymd(now) && nowMin >= h0 * 60 && nowMin <= h1 * 60 && (
              <div className="nowline" style={{ top: ((nowMin - h0 * 60) / 60) * HOUR }}><i /></div>
            )}
            {layoutDay(tasksOn(items, d)).map(({ task: t, lane, lanes }, i) => {
              const sMin = Math.max(0, (t.start - dayStart) / MIN);
              const eMin = Math.min(24 * 60, (endOf(t) - dayStart) / MIN);
              const top = ((sMin - h0 * 60) / 60) * HOUR + 1;
              const h = Math.max(18, ((eMin - sMin) / 60) * HOUR - 2);
              const w = 100 / lanes;
              const range = fmtRange(t.start, t.minutes);
              return (
                <div key={i} className={'blk event' + (h < 26 ? ' small' : '') + (t.done ? ' done' : '')} role="img" aria-label={`${t.title ?? 'Busy'}, ${range}`}
                  style={{ top, height: h, left: `calc(${(lane * w).toFixed(3)}% + 3px)`, width: `calc(${w.toFixed(3)}% - 6px)` }}>
                  <div className="blk-t"><span className="blk-title" style={{ WebkitLineClamp: Math.max(1, Math.floor((h - 8) / 16) - (h >= 40 ? 1 : 0)) }}>{t.title ?? 'Busy'}</span></div>
                  {h >= 40 && <div className="blk-m num">{range}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
