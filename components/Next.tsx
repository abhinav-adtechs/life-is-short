'use client';

import type { Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtTime, fmtWhen } from '@/lib/format';
import { MIN, endOf, minsOf, startOfDay, ymd } from '@/lib/time';
import { usePlanner, useLists } from './Planner';
import { describeRule } from '@/lib/repeat';
import { CalendarIcon, CheckIcon, RepeatIcon } from './icons';

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/** When the next thing is: "in 25 min" within the hour, its time later today, its day after that, or after this one. */
function nextWhen(t: Task, now: number) {
  if (t.start == null) return 'After this';
  if (ymd(t.start) !== ymd(now)) return fmtWhen(t.start, now);
  if (t.start - now < 3600000) return `in ${Math.max(1, Math.round((t.start - now) / MIN))} min`;
  return fmtTime(t.start);
}

/**
 * The one answer: the task to do now, with Done and Schedule, and what comes after it. Its context says how long you
 * have: until a live task ends, or until the next thing on the calendar. In Tide, a hairline across the top fills as
 * your day goes.
 */
export function NextCard({ phone }: { phone?: boolean }) {
  const { store, now, prefs, done, schedule, openEditor, labelOf, completing, repeatOf } = usePlanner();
  const { focus: f, busy, freeUntil } = useLists();
  const cur = f.now;
  const dayStart = startOfDay(now).getTime() + prefs.dayStart * 3600000;
  const dayPct = Math.max(0, Math.min(100, ((now - dayStart) / ((prefs.dayEnd - prefs.dayStart) * 3600000)) * 100));

  if (!store.loaded || !cur) {
    return (
      <section className={'next panel empty' + (phone ? ' ph' : '')} aria-label="Next task" aria-live="polite">
        {store.loaded ? <><h1 className="next-t">All clear.</h1><p className="note">Dump the next thing into the chat.</p></> : <p className="note">Opening your list…</p>}
      </section>
    );
  }

  const label = labelOf(cur);
  const repeat = repeatOf(cur);
  const due = cur.due ? dueLabel(cur.due, now) : null;
  const finishing = completing.has(cur.id);
  const context = f.live ? `Until ${fmtTime(endOf(cur))}`
    : busy ? `Busy until ${fmtTime(endOf(busy))}`
    : freeUntil ? `Free until ${fmtTime(freeUntil.start as number)}`
    : minsOf(now) < prefs.dayEnd * 60 && minsOf(now) >= prefs.dayStart * 60 ? 'Free for the rest of your day' : '';
  const next = f.next;
  const nextLabel = next ? labelOf(next) : null;

  return (
    <section className={'next panel' + (phone ? ' ph' : '')} aria-label="Next task" aria-live="polite">
      <div className="daybar" aria-hidden="true"><i style={{ width: `${dayPct.toFixed(1)}%` }} /></div>
      <div className="next-h">
        <span className="nowdot" aria-hidden="true" />
        <span className="next-l">Next task</span>
        <span className="spacer" />
        <span className="ctx">{context}</span>
      </div>
      <h1 className="next-t" key={cur.id}>
        <button type="button" title="Edit" onClick={() => openEditor(cur.id)}><span className={'strike' + (finishing ? ' on' : '')}>{cur.title}</span></button>
      </h1>
      {phone ? (
        <div className="next-m">
          <div className="next-facts">
            {cur.priority === 1 && <span className="loz hot">Urgent</span>}
            {label && <span className="dot" style={tint(label.color)} />}
            <span className="ell">{fmtDur(cur.minutes)}</span>
            {repeat && <span className="rep-g" title={describeRule(repeat.rule)}><RepeatIcon size={12} /><span className="sr">{describeRule(repeat.rule)}</span></span>}
          </div>
          <button type="button" className="btn pri tall" disabled={finishing} onClick={() => done(cur.id, true)}>Done</button>
          <button type="button" className="btn sec tall" onClick={() => schedule(cur.id)}>Schedule</button>
        </div>
      ) : (
        <div className="next-m">
          {cur.priority === 1 ? <span className="loz hot">Urgent</span> : <span>{PRI[cur.priority]}</span>}
          <span>{fmtDur(cur.minutes)}</span>
          {label && <span className="lab"><span className="dot" style={tint(label.color)} />{label.name}</span>}
          {due && <span className={due.hot ? 'hot' : undefined}>{due.text}</span>}
          {repeat && <span className="rep-l"><RepeatIcon size={12} />{describeRule(repeat.rule)}</span>}
          <span className="spacer" />
          <span className="acts">
            <button type="button" className="btn pri sm" disabled={finishing} onClick={() => done(cur.id, true)}><CheckIcon />Done</button>
            <button type="button" className="btn sec sm" onClick={() => schedule(cur.id)}><CalendarIcon />Schedule</button>
          </span>
        </div>
      )}
      {next ? (
        <button type="button" className="next-row" onClick={() => openEditor(next.id)} aria-label={`Next, ${nextWhen(next, now)}: ${next.title}`}>
          <span className="muted">Next</span>
          <span className="when num" key={`${next.id}:${next.start}`}>{nextWhen(next, now)}</span>
          <span className="ell">{next.title}</span>
          <span className="muted lab">{!phone && nextLabel && <span className="dot" style={tint(nextLabel.color)} />}{fmtDur(next.minutes)}</span>
        </button>
      ) : <div className="next-pad" />}
    </section>
  );
}
