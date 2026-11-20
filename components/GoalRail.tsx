'use client';

import { useMemo, useState } from 'react';
import { flatResults, resultDone, rootOf, type Goal } from '@/lib/goals';
import { fmtTime, shortDate } from '@/lib/format';
import { fromYmd } from '@/lib/time';
import type { OutcomeView } from '@/lib/today';
import { usePlanner, useLists } from './Planner';
import { useTodayOutcomes } from './Today';
import { TaskRow, doOrder, useByCard } from './Matrix';
import { daysLeft, fmtHrs, useGoalWeek } from './Goals';
import { ChevronDown, ChevronRight, ChevronUp, PlusIcon, TargetIcon } from './icons';

/*
 * The calendar view's left side: your goals, each as a card with how much of its work is done (big), what's left,
 * and its next tasks in the order to do them: tick them off, or drag one onto the calendar. Once today is planned,
 * the goals in focus come first with where they'll be by tonight, and the rest wait under "Not today". The goal's
 * name opens it in the Goals view. Everything not on the calendar is behind the Backlog tray at the foot.
 */

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
/** Tasks a card shows before "more". */
const SHOWN = 3;

function RailCard({ g, rank, view, dim }: { g: Goal; rank: number; view?: OutcomeView; dim?: boolean }) {
  const { prefs, now, openGoal, blocked, drag } = usePlanner();
  const byCard = useByCard();
  const { rolled } = useGoalWeek();
  const [more, setMore] = useState(false);
  const section = prefs.labels.find(l => l.id === g.section) ?? null;
  const e = byCard.get(g.id);
  const open = (e?.open ?? []).slice().sort(doOrder(blocked));
  const done = e?.done ?? 0;
  const toGo = open.length + (e?.later ?? 0);
  const all = done + toGo;
  const pct = all ? Math.round((done / all) * 100) : null;
  // By tonight: today's open steps for it, done.
  const tonightDone = view ? done + view.steps.filter(s => s.status === 'open').length : null;
  const tonight = tonightDone != null && all ? Math.round((Math.min(all, tonightDone) / all) * 100) : null;
  const krs = flatResults(g.results).filter(x => !x.parent).map(x => x.kr);
  const left = g.by ? daysLeft(g.by, now) : null;
  const spent = rolled.get(g.id)?.spent ?? 0;
  const shown = more ? open : open.slice(0, SHOWN);
  const over = drag.view && drag.view.kind !== 'resize' && drag.view.cell === `${g.id}|*`;
  return (
    <article className={'rc' + (dim ? ' dim' : '') + (view ? ' focus' : '') + (over ? ' over' : '')} style={tint(section?.color)} data-cell={`${g.id}|*`}
      aria-label={`Goal ${rank}: ${g.title}`}>
      <header className="rc-h">
        <span className="goal-n num" aria-hidden="true">{rank}</span>
        <div className="rc-t">
          <button type="button" className="rc-name" onClick={() => openGoal(g.id)} title="Open it in Goals">{g.title}</button>
          <p className="rc-m">
            {view && <span className="gc-today">Today</span>}
            {section && <span>{section.name}</span>}
            {g.by && left && <span className={left.hot ? 'hot' : undefined}>By {shortDate(fromYmd(g.by).getTime(), now)} · {left.text}</span>}
            {krs.length > 0 && <span>Key results {krs.filter(resultDone).length} of {krs.length}</span>}
            <span className="num">{spent ? `${fmtHrs(spent)} this week` : 'Nothing this week'}</span>
          </p>
        </div>
        <div className="rc-pct" role="img" aria-label={pct == null ? 'No tasks yet' : `${pct}% done: ${done} done, ${toGo} to go`}>
          <b className="num">{pct == null ? '–' : `${pct}%`}</b>
          <span className="num">{all ? `${done} done · ${toGo} to go` : 'No tasks yet'}</span>
        </div>
      </header>
      <div className="rc-bar" aria-hidden="true">
        <i style={{ width: `${pct ?? 0}%` }} />
        {tonight != null && pct != null && tonight > pct && <i className="ahead" style={{ left: `${pct}%`, width: `${tonight - pct}%` }} />}
      </div>
      {view && tonight != null && tonight > (pct ?? 0) && (
        <p className="rc-tonight num">Finish today’s {view.steps.filter(s => s.status === 'open').length} and it’s <b>{tonight}%</b> by tonight</p>
      )}
      {open.length > 0 ? (
        <div className="rc-list">
          {shown.map(t => <TaskRow key={t.id} t={t} kind="open" delay="0ms" card={g.id} />)}
          {open.length > SHOWN && (
            <button type="button" className="link sm rc-more" aria-expanded={more} onClick={() => setMore(m => !m)}>
              {more ? 'Show fewer' : `${open.length - SHOWN} more`}
            </button>
          )}
        </div>
      ) : (
        <p className="rc-empty">Nothing open on it. <button type="button" className="link" onClick={() => openGoal(g.id)}>Plan the next step</button>.</p>
      )}
    </article>
  );
}

