'use client';

import { useEffect, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur } from '@/lib/format';
import { DEFAULT_LENS, lensIds, sameLens } from '@/lib/labels';
import { M_FOLD, matrixLayout } from '@/lib/layout';
import { usePlanner, useLists } from './Planner';
import { prefersReducedMotion } from './hooks';
import { CalendarPlusIcon, CheckIcon, XIcon } from './icons';

const SHORT: Record<number, string> = { 1: 'Urg.', 2: 'Imp.', 3: 'Later' };
/** The most tasks a cell shows before the rest go behind "+N more". */
const CAP = 4;
const tint = (color: string | null) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

interface Row { id: string; name: string; color: string | null; tasks: Task[] }

/** One backlog task in a cell: tick it, drag it to the calendar or another cell, click then click a time, double-click to edit. */
function Chip({ t, cards }: { t: Task; cards: boolean }) {
  const { done, completing, picked, setPicked, openEditor, drag, now, slot } = usePlanner();
  const finishing = completing.has(t.id);
  const lifting = drag.view?.id === t.id && drag.view.kind === 'row';
  const due = t.due ? dueLabel(t.due, now) : null;
  return (
    <div className={'tk' + (finishing ? ' done' : '') + (picked === t.id ? ' picked' : '') + (lifting ? ' lifting' : '')}>
      <button type="button" className="ck" aria-label={`Mark done: ${t.title}`} onClick={() => { if (!finishing) done(t.id, true); }}>
        <span><CheckIcon size={9} /></span>
      </button>
      <button type="button" className="tk-main" aria-pressed={picked === t.id}
        title="Drag onto the calendar or another cell, or click, then click a time. Double-click to edit."
        onPointerDown={e => drag.begin(e, 'row', t.id)}
        onClick={() => { if (!drag.ignoreClick()) setPicked(picked === t.id ? null : t.id); }}
        onDoubleClick={() => { setPicked(null); openEditor(t.id); }}
        onKeyDown={e => { if (e.key === 'e' || e.key === 'E') { e.preventDefault(); openEditor(t.id); } }}>
        <span className="tk-t">{t.title}</span>
        {cards && <span className="tk-m">{due ? <span className={due.hot ? 'hot' : undefined}>{due.text}</span> : 'Anytime'} · {fmtDur(t.minutes)}</span>}
      </button>
      {cards && (
        <button type="button" className="sched" aria-label={`Put in the next free slot: ${t.title}`} title="Next free slot" onClick={() => slot(t.id)}>
          <CalendarPlusIcon size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * The laptop backlog as a matrix: a row per label, a column per priority in the lens. Room decides how it's drawn
 * (cards, titles, then counts or folded columns), never what's in it: every number opens its tasks.
 */
export function Matrix() {
  const { prefs, lens, setLens, split, labelOf, focusLabel, setFocusLabel, drag, store } = usePlanner();
  const { backlog, outside } = useLists();
  const [peek, setPeek] = useState<{ l: string; p: number } | null>(null);
  const peekRef = useRef<HTMLElement>(null);
  // An opened cell can sit below the fold of a narrow backlog: bring its tasks into view.
  useEffect(() => { if (peek) peekRef.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); }, [peek]);
  const cols = [1, 2, 3].filter(p => p <= lens.pri);
  const lay = matrixLayout(split.matrixW, cols, prefs.tight);
  const ids = lensIds(lens, prefs.labels);
  const defs = [...prefs.labels.map(l => ({ id: l.id, name: l.name, color: l.color as string | null })), { id: '', name: 'No label', color: null }]
    .filter(r => ids.includes(r.id));
  const rows: Row[] = defs.map(d => ({ ...d, tasks: backlog.filter(t => (labelOf(t)?.id ?? '') === d.id) }));
  const shown = rows.filter(r => r.tasks.length);
  const quiet = rows.filter(r => !r.tasks.length).map(r => r.name);
  const grid = { gridTemplateColumns: `${lay.headW}px` + (lay.open.length ? ` repeat(${lay.open.length}, minmax(0, 1fr))` : '') + (lay.folded.length ? ` repeat(${lay.folded.length}, ${M_FOLD}px)` : '') };
  const target = drag.view && drag.view.kind !== 'resize' ? drag.view.cell : null;
  const peekRow = peek ? shown.find(r => r.id === peek.l) : undefined;
  const peekTasks = peekRow ? peekRow.tasks.filter(t => t.priority === peek!.p) : [];
  const everything = sameLens(lens, DEFAULT_LENS, prefs.labels);
  const note = [
    quiet.length ? `Nothing here for ${quiet.join(', ')}.` : '',
    outside ? `${outside} more outside this view.` : '',
  ].filter(Boolean).join(' ');
  const how = lay.folded.length ? `${lay.folded.map(p => PRI[p as 1 | 2 | 3]).join(' and ')} folded: click a number`
    : { cards: '', titles: 'Titles only', counts: 'Counts: click one to see its tasks' }[lay.density];

  const countCell = (r: Row, p: number, fold: boolean) => {
    const n = r.tasks.filter(t => t.priority === p).length;
    const open = peek?.l === r.id && peek.p === p;
    const key = `${r.id}|${p}`;
    return (
      <div key={key} className={'mx-cell' + (fold ? ' fold' : '') + (target === key ? ' over' : '')} data-cell={key}>
        <button type="button" className="mx-count" aria-expanded={open} disabled={!n} style={{ '--heat': `${Math.min(14 + 12 * n, 50)}%` } as React.CSSProperties}
          aria-label={`${r.name}, ${PRI[p as 1 | 2 | 3]}: ${n} ${n === 1 ? 'task' : 'tasks'}`} onClick={() => setPeek(open ? null : { l: r.id, p })}>
          {n || '–'}
        </button>
      </div>
    );
  };

  if (!backlog.length) {
    if (!store.loaded) return null;
    return (
      <p className="empty in">
        {everything ? 'Nothing waiting. Mention a day or time and it goes on the calendar; anything else waits here.' : 'Nothing in this view.'}
        {!everything && <> <button type="button" className="link inline" onClick={() => setLens(DEFAULT_LENS)}>Show everything</button></>}
      </p>
    );
  }

  return (
    <section className="mx" aria-label="Backlog by label and priority">
      <div className="mx-top">
        <span>Backlog · {backlog.length}</span>
        {how && <em>{how}</em>}
      </div>
      <div className={'mx-h' + (lay.density === 'counts' ? ' tight' : '')} style={grid}>
        <span>Type of work</span>
        {lay.open.map(p => (
          <div key={p} title={PRI[p as 1 | 2 | 3]}>
            {p === 1 && <i aria-hidden="true" />}<b>{PRI[p as 1 | 2 | 3]}</b>
            {lay.density !== 'counts' && <em>{backlog.filter(t => t.priority === p).length}</em>}
          </div>
        ))}
        {lay.folded.map(p => <div key={p} className="fold" title={`${PRI[p as 1 | 2 | 3]}, folded to make room`}>{SHORT[p]}</div>)}
      </div>
      {shown.map(r => {
        const mins = r.tasks.reduce((a, t) => a + t.minutes, 0);
        return (
          <div key={r.id || '-'} className={'mx-row' + (focusLabel != null && focusLabel !== r.id ? ' dim' : '')} style={{ ...grid, ...tint(r.color) }}>
            <button type="button" className={'mx-lab' + (r.color ? '' : ' none')} aria-pressed={focusLabel === r.id}
              title="Spotlight this label here and on the calendar" onClick={() => setFocusLabel(focusLabel === r.id ? null : r.id)}>
              <b>{r.name}</b><span>{r.tasks.length} · {fmtDur(mins)}</span>
            </button>
            {lay.open.map(p => {
              if (lay.density === 'counts') return countCell(r, p, false);
              const list = r.tasks.filter(t => t.priority === p);
              const key = `${r.id}|${p}`;
              const more = list.length - CAP;
              return (
                <div key={key} className={'mx-cell' + (target === key ? ' over' : '')} data-cell={key}>
                  {list.slice(0, more > 0 ? CAP - 1 : CAP).map(t => <Chip key={t.id} t={t} cards={lay.density === 'cards'} />)}
                  {more > 0 && <button type="button" className="mx-more" onClick={() => setPeek({ l: r.id, p })}>+{more + 1} more</button>}
                </div>
              );
            })}
            {lay.folded.map(p => countCell(r, p, true))}
          </div>
        );
      })}
      {peekRow && peekTasks.length > 0 && (
        <section ref={peekRef} className="mx-peek" style={tint(peekRow.color)} aria-label={`${peekRow.name}, ${PRI[peek!.p as 1 | 2 | 3]}`}>
          <div className="mx-peek-h">
            <i aria-hidden="true" /><b>{peekRow.name} · {PRI[peek!.p as 1 | 2 | 3]}</b>
            <button type="button" className="ib" aria-label="Close" onClick={() => setPeek(null)}><XIcon /></button>
          </div>
          {peekTasks.map(t => <Chip key={t.id} t={t} cards />)}
        </section>
      )}
      {note && (
        <p className="mx-note">
          {note} {!everything && <button type="button" className="link inline" onClick={() => setLens(DEFAULT_LENS)}>Show everything</button>}
        </p>
      )}
    </section>
  );
}
