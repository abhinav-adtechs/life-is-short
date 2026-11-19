'use client';

import { useId } from 'react';
import { DOW, DOWL } from '@/lib/time';
import {
  MAX_TIMES, describeRepeat, describeRule, nextWhen, occurrenceOf, repeatsDone, shiftDay, tallies, weekdayOfDay, type Repeat, type Rule,
} from '@/lib/repeat';
import { fromYmd } from '@/lib/time';
import { shortDate } from '@/lib/format';
import { usePlanner } from './Planner';
import { radio, radioKeys } from './Controls';

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
/** Monday first, Sunday last. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];

type Preset = 'none' | 'day' | 'weekdays' | 'week' | 'per' | 'month';
const presetOf = (r: Rule | null): Preset => (!r ? 'none' : r.per ? 'per' : r.freq === 'day' ? 'day' : r.freq === 'month' ? 'month'
  : r.every === 1 && r.days.join() === WEEKDAYS.join() ? 'weekdays' : 'week');
const UNIT = { day: 'day', week: 'week', month: 'month' } as const;
const everyName = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : n === 2 ? `Every other ${unit}` : `Every ${n} ${unit}s`);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

type End = 'never' | 'until' | 'times';
const endOf = (r: Rule): End => (r.times ? 'times' : r.until ? 'until' : 'never');

/**
 * How a task repeats, in the task editor: not at all, every day, on weekdays, weekly on the days you pick (several
 * times a week), or monthly on a date; every one or more of those (every other week is bi-weekly); at a time or at any
 * time; and when it ends: never, on a day, or once it's been done a number of times. `day` is the task's own day, for
 * the defaults; `done`, how many of it are done so far.
 */