export function GoalRail({ onBacklog }: { onBacklog: () => void }) {
  const { topGoals, goals, todayPlan, goalsLoaded, setMainView } = usePlanner();
  const { backlog } = useLists();
  const byCard = useByCard();
  const views = useTodayOutcomes();
  const [showRest, setShowRest] = useState(true);
  const index = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const byTop = new Map<string, OutcomeView>();
  for (const v of views) { const top = rootOf(index, v.goal).id; if (!byTop.has(top)) byTop.set(top, v); }
  const focus = topGoals.filter(g => byTop.has(g.id));
  const rest = topGoals.filter(g => !byTop.has(g.id));
  const rank = (g: Goal) => topGoals.indexOf(g) + 1;
  const offOpen = byCard.get('')?.open.length ?? 0;
  const planned = !!todayPlan && focus.length > 0;

  return (
    <section className="gr panel" aria-label="Your goals">
      <div className="gr-scroll">
        {planned ? (
          <>
            <div className="gr-h">
              <h2>Today’s focus</h2>
              <span className="muted sm">planned {todayPlan.by === 'claude' ? 'with Claude ' : ''}{todayPlan.at ? `at ${fmtTime(todayPlan.at)}` : ''}</span>
            </div>
            <div className="gr-l">{focus.map(g => <RailCard key={g.id} g={g} rank={rank(g)} view={byTop.get(g.id)} />)}</div>
            {rest.length > 0 && (
              <>
                <button type="button" className="gr-h gr-fold" aria-expanded={showRest} onClick={() => setShowRest(o => !o)}>
                  {showRest ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<h2>Not today</h2><span className="muted sm num">{rest.length}</span>
                </button>
                {showRest && <div className="gr-l">{rest.map(g => <RailCard key={g.id} g={g} rank={rank(g)} dim />)}</div>}
              </>
            )}
          </>
        ) : (
          <>
            <div className="gr-h">
              <h2>Your goals</h2>
              {topGoals.length > 0 && <span className="muted sm">most important first</span>}
              <span className="spacer" />
              {goalsLoaded && topGoals.length > 0 && <span className="gr-unplanned">Today isn’t planned</span>}
            </div>
            {topGoals.length > 0 && <div className="gr-l">{topGoals.map(g => <RailCard key={g.id} g={g} rank={rank(g)} />)}</div>}
          </>
        )}
        {goalsLoaded && !topGoals.length && (
          <div className="gr-empty">
            <span className="gempty-i"><TargetIcon size={18} /></span>
            <p className="note"><b>Set your goals.</b> The four or five outcomes that matter most right now. Every task then moves one, or it’s off-goal.</p>
            <button type="button" className="btn pri sm" onClick={() => setMainView('goals')}><PlusIcon size={13} />Set goals</button>
          </div>
        )}
        {offOpen > 0 && (
          <button type="button" className="gr-off" onClick={onBacklog} title="Off-goal work is in the backlog">
            <span className="dot none" />Off-goal<span className="muted num">{offOpen} open</span>
          </button>
        )}
      </div>
      <button type="button" className="gr-tray" onClick={onBacklog} title="Everything not on the calendar, by goal: drag it onto the calendar to plan it">
        <span><b>Backlog</b> <span className="muted sm num">{backlog.length} open</span></span>
        <ChevronUp size={13} />
      </button>
    </section>
  );
}
