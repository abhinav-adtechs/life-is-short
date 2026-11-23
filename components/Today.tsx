'use client';

import { useMemo, useState } from 'react';
import type { Task } from '@/lib/model';
import { clearPlan, outcomeView, type OutcomeView } from '@/lib/today';
import { rootOf } from '@/lib/goals';
import { fmtTime, shortTitle } from '@/lib/format';
import { addDays, startOfDay, ymd } from '@/lib/time';
import { usePlanner } from './Planner';
import { CheckIcon, SparkIcon, TargetIcon } from './icons';

/*
 * Today, once it's planned: the outcome each goal in focus produces by tonight, across the top of the calendar, with
 * the steps that make it and how far along it is (tasks and key results, never time). You plan the day with Claude in
 * the morning (MCP plan_today). Until then nothing shows up here and the calendar has the room.
 */

/** Today's outcomes, worked out from the plan, your goals and your tasks. Empty while today isn't planned. */
export function useTodayOutcomes(): OutcomeView[] {
  const { todayPlan, goals, tasks, now } = usePlanner();
  const day0 = startOfDay(now).getTime();
  return useMemo(() => {
    if (!todayPlan) return [];
    const to = addDays(day0, 1).getTime();
    return todayPlan.focus.flatMap(o => { const v = outcomeView(o, goals, tasks, day0, to); return v ? [v] : []; });
  }, [todayPlan, goals, tasks, day0]);
}

/** The ids of the top goals today's plan is about, for marking their cards. */
export function useTodayGoals(): Set<string> {
  const { goals } = usePlanner();
  const views = useTodayOutcomes();
  return useMemo(() => {
    const index = new Map(goals.map(g => [g.id, g]));
    return new Set(views.map(v => rootOf(index, v.goal).id));
  }, [views, goals]);
}

const STEPS_SHOWN = 3;
const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

function Step({ t, now, first }: { t: Task; now: number; first: boolean }) {
  const { done, completing, openEditor } = usePlanner();
  const on = t.status === 'done' || completing.has(t.id);
  const late = t.status === 'open' && t.start != null && t.start + t.minutes * 60000 < now;
  const when = t.status === 'done' ? 'Done' : t.start != null ? fmtTime(t.start) : 'No slot';
  return (
    <li className={'tb-s' + (on ? ' done' : '') + (first ? ' up' : '')}>
      <button type="button" className={'ck' + (on ? ' on' : '')} aria-label={`${t.status === 'done' ? 'Not done' : 'Done'}: ${t.title}`}
        onClick={() => { if (!completing.has(t.id)) done(t.id, t.status !== 'done'); }}>
        <span className="ring"><CheckIcon size={9} w={2.6} /></span>
      </button>
      <button type="button" className="tb-st" onClick={() => openEditor(t.id)}>{t.title}</button>
      <span className={'tb-sw num' + (late ? ' hot' : '')}>{when}</span>
    </li>
  );
}

function OutcomeCard({ v }: { v: OutcomeView }) {
  const { prefs, now, goals } = usePlanner();
  const [all, setAll] = useState(false);
  const index = new Map(goals.map(g => [g.id, g]));
  const top = rootOf(index, v.goal);
  const section = prefs.labels.find(l => l.id === top.section) ?? null;
  const next = v.steps.find(t => t.status === 'open');
  const shown = all ? v.steps : v.steps.slice(0, STEPS_SHOWN);
  const met = v.goal.status === 'achieved' || (v.steps.length > 0 && v.done === v.steps.length);
  const t = v.tasks;
  return (
    <article className={'tb-o' + (met ? ' met' : '')} style={tint(section?.color)} aria-label={`${v.goal.title}: ${v.outcome.text}`}>
      <span className="tb-g"><span className="dot" /><span className="ell">{v.goal.parent ? `${shortTitle(top.title, 22)} › ` : ''}{v.goal.title}</span>{met && <span className="loz hot">Met</span>}</span>
      <p className="tb-t">{v.outcome.text}</p>
      {v.steps.length > 0 && (
        <span className="tb-seg" role="img" aria-label={`${v.done} of ${v.steps.length} of today’s steps done`}>
          {v.steps.map(s => <i key={s.id} className={s.status === 'done' ? 'on' : s === next ? 'up' : undefined} />)}
        </span>
      )}
      {v.steps.length ? (
        <ul className="tb-sl">
          {shown.map(s => <Step key={s.id} t={s} now={now} first={s === next} />)}
          {v.steps.length > STEPS_SHOWN && (
            <li><button type="button" className="link sm tb-more" onClick={() => setAll(a => !a)}>{all ? 'Fewer' : `${v.steps.length - STEPS_SHOWN} more`}</button></li>
          )}
        </ul>
      ) : <p className="tb-none">No steps on the calendar for it yet.</p>}
      <p className="tb-m num">
        <span>{v.done} of {v.steps.length} today</span>
        {t.all > 0 && <span>tasks {t.tonight > t.done ? <>{t.done} → <b>{t.tonight}</b></> : <b>{t.done}</b>} of {t.all} by tonight</span>}
        {v.results.all > 0 && <span>key results {v.results.done} of {v.results.all}</span>}
      </p>
    </article>
  );
}

