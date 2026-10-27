'use client';

import { useState } from 'react';
import { PRI } from '@/lib/model';
import { hasSupabase } from '@/lib/supabase';
import { progress } from '@/lib/select';
import { dueLabel, fmtDur } from '@/lib/format';
import { usePlanner, useLists } from './Planner';
import { Brand } from './Brand';
import { NextCard } from './Next';
import { PhoneMatrix } from './Matrix';
import { PhoneCalendar } from './Calendar';
import { ChatDock } from './Chat';
import { Panel } from './Panel';
import { Ambient } from './Ambient';
import { AnalyticsIcon, MoreIcon, SettingsIcon, ShareIcon } from './icons';

const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;

/** The ••• menu: how the day and week are going, then Analytics, Share and Settings. */
function Menu({ onClose }: { onClose: () => void }) {
  const { tasks, now, prefs, openSheet, inbox } = usePlanner();
  const m = progress(tasks, now, prefs.weekStart);
  const go = (k: 'analytics' | 'share' | 'settings') => { onClose(); openSheet(k); };
  return (
    <>
      <div className="menu-out" onClick={onClose} />
      <div className="menu" role="menu" aria-label="Menu">
        <div className="menu-m">
          <div><div className="menu-r"><span className="muted">Today</span><b className="num">{m.today.done} of {m.today.total} done</b></div><span className="bar wide"><i style={{ width: pct(m.today.done, m.today.total) }} /></span></div>
          <div><div className="menu-r"><span className="muted">This week</span><b className="num">{m.week.done} of {m.week.total} done</b></div><span className="bar wide"><i style={{ width: pct(m.week.done, m.week.total) }} /></span></div>
          <div className="menu-r"><span className="muted">Backlog</span><b className="num">{m.backlog.open} open · {m.backlog.urgent} urgent</b></div>
        </div>
        <button type="button" role="menuitem" onClick={() => go('analytics')}><AnalyticsIcon size={17} /><span>Analytics</span><span className="muted sm">Full breakdown</span></button>
        {hasSupabase() && <button type="button" role="menuitem" onClick={() => go('share')}><ShareIcon size={17} /><span>Share</span>{inbox > 0 && <span className="muted sm">{inbox} waiting</span>}</button>}
        <button type="button" role="menuitem" data-settings-button="" onClick={() => go('settings')}><SettingsIcon size={17} /><span>Settings</span></button>
      </div>
    </>
  );
}

/** While a task is picked, it takes the Next card's place: tap a time on the calendar below. */
function SchedulingCard() {
  const { picked, setPicked, store, labelOf, now } = usePlanner();
  const t = picked ? store.get(picked) : undefined;
  if (!t) return null;
  const meta = [PRI[t.priority], labelOf(t)?.name, fmtDur(t.minutes), t.due ? dueLabel(t.due, now).text : null].filter(Boolean).join(' · ');
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
 * The phone planner: the task you're on, then the matrix or the calendar a tab away. The chat bar sits under your
 * thumb and rises into a sheet; Analytics, Share and Settings are in the ••• menu.
 */
export function Phone() {
  const { tasks, now, prefs, editorId, sheet, chat, picked, phoneTab, setPhoneTab } = usePlanner();
  const { backlog } = useLists();
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
        {picked ? <SchedulingCard /> : <NextCard phone />}
        <div className="tabs" role="tablist" aria-label="Matrix or calendar">
          <button type="button" role="tab" aria-selected={phoneTab === 'matrix'} onClick={() => setPhoneTab('matrix')}>Matrix <span className="muted num">{backlog.length}</span></button>
          <button type="button" role="tab" aria-selected={phoneTab === 'calendar'} onClick={() => setPhoneTab('calendar')}>Calendar</button>
        </div>
        {phoneTab === 'matrix' ? <PhoneMatrix /> : <PhoneCalendar />}
      </div>
      <Ambient />
      <ChatDock phone inert={!!editorId || !!sheet || menu} />
      {menu && <Menu onClose={() => setMenu(false)} />}
      <Panel />
    </div>
  );
}
