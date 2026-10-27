'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { PRI } from '@/lib/model';
import type { Label } from '@/lib/labels';
import {
  SPANS, cameDue, daysIn, hourRange, fmtSpan, periodName, periodOf, periodTick, review, shiftPeriod,
  type Bucket, type Item, type Period, type Review as ReviewData, type Span, type Summary,
} from '@/lib/review';
import { dayWord, fmtDur, fmtHour, fmtWhen, shortDate } from '@/lib/format';
import { DOW, MON, ymd } from '@/lib/time';
import { usePlanner } from './Planner';
import { prefersReducedMotion } from './hooks';
import { radio, radioKeys } from './Controls';
import { BackIcon, ChevronLeft, ChevronRight } from './icons';

const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`);
/** Axis ticks: "0", "30m", "2h". */
const short = (m: number) => (!m ? '0' : m < 60 ? `${m}m` : `${+(m / 60).toFixed(1)}h`);
/** A big total, short enough for a tile: "1 h 15 min", or "79.3 h" from ten hours up. */
const total = (m: number) => (m < 600 ? fmtDur(m) : `${+(m / 60).toFixed(1)} h`);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const NONE = 'var(--rv-none)';

/** A clean top for a minutes axis, with three or four ticks. */
function minuteScale(max: number) {
  const step = [15, 30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 5760].find(s => max / s <= 4) ?? Math.ceil(max / 4 / 1440) * 1440;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

/** Everything the planner knows, added up for a day, a week or a month, as a page over the planner. */
export function Review({ span: initial, onClose }: { span: Span; onClose: () => void }) {
  const { tasks, slips, refreshSlips, prefs, labelOf, isOff, hours, now } = usePlanner();
  const page = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<Span>(initial);
  const [anchor, setAnchor] = useState(now);
  const period = periodOf(span, anchor, prefs.weekStart);
  const current = period.start <= now && now < period.end;

  useEffect(() => { page.current?.focus({ preventScroll: true }); refreshSlips(); }, [refreshSlips]);
  useEffect(() => { setSpan(initial); }, [initial]);
  // The span stays in the address, so a reload opens the same one; replaced, so Back still closes the page.
  useEffect(() => { history.replaceState(null, '', `#review/${span}`); }, [span]);

  const labels = useMemo(() => new Map(prefs.labels.map(l => [l.id, l])), [prefs.labels]);
  const data = useMemo(() => review({
    tasks: tasks.filter(t => !isOff(t)), slips, labels: prefs.labels, labelOf: t => labelOf(t)?.id ?? null,
    now, firstDow: prefs.weekStart, hours,
  }, period), [tasks, slips, prefs.labels, prefs.weekStart, labelOf, isOff, now, hours, period.start, period.span]);

  const go = (p: Period) => { setAnchor(Math.min(p.start, now)); page.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); };
  const pick = (s: Span, at = anchor) => { setSpan(s); setAnchor(Math.min(at, now)); };
  const name = periodName(period, now, { firstDow: prefs.weekStart, weekNumbers: prefs.weekNumbers });
  const quiet = !data.done.count && !data.held.count && !cameDue(data.outcomes) && !data.outcomes.pending;

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || (e.target as HTMLElement).closest('[role="radiogroup"],[role="tablist"],input,select,textarea')) return;
    if (e.key === 'ArrowLeft') go(shiftPeriod(period, -1, prefs.weekStart));
    else if (!current) go(shiftPeriod(period, 1, prefs.weekStart));
  };

  const ctx: Ctx = { data, labels, span, now, pickDay: (d: number) => pick('day', d), go };
  return (
    <div ref={page} className="setpage rvpage" role="dialog" aria-modal="true" aria-labelledby="rv-h" tabIndex={-1} onKeyDown={onKey}>
      <header className="sp-top">
        <button type="button" className="ib" aria-label="Back to the planner" onClick={onClose}><BackIcon /></button>
        <h1 id="rv-h">Review</h1>
        <div className="seg" role="radiogroup" aria-label="Review by" onKeyDown={radioKeys}>
          {SPANS.map(s => <button key={s.id} type="button" {...radio(span === s.id)} className={span === s.id ? 'on' : ''} onClick={() => pick(s.id)}>{s.name}</button>)}
        </div>
      </header>
      <div className="rv-body">
        <nav className="rv-nav" aria-label="Period">
          <button type="button" className="ib" aria-label={`Previous ${span}`} onClick={() => go(shiftPeriod(period, -1, prefs.weekStart))}><ChevronLeft /></button>
          <div className="rv-ttl" aria-live="polite"><b>{name.title}</b><span>{name.sub}</span></div>
          <button type="button" className="ib" aria-label={`Next ${span}`} disabled={current} onClick={() => go(shiftPeriod(period, 1, prefs.weekStart))}><ChevronRight /></button>
          {!current && <button type="button" className="txt rv-today" onClick={() => go(periodOf(span, now, prefs.weekStart))}>{span === 'day' ? 'Today' : `This ${span}`}</button>}
        </nav>
        <div className="rv-grid" key={`${span}${period.start}`}>
          <Verdict {...ctx} />
          {!quiet && <>
            <Tiles {...ctx} />
            <Activity {...ctx} />
            <WorkTypes {...ctx} />
            <Outcomes {...ctx} />
            {span !== 'day' && data.done.count > 0 && <Rhythm {...ctx} />}
            <Flow {...ctx} />
            <Load {...ctx} />
          </>}
          <Trend {...ctx} />
          {!quiet && <Lists {...ctx} />}
          <p className="rv-foot wide">
            Time is each task’s length, counted when you tick it off, plus Google events once they’re over. A task is due in its slot
            on the calendar, or on its deadline’s day; it’s on time if it’s done by the end of that day, and missed while it’s still open
            after. A missed slot stays missed when you reslot or delete the task (counted from when this review was added).
          </p>
        </div>
      </div>
    </div>
  );
}

