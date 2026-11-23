'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { Task } from '@/lib/model';
import { dayLine, type Anytime, type DayLine, type Entry, type Row } from '@/lib/timeline';
import { movingToday, type OutcomeView } from '@/lib/today';
import { flatResults, resultDone, rootOf } from '@/lib/goals';
import { backAt, isEvent, progress } from '@/lib/select';
import { describeRule } from '@/lib/repeat';
import { dueLabel, fmtDur, fmtHour, fmtTime, longDate, shortDate, shortTitle } from '@/lib/format';
import { MIN, addDays, atMinutes, fromYmd, startOfDay } from '@/lib/time';
import { usePlanner, useLists, suggestOn } from './Planner';
import { PLAN_ASK, PLAN_URL } from './Today';
import { daysLeft } from './Goals';
import { CheckIcon, PlusIcon, RepeatIcon, SparkIcon, TargetIcon } from './icons';

/*
 * The Today view: today and nothing else. Across the top, the date, how much is done and how much of your day is still
 * free, and the day as a strip. On the left, only the goals today moves: the plan's goals in focus, each with its
 * outcome, or, until the day is planned, the goals with work on the calendar today. On the right, the day as a
 * timeline: everything with a time today in order, now marked on it (with the one thing to do when nothing's on), the
 * free time still to come, and what's today's with no time yet. No backlog, no other days, no other goals.
 */

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
const HOUR = 3600000;

/** "1 h 20 min" from minutes, rounded to the minute. */
const span = (mins: number) => fmtDur(Math.max(1, Math.round(mins)));

/** Today's line, the goals it moves, and the day's bounds. */
function useToday() {
  const { tasks, now, prefs, todayPlan, goals, topGoals, upcomingOn, sourceOf, isOff } = usePlanner();
  const from = startOfDay(now).getTime(), to = addDays(from, 1).getTime();
  // Everything you can see today: done ones too, whatever the calendar's setting, since this is the day's record.
  const visible = useMemo(() => tasks.filter(t => { const src = sourceOf(t); return !src || (src.account.show && !isOff(t)); }), [tasks, sourceOf, isOff]);
  const upcoming = useMemo(() => upcomingOn(new Date(from)), [upcomingOn, from]);
  const planSteps = useMemo(() => todayPlan?.focus.flatMap(o => o.tasks) ?? [], [todayPlan]);
  const line = useMemo(() => dayLine({ tasks: visible, upcoming, now, from, to, hours: [prefs.dayStart, prefs.dayEnd], planSteps }),
    [visible, upcoming, now, from, to, prefs.dayStart, prefs.dayEnd, planSteps]);
  const moving = useMemo(() => movingToday(todayPlan, goals, topGoals, tasks, from, to), [todayPlan, goals, topGoals, tasks, from, to]);
  return { line, moving, from, to };
}

/** Put a task in the next free slot today, or say there isn't one and offer the calendar. */
function useSlotToday() {
  const { store, busyTasks, hours, now, place, toast, schedule } = usePlanner();
  return (id: string) => {
    const t = store.get(id);
    if (!t) return;
    const day = startOfDay(now);
    const at = suggestOn(busyTasks(), t, day, hours, now);
    if (at == null) { toast(`No ${fmtDur(t.minutes)} free in the rest of your day. Pick a time on the calendar.`); schedule(id); return; }
    place(id, atMinutes(day, at));
  };
}

/* ---------- the head: the date, the numbers, the day as a strip ---------- */

