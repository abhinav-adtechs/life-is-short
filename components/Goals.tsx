'use client';

import { useId, useMemo, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { isEvent } from '@/lib/select';
import {
  FOCUS_GOALS, GOAL_TITLE_MAX, MAX_ACTIVE, MAX_ALL_RESULTS, MAX_GOAL_DEPTH, MAX_KR_DEPTH, RESULT_MAX, addGoal, addResult, descendantsOf, findResult, goalProgress,
  goalTree, makeGoal, mergeResults, moveGoal, onGoalShare, outlineOf, parseOutline, patchGoal, patchResult, removeGoal, resultDone, resultProgress,
  resultsLine, rootOf, setGoalStatus, tallyGoals, topGoals, type Goal, type GoalTally, type KeyResult, type ResultDraft,
} from '@/lib/goals';
import { fmtDur, shortDate, shortTitle } from '@/lib/format';
import { DAY_MS, addDays, fromYmd, startOfDay, weekStart } from '@/lib/time';
import { usePlanner } from './Planner';
import { LabelPicker } from './Labels';
import { radio, radioKeys } from './Controls';
import { CheckIcon, ChevronDown, ChevronUp, PlusIcon, TargetIcon } from './icons';
import { useFlowCount } from './Flow';

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/** "45m", "3h", "3.5h": short enough for a column. */
export const fmtHrs = (m: number) => (m <= 0 ? '–' : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 30) / 2}h`);

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * This week and last, per goal ('' for off-goal), and what's open on each. A task on a goal you've since removed counts
 * as off-goal. `rolled` is the week per top goal, its sub-goals' time included.
 */
export function useGoalWeek() {
  const { tasks, now, prefs, goalById, isOff, goals } = usePlanner();
  return useMemo(() => {
    const key = (t: Task) => (t.goal && goalById(t.goal) ? t.goal : '');
    const live = tasks.filter(t => !isOff(t));
    const wk0 = weekStart(now, prefs.weekStart).getTime(), wk1 = addDays(wk0, 7).getTime();
    const week = tallyGoals(live, wk0, wk1, now, key);
    // Last week up to the same point, so a Tuesday isn't held up against a whole week.
    const last = tallyGoals(live, wk0 - 7 * DAY_MS, now - 7 * DAY_MS, now, key);
    const ever = tallyGoals(live, 0, Number.MAX_SAFE_INTEGER, now, key);
    const open = new Map<string, number>();
    for (const t of live) if (t.status === 'open' && !isEvent(t)) open.set(key(t), (open.get(key(t)) ?? 0) + 1);
    // Up to the top goal: its sub-goals' time and open tasks count towards it too.
    const index = new Map(goals.map(g => [g.id, g]));
    const up = <T,>(m: Map<string, T>, add: (a: T, b: T) => T) => {
      const out = new Map<string, T>();
      for (const [k, v] of m) {
        const g = k ? index.get(k) : undefined;
        const r = g ? rootOf(index, g).id : k;
        out.set(r, out.has(r) ? add(out.get(r) as T, v) : v);
      }
      return out;
    };
    const sum = (a: GoalTally, b: GoalTally) => ({ spent: a.spent + b.spent, planned: a.planned + b.planned, done: a.done + b.done });
    return {
      week, last, ever, open, share: onGoalShare(week), lastShare: onGoalShare(last),
      rolled: up(week, sum), everRolled: up(ever, sum), openRolled: up(open, (a, b) => a + b),
    };
  }, [tasks, now, prefs.weekStart, goalById, isOff, goals]);
}

const zero: GoalTally = { spent: 0, planned: 0, done: 0 };

/* ---------- picking a goal for a task ---------- */

/**
 * Your active goals, sub-goals under their parents, or off-goal, as a row of chips. A goal you've achieved or dropped
 * shows while it's picked.
 */
export function GoalPicker({ value, onChange, labelledBy }: { value: string | null; onChange: (id: string | null) => void; labelledBy: string }) {
  const { goals, goalById, prefs } = usePlanner();
  const cur = value ? goalById(value) : null;
  const tree = goalTree(goals, g => g.status === 'active');
  const shown = cur && cur.status !== 'active' ? [...tree, { goal: cur, depth: 0 }] : tree;
  const color = (g: Goal) => prefs.labels.find(l => l.id === g.section)?.color ?? null;
  return (
    <div className="chips goal-chips" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={radioKeys}>
      {shown.map(({ goal: g, depth }) => (
        <button key={g.id} type="button" className={'chipb gchip' + (depth ? ' sub' : '')} {...radio(cur?.id === g.id)} title={g.title} onClick={() => onChange(g.id)}>
          {depth > 0 ? <span className="gchip-in" aria-hidden="true">{'›'.repeat(depth)}</span> : <span className={'dot' + (color(g) ? '' : ' none')} style={tint(color(g))} />}
          <span className="ell">{g.title}</span>
          {g.status !== 'active' && <span className="muted sm">{g.status}</span>}
        </button>
      ))}
      <button type="button" className="chipb gchip off" {...radio(!cur)} onClick={() => onChange(null)}><span className="dot none" />Off-goal</button>
    </div>
  );
}

/* ---------- a goal, to write or change ---------- */

interface GoalValues { title: string; section: string | null; results: ResultDraft[]; by: string | null }

/**
 * Tab and Shift+Tab indent and outdent the line you're on, so key results can go under each other. The text changes in
 * place and the caret moves with it at once, so typing straight after stays where it was.
 */
function indentKeys(e: React.KeyboardEvent<HTMLTextAreaElement>, set: (v: string) => void) {
  if (e.key !== 'Tab' || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const el = e.currentTarget, v = el.value, at = el.selectionStart, to = el.selectionEnd;
  const lineStart = v.lastIndexOf('\n', at - 1) + 1;
  if (e.shiftKey) {
    const n = /^ {1,2}/.exec(v.slice(lineStart))?.[0].length ?? 0;
    if (!n) return;
    el.setRangeText('', lineStart, lineStart + n);
    el.setSelectionRange(Math.max(lineStart, at - n), Math.max(lineStart, to - n));
  } else {
    el.setRangeText('  ', lineStart, lineStart);
    el.setSelectionRange(at + 2, to + 2);
  }
  set(el.value);
}

function GoalForm({ goal, sub, onSave, onCancel }: {
  goal?: Goal; sub?: { parent: Goal; kr: string | null }; onSave: (v: GoalValues) => void; onCancel: () => void;
}) {
  const { prefs } = usePlanner();
  const id = useId();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [section, setSection] = useState<string | null>(goal?.section ?? sub?.parent.section ?? prefs.labels[0]?.id ?? null);
  const [results, setResults] = useState(goal ? outlineOf(goal.results) : '');
  const [by, setBy] = useState(goal?.by ?? '');
  const ok = title.trim().length > 0;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    onSave({ title, section, results: parseOutline(results), by: by || null });
  };
  const kr = sub?.kr ? findResult(sub.parent.results, sub.kr) : null;
  return (
    <form className="gform" onSubmit={save} autoComplete="off"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      {sub && <p className="note">A sub-goal of <b>{sub.parent.title}</b>{kr ? <>, for “{kr.text}”</> : ''}.</p>}
      <div className="fld">
        <label htmlFor={`${id}-t`}>{sub || goal?.parent ? 'Sub-goal' : 'Goal'}</label>
        <input id={`${id}-t`} type="text" value={title} maxLength={GOAL_TITLE_MAX} autoFocus enterKeyHint="next"
          placeholder={sub ? 'What has to happen for it: “Close the lawyer’s side”' : 'Specific enough to finish: “Close the seed round”'} onChange={e => setTitle(e.target.value)} />
      </div>
      {prefs.labels.length > 0 && !sub && !goal?.parent && (
        <div className="fld">
          <span className="flabel" id={`${id}-s`}>Section</span>
          <LabelPicker labelledBy={`${id}-s`} value={section} onChange={setSection} none="None" />
        </div>
      )}
      <div className="fld">
        <label htmlFor={`${id}-r`}>Done when <span className="muted sm">key results, one a line; indent a line (Tab) to put it under the one above</span></label>
        <textarea id={`${id}-r`} rows={4} value={results} maxLength={MAX_ALL_RESULTS * (RESULT_MAX + 8)} className="gform-kr"
          placeholder={'Share transfer signed\n  Buyer’s lawyer approves the SPA\n  Board approves\nMoney in the bank'}
          onChange={e => setResults(e.target.value)} onKeyDown={e => indentKeys(e, setResults)} />
      </div>
      <div className="two">
        <div className="fld"><label htmlFor={`${id}-b`}>By</label><input id={`${id}-b`} type="date" value={by} onChange={e => setBy(e.target.value)} /></div>
        <div className="fld" />
      </div>
      <div className="acts">
        <button type="submit" className="btn pri sm" disabled={!ok}>{goal ? 'Save' : sub ? 'Add sub-goal' : 'Add goal'}</button>
        <button type="button" className="btn text sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------- one goal ---------- */

export function daysLeft(by: string, now: number) {
  const d = Math.round((fromYmd(by).getTime() - startOfDay(now).getTime()) / DAY_MS);
  return d < 0 ? { text: `${-d} day${d === -1 ? '' : 's'} over`, hot: true } : d === 0 ? { text: 'today', hot: true } : { text: `${d} day${d === 1 ? '' : 's'} left`, hot: d <= 7 };
}

/** A progress bar and its percentage. */
function Progress({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null;
  return (
    <span className="gprog" role="img" aria-label={`${label}: ${pct(value)} done`}>
      <span className="gprog-b"><i style={{ width: pct(value) }} /></span><span className="num">{pct(value)}</span>
    </span>
  );
}

/** What adding a sub-goal is waiting on: the form shows under the goal, or under one of its key results. */
type Adding = { parent: string; kr: string | null } | null;

/** A line to type a new key result into, in place: Enter adds it and stays for the next, Esc or leaving it empty stops. */
function NewResult({ g, under, onDone }: { g: Goal; under: string | null; onDone: () => void }) {
  const { changeGoals } = usePlanner();
  const [text, setText] = useState('');
  // Esc means leave it: don't add what's typed when the field goes.
  const stop = useRef(false);
  const add = () => { if (text.trim() && !stop.current) changeGoals(addResult(g.id, under, text)); setText(''); };
  return (
    <div className="kr-new">
      <span className="kbox" aria-hidden="true" />
      <input type="text" value={text} maxLength={RESULT_MAX} autoFocus enterKeyHint="done" aria-label={under ? 'Key result under it' : `A key result for ${g.title}`}
        placeholder={under ? 'Under it: what has to be true' : 'Done when: what has to be true'} onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) add(); else onDone(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop.current = true; onDone(); }
        }}
        onBlur={() => { add(); onDone(); }} />
    </div>
  );
}

/** A goal's key results, nested, each with the sub-goals that serve it right under it. */
function Results({ g, list, depth, adding, setAdding, goalDepth }: {
  g: Goal; list: KeyResult[]; depth: number; adding: Adding; setAdding: (a: Adding) => void; goalDepth: number;
}) {
  const { goals, changeGoals, logGoal } = usePlanner();
  const [under, setUnder] = useState<string | null>(null);
  // On a touch screen the two adds sit behind one + per line, opened under it.
  const [menu, setMenu] = useState<string | null>(null);
  const tick = (r: KeyResult) => {
    if (!r.done && resultDone(r)) return;
    changeGoals(patchResult(g.id, r.id, { done: !r.done }));
    logGoal([{ at: Date.now(), goal: g.id, op: r.done ? 'untick' : 'tick', step: `kr:${r.id}`, title: r.text }]);
  };
  return (
    <ul className={'krs' + (depth ? ' sub' : '')}>
      {list.map(r => {
        const done = resultDone(r), auto = done && !r.done;
        const serving = goals.filter(c => c.parent === g.id && c.parentKr === r.id && c.status !== 'dropped');
        return (
          <li key={r.id}>
            <div className="kr-row">
              <button type="button" className={'kr' + (done ? ' on' : '')} role="checkbox" aria-checked={done} aria-disabled={auto || undefined}
                title={auto ? 'Done: everything under it is' : undefined} onClick={() => tick(r)}>
                <span className="kbox"><CheckIcon size={10} w={2.6} /></span><span>{r.text}</span>
              </button>
              {r.results?.length ? <Progress value={resultProgress(r)} label={r.text} /> : null}
              <span className="kr-acts">
                {depth < MAX_KR_DEPTH - 1 && (
                  <button type="button" className="link sm" title="A key result under this one" onClick={() => setUnder(r.id)}>+ key result</button>
                )}
                {goalDepth < MAX_GOAL_DEPTH && (
                  <button type="button" className="link sm" title="An objective of its own, to get this key result done" onClick={() => setAdding({ parent: g.id, kr: r.id })}>+ sub-goal</button>
                )}
                <button type="button" className="ib bare kr-more" aria-label={`Add under “${r.text}”`} aria-expanded={menu === r.id}
                  onClick={() => setMenu(m => (m === r.id ? null : r.id))}><PlusIcon size={14} /></button>
              </span>
            </div>
            {menu === r.id && (
              <div className="kr-menu">
                {depth < MAX_KR_DEPTH - 1 && <button type="button" className="link sm kr-add" onClick={() => { setMenu(null); setUnder(r.id); }}><PlusIcon size={11} />Key result under it</button>}
                {goalDepth < MAX_GOAL_DEPTH && <button type="button" className="link sm kr-add" onClick={() => { setMenu(null); setAdding({ parent: g.id, kr: r.id }); }}><PlusIcon size={11} />Sub-goal for it</button>}
              </div>
            )}
            {r.results?.length || under === r.id ? (
              <div className="krs-in">
                {r.results?.length ? <Results g={g} list={r.results} depth={depth + 1} adding={adding} setAdding={setAdding} goalDepth={goalDepth} /> : null}
                {under === r.id && <NewResult g={g} under={r.id} onDone={() => setUnder(null)} />}
              </div>
            ) : null}
            {serving.length > 0 && <ul className="gsubs">{serving.map(c => <SubGoal key={c.id} g={c} depth={goalDepth + 1} adding={adding} setAdding={setAdding} />)}</ul>}
            {adding?.parent === g.id && adding.kr === r.id && <SubGoalForm parent={g} kr={r.id} onDone={() => setAdding(null)} />}
          </li>
        );
      })}
    </ul>
  );
}

/** The form for a new sub-goal, in place. */
function SubGoalForm({ parent, kr, onDone }: { parent: Goal; kr: string | null; onDone: () => void }) {
  const { changeGoals, logGoal } = usePlanner();
  return (
    <div className="gcard editing new sub">
      <GoalForm sub={{ parent, kr }} onCancel={onDone} onSave={v => {
        const g = makeGoal({ ...v, section: parent.section, parent: parent.id, parentKr: kr });
        changeGoals(addGoal(g));
        logGoal([{ at: Date.now(), goal: parent.id, op: 'add', step: `goal:${g.id}`, title: g.title }]);
        onDone();
      }} />
    </div>
  );
}

/** A goal's sub-goals for the goal as a whole (not for one key result). */
function GoalWide({ g, depth, adding, setAdding }: { g: Goal; depth: number; adding: Adding; setAdding: (a: Adding) => void }) {
  const { goals } = usePlanner();
  const wide = goals.filter(c => c.parent === g.id && !(c.parentKr && findResult(g.results, c.parentKr)) && c.status !== 'dropped');
  return (
    <>
      {wide.length > 0 && <ul className="gsubs wide">{wide.map(c => <SubGoal key={c.id} g={c} depth={depth + 1} adding={adding} setAdding={setAdding} />)}</ul>}
      {adding?.parent === g.id && adding.kr == null && <SubGoalForm parent={g} kr={null} onDone={() => setAdding(null)} />}
    </>
  );
}

/** A sub-goal: a compact row that opens into its own key results and sub-goals. */
function SubGoal({ g, depth, adding, setAdding }: { g: Goal; depth: number; adding: Adding; setAdding: (a: Adding) => void }) {
  const { goals, changeGoals, openSheet, toast } = usePlanner();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newKr, setNewKr] = useState(false);
  const progress = goalProgress(g, goals);
  const done = g.status === 'achieved';
  if (editing) {
    return (
      <li className="gsub editing">
        <GoalForm goal={g} onCancel={() => setEditing(false)} onSave={v => {
          changeGoals(patchGoal(g.id, { title: v.title.replace(/\s+/g, ' ').trim(), results: mergeResults(g.results, v.results), by: v.by }));
          setEditing(false);
        }} />
      </li>
    );
  }
  const has = g.results.length > 0 || goals.some(c => c.parent === g.id);
  return (
    <li className={'gsub' + (done ? ' done' : '')}>
      <div className="gsub-h">
        <button type="button" className="gsub-t" aria-expanded={has ? open : undefined} onClick={() => has && setOpen(o => !o)}>
          {has && <ChevronDown />}<span className="gsub-k">Sub-goal</span><span>{g.title}</span>
        </button>
        <Progress value={progress} label={g.title} />
      </div>
      <div className="gsub-acts">
        <button type="button" className="link sm" onClick={() => openSheet('flow', g.id)}>Flow chart</button>
        <button type="button" className="link sm" onClick={() => setEditing(true)}>Edit</button>
        {!done && <button type="button" className="link sm" onClick={() => { setOpen(true); setNewKr(true); }}>+ key result</button>}
        {!done && depth < MAX_GOAL_DEPTH && <button type="button" className="link sm" onClick={() => { setOpen(true); setAdding({ parent: g.id, kr: null }); }}>+ sub-goal</button>}
        <button type="button" className="link sm" onClick={() => changeGoals(setGoalStatus(g.id, done ? 'active' : 'achieved'))}>{done ? 'Bring back' : 'Achieved'}</button>
        {!done && <button type="button" className="link sm" onClick={() => toast(`Dropped · ${shortTitle(g.title, 30)}`, changeGoals(setGoalStatus(g.id, 'dropped')))}>Drop</button>}
      </div>
      {open && (
        <>
          {g.results.length > 0 && <Results g={g} list={g.results} depth={0} adding={adding} setAdding={setAdding} goalDepth={depth} />}
          {newKr && <NewResult g={g} under={null} onDone={() => setNewKr(false)} />}
          <GoalWide g={g} depth={depth} adding={adding} setAdding={setAdding} />
        </>
      )}
    </li>
  );
}

function GoalCard({ g, rank, count, week, ever, open, onTasks, adding, setAdding }: {
  g: Goal; rank: number; count: number; week: GoalTally; ever: GoalTally; open: number; onTasks: () => void; adding: Adding; setAdding: (a: Adding) => void;
}) {
  const { prefs, changeGoals, toast, now, wide, openSheet, goals } = usePlanner();
  const [editing, setEditing] = useState(false);
  const [newKr, setNewKr] = useState(false);
  const steps = useFlowCount(g);
  const section = prefs.labels.find(l => l.id === g.section) ?? null;
  const left = g.by ? daysLeft(g.by, now) : null;
  const progress = goalProgress(g, goals);
  const subs = descendantsOf(goals, g.id).filter(d => d.status === 'active').length;

  if (editing) {
    return (
      <li className="gcard editing" style={tint(section?.color)}>
        <GoalForm goal={g} onCancel={() => setEditing(false)} onSave={v => {
          // A key result kept word for word, under the same one, keeps its tick.
          changeGoals(patchGoal(g.id, { title: v.title.replace(/\s+/g, ' ').trim(), section: v.section, results: mergeResults(g.results, v.results), by: v.by }));
          setEditing(false);
        }} />
      </li>
    );
  }

  const close = (status: 'achieved' | 'dropped') => {
    const undo = changeGoals(setGoalStatus(g.id, status));
    const tail = open ? ` Its ${open} open task${open === 1 ? ' is' : 's are'} off-goal now.` : '';
    // Bring it back from the list below while the panel is open, or with Undo once it's closed.
    toast(`${status === 'achieved' ? 'Achieved' : 'Dropped'} · ${shortTitle(g.title, 30)}${subs ? `, with its ${subs} sub-goal${subs === 1 ? '' : 's'}` : ''}.${tail}`, undo);
  };

  return (
    <li className="gcard" style={tint(section?.color)}>
      <div className="goal-h">
        <span className="goal-n num" aria-label={`Goal ${rank + 1}`}>{rank + 1}</span>
        <span className={'dot' + (section ? '' : ' none')} />
        <span className="muted sm ell">{section?.name ?? 'No section'}</span>
        <span className="spacer" />
        {g.by && left && <span className={'sm' + (left.hot ? ' hot' : ' muted')}>By {shortDate(fromYmd(g.by).getTime(), now)} · {left.text}</span>}
      </div>
      <div className="goal-th">
        <h4 className="goal-t">{g.title}</h4>
        <Progress value={progress} label={g.title} />
      </div>
      {g.results.length > 0 && <Results g={g} list={g.results} depth={0} adding={adding} setAdding={setAdding} goalDepth={0} />}
      {newKr ? <NewResult g={g} under={null} onDone={() => setNewKr(false)} /> : (
        <div className="kr-adds">
          <button type="button" className="link sm kr-add" onClick={() => setNewKr(true)}><PlusIcon size={11} />{g.results.length ? 'Key result' : 'Say what done means: a key result'}</button>
          <button type="button" className="link sm kr-add" title="An objective of its own, under this one" onClick={() => setAdding({ parent: g.id, kr: null })}><PlusIcon size={11} />Sub-goal</button>
        </div>
      )}
      <GoalWide g={g} depth={0} adding={adding} setAdding={setAdding} />
      <div className="goal-m">
        <span>This week <b className="num">{week.spent ? fmtDur(week.spent) : 'nothing yet'}</b>{week.planned > 0 && <span className="muted"> · {fmtDur(week.planned)} planned</span>}{subs ? <span className="muted"> · with sub-goals</span> : null}</span>
        <span className="muted num">{open} open{steps.blocked ? <> · <span className="hot">{steps.blocked} blocked</span></> : null}{ever.spent ? ` · ${fmtDur(ever.spent)} all told` : ''}</span>
      </div>
      <div className="goal-acts">
        <button type="button" className="btn sec sm" onClick={() => openSheet('flow', g.id)}
          title={`Its steps as a flow chart${steps.blocked ? `: ${steps.blocked} blocked` : ''}`}>Flow chart</button>
        <button type="button" className="btn text sm" onClick={onTasks}>Tasks</button>
        <button type="button" className="btn text sm" onClick={() => setEditing(true)}>Edit</button>
        <span className="spacer" />
        <button type="button" className="ib bare" aria-label={`Move ${g.title} up`} disabled={rank === 0} onClick={() => changeGoals(moveGoal(g.id, -1))}><ChevronUp /></button>
        <button type="button" className="ib bare" aria-label={`Move ${g.title} down`} disabled={rank === count - 1} onClick={() => changeGoals(moveGoal(g.id, 1))}><ChevronDown /></button>
        <button type="button" className="btn text sm" onClick={() => close('achieved')}>Achieved</button>
        <button type="button" className="btn text sm" onClick={() => close('dropped')}>Drop</button>
      </div>
    </li>
  );
}

/* ---------- the panel ---------- */

/** Where this week's time went: a stacked bar, one stretch per goal in its section's colour, then off-goal. */
function WeekBar({ goals, week }: { goals: Goal[]; week: Map<string, GoalTally> }) {
  const { prefs } = usePlanner();
  const parts = [...goals.map(g => ({ id: g.id, name: g.title, color: prefs.labels.find(l => l.id === g.section)?.color ?? 'var(--muted)', m: week.get(g.id)?.spent ?? 0 })),
    { id: '', name: 'Off-goal', color: null as string | null, m: week.get('')?.spent ?? 0 }].filter(p => p.m > 0);
  const total = parts.reduce((n, p) => n + p.m, 0);
  if (!total) return <div className="gbar empty" aria-hidden="true" />;
  return (
    <div className="gbar" role="img" aria-label={parts.map(p => `${p.name} ${fmtDur(p.m)}`).join(', ')}>
      {parts.map(p => <i key={p.id || '-'} className={p.id ? undefined : 'off'} style={{ flexGrow: p.m, ...(p.color ? { '--c': p.color } : {}) } as React.CSSProperties} title={`${p.name} · ${fmtDur(p.m)}`} />)}
    </div>
  );
}

/**
 * Goals: the few outcomes you're working towards, in the order they matter, each with what "done" means and where
 * this week's time went. Everything else is off-goal, which is fine, as long as you know.
 */
export function Goals() {
  const { goals, activeGoals, changeGoals, toast, setFilter, closeSheet, wide, setPhoneTab, goalsLoaded } = usePlanner();
  const stats = useGoalWeek();
  const tops = topGoals(goals);
  const [adding, setAdding] = useState(false);
  const [addingSub, setAddingSub] = useState<Adding>(null);
  const [showClosed, setShowClosed] = useState(false);
  // Deleting a goal can't be undone from here (the panel covers the toast), so it takes a second click.
  const [armed, setArmed] = useState<string | null>(null);
  // Closed goals, unless they went with a goal above them (they come back with it).
  const byId = new Map(goals.map(g => [g.id, g]));
  const closed = goals.filter(g => g.status !== 'active' && !(g.parent && byId.get(g.parent)?.status !== 'active' && byId.get(g.parent)?.status === g.status))
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const onTime = activeGoals.reduce((n, g) => n + (stats.week.get(g.id)?.spent ?? 0), 0);
  const offTime = stats.week.get('')?.spent ?? 0;
  const full = tops.length >= MAX_ACTIVE;

  const showTasks = (goal: string) => {
    setFilter({ goal, priority: null });
    closeSheet();
    if (!wide) setPhoneTab('matrix');
  };

  return (
    <div className="gpanel">
      <section className="gweek" aria-label="This week">
        <p className="rv-k">This week</p>
        {stats.share == null ? (
          <>
            <p className="gweek-big">Nothing done yet</p>
            <WeekBar goals={tops} week={stats.rolled} />
            <p className="note">Tick off a task on a goal, or sit through a meeting that moves one, and it shows here.</p>
          </>
        ) : (
          <>
            <p className="gweek-big"><b className="num">{pct(stats.share)}</b> of your time on goals</p>
            <WeekBar goals={tops} week={stats.rolled} />
            <p className="note num">
              {fmtDur(onTime)} on goals · {fmtDur(offTime)} off-goal
              {stats.lastShare != null ? ` · ${pct(stats.lastShare)} by this point last week` : ''}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="goals-h">
        <div className="set-h"><h3 id="goals-h">Your goals</h3><span className="muted sm">{tops.length ? `${tops.length} in focus, most important first` : ''}</span></div>
        {!tops.length && goalsLoaded && !adding && (
          <div className="gempty">
            <span className="gempty-i"><TargetIcon size={20} /></span>
            <p><b>Pick the four or five outcomes that matter most right now.</b></p>
            <p className="note">
              Make each one specific enough to finish, and say what “done” means: its key results. Break a big one down into
              sub-goals, and key results into smaller ones. Then every task either moves a goal or it’s off-goal. Off-goal is
              fine, as long as you know.
            </p>
          </div>
        )}
        {tops.length > 0 && (
          <ul className="goal-list">
            {tops.map((g, i) => (
              <GoalCard key={g.id} g={g} rank={i} count={tops.length} week={stats.rolled.get(g.id) ?? zero}
                ever={stats.everRolled.get(g.id) ?? zero} open={stats.openRolled.get(g.id) ?? 0} onTasks={() => showTasks(g.id)}
                adding={addingSub} setAdding={setAddingSub} />
            ))}
          </ul>
        )}
        {adding ? (
          <div className="gcard editing new">
            <GoalForm onCancel={() => setAdding(false)} onSave={v => {
              const g = makeGoal(v);
              const undo = changeGoals(addGoal(g));
              setAdding(false);
              toast(`New goal · ${shortTitle(g.title, 34)}`, undo);
            }} />
          </div>
        ) : (
          <div className="acts gadd">
            <button type="button" className={'btn sm ' + (tops.length ? 'sec' : 'pri')} disabled={full} onClick={() => setAdding(true)}><PlusIcon size={13} />Add a goal</button>
            {full ? <span className="note">That’s {MAX_ACTIVE}, the most at once. Achieve or drop one first, or make it a sub-goal of one.</span>
              : tops.length >= FOCUS_GOALS ? <span className="note">{FOCUS_GOALS} is plenty: the fewer goals, the more each one moves. Break one down into sub-goals instead.</span> : null}
          </div>
        )}
      </section>

      <section className="goff" aria-labelledby="goff-h">
        <div className="goff-h">
          <span className="dot none" />
          <h3 id="goff-h">Off-goal</h3>
          <span className="spacer" />
          <button type="button" className="btn text sm" onClick={() => showTasks('')}>Its tasks</button>
        </div>
        <p className="note num">
          {offTime ? `${fmtDur(offTime)} this week` : 'Nothing this week'} · {stats.open.get('') ?? 0} open.
          {' '}Errands, admin and favours for others live here. Fine, as long as it’s a choice.
        </p>
      </section>

      {closed.length > 0 && (
        <section aria-label="Achieved and dropped">
          <button type="button" className="gh-t gclosed-t" aria-expanded={showClosed} onClick={() => setShowClosed(o => !o)}>
            Achieved and dropped<span className="gh-n num">{closed.length}</span><ChevronDown />
          </button>
          {showClosed && (
            <ul className="gclosed">
              {closed.map(g => (
                <li key={g.id}>
                  <span className={'loz' + (g.status === 'achieved' ? ' hot' : '')}>{g.status === 'achieved' ? 'Achieved' : 'Dropped'}</span>
                  <span className="ell">{g.parent ? <span className="muted">{shortTitle(byId.get(g.parent)?.title ?? '', 24)} › </span> : null}{g.title}</span>
                  <span className="muted sm num">{resultsLine(g) ?? ''}</span>
                  <span className="spacer" />
                  <button type="button" className="btn text sm" disabled={full && !g.parent} onClick={() => changeGoals(setGoalStatus(g.id, 'active'))}>Bring back</button>
                  <button type="button" className="btn text sm warn" onBlur={() => setArmed(a => (a === g.id ? null : a))} onClick={() => {
                    if (armed !== g.id) { setArmed(g.id); return; }
                    const undo = changeGoals(removeGoal(g.id));
                    toast(`Deleted · ${shortTitle(g.title, 34)}. Its tasks are off-goal.`, undo);
                  }}>{armed === g.id ? `${wide ? 'Click' : 'Tap'} again to delete` : 'Delete'}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
