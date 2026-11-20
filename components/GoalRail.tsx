'use client';

import { useMemo, useState } from 'react';
import { flatResults, resultDone, rootOf, treeTasks, type Goal } from '@/lib/goals';
import { fmtTime } from '@/lib/format';
import { isEvent } from '@/lib/select';
import type { OutcomeView } from '@/lib/today';
import { usePlanner, useLists } from './Planner';
import { useTodayOutcomes } from './Today';
import { ChevronDown, ChevronRight, ChevronUp, PlusIcon, TargetIcon } from './icons';

/*
 * The calendar view's left side: your goals and nothing else, no tasks inside them. Once today is planned, the goals
 * in focus come first with where they'll be by tonight, and the rest wait under "Not today". Click a goal to open it
 * in the Goals view. The backlog sits behind a tray at the foot.
 */

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/** A goal's key results as small blocks: filled when done. */
function Pips({ g }: { g: Goal }) {
  const tops = flatResults(g.results).filter(x => !x.parent).map(x => x.kr);
  if (!tops.length) return null;
  const done = tops.filter(resultDone).length;
  return (
    <span className="gr-pips" role="img" aria-label={`Key results: ${done} of ${tops.length} done`}>
      {tops.map(kr => <i key={kr.id} className={resultDone(kr) ? 'on' : undefined} />)}
    </span>
  );
}

function Row({ g, rank, view, dim }: { g: Goal; rank: number; view?: OutcomeView; dim?: boolean }) {
  const { prefs, goals, tasks, openGoal } = usePlanner();
  const section = prefs.labels.find(l => l.id === g.section) ?? null;
  const t = view ? view.tasks : treeTasks(goals, tasks, g.id);
  const pct = t.all ? Math.round((t.done / t.all) * 100) : null;
  const tonight = view && t.all ? Math.round((view.tasks.tonight / t.all) * 100) : null;
  const line = !t.all ? 'No tasks yet'
    : view && view.tasks.tonight > t.done ? <>tasks {t.done} → <b>{view.tasks.tonight}</b> of {t.all} by tonight</>
    : `${t.done} of ${t.all} tasks done`;
  return (
    <li>
      <button type="button" className={'gr-row' + (dim ? ' dim' : '') + (view ? ' focus' : '')} style={tint(section?.color)} onClick={() => openGoal(g.id)}
        title={`Open ${g.title}`}>
        <span className="gr-top">
          <span className="goal-n num" aria-hidden="true">{rank}</span>
          <span className="gr-t">{g.title}</span>
          {pct != null && <span className="gr-pct num">{pct}%</span>}
        </span>
        <span className="gr-bar" aria-hidden="true">
          <i style={{ width: `${pct ?? 0}%` }} />
          {tonight != null && tonight > (pct ?? 0) && <i className="ahead" style={{ left: `${pct ?? 0}%`, width: `${tonight - (pct ?? 0)}%` }} />}
        </span>
        <span className="gr-m"><Pips g={g} /><span className="num">{line}</span></span>
      </button>
    </li>
  );
}

export function GoalRail({ onBacklog }: { onBacklog: () => void }) {
  const { topGoals, goals, tasks, todayPlan, goalsLoaded, setMainView, isOff } = usePlanner();
  const { backlog } = useLists();
  const views = useTodayOutcomes();
  const [showRest, setShowRest] = useState(true);
  const index = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const byTop = new Map<string, OutcomeView>();
  for (const v of views) { const top = rootOf(index, v.goal).id; if (!byTop.has(top)) byTop.set(top, v); }
  const focus = topGoals.filter(g => byTop.has(g.id));
  const rest = topGoals.filter(g => !byTop.has(g.id));
  const rank = (g: Goal) => topGoals.indexOf(g) + 1;
  const offOpen = tasks.filter(t => t.status === 'open' && !isOff(t) && !isEvent(t) && !(t.goal && index.get(t.goal)?.status === 'active')).length;
  const planned = !!todayPlan && focus.length > 0;

  return (
    <section className="gr panel" aria-label="Your goals">
      <div className="gr-scroll">
        {planned ? (
          <>
            <div className="gr-h">
              <h2>Today’s focus</h2>
              <span className="muted sm">{todayPlan.by === 'claude' ? 'with Claude' : 'set'}{todayPlan.at ? ` at ${fmtTime(todayPlan.at)}` : ''}</span>
            </div>
            <ul className="gr-l">{focus.map(g => <Row key={g.id} g={g} rank={rank(g)} view={byTop.get(g.id)} />)}</ul>
            {rest.length > 0 && (
              <>
                <button type="button" className="gr-h gr-fold" aria-expanded={showRest} onClick={() => setShowRest(o => !o)}>
                  {showRest ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<h2>Not today</h2><span className="muted sm num">{rest.length}</span>
                </button>
                {showRest && <ul className="gr-l">{rest.map(g => <Row key={g.id} g={g} rank={rank(g)} dim />)}</ul>}
              </>
            )}
          </>
        ) : (
          <>
            <div className="gr-h"><h2>Your goals</h2>{topGoals.length > 0 && <span className="muted sm">most important first</span>}</div>
            {topGoals.length > 0 && <ul className="gr-l">{topGoals.map(g => <Row key={g.id} g={g} rank={rank(g)} />)}</ul>}
          </>
        )}
        {goalsLoaded && !topGoals.length && (
          <div className="gr-empty">
            <span className="gempty-i"><TargetIcon size={18} /></span>
            <p className="note"><b>Set your goals.</b> The four or five outcomes that matter most right now. Every task then moves one, or it’s off-goal.</p>
            <button type="button" className="btn pri sm" onClick={() => setMainView('goals')}><PlusIcon size={13} />Set goals</button>
          </div>
        )}
        {offOpen > 0 && <p className="gr-off muted sm num"><span className="dot none" />Off-goal · {offOpen} open</p>}
      </div>
      <button type="button" className="gr-tray" onClick={onBacklog} title="Everything not on the calendar, by goal: drag it onto the calendar to plan it">
        <span><b>Backlog</b> <span className="muted sm num">{backlog.length} open</span></span>
        <ChevronUp size={13} />
      </button>
    </section>
  );
}
