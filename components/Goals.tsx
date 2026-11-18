'use client';

import { useId, useMemo, useState } from 'react';
import type { Task } from '@/lib/model';
import { isEvent } from '@/lib/select';
import {
  FOCUS_GOALS, GOAL_TITLE_MAX, MAX_ACTIVE, MAX_RESULTS, RESULT_MAX, makeGoal, moveGoal, newResultId, patchGoal, removeGoal, resultsLine,
  setGoalStatus, tallyGoals, onGoalShare, addGoal, type Goal, type GoalTally,
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
 * as off-goal.
 */
export function useGoalWeek() {
  const { tasks, now, prefs, goalById, isOff } = usePlanner();
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
    return { week, last, ever, open, share: onGoalShare(week), lastShare: onGoalShare(last) };
  }, [tasks, now, prefs.weekStart, goalById, isOff]);
}

const zero: GoalTally = { spent: 0, planned: 0, done: 0 };

/* ---------- picking a goal for a task ---------- */

/** Your active goals, or off-goal, as a row of chips. A goal you've achieved or dropped shows while it's picked. */
export function GoalPicker({ value, onChange, labelledBy }: { value: string | null; onChange: (id: string | null) => void; labelledBy: string }) {
  const { activeGoals, goalById, prefs } = usePlanner();
  const cur = value ? goalById(value) : null;
  const shown = cur && cur.status !== 'active' ? [...activeGoals, cur] : activeGoals;
  const color = (g: Goal) => prefs.labels.find(l => l.id === g.section)?.color ?? null;
  return (
    <div className="chips goal-chips" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={radioKeys}>
      {shown.map(g => (
        <button key={g.id} type="button" className="chipb gchip" {...radio(cur?.id === g.id)} title={g.title} onClick={() => onChange(g.id)}>
          <span className={'dot' + (color(g) ? '' : ' none')} style={tint(color(g))} />
          <span className="ell">{g.title}</span>
          {g.status !== 'active' && <span className="muted sm">{g.status}</span>}
        </button>
      ))}
      <button type="button" className="chipb gchip off" {...radio(!cur)} onClick={() => onChange(null)}><span className="dot none" />Off-goal</button>
    </div>
  );
}

/* ---------- a goal, to write or change ---------- */

