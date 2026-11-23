'use client';

import { useState } from 'react';
import { hasSupabase } from '@/lib/supabase';
import { clockLine } from '@/lib/format';
import { usePlanner } from './Planner';
import { Brand } from './Brand';
import { NextCard } from './Next';
import { MatrixPanel } from './Matrix';
import { Divider } from './Split';
import { LaptopCalendar } from './Calendar';
import { ChatDock } from './Chat';
import { Panel } from './Panel';
import { Ambient } from './Ambient';
import { AnalyticsIcon, CalendarIcon, SettingsIcon, ShareIcon, SunIcon, TargetIcon } from './icons';
import { GoalRail } from './GoalRail';
import { GoalsView } from './GoalsView';
import { TodayView } from './TodayView';
import { useGoalWeek } from './Goals';
import { fmtDur } from '@/lib/format';

/** How much of this week's time went to your goals. Opens Goals. */
export function OnGoals() {
  const { topGoals, openSheet, goalsLoaded } = usePlanner();
  const g = useGoalWeek();
  if (!goalsLoaded) return null;
  if (!topGoals.length) {
    return <button type="button" className="metric mlink" onClick={() => openSheet('goals')}><TargetIcon size={13} /><span>No goals yet</span><b>Set them</b></button>;
  }
  const on = topGoals.reduce((n, x) => n + (g.rolled.get(x.id)?.spent ?? 0), 0);
  const share = g.share ?? 0;
  return (
    <button type="button" className="metric mlink" onClick={() => openSheet('goals')} title={`${fmtDur(on)} on goals this week`}>
      <span>On goals</span><b className="num">{g.share == null ? '–' : `${Math.round(share * 100)}%`}</b>
      <span className="bar ongoal"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
    </button>
  );
}

/** The three views: today on its own, the calendar with your goals beside it, or your goals in full. */
function ViewSwitch() {
  const { mainView, setMainView } = usePlanner();
  return (
    <nav className="vswitch" aria-label="View">
      <button type="button" aria-pressed={mainView === 'today'} onClick={() => setMainView('today')}><SunIcon size={14} />Today</button>
      <button type="button" aria-pressed={mainView === 'calendar'} onClick={() => setMainView('calendar')}><CalendarIcon size={14} />Calendar</button>
      <button type="button" aria-pressed={mainView === 'goals'} onClick={() => setMainView('goals')}><TargetIcon size={14} />Goals</button>
    </nav>
  );
}

function Header() {
  const { now, openSheet, sheet, inbox, mainView } = usePlanner();
  return (
    <header className="lp-top">
      <Brand />
      <ViewSwitch />
      <span className="spacer" />
      <div className="lp-end">
        {mainView !== 'today' && <div className="metrics" aria-label="This week"><OnGoals /></div>}
        <span className="clock num">{clockLine(now)}</span>
        <span className="vsep" aria-hidden="true" />
        <div className="lp-tools">
          <button type="button" className="btn ghost sm" aria-pressed={sheet === 'analytics'} onClick={() => openSheet('analytics')}><AnalyticsIcon />Analytics</button>
          {hasSupabase() && (
            <button type="button" className="btn ghost sm" aria-pressed={sheet === 'share'} onClick={() => openSheet('share')}>
              <ShareIcon />Share{inbox > 0 && <span className="badge num" aria-label={`${inbox} suggestion${inbox === 1 ? '' : 's'} waiting`}>{inbox}</span>}
            </button>
          )}
          <button type="button" className="btn ghost sm" aria-pressed={sheet === 'settings'} data-settings-button="" onClick={() => openSheet('settings')}><SettingsIcon />Settings</button>
        </div>
      </div>
    </header>
  );
}

/**
 * The laptop planner, in one of three views. Today: today on its own, with only the goals it moves and the day as a
 * timeline. Calendar: the task you're on and your goals (just the goals; the backlog behind a tray) on the left, the
 * calendar on the right, with today's outcomes across its top once the day is planned. Goals: every goal, and the one
 * you open as its route or its map. The chat bar floats over all three.
 */
export function Laptop() {
  const { split, editorId, sheet, mainView } = usePlanner();
  const [backlog, setBacklog] = useState(false);
  const panel = !!editorId || !!sheet;
  const cols = `minmax(0,${(1 - split.f).toFixed(4)}fr) 14px minmax(0,${split.f.toFixed(4)}fr)`;
  return (
    <div className={'lp' + (split.dragging ? ' sizing' : '')}>
      <Header />
      {mainView === 'today' ? (
        <div className="lp-body lp-today" inert={panel}>
          <TodayView />
        </div>
      ) : mainView === 'goals' ? (
        <div className="lp-body lp-goals" inert={panel}>
          <GoalsView />
        </div>
      ) : (
        <div className="lp-body" style={{ gridTemplateColumns: cols }} inert={panel}>
          <div className="lp-left">
            <NextCard />
            {backlog ? <MatrixPanel onBack={() => setBacklog(false)} /> : <GoalRail onBacklog={() => setBacklog(true)} />}
          </div>
          <Divider />
          <LaptopCalendar />
        </div>
      )}
      <Ambient />
      <ChatDock inert={panel} />
      <Panel />
    </div>
  );
}
