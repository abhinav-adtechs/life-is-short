'use client';

import { useMemo, useState } from 'react';
import { patchResult, setGoalStatus, type Goal } from '@/lib/goals';
import { patchWait, planOf, type Step } from '@/lib/flow';
import { buildTree, type FlowTree } from '@/lib/flowTree';
import { routeOf, type RouteItem } from '@/lib/route';
import { fmtDur, fmtWhen, shortTitle } from '@/lib/format';
import { usePlanner } from './Planner';
import { CalendarIcon, CheckIcon, ChevronDown, ChevronRight, FlagIcon, HourglassIcon, LockIcon, MapIcon, PlayIcon, RepeatIcon } from './icons';

/*
 * A goal's route, read top to bottom (lib/route.ts): the step to do now, big, with Done and a time for it; what else is
 * ready; what you're waiting on; the route still ahead to the finish; the sub-goals, each opening to its own route; and
 * what's done. It's the drop-down on a goal's card on the main page, and the goal's page on a phone, where the map is a
 * tap away.
 */

/** A goal's chart with its sub-goals' charts in it, kept up to date. */
export function useGoalTree(goal: Goal) {
  const { tasks, now, goals, repeats } = usePlanner();
  return useMemo(() => buildTree(goal, tasks, now, { goals, repeats }), [goal, tasks, now, goals, repeats]);
}

/** How long something's been out of your hands: "Just now", "5h", "3 days". */
export function waited(since: number, now: number) {
  const h = Math.max(0, (now - since) / 3600e3);
  if (h < 1) return 'Just now';
  if (h < 24) return `${Math.floor(h)}h`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
const list = (titles: string[]) => (titles.length <= 2 ? titles.join(' and ') : `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`);

/** A sub-goal's ring: how much of its own chart is done. */
export function Ring({ value, size = 34, stroke = 3.5, label = true }: { value: number; size?: number; stroke?: number; label?: boolean }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <svg className="ru-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ru-ring-t" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ru-ring-v" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {label && <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central">{Math.round(value * 100)}</text>}
    </svg>
  );
}

/** The share of a chart's steps that are done, 0 to 1. */
export const shareOf = (t: FlowTree) => (t.flow.counts.steps ? t.flow.counts.done / t.flow.counts.steps : 0);

/** What you can do to a step from the route: tick it off (or hear back, or reach it), and open it. */
function useActs() {
  const { done, changeGoals, logGoal, toast, openEditor, slot, now } = usePlanner();
  const tick = (s: Step, tree: FlowTree) => {
    const g = tree.goal;
    if (s.kind === 'task' && s.task) { done(s.task.id, true); return; }
    if (s.kind === 'wait' && s.wait) {
      const back = changeGoals(l => l.map(x => (x.id === g.id ? { ...x, plan: patchWait(planOf(x), s.id, { done: !s.done, doneAt: s.done ? null : Date.now() }), updatedAt: Date.now() } : x)));
      logGoal([{ at: Date.now(), goal: g.id, op: s.done ? 'unresolve' : 'resolve', step: s.id, title: s.title }]);
      toast(s.done ? `Waiting on “${shortTitle(s.title, 30)}” again` : `Heard back · ${shortTitle(s.title, 36)}`, back);
      return;
    }
    if (s.kind === 'milestone' && s.result) {
      const back = changeGoals(patchResult(g.id, s.result.id, { done: !s.result.done }));
      logGoal([{ at: Date.now(), goal: g.id, op: s.result.done ? 'untick' : 'tick', step: s.id, title: s.title }]);
      toast(s.result.done ? `Unticked “${shortTitle(s.title, 30)}”` : `Reached · ${shortTitle(s.title, 36)}`, back);
      return;
    }
    if (s.kind === 'goal' && s.goal) {
      const back = changeGoals(setGoalStatus(s.goal.id, s.done ? 'active' : 'achieved'));
      toast(s.done ? `“${shortTitle(s.title, 30)}” is back` : `Achieved · ${shortTitle(s.title, 36)}`, back);
    }
  };
  return { tick, openEditor, slot, now };
}

/** A step's status glyph, as on the map: a ring to tick, a lock, an hourglass or a flag. */
function Glyph({ s, onTick, label }: { s: Step; onTick?: () => void; label: string }) {
  const locked = s.state === 'blocked' && !s.done;
  if (s.kind === 'wait') return <button type="button" className={'ru-g wait' + (s.done ? ' on' : '')} onClick={onTick} aria-label={label} title={s.done ? 'Waiting again' : 'Heard back'}>{s.done ? <CheckIcon size={12} w={2.4} /> : <HourglassIcon size={13} />}</button>;
  if (s.kind === 'milestone') {
    const can = s.done || s.state === 'reached';
    return <button type="button" className={'ru-g flag' + (s.done ? ' on' : s.state === 'reached' ? ' ready' : '')} disabled={!can} onClick={can ? onTick : undefined} aria-label={label}>{s.done ? <CheckIcon size={12} w={2.4} /> : <FlagIcon size={13} />}</button>;
  }
  if (locked) return <span className="ru-g lock" role="img" aria-label="Locked"><LockIcon size={11} /></span>;
  return <button type="button" className={'ru-g' + (s.done ? ' on' : '')} onClick={onTick} aria-label={label}><CheckIcon size={12} w={2.4} /></button>;
}

