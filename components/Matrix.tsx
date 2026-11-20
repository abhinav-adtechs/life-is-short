'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import type { Rule } from '@/lib/repeat';
import { newId, PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtWhen, shortDate, shortTitle } from '@/lib/format';
import { describeRepeat, describeRule, occurrenceOf, repeatsDone, tallies } from '@/lib/repeat';
import { archivedGoals, flatResults, resultDone, rootOf, type Goal } from '@/lib/goals';
import { holdups } from '@/lib/flow';
import { isEvent } from '@/lib/select';
import { fromYmd } from '@/lib/time';
import { usePlanner, useLists } from './Planner';
import { daysLeft, fmtHrs, useGoalWeek } from './Goals';
import { useGoalFlow } from './Flow';
import { ArchiveIcon, CalendarIcon, CheckIcon, ChevronDown, ChevronUp, MapIcon, PlusIcon, RepeatIcon, RouteIcon, TargetIcon, XIcon } from './icons';
import { RouteList, readRouteOpen, writeRouteOpen } from './Route';

/*
 * The main page's backlog: a card per goal, most important first, each with how far along it is, its deadline, its
 * time this week and the tasks that move it, in the order to do them. Off-goal work gets the last card. Priority is a
 * pill on each task (click it to change it) and a row of chips that shows one priority at a time.
 */

const PRIS: Priority[] = [1, 2, 3];
const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/** Rows fade up in a stagger on first load; rows that arrive later rise in on their own. */
function useStagger(step: number, cap: number) {
  const t0 = useRef(performance.now());
  return (i: number) => (performance.now() - t0.current < 1500 ? `${Math.min(i, cap) * step}ms` : '0ms');
}

/**
 * Each card's tasks: every open one (on the calendar or not) whose active goal's top goal it is ('' for off-goal), and
 * how many are done. A done task counts for its top goal even after the sub-goal it was on is achieved.
 */
function useByCard() {
  const { tasks, isOff, rootGoalOf, goals, repeats } = usePlanner();
  return useMemo(() => {
    const index = new Map(goals.map(g => [g.id, g]));
    const m = new Map<string, { open: Task[]; done: number; later: number }>();
    const at = (k: string) => { let e = m.get(k); if (!e) m.set(k, e = { open: [], done: 0, later: 0 }); return e; };
    for (const t of tasks) {
      if (isOff(t) || isEvent(t)) continue;
      if (t.status === 'open') at(rootGoalOf(t)?.id ?? '').open.push(t);
      else if (t.status === 'done') {
        const g = t.goal ? index.get(t.goal) : undefined, top = g ? rootOf(index, g) : null;
        at(top && top.status === 'active' ? top.id : '').done++;
      }
    }
    // A repeat that has to be done so many times: the ones not made yet are still to go.
    const doneBy = repeatsDone(tasks);
    const openBy = new Map<string, number>();
    for (const t of tasks) { const o = t.status === 'open' ? occurrenceOf(t.id) : null; if (o) openBy.set(o.repeat, (openBy.get(o.repeat) ?? 0) + 1); }
    for (const r of repeats) {
      if (!r.rule.times || !r.goal) continue;
      const g = index.get(r.goal), top = g && g.status === 'active' ? rootOf(index, g) : null;
      if (!top || top.status !== 'active') continue;
      at(top.id).later += Math.max(0, r.rule.times - (doneBy.get(r.id) ?? 0) - (openBy.get(r.id) ?? 0));
    }
    return m;
  }, [tasks, isOff, rootGoalOf, goals, repeats]);
}

/** How many of each repeat's tasks are done. */
function useRepeatDone() {
  const { tasks } = usePlanner();
  return useMemo(() => repeatsDone(tasks), [tasks]);
}

