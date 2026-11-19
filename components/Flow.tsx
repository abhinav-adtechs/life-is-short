'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newId, PRI, type Priority, type Task } from '@/lib/model';
import { addGoal, addResult, ancestorsOf, descendantsOf, flatResults, makeGoal, newResultId, patchGoal, patchResult, setGoalStatus, type Goal } from '@/lib/goals';
import {
  buildFlow, describeEntry, goalNode, linkKey, type Flow, newWaitId, parallelLinks, patchWait, planOf, toJson, toMermaid, withLink, withPos, withWait,
  withoutLink, withoutPos, withoutStep, wouldLoop, WAIT_TITLE_MAX, type Link, type LogEntry, type Plan, type Pos, type Step, type StepKind,
} from '@/lib/flow';
import { fmtDur, fmtWhen, longDate, shortTitle } from '@/lib/format';
import { ymd } from '@/lib/time';
import { usePlanner } from './Planner';
import { isEvent } from '@/lib/select';
import { dayName, occurrenceOf, type Repeat } from '@/lib/repeat';
import { WeekLog } from './Repeating';
import { CalendarIcon, CheckIcon, ChevronLeft, HistoryIcon, MicIcon, PlusIcon, RepeatIcon, StopIcon, TargetIcon, XIcon } from './icons';
import { askWorkflow } from '@/lib/api';
import { promptContext } from '@/lib/capture';
import { joinWords } from '@/lib/speech';
import { applyWorkflow, normalizeOps, recordedIds, taskLinesFor, workflowPrompt } from '@/lib/workflow';
import { noVoiceText, useVoice } from './hooks';

/* ---------- geometry ---------- */

const PAD = 36, GOAL_W = 176, GOAL_H = 76, NODE_W = 200, NODE_H = 72, GAP_X = 72, ROW_H = 96;
const colX = (c: number) => (c === 0 ? PAD : PAD + GOAL_W + GAP_X + (c - 1) * (NODE_W + GAP_X));
/** Steps moved by hand land on this grid, so rows line up. */
const SNAP = 8;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

interface Box { x: number; y: number; w: number; h: number }
/** Two boxes too close for comfort. */
const clash = (a: Box, b: Box, gap = 12) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Where everything goes: the goal on the left, each column (its lanes included) centred on the tallest. A step you've
 * moved by hand stays where you put it, and a laid-out step in its way moves down a row at a time. The step you're
 * dragging follows the pointer; the rest stay put until you let go.
 */
function useLayout(flow: Flow, pos: Record<string, Pos> | undefined, drag: { id: string; x: number; y: number } | null) {
  return useMemo(() => {
    const counts = flow.rows;
    const rows = Math.max(1, ...counts);
    const height = PAD * 2 + rows * ROW_H - (ROW_H - NODE_H);
    const at = (col: number, row: number): Box => ({ x: colX(col), y: PAD + ((rows - (counts[col] ?? 1)) * ROW_H) / 2 + row * ROW_H, w: NODE_W, h: NODE_H });
    const boxes = new Map<string, Box>();
    const goal: Box = { x: PAD, y: height / 2 - GOAL_H / 2, w: GOAL_W, h: GOAL_H };
    // Steps not where the layout put them: their arrows go straight, not through lanes.
    const moved = new Set<string>();
    for (const s of flow.steps) {
      const p = pos?.[s.id];
      if (p) { boxes.set(s.id, { x: p.x, y: p.y, w: NODE_W, h: NODE_H }); moved.add(s.id); }
    }
    const placed = [goal, ...boxes.values()];
    for (const s of [...flow.steps].sort((a, b) => a.col - b.col || a.row - b.row)) {
      if (boxes.has(s.id)) continue;
      let b = at(s.col, s.row);
      if (moved.size && placed.some(o => clash(b, o))) {
        moved.add(s.id);
        for (let i = 0; i < 200 && placed.some(o => clash(b, o)); i++) b = { ...b, y: b.y + ROW_H };
      }
      boxes.set(s.id, b);
      placed.push(b);
    }
    if (drag && boxes.has(drag.id)) { boxes.set(drag.id, { x: drag.x, y: drag.y, w: NODE_W, h: NODE_H }); moved.add(drag.id); }
    // Each lane is a step-sized slot an arrow runs straight through.
    const lanes = new Map<string, Box[]>();
    for (const l of flow.links) {
      const key = linkKey(l), list = flow.lanes.get(key);
      if (list && !moved.has(l.from) && !moved.has(l.to)) lanes.set(key, list.map(x => at(x.col, x.row)));
    }
    const all = [...boxes.values()];
    return {
      boxes, lanes, goal,
      width: Math.max(colX(Math.max(1, flow.cols)) + NODE_W, ...all.map(b => b.x + b.w)) + PAD,
      height: Math.max(height, GOAL_H + PAD * 2, ...all.map(b => b.y + b.h + PAD)),
    };
  }, [flow, pos, drag]);
}

/**
 * A left-to-right arrow from the right edge of one box to the left edge of another, curving between columns and
 * running straight through any lanes on the way; and the middle of it, for the button that removes it.
 */
