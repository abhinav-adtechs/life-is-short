'use client';

import { useId } from 'react';
import { DOW, DOWL } from '@/lib/time';
import { describeRepeat, describeRule, nextWhen, occurrenceOf, weekdayOfDay, type Repeat, type Rule } from '@/lib/repeat';
import { usePlanner } from './Planner';
import { radio, radioKeys } from './Controls';

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
/** Monday first, Sunday last. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];

type Preset = 'none' | 'day' | 'weekdays' | 'week' | 'month';
const presetOf = (r: Rule | null): Preset => (!r ? 'none' : r.freq === 'day' ? 'day' : r.freq === 'month' ? 'month'
  : r.every === 1 && r.days.join() === WEEKDAYS.join() ? 'weekdays' : 'week');
const UNIT = { day: 'day', week: 'week', month: 'month' } as const;
const everyName = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : n === 2 ? `Every other ${unit}` : `Every ${n} ${unit}s`);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/**
 * How a task repeats, in the task editor: not at all, every day, on weekdays, weekly on the days you pick, or monthly
 * on a date, every one or more of those, at a time or at any time. `day` is the task's own day, for the defaults.
 */
export function RepeatField({ rule, time, day, onRule, onTime, repeating }: {
  rule: Rule | null; time: string; day: string; onRule: (r: Rule | null) => void; onTime: (t: string) => void;
  /** It repeats already, so changes start with the next one. */
  repeating: boolean;
}) {
  const id = useId();
  const preset = presetOf(rule);
  const pick = (p: Preset) => {
    if (p === preset) return;
    if (p === 'none') onRule(null);
    else if (p === 'day') onRule({ freq: 'day', every: 1, days: [], monthDay: null });
    else if (p === 'weekdays') onRule({ freq: 'week', every: 1, days: WEEKDAYS, monthDay: null });
    else if (p === 'week') onRule({ freq: 'week', every: rule?.freq === 'week' ? rule.every : 1, days: [weekdayOfDay(day)], monthDay: null });
    else onRule({ freq: 'month', every: 1, days: [], monthDay: +day.slice(8, 10) });
  };
  const toggleDay = (d: number) => {
    if (!rule) return;
    const days = rule.days.includes(d) ? rule.days.filter(x => x !== d) : [...rule.days, d].sort((a, b) => a - b);
    if (days.length) onRule({ ...rule, days });
  };
  const everies = rule ? [...new Set([1, 2, 3, 4, rule.every])].sort((a, b) => a - b) : [];
  const chips: { p: Preset; name: string }[] = [
    { p: 'none', name: 'Doesn’t repeat' }, { p: 'day', name: 'Every day' }, { p: 'weekdays', name: 'Weekdays' }, { p: 'week', name: 'Weekly' }, { p: 'month', name: 'Monthly' },
  ];

  return (
    <div className="ed-f">
      <span className="flabel" id={`${id}-h`}>Repeat</span>
      <div className="chips" role="radiogroup" aria-labelledby={`${id}-h`} onKeyDown={radioKeys}>
        {chips.map(c => <button key={c.p} type="button" className="chipb" {...radio(preset === c.p)} onClick={() => pick(c.p)}>{c.name}</button>)}
      </div>
      {rule?.freq === 'week' && (
        <div className="wdays" role="group" aria-label="On these days">
          {WEEK.map(d => (
            <button key={d} type="button" className="chipb num" aria-pressed={rule.days.includes(d)} aria-label={DOWL[d]} title={DOWL[d]}
              onClick={() => toggleDay(d)}>{DOW[d].slice(0, 2)}</button>
          ))}
        </div>
      )}
      {rule && (
        <div className="chips">
          <label className="chipb sel">
            <span className="sr">How often</span>
            <select value={rule.every} onChange={e => onRule({ ...rule, every: Number(e.target.value) })}>
              {everies.map(n => <option key={n} value={n}>{everyName(n, UNIT[rule.freq])}</option>)}
            </select>
          </label>
          {rule.freq === 'month' && (
            <label className="chipb sel">
              <span className="sr">Day of the month</span>
              <select value={rule.monthDay ?? +day.slice(8, 10)} onChange={e => onRule({ ...rule, monthDay: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(n => <option key={n} value={n}>On the {ordinal(n)}</option>)}
              </select>
            </label>
          )}
          <label className="chipb sel rep-at">
            <span>At</span>
            <input type="time" step={900} aria-label="Time each one starts" value={time} onChange={e => onTime(e.target.value)} />
          </label>
          {time && <button type="button" className="btn text sm" onClick={() => onTime('')}>Any time</button>}
        </div>
      )}
      {rule && (
        <p className="note">
          {describeRule(rule)}: each one {time ? 'goes on the calendar at that time' : 'waits in the backlog, due that day'}.
          {repeating ? ' A change to the days or the time starts with the next one.' : ''} One still open when the next comes is replaced.
        </p>
      )}
    </div>
  );
}

/** Settings → Repeats: everything that repeats, when it comes next, and Stop. */
export function RepeatsSection() {
  const { repeats, applyRepeats, toast, tasks, openEditor, now, prefs } = usePlanner();
  const labels = new Map(prefs.labels.map(l => [l.id, l]));
  // Each repeat's open task, the latest if there's more than one.
  const open = new Map<string, string>();
  for (const t of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    const o = t.status === 'open' ? occurrenceOf(t.id) : null;
    if (o) open.set(o.repeat, t.id);
  }
  const stop = (r: Repeat) => {
    const undo = applyRepeats([{ kind: 'stop', id: r.id }]);
    toast(`Stopped repeating · ${r.title}${open.has(r.id) ? '. Its open one stays.' : ''}`, undo);
  };
  const sorted = [...repeats].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <section id="set-repeats" className="set-sec" aria-labelledby="set-repeats-h">
      <div className="set-h"><h3 id="set-repeats-h">Repeats</h3><span className="muted sm">each one comes on its day</span></div>
      {sorted.length ? (
        <ul className="reps">
          {sorted.map(r => {
            const label = r.label ? labels.get(r.label) : undefined;
            const next = nextWhen(r, now);
            const cur = open.get(r.id);
            return (
              <li key={r.id}>
                <span className={'dot' + (label ? '' : ' none')} style={tint(label?.color)} />
                <span className="rep-b">
                  {cur ? <button type="button" className="link rep-t" onClick={() => openEditor(cur)}>{r.title}</button> : <span className="rep-t">{r.title}</span>}
                  <span className="note">{describeRepeat(r)}{next ? ` · next ${next}` : ''}</span>
                </span>
                <button type="button" className="btn text sm" onClick={() => stop(r)}>Stop</button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="note">Nothing repeats yet. Say “order groceries every Monday and Thursday”, or set Repeat on any task.</p>
      )}
      <p className="note">
        Each one comes on its day, not before: on the calendar at its time, or in the backlog, due that day. One still open when
        the next comes is replaced, and counts as missed in the review. Stopping a repeat keeps the one you have.
      </p>
    </section>
  );
}