/** For each number-of-times-a-week repeat: this week's count, the target, and whether it's falling behind. */
export function useRepeatWeek() {
  const { tasks, repeats, now } = usePlanner();
  return useMemo(() => new Map(repeats.filter(r => r.rule.per).map(r => {
    const { list, left } = tallies(r, tasks, now, 1);
    const done = list[0]?.done ?? 0, per = r.rule.per as number;
    return [r.id, { done, per, behind: per - done > left, unit: r.rule.freq === 'month' ? 'mo' : 'wk' }];
  })), [tasks, repeats, now]);
}

/** A repeating task's mark: the icon, and this week's count or the count so far. */
function RepeatMark({ repeatId, rule, title }: { repeatId: string; rule: Rule; title: string }) {
  const done = useRepeatDone(), week = useRepeatWeek().get(repeatId);
  const label = week ? `${week.done} of ${week.per} this ${week.unit === 'wk' ? 'week' : 'month'}` : rule.times ? `${done.get(repeatId) ?? 0} of ${rule.times} done` : '';
  return (
    <span className={'rep-g' + (week?.behind ? ' hot' : '')} title={`${title}${label ? ` · ${label}` : ''}`}>
      <RepeatIcon size={11} />
      {week ? <span className="num">{week.done}/{week.per} {week.unit}</span> : rule.times ? <span className="num">{done.get(repeatId) ?? 0}/{rule.times}</span> : null}
      <span className="sr">, {title}{label ? `, ${label}` : ''}</span>
    </span>
  );
}

/** Every open task the cards show, on the calendar or not. */
export const useOpenCount = () => [...useByCard().values()].reduce((n, e) => n + e.open.length, 0);

/**
 * The order to do a goal's tasks in: what can start now before what's blocked; then urgent first, then the nearest
 * deadline, then the soonest on the calendar, then the oldest.
 */
const doOrder = (blocked: Set<string>) => (a: Task, b: Task) =>
  Number(blocked.has(a.id)) - Number(blocked.has(b.id)) || a.priority - b.priority
  || (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.start ?? Infinity) - (b.start ?? Infinity) || (a.created || 0) - (b.created || 0);

/* ---------- one task ---------- */

type Kind = 'open' | 'done' | 'new';

/** The ring you tick a task off with. Done tasks untick. */
function Ring({ t, kind, size = 10 }: { t: Task; kind: Kind; size?: number }) {
  const { done, completing, lists: { focus } } = usePlanner();
  const on = kind === 'done' || completing.has(t.id);
  if (kind === 'new') return <span className="ck" aria-hidden="true"><span className="ring ghost" /></span>;
  return (
    <button type="button" className={'ck' + (on ? ' on' : '')} aria-label={`${kind === 'done' ? 'Mark not done' : 'Mark done'}: ${t.title}`}
      onClick={e => { e.stopPropagation(); if (!completing.has(t.id)) done(t.id, kind !== 'done'); }}>
      <span className={'ring' + (focus.now?.id === t.id && kind === 'open' ? ' now' : '')}><CheckIcon size={size} w={2.6} /></span>
    </button>
  );
}

/** What a row says about itself: Now, a tick-off or a new task in the plan you're reviewing. */
function useTag(t: Task, kind: Kind) {
  const { plan, blocked } = usePlanner();
  const { focus } = useLists();
  if (kind === 'new') return { text: 'New', cls: 'tag' };
  if (plan.ticks.has(t.id)) return { text: 'Tick off', cls: 'tag' };
  if (kind === 'open' && focus.now?.id === t.id) return { text: 'Now', cls: 'tag now' };
  // Held up by a step before it on its goal's map.
  if (kind === 'open' && blocked.has(t.id)) return { text: 'Blocked', cls: 'tag blocked' };
  return null;
}