function curve(a: Box, b: Box, via: Box[] = []) {
  const stops = [a, ...via, b];
  let d = '';
  const mids: { x: number; y: number }[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const p = stops[i], q = stops[i + 1];
    const x1 = i === 0 ? p.x + p.w : p.x + p.w, y1 = p.y + p.h / 2;
    const x2 = i === stops.length - 2 ? q.x - 4 : q.x, y2 = q.y + q.h / 2;
    const dx = Math.max(28, (x2 - x1) / 2);
    // Into a lane, then straight across it.
    d += `${i ? ' L' : 'M'} ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    mids.push({ x: (x1 + 3 * (x1 + dx) + 3 * (x2 - dx) + x2) / 8, y: (y1 + 3 * y1 + 3 * y2 + y2) / 8 });
  }
  return { d, mid: mids[Math.floor((mids.length - 1) / 2)] };
}

/* ---------- words ---------- */

const KIND = { task: 'Task', wait: 'Waiting on', goal: 'Sub-goal', milestone: 'Key result' } as const;

/** What you can add from the palette, in flowchart shapes. */
const PALETTE: { kind: StepKind; label: string; hint: string }[] = [
  { kind: 'task', label: 'Step', hint: 'A task towards the goal. Click to add one after the selected step, or drag it onto the chart.' },
  { kind: 'wait', label: 'Waiting on', hint: 'Something outside your control that holds steps up. Drop it on the step it holds up.' },
  { kind: 'goal', label: 'Sub-goal', hint: 'An objective under this one, with its own chart. Drop it on a key result it serves.' },
  { kind: 'milestone', label: 'Key result', hint: 'What has to be true for the goal to be done. Drop it on a key result to put it under that one.' },
];

/** The shape of each kind of step, small, for the palette. */
function Shape({ kind }: { kind: StepKind }) {
  const d = kind === 'wait' ? 'M2 3h10a5 5 0 0 1 0 10H2z' : kind === 'milestone' ? 'M5 3h10l4 5-4 5H5L1 8z' : 'M2 3h16v10H2z';
  return (
    <svg className="fp-shape" width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
      <path d={d} />
      {kind === 'goal' && <path d="M5 3v10M15 3v10" />}
    </svg>
  );
}

function stateText(s: Step, byId: Map<string, Step>, now: number) {
  if (s.kind === 'goal') {
    if (s.done) return 'Achieved';
    if (s.state === 'blocked') return `Blocked by ${s.needs.filter(id => !byId.get(id)?.done).length}`;
    return `${s.progress != null ? `${Math.round(s.progress * 100)}% done` : 'Not started'}${s.minutes ? ` · ${fmtDur(s.minutes)} left` : ''}`;
  }
  if (s.kind === 'milestone') return s.done ? 'Reached' : s.state === 'reached' ? 'Ready to tick' : s.needs.length ? `After ${s.needs.length} step${s.needs.length === 1 ? '' : 's'}` : 'Nothing leads here yet';
  if (s.kind === 'wait') return s.done ? 'Resolved' : s.state === 'blocked' ? 'Waiting, held up' : 'Waiting';
  if (s.repeat) {
    const { times, next } = s.repeat;
    if (s.done) return times ? `All ${times} done` : 'Over';
    const when = s.state === 'blocked' ? `Blocked by ${s.needs.filter(id => !byId.get(id)?.done).length}`
      : s.task ? (s.task.start != null ? fmtWhen(s.task.start, now) : 'Ready') : next ? `Next ${dayName(next, now)}` : 'Nothing more to come';
    // The count is on the step's repeat badge, and in the side panel.
    return when;
  }
  if (s.done) return 'Done';
  if (s.state === 'blocked') {
    const open = s.needs.filter(id => !byId.get(id)?.done).length;
    return `Blocked by ${open}`;
  }
  return s.task?.start != null ? fmtWhen(s.task.start, now) : 'Ready';
}

/* ---------- the panel ---------- */

/** The flow chart of the goal in the address (#flow/<goal id>). */
export function FlowPanel() {
  const { section, goalById, closeSheet, openSheet, goalsLoaded } = usePlanner();
  const goal = goalById(section);
  if (!goal && !goalsLoaded) return <div className="side-b"><p className="note">Opening the chart…</p></div>;
  if (!goal) {
    return (
      <div className="side-b">
        <p className="note">That goal isn’t here any more. <button type="button" className="link" onClick={() => openSheet('goals')}>Back to your goals</button> or <button type="button" className="link" onClick={closeSheet}>close</button>.</p>
      </div>
    );
  }
  return <FlowChart key={goal.id} goal={goal} />;
}

type Sel = { kind: 'step'; id: string } | { kind: 'link'; key: string } | null;
/** A key press, from React or straight from the window. */
type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'preventDefault'> & { target: EventTarget | null };

function FlowChart({ goal }: { goal: Goal }) {
  const { tasks, now, prefs, wide, store, changeGoals, logGoal, openSheet, goals, goalById, repeats, applyRepeats, liveTasks, voice } = usePlanner();
  const [all, setAll] = useState(false);
  const flow = useMemo(() => buildFlow(goal, tasks, now, { all, goals, repeats }), [goal, tasks, now, all, goals, repeats]);
  const trail = useMemo(() => ancestorsOf(new Map(goals.map(g => [g.id, g])), goal).reverse(), [goals, goal]);
  /** The step being dragged, where it is now. */
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  /** A step held long enough on a touch screen to be dragged. */
  const [lifting, setLifting] = useState<string | null>(null);
  const pinned = goal.plan?.pos;
  const layout = useLayout(flow, pinned, dragPos);
  const [sel, setSel] = useState<Sel>(null);
  /** The step Delete was pressed on, waiting for a yes. */
  const [confirm, setConfirm] = useState<string | null>(null);
  /** Something from the palette on its way to the chart, where the pointer is (relative to the chart's frame). */
  const [ghost, setGhost] = useState<{ kind: StepKind; label: string; x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  /** A drag just ended: the click that follows it isn't a click. */
  const justMoved = useRef(false);
  const [zoom, setZoom] = useState(1);
  /** The side panel: the selected step (or, with nothing selected, the backlog), the backlog, or the history. */
  const [side, setSide] = useState<'inspect' | 'history' | 'backlog'>('inspect');
  const [note, setNote] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ from: string; x: number; y: number; moved: boolean } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  /** The step whose title to type into next: one just added. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const undos = useRef<{ label: string; run: () => void }[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const section = prefs.labels.find(l => l.id === goal.section) ?? null;
  const tint = section ? ({ '--c': section.color } as React.CSSProperties) : undefined;

  const say = useCallback((msg: string) => { setNote(msg); window.setTimeout(() => setNote(n => (n === msg ? null : n)), 3200); }, []);
  const remember = (label: string, run: () => void) => { undos.current = [...undos.current.slice(-19), { label, run }]; setUndoLabel(label); };
  const undo = () => {
    const u = undos.current.pop();
    setUndoLabel(undos.current[undos.current.length - 1]?.label ?? null);
    if (u) { u.run(); say(`Undid: ${u.label}`); }
  };

  /** Change this goal's plan, laid over whatever it is by the time it's saved. Returns what undoes it. */
  const plan = (f: (p: Plan) => Plan) =>
    changeGoals(list => list.map(g => (g.id === goal.id ? { ...g, plan: f(planOf(g)), updatedAt: Date.now() } : g)));
  const titleOf = (id: string) => flow.byId.get(id)?.title;
  const log = (e: Omit<LogEntry, 'at' | 'goal'>) => logGoal([{ at: Date.now(), goal: goal.id, ...e }]);

  /* ---------- changes ---------- */

  const link = (l: Link) => {
    const cur = planOf(goal);
    if (cur.links.some(e => e.from === l.from && e.to === l.to)) return;
    if (wouldLoop(cur.links, l.from, l.to)) { say('That arrow would make a loop: one of these already leads to the other.'); return; }
    const back = plan(p => withLink(p, l));
    log({ op: 'link', step: l.to, title: titleOf(l.to), from: l.from, fromTitle: titleOf(l.from) });
    remember('draw the arrow', back);
    setSel({ kind: 'link', key: linkKey(l) });
  };

  const unlink = (l: Link) => {
    const back = plan(p => withoutLink(p, l));
    log({ op: 'unlink', step: l.to, title: titleOf(l.to), from: l.from, fromTitle: titleOf(l.from) });
    remember('remove the arrow', back);
    setSel(null);
  };

  /** The nearest free place at or below `p`, on the grid. */
  const freeAt = (p: Pos): Pos => {
    const all = [layout.goal, ...layout.boxes.values()];
    const b = { x: snap(Math.max(0, p.x)), y: snap(Math.max(0, p.y)), w: NODE_W, h: NODE_H };
    for (let i = 0; i < 200 && all.some(o => clash(b, o)); i++) b.y += ROW_H;
    return { x: b.x, y: b.y };
  };
  /**
   * Where a new step goes by hand: where you dropped it; or, once you've moved steps yourself, next to the step it's
   * added to. Null leaves it to the layout.
   */
  const spotFor = (o: { at?: Pos; after?: string; beside?: string; before?: string }): Pos | null => {
    if (o.at) return freeAt(o.at);
    const anchor = o.after ?? o.beside ?? o.before;
    const b = pinned && anchor ? layout.boxes.get(anchor) : null;
    if (!b) return null;
    if (o.after) return freeAt({ x: b.x + NODE_W + GAP_X, y: b.y });
    if (o.beside) return freeAt({ x: b.x, y: b.y + ROW_H });
    // Before it, or under it when there's no room between it and the goal.
    const x = b.x - NODE_W - GAP_X;
    return x < colX(1) - GAP_X / 2 ? freeAt({ x: b.x, y: b.y + ROW_H }) : freeAt({ x, y: b.y });
  };

  /** A new task on this goal: after `after`, or alongside `beside`, or before `before`, or on its own (at `at`). */
  const addTask = (opts: { after?: string; beside?: string; before?: string; at?: Pos } = {}) => {
    const at = Date.now();
    const t: Task = {
      id: newId(), title: 'New step', raw: '', notes: '', priority: 2, minutes: 60, start: null, due: null, status: 'open',
      created: at, order: at, doneAt: null, goal: goal.id, label: goal.section ?? null, updatedAt: at,
    };
    const before = store.write([t]);
    const cur = planOf(goal);
    const links = opts.after ? [{ from: opts.after, to: t.id }] : opts.before ? [{ from: t.id, to: opts.before }] : opts.beside ? parallelLinks(cur, opts.beside, t.id) : [];
    const spot = spotFor(opts);
    const back = links.length || spot ? plan(p => { const q = links.reduce(withLink, p); return spot ? withPos(q, t.id, spot) : q; }) : () => undefined;
    remember('add the step', () => { back(); store.restore(before); });
    setSel({ kind: 'step', id: t.id });
    setSide('inspect');
    setFocusId(t.id);
  };

  const addWait = (holds?: string, at?: Pos) => {
    const w = { id: newWaitId(), title: 'Someone or something', done: false, created: Date.now(), doneAt: null };
    const spot = spotFor({ at, before: holds });
    const back = plan(p => {
      const q = holds ? withLink(withWait(p, w), { from: w.id, to: holds }) : withWait(p, w);
      return spot ? withPos(q, w.id, spot) : q;
    });
    log({ op: 'wait', step: w.id, title: w.title });
    remember('add the waiting step', back);
    setSel({ kind: 'step', id: w.id });
    setSide('inspect');
    setFocusId(w.id);
  };

  const rename = (s: Step, title: string) => {
    const v = title.replace(/\s+/g, ' ').trim();
    if (!v || v === s.title) return;
    // One of a repeat's: the ones to come follow it.
    if (s.kind === 'task' && s.task) { const before = store.patch(s.task.id, { title: v.slice(0, 160) }); remember('rename', () => store.restore(before)); return; }
    // A repeat with none open: the repeat itself.
    const r = s.repeat ? repeats.find(x => x.id === s.repeat?.id) : null;
    if (r) { remember('rename', applyRepeats([{ kind: 'set', repeat: { ...r, title: v.slice(0, 160), updatedAt: Date.now() } }])); return; }
    if (s.kind === 'wait') {
      const back = plan(p => patchWait(p, s.id, { title: v.slice(0, WAIT_TITLE_MAX) }));
      log({ op: 'rename', step: s.id, title: v, was: s.title });
      remember('rename', back);
      return;
    }
    if (s.result) {
      const back = changeGoals(patchResult(goal.id, s.result.id, { text: v.slice(0, 120) }));
      log({ op: 'rename', step: s.id, title: v, was: s.title });
      remember('rename', back);
      return;
    }
    if (s.goal) {
      const back = changeGoals(patchGoal(s.goal.id, { title: v.slice(0, 80) }));
      log({ op: 'rename', step: s.id, title: v, was: s.title });
      remember('rename', back);
    }
  };

  /** A sub-goal of this one: for one of its key results, or for the goal as a whole. */
  const addSubGoal = (kr?: string, at?: Pos) => {
    const g = makeGoal({ title: 'New sub-goal', section: goal.section, parent: goal.id, parentKr: kr ?? null });
    const spot = spotFor({ at, before: kr ? `kr:${kr}` : undefined });
    const back = changeGoals(addGoal(g));
    const put = spot ? plan(p => withPos(p, goalNode(g), spot)) : () => undefined;
    log({ op: 'add', step: goalNode(g), title: g.title });
    remember('add the sub-goal', () => { put(); back(); });
    setSel({ kind: 'step', id: goalNode(g) });
    setSide('inspect');
    setFocusId(goalNode(g));
  };

  /** A key result: under another one, or for the goal itself. */
  const addKr = (under: string | null, at?: Pos) => {
    const id = newResultId();
    const spot = spotFor({ at, beside: under ? `kr:${under}` : undefined });
    const back = changeGoals(addResult(goal.id, under, 'New key result', Date.now(), id));
    const put = spot ? plan(p => withPos(p, `kr:${id}`, spot)) : () => undefined;
    log({ op: 'add', step: `kr:${id}`, title: 'New key result' });
    remember('add the key result', () => { put(); back(); });
    setSel({ kind: 'step', id: `kr:${id}` });
    setSide('inspect');
    setFocusId(`kr:${id}`);
  };

  const toggle = (s: Step) => {
    if (s.repeat && !s.task) { say(s.repeat.next ? `Nothing of it is open: the next one comes ${dayName(s.repeat.next, now)}.` : 'It’s over: nothing more to come.'); return; }
    if (s.kind === 'task' && s.task) {
      if (s.task.externalId?.startsWith('gcal:')) { say('A meeting is done once it’s over.'); return; }
      const isDone = s.task.status !== 'done';
      const before = store.patch(s.task.id, { status: isDone ? 'done' : 'open', doneAt: isDone ? Date.now() : null });
      remember(isDone ? 'tick it off' : 'reopen it', () => store.restore(before));
      return;
    }
    if (s.kind === 'wait' && s.wait) {
      const done = !s.wait.done;
      const back = plan(p => patchWait(p, s.id, { done, doneAt: done ? Date.now() : null }));
      log({ op: done ? 'resolve' : 'unresolve', step: s.id, title: s.title });
      remember(done ? 'resolve it' : 'wait again', back);
      return;
    }
    if (s.result) {
      if (!s.result.done && s.done) { say('It’s done because everything under it is. Untick one of those instead.'); return; }
      const done = !s.result.done;
      const back = changeGoals(patchResult(goal.id, s.result.id, { done }));
      log({ op: done ? 'tick' : 'untick', step: s.id, title: s.title });
      remember(done ? 'tick the key result' : 'untick the key result', back);
      return;
    }
    if (s.goal) {
      const done = s.goal.status !== 'achieved';
      const back = changeGoals(setGoalStatus(s.goal.id, done ? 'achieved' : 'active'));
      log({ op: done ? 'tick' : 'untick', step: s.id, title: s.title });
      remember(done ? 'achieve the sub-goal' : 'bring it back', back);
    }
  };

  /**
   * Off the chart: a task off this goal (or deleted), a waiting step gone, a sub-goal dropped, a key result deleted with
   * the ones under it. Its arrows go too.
   */
  const removeStep = (s: Step, how: 'off' | 'delete') => {
    const ids = s.result ? flatResults([s.result]).map(x => `kr:${x.kr.id}`) : [s.id];
    const back = plan(p => ids.reduce(withoutStep, p));
    if (s.kind === 'wait') { log({ op: 'remove', step: s.id, title: s.title }); remember('remove it', back); }
    else if (s.result) {
      const gone = changeGoals(patchResult(goal.id, s.result.id, null));
      log({ op: 'remove', step: s.id, title: s.title });
      remember('delete the key result', () => { gone(); back(); });
    }
    else if (s.goal) {
      const off = changeGoals(setGoalStatus(s.goal.id, 'dropped'));
      log({ op: 'remove', step: s.id, title: s.title });
      remember('drop the sub-goal', () => { back(); off(); });
    }
    else if (s.repeat) {
      // Stop it (its open one goes too), or take the whole series off this goal.
      const r = repeats.find(x => x.id === s.repeat?.id);
      const before = s.task ? (how === 'delete' ? store.remove([s.task.id]) : store.patch(s.task.id, { goal: null })) : null;
      const unrepeat = r ? applyRepeats([how === 'delete' ? { kind: 'stop', id: r.id } : { kind: 'set', repeat: { ...r, goal: null, updatedAt: Date.now() } }]) : () => undefined;
      remember(how === 'delete' ? 'stop repeating' : 'take it off the goal', () => { back(); unrepeat(); if (before) store.restore(before); });
    }
    else if (s.task) {
      const before = how === 'delete' ? store.remove([s.task.id]) : store.patch(s.task.id, { goal: null });
      remember(how === 'delete' ? 'delete it' : 'take it off the goal', () => { back(); store.restore(before); });
    }
    setSel(null);
    setConfirm(null);
  };

  /** Delete pressed on a step, and the answer yes. */
  const confirmDelete = (s: Step, how: 'off' | 'delete' = 'delete') => {
    const external = !!s.task?.externalId;
    removeStep(s, s.repeat || (s.task && !external) ? how : 'off');
    const verb = s.kind === 'goal' ? 'Dropped' : s.repeat ? (how === 'off' ? 'Took off this goal:' : 'Stopped repeating') : s.task && (how === 'off' || external) ? 'Took off this goal:' : s.kind === 'wait' ? 'Removed' : 'Deleted';
    say(`${verb} “${shortTitle(s.title, 40)}”. ⌘Z undoes it.`);
    scroller.current?.focus({ preventScroll: true });
  };

  /** Back to the layout for every step you've moved. */
  const tidy = () => {
    const back = plan(withoutPos);
    remember('tidy up', back);
    say('Laid out again. ⌘Z puts your steps back where they were.');
  };

  /* ---------- moving a step: drag it (on a touch screen, hold it first) ---------- */

  const startMove = (e: React.PointerEvent, id: string) => {
    justMoved.current = false;
    if (e.button !== 0 || picking || (e.target as HTMLElement).closest('button,input,textarea,select')) return;
    const b = layout.boxes.get(id);
    if (!b) return;
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, p0 = toCanvas(x0, y0);
    const touch = e.pointerType === 'touch';
    let armed = !touch, moving = false, last: Pos | null = null;
    // A touch that moves straight away is a scroll; one held still for a moment picks the step up.
    const hold = touch ? window.setTimeout(() => { armed = true; setLifting(id); navigator.vibrate?.(8); }, 320) : 0;
    const block = (ev: TouchEvent) => { if (armed) ev.preventDefault(); };
    const end = () => {
      window.clearTimeout(hold);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', block);
      setLifting(null);
    };
    const move = (ev: PointerEvent) => {
      const far = Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5;
      if (!armed) { if (far) end(); return; }
      if (!moving && !far) return;
      moving = true;
      const p = toCanvas(ev.clientX, ev.clientY);
      last = { x: snap(Math.max(0, b.x + p.x - p0.x)), y: snap(Math.max(0, b.y + p.y - p0.y)) };
      setDragPos({ id, ...last });
    };
    const cancel = () => { end(); setDragPos(null); };
    const up = () => {
      end();
      if (!moving || !last) return;
      justMoved.current = true;
      window.setTimeout(() => { justMoved.current = false; }, 0);
      const to = last;
      remember('move the step', plan(p => withPos(p, id, to)));
      setDragPos(null);
      setSel({ kind: 'step', id });
      scroller.current?.focus({ preventScroll: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    if (touch) window.addEventListener('touchmove', block, { passive: false });
  };

  /* ---------- the palette: click to add, or drag onto the chart ---------- */

  /** A new step of a kind, dropped on the chart: onto a step it goes with, or at the spot. */
  const dropNew = (kind: StepKind, onto: Step | null, at: Pos) => {
    if (kind === 'task') { if (onto) addTask(onto.kind === 'milestone' ? { before: onto.id } : { after: onto.id }); else addTask({ at }); }
    else if (kind === 'wait') { if (onto && onto.kind !== 'wait') addWait(onto.id); else addWait(undefined, at); }
    else if (kind === 'goal') { if (onto?.result) addSubGoal(onto.result.id); else addSubGoal(undefined, at); }
    else if (onto?.result && (onto.depth ?? 0) < 2) addKr(onto.result.id);
    else addKr(null, at);
  };
  /** A click on the palette: next to the selected step, as Tab does. */
  const addKind = (kind: StepKind) => {
    const s = selStep;
    if (kind === 'task') addTask(s ? (s.kind === 'milestone' ? { before: s.id } : { after: s.id }) : {});
    else if (kind === 'wait') addWait(s && s.kind !== 'wait' ? s.id : undefined);
    else if (kind === 'goal') addSubGoal(s?.result?.id);
    else addKr(s?.result?.id ?? null);
  };
  /** An off-goal task brought onto this goal: after `after` (before `before`, for a key result), or where it was dropped. */
  const adopt = (t: Task, o: { after?: string; before?: string; at?: Pos } = {}) => {
    const before = store.patch(t.id, { goal: goal.id, ...(goal.section ? { label: goal.section } : {}) });
    // One of a repeat's brings the whole series, as one step.
    const rid = occurrenceOf(t.id)?.repeat;
    const sid = rid && repeats.some(r => r.id === rid) ? `rep:${rid}` : t.id;
    const links = o.after ? [{ from: o.after, to: sid }] : o.before ? [{ from: sid, to: o.before }] : [];
    const spot = spotFor(o);
    const back = links.length || spot ? plan(p => { const q = links.reduce(withLink, p); return spot ? withPos(q, sid, spot) : q; }) : () => undefined;
    remember('bring it onto the goal', () => { back(); store.restore(before); });
    setSel({ kind: 'step', id: sid });
    // Keep the backlog open, for the next one.
    setSide('backlog');
    say(`“${shortTitle(t.title, 40)}” is on this goal now. ⌘Z undoes it.`);
  };
  /** The backlog's +: after the selected step, as Tab does. */
  const adoptHere = (t: Task) => adopt(t, selStep ? (selStep.kind === 'milestone' ? { before: selStep.id } : { after: selStep.id }) : {});

  const fromPalette = (e: React.PointerEvent, kind: StepKind) => carry(e, { kind, label: KIND[kind] }, (onto, at) => dropNew(kind, onto, at));
  const fromBacklog = (e: React.PointerEvent, t: Task) => {
    // On a touch screen the list scrolls; its + adds instead.
    if (e.pointerType === 'touch' || (e.target as HTMLElement).closest('button')) return;
    carry(e, { kind: 'task', label: t.title }, (onto, at) => adopt(t, onto ? (onto.kind === 'milestone' ? { before: onto.id } : { after: onto.id }) : { at }));
  };
  /** Something carried onto the chart from beside it: dropped on a step, or at a spot. */
  const carry = (e: React.PointerEvent, what: { kind: StepKind; label: string }, drop: (onto: Step | null, at: Pos) => void) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moving = false;
    const rel = (ev: PointerEvent) => { const r = stage.current?.getBoundingClientRect(); return { x: ev.clientX - (r?.left ?? 0), y: ev.clientY - (r?.top ?? 0) }; };
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moving = true;
      setGhost({ ...what, ...rel(ev) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      setGhost(null);
      if (!moving) return;
      justMoved.current = true;
      window.setTimeout(() => { justMoved.current = false; }, 0);
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (!hit?.closest('.flow-scroll')) return;
      const onto = hit.closest<HTMLElement>('[data-step]')?.dataset.step;
      const p = toCanvas(ev.clientX, ev.clientY);
      drop(onto ? flow.byId.get(onto) ?? null : null, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', stop); setGhost(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
  };

  const patchTask = (s: Step, part: Partial<Task>, label: string) => {
    if (!s.task) return;
    const before = store.patch(s.task.id, part);
    remember(label, () => store.restore(before));
  };

  /* ---------- drawing an arrow: drag from a step's handle, or click the handle and then a step ---------- */

  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvas.current?.getBoundingClientRect();
    return r ? { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom } : { x: 0, y: 0 };
  };

  const startDraw = (e: React.PointerEvent, from: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p0 = toCanvas(e.clientX, e.clientY);
    setDrawing({ from, ...p0, moved: false });
    const move = (ev: PointerEvent) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      setDrawing(d => (d ? { ...d, ...p, moved: d.moved || Math.hypot(p.x - p0.x, p.y - p0.y) > 6 } : d));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = toCanvas(ev.clientX, ev.clientY);
      const moved = Math.hypot(p.x - p0.x, p.y - p0.y) > 6;
      setDrawing(null);
      if (!moved) { setPicking(from); return; }
      const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-step]');
      const to = hit?.dataset.step;
      if (to && to !== from) link({ from, to });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const clickStep = (id: string) => {
    if (justMoved.current) { justMoved.current = false; return; }
    // Keys (Tab, Enter, arrows, Delete) go to the chart once you've picked something on it.
    scroller.current?.focus({ preventScroll: true });
    if (confirm && confirm !== id) setConfirm(null);
    if (picking) {
      if (picking !== id) link({ from: picking, to: id });
      setPicking(null);
      return;
    }
    setSel({ kind: 'step', id });
    setSide('inspect');
  };

  /* ---------- saying what to change: the AI turns it into changes to the chart ---------- */

  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<{ said: string; reply: string; lines: string[]; skipped: string[]; done: boolean } | null>(null);
  /** What the mic has heard so far. */
  const [hearing, setHearing] = useState<string | null>(null);

  const tell = async (text: string, spoken = false) => {
    const said = text.trim();
    if (!said || asking) return;
    setAsking(true);
    setAsked(null);
    try {
      const live = liveTasks();
      const { refs: taskRefs } = promptContext(live);
      const { prompt, refs } = workflowPrompt({ text: said, now: Date.now(), goals, tasks: live, repeats, focus: goal.id, spoken, taskRefs, taskLines: taskLinesFor(live, taskRefs) });
      const { result, via } = await askWorkflow(prompt);
      if (!result) {
        setAsked({ said, done: false, lines: [], skipped: [], reply: via === 'no-key' ? 'Changing the chart by what you say needs the AI, and it isn’t set up here.' : 'Couldn’t reach the AI just now. Try again in a moment.' });
        return;
      }
      const ops = normalizeOps(result.ops);
      const heard = result.heard || said;
      if (!ops.length) { setAsked({ said: heard, done: false, lines: [], skipped: [], reply: result.reply || 'Nothing to change in that.' }); return; }
      const st = { goals, tasks, repeats, now: Date.now() };
      const rec = recordedIds();
      const out = applyWorkflow(ops, st, refs, { focus: goal.id, ids: rec });
      // Laid over the goals as they are when it's saved, with the same new ids. Repeats first, then tasks.
      const undoGoals = changeGoals(list => applyWorkflow(ops, { ...st, goals: list }, refs, { focus: goal.id, ids: rec.replay() }).goals);
      const unrepeat = applyRepeats(out.repeatOps);
      const before = new Map([...(out.removes.length ? store.remove(out.removes) : []), ...(out.writes.length ? store.write(out.writes) : [])]);
      logGoal(out.log);
      remember('the change you asked for', () => { store.restore(before); unrepeat(); undoGoals(); });
      setAsked({ said: heard, done: out.lines.length > 0, reply: result.reply || (out.lines.length ? 'Done.' : 'Nothing changed.'), lines: out.lines, skipped: out.skipped });
      setAsk('');
    } finally {
      setAsking(false);
    }
  };

  const listen = useVoice({
    lang: voice.profile.lang,
    // The names on the chart, so they're heard right.
    phrases: () => [goal.title, ...flow.steps.map(x => x.title)].slice(0, 80),
    onHeard: h => setHearing(joinWords(h.text, h.interim)),
    onFinish: x => { setHearing(null); if (x.text.trim()) void tell(x.text, true); },
    onCutOff: x => { setHearing(null); if (x.text.trim()) { setAsk(x.text); say('Stopped listening. What you said is in the box.'); } },
    onUnsupported: why => { setHearing(null); say(noVoiceText(why)); },
  });
  const mic = () => (listen.listening ? listen.finishVoice() : listen.startVoice(ask));

  /* ---------- the keyboard ---------- */

  const selStep = sel?.kind === 'step' ? flow.byId.get(sel.id) ?? null : null;
  const selLink = sel?.kind === 'link' ? flow.links.find(l => linkKey(l) === sel.key) ?? null : null;
  /** With nothing selected, the side shows the backlog. */
  const showBacklog = side === 'backlog' || (side === 'inspect' && !selStep && !selLink);

  const onKey = (e: KeyLike) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const typing = target?.closest('input,textarea,select');
    const onButton = target?.closest('button');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); mic(); return; }
    if (e.key === 'Escape') {
      if (confirm) { e.preventDefault(); setConfirm(null); scroller.current?.focus({ preventScroll: true }); return; }
      if (picking || drawing) { e.preventDefault(); setPicking(null); setDrawing(null); return; }
      // In a field: leave it (it saves), back on the chart. Then a second Esc lets go of the step, a third closes.
      if (typing) { e.preventDefault(); (typing as HTMLElement).blur(); scroller.current?.focus({ preventScroll: true }); return; }
      if (sel) { e.preventDefault(); setSel(null); return; }
      return;
    }
    if (typing || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selLink && !selLink.auto) { e.preventDefault(); unlink(selLink); return; }
      // Once to ask, again (or Enter on the button) to do it.
      if (selStep) { e.preventDefault(); if (confirm === selStep.id) confirmDelete(selStep); else setConfirm(selStep.id); }
      return;
    }
    // While it asks, keys belong to its buttons.
    if (confirm) return;
    if (e.key === 'Tab' && selStep && !e.shiftKey) { e.preventDefault(); addTask(selStep.kind === 'milestone' ? { before: selStep.id } : { after: selStep.id }); return; }
    if (e.key === 'Enter' && !onButton && selStep && selStep.kind !== 'milestone') { e.preventDefault(); addTask({ beside: selStep.id }); return; }
    if (selStep && e.key.startsWith('Arrow')) {
      // To the nearest step that way, as the steps are drawn.
      e.preventDefault();
      const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
      const a = layout.boxes.get(selStep.id);
      if (!dir || !a) return;
      let go: string | null = null, best = Infinity;
      for (const s of flow.steps) {
        const b = layout.boxes.get(s.id);
        if (s.id === selStep.id || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        if (along <= 4) continue;
        if (along + across * 2 < best) { best = along + across * 2; go = s.id; }
      }
      if (go) setSel({ kind: 'step', id: go });
    }
  };
  // Keys also reach the chart when nothing has focus (after a step you were on goes away, say).
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const a = document.activeElement;
      if (e.defaultPrevented || (a && a !== document.body)) return;
      keyRef.current(e);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  /* ---------- zoom and fit ---------- */

  const fit = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // Fit, but never so small that the steps can't be read: past that, scroll.
    setZoom(Math.max(0.75, Math.min(1, (el.clientWidth - 8) / layout.width, (el.clientHeight - 8) / layout.height)));
  }, [layout.width, layout.height]);
  const fitted = useRef(false);
  useLayoutEffect(() => { if (!fitted.current && flow.steps.length) { fitted.current = true; fit(); } }, [fit, flow.steps.length]);
  // Keep the selected step in view.
  useEffect(() => {
    const b = selStep ? layout.boxes.get(selStep.id) : null, el = scroller.current;
    if (!b || !el) return;
    const x = b.x * zoom, y = b.y * zoom;
    if (x < el.scrollLeft || x + b.w * zoom > el.scrollLeft + el.clientWidth) el.scrollTo({ left: x - 80, behavior: 'smooth' });
    if (y < el.scrollTop || y + b.h * zoom > el.scrollTop + el.clientHeight) el.scrollTo({ top: y - 60, behavior: 'smooth' });
  }, [selStep, layout.boxes, zoom]);

  // Drag the background to move around.
  const pan = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-step],button,path.fe-hit') || e.button !== 0) return;
    const el = scroller.current;
    if (!el) return;
    setSel(null);
    setPicking(null);
    const x0 = e.clientX, y0 = e.clientY, l0 = el.scrollLeft, t0 = el.scrollTop;
    const move = (ev: PointerEvent) => { el.scrollLeft = l0 - (ev.clientX - x0); el.scrollTop = t0 - (ev.clientY - y0); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------- export ---------- */

  const download = (name: string, text: string, type = 'application/json') => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const slug = goal.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'goal';
  const copyMermaid = () => {
    const text = toMermaid(goal, flow);
    const done = navigator.clipboard?.writeText(text);
    if (done) done.then(() => say('Copied as a Mermaid flowchart. Paste it into GitHub, Notion or any Mermaid editor.'), () => download(`${slug}.mmd`, text, 'text/plain'));
    else download(`${slug}.mmd`, text, 'text/plain');
  };

  /* ---------- drawing it ---------- */

  const box = (id: string) => layout.boxes.get(id) as Box;
  const z = zoom;
  const live = drawing && drawing.moved ? (() => {
    const a = box(drawing.from);
    return `M ${a.x + a.w} ${a.y + a.h / 2} L ${drawing.x} ${drawing.y}`;
  })() : null;

  return (
    <div className={'flowc' + (wide ? '' : ' ph')} onKeyDown={onKey}>
      <div className="flow-bar">
        <button type="button" className="btn ghost sm" onClick={() => openSheet('goals')}><ChevronLeft size={13} />Goals</button>
        <nav className="flow-trail" aria-label="Goal and the goals it's part of">
          {trail.map(a => (
            <span key={a.id} className="flow-crumb"><button type="button" className="link" onClick={() => openSheet('flow', a.id)}>{shortTitle(a.title, 28)}</button><span aria-hidden="true">›</span></span>
          ))}
          <span className="flow-goal ell" style={tint}><span className={'dot' + (section ? '' : ' none')} />{goal.title}</span>
        </nav>
        <span className="spacer" />
        {pinned && <button type="button" className="btn ghost sm" onClick={tidy} title="Lay every step out again, as the arrows say">Tidy up</button>}
        <label className="flow-check wide-only"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />All done steps</label>
        <div className="flow-zoom wide-only" role="group" aria-label="Zoom">
          <button type="button" className="ib bare" aria-label="Zoom out" onClick={() => setZoom(v => Math.max(0.4, +(v - 0.1).toFixed(2)))}>−</button>
          <button type="button" className="btn ghost sm num" onClick={fit} title="Fit the chart">{Math.round(zoom * 100)}%</button>
          <button type="button" className="ib bare" aria-label="Zoom in" onClick={() => setZoom(v => Math.min(1.6, +(v + 0.1).toFixed(2)))}>+</button>
        </div>
        <button type="button" className="btn ghost sm" disabled={!undoLabel} onClick={undo} title={undoLabel ? `Undo: ${undoLabel} (⌘Z)` : 'Nothing to undo'}>Undo</button>
        <button type="button" className="btn ghost sm" aria-pressed={showBacklog} onClick={() => setSide(showBacklog ? 'inspect' : 'backlog')} title="Off-goal tasks, to drag onto the chart">Backlog</button>
        <button type="button" className="btn ghost sm" aria-pressed={side === 'history'} onClick={() => setSide(s => (s === 'history' ? 'inspect' : 'history'))}><HistoryIcon size={13} />History</button>
        <button type="button" className="btn ghost sm wide-only" onClick={copyMermaid} title="Copy the chart as a Mermaid flowchart">Mermaid</button>
        <button type="button" className="btn ghost sm wide-only" onClick={() => download(`${slug}-flow.json`, JSON.stringify(toJson(goal, flow), null, 2))} title="Download the chart as JSON">JSON</button>
      </div>

      <form className="flow-ask" onSubmit={e => { e.preventDefault(); void tell(ask); }}>
        <button type="button" className={'ib flow-mic' + (listen.listening ? ' on' : '')} onClick={mic}
          aria-label={listen.listening ? 'Stop and change it' : 'Say what to change'} title={listen.listening ? 'Stop and change it (⌘K)' : 'Say what to change (⌘K)'}>
          {listen.listening ? <StopIcon size={14} /> : <MicIcon size={15} />}
        </button>
        <input className="input sm" type="text" value={hearing ?? ask} readOnly={hearing != null} disabled={asking} aria-label="What to change on this chart"
          placeholder={wide ? 'Say or type a change: “after the lawyer call, get the board’s approval; signing waits on it”' : 'Say or type a change to this chart'}
          onChange={e => setAsk(e.target.value)} />
        <button type="submit" className="btn pri sm" disabled={asking || !ask.trim()}>{asking ? 'Changing…' : 'Change it'}</button>
      </form>
      {asked && (
        <div className={'flow-asked' + (asked.done ? '' : ' none')} role="status">
          <div className="flow-asked-h">
            <span className="muted sm ell">“{asked.said}”</span>
            <span className="spacer" />
            {asked.done && <button type="button" className="btn text sm" onClick={() => { undo(); setAsked(null); }}>Undo</button>}
            <button type="button" className="ib bare" aria-label="Close" onClick={() => setAsked(null)}><XIcon size={11} /></button>
          </div>
          <p>{asked.reply}</p>
          {asked.lines.length > 0 && <ul>{asked.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          {asked.skipped.length > 0 && <ul className="flow-asked-skip">{asked.skipped.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </div>
      )}

      <div className="flow-body">
        <div ref={stage} className="flow-stage">
        <div ref={scroller} className={'flow-scroll' + (picking ? ' picking' : '') + (dragPos ? ' moving' : '')} onPointerDown={pan} tabIndex={0} aria-label={`Flow chart for ${goal.title}`}
          onDoubleClick={e => {
            // Double-click an empty spot: a step there.
            if ((e.target as HTMLElement).closest('[data-step],button,.fn-goal,.fn-confirm')) return;
            const p = toCanvas(e.clientX, e.clientY);
            addTask({ at: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } });
          }}>
          {(note || picking) && <p className="flow-note" role="status">{picking ? <>Click the step that comes after “{shortTitle(titleOf(picking) ?? '', 40)}” · <kbd>Esc</kbd> to stop</> : note}</p>}
          <div className="flow-size" style={{ width: layout.width * z, height: layout.height * z }}>
            <div ref={canvas} className="flow-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${z})` }}>
              <svg className="flow-svg" width={layout.width} height={layout.height} aria-hidden="true">
                <defs>
                  {(['n', 'c', 'd', 's'] as const).map(k => (
                    <marker key={k} id={`fa-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0 0 L10 5 L0 10 z" className={`fa fa-${k}`} />
                    </marker>
                  ))}
                </defs>
                {flow.roots.map(id => {
                  const c = curve(layout.goal, box(id));
                  return <path key={`g>${id}`} d={c.d} className="fe root" markerEnd="url(#fa-d)" />;
                })}
                {flow.links.map(l => {
                  const key = linkKey(l), c = curve(box(l.from), box(l.to), layout.lanes.get(key));
                  const from = flow.byId.get(l.from) as Step;
                  const cls = sel?.kind === 'link' && sel.key === key ? 's' : flow.critical.links.has(key) ? 'c' : from.done ? 'd' : 'n';
                  return (
                    <g key={key}>
                      <path d={c.d} className={`fe fe-${cls}${l.auto ? ' auto' : ''}`} markerEnd={`url(#fa-${cls})`} />
                      <path d={c.d} className="fe-hit" onClick={e => { e.stopPropagation(); scroller.current?.focus({ preventScroll: true }); setSel({ kind: 'link', key }); }}>
                        <title>{`${from.title} → ${titleOf(l.to)}`}</title>
                      </path>
                    </g>
                  );
                })}
                {live && <path d={live} className="fe fe-s" markerEnd="url(#fa-s)" />}
              </svg>

              <div className="fn-goal" style={{ left: layout.goal.x, top: layout.goal.y, width: layout.goal.w, height: layout.goal.h, ...tint }}>
                <TargetIcon size={16} />
                <span className="fn-t">{goal.title}</span>
                <span className="fn-m num">{flow.counts.done} of {flow.counts.steps} done{flow.older ? ` · ${flow.older} older` : ''}</span>
              </div>

              {flow.steps.map(s => {
                const b = box(s.id);
                const on = sel?.kind === 'step' && sel.id === s.id;
                const sched = s.kind === 'task' && !s.done && s.task?.start != null;
                const cls = `fn fn-${s.kind === 'goal' ? 'sub' : s.kind} ${s.state}${s.critical ? ' crit' : ''}${on ? ' sel' : ''}${picking === s.id ? ' from' : ''}${sched ? ' sched' : ''}${s.repeat ? ' rep' : ''}`
                  + `${dragPos?.id === s.id ? ' dragging' : ''}${lifting === s.id ? ' lifting' : ''}${confirm === s.id ? ' doomed' : ''}`;
                return (
                  <div key={s.id} className={cls} data-step={s.id} style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...tint }}
                    onPointerDown={e => startMove(e, s.id)}
                    onClick={e => { e.stopPropagation(); clickStep(s.id); }}
                    onDoubleClick={s.goal ? e => { e.stopPropagation(); openSheet('flow', (s.goal as Goal).id); } : undefined}
                    title={s.goal ? 'Double-click to open its own chart' : undefined}>
                    {s.kind === 'milestone' && <span className="fn-ms" aria-hidden="true" />}
                    {s.kind === 'goal' && <span className="fn-pp" aria-hidden="true" />}
                    <button type="button" className={'fn-ck' + (s.done ? ' on' : '')} aria-label={`${s.done ? 'Not done' : 'Done'}: ${s.title}`}
                      title={s.kind === 'milestone' ? (s.done ? 'Untick it' : 'Tick it: reached') : s.kind === 'goal' ? (s.done ? 'Bring it back' : 'Achieved') : s.kind === 'wait' ? (s.done ? 'Waiting again' : 'Resolved') : s.done ? 'Reopen' : 'Tick it off'}
                      onClick={e => { e.stopPropagation(); toggle(s); }}><CheckIcon size={10} w={2.6} /></button>
                    <span className="fn-t">{s.kind === 'wait' && <span className="fn-k">Waiting on </span>}{s.title}</span>
                    <span className="fn-m">
                      {s.repeat && (
                        <span className="fn-rep" title={s.repeat.rule}><RepeatIcon size={10} />
                          {s.repeat.week ? <span className="num">{s.repeat.week.done}/{s.repeat.week.per} wk</span> : s.repeat.times ? <span className="num">{s.repeat.done}/{s.repeat.times}</span> : null}
                        </span>
                      )}
                      {sched && <CalendarIcon size={10} />}
                      {s.kind === 'task' && <span className="num">{fmtDur(s.repeat ? s.task?.minutes ?? s.minutes : s.minutes)}</span>}
                      {s.kind === 'goal' && s.progress != null && <span className="fn-bar" aria-hidden="true"><i style={{ width: `${Math.round(s.progress * 100)}%` }} /></span>}
                      <span className={'fn-st ' + s.state}>{stateText(s, flow.byId, now)}</span>
                    </span>
                    {s.kind !== 'milestone' && (
                      <button type="button" className="fn-h" aria-label={`Draw an arrow from ${s.title}`} title="Drag to the step that comes after this one, or click and then click it"
                        onPointerDown={e => startDraw(e, s.id)} onClick={e => e.stopPropagation()} />
                    )}
                    {s.kind !== 'milestone' ? (
                      <>
                        <button type="button" className="fn-add next" aria-label={`Add the next step after ${s.title}`} title="Add the next step (Tab)"
                          onClick={e => { e.stopPropagation(); addTask({ after: s.id }); }}><PlusIcon size={12} /></button>
                        <button type="button" className="fn-add par" aria-label={`Add a step in parallel with ${s.title}`} title="Add a parallel step (Enter)"
                          onClick={e => { e.stopPropagation(); addTask({ beside: s.id }); }}><PlusIcon size={12} /></button>
                      </>
                    ) : (
                      <button type="button" className="fn-add prev" aria-label={`Add a step that leads to ${s.title}`} title="Add a step that leads here (Tab)"
                        onClick={e => { e.stopPropagation(); addTask({ before: s.id }); }}><PlusIcon size={12} /></button>
                    )}
                  </div>
                );
              })}

              {confirm && (() => {
                const s = flow.byId.get(confirm), b = s ? layout.boxes.get(s.id) : null;
                if (!s || !b) return null;
                const external = !!s.task?.externalId;
                const under = s.result ? flatResults(s.result.results ?? []).length : s.goal ? descendantsOf(goals, s.goal.id).filter(d => d.status === 'active').length : 0;
                const what = s.repeat ? `Stop repeating “${shortTitle(s.title, 40)}”?`
                  : s.kind === 'goal' ? `Drop the sub-goal “${shortTitle(s.title, 40)}”${under ? `, and the ${under} under it` : ''}?`
                  : s.kind === 'milestone' ? `Delete the key result “${shortTitle(s.title, 40)}”${under ? `, and the ${under} under it` : ''}?`
                  : s.kind === 'wait' ? `Remove “Waiting on ${shortTitle(s.title, 40)}”?`
                  : external ? `Take “${shortTitle(s.title, 40)}” off this goal?` : `Delete “${shortTitle(s.title, 40)}”?`;
                return (
                  <div className="fn-confirm" role="alertdialog" aria-label={what} style={{ left: b.x, top: b.y + b.h + 10 }}
                    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                    <p>{what}</p>
                    {s.repeat ? <p className="muted sm">No more of it will come{s.task ? ', and the open one goes' : ''}. The ones you’ve done stay done.</p>
                      : s.task && !external && <p className="muted sm">It’s a task in your planner too, so it goes from there as well.</p>}
                    <div className="acts">
                      <button type="button" className="btn sm pri" autoFocus onClick={() => confirmDelete(s)}>
                        {s.repeat ? 'Stop it' : s.kind === 'goal' ? 'Drop it' : s.kind === 'wait' ? 'Remove' : external ? 'Take it off' : 'Delete'}
                      </button>
                      {(s.repeat || (s.task && !external)) && <button type="button" className="btn sec sm" onClick={() => confirmDelete(s, 'off')}>Only off this goal</button>}
                      <button type="button" className="btn text sm" onClick={() => { setConfirm(null); scroller.current?.focus({ preventScroll: true }); }}>Cancel</button>
                    </div>
                    <p className="muted sm"><kbd>Delete</kbd> or <kbd>Enter</kbd> to confirm · <kbd>Esc</kbd> to keep it</p>
                  </div>
                );
              })()}

              {selLink && !selLink.auto && (() => {
                const c = curve(box(selLink.from), box(selLink.to), layout.lanes.get(linkKey(selLink)));
                return (
                  <button type="button" className="fe-x" style={{ left: c.mid.x - 11, top: c.mid.y - 11 }} aria-label="Remove this arrow" title="Remove this arrow (Delete)"
                    onClick={e => { e.stopPropagation(); unlink(selLink); }}><XIcon size={11} /></button>
                );
              })()}

              {!flow.counts.steps && (
                <button type="button" className="flow-first" style={{ left: colX(1), top: layout.goal.y + 8 }} onClick={() => addTask()}>
                  <PlusIcon size={14} />Add the first step
                </button>
              )}
            </div>
          </div>
        </div>

          <div className="flow-pal" role="toolbar" aria-label="Add to the chart">
            {PALETTE.map(x => (
              <button key={x.kind} type="button" className="fp" title={x.hint} aria-label={`Add a ${x.label.toLowerCase()}`}
                onPointerDown={e => fromPalette(e, x.kind)}
                onClick={() => { if (justMoved.current) { justMoved.current = false; return; } addKind(x.kind); }}>
                <Shape kind={x.kind} /><span>{x.label}</span>
              </button>
            ))}
          </div>
          {ghost && <div className={'flow-ghost fn-' + (ghost.kind === 'goal' ? 'sub' : ghost.kind)} style={{ left: ghost.x, top: ghost.y, ...tint }} aria-hidden="true"><Shape kind={ghost.kind} /><span className="ell">{ghost.label}</span></div>}
        </div>

        <aside className="flow-side" aria-label={side === 'history' ? 'History' : showBacklog ? 'Backlog' : 'Step'}>
          {side === 'history' ? <History goal={goal} />
            : showBacklog ? <Backlog title={selStep && selStep.kind !== 'milestone' ? selStep.title : null} onCarry={fromBacklog} onAdd={adoptHere} />
            : selStep ? <Inspector key={selStep.id} s={selStep} flow={flow} focus={focusId === selStep.id} onFocused={() => setFocusId(null)} goal={goal}
              act={{ rename, toggle, link, unlink, addTask, addWait, removeStep, patchTask, addSubGoal, addKr, open: id => openSheet('flow', id), goalById, repeatOf: id => repeats.find(r => r.id === id) ?? null }} />
            : selLink ? (
              <div className="fi">
                <p className="rv-k">Arrow</p>
                {selLink.auto ? (
                  <p className="fi-link"><b>{titleOf(selLink.from)}</b> is part of <b>{titleOf(selLink.to)}</b>: it’s one of the things that has to be true for it. This arrow comes from the goal’s structure.</p>
                ) : (
                  <>
                    <p className="fi-link"><b>{titleOf(selLink.from)}</b> has to be done before <b>{titleOf(selLink.to)}</b> can start.</p>
                    <button type="button" className="btn sec sm" onClick={() => unlink(selLink)}>Remove the arrow</button>
                  </>
                )}
              </div>
            ) : null}
        </aside>
      </div>

      <div className="flow-foot num">
        <span>{flow.counts.steps} step{flow.counts.steps === 1 ? '' : 's'} · {flow.counts.done} done · {flow.counts.ready} ready · {flow.counts.blocked} blocked</span>
        <span className="flow-key"><i className="k-sched" aria-hidden="true" />On the calendar</span>
        <span className="flow-key"><i className="k-blocked" aria-hidden="true" />Blocked</span>
        {flow.critical.steps.length > 0 && (
          <button type="button" className="link" onClick={() => setSel({ kind: 'step', id: flow.critical.steps[0] })}>
            Critical path: {fmtDur(flow.critical.minutes)} over {flow.critical.steps.length} steps
          </button>
        )}
        <span className="spacer" />
        {wide && <span className="muted">Drag a step to move it · Double-click to add · Tab: next · Enter: parallel · Delete: delete · ⌘Z: undo</span>}
      </div>
    </div>
  );
}

