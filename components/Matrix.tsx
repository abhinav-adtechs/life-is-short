'use client';

import { Fragment, useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import { dueLabel, fmtDur, fmtWhen } from '@/lib/format';
import { describeRepeat, describeRule } from '@/lib/repeat';
import type { Label } from '@/lib/labels';
import { usePlanner, useLists, type Filter } from './Planner';
import { CheckIcon, ChevronDown, RepeatIcon, XIcon } from './icons';

const PRIS: Priority[] = [1, 2, 3];
const tint = (color: string | null | undefined) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/** Rows fade up in a stagger on first load; rows that arrive later rise in on their own. */
function useStagger(step: number, cap: number) {
  const t0 = useRef(performance.now());
  return (i: number) => (performance.now() - t0.current < 1500 ? `${Math.min(i, cap) * step}ms` : '0ms');
}

/** How dark a count cell is: a few tasks barely tint it, ten or more make it the darkest. */
const heat = (n: number) => (n === 0 ? 'var(--bg)' : `color-mix(in srgb, var(--ink) ${n === 1 ? 5 : n < 4 ? 9 : n < 10 ? 14 : 20}%, var(--raised))`);

interface Row { id: string; name: string; color: string | null }

/** The matrix's rows: your labels in order, then No label. */
function useRows(): Row[] {
  const { prefs } = usePlanner();
  return [...prefs.labels.map(l => ({ id: l.id, name: l.name, color: l.color as string | null })), { id: '', name: 'No label', color: null }];
}

const labelName = (labels: Label[], id: string) => labels.find(l => l.id === id)?.name ?? 'No label';

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
  const { plan } = usePlanner();
  const { focus } = useLists();
  if (kind === 'new') return { text: 'New', cls: 'tag' };
  if (plan.ticks.has(t.id)) return { text: 'Tick off', cls: 'tag' };
  if (kind === 'open' && focus.now?.id === t.id) return { text: 'Now', cls: 'tag now' };
  return null;
}

/** A backlog row on a laptop: tick it, click then click a time, drag it to the calendar or another cell, double-click to edit. */
function TaskRow({ t, kind, delay }: { t: Task; kind: Kind; delay: string }) {
  const { completing, picked, setPicked, openEditor, drag, labelOf, now, plan, repeatOf } = usePlanner();
  const tag = useTag(t, kind);
  const label = labelOf(t);
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
        title={kind === 'new' ? 'Proposed in chat. Apply it to add it.' : live ? 'Click, then click a time on the calendar. Or drag it. Double-click to edit.' : 'Edit'}
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
        <span className={'dot' + (label ? '' : ' none')} style={tint(label?.color)} title={label?.name ?? 'No label'} />
        <span className="len num">{fmtDur(t.minutes)}</span>
      </button>
    </div>
  );
}

/** A task in a cell of the full matrix: drag it to another cell to change its label and priority. */
function Chip({ t, kind, delay }: { t: Task; kind: Kind; delay: string }) {
  const { completing, picked, setPicked, openEditor, drag, now, plan, repeatOf } = usePlanner();
  const repeat = repeatOf(t);
  const { focus } = useLists();
  const tag = useTag(t, kind);
  const due = t.due ? dueLabel(t.due, now) : null;
  const lifting = drag.view?.id === t.id && drag.view.kind === 'row';
  const cls = 'chip' + (picked === t.id ? ' picked' : '') + (focus.now?.id === t.id ? ' now' : '') + (plan.ticks.has(t.id) || kind === 'new' ? ' ghosted' : '')
    + (completing.has(t.id) ? ' done' : '') + (lifting ? ' lifting' : '');
  return (
    <button type="button" className={cls} style={{ animationDelay: delay }} disabled={kind === 'new'} aria-pressed={kind === 'new' ? undefined : picked === t.id}
      title={kind === 'new' ? 'Proposed in chat. Apply it to add it.' : 'Drag to another cell or onto the calendar, or click, then click a time. Double-click to edit.'}
      onPointerDown={kind === 'new' ? undefined : e => drag.begin(e, 'row', t.id)}
      onClick={() => { if (!drag.ignoreClick() && kind !== 'new') setPicked(picked === t.id ? null : t.id); }}
      onDoubleClick={() => { if (kind !== 'new') openEditor(t.id); }}
      onKeyDown={e => { if ((e.key === 'e' || e.key === 'E') && kind !== 'new') { e.preventDefault(); openEditor(t.id); } }}>
      <span className="chip-t"><span className="strike">{t.title}</span></span>
      <span className="chip-m">
        {tag && <b className={tag.cls === 'tag now' ? 'hot' : undefined}>{tag.text}</b>}
        <span className="num">{fmtDur(t.minutes)}</span>
        {due && <span className={due.hot ? 'hot' : undefined}>{due.text}</span>}
        {repeat && <span className="rep-g" title={describeRepeat(repeat)}><RepeatIcon size={11} /><span className="sr">{describeRepeat(repeat)}</span></span>}
      </span>
    </button>
  );
}

/* ---------- groups below the matrix ---------- */

