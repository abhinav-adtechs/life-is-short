'use client';

import { useMemo, useState } from 'react';
import {
  MAX_ACTIVE, MAX_GOAL_DEPTH, addGoal, ancestorsOf, archivedGoals, goalProgress, goalTree, makeGoal, mergeResults, moveGoal,
  patchGoal, rootOf, treeTasks, type Goal,
} from '@/lib/goals';
import { shortDate, shortTitle } from '@/lib/format';
import { fromYmd } from '@/lib/time';
import { usePlanner, useLists } from './Planner';
import { DeleteGoal, GoalForm, GoalWide, NewResult, Progress, Results, Said, daysLeft, type Adding } from './Goals';
import { RouteList } from './Route';
import { GoalMap } from './Flow';
import { NO_ROOM, useArchiveActs } from './Archive';
import { TaskRow } from './Matrix';
import { useTodayGoals } from './Today';
import { ArchiveIcon, CheckIcon, ChevronDown, ChevronUp, MapIcon, PlusIcon, RouteIcon, TargetIcon, XIcon } from './icons';

/*
 * The Goals view: every goal on the left (the one you open shows its sub-goals under it; achieved and dropped ones
 * under Archived), and the open goal on the right, as its route or its map. The map stays in the right-hand pane so
 * the list is always there to jump to another goal. The backlog opens beside the list: drag a task onto the goal.
 */

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/* ---------- the list ---------- */

function ListRow({ g, depth, rank, sel, today }: { g: Goal; depth: number; rank?: number; sel: boolean; today?: boolean }) {
  const { prefs, goals, tasks, openGoal } = usePlanner();
  const index = new Map(goals.map(x => [x.id, x]));
  const section = prefs.labels.find(l => l.id === rootOf(index, g).section) ?? null;
  const t = treeTasks(goals, tasks, g.id);
  const pct = t.all ? Math.round((t.done / t.all) * 100) : null;
  return (
    <li>
      <button type="button" className={'gv-row' + (sel ? ' sel' : '') + (depth ? ' sub' : '')} style={{ ...tint(section?.color), '--d': depth } as React.CSSProperties}
        aria-current={sel ? 'true' : undefined} onClick={() => openGoal(g.id)}>
        {depth ? <span className="gv-in" aria-hidden="true">›</span> : <span className="goal-n num" aria-hidden="true">{rank}</span>}
        <span className="gv-t">{g.title}</span>
        {today && <span className="gc-today">Today</span>}
        <span className="gv-pct num">{pct == null ? '' : `${pct}%`}</span>
      </button>
    </li>
  );
}