export function RepeatField({ rule, time, day, onRule, onTime, repeating, done = 0 }: {
  rule: Rule | null; time: string; day: string; onRule: (r: Rule | null) => void; onTime: (t: string) => void;
  /** It repeats already, so changes start with the next one. */
  repeating: boolean;
  done?: number;
}) {
  const id = useId();
  const preset = presetOf(rule);
  const pick = (p: Preset) => {
    if (p === preset) return;
    if (p === 'none') onRule(null);
    else if (p === 'day') onRule({ freq: 'day', every: 1, days: [], monthDay: null });
    else if (p === 'weekdays') onRule({ freq: 'week', every: 1, days: WEEKDAYS, monthDay: null });
    else if (p === 'week') onRule({ freq: 'week', every: rule?.freq === 'week' && !rule.per ? rule.every : 1, days: [weekdayOfDay(day)], monthDay: null });
    else if (p === 'per') onRule({ freq: 'week', every: 1, days: [], monthDay: null, per: 3, ...(rule?.times ? { times: rule.times } : {}), ...(rule?.until ? { until: rule.until } : {}) });
    else onRule({ freq: 'month', every: 1, days: [], monthDay: +day.slice(8, 10) });
  };
  const toggleDay = (d: number) => {
    if (!rule) return;
    const days = rule.days.includes(d) ? rule.days.filter(x => x !== d) : [...rule.days, d].sort((a, b) => a - b);
    // A number of times a week can be on any day (none picked); set days need one at least.
    // (A count higher than the days picked is cut to fit when it's saved.)
    if (rule.per) onRule({ ...rule, days: days.length === 7 ? [] : days });
    else if (days.length) onRule({ ...rule, days });
  };
  const everies = rule ? [...new Set([1, 2, 3, 4, 6, 8, 12, rule.every])].filter(n => rule.freq !== 'month' || n <= 12).sort((a, b) => a - b) : [];
  const end = rule ? endOf(rule) : 'never';
  const setEnd = (e: End) => {
    if (!rule || e === end) return;
    const { until: _, times: __, ...base } = rule;
    if (e === 'until') onRule({ ...base, until: shiftDay(day, 8 * 7) });
    else if (e === 'times') onRule({ ...base, times: Math.max(10, done + 1) });
    else onRule(base);
  };
  const chips: { p: Preset; name: string }[] = [
    { p: 'none', name: 'Doesn’t repeat' }, { p: 'day', name: 'Every day' }, { p: 'weekdays', name: 'Weekdays' }, { p: 'week', name: 'Weekly' },
    { p: 'per', name: 'Times a week' }, { p: 'month', name: 'Monthly' },
  ];

  return (
    <div className="ed-f">
      <span className="flabel" id={`${id}-h`}>Repeat</span>
      <div className="chips" role="radiogroup" aria-labelledby={`${id}-h`} onKeyDown={radioKeys}>
        {chips.map(c => <button key={c.p} type="button" className="chipb" {...radio(preset === c.p)} onClick={() => pick(c.p)}>{c.name}</button>)}
      </div>
      {rule?.per && (
        <div className="rep-per">
          <label className="chipb sel rep-at rep-times">
            <input type="number" inputMode="numeric" min={1} max={7} value={rule.per} aria-label="How many times a week"
              onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1) onRule({ ...rule, per: Math.min(n, 7) }); }} />
            <span>times a week</span>
          </label>
          <span className="note">{rule.days.length ? `on any of these days${rule.per > rule.days.length ? `: pick ${rule.per} at least` : ':'}` : 'on any day, or only on some:'}</span>
        </div>
      )}
      {rule?.freq === 'week' && (
        <div className="wdays" role="group" aria-label={rule.per ? 'On any of these days' : 'On these days'}>
          {WEEK.map(d => (
            <button key={d} type="button" className="chipb num" aria-pressed={rule.days.includes(d)} aria-label={DOWL[d]} title={DOWL[d]}
              onClick={() => toggleDay(d)}>{DOW[d].slice(0, 2)}</button>
          ))}
        </div>
      )}
      {rule && (
        <div className="chips">
          {!rule.per && (
            <label className="chipb sel">
              <span className="sr">How often</span>
              <select value={rule.every} onChange={e => onRule({ ...rule, every: Number(e.target.value) })}>
                {everies.map(n => <option key={n} value={n}>{everyName(n, UNIT[rule.freq])}</option>)}
              </select>
            </label>
          )}
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
        <div className="rep-end">
          <span className="flabel sm" id={`${id}-e`}>Ends</span>
          <div className="chips" role="radiogroup" aria-labelledby={`${id}-e`} onKeyDown={radioKeys}>
            <button type="button" className="chipb" {...radio(end === 'never')} onClick={() => setEnd('never')}>Never</button>
            <button type="button" className="chipb" {...radio(end === 'until')} onClick={() => setEnd('until')}>On a date</button>
            <button type="button" className="chipb" {...radio(end === 'times')} onClick={() => setEnd('times')}>After a number of times</button>
          </div>
          {end === 'until' && (
            <label className="chipb sel rep-at">
              <span>Last day</span>
              <input type="date" min={day} value={rule.until ?? ''} aria-label="Last day it repeats" onChange={e => { if (e.target.value) onRule({ ...rule, until: e.target.value }); }} />
            </label>
          )}
          {end === 'times' && (
            <label className="chipb sel rep-at rep-times">
              <input type="number" inputMode="numeric" min={1} max={MAX_TIMES} value={rule.times ?? ''} aria-label="How many times it has to be done"
                onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1) onRule({ ...rule, times: Math.min(MAX_TIMES, n) }); }} />
              <span>times{repeating ? <span className="muted num"> · {done} done so far</span> : null}</span>
            </label>
          )}
        </div>
      )}
      {rule && (
        <p className="note">
          {rule.per
            ? <>{describeRule(rule)}: one at a time {time ? 'goes on the calendar at that time' : 'waits in the backlog, due Sunday'}. Tick it and the next comes the next day, till {rule.per} are done; then nothing till Monday. Each week’s count is kept.</>
            : <>{describeRule(rule)}: each one {time ? 'goes on the calendar at that time' : 'waits in the backlog, due that day'}.</>}
          {rule.times ? ` It ends once ${rule.times} of them are done; missed ones don’t count.` : rule.until ? ' None comes after its last day.' : ''}
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
  const doneBy = repeatsDone(tasks);
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
                  <span className="note">
                    {describeRepeat(r)}{r.rule.per ? ` · ${tallies(r, tasks, now, 1).list[0]?.done ?? 0} of ${r.rule.per} this ${r.rule.freq}` : ''}
                    {r.rule.times ? ` · ${doneBy.get(r.id) ?? 0} of ${r.rule.times} done` : ''}{next && !r.rule.per ? ` · next ${next}` : ''}
                  </span>
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

/**
 * A number-of-times-a-week repeat's log: this week's count against the target, how many days are left, and the weeks
 * before, so it's plain whether it's being done.
 */
export function WeekLog({ repeat }: { repeat: Pick<Repeat, 'id' | 'rule' | 'from'> }) {
  const { tasks, now } = usePlanner();
  if (!repeat.rule.per) return null;
  const { list, left } = tallies(repeat, tasks, now, 6);
  const [cur, ...past] = list;
  if (!cur) return null;
  const need = Math.max(0, cur.per - cur.done);
  const behind = need > left;
  const unit = repeat.rule.freq === 'month' ? 'month' : 'week';
  return (
    <div className="wlog" aria-label={`This ${unit}: ${cur.done} of ${cur.per} done`}>
      <div className="wlog-h">
        <b className="num">{cur.done} of {cur.per}</b><span>this {unit}</span>
        <span className={'wlog-s' + (behind ? ' hot' : need ? '' : ' ok')}>
          {!need ? 'Done for the ' + unit : behind ? `Behind: ${need} to go, ${left} day${left === 1 ? '' : 's'} left` : `${need} to go · ${left} day${left === 1 ? '' : 's'} left`}
        </span>
      </div>
      <div className="wlog-pips" aria-hidden="true">{Array.from({ length: cur.per }, (_, i) => <i key={i} className={i < cur.done ? 'on' : ''} />)}</div>
      {past.length > 0 && (
        <ol className="wlog-past" aria-label={`Earlier ${unit}s`}>
          {past.map(p => (
            <li key={p.start} className={p.done >= p.per ? 'ok' : p.done ? '' : 'none'} title={`${unit === 'week' ? 'Week of' : ''} ${shortDate(fromYmd(p.start).getTime(), now)}: ${p.done} of ${p.per}`}>
              <span className="num">{p.done}/{p.per}</span><span className="muted">{shortDate(fromYmd(p.start).getTime(), now)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
