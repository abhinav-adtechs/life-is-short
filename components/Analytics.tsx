'use client';

import { weekStats } from '@/lib/analytics';
import { rangeTitle } from '@/lib/calview';
import { fmtDur } from '@/lib/format';
import { PRI } from '@/lib/model';
import { DOW, DOWL, ymd } from '@/lib/time';
import { usePlanner } from './Planner';

const tint = (color: string) => ({ '--c': color } as React.CSSProperties);
const pct = (a: number, b: number) => `${b ? ((a / b) * 100).toFixed(1) : 0}%`;

/** How the week is going: what got done each day, where the time went, and what waits. */
export function Analytics() {
  const { tasks, now, prefs, labelOf, wide } = usePlanner();
  const s = weekStats(tasks, now, { firstDow: prefs.weekStart, labelOf: t => labelOf(t)?.id ?? null });
  const unit = 96 / Math.max(3, ...s.days.map(d => d.total));
  const rows = [...prefs.labels.map(l => ({ key: l.id, name: l.name, color: l.color as string | null })), { key: '', name: 'No label', color: null }]
    .map(r => ({ ...r, minutes: s.byLabel.get(r.key) ?? 0 }));
  const most = Math.max(1, s.events, ...rows.map(r => r.minutes));
  const mostN = Math.max(1, ...s.byPriority.map(p => p.count));
  const cols = { gridTemplateColumns: wide ? '132px minmax(0,1fr) 92px' : '108px minmax(0,1fr) 84px' };
  const todayKey = ymd(now);
  return (
    <div className="an">
      <section>
        <div className="an-h"><b>This week</b><span className="muted sm">{rangeTitle(s.days.map(d => d.day), { weekNumbers: false })}</span></div>
        <div className="an-big"><span className="num">{s.done}</span><span className="muted">of {s.total} done</span></div>
        <div className="an-bars">
          {s.days.map(d => (
            <div key={ymd(d.day)} className="an-col" title={`${DOWL[d.day.getDay()]}: ${d.done} done, ${d.missed} missed, ${d.todo} to do`}>
              <div className="an-stack">
                <span className="todo" style={{ height: d.todo * unit }} />
                <span className="missed" style={{ height: d.missed * unit }} />
                <span className="done" style={{ height: d.done * unit }} />
              </div>
            </div>
          ))}
        </div>
        <div className="an-days">
          {s.days.map(d => (
            <div key={ymd(d.day)} className={ymd(d.day) === todayKey ? 'today' : undefined}>
              <b>{DOW[d.day.getDay()]}</b><span className="num">{d.total ? `${d.done}/${d.total}` : '–'}</span>
            </div>
          ))}
        </div>
        <div className="an-key">
          <span><i className="done" />Done</span><span><i className="missed" />Missed</span><span><i className="todo" />Still to do</span>
        </div>
      </section>

      <section>
        <div className="an-h"><b>Scheduled time</b><span className="muted sm">this week, by label</span></div>
        <div className="an-rows">
          {rows.map(r => (
            <div key={r.key || '-'} className="an-row" style={cols}>
              <span className="an-name"><span className={'dot' + (r.color ? '' : ' none')} style={r.color ? tint(r.color) : undefined} /><span className="ell">{r.name}</span></span>
              <span className="an-track"><i style={{ width: pct(r.minutes, most), background: r.color ?? 'var(--faint)' }} /></span>
              <span className="an-v num">{r.minutes ? fmtDur(r.minutes) : '–'}</span>
            </div>
          ))}
          <div className="an-row" style={cols}>
            <span className="an-name"><span className="dot sq" /><span className="ell">Calendar events</span></span>
            <span className="an-track"><i style={{ width: pct(s.events, most), background: 'var(--muted)' }} /></span>
            <span className="an-v num">{s.events ? fmtDur(s.events) : '–'}</span>
          </div>
        </div>
      </section>

      <section>
        <div className="an-h"><b>Backlog</b><span className="muted sm num">{s.open} open · {fmtDur(s.estimate || 0).replace(/^0 min$/, '0 h')} estimated</span></div>
        <div className="an-rows">
          {s.byPriority.map(p => (
            <div key={p.priority} className="an-row" style={cols}>
              <span className="an-name"><span>{PRI[p.priority]}</span><b className="num">{p.count}</b></span>
              <span className="an-track"><i style={{ width: pct(p.count, mostN), background: p.priority === 1 ? 'var(--accent)' : p.priority === 2 ? 'var(--ink)' : 'var(--faint)' }} /></span>
              <span className="an-v num">{p.minutes ? fmtDur(p.minutes) : '–'}</span>
            </div>
          ))}
        </div>
        <p className="note">{s.overdue} overdue · {s.missed} {s.missed === 1 ? 'block' : 'blocks'} missed on the calendar</p>
      </section>
    </div>
  );
}
