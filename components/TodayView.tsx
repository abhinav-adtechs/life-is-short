'use client';

import { useEffect, useMemo, useRef } from 'react';
import { dayLine, type Anytime, type DayLine, type Entry, type Row } from '@/lib/timeline';
import { movingToday, type OutcomeView } from '@/lib/today';
import { rootOf } from '@/lib/goals';
import { backAt, isEvent } from '@/lib/select';
import { describeRule } from '@/lib/repeat';
import { dueLabel, fmtDur, fmtHour, fmtTime, fmtWhen, longDate, shortDate, shortTitle } from '@/lib/format';
import { MIN, addDays, atMinutes, fromYmd, startOfDay } from '@/lib/time';
import { usePlanner, useLists, suggestOn } from './Planner';
import { PLAN_ASK, PLAN_URL } from './Today';
import { daysLeft } from './Goals';
import { CheckIcon, PlusIcon, RepeatIcon, SparkIcon, TargetIcon } from './icons';

/*
 * The Today view: today and nothing else. Across the top, the date, how much of today is done and how much of your day
 * is still free, with the day as a strip. On the left, only the goals today moves (the plan's goals in focus, each with
 * its outcome, or until the day is planned, the goals with work on the calendar today), then what's today's with no
 * slot yet. On the right, the day as a timeline: everything with a time today in order, now on the line (what's on, or
 * when nothing is, the one thing to do), the free time still to come, and the slots you missed. Each task shows once.
 * No backlog, no other days, no other goals.
 */

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
const HOUR = 3600000;

/** "1 h 20 min" from minutes, rounded to the minute. */
const span = (mins: number) => fmtDur(Math.max(1, Math.round(mins)));

/** Today's line, the goals it moves, and the day's bounds. */
function useToday() {
  const { tasks, now, prefs, todayPlan, goals, topGoals, upcomingOn, sourceOf, isOff, slips } = usePlanner();
  const from = startOfDay(now).getTime(), to = addDays(from, 1).getTime();
  // Everything you can see today: done ones too, whatever the calendar's setting, since this is the day's record.
  const visible = useMemo(() => tasks.filter(t => { const src = sourceOf(t); return !src || (src.account.show && !isOff(t)); }), [tasks, sourceOf, isOff]);
  const upcoming = useMemo(() => upcomingOn(new Date(from)), [upcomingOn, from]);
  const planSteps = useMemo(() => todayPlan?.focus.flatMap(o => o.tasks) ?? [], [todayPlan]);
  const line = useMemo(() => dayLine({ tasks: visible, upcoming, now, from, to, hours: [prefs.dayStart, prefs.dayEnd], planSteps, slips }),
    [visible, upcoming, now, from, to, prefs.dayStart, prefs.dayEnd, planSteps, slips]);
  const moving = useMemo(() => movingToday(todayPlan, goals, topGoals, tasks, from, to), [todayPlan, goals, topGoals, tasks, from, to]);
  return { line, moving, from };
}

/** Put a task in the next free slot today, or say there isn't one and go to the calendar to pick a time. */
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
  const { now, prefs, todayPlan } = usePlanner();
  const { done, total } = line.tally;
  const end = from + prefs.dayEnd * HOUR;
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
        {total > 0 && (
          <div>
            <dt>Done</dt>
            <dd className="num"><b>{done}</b> of {total}<span className="bar" aria-hidden="true"><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></span></dd>
          </div>
        )}
        <div>
          <dt>Free</dt>
          {now >= end ? <dd>Your day ended at {fmtTime(end)}</dd>
            : <dd className="num"><b>{line.free ? span(line.free) : 'None'}</b> <span className="muted">till {fmtTime(end)}</span></dd>}
        </div>
      </dl>
      <DayStrip line={line} from={from} />
    </header>
  );
}

/* ---------- the left: the goals today moves, then what has no slot yet ---------- */