/** A task's priority, as a pill: click it for the next one (Urgent, Important, Later, round again). */
function PriPill({ t, kind }: { t: Task; kind: Kind }) {
  const { store, undoable } = usePlanner();
  const next = ((t.priority % 3) + 1) as Priority;
  if (kind !== 'open') return <span className={`ppill p${t.priority} still`}>{PRI[t.priority]}</span>;
  return (
    <button type="button" className={`ppill p${t.priority}`} title={`${PRI[t.priority]}. Click to make it ${PRI[next].toLowerCase()}.`}
      aria-label={`${PRI[t.priority]}: make “${t.title}” ${PRI[next].toLowerCase()}`}
      onClick={e => { e.stopPropagation(); undoable(`${shortTitle(t.title, 30)} · ${PRI[next]}`, store.patch(t.id, { priority: next })); }}>
      {PRI[t.priority]}
    </button>
  );
}

/**
 * A backlog row on a laptop: tick it, click then click a time, drag it to the calendar or another goal, double-click to
 * edit. In a goal's card (`card` is its id, '' for off-goal) it says which sub-goal it's on, if any, and has its
 * priority pill.
 */
function TaskRow({ t, kind, delay, card }: { t: Task; kind: Kind; delay: string; card?: string }) {
  const { completing, picked, setPicked, openEditor, drag, labelOf, now, plan, repeatOf, goalOf, activeGoals } = usePlanner();
  const tag = useTag(t, kind);
  const label = labelOf(t);
  const goal = goalOf(t);
  const inCard = card != null;
  // Outside a card, the goal it moves; in one, the sub-goal it's on.
  const goalTag = inCard ? (goal && goal.id !== card ? `› ${shortTitle(goal.title, 26)}` : null)
    : !activeGoals.length || kind === 'done' ? null : goal ? goal.title : 'Off-goal';
  const repeat = repeatOf(t);
  const due = t.due && kind === 'open' ? dueLabel(t.due, now) : null;
  const ticking = plan.ticks.has(t.id);
  const lifting = drag.view?.id === t.id && drag.view.kind === 'row';
  const sched = kind === 'open' && t.start != null;
  const cls = 'row' + (kind === 'done' || completing.has(t.id) ? ' done' : '') + (picked === t.id ? ' picked' : '')
    + (ticking || kind === 'new' ? ' ghosted' : '') + (lifting ? ' lifting' : '') + (kind === 'new' ? ' new' : '') + (sched ? ' sched' : '');
  const live = kind === 'open';
  return (
    <div className={cls} style={{ animationDelay: delay }}>
      <Ring t={t} kind={kind} />
      <button type="button" className="row-main" disabled={kind === 'new'} aria-pressed={live ? picked === t.id : undefined}
        title={kind === 'new' ? 'Proposed in chat. Apply it to add it.' : live ? 'Click, then click a time on the calendar. Or drag it onto the calendar or another goal. Double-click to edit.' : 'Edit'}
        onPointerDown={live ? e => drag.begin(e, 'row', t.id) : undefined}
        onClick={() => {
          if (drag.ignoreClick()) return;
          if (live) setPicked(picked === t.id ? null : t.id); else openEditor(t.id);
        }}
        onDoubleClick={() => { if (kind !== 'new') openEditor(t.id); }}
        onKeyDown={e => { if ((e.key === 'e' || e.key === 'E') && kind !== 'new') { e.preventDefault(); openEditor(t.id); } }}>
        <span className="rt"><span className="strike">{t.title}</span></span>
        {repeat && <RepeatMark repeatId={repeat.id} rule={repeat.rule} title={describeRepeat(repeat)} />}
        {tag && <span className={tag.cls}>{tag.text}</span>}
        {kind === 'done' && t.doneAt != null && <span className="due">{fmtWhen(t.doneAt, now)}</span>}
        {sched && <span className="when-cal" title="On the calendar"><CalendarIcon size={11} />{fmtWhen(t.start as number, now)}</span>}
        {due && <span className={'due' + (due.hot ? ' hot' : '')}>{due.text}</span>}
        {goalTag && <span className={'gtag' + (goal || inCard ? '' : ' off')} title={goal ? `Moves: ${goal.title}` : 'Not on a goal'}>{goalTag}</span>}
        {(!inCard || card === '') && <span className={'dot' + (label ? '' : ' none')} style={tint(label?.color)} title={label?.name ?? 'No section'} />}
        <span className="len num">{fmtDur(t.minutes)}</span>
      </button>
      {inCard && <PriPill t={t} kind={kind} />}
    </div>
  );
}