/* ---------- the side: one step ---------- */

interface Acts {
  rename: (s: Step, title: string) => void;
  toggle: (s: Step) => void;
  link: (l: Link) => void;
  unlink: (l: Link) => void;
  addTask: (o?: { after?: string; beside?: string; before?: string }) => void;
  addWait: (holds?: string) => void;
  removeStep: (s: Step, how: 'off' | 'delete') => void;
  patchTask: (s: Step, part: Partial<Task>, label: string) => void;
  addSubGoal: (kr?: string) => void;
  addKr: (under: string | null) => void;
  /** Open a goal's own chart. */
  open: (goal: string) => void;
  /** A repeat by id. */
  repeatOf: (id: string) => Repeat | null;
  goalById: (id: string | null | undefined) => Goal | null;
}

const LENGTHS = [15, 30, 60, 90, 120, 240];

function Inspector({ s, flow, focus, onFocused, goal, act }: {
  s: Step; flow: ReturnType<typeof buildFlow>; focus: boolean; onFocused: () => void; goal: Goal; act: Acts;
}) {
  const { now, openEditor, slot } = usePlanner();
  const [title, setTitle] = useState(s.title);
  const [armed, setArmed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setTitle(s.title), [s.title]);
  // A step you just added: type its title straight away. Enter takes you back to the chart.
  useEffect(() => { if (focus && input.current) { input.current.focus(); input.current.select(); onFocused(); } }, [focus, onFocused]);
  const others = flow.steps.filter(x => x.id !== s.id);
  const links = planOf(goal).links;
  const canNeed = others.filter(x => x.kind !== 'milestone' && !s.needs.includes(x.id) && !wouldLoop(links, x.id, s.id));
  const canUnblock = s.kind === 'milestone' ? [] : others.filter(x => !s.unblocks.includes(x.id) && !wouldLoop(links, s.id, x.id));
  const name = (id: string) => flow.byId.get(id)?.title ?? 'a step';
  /** An arrow the goal's structure draws: shown, but changed by moving the key result or sub-goal, not here. */
  const fixed = (from: string, to: string) => flow.links.some(l => l.from === from && l.to === to && l.auto);
  const t = s.task;

  return (
    <div className="fi">
      <p className="rv-k">{s.repeat ? 'Repeating task' : KIND[s.kind]}{s.critical ? ' · on the critical path' : ''}</p>
      <textarea ref={input} className="ed-title sm" rows={2} aria-label="Title" value={title} maxLength={s.kind === 'wait' ? WAIT_TITLE_MAX : 160}
        onChange={e => setTitle(e.target.value)} onBlur={() => act.rename(s, title)}
        onKeyDown={e => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          e.currentTarget.blur();
          (document.querySelector('.flow-scroll') as HTMLElement | null)?.focus({ preventScroll: true });
        }} />
      {s.repeat && (
        <div className="fi-rep">
          <RepeatIcon size={14} />
          <span>
            <b>{s.repeat.rule}</b>
            {s.repeat.times ? <> · <span className="num">{s.repeat.done} of {s.repeat.times} done</span></> : s.repeat.done ? <> · <span className="num">{s.repeat.done} done so far</span></> : null}
          </span>
          {s.repeat.times ? <span className="fi-rep-bar" aria-hidden="true"><i style={{ width: `${Math.round((s.repeat.done / s.repeat.times) * 100)}%` }} /></span> : null}
        </div>
      )}
      {s.repeat?.week && act.repeatOf(s.repeat.id) && <WeekLog repeat={act.repeatOf(s.repeat.id) as Repeat} />}
      <p className={'fi-st ' + s.state}>{stateText(s, flow.byId, now)}{s.state === 'blocked' ? `: waiting for ${s.needs.filter(id => !flow.byId.get(id)?.done).map(id => `“${shortTitle(name(id), 28)}”`).join(', ')}` : ''}</p>

      <div className="acts">
        <button type="button" className={'btn sm ' + (s.done ? 'sec' : 'pri')} onClick={() => act.toggle(s)}>
          {s.kind === 'milestone' ? (s.done ? 'Untick' : 'Tick: reached') : s.kind === 'goal' ? (s.done ? 'Bring it back' : 'Achieved') : s.kind === 'wait' ? (s.done ? 'Waiting again' : 'Resolved') : s.done ? 'Reopen' : 'Done'}
        </button>
        {s.goal && <button type="button" className="btn sec sm" onClick={() => act.open((s.goal as Goal).id)}>Open its chart</button>}
        {t && t.status === 'open' && !t.externalId && (t.start == null
          ? <button type="button" className="btn sec sm" onClick={() => slot(t.id)}>Next free slot</button>
          : <span className="muted sm">{fmtWhen(t.start, now)}</span>)}
      </div>

      {t && !t.externalId && (
        <>
          <div className="fld">
            <span className="flabel">Length</span>
            <div className="chips" role="radiogroup" aria-label="Length">
              {LENGTHS.map(m => <button key={m} type="button" className="chipb num" role="radio" aria-checked={t.minutes === m} onClick={() => act.patchTask(s, { minutes: m }, 'change the length')}>{fmtDur(m)}</button>)}
            </div>
          </div>
          <div className="fld">
            <span className="flabel">Priority</span>
            <div className="seg fill" role="radiogroup" aria-label="Priority">
              {([1, 2, 3] as Priority[]).map(p => <button key={p} type="button" role="radio" aria-checked={t.priority === p} onClick={() => act.patchTask(s, { priority: p }, 'change the priority')}>{PRI[p]}</button>)}
            </div>
          </div>
        </>
      )}

      <div className="fld">
        <span className="flabel">Needs first</span>
        {s.needs.length ? (
          <ul className="fi-list">
            {s.needs.map(id => (
              <li key={id}><span className={'fi-dot ' + (flow.byId.get(id)?.state ?? '')} /><span className="ell">{name(id)}</span>
                {fixed(id, s.id) ? <span className="muted sm" title="Part of the goal’s structure">under it</span>
                  : <button type="button" className="ib bare" aria-label={`Doesn’t need ${name(id)}`} onClick={() => act.unlink({ from: id, to: s.id })}><XIcon size={11} /></button>}</li>
            ))}
          </ul>
        ) : <p className="note">{s.kind === 'milestone' ? 'Nothing leads here yet.' : 'Nothing: it can start now.'}</p>}
        {canNeed.length > 0 && (
          <select className="input sm" value="" aria-label="Add a step this one needs first" onChange={e => { if (e.target.value) act.link({ from: e.target.value, to: s.id }); }}>
            <option value="">{s.kind === 'milestone' ? '+ A step that leads here…' : '+ Needs…'}</option>
            {canNeed.map(x => <option key={x.id} value={x.id}>{x.kind === 'wait' ? 'Waiting on ' : ''}{shortTitle(x.title, 50)}</option>)}
          </select>
        )}
        {s.kind !== 'wait' && <button type="button" className="link sm" onClick={() => act.addWait(s.id)}>+ Waiting on someone or something</button>}
      </div>

      {s.kind !== 'milestone' && (
        <div className="fld">
          <span className="flabel">Then unblocks</span>
          {s.unblocks.length ? (
            <ul className="fi-list">
              {s.unblocks.map(id => (
                <li key={id}><span className={'fi-dot ' + (flow.byId.get(id)?.state ?? '')} /><span className="ell">{name(id)}</span>
                  {fixed(s.id, id) ? <span className="muted sm" title="Part of the goal’s structure">for it</span>
                    : <button type="button" className="ib bare" aria-label={`Doesn’t unblock ${name(id)}`} onClick={() => act.unlink({ from: s.id, to: id })}><XIcon size={11} /></button>}</li>
              ))}
            </ul>
          ) : <p className="note">Nothing yet.</p>}
          {canUnblock.length > 0 && (
            <select className="input sm" value="" aria-label="Add a step this one unblocks" onChange={e => { if (e.target.value) act.link({ from: s.id, to: e.target.value }); }}>
              <option value="">+ Unblocks…</option>
              {canUnblock.map(x => <option key={x.id} value={x.id}>{x.kind === 'milestone' ? '◆ ' : x.kind === 'wait' ? 'Waiting on ' : ''}{shortTitle(x.title, 50)}</option>)}
            </select>
          )}
        </div>
      )}

      {s.goal && (
        <p className="note">
          {s.goal.results.length ? `${s.goal.results.length} key result${s.goal.results.length === 1 ? '' : 's'} of its own. ` : 'No key results of its own yet: open its chart to add them. '}
          {s.goal.parentKr ? <>It’s there for “{shortTitle(flow.byId.get(`kr:${s.goal.parentKr}`)?.title ?? '', 40)}”.</> : 'It’s for this goal as a whole.'}
        </p>
      )}

      <div className="acts fi-acts">
        {s.kind === 'milestone'
          ? <>
            <button type="button" className="btn sec sm" onClick={() => act.addTask({ before: s.id })}><PlusIcon size={12} />A step that leads here</button>
            {(s.depth ?? 0) < 2 && <button type="button" className="btn sec sm" onClick={() => act.addKr(s.result?.id ?? null)}><PlusIcon size={12} />Key result under it</button>}
            <button type="button" className="btn sec sm" onClick={() => act.addSubGoal(s.result?.id)}><PlusIcon size={12} />Sub-goal for it</button>
          </>
          : <>
            <button type="button" className="btn sec sm" onClick={() => act.addTask({ after: s.id })}><PlusIcon size={12} />Next step</button>
            <button type="button" className="btn sec sm" onClick={() => act.addTask({ beside: s.id })}><PlusIcon size={12} />Parallel step</button>
          </>}
      </div>

      {t && !t.externalId && (
        <button type="button" className="link sm fi-rep-edit" onClick={() => openEditor(t.id)}>
          <RepeatIcon size={11} />{s.repeat ? 'Change how it repeats, or when it ends' : 'Make it repeat: days of the week, monthly, until a date or a number of times'}
        </button>
      )}

      <div className="acts fi-end">
        {t && <button type="button" className="btn text sm" onClick={() => openEditor(t.id)}>Open in the editor</button>}
        <span className="spacer" />
        {s.kind === 'wait' && <button type="button" className="btn text sm warn" onClick={() => act.removeStep(s, 'off')}>Remove</button>}
        {s.goal && <button type="button" className="btn text sm warn" onClick={() => act.removeStep(s, 'off')}>Drop this sub-goal</button>}
        {s.result && <button type="button" className="btn text sm warn" onClick={() => act.removeStep(s, 'off')}>Delete key result</button>}
        {s.repeat && <button type="button" className="btn text sm" onClick={() => act.removeStep(s, 'off')}>Take off this goal</button>}
        {s.repeat && <button type="button" className="btn text sm warn" onClick={() => act.removeStep(s, 'delete')}>Stop repeating</button>}
        {t && !s.repeat && <button type="button" className="btn text sm" onClick={() => act.removeStep(s, 'off')}>Take off this goal</button>}
        {t && !t.externalId && !s.repeat && (
          <button type="button" className="btn text sm warn" onBlur={() => setArmed(false)} onClick={() => { if (!armed) { setArmed(true); return; } act.removeStep(s, 'delete'); }}>
            {armed ? 'Click again to delete' : 'Delete'}
          </button>
        )}
      </div>
      {s.kind === 'milestone' && <p className="note">Key results are the goal’s “Done when” lines, as milestones. One with key results under it is done when they all are.</p>}
    </div>
  );
}