function GoalCard({ v }: { v: OutcomeView }) {
  const { prefs, now, goals, openGoal } = usePlanner();
  const index = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const top = rootOf(index, v.goal);
  const section = prefs.labels.find(l => l.id === top.section) ?? null;
  const t = v.tasks;
  const next = v.steps.find(s => s.status === 'open');
  const outcome = v.outcome.text;
  // Met is about an outcome: an unplanned day has none, just the count.
  const met = !!outcome && (v.goal.status === 'achieved' || (v.steps.length > 0 && v.done === v.steps.length));
  const left = top.by ? daysLeft(top.by, now) : null;
  const when = (s: (typeof v.steps)[number]) => s.status === 'done' ? 'done' : s.start != null ? fmtTime(s.start) : 'no slot';
  return (
    <article className={'td-g panel' + (met ? ' is-met' : '') + (outcome ? '' : ' is-bare')} style={tint(section?.color)} aria-label={outcome ? `${v.goal.title}: ${outcome}` : v.goal.title}>
      <header className="td-gh">
        <span className="dot" aria-hidden="true" />
        <button type="button" className="td-gn ell" onClick={() => openGoal(top.id)} title="Open it in Goals">
          {v.goal.parent ? <span className="muted">{shortTitle(top.title, 24)} › </span> : null}{v.goal.title}
        </button>
        {met ? <span className="loz hot">Met</span> : v.steps.length > 0 && <span className="td-gc num">{v.done} of {v.steps.length} today</span>}
      </header>
      {outcome && <p className="td-out">{outcome}</p>}
      {v.steps.length > 0 && (
        <span className="tb-seg" role="img" aria-label={`${v.done} of ${v.steps.length} of today’s steps done: ${v.steps.map(s => `${s.title}, ${when(s)}`).join('; ')}`}>
          {v.steps.map(s => <i key={s.id} className={s.status === 'done' ? 'on' : s === next ? 'up' : undefined} title={`${s.title} · ${when(s)}`} />)}
        </span>
      )}
      {(t.all > 0 || left?.hot) && (
        <p className="td-gp num">
          {t.all > 0 && <span>tasks {t.tonight > t.done ? <>{t.done} → <b>{t.tonight}</b></> : <b>{t.done}</b>} of {t.all} by tonight</span>}
          {top.by && left?.hot && <span className="hot">By {shortDate(fromYmd(top.by).getTime(), now)} · {left.text}</span>}
        </p>
      )}
      {!v.steps.length && <p className="td-none">Nothing on the calendar for it yet.</p>}
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

function GoalsToday({ views }: { views: OutcomeView[] }) {
  const { todayPlan, goalsLoaded, topGoals, setMainView, openSheet, wide } = usePlanner();
  const setGoals = () => (wide ? setMainView('goals') : openSheet('goals'));
  return (
    <section className="td-goals" aria-labelledby="td-goals-h">
      <div className="td-sh"><h2 id="td-goals-h">{todayPlan ? 'Today’s outcomes' : 'Goals with work today'}</h2></div>
      {goalsLoaded && !todayPlan && topGoals.length > 0 && <PlanNote />}
      {views.length > 0 ? (
        <div className="td-gl">{views.map(v => <GoalCard key={v.goal.id} v={v} />)}</div>
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

/** Why something with no slot is today's. A calendar's all-day event is just today's. */
function whyText(a: Anytime, now: number): { text: string; hot: boolean } {
  if (isEvent(a.task)) return { text: 'All day', hot: false };
  if (a.why === 'overdue' && a.task.due) return { text: `Was due ${shortDate(fromYmd(a.task.due).getTime(), now)}`, hot: true };
  return a.why === 'due' ? { text: 'Due today', hot: true } : { text: 'In today’s plan', hot: false };
}

/** Today's with no slot yet: overdue, due today, or in today's plan. Tick it off, or slot it into today's free time. */
function NoSlot({ list }: { list: Anytime[] }) {
  const { goalOf, labelOf, done, completing, openEditor, now, blocked } = usePlanner();
  const slotToday = useSlotToday();
  return (
    <section className="td-any" aria-labelledby="td-any-h">
      <div className="td-sh"><h2 id="td-any-h">No slot yet</h2><span className="muted sm num">{list.length}</span></div>
      <ul>
        {list.map(a => {
          const t = a.task;
          const event = isEvent(t);
          const goal = goalOf(t), label = labelOf(t);
          const why = whyText(a, now);
          const on = completing.has(t.id);
          return (
            <li key={t.id} className="td-a">
              {event ? <span className="td-node k-event" style={tint(label?.color)} aria-hidden="true" /> : (
                <button type="button" className={'td-node ck' + (on ? ' on' : '')} aria-label={`Done: ${t.title}`} onClick={() => { if (!on) done(t.id, true); }}>
                  <span className="ring"><CheckIcon size={9} w={2.6} /></span>
                </button>
              )}
              <div className="td-c">
                <button type="button" className="td-tt" onClick={() => openEditor(t.id)}><span className={'strike' + (on ? ' on' : '')}>{t.title}</span></button>
                <p className="td-m">
                  <span className={why.hot ? 'hot' : undefined}>{why.text}</span>
                  {!event && <span className="num">{fmtDur(t.minutes)}</span>}
                  {goal ? <span className="td-goal" style={tint(label?.color)}><span className="dot" />{goal.title}</span>
                    : label ? <span className="td-goal" style={tint(label.color)}><span className="dot" />{label.name}</span> : null}
                  {t.priority === 1 && !event && <span className="loz">Urgent</span>}
                  {blocked.has(t.id) && <span className="loz" title="A step before it on its goal’s map isn’t done yet">Blocked</span>}
                </p>
                {!event && <button type="button" className="btn text sm td-act" onClick={() => slotToday(t.id)}>Slot it today</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- the timeline ---------- */

/** What an entry is about, in a line: how long, the goal it moves, how urgent, when it's due, how it repeats. */
function Meta({ e, extra }: { e: Entry; extra?: React.ReactNode }) {
  const { goalOf, labelOf, repeatOf, now, sourceOf, blocked } = usePlanner();
  const t = e.task;
  const goal = e.kind === 'event' ? null : goalOf(t);
  const label = labelOf(t);
  const repeat = e.kind === 'repeat' ? null : repeatOf(t);
  const src = e.kind === 'event' ? sourceOf(t) : null;
  const due = t.due && t.status === 'open' && !e.slip ? dueLabel(t.due, now) : null;
  const open = t.status === 'open' && e.kind === 'task' && !e.slip;
  return (
    <p className="td-m">
      {extra}
      {!e.point && <span className="num">{fmtDur(t.minutes)}</span>}
      {goal ? <span className="td-goal" style={tint(label?.color)}><span className="dot" />{goal.title}</span>
        : e.kind === 'event' ? <span>{src?.calendar?.name ?? 'Calendar'}</span>
        : label ? <span className="td-goal" style={tint(label.color)}><span className="dot" />{label.name}</span> : null}
      {t.priority === 1 && open && <span className="loz">Urgent</span>}
      {open && blocked.has(t.id) && <span className="loz" title="A step before it on its goal’s map isn’t done yet">Blocked</span>}
      {due && <span className={due.hot ? 'hot' : undefined}>{due.text}</span>}
      {(repeat || e.kind === 'repeat') && <span className="td-rep"><RepeatIcon size={11} />{repeat ? describeRule(repeat.rule) : 'Repeats'}</span>}
    </p>
  );
}

/** The ring on the line: tick a task off there. An event, a repeat to come and a slot that's been left can't be. */
function Node({ e }: { e: Entry }) {
  const { done, completing } = usePlanner();
  const t = e.task;
  if (e.kind === 'event') return <span className="td-node k-event" aria-hidden="true" />;
  if (e.kind === 'repeat') return <span className="td-node" aria-hidden="true"><span className="ring ghost" /></span>;
  if (e.slip) return <span className="td-node is-left" aria-hidden="true"><span className="ring" /></span>;
  const on = t.status === 'done' || completing.has(t.id);
  return (
    <button type="button" className={'td-node ck' + (on ? ' on' : '')} aria-label={`${t.status === 'done' ? 'Not done' : 'Done'}: ${t.title}`}
      onClick={() => { if (!completing.has(t.id)) done(t.id, t.status !== 'done'); }}>
      <span className={'ring' + (e.state === 'now' ? ' now' : '')}><CheckIcon size={9} w={2.6} /></span>
    </button>
  );
}

function Title({ e, big }: { e: Entry; big?: boolean }) {
  const { openEditor, completing, store } = usePlanner();
  const t = e.task;
  // A repeat still to come isn't a task yet; a slot's task may have been deleted since.
  if (e.kind === 'repeat' || (e.slip && !store.get(t.id))) return <span className="td-tt">{t.title}</span>;
  return (
    <button type="button" className={'td-tt' + (big ? ' big' : '')} onClick={() => openEditor(t.id)} title="Edit">
      <span className={'strike' + (completing.has(t.id) ? ' on' : '')}>{t.title}</span>
    </button>
  );
}

/** When each thing starts, down the left of the line. How long it runs is in its line. */
const When = ({ at }: { at: number }) => <span className="td-when num"><b>{fmtTime(at)}</b></span>;

/** What's on right now: a card on the line with how long is left, and Done. */
function NowCard({ e }: { e: Entry }) {
  const { now, done, completing, colorOf } = usePlanner();
  const t = e.task;
  const left = Math.max(1, Math.round((e.end - now) / MIN));
  const gone = Math.max(0, Math.min(100, ((now - e.at) / (e.end - e.at)) * 100));
  const event = e.kind === 'event';
  return (
    <li className={`td-r is-now k-${e.kind}`} data-now="" style={tint(colorOf(t))}>
      <When at={e.at} />
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

/** Now, when nothing's on: free until the next thing, with the one thing to do (the Next task: the top of your backlog). */
function NowFree({ r }: { r: Extract<Row, { type: 'now' }> }) {
  const { now, done, place, completing, goalOf, labelOf, openEditor, blocked } = usePlanner();
  const { focus: f } = useLists();
  const t = !f.live ? f.now : null;
  const until = r.until == null ? 'Free for the rest of the day' : `Free until ${fmtTime(r.until)} · ${span((r.until - now) / MIN)}`;
  const goal = t ? goalOf(t) : null;
  const label = t ? labelOf(t) : null;
  const from = now - (now % (5 * MIN));
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
                {t.priority === 1 && <span className="loz">Urgent</span>}
                {blocked.has(t.id) && <span className="loz">Blocked</span>}
                {t.due && (d => <span className={d.hot ? 'hot' : undefined}>{d.text}</span>)(dueLabel(t.due, now))}
              </p>
              <span className="td-acts">
                <button type="button" className="btn pri sm" disabled={completing.has(t.id)} onClick={() => done(t.id, true)}><CheckIcon />Done</button>
                <button type="button" className="btn sec sm" onClick={() => place(t.id, from)} title={`On the calendar from ${fmtTime(from)}`}>Start now</button>
              </span>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** What became of a slot that's been left: back in the backlog, moved, done after all, deleted or replaced. */
function slipText(e: Entry, live: boolean, now: number): string {
  const t = e.task;
  if (!live || e.slip === 'dropped') return 'Deleted since';
  if (e.slip === 'replaced') return 'Replaced by the next one';
  if (t.status === 'done') return 'Done since';
  return t.start != null ? `Moved to ${fmtWhen(t.start, now).replace(/^Today, /, '')}` : 'Back in the backlog';
}

function EntryRow({ e }: { e: Entry }) {
  const { now, colorOf, store } = usePlanner();
  const slotToday = useSlotToday();
  if (e.state === 'now') return <NowCard e={e} />;
  const live = !!store.get(e.task.id);
  // A missed task you can still fit in: on its slot for its last hour, or back in the backlog.
  const canSlot = e.state === 'missed' && live && e.task.status === 'open' && (e.slip ? e.task.start == null : true);
  const extra = e.point ? <span>Ticked off</span>
    : e.state === 'next' ? <span className="td-in">in {span((e.at - now) / MIN)}</span>
    : e.state === 'missed' ? <span className="loz hot">Missed</span> : null;
  return (
    <li className={`td-r is-${e.state} k-${e.kind}${e.point ? ' is-point' : ''}${e.slip ? ' is-left' : ''}`} style={tint(colorOf(e.task))}>
      <When at={e.at} />
      <Node e={e} />
      <div className="td-c">
        <Title e={e} />
        <Meta e={e} extra={extra} />
        {e.state === 'missed' && (
          <p className="td-miss">
            <span className="muted">{e.slip ? slipText(e, live, now) : `Back to the backlog at ${fmtTime(backAt(e.task))}`}</span>
            {canSlot && <button type="button" className="btn text sm td-act" onClick={() => slotToday(e.task.id)}>Slot it later today</button>}
          </p>
        )}
      </div>
    </li>
  );
}

/** Free time still to come. */
function Free({ from, to }: { from: number; to: number }) {
  return (
    <li className="td-r is-gap">
      <span className="td-when num">{fmtTime(from)}</span>
      <span className="td-node" aria-hidden="true" />
      <div className="td-c"><p className="td-free">Free · {span((to - from) / MIN)}</p></div>
    </li>
  );
}

function Timeline({ line, from, phone }: { line: DayLine; from: number; phone?: boolean }) {
  const { prefs, store } = usePlanner();
  const scroller = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const end = from + prefs.dayEnd * HOUR;
  // Where your day ends on the line: after everything before it.
  const cut = line.rows.findIndex(r => (r.type === 'entry' ? r.entry.at : r.type === 'free' ? r.from : r.at) >= end);
  const rows = cut < 0 ? line.rows : line.rows.slice(0, cut);
  const after = cut < 0 ? [] : line.rows.slice(cut);
  const count = line.rows.filter(r => r.type === 'entry').length;

  // Open on now: on a laptop the line scrolls in its panel. Once, when your tasks have loaded and now is on the line.
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>('[data-now]');
    if (phone || opened.current || !store.loaded || !box || !el) return;
    opened.current = true;
    box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 72;
  });

  const row = (r: Row) => r.type === 'entry' ? <EntryRow key={r.entry.key} e={r.entry} />
    : r.type === 'free' ? <Free key={`free:${r.from}`} from={r.from} to={r.to} />
    : <NowFree key="now" r={r} />;
  return (
    <section className={'td-line' + (phone ? '' : ' panel')} aria-labelledby="td-line-h">
      <div className="td-sh td-lh">
        <h2 id="td-line-h">Timeline</h2>
        <span className="muted sm num">{count ? `${count} on the clock` : 'Nothing on the clock'}</span>
      </div>
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
 * Today, on its own: the date and the numbers, the goals today moves and what has no slot yet, and the day as a
 * timeline. On a laptop it's a view of its own (Laptop.tsx); on a phone, a tab, in one column with the timeline before
 * what has no slot.
 */
export function TodayView({ phone }: { phone?: boolean }) {
  const { line, moving, from } = useToday();
  const noSlot = line.anytime.length > 0 && <NoSlot list={line.anytime} />;
  return (
    <div className={'td' + (phone ? ' ph' : '')}>
      <DayHead line={line} from={from} />
      <div className="td-left">
        <GoalsToday views={moving} />
        {!phone && noSlot}
      </div>
      <Timeline line={line} from={from} phone={phone} />
      {phone && noSlot}
    </div>
  );
}
