'use client';

import { useId, useMemo, useState } from 'react';
import { MAX_ACTIVE, archivedGoals, descendantsOf, resultsLine, rootOf, setGoalStatus, timeTaken, type Goal } from '@/lib/goals';
import { fmtDur, shortTitle } from '@/lib/format';
import { usePlanner } from './Planner';
import { useGoalWeek } from './Goals';
import { radio, radioKeys } from './Controls';
import { ArchiveIcon, MapIcon, XIcon } from './icons';

/*
 * The archive: every goal you've marked done (or dropped), newest first, a month at a time, with what it took. Open
 * its map to look back over it, bring it back if it isn't done after all, or delete it for good. A sub-goal that
 * closed with its goal is part of that goal's entry, and comes back with it.
 */

type Show = 'all' | 'achieved' | 'dropped';

const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);
const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;

/** "November 2026", or just "November" this year. */
function monthOf(ms: number, now: number) {
  const d = new Date(ms), sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

const dayOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Why a goal can't come back yet. */
export const NO_ROOM = `${MAX_ACTIVE} goals in focus is the most. Mark one done or drop it first.`;

/** Something just changed here, with its Undo: the panel shows it, since the toast's Undo is under the panel. */
interface Said { said: string; undo: () => void }

/** What bringing a goal back says: "Back in your goals · Launch the podcast." */
const backLine = (index: Map<string, Goal>, g: Goal) => {
  const up = g.parent ? index.get(g.parent) : undefined;
  return `Back ${up ? `on ${shortTitle(up.title, 26)}` : 'in your goals'} · ${shortTitle(g.title, 30)}.`;
};

/**
 * Done and Bring back for one goal, as its map and its route page offer them. Neither says anything: the caller shows
 * what it returns, with its Undo, where it can be seen.
 */
export function useArchiveActs(goal: Goal) {
  const { goals, topGoals, changeGoals, closeGoal } = usePlanner();
  const index = new Map(goals.map(g => [g.id, g]));
  const closed = goal.status !== 'active';
  // Bringing it back brings back its top goal too, which needs room among the goals in focus.
  const noRoom = closed && topGoals.length >= MAX_ACTIVE && rootOf(index, goal).status !== 'active';
  const when = closed ? `${goal.status === 'achieved' ? 'Done' : 'Dropped'}${goal.closedAt ? ` ${dayOf(goal.closedAt)}` : ''}` : null;
  const done = () => closeGoal(goal.id, 'achieved', { quiet: true });
  const bringBack = (): Said | null => (closed && !noRoom ? { said: backLine(index, goal), undo: changeGoals(setGoalStatus(goal.id, 'active')) } : null);
  return { closed, noRoom, when, done, bringBack };
}

export function Archive() {
  const { goals, topGoals, changeGoals, deleteGoal, openSheet, prefs, now, wide, goalsLoaded } = usePlanner();
  const { ever } = useGoalWeek();
  const id = useId();
  const [show, setShow] = useState<Show>('all');
  const [q, setQ] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [said, setSaid] = useState<Said | null>(null);

  const index = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const all = useMemo(() => archivedGoals(goals), [goals]);
  const done = all.filter(g => g.status === 'achieved').length;
  const dropped = all.length - done;
  const needle = q.trim().toLowerCase();
  const shown = all.filter(g => (show === 'all' || g.status === show)
    && (!needle || g.title.toLowerCase().includes(needle) || (g.parent && index.get(g.parent)?.title.toLowerCase().includes(needle))));
  const groups: { month: string; list: Goal[] }[] = [];
  for (const g of shown) {
    const month = monthOf(g.closedAt ?? 0, now);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.list.push(g); else groups.push({ month, list: [g] });
  }
  const full = topGoals.length >= MAX_ACTIVE;

  /** What a goal took: its time and tasks done, the goals under it included. */
  const work = (g: Goal) => {
    let spent = 0, n = 0;
    for (const x of [g, ...descendantsOf(goals, g.id)]) { const t = ever.get(x.id); if (t) { spent += t.spent; n += t.done; } }
    return { spent, n };
  };

  const bringBack = (g: Goal) => {
    setSaid({ said: backLine(index, g), undo: changeGoals(setGoalStatus(g.id, 'active')) });
    setArmed(null);
  };

  if (!goalsLoaded) return <p className="note">Opening the archive…</p>;

  return (
    <div className="ar">
      {said && (
        <p className="gundo" role="status">
          <span>{said.said}</span>
          <button type="button" className="link" onClick={() => { said.undo(); setSaid(null); }}>Undo</button>
          <button type="button" className="ib bare" aria-label="Dismiss" onClick={() => setSaid(null)}><XIcon size={11} /></button>
        </p>
      )}

      {!all.length ? (
        <div className="gempty">
          <span className="gempty-i"><ArchiveIcon size={20} /></span>
          <p><b>Nothing here yet.</b></p>
          <p className="note">When a goal’s done, press <b>Done</b> on its card. It comes here with what it took, and its map, so you can look back over it or bring it back.</p>
        </div>
      ) : (
        <>
          <p className="ar-sum">
            <b className="num">{done}</b> {done === 1 ? 'goal' : 'goals'} done{dropped ? <>, <b className="num">{dropped}</b> dropped</> : null}
          </p>
          <div className="ar-bar">
            {done > 0 && dropped > 0 && (
              <div className="chips" role="radiogroup" aria-labelledby={`${id}-f`} onKeyDown={radioKeys}>
                <span id={`${id}-f`} className="sr">Show</span>
                {([['all', 'All', all.length], ['achieved', 'Done', done], ['dropped', 'Dropped', dropped]] as const).map(([v, label, n]) => (
                  <button key={v} type="button" className="chipb" {...radio(show === v)} onClick={() => setShow(v)}>{label}<span className="num ar-n">{n}</span></button>
                ))}
              </div>
            )}
            {all.length > 8 && (
              <input className="ar-find" type="search" value={q} placeholder="Find a goal" aria-label="Find a goal in the archive" onChange={e => setQ(e.target.value)} />
            )}
          </div>

          {!shown.length && <p className="note">Nothing in the archive matches “{q.trim()}”.</p>}

          {groups.map(({ month, list }) => (
            <section key={month} className="ar-g" aria-label={month}>
              <h3 className="ar-mh">{month}</h3>
              <ul className="ar-l">
                {list.map(g => {
                  const top = rootOf(index, g);
                  const section = prefs.labels.find(l => l.id === top.section) ?? null;
                  const up = g.parent ? index.get(g.parent) : undefined;
                  const subs = descendantsOf(goals, g.id).filter(d => d.status === g.status && d.closedAt === g.closedAt).length;
                  const w = work(g);
                  const krs = resultsLine(g);
                  const took = timeTaken(g);
                  // Bringing it back brings back its top goal too, which needs room among the goals in focus.
                  const noRoom = full && top.status !== 'active';
                  const isDone = g.status === 'achieved';
                  return (
                    <li key={g.id} className={'ar-i' + (isDone ? '' : ' dropped')} style={tint(section?.color)}>
                      <div className="ar-ih">
                        <span className={'loz' + (isDone ? ' hot' : '')}>{isDone ? 'Done' : 'Dropped'}</span>
                        <span className="muted sm num">{g.closedAt ? dayOf(g.closedAt) : ''}</span>
                        <span className="spacer" />
                        {section && <span className="ar-sec sm"><span className="dot" />{section.name}</span>}
                      </div>
                      <p className="ar-t">{up && <span className="muted">{shortTitle(up.title, 28)} › </span>}{g.title}</p>
                      <p className="ar-m muted sm num">
                        {[took, krs ? `Key results ${krs}` : null, subs ? plural(subs, 'sub-goal') : null,
                          w.n ? `${plural(w.n, 'task')} done${w.spent ? ` · ${fmtDur(w.spent)}` : ''}` : null].filter(Boolean).join(' · ') || 'Nothing logged on it'}
                      </p>
                      <div className="ar-acts">
                        <button type="button" className="btn text sm" onClick={() => openSheet('flow', g.id)}><MapIcon size={13} />Map</button>
                        <span className="spacer" />
                        <button type="button" className="btn text sm" disabled={noRoom} onClick={() => bringBack(g)}
                          title={noRoom ? NO_ROOM : 'Back among the goals you’re working on'}>Bring back</button>
                        <button type="button" className="btn text sm warn" onBlur={() => setArmed(a => (a === g.id ? null : a))} onClick={() => {
                          if (armed !== g.id) { setArmed(g.id); return; }
                          const r = deleteGoal(g.id, { quiet: true });
                          if (r) setSaid(r);
                          setArmed(null);
                        }}>{armed === g.id ? `${wide ? 'Click' : 'Tap'} again to delete` : 'Delete'}</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