/** The day from your day's start to its end (stretched to fit what's on), with what's on it and where now is. */
function DayStrip({ line, from }: { line: DayLine; from: number }) {
  const { now, prefs, colorOf } = usePlanner();
  const timed = line.rows.flatMap(r => (r.type === 'entry' && !r.entry.point ? [r.entry] : []));
  const h0 = Math.max(0, Math.min(prefs.dayStart, ...timed.map(e => Math.floor((Math.max(e.at, from) - from) / HOUR))));
  const h1 = Math.min(24, Math.max(prefs.dayEnd, ...timed.map(e => Math.ceil((Math.min(e.end, from + 24 * HOUR) - from) / HOUR))));
  const x = (ms: number) => Math.max(0, Math.min(100, ((ms - from - h0 * HOUR) / ((h1 - h0) * HOUR)) * 100));
  const ticks = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).filter(h => h === h0 || h === h1 || (h % 3 === 0 && h - h0 > 1 && h1 - h > 1));
  const showNow = now >= from + h0 * HOUR && now <= from + h1 * HOUR;
  return (
    <div className="td-strip" role="img" aria-label={`Your day from ${fmtHour(h0)} to ${fmtHour(h1)}: ${timed.length} thing${timed.length === 1 ? '' : 's'} on the clock${showNow ? `, now ${fmtTime(now)}` : ''}.`}>
      <div className="td-track">
        {showNow && <i className="td-gone" style={{ width: `${x(now)}%` }} />}
        {timed.map(e => (
          <i key={e.key} className={`td-seg k-${e.kind} is-${e.state}`} style={{ ...tint(colorOf(e.task)), left: `${x(e.at)}%`, width: `max(3px, ${(x(e.end) - x(e.at)).toFixed(2)}%)` }} />
        ))}
        {showNow && <i className="td-mark" style={{ left: `${x(now)}%` }} />}
      </div>
      <div className="td-ticks" aria-hidden="true">
        {ticks.map(h => <span key={h} style={{ left: `${x(from + h * HOUR)}%` }}>{fmtHour(h)}</span>)}
      </div>
    </div>
  );
}