function GoalList({ sel, onAdd, adding, backlog, onBacklog }: { sel: Goal | null; onAdd: () => void; adding: boolean; backlog: boolean; onBacklog: () => void }) {
  const { goals, topGoals, openGoal } = usePlanner();
  const { backlog: open } = useLists();
  const inFocus = useTodayGoals();
  const index = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const archived = useMemo(() => archivedGoals(goals), [goals]);
  const [tab, setTab] = useState<'active' | 'archived'>(() => (sel && sel.status !== 'active' ? 'archived' : 'active'));
  // The open goal's own tree: its top goal's sub-goals, open ones.
  const top = sel && sel.status === 'active' ? rootOf(index, sel) : null;
  const subs = top ? goalTree(goals, g => g.status === 'active').filter(x => x.goal.id !== top.id && rootOf(index, x.goal).id === top.id) : [];
  const full = topGoals.length >= MAX_ACTIVE;
  return (
    <aside className="gv-list panel" aria-label="Your goals">
      <div className="gv-tabs" role="tablist" aria-label="Which goals">
        <button type="button" role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>Active <span className="num">{topGoals.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'archived'} onClick={() => setTab('archived')}><ArchiveIcon size={13} />Archived <span className="num">{archived.length}</span></button>
      </div>
      <div className="gv-scroll">
        {tab === 'active' ? (
          topGoals.length ? (
            <ul className="gv-l">
              {topGoals.map((g, i) => (
                <ListRowGroup key={g.id} g={g} rank={i + 1} sel={sel} open={top?.id === g.id} subs={subs} today={inFocus.has(g.id)} />
              ))}
            </ul>
          ) : <p className="note gv-none">No goals yet. Add the four or five outcomes that matter most right now.</p>
        ) : archived.length ? (
          <ul className="gv-l">
            {archived.map(g => (
              <li key={g.id}>
                <button type="button" className={'gv-row arch' + (sel?.id === g.id ? ' sel' : '')} aria-current={sel?.id === g.id ? 'true' : undefined} onClick={() => openGoal(g.id)}>
                  <span className={'loz' + (g.status === 'achieved' ? ' hot' : '')}>{g.status === 'achieved' ? 'Done' : 'Dropped'}</span>
                  <span className="gv-t">{g.parent ? <span className="muted">{shortTitle(index.get(g.parent)?.title ?? '', 18)} › </span> : null}{g.title}</span>
                  <span className="gv-pct num muted">{g.closedAt ? new Date(g.closedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="note gv-none">Nothing archived yet. Press <b>Done</b> on a goal and it comes here.</p>}
      </div>
      <div className="gv-foot">
        <button type="button" className="btn sec sm" disabled={full || adding} title={full ? `${MAX_ACTIVE} goals at once is the most` : undefined} onClick={() => { setTab('active'); onAdd(); }}><PlusIcon size={13} />Add a goal</button>
        <span className="spacer" />
        <button type="button" className={'btn text sm' + (backlog ? ' on' : '')} aria-pressed={backlog} onClick={onBacklog}>Backlog <span className="muted num">{open.length}</span></button>
      </div>
    </aside>
  );
}

function ListRowGroup({ g, rank, sel, open, subs, today }: { g: Goal; rank: number; sel: Goal | null; open: boolean; subs: { goal: Goal; depth: number }[]; today: boolean }) {
  return (
    <>
      <ListRow g={g} depth={0} rank={rank} sel={sel?.id === g.id} today={today} />
      {open && subs.map(x => <ListRow key={x.goal.id} g={x.goal} depth={x.depth} sel={sel?.id === x.goal.id} />)}
    </>
  );
}

/* ---------- the backlog, to drag onto a goal ---------- */

function Backlog({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { backlog } = useLists();
  return (
    <aside className="gv-bl panel" aria-label="Backlog">
      <div className="gv-blh">
        <b>Backlog</b><span className="muted sm num">{backlog.length} open</span><span className="spacer" />
        <button type="button" className="ib bare" aria-label="Close the backlog" onClick={onClose}><XIcon size={13} /></button>
      </div>
      <p className="note gv-blhint">{goal && goal.status === 'active' ? <>Drag a task onto <b>{shortTitle(goal.title, 40)}</b> to put it on that goal.</> : 'Open a goal, then drag tasks onto it.'}</p>
      <div className="gv-bls">
        {backlog.length ? backlog.map(t => <TaskRow key={t.id} t={t} kind="open" delay="0ms" />) : <p className="note">Nothing in the backlog.</p>}
      </div>
    </aside>
  );
}

/* ---------- the open goal ---------- */

function Pane({ g, mode, setMode }: { g: Goal; mode: 'route' | 'map'; setMode: (m: 'route' | 'map') => void }) {
  const { goals, tasks, prefs, now, changeGoals, closeGoal, openGoal, openSheet, drag, topGoals, toast } = usePlanner();
  const acts = useArchiveActs(g);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newKr, setNewKr] = useState(false);
  const [adding, setAdding] = useState<Adding>(null);
  const index = new Map(goals.map(x => [x.id, x]));
  const up = ancestorsOf(index, g).reverse();
  const top = rootOf(index, g);
  const section = prefs.labels.find(l => l.id === top.section) ?? null;
  const left = g.by ? daysLeft(g.by, now) : null;
  const t = treeTasks(goals, tasks, g.id);
  const progress = goalProgress(g, goals);
  const depth = up.length;
  const rank = !g.parent && g.status === 'active' ? topGoals.findIndex(x => x.id === g.id) : -1;
  const accepts = g.status === 'active' && mode === 'route';
  const over = accepts && drag.view && drag.view.kind !== 'resize' && drag.view.cell === `${g.id}|*`;

  return (
    <section className={'gv-pane panel' + (over ? ' over' : '') + (mode === 'map' ? ' map' : '')} style={tint(section?.color)} aria-label={g.title}
      data-cell={accepts ? `${g.id}|*` : undefined}>
      <header className="gv-ph">
        <div className="gv-crumbs">
          {up.map(a => <span key={a.id}><button type="button" className="link sm" onClick={() => openGoal(a.id)}>{shortTitle(a.title, 28)}</button><span aria-hidden="true"> › </span></span>)}
        </div>
        <div className="gv-title">
          <span className="dot" />
          <h2>{g.title}</h2>
          {acts.closed && <span className="loz"><ArchiveIcon size={11} />{acts.when}</span>}
          <span className="spacer" />
          <div className="gv-seg" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={mode === 'route'} onClick={() => setMode('route')}><RouteIcon size={13} />Route</button>
            <button type="button" role="tab" aria-selected={mode === 'map'} onClick={() => setMode('map')}><MapIcon size={13} />Map</button>
          </div>
        </div>
        <p className="gv-meta muted sm num">
          {[section?.name, g.by && left ? `By ${shortDate(fromYmd(g.by).getTime(), now)} · ${left.text}` : null, t.all ? `${t.done} of ${t.all} tasks done` : 'No tasks yet'].filter(Boolean).join(' · ')}
          <Progress value={progress} label={g.title} />
        </p>
        <div className="gv-acts">
          {acts.closed ? (
            acts.noRoom ? <span className="muted sm">{NO_ROOM}</span>
              : <button type="button" className="btn sec sm" onClick={() => { const r = acts.bringBack(); if (r) toast(r.said, r.undo); }}>Bring back</button>
          ) : (
            <>
              <button type="button" className="btn sec sm" onClick={() => closeGoal(g.id, 'achieved')} title="Mark it done: it goes to the archive"><CheckIcon size={13} w={2.2} />Done</button>
              <button type="button" className="btn text sm" onClick={() => setEditing(e => !e)} aria-pressed={editing}>Edit</button>
              <button type="button" className="btn text sm" onClick={() => closeGoal(g.id, 'dropped')}>Drop</button>
            </>
          )}
          <button type="button" className="btn text sm warn" aria-expanded={deleting} onClick={() => setDeleting(d => !d)}>Delete</button>
          {rank >= 0 && (
            <>
              <span className="spacer" />
              <button type="button" className="ib bare" aria-label={`Move ${g.title} up`} disabled={rank === 0} onClick={() => changeGoals(moveGoal(g.id, -1))}><ChevronUp /></button>
              <button type="button" className="ib bare" aria-label={`Move ${g.title} down`} disabled={rank === topGoals.length - 1} onClick={() => changeGoals(moveGoal(g.id, 1))}><ChevronDown /></button>
            </>
          )}
        </div>
        {deleting && <DeleteGoal g={g} onCancel={() => setDeleting(false)} />}
      </header>

      {mode === 'map' ? (
        <div className="gv-map">
          <GoalMap goal={g} embed={{ onClose: () => setMode('route'), onOpen: id => openGoal(id), onFull: () => openSheet('flow', g.id) }} />
        </div>
      ) : (
        <div className="gv-body">
          {editing ? (
            <div className="gcard editing">
              <GoalForm goal={g} onCancel={() => setEditing(false)} onSave={v => {
                changeGoals(patchGoal(g.id, { title: v.title.replace(/\s+/g, ' ').trim(), ...(g.parent ? {} : { section: v.section }), results: mergeResults(g.results, v.results), by: v.by }));
                setEditing(false);
              }} />
            </div>
          ) : (
            <section className="gv-done" aria-label="Done when">
              <h3 className="gv-sh">Done when</h3>
              {g.results.length > 0 && <Results g={g} list={g.results} depth={0} adding={adding} setAdding={setAdding} goalDepth={depth} />}
              {newKr ? <NewResult g={g} under={null} onDone={() => setNewKr(false)} /> : !acts.closed && (
                <div className="kr-adds">
                  <button type="button" className="link sm kr-add" onClick={() => setNewKr(true)}><PlusIcon size={11} />{g.results.length ? 'Key result' : 'Say what done means: a key result'}</button>
                  {depth < MAX_GOAL_DEPTH && <button type="button" className="link sm kr-add" onClick={() => setAdding({ parent: g.id, kr: null })}><PlusIcon size={11} />Sub-goal</button>}
                </div>
              )}
              <GoalWide g={g} depth={depth} adding={adding} setAdding={setAdding} />
            </section>
          )}
          <section className="gv-route" aria-label="Route">
            <h3 className="gv-sh">Route</h3>
            <RouteList goal={g} onMap={id => { openGoal(id); setMode('map'); }} />
          </section>
          {over && <p className="gv-drop" aria-hidden="true">Drop to put it on {shortTitle(g.title, 40)}</p>}
        </div>
      )}
    </section>
  );
}

/** A new goal, in the pane. */
function NewGoal({ onDone }: { onDone: () => void }) {
  const { changeGoals, openGoal, toast } = usePlanner();
  return (
    <section className="gv-pane panel" aria-label="New goal">
      <div className="gv-body">
        <h2 className="gv-newh">A new goal</h2>
        <div className="gcard editing new">
          <GoalForm onCancel={onDone} onSave={v => {
            const g = makeGoal(v);
            const undo = changeGoals(addGoal(g));
            toast(`New goal · ${shortTitle(g.title, 34)}`, undo);
            openGoal(g.id);
            onDone();
          }} />
        </div>
      </div>
    </section>
  );
}

export function GoalsView() {
  const { topGoals, goalById, openGoalId, goalsLoaded, toast } = usePlanner();
  const [mode, setMode] = useState<'route' | 'map'>('route');
  const [backlog, setBacklog] = useState(false);
  const [adding, setAdding] = useState(false);
  const picked = goalById(openGoalId);
  const sel = picked ?? topGoals[0] ?? null;
  const said = useMemo(() => (r: { said: string; undo: () => void }) => toast(r.said, r.undo), [toast]);
  return (
    <Said.Provider value={said}>
      <div className={'gv' + (backlog ? ' with-bl' : '')}>
        <GoalList sel={adding ? null : sel} adding={adding} onAdd={() => setAdding(true)} backlog={backlog} onBacklog={() => setBacklog(b => !b)} />
        {backlog && <Backlog goal={sel} onClose={() => setBacklog(false)} />}
        {adding ? <NewGoal onDone={() => setAdding(false)} />
          : sel ? <Pane key={sel.id} g={sel} mode={mode} setMode={setMode} />
          : goalsLoaded && (
            <section className="gv-pane panel gv-empty">
              <span className="gempty-i"><TargetIcon size={20} /></span>
              <p><b>Pick the four or five outcomes that matter most right now.</b></p>
              <p className="note">Make each one specific enough to finish, and say what “done” means: its key results. Then every task either moves a goal or it’s off-goal.</p>
              <button type="button" className="btn pri sm" onClick={() => setAdding(true)}><PlusIcon size={13} />Add a goal</button>
            </section>
          )}
      </div>
    </Said.Provider>
  );
}