interface Ctx {
  data: ReviewData;
  labels: Map<string, Label>;
  span: Span;
  now: number;
  /** Open the day view on this day. */
  pickDay: (day: number) => void;
  go: (p: Period) => void;
}

function Card({ title, sub, wide, children, tools }: { title: string; sub?: React.ReactNode; wide?: boolean; children: React.ReactNode; tools?: React.ReactNode }) {
  const id = `rv-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section className={'rv-card in' + (wide ? ' wide' : '')} aria-labelledby={id}>
      <div className="rv-ch">
        <div><h2 id={id}>{title}</h2>{sub && <p className="rv-sub">{sub}</p>}</div>
        {tools}
      </div>
      {children}
    </section>
  );
}

const dot = (color: string | null | undefined) => <i className="rv-dot" style={{ '--c': color ?? NONE } as React.CSSProperties} aria-hidden="true" />;

/* ---------- the verdict ---------- */

function Verdict({ data, span }: Ctx) {
  const vs = data.compared.vs;
  const s = data.score;
  return (
    <section className="rv-card rv-verdict wide in" aria-labelledby="rv-verdict">
      <div className="rv-score">
        <h2 id="rv-verdict" className="rv-k">Score</h2>
        <div className="rv-hero">{s ? s.value : '–'}<small>{s ? '/100' : ''}</small></div>
        <div className="rv-grade">{s ? `${s.grade} ${span}` : 'No score yet'}</div>
        {s && data.prev.score && <div className="rv-d">{delta(s.value - data.prev.score.value, true, n => `${n}`)} vs {vs}</div>}
      </div>
      <ul className="rv-says">{data.insights.map(t => <li key={t}>{t}</li>)}</ul>
      {s && (
        <div className="rv-parts">
          {s.parts.map(p => (
            <div key={p.id} className="rv-part" title={`Counts for ${p.weight} of 100`}>
              <div className="rv-pl"><span>{p.name}</span><b>{pct(p.value)}</b></div>
              <div className="rv-meter" aria-hidden="true"><i style={{ width: `${p.value * 100}%` }} /></div>
              <div className="rv-pn">{p.note}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** "↑ 3", with whether that's good: ink when it is, muted when it isn't. */
function delta(d: number, upIsGood: boolean, fmt: (n: number) => string) {
  if (!d) return <span>No change</span>;
  const good = d > 0 === upIsGood;
  return <span className={good ? 'good' : 'bad'}>{d > 0 ? '↑' : '↓'} {fmt(Math.abs(d))}</span>;
}

/* ---------- the numbers ---------- */

function Tiles({ data, span }: Ctx) {
  const p = data.prev, vs = data.compared.vs;
  const tiles: { k: string; v: string; sub?: React.ReactNode }[] = [
    { k: 'Done', v: String(data.done.count), sub: <>{delta(data.done.count - p.done.count, true, String)} vs {vs}</> },
    { k: 'Time on tasks', v: total(data.done.minutes), sub: <>{delta(data.done.minutes - p.done.minutes, true, total)} vs {vs}</> },
  ];
  if (data.held.count || p.held.count) tiles.push({ k: 'In meetings', v: total(data.held.minutes), sub: plural(data.held.count, 'event') });
  const due = cameDue(data.outcomes);
  tiles.push(
    { k: 'Done of due', v: pct(data.completion), sub: due ? `${data.outcomes.onTime + data.outcomes.late} of ${due}` : 'Nothing came due' },
    { k: 'On time', v: pct(data.onTimeRate), sub: data.onTimeRate != null && p.onTimeRate != null ? <>{delta(Math.round((data.onTimeRate - p.onTimeRate) * 100), true, n => `${n} pts`)} vs {vs}</> : undefined },
    { k: 'Missed', v: String(data.outcomes.missed), sub: <>{delta(data.outcomes.missed - p.outcomes.missed, false, String)} vs {vs}</> },
    { k: 'Streak', v: plural(data.streak, 'day'), sub: span === 'day' ? 'in a row' : `Best run here: ${plural(data.bestRun, 'day')}` },
  );
  return (
    <div className="rv-tiles wide in">
      {tiles.map(t => (
        <div key={t.k} className="rv-tile">
          <div className="rv-k">{t.k}</div>
          <div className="rv-v">{t.v}</div>
          {t.sub && <div className="rv-d">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- columns: one chart for the days, the hours and the trend ---------- */

interface Col {
  key: string;
  /** Under the column; '' leaves it blank. */
  tick: string;
  /** Tooltip heading. */
  title: string;
  segs: { name: string; color: string; value: number }[];
  /** Extra tooltip lines. */
  lines?: string[];
  marks?: number;
  aria: string;
  onClick?: () => void;
}

/** Columns from one baseline, stacked when a column has more than one part. `fmt` labels the axis, `show` the tooltip. */
function Columns({ cols, top, ticks, fmt, show = fmtDur, label, height = 168 }: {
  cols: Col[]; top: number; ticks: number[]; fmt: (v: number) => string; show?: (v: number) => string; label: string; height?: number;
}) {
  const n = cols.length;
  const side = (i: number) => (i < n / 4 ? ' l' : i >= (3 * n) / 4 ? ' r' : '');
  return (
    <div className="rv-chart">
      <div className="rv-plot" style={{ height }} role="group" aria-label={label}>
        {ticks.map(t => <div key={t} className={'rv-tick' + (t ? '' : ' zero')} style={{ bottom: `${(t / top) * 100}%` }}><span>{fmt(t)}</span></div>)}
        <div className="rv-cols">
          {cols.map((c, i) => {
            const total = c.segs.reduce((s, x) => s + x.value, 0);
            const h = top ? Math.min(100, (total / top) * 100) : 0;
            return (
              <button key={c.key} type="button" className={'rv-col' + side(i) + (c.onClick ? '' : ' still')} aria-label={c.aria}
                style={{ '--v': `${h}%` } as React.CSSProperties} onClick={c.onClick}>
                <span className="rv-stack" style={{ height: total > 0 ? `max(3px, ${h}%)` : 0 }}>
                  {total > 0 && c.segs.filter(x => x.value > 0).map(x => <i key={x.name} style={{ flexGrow: x.value, '--c': x.color } as React.CSSProperties} />)}
                </span>
                <span className="rv-tip" aria-hidden="true">
                  <b>{c.title}</b>
                  {c.segs.filter(x => x.value > 0).map(x => <span key={x.name}>{dot(x.color)}{x.name}<em>{show(x.value)}</em></span>)}
                  {c.lines?.map(l => <span key={l} className="rv-tl">{l}</span>)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {cols.some(c => c.marks) && (
        <div className="rv-row rv-marks" aria-hidden="true">{cols.map(c => <span key={c.key}>{c.marks ? <i title={`${c.marks} missed`}>{c.marks > 1 ? c.marks : ''}</i> : null}</span>)}</div>
      )}
      <div className="rv-row rv-xs" aria-hidden="true">{cols.map(c => <span key={c.key}>{c.tick}</span>)}</div>
    </div>
  );
}

/** Label segments for a column, in your label order, unlabelled last. */
function segsOf(byLabel: Record<string, number>, labels: Map<string, Label>) {
  return [...labels.values(), null].map(l => ({ name: l?.name ?? 'No label', color: l?.color ?? NONE, value: byLabel[l?.id ?? ''] ?? 0 }));
}

function Legend({ items, missed }: { items: { name: string; color: string }[]; missed?: boolean }) {
  if (items.length < 2 && !missed) return null;
  return (
    <ul className="rv-legend">
      {items.length > 1 && items.map(x => <li key={x.name}>{dot(x.color)}{x.name}</li>)}
      {missed && <li><i className="rv-miss" aria-hidden="true" />Missed</li>}
    </ul>
  );
}

function bucketLines(b: Bucket) {
  return [b.done && plural(b.done, 'task') + ' done', b.held && plural(b.held, 'meeting'), b.missed && `${b.missed} missed`].filter(Boolean) as string[];
}

function Activity({ data, labels, span, pickDay }: Ctx) {
  const { prefs } = usePlanner();
  const [table, setTable] = useState(false);
  let buckets = data.buckets;
  if (span === 'day') {
    // Your day, stretched to fit anything outside it.
    const used = buckets.map((b, h) => (b.minutes || b.missed ? h : -1)).filter(h => h >= 0);
    const from = Math.min(prefs.dayStart, ...used), to = Math.max(prefs.dayEnd - 1, ...used);
    buckets = buckets.slice(from, to + 1);
  }
  const { top, ticks } = minuteScale(Math.max(30, ...buckets.map(b => b.minutes)));
  const tickOf = (b: Bucket, i: number) => {
    const d = new Date(b.start);
    if (span === 'day') return d.getHours() % 3 === 0 ? fmtHour(d.getHours()).replace(':00', '').replace(' ', '').toLowerCase() : '';
    if (span === 'week') return DOW[d.getDay()];
    return d.getDate() === 1 || (d.getDate() % 5 === 0 && d.getDate() < 30) || i === buckets.length - 1 ? String(d.getDate()) : '';
  };
  const title = (b: Bucket) => (span === 'day' ? hourRange(new Date(b.start).getHours()).replace(/^./, c => c.toUpperCase()) : shortDate(b.start));
  const cols: Col[] = buckets.map((b, i) => ({
    key: String(b.start), tick: tickOf(b, i), title: title(b), segs: segsOf(b.byLabel, labels), lines: bucketLines(b), marks: b.missed,
    aria: `${title(b)}: ${fmtDur(b.minutes)}${bucketLines(b).map(l => `, ${l}`).join('')}${span === 'day' ? '' : '. Open this day'}`,
    onClick: span === 'day' ? undefined : () => pickDay(b.start),
  }));
  const used = data.labels.filter(l => l.minutes).map(l => ({ name: l.name, color: l.color ?? NONE }));
  return (
    <Card wide title={span === 'day' ? 'Hour by hour' : 'Day by day'} sub={span === 'day' ? 'Time on tasks and in meetings, by label' : 'Time on tasks and in meetings, by label. Pick a day to see it.'}
      tools={<TableSwitch on={table} set={setTable} />}>
      {table ? (
        <div className="rv-scroll"><table className="rv-table">
          <thead><tr><th scope="col">{span === 'day' ? 'Hour' : 'Day'}</th><th scope="col">Time</th><th scope="col">Done</th><th scope="col">Meetings</th><th scope="col">Missed</th></tr></thead>
          <tbody>{buckets.filter(b => b.minutes || b.missed || b.done).map(b => (
            <tr key={b.start}><th scope="row">{title(b)}</th><td>{fmtDur(b.minutes)}</td><td>{b.done}</td><td>{b.held}</td><td>{b.missed}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <>
        <Columns cols={cols} top={top} ticks={ticks} fmt={short} label={`${span === 'day' ? 'Hour by hour' : 'Day by day'} chart`} />
        <Legend items={used} missed={buckets.some(b => b.missed)} />
      </>}
    </Card>
  );
}

function TableSwitch({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="seg mini" role="radiogroup" aria-label="Show as" onKeyDown={radioKeys}>
      <button type="button" {...radio(!on)} className={on ? '' : 'on'} onClick={() => set(false)}>Chart</button>
      <button type="button" {...radio(on)} className={on ? 'on' : ''} onClick={() => set(true)}>Table</button>
    </div>
  );
}

/* ---------- where the time went ---------- */

function WorkTypes({ data }: Ctx) {
  const rows = data.labels;
  const total = data.done.minutes + data.held.minutes;
  const meetings = rows.some(r => r.held.minutes);
  return (
    <Card title="Type of work" sub={total ? `${fmtDur(total)} in all, by label` : 'No time logged yet'}>
      {total > 0 && (
        <div className="rv-hbar" role="img" aria-label={rows.filter(r => r.minutes).map(r => `${r.name} ${pct(r.share)}`).join(', ')}>
          {rows.filter(r => r.minutes).map(r => <i key={r.id} style={{ flexGrow: r.minutes, '--c': r.color ?? NONE } as React.CSSProperties} title={`${r.name}: ${fmtDur(r.minutes)}`} />)}
        </div>
      )}
      <div className="rv-scroll"><table className="rv-table">
        <thead><tr><th scope="col">Label</th><th scope="col">Time</th><th scope="col">Share</th><th scope="col">Done</th>{meetings && <th scope="col" className="rv-opt">Meetings</th>}<th scope="col">Missed</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}>
            <th scope="row"><span className="rv-lab">{dot(r.color)}{r.name}</span></th>
            <td>{fmtDur(r.minutes)}</td><td>{pct(r.share)}</td><td>{r.done.count}</td>{meetings && <td className="rv-opt">{fmtDur(r.held.minutes)}</td>}<td>{r.outcomes.missed}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

/* ---------- done and missed ---------- */

const OUTCOMES = [
  { id: 'onTime', name: 'On time', cls: 'ot' },
  { id: 'late', name: 'Late', cls: 'la' },
  { id: 'missed', name: 'Missed', cls: 'mi' },
  { id: 'pending', name: 'Still to come', cls: 'pe' },
] as const;

function Outcomes({ data }: Ctx) {
  const o = data.outcomes, all = cameDue(o) + o.pending;
  return (
    <Card title="Done and missed" sub={all ? `${plural(all, 'task')} with a slot or a deadline in this stretch` : 'Nothing had a slot or a deadline here'}>
      {all > 0 && <>
        <div className="rv-hbar out" role="img" aria-label={OUTCOMES.map(x => `${x.name} ${o[x.id]}`).join(', ')}>
          {OUTCOMES.filter(x => o[x.id]).map(x => <i key={x.id} className={x.cls} style={{ flexGrow: o[x.id] }} />)}
        </div>
        <ul className="rv-legend">{OUTCOMES.map(x => <li key={x.id}><i className={'rv-sw ' + x.cls} aria-hidden="true" />{x.name}<b>{o[x.id]}</b></li>)}</ul>
      </>}
      <div className="rv-scroll"><table className="rv-table">
        <thead><tr><th scope="col">Priority</th><th scope="col">Done</th><th scope="col" className="rv-opt">Time</th><th scope="col">Came due</th><th scope="col">On time</th><th scope="col">Missed</th></tr></thead>
        <tbody>{data.priorities.map(p => (
          <tr key={p.priority}>
            <th scope="row">{p.name}</th><td>{p.done.count}</td><td className="rv-opt">{fmtDur(p.done.minutes)}</td><td>{cameDue(p.outcomes)}</td>
            <td>{cameDue(p.outcomes) ? pct(p.outcomes.onTime / cameDue(p.outcomes)) : '–'}</td><td>{p.outcomes.missed}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

/* ---------- when ---------- */

function Rhythm({ data, span }: Ctx) {
  const { prefs } = usePlanner();
  const used = data.hours.map((v, h) => (v ? h : -1)).filter(h => h >= 0);
  const from = Math.min(prefs.dayStart, ...used), to = Math.max(prefs.dayEnd - 1, ...used);
  const hrs = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const peak = data.peakHour;
  const color = (on: boolean) => (on ? 'var(--accent)' : 'var(--rv-quiet)');
  const { top, ticks } = minuteScale(Math.max(30, ...data.hours));
  const cols: Col[] = hrs.map(h => {
    const t = hourRange(h).replace(/^./, c => c.toUpperCase());
    return { key: String(h), tick: h % 3 === 0 ? fmtHour(h).replace(':00', '').replace(' ', '').toLowerCase() : '', title: t,
      segs: [{ name: 'Tasks', color: color(h === peak), value: data.hours[h] }], aria: `${t}: ${fmtDur(data.hours[h])}` };
  });
  const order = Array.from({ length: 7 }, (_, i) => (prefs.weekStart + i) % 7);
  const wk = minuteScale(Math.max(30, ...data.weekdays));
  const best = data.weekdays.indexOf(Math.max(...data.weekdays));
  const days: Col[] = order.map(d => ({ key: String(d), tick: DOW[d], title: DOW[d], segs: [{ name: 'Tasks', color: color(d === best), value: data.weekdays[d] }], aria: `${DOW[d]}: ${fmtDur(data.weekdays[d])}` }));
  return (
    <Card wide title="When you get things done" sub={peak != null ? `Task time by hour, most from ${hourRange(peak)}` : 'Task time by hour'}>
      <div className={span === 'month' ? 'rv-two' : undefined}>
        <div>
          {span === 'month' && <h3 className="rv-h3">By hour of the day</h3>}
          <Columns cols={cols} top={top} ticks={ticks} fmt={short} label="Task time by hour of the day" height={120} />
        </div>
        {span === 'month' && (
          <div>
            <h3 className="rv-h3">By day of the week</h3>
            <Columns cols={days} top={wk.top} ticks={wk.ticks} fmt={short} label="Task time by day of the week" height={120} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- flow and load ---------- */

function Flow({ data, now }: Ctx) {
  const net = data.created - data.done.count, b = data.backlog;
  const stats: [string, string, string?][] = [
    ['Added', String(data.created), 'tasks you captured'],
    ['Finished', String(data.done.count)],
    ['Your list', net > 0 ? `+${net}` : net < 0 ? `−${-net}` : '±0', net > 0 ? 'grew' : net < 0 ? 'shrank' : 'held steady'],
    ['Capture to done', data.leadTime != null ? fmtSpan(data.leadTime) : '–', 'typical'],
  ];
  return (
    <Card title="Flow" sub="What came in and what went out">
      <dl className="rv-stats">{stats.map(([k, v, n]) => <div key={k}><dt>{k}</dt><dd>{v}{n && <small>{n}</small>}</dd></div>)}</dl>
      <h3 className="rv-h3">Right now</h3>
      <dl className="rv-stats">
        <div><dt>In the backlog</dt><dd>{b.open}<small>{fmtDur(b.minutes)}</small></dd></div>
        <div><dt>Overdue</dt><dd>{b.overdue}</dd></div>
        <div><dt>Waiting under Missed</dt><dd>{b.missed}</dd></div>
        <div><dt>Oldest open task</dt><dd>{b.oldest != null ? fmtSpan(now - b.oldest) : '–'}<small>{b.oldest != null ? 'old' : ''}</small></dd></div>
      </dl>
    </Card>
  );
}

function Load({ data }: Ctx) {
  const { prefs } = usePlanner();
  const { planned, capacity } = data.load;
  const used = capacity ? planned / capacity : 0;
  const s = data.sizes, most = Math.max(1, s.quick.count, s.medium.count, s.deep.count);
  const sizes = [['Quick', 'up to 30 min', s.quick], ['Medium', '45 min to 1.5 h', s.medium], ['Deep', '2 h and more', s.deep]] as const;
  const src = data.sources;
  return (
    <Card title="Plan and effort" sub={`Your day runs ${fmtHour(prefs.dayStart)} to ${fmtHour(prefs.dayEnd)}`}>
      <div className="rv-pl"><span>On the calendar</span><b>{fmtDur(planned)} of {fmtDur(capacity)}</b></div>
      <div className={'rv-meter' + (used > 1 ? ' over' : '')} role="img" aria-label={`${pct(used)} of your working hours planned`}><i style={{ width: `${Math.min(1, used) * 100}%` }} /></div>
      <div className="rv-pn">{used > 1 ? `${pct(used)}: more than your days hold` : `${pct(used)} of your working hours`}</div>
      <h3 className="rv-h3">Tasks done, by size</h3>
      <div className="rv-sizes">
        {sizes.map(([n, note, t]) => (
          <div key={n} className="rv-size">
            <span>{n}<small>{note}</small></span>
            <span className="rv-meter thin" aria-hidden="true"><i style={{ width: `${(t.count / most) * 100}%` }} /></span>
            <b>{t.count}</b>
          </div>
        ))}
      </div>
      {(src.gtask.count > 0 || src.gcal.count > 0) && <>
        <h3 className="rv-h3">Where it came from</h3>
        <dl className="rv-stats">
          <div><dt>Your tasks</dt><dd>{src.own.count}<small>{fmtDur(src.own.minutes)}</small></dd></div>
          {src.gtask.count > 0 && <div><dt>Google Tasks</dt><dd>{src.gtask.count}<small>{fmtDur(src.gtask.minutes)}</small></dd></div>}
          {src.gcal.count > 0 && <div><dt>Google Calendar</dt><dd>{src.gcal.count}<small>{fmtDur(src.gcal.minutes)}</small></dd></div>}
        </dl>
      </>}
    </Card>
  );
}

/* ---------- the trend ---------- */

function Trend({ data, span, go }: Ctx) {
  const list = data.trend;
  const last = list.length - 1;
  const color = (i: number) => (i === last ? 'var(--accent)' : 'var(--rv-quiet)');
  const time = (x: Summary) => x.done.minutes + x.held.minutes;
  const sc = minuteScale(Math.max(60, ...list.map(time)));
  const name = (x: Summary) => (span === 'day' ? shortDate(x.period.start) : span === 'week' ? `Week of ${periodTick(x.period)}` : periodTick(x.period));
  const timeCols: Col[] = list.map((x, i) => ({
    key: String(x.period.start), tick: tick(x.period, i, last), title: name(x), segs: [{ name: 'Time', color: color(i), value: time(x) }],
    lines: [plural(x.done.count, 'task') + ' done'], aria: `${name(x)}: ${fmtDur(time(x))}`, onClick: () => go(x.period),
  }));
  const rateCols: Col[] = list.map((x, i) => ({
    key: String(x.period.start), tick: tick(x.period, i, last), title: name(x),
    segs: [{ name: 'Done of due', color: color(i), value: x.completion ?? 0 }],
    lines: x.completion == null ? ['Nothing came due'] : [`${x.outcomes.onTime + x.outcomes.late} of ${cameDue(x.outcomes)}`],
    aria: `${name(x)}: ${x.completion == null ? 'nothing came due' : pct(x.completion) + ' done of what came due'}`, onClick: () => go(x.period),
  }));
  const span_ = span === 'day' ? `${list.length} days` : span === 'week' ? `${list.length} weeks` : `${list.length} months`;
  return (
    <Card wide title="Trend" sub={`The last ${span_}, this one in colour. Pick one to open it.`}>
      <div className="rv-two">
        <div><h3 className="rv-h3">Time</h3><Columns cols={timeCols} top={sc.top} ticks={sc.ticks} fmt={short} label="Time by period" height={120} /></div>
        <div><h3 className="rv-h3">Done of what came due</h3><Columns cols={rateCols} top={1} ticks={[0, 0.5, 1]} fmt={pct} show={pct} label="Done of what came due, by period" height={120} /></div>
      </div>
    </Card>
  );
}

function tick(p: Period, i: number, last: number) {
  const d = new Date(p.start);
  if (p.span === 'day') return i === last || i % 2 === last % 2 ? `${DOW[d.getDay()].slice(0, 2)} ${d.getDate()}` : '';
  if (p.span === 'week') return `${d.getDate()} ${MON[d.getMonth()]}`;
  return MON[d.getMonth()];
}

/* ---------- the tasks behind the numbers ---------- */

type Tab = 'missed' | 'late' | 'done' | 'pending';
const TABS: { id: Tab; name: string }[] = [{ id: 'missed', name: 'Missed' }, { id: 'late', name: 'Late' }, { id: 'done', name: 'Done' }, { id: 'pending', name: 'Still to come' }];
const SHOW = 40;

function Lists({ data, span, now }: Ctx) {
  const [tab, setTab] = useState<Tab>(data.lists.missed.length ? 'missed' : 'done');
  const [all, setAll] = useState(false);
  const list = data.lists[tab];
  const shown = all ? list : list.slice(0, SHOW);
  // Done, over more than a day, by day.
  const groups = tab === 'done' && span !== 'day'
    ? daysIn(data.period).map(d => ({ key: ymd(d), name: dayWord(d, now), items: shown.filter(i => ymd(i.at) === ymd(d)) })).filter(g => g.items.length)
    : [{ key: '', name: '', items: shown }];
  return (
    <Card wide title="The tasks behind it" tools={
      <div className="seg mini rv-tabs" role="tablist" aria-label="Which tasks">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" id={`rv-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="rv-panel" className={tab === t.id ? 'on' : ''}
            onClick={() => { setTab(t.id); setAll(false); }}>{t.name} {data.lists[t.id].length}</button>
        ))}
      </div>
    }>
      <div id="rv-panel" role="tabpanel" aria-labelledby={`rv-tab-${tab}`}>
        {!list.length && <p className="empty">{tab === 'missed' ? 'Nothing missed.' : tab === 'late' ? 'Nothing finished late.' : tab === 'done' ? 'Nothing ticked off.' : 'Nothing still to come.'}</p>}
        {groups.map(g => (
          <Fragment key={g.key}>
            {g.name && <div className="gs">{g.name}</div>}
            {g.items.map(it => <ItemRow key={`${it.id}@${it.at}`} it={it} kind={tab} />)}
          </Fragment>
        ))}
        {list.length > shown.length && <button type="button" className="txt rv-more" onClick={() => setAll(true)}>Show all {list.length}</button>}
      </div>
    </Card>
  );
}