/** A sticky heading over a run of rows. Done folds away. */
function GroupHead({ name, count, open, onToggle, action }: {
  name: string; count: number; open?: boolean; onToggle?: () => void; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="gh">
      {onToggle ? (
        <button type="button" className="gh-t" aria-expanded={open} onClick={onToggle}>
          {name}<span className="gh-n num">{count}</span><ChevronDown />
        </button>
      ) : <span className="gh-t">{name}<span className="gh-n num">{count}</span></span>}
      <span className="spacer" />
      {action && <button type="button" className="link" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** What's done, folded to a line. */
function Done({ Item, stagger }: { Item: typeof TaskRow; stagger: (i: number) => string }) {
  const { done } = useLists();
  const [open, setOpen] = useState(false);
  if (!done.length) return null;
  return (
    <>
      <GroupHead name="Done" count={done.length} open={open} onToggle={() => setOpen(o => !o)} />
      {open && done.map((t, i) => <Item key={t.id} t={t} kind="done" delay={stagger(i)} />)}
    </>
  );
}

/** The backlog as a list under the counts: by priority, or just the cell you picked. */
function useGroups() {
  const { filter, plan, labelOf } = usePlanner();
  const { backlog } = useLists();
  const lab = (t: Task) => labelOf(t)?.id ?? '';
  const inCell = (list: Task[], f: Filter) => list.filter(t => lab(t) === f.label && t.priority === f.priority);
  if (filter) return [{ key: 'f', p: filter.priority, items: [...inCell(plan.added, filter).map(t => ({ t, kind: 'new' as Kind })), ...inCell(backlog, filter).map(t => ({ t, kind: 'open' as Kind }))] }];
  return PRIS.map(p => ({
    key: `p${p}`, p,
    items: [...plan.added.filter(t => t.priority === p).map(t => ({ t, kind: 'new' as Kind })), ...backlog.filter(t => t.priority === p).map(t => ({ t, kind: 'open' as Kind }))],
  })).filter(g => g.items.length);
}

/* ---------- the count grid ---------- */

function CountGrid({ phone, head }: { phone?: boolean; head: number }) {
  const { filter, setFilter, drag, labelOf } = usePlanner();
  const { backlog } = useLists();
  const rows = useRows();
  const target = drag.view && drag.view.kind !== 'resize' ? drag.view.cell : null;
  const n = (r: Row, p: Priority) => backlog.filter(t => (labelOf(t)?.id ?? '') === r.id && t.priority === p).length;
  return (
    <div className="mx-grid" style={{ gridTemplateColumns: `${head}px repeat(3, minmax(0, 1fr))` }} role="grid" aria-label="Open tasks by label and priority">
      <span />
      {PRIS.map(p => <span key={p} className="mx-ch">{PRI[p]}</span>)}
      {rows.map(r => (
        <Fragment key={r.id || '-'}>
          <span className="mx-rh"><span className={'dot' + (r.color ? '' : ' none')} style={tint(r.color)} /><span className="ell">{r.name}</span></span>
          {PRIS.map(p => {
            const c = n(r, p), key = `${r.id}|${p}`;
            const sel = filter?.label === r.id && filter.priority === p;
            const aria = `${r.name} · ${PRI[p]} · ${c}`;
            return (
              <button key={key} type="button" className={'mx-n num' + (target === key ? ' over' : '') + (c ? '' : ' zero') + (phone ? ' ph' : '')} data-cell={phone ? undefined : key}
                aria-pressed={sel} aria-label={aria} title={aria} style={{ background: target === key ? undefined : heat(c) }}
                onClick={() => setFilter(sel ? null : { label: r.id, priority: p })}>
                {c || '–'}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

/* ---------- laptop ---------- */

/**
 * The laptop backlog: a label × priority matrix. With the calendar wide, the matrix is counts you click to filter the
 * list under them; with the calendar at half the screen or less, every task sits in its cell. Drag a task between
 * cells to change its label and priority, or onto the calendar to schedule it.
 */
export function MatrixPanel() {
  const { split, filter, setFilter, drag, prefs } = usePlanner();
  const { backlog } = useLists();
  const dropOk = drag.view?.kind === 'block' && drag.view.overBacklog;
  return (
    <section className={'mx panel' + (dropOk ? ' drop-ok' : '')} aria-label="Priority matrix" data-backlog="">
      <div className="mx-h">
        <span className="mx-title">Priority matrix</span>
        <span className="muted sm num">{backlog.length} pending</span>
        <span className="spacer" />
        {filter && !split.full ? (
          <button type="button" className="fchip" aria-label="Clear filter" onClick={() => setFilter(null)}>
            {labelName(prefs.labels, filter.label)} · {PRI[filter.priority]}<XIcon size={11} />
          </button>
        ) : <span className="hint">{split.full ? 'Drag between cells to change priority' : 'Click a count to filter'}</span>}
      </div>
      {split.full ? <FullMatrix /> : (
        <>
          <CountGrid head={split.matrixW < 460 ? 96 : 120} />
          <MatrixList />
        </>
      )}
    </section>
  );
}

function MatrixList() {
  const { filter, setFilter, prefs, store } = usePlanner();
  const { backlog } = useLists();
  const groups = useGroups();
  const stagger = useStagger(32, 18);
  let i = 0;
  return (
    <div className="mx-list">
      {groups.map(g => (
        <Fragment key={g.key}>
          <GroupHead name={filter ? `${labelName(prefs.labels, filter.label)} · ${PRI[filter.priority]}` : PRI[g.p]} count={g.items.length}
            action={filter ? { label: `Show all ${backlog.length}`, onClick: () => setFilter(null) } : undefined} />
          {g.items.map(x => <TaskRow key={x.t.id} t={x.t} kind={x.kind} delay={stagger(i++)} />)}
          {!g.items.length && <p className="mx-empty">Nothing here yet.</p>}
        </Fragment>
      ))}
      {store.loaded && !backlog.length && !filter && (
        <p className="mx-empty">Nothing waiting. Mention a day or time and it goes on the calendar; anything else waits here.</p>
      )}
      <Done Item={TaskRow} stagger={stagger} />
    </div>
  );
}

/** Every task in its cell, for when the matrix has the room. */
function FullMatrix() {
  const { drag, plan, labelOf } = usePlanner();
  const { backlog } = useLists();
  const rows = useRows();
  const target = drag.view && drag.view.kind !== 'resize' ? drag.view.cell : null;
  const lab = (t: Task) => labelOf(t)?.id ?? '';
  const stagger = useStagger(26, 24);
  let i = 0;
  return (
    <div className="mx-full">
      <div className="mx-fgrid">
        <span className="mx-fch" />
        {PRIS.map(p => <div key={p} className="mx-fch">{PRI[p]}<span className="muted num">{backlog.filter(t => t.priority === p).length + plan.added.filter(t => t.priority === p).length}</span></div>)}
        {rows.map(r => {
          const mine = backlog.filter(t => lab(t) === r.id);
          return (
            <Fragment key={r.id || '-'}>
              <div className="mx-flab"><span className={'dot' + (r.color ? '' : ' none')} style={tint(r.color)} /><span className="ell">{r.name}</span><span className="muted num">{mine.length}</span></div>
              {PRIS.map(p => {
                const key = `${r.id}|${p}`;
                const ghosts = plan.added.filter(t => (t.label ?? '') === r.id && t.priority === p);
                return (
                  <div key={key} className={'mx-cell' + (target === key ? ' over' : '')} data-cell={key}>
                    {ghosts.map(t => <Chip key={t.id} t={t} kind="new" delay={stagger(i++)} />)}
                    {mine.filter(t => t.priority === p).map(t => <Chip key={t.id} t={t} kind="open" delay={stagger(i++)} />)}
                  </div>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      <div className="mx-after">
        <Done Item={TaskRow} stagger={stagger} />
      </div>
    </div>
  );
}

/* ---------- phone ---------- */

/** A backlog row on a phone: a big ring, the title in full, and a line of facts. Tap to open it; press and hold to drag it to Done or the trash. */
function PhoneRow({ t, kind, delay }: { t: Task; kind: Kind; delay: string }) {
  const { completing, openEditor, labelOf, now, drag, repeatOf } = usePlanner();
  const tag = useTag(t, kind);
  const label = labelOf(t);
  const repeat = repeatOf(t);
  const due = t.due && kind === 'open' ? dueLabel(t.due, now) : null;
  const facts = [
    kind === 'new' ? 'New' : null,
    kind === 'done' && t.doneAt != null ? `Done ${fmtWhen(t.doneAt, now)}` : null,
    due?.text ?? null, label?.name ?? null, fmtDur(t.minutes), repeat ? describeRule(repeat.rule) : null,
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
        <span className="prow-m"><span className={'dot' + (label ? '' : ' none')} style={tint(label?.color)} /><span className={due?.hot ? 'hot' : undefined}>{facts}</span></span>
      </button>
    </div>
  );
}

/** The phone's matrix tab: the counts in a card, then the list. */
export function PhoneMatrix() {
  const { filter, setFilter, prefs, store } = usePlanner();
  const { backlog } = useLists();
  const groups = useGroups();
  const stagger = useStagger(34, 14);
  let i = 0;
  return (
    <>
      <div className="ph-card mx-card"><CountGrid phone head={92} /></div>
      <div className="ph-list">
        {groups.map(g => (
          <Fragment key={g.key}>
            <GroupHead name={filter ? `${labelName(prefs.labels, filter.label)} · ${PRI[filter.priority]}` : PRI[g.p]} count={g.items.length}
              action={filter ? { label: `Show all ${backlog.length}`, onClick: () => setFilter(null) } : undefined} />
            {g.items.map(x => <PhoneRow key={x.t.id} t={x.t} kind={x.kind} delay={stagger(i++)} />)}
            {!g.items.length && <p className="mx-empty">Nothing here yet.</p>}
          </Fragment>
        ))}
        {store.loaded && !backlog.length && !filter && (
          <p className="mx-empty">Nothing waiting. Mention a day or time and it goes on the calendar; anything else waits here.</p>
        )}
        <Done Item={PhoneRow} stagger={stagger} />
      </div>
    </>
  );
}
