'use client';

import { useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { newId, PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtWhen, shortDate, shortTitle } from '@/lib/format';
import { describeRepeat, describeRule } from '@/lib/repeat';
import { goalProgress, type Goal } from '@/lib/goals';
import { fromYmd } from '@/lib/time';
import { usePlanner, useLists } from './Planner';
import { daysLeft, fmtHrs, useGoalWeek } from './Goals';
import { useFlowCount } from './Flow';
import { CheckIcon, ChevronDown, PlusIcon, RepeatIcon, TargetIcon, XIcon } from './icons';

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

/** The card a task sits in: its active goal's top goal, or '' for off-goal. */
const useRowOf = () => { const { rootGoalOf } = usePlanner(); return (t: Task) => rootGoalOf(t)?.id ?? ''; };

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
  // Held up by a step before it on its goal's flow chart.
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
  const cls = 'row' + (kind === 'done' || completing.has(t.id) ? ' done' : '') + (picked === t.id ? ' picked' : '')
    + (ticking || kind === 'new' ? ' ghosted' : '') + (lifting ? ' lifting' : '') + (kind === 'new' ? ' new' : '');
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
        {repeat && <span className="rep-g" title={describeRepeat(repeat)}><RepeatIcon size={11} /><span className="sr">, {describeRepeat(repeat)}</span></span>}
        {tag && <span className={tag.cls}>{tag.text}</span>}
        {kind === 'done' && t.doneAt != null && <span className="due">{fmtWhen(t.doneAt, now)}</span>}
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
  const label = labelOf(t);
  const repeat = repeatOf(t);
  const goal = goalOf(t);
  const due = t.due && kind === 'open' ? dueLabel(t.due, now) : null;
  const inCard = card != null;
  const where = inCard ? (goal && goal.id !== card ? `› ${shortTitle(goal.title, 24)}` : null)
    : goal ? shortTitle(goal.title, 28) : activeGoals.length ? 'Off-goal' : label?.name ?? null;
  const facts = [
    kind === 'new' ? 'New' : null,
    kind === 'done' && t.doneAt != null ? `Done ${fmtWhen(t.doneAt, now)}` : null,
    due?.text ?? null, where, fmtDur(t.minutes), repeat ? describeRule(repeat.rule) : null,
  ].filter(Boolean).join(' · ');
  const lifting = drag.view?.id === t.id && drag.view.kind === 'row';
  const cls = 'prow' + (kind === 'done' || completing.has(t.id) ? ' done' : '') + (tag?.text === 'Tick off' || kind === 'new' ? ' ghosted' : '') + (lifting ? ' lifting' : '');
  return (
    <div className={cls} style={{ animationDelay: delay }}>
      <Ring t={t} kind={kind} size={12} />
      <button type="button" className="prow-main" disabled={kind === 'new'}
        onPointerDown={kind === 'open' ? e => drag.begin(e, 'row', t.id) : undefined}
        onClick={() => { if (!drag.ignoreClick()) openEditor(t.id); }}>
        <span className="prow-t"><span className="rt"><span className="strike">{t.title}</span></span>{tag && <span className={tag.cls}>{tag.text}</span>}</span>
        <span className="prow-m">{(!inCard || card === '') && <span className={'dot' + (label ? '' : ' none')} style={tint(label?.color)} />}<span className={due?.hot ? 'hot' : undefined}>{facts}</span></span>
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
  const { backlog } = useLists();
  const over = drag.view && drag.view.kind !== 'resize' ? drag.view.cell : null;
  return (
    <div className={'pchips' + (phone ? ' ph' : '')} role="group" aria-label="Show tasks by priority">
      <button type="button" className="pchip" aria-pressed={pri == null} onClick={() => setPri(null)}>All <span className="num">{backlog.length}</span></button>
      {PRIS.map(p => {
        const n = backlog.filter(t => t.priority === p).length;
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
const SHOWN = { wide: 3, phone: 3 };

/**
 * One goal (or, with no goal, off-goal work): rank, title, how far along it is, its deadline and time this week, and
 * the tasks that move it in the order to do them. Drop a task on it to put the task on this goal.
 */
function GoalCard({ g, rank, items, total, pri, phone, focused, Item }: {
  g: Goal | null; rank: number; items: { t: Task; kind: Kind }[]; total: number; pri: Priority | null; phone?: boolean; focused?: boolean; Item: Row;
}) {
  const { prefs, goals, now, openSheet, setFilter, drag } = usePlanner();
  const { rolled } = useGoalWeek();
  const steps = useFlowCount(g ?? OFF);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const stagger = useStagger(30, 12);
  const id = g?.id ?? '';
  const section = g ? prefs.labels.find(l => l.id === g.section) ?? null : null;
  const progress = g ? goalProgress(g, goals) : null;
  const left = g?.by ? daysLeft(g.by, now) : null;
  const spent = rolled.get(id)?.spent ?? 0;
  const cap = phone ? SHOWN.phone : SHOWN.wide;
  const shown = open || focused ? items : items.slice(0, cap);
  const over = drag.view && drag.view.kind !== 'resize' && drag.view.cell === `${id}|*`;
  const blocked = g ? steps.blocked : 0;
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
                <span className="num">{spent ? `${fmtHrs(spent)} this week` : 'Nothing this week'}</span>
              </>
            ) : <span>Errands, admin, favours. Fine, as long as you know.{spent ? ` ${fmtHrs(spent)} this week.` : ''}</span>}
          </p>
        </div>
        {progress != null && (
          <span className="gprog gc-p" role="img" aria-label={`${Math.round(progress * 100)}% done`}>
            <span className="gprog-b"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span><span className="num">{Math.round(progress * 100)}%</span>
          </span>
        )}
      </header>

      {shown.length > 0 ? (
        <div className="gc-list">
          {shown.map((x, i) => <Item key={x.t.id} t={x.t} kind={x.kind} delay={stagger(i)} card={id} />)}
        </div>
      ) : (
        <p className="gc-empty">
          {total ? `Nothing ${pri ? PRI[pri].toLowerCase() : ''} here. ` : g ? 'Nothing open on it. ' : 'Nothing off-goal. '}
          {g && !total && <>Add the next task, or plan it out in its <button type="button" className="link" onClick={() => openSheet('flow', g.id)}>flow chart</button>.</>}
        </p>
      )}
      {adding && <QuickAdd goal={g} priority={pri ?? 2} onDone={() => setAdding(false)} />}

      <footer className="gc-f">
        {items.length > cap && !focused && (
          <button type="button" className="link sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Show less' : `${items.length - cap} more`}</button>
        )}
        <span className="spacer" />
        {!adding && <button type="button" className="btn text sm" onClick={() => setAdding(true)}><PlusIcon size={12} />Task</button>}
        {g && (
          <button type="button" className="btn sec sm" onClick={() => openSheet('flow', g.id)} title={blocked ? `${blocked} blocked` : 'Its steps as a flow chart'}>
            Flow chart{blocked ? <span className="gc-bl num">{blocked} blocked</span> : null}
          </button>
        )}
        {focused && <button type="button" className="btn text sm" onClick={() => setFilter(null)}>All goals</button>}
      </footer>
    </article>
  );
}

/** Stands in for a goal where a hook wants one, for the off-goal card. */
const OFF: Goal = { id: '', title: '', section: null, results: [], by: null, status: 'dropped', created: 0, closedAt: null, updatedAt: 0 };

/** Every goal's card, then off-goal's; or just the goal you picked (Goals → Its tasks). */
function GoalCards({ pri, phone, Item }: { pri: Priority | null; phone?: boolean; Item: Row }) {
  const { topGoals, filter, plan } = usePlanner();
  const { backlog } = useLists();
  const rowOf = useRowOf();
  const keep = (t: Task) => pri == null || t.priority === pri;
  const itemsOf = (id: string) => [
    ...plan.added.filter(t => rowOf(t) === id && keep(t)).map(t => ({ t, kind: 'new' as Kind })),
    ...backlog.filter(t => rowOf(t) === id && keep(t)).map(t => ({ t, kind: 'open' as Kind })),
  ];
  const cards = [...topGoals.map((g, i) => ({ g, rank: i })), { g: null, rank: topGoals.length }]
    .filter(c => !filter || (c.g?.id ?? '') === filter.goal);
  return (
    <div className={'gc-grid' + (phone ? ' ph' : '')}>
      {cards.map(c => {
        const id = c.g?.id ?? '';
        return <GoalCard key={id || '-'} g={c.g} rank={c.rank} items={itemsOf(id)} total={backlog.filter(t => rowOf(t) === id).length}
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

/* ---------- laptop ---------- */

/**
 * The laptop backlog: a card per goal with the tasks that move it. Drag a task onto another goal's card to move it
 * there, onto a priority chip to change its priority, or onto the calendar to schedule it.
 */
export function MatrixPanel() {
  const { filter, setFilter, drag, goals, openSheet, store } = usePlanner();
  const { backlog } = useLists();
  const [pri, setPri] = useState<Priority | null>(null);
  const stagger = useStagger(32, 18);
  const dropOk = drag.view?.kind === 'block' && drag.view.overBacklog;
  const focusName = filter ? goals.find(g => g.id === filter.goal)?.title ?? 'Off-goal' : null;
  return (
    <section className={'mx panel gcs' + (dropOk ? ' drop-ok' : '')} aria-label="Your goals and what moves each one" data-backlog="">
      <div className="mx-h">
        <span className="mx-title">Goals</span>
        <span className="muted sm num">{backlog.length} open</span>
        <span className="spacer" />
        {focusName && (
          <button type="button" className="fchip" aria-label="Show every goal" onClick={() => setFilter(null)}>{shortTitle(focusName, 34)}<XIcon size={11} /></button>
        )}
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