/** A backlog row on a phone: a big ring, the title in full, and a line of facts. Tap to open it; press and hold to drag it to Done or the trash. */
function PhoneRow({ t, kind, delay, card }: { t: Task; kind: Kind; delay: string; card?: string }) {
  const { completing, openEditor, labelOf, now, drag, repeatOf, goalOf, activeGoals } = usePlanner();
  const tag = useTag(t, kind);
  const repDone = useRepeatDone();
  const week = useRepeatWeek().get(repeatOf(t)?.id ?? '');
  const label = labelOf(t);
  const repeat = repeatOf(t);
  const goal = goalOf(t);
  const due = t.due && kind === 'open' ? dueLabel(t.due, now) : null;
  const inCard = card != null;
  const where = inCard ? (goal && goal.id !== card ? `› ${shortTitle(goal.title, 24)}` : null)
    : goal ? shortTitle(goal.title, 28) : activeGoals.length ? 'Off-goal' : label?.name ?? null;
  const sched = kind === 'open' && t.start != null;
  const facts = [
    kind === 'new' ? 'New' : null,
    kind === 'done' && t.doneAt != null ? `Done ${fmtWhen(t.doneAt, now)}` : null,
    sched ? fmtWhen(t.start as number, now) : null,
    due?.text ?? null, where, fmtDur(t.minutes),
    repeat ? `↻ ${describeRule(repeat.rule)}${week ? ` (${week.done} of ${week.per} this ${week.unit === 'wk' ? 'week' : 'month'})` : repeat.rule.times ? ` (${repDone.get(repeat.id) ?? 0} done)` : ''}` : null,
  ].filter(Boolean).join(' · ');
  const lifting = drag.view?.id === t.id && drag.view.kind === 'row';
  const cls = 'prow' + (kind === 'done' || completing.has(t.id) ? ' done' : '') + (tag?.text === 'Tick off' || kind === 'new' ? ' ghosted' : '') + (lifting ? ' lifting' : '') + (sched ? ' sched' : '');
  return (
    <div className={cls} style={{ animationDelay: delay }}>
      <Ring t={t} kind={kind} size={12} />
      <button type="button" className="prow-main" disabled={kind === 'new'}
        onPointerDown={kind === 'open' ? e => drag.begin(e, 'row', t.id) : undefined}
        onClick={() => { if (!drag.ignoreClick()) openEditor(t.id); }}>
        <span className="prow-t"><span className="rt"><span className="strike">{t.title}</span></span>{tag && <span className={tag.cls}>{tag.text}</span>}</span>
        <span className="prow-m">{sched && <CalendarIcon size={11} />}{(!inCard || card === '') && <span className={'dot' + (label ? '' : ' none')} style={tint(label?.color)} />}<span className={due?.hot ? 'hot' : undefined}>{facts}</span></span>
      </button>
      {inCard && <PriPill t={t} kind={kind} />}
    </div>
  );
}

type Row = typeof TaskRow;

/* ---------- done, folded away ---------- */

function GroupHead({ name, count, open, onToggle }: { name: string; count: number; open?: boolean; onToggle?: () => void }) {
  return (
    <div className="gh">
      {onToggle ? (
        <button type="button" className="gh-t" aria-expanded={open} onClick={onToggle}>
          {name}<span className="gh-n num">{count}</span><ChevronDown />
        </button>
      ) : <span className="gh-t">{name}<span className="gh-n num">{count}</span></span>}
    </div>
  );
}