/** Off-goal tasks, to bring onto this goal: drag one onto the chart, or + to add it after the selected step. */
function Backlog({ title, onCarry, onAdd }: { title: string | null; onCarry: (e: React.PointerEvent, t: Task) => void; onAdd: (t: Task) => void }) {
  const { tasks, isOff, goalOf, now, wide } = usePlanner();
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = tasks.filter(t => t.status === 'open' && !isEvent(t) && !isOff(t) && !goalOf(t));
  const list = all.filter(t => words.every(w => t.title.toLowerCase().includes(w)))
    .sort((a, b) => a.priority - b.priority || (a.start ?? Infinity) - (b.start ?? Infinity) || (b.created || 0) - (a.created || 0));
  return (
    <div className="fi fb">
      <div className="fi-hh"><p className="rv-k">Backlog · off-goal</p><span className="muted sm num">{all.length}</span></div>
      <p className="note">
        {wide ? 'Drag a task onto the chart to put it on this goal: onto a step to follow it, or anywhere. Or ' : 'Tap '}
        <b>+</b> to add it{title ? <> after “{shortTitle(title, 30)}”</> : null}.
      </p>
      {all.length > 6 && <input className="input sm" type="search" placeholder="Find a task" value={q} aria-label="Find an off-goal task" onChange={e => setQ(e.target.value)} />}
      {list.length ? (
        <ul className="fb-list">
          {list.slice(0, 200).map(t => (
            <li key={t.id} className={'fb-i' + (t.start != null ? ' sched' : '')} onPointerDown={e => onCarry(e, t)} title={wide ? 'Drag onto the chart' : undefined}>
              <span className={`fb-p p${t.priority}`} title={PRI[t.priority]} aria-label={PRI[t.priority]} />
              <span className="fb-t">{occurrenceOf(t.id) && <RepeatIcon size={11} />}{t.title}</span>
              <span className="fb-m num">{t.start != null ? <><CalendarIcon size={10} />{fmtWhen(t.start, now)}</> : fmtDur(t.minutes)}</span>
              <button type="button" className="ib bare" aria-label={`Put “${t.title}” on this goal`} title={title ? `Add it after “${title}”` : 'Add it to the chart'} onClick={() => onAdd(t)}><PlusIcon size={13} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="note">{q ? 'No off-goal task matches.' : 'Nothing off-goal: every task is on a goal.'}</p>}
    </div>
  );
}

/* ---------- the side: history ---------- */

function History({ goal }: { goal: Goal }) {
  const { readGoalLog, now } = usePlanner();
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    readGoalLog().then(l => { if (alive) setEntries(l.filter(e => e.goal === goal.id).reverse()); });
    return () => { alive = false; };
  }, [readGoalLog, goal.id]);
  if (!entries) return <div className="fi"><p className="note">Reading the history…</p></div>;
  const days = new Map<string, LogEntry[]>();
  for (const e of entries) { const k = ymd(e.at); days.set(k, [...(days.get(k) ?? []), e]); }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ goal: { id: goal.id, title: goal.title }, history: [...entries].reverse() }, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'goal-history.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="fi">
      <div className="fi-hh"><p className="rv-k">History</p><span className="spacer" />{entries.length > 0 && <button type="button" className="link sm" onClick={download}>Download</button>}</div>
      {!entries.length && <p className="note">Nothing yet. Every step you add, link, finish or rename shows up here, so you can see how the plan changed.</p>}
      {[...days].map(([day, list]) => (
        <section key={day} className="fh-day">
          <h4>{day === ymd(now) ? 'Today' : longDate(list[0].at)}</h4>
          <ul>
            {list.map((e, i) => (
              <li key={i} className={'fh ' + e.op}><span className="fh-t num">{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span>{describeEntry(e)}</span></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** A goal's chart, for what's blocked on it. */
export function useGoalFlow(goal: Goal) {
  const { tasks, now, goals, repeats } = usePlanner();
  return useMemo(() => buildFlow(goal, tasks, now, { goals, repeats }), [goal, tasks, now, goals, repeats]);
}

/** The goal's step count, for buttons that open its chart. */
export const useFlowCount = (goal: Goal) => useGoalFlow(goal).counts;