/** The facts under a step's title. */
function meta(x: RouteItem, now: number, showOn: boolean, when = true) {
  const s = x.step, t = s.task, bits: React.ReactNode[] = [];
  if (showOn && x.on) bits.push(<span key="on" className="ru-on">{shortTitle(x.on.title, 26)}</span>);
  if (s.kind === 'wait') {
    bits.push(<span key="w">{waited(s.wait?.created ?? now, now)}</span>);
    const held = s.unblocks.map(id => x.tree.flow.byId.get(id)?.title).filter(Boolean) as string[];
    if (held.length) bits.push(<span key="h">holds up {list(held.map(h => shortTitle(h, 28)))}</span>);
  } else if (s.kind === 'milestone') {
    const ins = s.needs.map(id => x.tree.flow.byId.get(id)).filter(Boolean) as Step[];
    bits.push(<span key="k">Key result{ins.length ? ` · ${ins.filter(n => n.done).length} of ${ins.length} in` : ''}</span>);
  } else {
    if (s.state === 'blocked' && !s.done) {
      const open = s.needs.map(id => x.tree.flow.byId.get(id)).filter(n => n && !n.done) as Step[];
      bits.push(<span key="a" className="ru-after"><LockIcon size={10} />After {list(open.map(n => shortTitle(n.title, 28)))}</span>);
    }
    if (s.repeat) bits.push(<span key="r" className="ru-rep"><RepeatIcon size={11} />{s.repeat.times ? `${s.repeat.done}/${s.repeat.times}` : s.repeat.rule}</span>);
    if (t?.start != null && !s.done && when) bits.push(<span key="c" className="ru-cal"><CalendarIcon size={11} />{fmtWhen(t.start, now)}</span>);
    if (s.minutes && !s.done) bits.push(<span key="m">{fmtDur(s.repeat ? t?.minutes ?? s.minutes : s.minutes)}</span>);
    if (t?.priority === 1 && !s.done) bits.push(<span key="u" className="ru-urg">Urgent</span>);
  }
  return bits;
}

function Row({ x, showOn, rail }: { x: RouteItem; showOn?: boolean; rail?: boolean }) {
  const { tick, openEditor, now } = useActs();
  const s = x.step;
  return (
    <li className={'ru-i ' + s.kind + ' ' + s.state + (s.done ? ' done' : '') + (rail ? ' rail' : '')}>
      <Glyph s={s} onTick={() => tick(s, x.tree)} label={`${s.done ? 'Not done' : 'Done'}: ${s.title}`} />
      <div className="ru-b">
        {s.task ? <button type="button" className="ru-t" onClick={() => openEditor((s.task as NonNullable<Step['task']>).id)}>{s.title}</button> : <span className="ru-t">{s.title}</span>}
        <span className="ru-m">{meta(x, now, !!showOn)}</span>
      </div>
      {s.kind === 'milestone' && s.state === 'reached' && !s.done && <button type="button" className="btn sec sm" onClick={() => tick(s, x.tree)}>Tick it</button>}
    </li>
  );
}

