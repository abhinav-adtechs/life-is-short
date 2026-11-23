'use client';

import { useState } from 'react';
import { PRI } from '@/lib/model';
import { hasSupabase } from '@/lib/supabase';
import { progress } from '@/lib/select';
import { dueLabel, fmtDur } from '@/lib/format';
import { archivedGoals } from '@/lib/goals';
import { usePlanner } from './Planner';
import { Brand } from './Brand';
import { NextCard } from './Next';
import { PhoneMatrix, useOpenCount } from './Matrix';
import { PhoneCalendar } from './Calendar';
import { TodayView } from './TodayView';
import { ChatDock } from './Chat';
import { Panel } from './Panel';
import { Ambient } from './Ambient';
import { AnalyticsIcon, ArchiveIcon, MoreIcon, SettingsIcon, ShareIcon, TargetIcon } from './icons';
import { useGoalWeek } from './Goals';

const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;

/** The ••• menu: how the day and week are going and how much went to goals, then Goals, the archive, Analytics, Share and Settings. */
function Menu({ onClose }: { onClose: () => void }) {
  const { tasks, now, prefs, openSheet, inbox, topGoals: activeGoals, goals } = usePlanner();
  const m = progress(tasks, now, prefs.weekStart);
  const archived = archivedGoals(goals);
  const g = useGoalWeek();
  const share = g.share == null ? null : Math.round(g.share * 100);
  const go = (k: 'goals' | 'archive' | 'analytics' | 'share' | 'settings') => { onClose(); openSheet(k); };
  return (
    <>
      <div className="menu-out" onClick={onClose} />
      <div className="menu" role="menu" aria-label="Menu">
        <div className="menu-m">
          <div><div className="menu-r"><span className="muted">Today</span><b className="num">{m.today.done} of {m.today.total} done</b></div><span className="bar wide"><i style={{ width: pct(m.today.done, m.today.total) }} /></span></div>
          <div><div className="menu-r"><span className="muted">This week</span><b className="num">{m.week.done} of {m.week.total} done</b></div><span className="bar wide"><i style={{ width: pct(m.week.done, m.week.total) }} /></span></div>
          {activeGoals.length > 0 && <div><div className="menu-r"><span className="muted">On goals this week</span><b className="num">{share == null ? '–' : `${share}%`}</b></div><span className="bar wide ongoal"><i style={{ width: `${share ?? 0}%` }} /></span></div>}
          <div className="menu-r"><span className="muted">Backlog</span><b className="num">{m.backlog.open} open · {m.backlog.urgent} urgent</b></div>
        </div>
        <button type="button" role="menuitem" onClick={() => go('goals')}><TargetIcon size={17} /><span>Goals</span><span className="muted sm">{activeGoals.length ? `${activeGoals.length} in focus` : 'Set them'}</span></button>
        {archived.length > 0 && <button type="button" role="menuitem" onClick={() => go('archive')}><ArchiveIcon size={17} /><span>Archive</span><span className="muted sm">{archived.filter(g => g.status === 'achieved').length} done</span></button>}
        <button type="button" role="menuitem" onClick={() => go('analytics')}><AnalyticsIcon size={17} /><span>Analytics</span><span className="muted sm">Full breakdown</span></button>
        {hasSupabase() && <button type="button" role="menuitem" onClick={() => go('share')}><ShareIcon size={17} /><span>Share</span>{inbox > 0 && <span className="muted sm">{inbox} waiting</span>}</button>}
        <button type="button" role="menuitem" data-settings-button="" onClick={() => go('settings')}><SettingsIcon size={17} /><span>Settings</span></button>
      </div>
    </>
  );
}

/** While a task is picked, it takes the Next card's place: tap a time on the calendar below. */
function SchedulingCard() {
  const { picked, setPicked, store, labelOf, goalOf, now } = usePlanner();
  const t = picked ? store.get(picked) : undefined;
  if (!t) return null;
  const meta = [PRI[t.priority], goalOf(t)?.title ?? labelOf(t)?.name, fmtDur(t.minutes), t.due ? dueLabel(t.due, now).text : null].filter(Boolean).join(' · ');
  return (
    <section className="ph-pick" aria-label="Scheduling" role="status">
      <div className="ph-pick-b">
        <b className="hot">Tap a time to schedule</b>
        <p className="ph-pick-t">{t.title}</p>
        <p className="note">{meta}</p>
      </div>
      <button type="button" className="btn text tall" onClick={() => setPicked(null)}>Cancel</button>
    </section>
  );
}

/**
 * The phone planner: the task you're on, then today on its own, the goal matrix or the calendar a tab away (Today
 * shows the task to do now on its line, in place of the card). The chat bar sits under your
 * thumb and rises into a sheet; Goals, Analytics, Share and Settings are in the ••• menu.
 */
export function Phone() {
  const { tasks, now, prefs, editorId, sheet, chat, picked, phoneTab, setPhoneTab } = usePlanner();
  const open = useOpenCount();
  const [menu, setMenu] = useState(false);
  const m = progress(tasks, now, prefs.weekStart);
  const covered = !!editorId || !!sheet || chat.open || menu;
  return (
    <div className="phone">
      <header className="ph-top" inert={!!editorId || !!sheet || chat.open}>
        <Brand />
        <span className="spacer" />
        <button type="button" className="ph-prog" aria-label="Today’s progress" onClick={() => setMenu(true)}>
          <b className="num">{m.today.done} of {m.today.total}</b><span className="muted">today</span>
          <span className="bar mini"><i style={{ width: pct(m.today.done, m.today.total) }} /></span>
        </button>
        <button type="button" className="ib bare touch" aria-label="More" aria-expanded={menu} onClick={() => setMenu(o => !o)}><MoreIcon /></button>
      </header>
      <div className="ph-scroll" inert={covered}>
        {/* Today has the task to do now on its own line, so the Next card steps aside for it. */}
        {picked ? <SchedulingCard /> : phoneTab !== 'today' && <NextCard phone />}
        <div className="tabs" role="tablist" aria-label="Today, goals or calendar">
          <button type="button" role="tab" aria-selected={phoneTab === 'today'} onClick={() => setPhoneTab('today')}>Today</button>
          <button type="button" role="tab" aria-selected={phoneTab === 'matrix'} onClick={() => setPhoneTab('matrix')}>Goals <span className="muted num">{open}</span></button>
          <button type="button" role="tab" aria-selected={phoneTab === 'calendar'} onClick={() => setPhoneTab('calendar')}>Calendar</button>
        </div>
        {phoneTab === 'today' ? <TodayView phone /> : phoneTab === 'matrix' ? <PhoneMatrix /> : <PhoneCalendar />}
      </div>
      <Ambient />
      <ChatDock phone inert={!!editorId || !!sheet || menu} />
      {menu && <Menu onClose={() => setMenu(false)} />}
      <Panel />
    </div>
  );
}