function GoalForm({ goal, onSave, onCancel }: {
  goal?: Goal; onSave: (v: { title: string; section: string | null; results: string[]; by: string | null }) => void; onCancel: () => void;
}) {
  const { prefs } = usePlanner();
  const id = useId();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [section, setSection] = useState<string | null>(goal?.section ?? prefs.labels[0]?.id ?? null);
  const [results, setResults] = useState(goal?.results.map(r => r.text).join('\n') ?? '');
  const [by, setBy] = useState(goal?.by ?? '');
  const ok = title.trim().length > 0;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    onSave({ title, section, results: results.split('\n').map(s => s.trim()).filter(Boolean).slice(0, MAX_RESULTS), by: by || null });
  };
  return (
    <form className="gform" onSubmit={save} autoComplete="off"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <div className="fld">
        <label htmlFor={`${id}-t`}>Goal</label>
        <input id={`${id}-t`} type="text" value={title} maxLength={GOAL_TITLE_MAX} autoFocus enterKeyHint="next"
          placeholder="Specific enough to finish: “Close the seed round”" onChange={e => setTitle(e.target.value)} />
      </div>
      {prefs.labels.length > 0 && (
        <div className="fld">
          <span className="flabel" id={`${id}-s`}>Section</span>
          <LabelPicker labelledBy={`${id}-s`} value={section} onChange={setSection} none="None" />
        </div>
      )}
      <div className="fld">
        <label htmlFor={`${id}-r`}>Done when</label>
        <textarea id={`${id}-r`} rows={3} value={results} maxLength={MAX_RESULTS * (RESULT_MAX + 1)}
          placeholder={'One per line, each something you can tick:\nTerm sheet signed\nMoney in the bank'} onChange={e => setResults(e.target.value)} />
      </div>
      <div className="two">
        <div className="fld"><label htmlFor={`${id}-b`}>By</label><input id={`${id}-b`} type="date" value={by} onChange={e => setBy(e.target.value)} /></div>
        <div className="fld" />
      </div>
      <div className="acts">
        <button type="submit" className="btn pri sm" disabled={!ok}>{goal ? 'Save' : 'Add goal'}</button>
        <button type="button" className="btn text sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------- one goal ---------- */

function daysLeft(by: string, now: number) {
  const d = Math.round((fromYmd(by).getTime() - startOfDay(now).getTime()) / DAY_MS);
  return d < 0 ? { text: `${-d} day${d === -1 ? '' : 's'} over`, hot: true } : d === 0 ? { text: 'today', hot: true } : { text: `${d} day${d === 1 ? '' : 's'} left`, hot: d <= 7 };
}

function GoalCard({ g, rank, count, week, ever, open, onTasks }: {
  g: Goal; rank: number; count: number; week: GoalTally; ever: GoalTally; open: number; onTasks: () => void;
}) {
  const { prefs, changeGoals, toast, now, wide, openSheet } = usePlanner();
  const [editing, setEditing] = useState(false);
  const steps = useFlowCount(g);
  const section = prefs.labels.find(l => l.id === g.section) ?? null;
  const left = g.by ? daysLeft(g.by, now) : null;
  const ticked = g.results.filter(r => r.done).length;

  if (editing) {
    return (
      <li className="gcard editing" style={tint(section?.color)}>
        <GoalForm goal={g} onCancel={() => setEditing(false)} onSave={v => {
          // A key result kept word for word keeps its tick.
          const results = v.results.map(text => g.results.find(r => r.text === text) ?? { id: newResultId(), text, done: false });
          changeGoals(patchGoal(g.id, { title: v.title.replace(/\s+/g, ' ').trim(), section: v.section, results, by: v.by }));
          setEditing(false);
        }} />
      </li>
    );
  }

  const tick = (id: string) => changeGoals(patchGoal(g.id, { results: g.results.map(r => (r.id === id ? { ...r, done: !r.done } : r)) }));
  const close = (status: 'achieved' | 'dropped') => {
    const undo = changeGoals(setGoalStatus(g.id, status));
    const tail = open ? ` Its ${open} open task${open === 1 ? ' is' : 's are'} off-goal now.` : '';
    // Bring it back from the list below while the panel is open, or with Undo once it's closed.
    toast(`${status === 'achieved' ? 'Achieved' : 'Dropped'} · ${shortTitle(g.title, 30)}.${tail}`, undo);
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
      <h4 className="goal-t">{g.title}</h4>
      {g.results.length > 0 && (
        <ul className="krs" aria-label={`Done when, ${ticked} of ${g.results.length}`}>
          {g.results.map(r => (
            <li key={r.id}>
              <button type="button" className={'kr' + (r.done ? ' on' : '')} role="checkbox" aria-checked={r.done} onClick={() => tick(r.id)}>
                <span className="kbox"><CheckIcon size={10} w={2.6} /></span><span>{r.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="goal-m">
        <span>This week <b className="num">{week.spent ? fmtDur(week.spent) : 'nothing yet'}</b>{week.planned > 0 && <span className="muted"> · {fmtDur(week.planned)} planned</span>}</span>
        <span className="muted num">{open} open{ever.spent ? ` · ${fmtDur(ever.spent)} all told` : ''}</span>
      </div>
      <div className="goal-acts">
        <button type="button" className="btn sec sm" onClick={() => openSheet('flow', g.id)} title="Its steps as a flow chart">
          Flow chart{steps.blocked ? <span className="muted num"> · {steps.blocked} blocked</span> : null}
        </button>
        <button type="button" className="btn text sm" onClick={onTasks}>{wide ? 'Its tasks' : 'Tasks'}</button>
        <button type="button" className="btn text sm" onClick={() => setEditing(true)}>Edit</button>
        <span className="spacer" />
        <button type="button" className="ib bare" aria-label={`Move ${g.title} up`} disabled={rank === 0} onClick={() => changeGoals(moveGoal(g.id, -1))}><ChevronUp /></button>
        <button type="button" className="ib bare" aria-label={`Move ${g.title} down`} disabled={rank === count - 1} onClick={() => changeGoals(moveGoal(g.id, 1))}><ChevronDown /></button>
        <button type="button" className="btn text sm" onClick={() => close('achieved')}><CheckIcon size={12} />Achieved</button>
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
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  // Deleting a goal can't be undone from here (the panel covers the toast), so it takes a second click.
  const [armed, setArmed] = useState<string | null>(null);
  const closed = goals.filter(g => g.status !== 'active').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const onTime = activeGoals.reduce((n, g) => n + (stats.week.get(g.id)?.spent ?? 0), 0);
  const offTime = stats.week.get('')?.spent ?? 0;
  const full = activeGoals.length >= MAX_ACTIVE;

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
            <WeekBar goals={activeGoals} week={stats.week} />
            <p className="note">Tick off a task on a goal, or sit through a meeting that moves one, and it shows here.</p>
          </>
        ) : (
          <>
            <p className="gweek-big"><b className="num">{pct(stats.share)}</b> of your time on goals</p>
            <WeekBar goals={activeGoals} week={stats.week} />
            <p className="note num">
              {fmtDur(onTime)} on goals · {fmtDur(offTime)} off-goal
              {stats.lastShare != null ? ` · ${pct(stats.lastShare)} by this point last week` : ''}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="goals-h">
        <div className="set-h"><h3 id="goals-h">Your goals</h3><span className="muted sm">{activeGoals.length ? `${activeGoals.length} in focus, most important first` : ''}</span></div>
        {!activeGoals.length && goalsLoaded && !adding && (
          <div className="gempty">
            <span className="gempty-i"><TargetIcon size={20} /></span>
            <p><b>Pick the four or five outcomes that matter most right now.</b></p>
            <p className="note">
              Make each one specific enough to finish, and say what “done” means. Then every task either moves a goal or it’s
              off-goal. Off-goal is fine, as long as you know.
            </p>
          </div>
        )}
        {activeGoals.length > 0 && (
          <ul className="goal-list">
            {activeGoals.map((g, i) => (
              <GoalCard key={g.id} g={g} rank={i} count={activeGoals.length} week={stats.week.get(g.id) ?? zero}
                ever={stats.ever.get(g.id) ?? zero} open={stats.open.get(g.id) ?? 0} onTasks={() => showTasks(g.id)} />
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
            <button type="button" className={'btn sm ' + (activeGoals.length ? 'sec' : 'pri')} disabled={full} onClick={() => setAdding(true)}><PlusIcon size={13} />Add a goal</button>
            {full ? <span className="note">That’s {MAX_ACTIVE}, the most at once. Achieve or drop one first.</span>
              : activeGoals.length >= FOCUS_GOALS ? <span className="note">{FOCUS_GOALS} is plenty: the fewer goals, the more each one moves.</span> : null}
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
                  <span className="ell">{g.title}</span>
                  <span className="muted sm num">{resultsLine(g) ?? ''}</span>
                  <span className="spacer" />
                  <button type="button" className="btn text sm" disabled={full} onClick={() => changeGoals(setGoalStatus(g.id, 'active'))}>Bring back</button>
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