function Section({ title, n, children, fold, open, onFold }: { title: string; n: number; children: React.ReactNode; fold?: boolean; open?: boolean; onFold?: () => void }) {
  if (!n) return null;
  return (
    <section className="ru-s">
      {fold ? (
        <button type="button" className="ru-sh fold" aria-expanded={open} onClick={onFold}>{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{title}<span className="num">{n}</span></button>
      ) : <h4 className="ru-sh">{title}<span className="num">{n}</span></h4>}
      {(!fold || open) && children}
    </section>
  );
}

/** The step to do now, big: Done, and a time for it. */
function UpNext({ route }: { route: ReturnType<typeof routeOf> }) {
  const { tick, openEditor, slot, now } = useActs();
  const { prefs } = usePlanner();
  const x = route.next;
  if (!x) return null;
  const s = x.step, t = s.task as NonNullable<Step['task']>;
  const section = prefs.labels.find(l => l.id === (x.on ?? x.tree.goal).section);
  return (
    <div className="ru-next" style={tint(section?.color)}>
      <div className="ru-nh"><span className="ru-tag"><PlayIcon />Up next</span>{x.on && <span className="ru-in">in {shortTitle(x.on.title, 36)}</span>}</div>
      <button type="button" className="ru-nt" onClick={() => openEditor(t.id)}>{s.title}</button>
      <div className="ru-m">{meta(x, now, false, false)}</div>
      <div className="ru-acts">
        <button type="button" className="btn pri" onClick={() => tick(s, x.tree)}><CheckIcon size={14} w={2.2} />Done</button>
        {t.start == null
          ? <button type="button" className="btn sec" onClick={() => slot(t.id)}><CalendarIcon size={14} />Next free slot</button>
          : <span className="ru-when"><CalendarIcon size={13} />{fmtWhen(t.start, now)}</span>}
      </div>
      {route.opens.length > 0 && <p className="ru-opens">Then <b>{list(route.opens.map(o => shortTitle(o.title, 40)))}</b> {route.opens.length === 1 ? 'opens' : 'open'} up.</p>}
    </div>
  );
}

/**
 * The route for a goal. `nested` is a sub-goal's, opened under it: no Up next card of its own (the goal's is above),
 * and its own sub-goals in it too.
 */
export function RouteList({ goal, nested, onMap }: { goal: Goal; nested?: boolean; onMap?: (goal: string) => void }) {
  const tree = useGoalTree(goal);
  return <RouteOf tree={tree} nested={nested} onMap={onMap} />;
}

function RouteOf({ tree, nested, onMap }: { tree: FlowTree; nested?: boolean; onMap?: (goal: string) => void }) {
  const route = useMemo(() => routeOf(tree), [tree]);
  const [showDone, setShowDone] = useState(false);
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());
  const { openSheet } = usePlanner();
  const map = onMap ?? ((id: string) => openSheet('flow', id));
  const ready = nested && route.next ? [route.next, ...route.ready] : route.ready;
  const steps = tree.flow.counts.steps;
  return (
    <div className={'ru' + (nested ? ' nested' : '')}>
      {!nested && <UpNext route={route} />}
      {!nested && !route.next && (
        <p className="ru-none">
          {route.waiting.length ? <>Nothing to start right now: you’re waiting on <b>{shortTitle(route.waiting[0].step.title, 40)}</b>.</>
            : steps ? 'Everything open is done. Add the next step on the map.' : 'No steps yet. Add the first one on the map, or say the plan in the chat bar.'}
        </p>
      )}
      <Section title={nested ? 'Ready' : 'Also ready'} n={ready.length}><ul className="ru-l">{ready.map(x => <Row key={x.tree.goal.id + x.step.id} x={x} showOn={!nested} />)}</ul></Section>
      <Section title="Waiting on" n={route.waiting.length}><ul className="ru-l">{route.waiting.map(x => <Row key={x.tree.goal.id + x.step.id} x={x} showOn={!nested} />)}</ul></Section>
      <Section title={nested ? 'Ahead' : 'The route to the finish'} n={route.ahead.length}><ul className="ru-l ru-rail">{route.ahead.map(x => <Row key={x.step.id} x={x} rail />)}</ul></Section>
      <Section title="Sub-goals" n={route.subs.length}>
        <ul className="ru-l">
          {route.subs.map(({ step: s, tree: sub }) => {
            const on = openSubs.has(sub.goal.id);
            const c = sub.flow.counts;
            return (
              <li key={s.id} className={'ru-sub' + (s.done ? ' done' : '') + (on ? ' open' : '')}>
                <div className="ru-subh">
                  <button type="button" className="ru-subt" aria-expanded={on} onClick={() => setOpenSubs(p => { const n = new Set(p); if (n.has(sub.goal.id)) n.delete(sub.goal.id); else n.add(sub.goal.id); return n; })}>
                    <Ring value={s.done ? 1 : shareOf(sub)} />
                    <span className="ru-b">
                      <span className="ru-t">{s.title}</span>
                      <span className="ru-m">{s.done ? <span>Achieved</span> : c.steps ? <><span>{c.done} of {c.steps} done</span>{s.minutes ? <span>{fmtDur(s.minutes)} left</span> : null}</> : <span>No steps yet</span>}
                        {s.state === 'blocked' && !s.done && <span className="ru-after"><LockIcon size={10} />Locked</span>}</span>
                    </span>
                    {on ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <button type="button" className="ib bare" aria-label={`Open the map of ${s.title}`} title="Its map" onClick={() => map(sub.goal.id)}><MapIcon size={14} /></button>
                </div>
                {on && <RouteOf tree={sub} nested onMap={onMap} />}
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Done" n={route.done.length} fold open={showDone} onFold={() => setShowDone(o => !o)}>
        <ul className="ru-l">{route.done.map(x => <Row key={x.step.id} x={x} />)}</ul>
      </Section>
    </div>
  );
}

/** Which goals' cards on the main page have their route open, kept in this browser. */
export const ROUTE_OPEN_KEY = 'ds.route.open';

export function readRouteOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ROUTE_OPEN_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-40) : [];
  } catch { return []; }
}

export function writeRouteOpen(ids: string[]) {
  try { localStorage.setItem(ROUTE_OPEN_KEY, JSON.stringify(ids.slice(-40))); } catch { /* private mode: for this visit only */ }
}