function DayHead({ line, from }: { line: DayLine; from: number }) {
  const { now, prefs, tasks, todayPlan } = usePlanner();
  const p = progress(tasks, now, prefs.weekStart).today;
  const end = from + prefs.dayEnd * HOUR;
  const over = now >= end;
  return (
    <header className="td-head">
      <div className="td-date">
        <p className="td-kick">
          <span className="nowdot" aria-hidden="true" />Today
          <span className="muted">{todayPlan ? ` · planned${todayPlan.by === 'claude' ? ' with Claude' : ''}${todayPlan.at ? ` at ${fmtTime(todayPlan.at)}` : ''}` : ' · not planned yet'}</span>
        </p>
        <h1>{longDate(now)}</h1>
      </div>
      <dl className="td-stats">
        <div>
          <dt>Done</dt>
          <dd className="num"><b>{p.done}</b> of {p.total}<span className="bar" aria-hidden="true"><i style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%` }} /></span></dd>
        </div>
        {over ? (
          <div><dt>Your day</dt><dd>ended at {fmtTime(end)}</dd></div>
        ) : (
          <>
            <div><dt>Booked</dt><dd className="num"><b>{line.booked ? span(line.booked) : 'Nothing'}</b></dd></div>
            <div><dt>Free</dt><dd className="num"><b>{line.free ? span(line.free) : 'None'}</b> <span className="muted">to {fmtTime(end)}</span></dd></div>
          </>
        )}
      </dl>
      <DayStrip line={line} from={from} />
    </header>
  );
}

/* ---------- the goals today moves ---------- */

function Step({ t, now, up }: { t: Task; now: number; up: boolean }) {
  const { done, completing, openEditor } = usePlanner();
  const on = t.status === 'done' || completing.has(t.id);
  const late = t.status === 'open' && t.start != null && t.start + t.minutes * MIN <= now;
  const when = t.status === 'done' ? (t.doneAt ? `Done ${fmtTime(t.doneAt)}` : 'Done') : t.start != null ? fmtTime(t.start) : 'No time yet';
  return (
    <li className={'td-s' + (on ? ' is-done' : '') + (up ? ' is-up' : '')}>
      <button type="button" className={'ck' + (on ? ' on' : '')} aria-label={`${t.status === 'done' ? 'Not done' : 'Done'}: ${t.title}`}
        onClick={() => { if (!completing.has(t.id)) done(t.id, t.status !== 'done'); }}>
        <span className="ring"><CheckIcon size={9} w={2.6} /></span>
      </button>
      <button type="button" className="td-st" onClick={() => openEditor(t.id)}>{t.title}</button>
      <span className={'td-sw num' + (late ? ' hot' : '')}>{late ? `Missed ${fmtTime(t.start as number)}` : when}</span>
    </li>
  );
}

function GoalCard({ v, phone }: { v: OutcomeView; phone?: boolean }) {
  const { prefs, now, goals, openGoal } = usePlanner();
  const index = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const top = rootOf(index, v.goal);
  const section = prefs.labels.find(l => l.id === top.section) ?? null;
  const t = v.tasks;
  const pct = t.all ? Math.round((t.done / t.all) * 100) : null;
  const tonight = t.all ? Math.round((Math.min(t.all, t.tonight) / t.all) * 100) : null;
  const next = v.steps.find(s => s.status === 'open');
  const met = v.goal.status === 'achieved' || (v.steps.length > 0 && v.done === v.steps.length);
  const krs = flatResults(top.results).filter(x => !x.parent).map(x => x.kr);
  const left = top.by ? daysLeft(top.by, now) : null;
  const outcome = v.outcome.text;
  const name = <>{v.goal.parent ? <span className="muted">{shortTitle(top.title, 24)} › </span> : null}{v.goal.title}</>;
  return (
    <article className={'td-g panel' + (met ? ' is-met' : '') + (outcome ? '' : ' is-bare')} style={tint(section?.color)} aria-label={outcome ? `${v.goal.title}: ${outcome}` : v.goal.title}>
      <header className="td-gh">
        <span className="dot" aria-hidden="true" />
        <button type="button" className="td-gn ell" onClick={() => openGoal(top.id)} title="Open it in Goals">{name}</button>
        {met ? <span className="loz hot">{outcome ? 'Met' : 'All done today'}</span> : v.steps.length > 0 && <span className="td-gc num">{v.done} of {v.steps.length} today</span>}
      </header>
      {outcome && <p className="td-out">{outcome}</p>}
      {pct != null && (
        <>
          <div className="td-gbar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
            {tonight != null && tonight > pct && <i className="td-ahead" style={{ left: `${pct}%`, width: `${tonight - pct}%` }} />}
          </div>
          <p className="td-gp num">
            <span><b>{pct}%</b> done</span>
            {tonight != null && tonight > pct && <span>→ <b>{tonight}%</b> by tonight</span>}
            <span className="muted">{t.done} of {t.all} tasks</span>
          </p>
        </>
      )}
      {/* On a phone the timeline right under it has the steps, so the card stays short. */}
      {v.steps.length ? (
        !phone && <ul className="td-sl">{v.steps.map(s => <Step key={s.id} t={s} now={now} up={s === next} />)}</ul>
      ) : <p className="td-none">Nothing on the calendar for it yet.</p>}
      {(krs.length > 0 || left) && (
        <p className="td-gm">
          {krs.length > 0 && <span>Key results {krs.filter(resultDone).length} of {krs.length}</span>}
          {top.by && left && <span className={left.hot ? 'hot' : undefined}>By {shortDate(fromYmd(top.by).getTime(), now)} · {left.text}</span>}
        </p>
      )}
    </article>
  );
}

/** Today isn't planned: the one way to plan it, small, above the goals. */
function PlanNote() {
  const { toast } = usePlanner();
  const copy = async () => {
    try { await navigator.clipboard.writeText(PLAN_ASK); toast('Copied. Paste it into Claude to plan your day.'); }
    catch { toast('Couldn’t copy it here. Ask Claude to “plan my day”.'); }
  };
  return (
    <div className="td-plan">
      <p><b>Today isn’t planned yet.</b> Agree with Claude which goals today is for and what each one produces by tonight.</p>
      <div className="td-plan-a">
        <a className="btn pri sm" href={PLAN_URL} target="_blank" rel="noopener noreferrer"><SparkIcon size={13} />Plan with Claude</a>
        <button type="button" className="btn text sm" onClick={copy} title={PLAN_ASK}>Copy the ask</button>
      </div>
    </div>
  );
}

function GoalsToday({ views, phone }: { views: OutcomeView[]; phone?: boolean }) {
  const { todayPlan, goalsLoaded, topGoals, setMainView, openSheet, wide } = usePlanner();
  const setGoals = () => (wide ? setMainView('goals') : openSheet('goals'));
  return (
    <section className="td-goals" aria-labelledby="td-goals-h">
      <div className="td-sh">
        <h2 id="td-goals-h">Moving today</h2>
        {views.length > 0 && <span className="muted sm">{todayPlan ? 'the goals in today’s plan' : 'the goals with work today'}</span>}
      </div>
      {goalsLoaded && !todayPlan && topGoals.length > 0 && <PlanNote />}
      {views.length > 0 ? (
        <div className={'td-gl' + (phone && views.length > 1 ? ' is-swipe' : '')}>{views.map(v => <GoalCard key={v.goal.id} v={v} phone={phone} />)}</div>
      ) : goalsLoaded && (
        topGoals.length ? (
          <p className="td-empty">No goal has work on today’s calendar yet.</p>
        ) : (
          <div className="td-empty">
            <span className="gempty-i"><TargetIcon size={18} /></span>
            <p><b>Set your goals.</b> The few outcomes that matter most right now; today then shows the ones you’re moving.</p>
            <button type="button" className="btn pri sm" onClick={setGoals}><PlusIcon size={13} />Set goals</button>
          </div>
        )
      )}
    </section>
  );
}

/* ---------- the timeline ---------- */

/** What an entry is about, in a line: how long, the goal it moves, how urgent, when it's due, how it repeats. */
function Meta({ e, extra }: { e: Entry; extra?: React.ReactNode }) {
  const { goalOf, labelOf, repeatOf, now, sourceOf } = usePlanner();
  const t = e.task;
  const goal = e.kind === 'event' ? null : goalOf(t);
  const label = labelOf(t);
  const repeat = e.kind === 'repeat' ? null : repeatOf(t);
  const src = e.kind === 'event' ? sourceOf(t) : null;
  const due = t.due && t.status === 'open' ? dueLabel(t.due, now) : null;
  return (
    <p className="td-m">
      {extra}
      {!e.point && <span className="num">{fmtDur(t.minutes)}</span>}
      {goal ? <span className="td-goal" style={tint(label?.color)}><span className="dot" />{goal.title}</span>
        : e.kind === 'event' ? <span>{src?.calendar?.name ?? 'Calendar'}</span>
        : label ? <span className="td-goal" style={tint(label.color)}><span className="dot" />{label.name}</span> : null}
      {t.priority === 1 && t.status === 'open' && e.kind !== 'event' && <span className="loz hot">Urgent</span>}
      {due && <span className={due.hot ? 'hot' : undefined}>{due.text}</span>}
      {(repeat || e.kind === 'repeat') && <span className="td-rep"><RepeatIcon size={11} />{repeat ? describeRule(repeat.rule) : 'Repeats'}</span>}
    </p>
  );
}

/** The ring on the line: tick a task off there, or see an event or a repeat to come for what it is. */
function Node({ e }: { e: Entry }) {
  const { done, completing } = usePlanner();
  const t = e.task;
  if (e.kind === 'event') return <span className="td-node k-event" aria-hidden="true" />;
  if (e.kind === 'repeat') return <span className="td-node" aria-hidden="true"><span className="ring ghost" /></span>;
  const on = t.status === 'done' || completing.has(t.id);
  return (
    <button type="button" className={'td-node ck' + (on ? ' on' : '')} aria-label={`${t.status === 'done' ? 'Not done' : 'Done'}: ${t.title}`}
      onClick={() => { if (!completing.has(t.id)) done(t.id, t.status !== 'done'); }}>
      <span className={'ring' + (e.state === 'now' ? ' now' : '')}><CheckIcon size={9} w={2.6} /></span>
    </button>
  );
}

function Title({ e, big }: { e: Entry; big?: boolean }) {
  const { openEditor, completing } = usePlanner();
  const t = e.task;
  const finishing = completing.has(t.id);
  if (e.kind === 'repeat') return <span className="td-tt">{t.title}</span>;
  return (
    <button type="button" className={'td-tt' + (big ? ' big' : '')} onClick={() => openEditor(t.id)} title="Edit">
      <span className={'strike' + (finishing ? ' on' : '')}>{t.title}</span>
    </button>
  );
}

/** Times down the left of the line: when each thing starts. How long it runs is in its line, and the next row says when what follows starts. */
const When = ({ e }: { e: Entry }) => <span className="td-when num"><b>{fmtTime(e.at)}</b></span>;

/** What's on right now: a card on the line with how long is left, and Done. */
function NowCard({ e }: { e: Entry }) {
  const { now, done, completing, colorOf } = usePlanner();
  const t = e.task;
  const left = Math.max(1, Math.round((e.end - now) / MIN));
  const gone = Math.max(0, Math.min(100, ((now - e.at) / (e.end - e.at)) * 100));
  const event = e.kind === 'event';
  return (
    <li className={`td-r is-now k-${e.kind}`} data-now="" style={tint(colorOf(t))}>
      <When e={e} />
      <Node e={e} />
      <div className="td-c">
        <div className="td-card">
          <p className="td-nh"><b>Now</b><span className="muted">{event ? `In it until ${fmtTime(e.end)}` : `Until ${fmtTime(e.end)}`} · {span(left)} left</span></p>
          <Title e={e} big />
          <span className="td-slot" aria-hidden="true"><i style={{ width: `${gone.toFixed(1)}%` }} /></span>
          <div className="td-cm">
            <Meta e={e} />
            {!event && <button type="button" className="btn pri sm" disabled={completing.has(t.id)} onClick={() => done(t.id, true)}><CheckIcon />Done</button>}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Now, when nothing's on: free until the next thing, with the one thing to do (the top of your backlog). */
function NowFree({ r }: { r: Extract<Row, { type: 'now' }> }) {
  const { now, done, place, completing, goalOf, labelOf, openEditor } = usePlanner();
  const { focus: f } = useLists();
  const t = !f.live ? f.now : null;
  const until = r.until == null ? 'Free for the rest of the day' : `Free until ${fmtTime(r.until)} · ${span((r.until - now) / MIN)}`;
  const goal = t ? goalOf(t) : null;
  const label = t ? labelOf(t) : null;
  const startNow = (id: string) => place(id, now - (now % (5 * MIN)));
  return (
    <li className="td-r is-now is-free" data-now="">
      <span className="td-when num"><b>{fmtTime(now)}</b></span>
      <span className="td-node is-pulse" aria-hidden="true"><i /></span>
      <div className="td-c">
        <p className="td-nh"><b>Now</b><span className="muted">{until}</span></p>
        {t && (
          <div className="td-card is-do">
            <p className="td-dol">The one thing to do now</p>
            <button type="button" className="td-tt big" onClick={() => openEditor(t.id)} title="Edit"><span className={'strike' + (completing.has(t.id) ? ' on' : '')}>{t.title}</span></button>
            <div className="td-cm">
              <p className="td-m">
                <span className="num">{fmtDur(t.minutes)}</span>
                {goal ? <span className="td-goal" style={tint(label?.color)}><span className="dot" />{goal.title}</span> : <span>Off-goal</span>}
                {t.priority === 1 && <span className="loz hot">Urgent</span>}
                {t.due && (d => <span className={d.hot ? 'hot' : undefined}>{d.text}</span>)(dueLabel(t.due, now))}
              </p>
              <span className="td-acts">
                <button type="button" className="btn pri sm" disabled={completing.has(t.id)} onClick={() => done(t.id, true)}><CheckIcon />Done</button>
                <button type="button" className="btn sec sm" onClick={() => startNow(t.id)} title={`On the calendar from ${fmtTime(now - (now % (5 * MIN)))}`}>Start now</button>
              </span>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function EntryRow({ e }: { e: Entry }) {
  const { now, colorOf } = usePlanner();
  const slotToday = useSlotToday();
  if (e.state === 'now') return <NowCard e={e} />;
  const extra = e.point ? <span>Ticked off</span>
    : e.state === 'next' ? <span className="td-in">in {span((e.at - now) / MIN)}</span>
    : e.state === 'missed' ? <span className="loz hot">Missed</span> : null;
  return (
    <li className={`td-r is-${e.state} k-${e.kind}${e.point ? ' is-point' : ''}`} style={tint(colorOf(e.task))}>
      <When e={e} />
      <Node e={e} />
      <div className="td-c">
        <Title e={e} />
        <Meta e={e} extra={extra} />
        {e.state === 'missed' && (
          <p className="td-miss">
            <span className="muted">Back to the backlog at {fmtTime(backAt(e.task))}</span>
            <button type="button" className="link sm" onClick={() => slotToday(e.task.id)}>Slot it later today</button>
          </p>
        )}
      </div>
    </li>
  );
}

/** Free time still to come: taller the longer it is, so the line keeps a feel for time. */
function Free({ from, to }: { from: number; to: number }) {
  const mins = (to - from) / MIN;
  return (
    <li className="td-r is-gap" style={{ '--h': `${Math.round(Math.min(64, 22 + mins / 6))}px` } as React.CSSProperties}>
      <span className="td-when num">{fmtTime(from)}</span>
      <span className="td-node" aria-hidden="true" />
      <div className="td-c"><p className="td-free">Free · {span(mins)}</p></div>
    </li>
  );
}

const WHY = { overdue: 'Overdue', due: 'Due today', plan: 'In today’s plan' } as const;

/** Today's with no time yet, kept above the line (it doesn't scroll away with it): tick it off, or slot it into today's free time. */
function NoTime({ list }: { list: Anytime[] }) {
  const { goalOf, labelOf, done, completing, openEditor, now } = usePlanner();
  const slotToday = useSlotToday();
  return (
    <section className="td-any" aria-labelledby="td-any-h">
      <h3 id="td-any-h">No time yet <span className="muted num">{list.length}</span></h3>
      <ul>
        {list.map(({ task: t, why }) => {
          const event = isEvent(t);
          const goal = goalOf(t), label = labelOf(t);
          const on = t.status === 'done' || completing.has(t.id);
          return (
            <li key={t.id} className="td-a">
              {event ? <span className="td-node k-event" aria-hidden="true" /> : (
                <button type="button" className={'ck' + (on ? ' on' : '')} aria-label={`Done: ${t.title}`} onClick={() => { if (!completing.has(t.id)) done(t.id, true); }}>
                  <span className="ring"><CheckIcon size={9} w={2.6} /></span>
                </button>
              )}
              <div className="td-c">
                <button type="button" className="td-tt" onClick={() => openEditor(t.id)}><span className={'strike' + (completing.has(t.id) ? ' on' : '')}>{t.title}</span></button>
                <p className="td-m">
                  <span className={why === 'plan' ? undefined : 'hot'}>{why === 'overdue' && t.due ? `Was due ${shortDate(fromYmd(t.due).getTime(), now)}` : WHY[why]}</span>
                  {!event && <span className="num">{fmtDur(t.minutes)}</span>}
                  {goal ? <span className="td-goal" style={tint(label?.color)}><span className="dot" />{goal.title}</span>
                    : label ? <span className="td-goal" style={tint(label.color)}><span className="dot" />{label.name}</span> : null}
                  {t.priority === 1 && !event && <span className="loz hot">Urgent</span>}
                </p>
              </div>
              {!event && <button type="button" className="btn text sm" onClick={() => slotToday(t.id)}>Slot it today</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Timeline({ line, from, phone }: { line: DayLine; from: number; phone?: boolean }) {
  const { prefs } = usePlanner();
  const scroller = useRef<HTMLDivElement>(null);
  const end = from + prefs.dayEnd * HOUR;
  // Where your day ends on the line: after everything before it.
  const cut = line.rows.findIndex(r => (r.type === 'entry' ? r.entry.at : r.type === 'free' ? r.from : r.at) >= end);
  const rows = cut < 0 ? line.rows : line.rows.slice(0, cut);
  const after = cut < 0 ? [] : line.rows.slice(cut);
  const count = line.rows.filter(r => r.type === 'entry').length;

  // Open on now: the line scrolls inside its panel on a laptop.
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>('[data-now]');
    if (phone || !box || !el) return;
    box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 96);
    // Only when the view opens: not every minute.
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (r: Row) => r.type === 'entry' ? <EntryRow key={r.entry.key} e={r.entry} />
    : r.type === 'free' ? <Free key={`free:${r.from}`} from={r.from} to={r.to} />
    : <NowFree key="now" r={r} />;
  return (
    <section className={'td-line' + (phone ? '' : ' panel')} aria-labelledby="td-line-h">
      <div className="td-sh td-lh">
        <h2 id="td-line-h">Timeline</h2>
        <span className="muted sm num">{count ? `${count} on the clock` : 'Nothing on the clock'}{line.anytime.length ? ` · ${line.anytime.length} with no time` : ''}</span>
      </div>
      {line.anytime.length > 0 && <NoTime list={line.anytime} />}
      <div className="td-scroll" ref={scroller}>
        <ol className="td-rows">
          {rows.map(row)}
          <li className="td-r is-end"><span className="td-when num">{fmtTime(end)}</span><span className="td-node" aria-hidden="true" /><div className="td-c"><p className="td-free">End of your day</p></div></li>
          {after.map(row)}
        </ol>
        {!count && <p className="td-empty">Nothing has a time today. Say what you’ll do and when in the chat bar, and it goes on the line.</p>}
      </div>
    </section>
  );
}

/**
 * Today, on its own: the date and the numbers, the goals today moves, and the day as a timeline. On a laptop it's a
 * view of its own (Laptop.tsx); on a phone, a tab under the Next task, in one column.
 */
export function TodayView({ phone }: { phone?: boolean }) {
  const { line, moving, from } = useToday();
  return (
    <div className={'td' + (phone ? ' ph' : '')}>
      <DayHead line={line} from={from} />
      <GoalsToday views={moving} phone={phone} />
      <Timeline line={line} from={from} phone={phone} />
    </div>
  );
}
