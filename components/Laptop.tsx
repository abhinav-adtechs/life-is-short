'use client';

import { hasSupabase } from '@/lib/supabase';
import { progress } from '@/lib/select';
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
import { AnalyticsIcon, SettingsIcon, ShareIcon } from './icons';

const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;

/** How today and the week are going, and what's waiting. Below 1240px, just today. */
function Metrics() {
  const { tasks, now, prefs, split } = usePlanner();
  const m = progress(tasks, now, prefs.weekStart);
  const wide = split.calW + split.matrixW + 38 >= 1240;
  return (
    <div className="metrics" aria-label="Progress">
      <div className="metric"><span>Today</span><b className="num">{m.today.done} of {m.today.total} done</b><span className="bar"><i style={{ width: pct(m.today.done, m.today.total) }} /></span></div>
      {wide && (
        <>
          <div className="metric"><span>This week</span><b className="num">{m.week.done} of {m.week.total}</b><span className="bar"><i style={{ width: pct(m.week.done, m.week.total) }} /></span></div>
          <div className="metric"><span>Backlog</span><b className="num">{m.backlog.open} open</b><span>· {m.backlog.urgent} urgent</span></div>
        </>
      )}
    </div>
  );
}

function Header() {
  const { now, openSheet, sheet, inbox } = usePlanner();
  return (
    <header className="lp-top">
      <Brand />
      <span className="spacer" />
      <Metrics />
      <span className="spacer" />
      <div className="lp-end">
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
 * The laptop planner: the task you're on and the priority matrix on the left, the calendar on the right, the chat bar
 * floating over both. The divider between them sets how many days the calendar shows.
 */
export function Laptop() {
  const { split, editorId, sheet } = usePlanner();
  const panel = !!editorId || !!sheet;
  const cols = `minmax(0,${(1 - split.f).toFixed(4)}fr) 14px minmax(0,${split.f.toFixed(4)}fr)`;
  return (
    <div className={'lp' + (split.dragging ? ' sizing' : '')}>
      <Header />
      <div className="lp-body" style={{ gridTemplateColumns: cols }} inert={panel}>
        <div className="lp-left">
          <NextCard />
          <MatrixPanel />
        </div>
        <Divider />
        <LaptopCalendar />
      </div>
      <Ambient />
      <ChatDock inert={panel} />
      <Panel />
    </div>
  );
}