/**
 * Today's outcomes, across the top of the calendar, while today is planned and on show. Nothing at all otherwise:
 * an unplanned day keeps the calendar's full height.
 */
export function TodayBand({ phone }: { phone?: boolean }) {
  const { todayPlan, changeDays, toast, now } = usePlanner();
  const views = useTodayOutcomes();
  if (!todayPlan || !views.length) return null;
  const left = views.reduce((n, v) => n + v.steps.filter(s => s.status === 'open').length, 0);
  const at = todayPlan.at ? fmtTime(todayPlan.at) : null;
  const clear = () => toast('Today isn’t planned any more.', changeDays(clearPlan(ymd(now))));
  return (
    <section className={'tb' + (phone ? ' ph' : '')} aria-labelledby="tb-h">
      <div className="tb-h">
        <h3 id="tb-h">Today’s outcomes</h3>
        <span className="muted sm">
          {todayPlan.by === 'claude' ? 'Planned with Claude' : 'Planned'}{at ? ` at ${at}` : ''}
          {' · '}{left ? `${left} step${left === 1 ? '' : 's'} left` : 'every step done'}
        </span>
        <span className="spacer" />
        <button type="button" className="link sm muted" onClick={clear} title="Back to an unplanned day; Claude can plan it again">Clear</button>
      </div>
      <div className="tb-grid" style={{ '--n': views.length } as React.CSSProperties}>
        {views.map(v => <OutcomeCard key={v.goal.id} v={v} />)}
      </div>
    </section>
  );
}

/** What to ask Claude in the morning; the connector's plan_today saves the answer. */
export const PLAN_ASK = 'Plan my day in Life is short: look at my goals, my calendar and my backlog, agree with me which goals today is for and what each one produces by tonight, then save it with plan_today.';
export const PLAN_URL = `https://claude.ai/new?q=${encodeURIComponent(PLAN_ASK)}`;

/**
 * Today isn't planned: say so plainly, across the top of the calendar where the outcomes will go, with the way to plan
 * it. No goals show up here until the day is planned.
 */
export function PlanPrompt({ phone }: { phone?: boolean }) {
  const { todayPlan, goalsLoaded, topGoals, toast } = usePlanner();
  if (todayPlan || !goalsLoaded || !topGoals.length) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(PLAN_ASK); toast('Copied. Paste it into Claude to plan your day.'); }
    catch { toast('Couldn’t copy it here. Ask Claude to “plan my day”.'); }
  };
  return (
    <section className={'pp' + (phone ? ' ph' : '')} aria-labelledby="pp-h">
      <span className="pp-i" aria-hidden="true"><TargetIcon size={16} /></span>
      <div className="pp-b">
        <h3 id="pp-h">Today isn’t planned yet</h3>
        <p>Agree with Claude which goals today is for, and what each one produces by tonight. The outcomes show up here.</p>
      </div>
      <div className="pp-acts">
        <a className="btn pri sm" href={PLAN_URL} target="_blank" rel="noopener noreferrer"><SparkIcon size={13} />Plan with Claude</a>
        <button type="button" className="btn text sm" onClick={copy} title={PLAN_ASK}>Copy the ask</button>
      </div>
    </section>
  );
}