function ItemRow({ it, kind }: { it: Item; kind: Tab }) {
  const { store, openEditor, slot, now, prefs } = usePlanner();
  const live = store.get(it.id);
  const label = prefs.labels.find(l => l.id === it.label) ?? null;
  const when = it.slot ? fmtWhen(it.at, now) : `${dayWord(it.at, now)} (deadline)`;
  let meta: React.ReactNode;
  let act: React.ReactNode = null;
  if (kind === 'done') meta = <>Done {fmtWhen(it.at, now)}</>;
  else if (kind === 'late') meta = <>Due {when} · done {it.doneAt ? fmtWhen(it.doneAt, now) : ''}</>;
  else if (kind === 'pending') meta = when;
  else {
    const since = !live ? 'deleted' : live.status === 'done' ? `done ${live.doneAt ? fmtWhen(live.doneAt, now) : ''}` : live.start != null ? `moved to ${fmtWhen(live.start, now)}` : 'moved to the backlog';
    meta = <>{when} · {it.how === 'open' ? 'still waiting' : it.how === 'dropped' ? 'deleted' : since}</>;
    if (it.how === 'open' && live?.status === 'open') act = <button type="button" className="txt reslot" aria-label={`Reslot: ${it.title}`} onClick={() => slot(it.id)}>Reslot</button>;
  }
  return (
    <div className={'rv-item' + (label ? ' lab' : '')} style={label ? ({ '--c': label.color } as React.CSSProperties) : undefined}>
      {dot(label?.color)}
      <div className="rv-it">
        {live ? <button type="button" className="rv-open" onClick={() => openEditor(it.id)}>{live.title}</button> : <span>{it.title}</span>}
        <div className="rv-im">{label && <>{label.name} · </>}{it.priority === 1 && <><span className="hot">{PRI[1]}</span> · </>}{fmtDur(it.minutes)} · {meta}</div>
      </div>
      {act}
    </div>
  );
}