/** What's done, folded to a line. */
function Done({ Item, stagger }: { Item: Row; stagger: (i: number) => string }) {
  const { done } = useLists();
  const [open, setOpen] = useState(false);
  if (!done.length) return null;
  return (
    <div className="gc-done">
      <GroupHead name="Done" count={done.length} open={open} onToggle={() => setOpen(o => !o)} />
      {open && done.map((t, i) => <Item key={t.id} t={t} kind="done" delay={stagger(i)} />)}
    </div>
  );
}

/* ---------- the priority chips ---------- */

/**
 * All, Urgent, Important, Later: shows one priority across every goal. On a laptop, drop a task on one to give it that
 * priority.
 */
function PriChips({ pri, setPri, phone }: { pri: Priority | null; setPri: (p: Priority | null) => void; phone?: boolean }) {
  const { drag } = usePlanner();
  const open = [...useByCard().values()].flatMap(e => e.open);
  const over = drag.view && drag.view.kind !== 'resize' ? drag.view.cell : null;
  return (
    <div className={'pchips' + (phone ? ' ph' : '')} role="group" aria-label="Show tasks by priority">
      <button type="button" className="pchip" aria-pressed={pri == null} onClick={() => setPri(null)}>All <span className="num">{open.length}</span></button>
      {PRIS.map(p => {
        const n = open.filter(t => t.priority === p).length;
        return (
          <button key={p} type="button" className={`pchip p${p}` + (over === `*|${p}` ? ' over' : '')} aria-pressed={pri === p} data-cell={phone ? undefined : `*|${p}`}
            title={phone ? undefined : `Only ${PRI[p].toLowerCase()} tasks. Drop a task here to make it ${PRI[p].toLowerCase()}.`}
            onClick={() => setPri(pri === p ? null : p)}>
            <i aria-hidden="true" />{PRI[p]} <span className="num">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- a goal's card ---------- */

/** A line to type a new task into, in place: Enter adds it and stays for the next; Esc, or leaving it empty, stops. */
function QuickAdd({ goal, priority, onDone }: { goal: Goal | null; priority: Priority; onDone: () => void }) {
  const { store, undoable, rootGoalOf } = usePlanner();
  const [text, setText] = useState('');
  const stop = useRef(false);
  const add = () => {
    const title = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!title || stop.current) return;
    const at = Date.now();
    const t: Task = {
      id: newId(), title, raw: title, notes: '', priority, minutes: 30, start: null, due: null, status: 'open',
      created: at, order: at, doneAt: null, goal: goal?.id ?? null, label: null, updatedAt: at,
    };
    // A task on a goal is in its top goal's section.
    const root = goal ? rootGoalOf({ ...t, goal: goal.id }) : null;
    if (root?.section) t.label = root.section;
    undoable(`Added to ${goal ? shortTitle(goal.title, 30) : 'off-goal'} · ${PRI[priority]}`, store.write([t]));
    setText('');
  };
  return (
    <div className="gc-add">
      <span className="ck" aria-hidden="true"><span className="ring ghost" /></span>
      <input type="text" value={text} autoFocus maxLength={160} enterKeyHint="done" aria-label={goal ? `A task for ${goal.title}` : 'An off-goal task'}
        placeholder={goal ? `A task for this goal · ${PRI[priority]}` : `An off-goal task · ${PRI[priority]}`}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) add(); else onDone(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop.current = true; onDone(); }
        }}
        onBlur={() => { add(); onDone(); }} />
    </div>
  );
}

/** How many tasks a card shows before "more". */
const SHOWN = { wide: 5, phone: 5 };

/**
 * One goal (or, with no goal, off-goal work): rank and title; how much of its work is done, big; its deadline, key
 * results and time this week; what's holding it up; and its tasks in the order to do them, five and then the rest.
 * Drop a task on it to put the task on this goal.
 */
function GoalCard({ g, rank, items, open, done, pri, phone, focused, Item }: {
  g: Goal | null; rank: number; items: { t: Task; kind: Kind }[]; open: number; done: number; pri: Priority | null; phone?: boolean; focused?: boolean; Item: Row;
}) {
  const { prefs, now, openSheet, setFilter, drag, closeGoal } = usePlanner();
  const { rolled } = useGoalWeek();
  const flow = useGoalFlow(g ?? OFF);
  const [more, setMore] = useState(false);
  const [adding, setAdding] = useState(false);
  // Its route, dropped down in place of the list; remembered in this browser.
  const [route, setRoute] = useState(false);
  useEffect(() => { if (g) setRoute(readRouteOpen().includes(g.id)); }, [g]);
  const toggleRoute = () => {
    if (!g) return;
    const on = !route, rest = readRouteOpen().filter(x => x !== g.id);
    setRoute(on);
    writeRouteOpen(on ? [...rest, g.id] : rest);
  };
  const stagger = useStagger(30, 12);
  const id = g?.id ?? '';
  const section = g ? prefs.labels.find(l => l.id === g.section) ?? null : null;
  const left = g?.by ? daysLeft(g.by, now) : null;
  const spent = rolled.get(id)?.spent ?? 0;
  const cap = phone ? SHOWN.phone : SHOWN.wide;
  const shown = more || focused ? items : items.slice(0, cap);
  const over = drag.view && drag.view.kind !== 'resize' && drag.view.cell === `${id}|*`;
  const held = g ? holdups(flow) : { blocked: [], by: [] };
  const all = open + done;
  const pct = all ? Math.round((done / all) * 100) : null;
  const krs = g ? flatResults(g.results).filter(x => !x.parent).map(x => x.kr) : [];
  return (
    <article className={'gc' + (g ? '' : ' off') + (over ? ' over' : '') + (focused ? ' focused' : '')} style={tint(section?.color)}
      data-cell={phone ? undefined : `${id}|*`} aria-label={g ? `Goal ${rank + 1}: ${g.title}` : 'Off-goal'}>
      <header className="gc-h">
        {g ? <span className="goal-n num" aria-hidden="true">{rank + 1}</span> : <span className="gc-off-i" aria-hidden="true" />}
        <div className="gc-t">
          <h3 title={g?.title}>{g ? g.title : 'Off-goal'}</h3>
          <p className="gc-m">
            {g ? (
              <>
                {section && <span>{section.name}</span>}
                {left && g?.by && <span className={left.hot ? 'hot' : undefined}>By {shortDate(fromYmd(g.by).getTime(), now)} · {left.text}</span>}
                {krs.length > 0 && <span>Key results {krs.filter(resultDone).length} of {krs.length}</span>}
                <span className="num">{spent ? `${fmtHrs(spent)} this week` : 'Nothing this week'}</span>
              </>
            ) : <span>Errands, admin, favours. Fine, as long as you know.{spent ? ` ${fmtHrs(spent)} this week.` : ''}</span>}
          </p>
        </div>
        {g ? (
          <div className="gc-pct" role="img" aria-label={pct == null ? 'No tasks yet' : `${pct}% done: ${done} done, ${open} to go`}>
            <b className="num">{pct == null ? '–' : `${pct}%`}</b>
            <span className="num">{all ? `${done} done · ${open} to go` : 'No tasks yet'}</span>
          </div>
        ) : <div className="gc-pct off"><b className="num">{open}</b><span>open</span></div>}
      </header>
      {g && pct != null && <div className="gc-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>}

      {held.blocked.length > 0 && g && !route && (
        <button type="button" className="gc-block" onClick={toggleRoute} title="See what’s holding it up on its route">
          <b className="num">{held.blocked.length} blocked</b>
          <span className="gc-block-by">
            {held.by.length ? <>held up by {held.by.slice(0, 2).map((s, i) => <span key={s.id}>{i ? ', ' : ''}{s.kind === 'wait' ? 'waiting on ' : ''}“{shortTitle(s.title, 34)}”</span>)}{held.by.length > 2 ? ` and ${held.by.length - 2} more` : ''}</> : 'see the chart'}
          </span>
        </button>
      )}

      {route && g ? (
        <div className="gc-route"><RouteList goal={g} draggable={!phone} /></div>
      ) : shown.length > 0 ? (
        <div className="gc-list">
          {shown.map((x, i) => <Item key={x.t.id} t={x.t} kind={x.kind} delay={stagger(i)} card={id} />)}
        </div>
      ) : (
        <p className="gc-empty">
          {open ? `Nothing ${pri ? PRI[pri].toLowerCase() : ''} here. ` : g ? 'Nothing open on it. ' : 'Nothing off-goal. '}
          {g && !open && <>Add the next task, or plan it out on its <button type="button" className="link" onClick={() => openSheet('flow', g.id)}>map</button>.</>}
        </p>
      )}
      {adding && <QuickAdd goal={g} priority={pri ?? 2} onDone={() => setAdding(false)} />}

      <footer className="gc-f">
        {items.length > cap && !focused && !route && (
          <button type="button" className="link sm" aria-expanded={more} onClick={() => setMore(o => !o)}>{more ? 'Show fewer' : `View ${items.length - cap} more`}</button>
        )}
        <span className="spacer" />
        {!adding && <button type="button" className="btn text sm" onClick={() => setAdding(true)}><PlusIcon size={12} />Task</button>}
        {g && (
          <button type="button" className="btn text sm gc-fin" onClick={() => { if (focused) setFilter(null); closeGoal(g.id, 'achieved'); }}
            title="Mark it done: it goes to the archive, and Undo brings it straight back"><CheckIcon size={13} w={2.2} />Done</button>
        )}
        {g && (
          <button type="button" className={'btn text sm gc-route-b' + (route ? ' on' : '')} aria-expanded={route} onClick={toggleRoute} title={route ? 'Back to the list' : 'Its route: up next, what’s ready, what you’re waiting on, and the way to the finish'}>
            <RouteIcon size={13} />Route{route ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
        {g && <button type="button" className="btn sec sm" onClick={() => openSheet('flow', g.id)} title="Every step on one map, to plan it out"><MapIcon size={13} />Map</button>}
        {focused && <button type="button" className="btn text sm" onClick={() => setFilter(null)}>All goals</button>}
      </footer>
    </article>
  );
}

/** Stands in for a goal where a hook wants one, for the off-goal card. */
const OFF: Goal = { id: '', title: '', section: null, results: [], by: null, status: 'dropped', created: 0, closedAt: null, updatedAt: 0 };

/** Every goal's card, then off-goal's; or just the goal you picked (Goals → Its tasks). */
function GoalCards({ pri, phone, Item }: { pri: Priority | null; phone?: boolean; Item: Row }) {
  const { topGoals, filter, plan, rootGoalOf, blocked } = usePlanner();
  const byCard = useByCard();
  const keep = (t: Task) => pri == null || t.priority === pri;
  const itemsOf = (id: string) => [
    ...plan.added.filter(t => (rootGoalOf(t)?.id ?? '') === id && keep(t)).map(t => ({ t, kind: 'new' as Kind })),
    ...(byCard.get(id)?.open ?? []).filter(keep).sort(doOrder(blocked)).map(t => ({ t, kind: 'open' as Kind })),
  ];
  const cards = [...topGoals.map((g, i) => ({ g, rank: i })), { g: null, rank: topGoals.length }]
    .filter(c => !filter || (c.g?.id ?? '') === filter.goal);
  return (
    <div className={'gc-grid' + (phone ? ' ph' : '')}>
      {cards.map(c => {
        const id = c.g?.id ?? '';
        const e = byCard.get(id);
        return <GoalCard key={id || '-'} g={c.g} rank={c.rank} items={itemsOf(id)} open={(e?.open.length ?? 0) + (e?.later ?? 0)} done={e?.done ?? 0}
          pri={pri} phone={phone} focused={!!filter} Item={Item} />;
      })}
    </div>
  );
}

/** Before any goals: what they're for, and the way in. */
function SetGoals({ phone }: { phone?: boolean }) {
  const { openSheet, topGoals, goalsLoaded } = usePlanner();
  if (!goalsLoaded || topGoals.length) return null;
  return (
    <div className={'mx-goals' + (phone ? ' ph' : '')}>
      <span className="gempty-i"><TargetIcon size={18} /></span>
      <p className="note"><b>Set your goals.</b> The four or five outcomes that matter most right now. Every task then moves one, or it’s off-goal.</p>
      <button type="button" className="btn pri sm" onClick={() => openSheet('goals')}>Set goals</button>
    </div>
  );
}

/** The way to the archive, once there's something in it: goals you've marked done or dropped. */
function ArchiveLink() {
  const { goals, openSheet } = usePlanner();
  const n = archivedGoals(goals).length;
  if (!n) return null;
  return (
    <button type="button" className="btn ghost sm" onClick={() => openSheet('archive')} title="Goals you’ve marked done or dropped">
      <ArchiveIcon size={14} />Archive<span className="muted num">{n}</span>
    </button>
  );
}

/* ---------- laptop ---------- */

/**
 * The laptop backlog: a card per goal with the tasks that move it. Drag a task onto another goal's card to move it
 * there, onto a priority chip to change its priority, or onto the calendar to schedule it.
 */
export function MatrixPanel() {
  const { filter, setFilter, drag, goals, openSheet, store } = usePlanner();
  const { backlog } = useLists();
  const open = useOpenCount();
  const [pri, setPri] = useState<Priority | null>(null);
  const stagger = useStagger(32, 18);
  const dropOk = drag.view?.kind === 'block' && drag.view.overBacklog;
  const focusName = filter ? goals.find(g => g.id === filter.goal)?.title ?? 'Off-goal' : null;
  return (
    <section className={'mx panel gcs' + (dropOk ? ' drop-ok' : '')} aria-label="Your goals and what moves each one" data-backlog="">
      <div className="mx-h">
        <span className="mx-title">Goals</span>
        <span className="muted sm num">{open} open</span>
        <span className="spacer" />
        {focusName && (
          <button type="button" className="fchip" aria-label="Show every goal" onClick={() => setFilter(null)}>{shortTitle(focusName, 34)}<XIcon size={11} /></button>
        )}
        <ArchiveLink />
        <button type="button" className="btn ghost sm" onClick={() => openSheet('goals')}><TargetIcon size={14} />Edit goals</button>
      </div>
      <PriChips pri={pri} setPri={setPri} />
      <div className="gc-scroll">
        <SetGoals />
        <GoalCards pri={pri} Item={TaskRow} />
        {store.loaded && !backlog.length && !filter && (
          <p className="mx-empty">Nothing waiting. Mention a day or time and it goes on the calendar; anything else waits here.</p>
        )}
        <Done Item={TaskRow} stagger={stagger} />
      </div>
    </section>
  );
}

/* ---------- phone ---------- */

/** The phone's Goals tab: the same cards, one under another. */
export function PhoneMatrix() {
  const { store, filter } = usePlanner();
  const { backlog } = useLists();
  const [pri, setPri] = useState<Priority | null>(null);
  const stagger = useStagger(34, 14);
  return (
    <>
      <SetGoals phone />
      <PriChips pri={pri} setPri={setPri} phone />
      <div className="ph-list gc-ph">
        <GoalCards pri={pri} phone Item={PhoneRow} />
        {store.loaded && !backlog.length && !filter && (
          <p className="mx-empty">Nothing waiting. Mention a day or time and it goes on the calendar; anything else waits here.</p>
        )}
        <Done Item={PhoneRow} stagger={stagger} />
      </div>
    </>
  );
}
