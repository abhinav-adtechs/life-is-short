'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newId, PRI, type Priority, type Task } from '@/lib/model';
import { addGoal, addResult, ancestorsOf, descendantsOf, flatResults, makeGoal, newResultId, patchGoal, patchResult, setGoalStatus, type Goal } from '@/lib/goals';
import {
  FINISH, buildFlow, describeEntry, goalNode, linkKey, type Flow, newWaitId, parallelLinks, patchWait, planOf, toJson, withLink, withPos, withWait,
  withoutLink, withoutPos, withoutStep, wouldLoop, WAIT_TITLE_MAX, type Link, type LogEntry, type Plan, type Pos, type Step, type StepKind,
} from '@/lib/flow';
import {
  OPENED_KEY, GAP_X, GOAL_W, NODE_H, NODE_W, RING, RING_TOP, ROW_H, buildTree, clash, edgeKey, layoutTree, nodeKey, normalizeCollapsed, pathD,
  toMermaidTree, toggleCollapsed, type Box, type Card, type Edge, type FlowTree, type Pt, type TreeLayout,
} from '@/lib/flowTree';
import { pickNext } from '@/lib/route';
import { dayWord, fmtDur, fmtShort, fmtWhen, longDate, shortDate, shortTitle } from '@/lib/format';
import { fromYmd, ymd } from '@/lib/time';
import { usePlanner } from './Planner';
import { isEvent } from '@/lib/select';
import { dayName, occurrenceOf, type Repeat } from '@/lib/repeat';
import { WeekLog } from './Repeating';
import {
  CalendarIcon, CheckIcon, ChevronDown, ChevronLeft, ClockIcon, FitIcon, FlagIcon, HistoryIcon, HourglassIcon, InboxIcon, LockIcon, MicIcon, MinusIcon,
  MoreIcon, OpenIcon, PlayIcon, PlusIcon, RepeatIcon, RouteIcon, SparkIcon, StopIcon, TrophyIcon, UndoIcon, XIcon, MapIcon,
} from './icons';
import { askWorkflow } from '@/lib/api';
import { promptContext } from '@/lib/capture';
import { joinWords } from '@/lib/speech';
import { applyWorkflow, normalizeOps, recordedIds, taskLinesFor, workflowPrompt, type WorkflowResult } from '@/lib/workflow';
import { noVoiceText, useVoice } from './hooks';
import { Ring, RouteList, shareOf, waited } from './Route';
import { daysLeft } from './Goals';

/*
 * A goal's map: the route to the goal, which is the finish on the right. Done steps sit behind you, the one to do now
 * is lit, locked steps wait their turn, and the route fills in with the goal's colour as you go. The map fills the
 * screen; its controls float over it: where you are and how far along (top left), undo and the rest (top right), the
 * minimap and zoom (bottom left), and a dock to add steps, bring in the backlog or say what to change (bottom).
 *
 * Dragging shows what will happen before you let go: a step dropped on an arrow goes in between and what comes after
 * moves along to make room; on a step, it comes after it (or before it, or alongside); anywhere else, it goes there.
 * Arrows are drawn by dragging from a step's dot to the step after it; let go on an empty spot and a new step goes
 * there. On a phone the goal opens as its route (components/Route.tsx), the map a tap away.
 */

/** Steps moved by hand land on this grid, so rows line up. */
const SNAP = 8;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const reduced = () => typeof window !== 'undefined' && (document.documentElement.dataset.motion === 'reduce' || (document.documentElement.dataset.motion !== 'full' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));

/**
 * Sub-goals you've opened in place on a map, kept in this browser: each is one card (a stack, with its own ring) until
 * you open it, on every map it's on, so a map starts compact.
 */
function useOpened() {
  const [list, setList] = useState<string[]>(() => {
    try { return normalizeCollapsed(JSON.parse(localStorage.getItem(OPENED_KEY) || '[]')); } catch { return []; }
  });
  const toggle = useCallback((id: string) => setList(l => {
    const next = toggleCollapsed(l, id);
    try { localStorage.setItem(OPENED_KEY, JSON.stringify(next)); } catch { /* private mode: for this visit only */ }
    return next;
  }), []);
  return { opened: useMemo(() => new Set(list), [list]), fold: toggle };
}

/* ---------- words ---------- */

const KIND = { task: 'Step', wait: 'Waiting on', goal: 'Sub-goal', milestone: 'Key result' } as const;

/** What the dock adds, in the shapes they have on the map. */
const TOOLS: { kind: StepKind; label: string; hint: string }[] = [
  { kind: 'task', label: 'Step', hint: 'A step towards the goal. Drag it onto the map, or click to add it after the selected step (Tab).' },
  { kind: 'wait', label: 'Waiting on', hint: 'Something out of your hands: a reply, a signature. Drop it on the step it holds up.' },
  { kind: 'goal', label: 'Sub-goal', hint: 'A goal under this one, with its own steps. Drop it on the key result it serves.' },
  { kind: 'milestone', label: 'Key result', hint: 'What has to be true for the goal to be done. Drop it on a key result to put it under that one.' },
];

/** A tool's shape, small, for the dock. */
function ToolShape({ kind }: { kind: StepKind }) {
  return (
    <svg className="mp-shape" width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
      {kind === 'task' && <><rect x="1.5" y="3" width="23" height="14" rx="4" className="s-card" /><circle cx="7.5" cy="10" r="2.6" className="s-ring" /><path d="M12.5 10h8" className="s-line" /></>}
      {kind === 'wait' && <><rect x="1.5" y="3.5" width="23" height="13" rx="6.5" className="s-wait" /><path d="M6.5 6.5h4M6.5 13.5h4M7 6.5c0 2 3 2 3 3.5S7 11.5 7 13.5" className="s-sand" /></>}
      {kind === 'goal' && <><rect x="5" y="6" width="19" height="12" rx="3.5" className="s-back" /><rect x="1.5" y="2.5" width="19" height="12" rx="3.5" className="s-card" /><circle cx="7.5" cy="8.5" r="2.7" className="s-ring" strokeDasharray="11 6" /></>}
      {kind === 'milestone' && <><path d="M1.5 4.5a1.5 1.5 0 011.5-1.5h16l5 7-5 7H3a1.5 1.5 0 01-1.5-1.5z" className="s-card" /><path d="M7 14V6.2M7 6.5h5.5l-1.2 2 1.2 2H7" className="s-flag" /></>}
    </svg>
  );
}

/** A step's state in words, for the side panel. `empty` is a sub-goal with nothing on its own chart yet. */
function stateText(s: Step, byId: Map<string, Step>, now: number, empty = false) {
  const open = s.needs.filter(id => !byId.get(id)?.done).length;
  if (s.kind === 'goal') {
    if (s.done) return 'Achieved';
    if (s.state === 'blocked') return `Locked until ${open} step${open === 1 ? '' : 's'} before it ${open === 1 ? 'is' : 'are'} done`;
    if (empty) return 'No steps yet';
    return `${s.progress != null ? `${Math.round(s.progress * 100)}% there` : 'Not started'}${s.minutes ? ` · ${fmtDur(s.minutes)} left` : ''}`;
  }
  if (s.kind === 'milestone') return s.done ? 'Reached' : s.state === 'reached' ? 'Everything before it is done: tick it' : s.needs.length ? `After ${s.needs.length} step${s.needs.length === 1 ? '' : 's'}` : 'Nothing leads here yet';
  if (s.kind === 'wait') return s.done ? 'Heard back' : s.state === 'blocked' ? 'Waiting, and held up itself' : `Out of your hands for ${waited(s.wait?.created ?? now, now).toLowerCase()}`;
  if (s.repeat) {
    const { times, next } = s.repeat;
    if (s.done) return times ? `All ${times} done` : 'Over';
    return s.state === 'blocked' ? `Locked until ${open} step${open === 1 ? '' : 's'} before it ${open === 1 ? 'is' : 'are'} done`
      : s.task ? (s.task.start != null ? fmtWhen(s.task.start, now) : 'Ready') : next ? `Next one ${dayName(next, now)}` : 'Nothing more to come';
  }
  if (s.done) return 'Done';
  if (s.state === 'blocked') return `Locked until ${open} step${open === 1 ? '' : 's'} before it ${open === 1 ? 'is' : 'are'} done`;
  return s.task?.start != null ? `Ready · ${fmtWhen(s.task.start, now)}` : 'Ready. Nothing is in its way.';
}

/** How much of a goal's work is done, counted as its card on the main page counts it: its tasks and its sub-goals'. */
function useShare(goal: Goal) {
  const { tasks, goals, isOff } = usePlanner();
  return useMemo(() => {
    const ids = new Set([goal.id, ...descendantsOf(goals, goal.id).map(g => g.id)]);
    let open = 0, done = 0;
    for (const t of tasks) {
      if (!t.goal || !ids.has(t.goal) || isOff(t) || isEvent(t)) continue;
      if (t.status === 'done') done++; else open++;
    }
    return open + done ? done / (open + done) : 0;
  }, [tasks, goals, goal.id, isOff]);
}

/** A number that counts its way to a new value. */
function useCountUp(value: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced()) { setShown(value); from.current = value; return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900), v = a + (value - a) * (1 - Math.pow(1 - k, 3));
      setShown(v); from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

/* ---------- the panel ---------- */

/** The goal in the address (#flow/<goal id>): its map; on a phone, its route first. */
export function FlowPanel() {
  const { section, goalById, closeSheet, openSheet, goalsLoaded, wide } = usePlanner();
  const goal = goalById(section);
  const [view, setView] = useState<'route' | 'map'>(wide ? 'map' : 'route');
  if (!goal && !goalsLoaded) return <div className="mp-wait"><p className="note">Opening the map…</p></div>;
  if (!goal) {
    return (
      <div className="mp-wait">
        <p className="note">That goal isn’t here any more. <button type="button" className="link" onClick={() => openSheet('goals')}>Back to your goals</button> or <button type="button" className="link" onClick={closeSheet}>close</button>.</p>
      </div>
    );
  }
  if (!wide && view === 'route') return <RoutePage key={goal.id} goal={goal} onMap={() => setView('map')} />;
  return <FlowChart key={goal.id} goal={goal} onRoute={wide ? undefined : () => setView('route')} />;
}

/** A goal on a phone: its ring, then its route, with the map a tap away. */
function RoutePage({ goal, onMap }: { goal: Goal; onMap: () => void }) {
  const { prefs, now, closeSheet, goals, openSheet } = usePlanner();
  const share = useShare(goal);
  const section = prefs.labels.find(l => l.id === goal.section) ?? null;
  const left = goal.by ? daysLeft(goal.by, now) : null;
  const up = ancestorsOf(new Map(goals.map(g => [g.id, g])), goal);
  return (
    <div className="ru-page" style={section ? ({ '--c': section.color } as React.CSSProperties) : undefined}>
      <div className="ru-pbar">
        <button type="button" className="ib bare touch" aria-label="Close" onClick={closeSheet}><ChevronLeft size={18} /></button>
        <span className="spacer" />
        <button type="button" className="btn sec sm" onClick={onMap}><MapIcon size={14} />Map</button>
        <button type="button" className="ib bare touch" aria-label="Close" onClick={closeSheet}><XIcon size={16} /></button>
      </div>
      <div className="ru-hero">
        <span className="ru-hring"><Ring value={share} size={76} stroke={7} label={false} /><b className="num">{Math.round(share * 100)}%</b></span>
        <div>
          {up.length > 0 && <button type="button" className="ru-up" onClick={() => openSheet('flow', up[0].id)}>{shortTitle(up[0].title, 34)} ›</button>}
          <h2>{goal.title}</h2>
          <p>{[section?.name, goal.by ? `by ${fromYmd(goal.by).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : null, left?.text].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <RouteList goal={goal} />
    </div>
  );
}

type Sel = { kind: 'step'; id: string } | { kind: 'link'; key: string } | null;
/** A key press, from React or straight from the window. */
type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'preventDefault'> & { target: EventTarget | null };

/**
 * Whose chart a change is on: this goal's, or a sub-goal's open inside it. Its plan, its key results and its tasks are
 * the ones that change, as on its own map; `key` is how its steps are known on this one.
 */
interface On { goal: Goal; flow: Flow; top: boolean; key: (id: string) => string }

/** Where something carried onto the map would go. */
type Drop =
  | { type: 'between'; edge: string; on: On; link: Link }
  | { type: 'after' | 'before' | 'beside' | 'holds' | 'under'; card: string; on: On }
  | { type: 'at'; at: Pos; on: On };

/** What's being carried, and where it is on the screen. */
interface Carry { kind: StepKind; label: string; task?: Task; x: number; y: number; drop: Drop | null }

/* ---------- moving between layouts: what moves slides there ---------- */

interface Shown { cards: Map<string, Box>; goal: Box; port: Pt; moving: boolean }

function useTween(layout: TreeLayout, skip: boolean): Shown {
  const shown = useRef<Shown | null>(null);
  const from = useRef<Shown | null>(null);
  const prev = useRef<TreeLayout | null>(null);
  const [k, setK] = useState(1);
  const raf = useRef(0);
  useLayoutEffect(() => {
    if (prev.current === layout) return;
    prev.current = layout;
    const had = shown.current;
    cancelAnimationFrame(raf.current);
    if (skip || !had || reduced()) { from.current = null; setK(1); return; }
    let moved = Math.abs(had.goal.x - layout.goal.x) > 1 || Math.abs(had.goal.y - layout.goal.y) > 1;
    for (const [key, c] of layout.cards) {
      const a = had.cards.get(key), b = c.box;
      if (a && (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1 || Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1)) { moved = true; break; }
    }
    if (!moved) { from.current = null; setK(1); return; }
    from.current = had;
    const t0 = performance.now();
    setK(0);
    const step = (t: number) => { const p = Math.min(1, (t - t0) / 320); setK(p); if (p < 1) raf.current = requestAnimationFrame(step); };
    raf.current = requestAnimationFrame(step);
  }, [layout, skip]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const f = k < 1 ? from.current : null;
  const e = 1 - Math.pow(1 - k, 3);
  const lerp = (a: Box | undefined, b: Box): Box => (a && f ? { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, w: a.w + (b.w - a.w) * e, h: a.h + (b.h - a.h) * e } : b);
  const cards = new Map([...layout.cards].map(([key, c]) => [key, lerp(f?.cards.get(key), c.box)]));
  const goal = lerp(f?.goal, layout.goal);
  const out: Shown = { cards, goal, port: { x: goal.x + (GOAL_W - RING) / 2, y: goal.y + RING_TOP + RING / 2 }, moving: !!f };
  shown.current = out;
  return out;
}

/** A plain connector between two boxes, for while things are moving. */
const plainD = (a: Box, b: Pt) => {
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, dx = Math.max(32, (b.x - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${b.x - dx} ${b.y}, ${b.x - 4} ${b.y}`;
};

/* ---------- the map ---------- */

function FlowChart({ goal, onRoute }: { goal: Goal; onRoute?: () => void }) {
  const { tasks, now, prefs, wide, store, changeGoals, logGoal, openSheet, closeSheet, goals, goalById, repeats, applyRepeats, liveTasks, voice, slot } = usePlanner();
  const [all, setAll] = useState(false);
  const tree = useMemo(() => buildTree(goal, tasks, now, { all, goals, repeats }), [goal, tasks, now, all, goals, repeats]);
  const flow = tree.flow;
  const trail = useMemo(() => ancestorsOf(new Map(goals.map(g => [g.id, g])), goal).reverse(), [goals, goal]);
  /** The step being dragged, where it is now. */
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [lifting, setLifting] = useState<string | null>(null);
  const pinned = goal.plan?.pos;
  const { opened, fold } = useOpened();
  /** What the map would be after a drop, or after a change you asked for: shown before it's made. */
  const [preview, setPreview] = useState<{ tasks: Task[]; goals: Goal[]; ghost: string | null } | null>(null);
  const view = useMemo(() => {
    if (!preview) return tree;
    const g = preview.goals.find(x => x.id === goal.id) ?? goal;
    return buildTree(g, preview.tasks, now, { all, goals: preview.goals, repeats });
  }, [preview, tree, goal, now, all, repeats]);
  const viewPinned = preview ? (preview.goals.find(x => x.id === goal.id)?.plan?.pos ?? pinned) : pinned;
  const layout = useMemo(() => layoutTree(view, { open: id => opened.has(id), pos: viewPinned, drag: dragPos }), [view, opened, viewPinned, dragPos]);
  const base = useMemo(() => (preview ? layoutTree(tree, { open: id => opened.has(id), pos: pinned }) : layout), [preview, tree, opened, pinned, layout]);
  const shown = useTween(layout, !!dragPos);
  const [sel, setSel] = useState<Sel>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const vp = useRef<HTMLDivElement>(null);
  const justMoved = useRef(false);
  const [cam, setCamState] = useState({ x: 40, y: 80, z: 1 });
  const camRef = useRef(cam);
  const setCam = useCallback((c: { x: number; y: number; z: number }) => { camRef.current = c; setCamState(c); }, []);
  const [panel, setPanel] = useState<'inspect' | 'history'>('inspect');
  const [tray, setTray] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<{ id: number; msg: React.ReactNode; undo?: boolean } | null>(null);
  const [drawing, setDrawing] = useState<{ from: string; x: number; y: number; moved: boolean; to: string | null; bad: string | null } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const undos = useRef<{ label: string; run: () => void }[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ h?: { y: number; x1: number; x2: number }; v?: { x: number; y1: number; y2: number } }>({});
  const [carrying, setCarrying] = useState<Carry | null>(null);
  /** Just ticked off: the arrows out of it paint in, and the steps it opened rise. */
  const [fresh, setFresh] = useState<{ edges: Set<string>; opened: Set<string>; at: number } | null>(null);
  const [vpSize, setVpSize] = useState({ w: 1200, h: 800 });
  const section = prefs.labels.find(l => l.id === goal.section) ?? null;
  const tint = section ? ({ '--c': section.color } as React.CSSProperties) : undefined;
  const share = useShare(goal);
  const pct = useCountUp(share);

  const say = useCallback((msg: React.ReactNode, undo = false) => {
    const id = Date.now() + Math.random();
    setToast({ id, msg, undo });
    window.setTimeout(() => setToast(t => (t?.id === id ? null : t)), undo ? 5200 : 3600);
  }, []);
  const remember = (label: string, run: () => void) => { undos.current = [...undos.current.slice(-29), { label, run }]; setUndoLabel(label); };
  const undo = () => {
    const u = undos.current.pop();
    setUndoLabel(undos.current[undos.current.length - 1]?.label ?? null);
    if (u) { u.run(); say(`Undid: ${u.label}`); }
  };

  /* ---------- whose chart: this goal's, or a sub-goal's inside it ---------- */

  const onTree = (t: FlowTree): On => (t.goal.id === goal.id
    ? { goal, flow, top: true, key: id => id }
    : { goal: t.goal, flow: t.flow, top: false, key: id => nodeKey(goal.id, t.goal.id, id) });
  const TOP = onTree(tree);
  const cardOf = (key: string | null | undefined): Card | null => (key ? layout.cards.get(key) ?? null : null);
  const onOf = (c: Card | null): On => (c ? onTree(c.tree) : TOP);
  /** The chart a spot on the map is in: the innermost open sub-goal around it, or this goal's. */
  const onAt = (p: Pos): On => {
    let best: (typeof layout.frames)[number] | null = null;
    for (const f of layout.frames) {
      const b = f.box;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h && (!best || f.depth > best.depth)) best = f;
    }
    const sub = best ? cardOf(best.key)?.sub : null;
    return sub ? onTree(sub) : TOP;
  };

  /** Change a goal's plan (this one's, or a sub-goal's), laid over whatever it is by the time it's saved. Returns what undoes it. */
  const plan = (f: (p: Plan) => Plan, g: Goal = goal) =>
    changeGoals(list => list.map(x => (x.id === g.id ? { ...x, plan: f(planOf(x)), updatedAt: Date.now() } : x)));
  const titleOf = (id: string, on: On = TOP) => on.flow.byId.get(id)?.title;
  const log = (e: Omit<LogEntry, 'at' | 'goal'>, on: On = TOP) => logGoal([{ at: Date.now(), goal: on.goal.id, ...e }]);

  /* ---------- changes ---------- */

  const link = (l: Link, on: On = TOP) => {
    const cur = planOf(on.goal);
    if (cur.links.some(e => e.from === l.from && e.to === l.to)) return;
    if (wouldLoop(cur.links, l.from, l.to)) { say('That arrow would make a loop: one of these already leads to the other.'); return; }
    const back = plan(p => withLink(p, l), on.goal);
    log({ op: 'link', step: l.to, title: titleOf(l.to, on), from: l.from, fromTitle: titleOf(l.from, on) }, on);
    remember('draw the arrow', back);
    setSel({ kind: 'link', key: edgeKey(goal.id, on.goal.id, l) });
    say(<><b>{shortTitle(titleOf(l.to, on) ?? '', 36)}</b> now waits for <b>{shortTitle(titleOf(l.from, on) ?? '', 36)}</b></>, true);
  };

  const unlink = (l: Link, on: On = TOP) => {
    const back = plan(p => withoutLink(p, l), on.goal);
    log({ op: 'unlink', step: l.to, title: titleOf(l.to, on), from: l.from, fromTitle: titleOf(l.from, on) }, on);
    remember('remove the arrow', back);
    setSel(null);
  };

  /** An arrow between two steps on the map, by their keys: both have to be on the same goal's chart. */
  const canJoin = (a: string, b: string): string | null => {
    const x = cardOf(a), y = cardOf(b);
    if (!x || !y || x === y) return 'Pick another step';
    if (x.tree !== y.tree) return `That’s on “${shortTitle(y.tree.goal.title, 26)}”: arrows join steps of one goal`;
    if (x.step.kind === 'milestone') return 'A key result leads on to the goal';
    const links = planOf(x.tree.goal).links;
    if (links.some(l => l.from === x.id && l.to === y.id)) return 'Already joined';
    if (wouldLoop(links, x.id, y.id) || x.tree.flow.links.some(l => l.from === y.id && l.to === x.id)) return 'That would make a loop';
    return null;
  };
  const join = (a: string, b: string) => {
    const x = cardOf(a), y = cardOf(b);
    const why = canJoin(a, b);
    if (why || !x || !y) { if (why) say(why); return; }
    link({ from: x.id, to: y.id }, onOf(x));
  };

  /** The nearest free place at or below `p`, on the grid, clear of every card and open sub-goal. */
  const freeAt = (p: Pos): Pos => {
    const taken = [layout.goal, ...[...layout.cards.values()].map(c => c.box)];
    const b = { x: snap(Math.max(0, p.x)), y: snap(Math.max(0, p.y)), w: NODE_W, h: NODE_H };
    for (let i = 0; i < 200 && taken.some(o => clash(b, o)); i++) b.y += ROW_H;
    return { x: b.x, y: b.y };
  };
  /**
   * Where a new step goes by hand: where you dropped it; or, once you've moved steps yourself, next to the step it's
   * added to. Null leaves it to the layout, as always inside a sub-goal: that's laid out for you.
   */
  const spotFor = (o: { at?: Pos; after?: string; beside?: string; before?: string }, on: On = TOP): Pos | null => {
    if (!on.top) return null;
    if (o.at) return freeAt(o.at);
    const anchor = o.after ?? o.beside ?? o.before;
    const b = pinned && anchor ? cardOf(anchor)?.box : null;
    if (!b) return null;
    if (o.after) return freeAt({ x: b.x + b.w + GAP_X, y: b.y });
    if (o.beside) return freeAt({ x: b.x, y: b.y + ROW_H });
    const x = b.x - NODE_W - GAP_X;
    return x < 0 ? freeAt({ x: b.x, y: b.y + ROW_H }) : freeAt({ x, y: b.y });
  };

  const newTask = (on: On, title = 'New step'): Task => {
    const at = Date.now();
    return {
      id: newId(), title, raw: '', notes: '', priority: 2, minutes: 60, start: null, due: null, status: 'open',
      created: at, order: at, doneAt: null, goal: on.goal.id, label: on.goal.section ?? null, updatedAt: at,
    };
  };

  /** A new task on a goal: after `after`, or alongside `beside`, or before `before`, between the two ends of `between`, or on its own (at `at`). */
  const addTask = (opts: { after?: string; beside?: string; before?: string; at?: Pos; between?: Link } = {}, on: On = TOP) => {
    const t = newTask(on);
    const before = store.write([t]);
    const cur = planOf(on.goal);
    const b = opts.between;
    const links = b ? [{ from: b.from, to: t.id }, { from: t.id, to: b.to }]
      : opts.after ? [{ from: opts.after, to: t.id }] : opts.before ? [{ from: t.id, to: opts.before }] : opts.beside ? parallelLinks(cur, opts.beside, t.id) : [];
    const spot = b ? null : spotFor(opts, on);
    const back = links.length || spot || b ? plan(p => { const q = links.reduce(withLink, b ? withoutLink(p, b) : p); return spot ? withPos(q, t.id, spot) : q; }, on.goal) : () => undefined;
    log({ op: 'add', step: t.id, title: t.title }, on);
    remember('add the step', () => { back(); store.restore(before); });
    setSel({ kind: 'step', id: on.key(t.id) });
    setPanel('inspect');
    setFocusId(on.key(t.id));
  };

  const addWait = (holds?: string, at?: Pos, on: On = TOP, between?: Link) => {
    const w = { id: newWaitId(), title: 'Someone or something', done: false, created: Date.now(), doneAt: null };
    const spot = between ? null : spotFor({ at, before: holds }, on);
    const back = plan(p => {
      let q = withWait(p, w);
      if (between) q = withLink(withLink(withoutLink(q, between), { from: between.from, to: w.id }), { from: w.id, to: between.to });
      else if (holds) q = withLink(q, { from: w.id, to: holds });
      return spot ? withPos(q, w.id, spot) : q;
    }, on.goal);
    log({ op: 'wait', step: w.id, title: w.title }, on);
    remember('add the waiting step', back);
    setSel({ kind: 'step', id: on.key(w.id) });
    setPanel('inspect');
    setFocusId(on.key(w.id));
  };

  const rename = (s: Step, title: string, on: On = TOP) => {
    const v = title.replace(/\s+/g, ' ').trim();
    if (!v || v === s.title) return;
    if (s.kind === 'task' && s.task) { const before = store.patch(s.task.id, { title: v.slice(0, 160) }); remember('rename', () => store.restore(before)); return; }
    const r = s.repeat ? repeats.find(x => x.id === s.repeat?.id) : null;
    if (r) { remember('rename', applyRepeats([{ kind: 'set', repeat: { ...r, title: v.slice(0, 160), updatedAt: Date.now() } }])); return; }
    if (s.kind === 'wait') {
      const back = plan(p => patchWait(p, s.id, { title: v.slice(0, WAIT_TITLE_MAX) }), on.goal);
      log({ op: 'rename', step: s.id, title: v, was: s.title }, on);
      remember('rename', back);
      return;
    }
    if (s.result) {
      const back = changeGoals(patchResult(on.goal.id, s.result.id, { text: v.slice(0, 120) }));
      log({ op: 'rename', step: s.id, title: v, was: s.title }, on);
      remember('rename', back);
      return;
    }
    if (s.goal) {
      const back = changeGoals(patchGoal(s.goal.id, { title: v.slice(0, 80) }));
      log({ op: 'rename', step: s.id, title: v, was: s.title }, on);
      remember('rename', back);
    }
  };

  /** A sub-goal of a goal on the map: for one of its key results, or for that goal as a whole. */
  const addSubGoal = (kr?: string, at?: Pos, on: On = TOP) => {
    const g = makeGoal({ title: 'New sub-goal', section: on.goal.section, parent: on.goal.id, parentKr: kr ?? null });
    const spot = spotFor({ at, before: kr ? `kr:${kr}` : undefined }, on);
    const back = changeGoals(addGoal(g));
    const put = spot ? plan(p => withPos(p, goalNode(g), spot), on.goal) : () => undefined;
    log({ op: 'add', step: goalNode(g), title: g.title }, on);
    remember('add the sub-goal', () => { put(); back(); });
    setSel({ kind: 'step', id: on.key(goalNode(g)) });
    setPanel('inspect');
    setFocusId(on.key(goalNode(g)));
  };

  /** A key result: under another one, or for the goal itself. */
  const addKr = (under: string | null, at?: Pos, on: On = TOP) => {
    const id = newResultId();
    const spot = spotFor({ at, beside: under ? `kr:${under}` : undefined }, on);
    const back = changeGoals(addResult(on.goal.id, under, 'New key result', Date.now(), id));
    const put = spot ? plan(p => withPos(p, `kr:${id}`, spot), on.goal) : () => undefined;
    log({ op: 'add', step: `kr:${id}`, title: 'New key result' }, on);
    remember('add the key result', () => { put(); back(); });
    setSel({ kind: 'step', id: on.key(`kr:${id}`) });
    setPanel('inspect');
    setFocusId(on.key(`kr:${id}`));
  };

  /** Ticking a step off pays you back: a burst, the arrows out of it fill in, and what it opened rises with its lock gone. */
  const celebrate = (s: Step, on: On, el?: Element | null) => {
    if (reduced()) return;
    const r = el?.getBoundingClientRect();
    if (r) burst(r.left + r.width / 2, r.top + r.height / 2);
    const edges = new Set(on.flow.links.filter(l => l.from === s.id).map(l => edgeKey(goal.id, on.goal.id, l)));
    if (!s.unblocks.length && on.top) edges.add(`${s.id}>${FINISH}`);
    const opened = new Set(s.unblocks.filter(id => {
      const n = on.flow.byId.get(id);
      return n && !n.done && n.needs.every(x => x === s.id || on.flow.byId.get(x)?.done);
    }).map(id => on.key(id)));
    setFresh({ edges, opened, at: Date.now() });
    window.setTimeout(() => setFresh(f => (f && Date.now() - f.at > 1100 ? null : f)), 1300);
    const first = [...opened][0];
    const t = first ? on.flow.byId.get(first.split('/').pop() as string) : null;
    if (t) say(<><b>{shortTitle(t.title, 40)}</b> is unlocked</>, true);
    else say(<>Done · <b>{shortTitle(s.title, 40)}</b></>, true);
  };

  const toggle = (s: Step, on: On = TOP, el?: Element | null) => {
    if (s.repeat && !s.task) { say(s.repeat.next ? `Nothing of it is open: the next one comes ${dayName(s.repeat.next, now)}.` : 'It’s over: nothing more to come.'); return; }
    if (s.kind === 'task' && s.task) {
      if (s.task.externalId?.startsWith('gcal:')) { say('A meeting is done once it’s over.'); return; }
      if (s.state === 'blocked' && s.task.status !== 'done') { say('Still locked: finish what’s before it first, or take the arrow away.'); return; }
      const isDone = s.task.status !== 'done';
      const before = store.patch(s.task.id, { status: isDone ? 'done' : 'open', doneAt: isDone ? Date.now() : null });
      remember(isDone ? 'tick it off' : 'reopen it', () => store.restore(before));
      if (isDone) celebrate(s, on, el);
      return;
    }
    if (s.kind === 'wait' && s.wait) {
      const done = !s.wait.done;
      const back = plan(p => patchWait(p, s.id, { done, doneAt: done ? Date.now() : null }), on.goal);
      log({ op: done ? 'resolve' : 'unresolve', step: s.id, title: s.title }, on);
      remember(done ? 'hear back' : 'wait again', back);
      if (done) celebrate(s, on, el);
      return;
    }
    if (s.result) {
      if (!s.result.done && s.done) { say('It’s done because everything under it is. Untick one of those instead.'); return; }
      const done = !s.result.done;
      const back = changeGoals(patchResult(on.goal.id, s.result.id, { done }));
      log({ op: done ? 'tick' : 'untick', step: s.id, title: s.title }, on);
      remember(done ? 'tick the key result' : 'untick the key result', back);
      if (done) celebrate(s, on, el);
      return;
    }
    if (s.goal) {
      const done = s.goal.status !== 'achieved';
      const back = changeGoals(setGoalStatus(s.goal.id, done ? 'achieved' : 'active'));
      log({ op: done ? 'tick' : 'untick', step: s.id, title: s.title }, on);
      remember(done ? 'achieve the sub-goal' : 'bring it back', back);
      if (done) celebrate(s, on, el);
    }
  };

  /**
   * Off the map: a task off its goal (or deleted), a waiting step gone, a sub-goal dropped, a key result deleted with
   * the ones under it. Its arrows go too.
   */
  const removeStep = (s: Step, how: 'off' | 'delete', on: On = TOP) => {
    const ids = s.result ? flatResults([s.result]).map(x => `kr:${x.kr.id}`) : [s.id];
    const back = plan(p => ids.reduce(withoutStep, p), on.goal);
    if (s.kind === 'wait') { log({ op: 'remove', step: s.id, title: s.title }, on); remember('remove it', back); }
    else if (s.result) {
      const gone = changeGoals(patchResult(on.goal.id, s.result.id, null));
      log({ op: 'remove', step: s.id, title: s.title }, on);
      remember('delete the key result', () => { gone(); back(); });
    }
    else if (s.goal) {
      const off = changeGoals(setGoalStatus(s.goal.id, 'dropped'));
      log({ op: 'remove', step: s.id, title: s.title }, on);
      remember('drop the sub-goal', () => { back(); off(); });
    }
    else if (s.repeat) {
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
  const confirmDelete = (s: Step, how: 'off' | 'delete' = 'delete', on: On = TOP) => {
    const external = !!s.task?.externalId;
    removeStep(s, s.repeat || (s.task && !external) ? how : 'off', on);
    const verb = s.kind === 'goal' ? 'Dropped' : s.repeat ? (how === 'off' ? 'Took off its goal:' : 'Stopped repeating') : s.task && (how === 'off' || external) ? 'Took off its goal:' : s.kind === 'wait' ? 'Removed' : 'Deleted';
    say(<>{verb} “{shortTitle(s.title, 40)}”</>, true);
    vp.current?.focus({ preventScroll: true });
  };

  /** Back to the layout for every step you've moved. */
  const tidy = () => {
    const back = plan(withoutPos);
    remember('tidy up', back);
    say('Laid out again', true);
  };

  /** An off-goal task brought onto a goal: after `after` (before `before`), between two steps, or where it was dropped. */
  const adopt = (t: Task, o: { after?: string; before?: string; at?: Pos; between?: Link } = {}, on: On = TOP) => {
    const before = store.patch(t.id, { goal: on.goal.id, ...(on.goal.section ? { label: on.goal.section } : {}) });
    const rid = occurrenceOf(t.id)?.repeat;
    const sid = rid && repeats.some(r => r.id === rid) ? `rep:${rid}` : t.id;
    const b = o.between;
    const links = b ? [{ from: b.from, to: sid }, { from: sid, to: b.to }] : o.after ? [{ from: o.after, to: sid }] : o.before ? [{ from: sid, to: o.before }] : [];
    const spot = b ? null : spotFor(o, on);
    const back = links.length || spot ? plan(p => { const q = links.reduce(withLink, b ? withoutLink(p, b) : p); return spot ? withPos(q, sid, spot) : q; }, on.goal) : () => undefined;
    remember('bring it onto the goal', () => { back(); store.restore(before); });
    setSel({ kind: 'step', id: on.key(sid) });
    say(<><b>{shortTitle(t.title, 40)}</b> is on {on.top ? 'this goal' : `“${shortTitle(on.goal.title, 30)}”`} now</>, true);
  };

  const patchTask = (s: Step, part: Partial<Task>, label: string) => {
    if (!s.task) return;
    const before = store.patch(s.task.id, part);
    remember(label, () => store.restore(before));
  };

  /* ---------- the camera ---------- */

  const toWorld = (cx: number, cy: number): Pt => {
    const r = vp.current?.getBoundingClientRect(), c = camRef.current;
    return r ? { x: (cx - r.left - c.x) / c.z, y: (cy - r.top - c.y) / c.z } : { x: 0, y: 0 };
  };
  const zoomAt = (z: number, cx: number, cy: number) => {
    const r = vp.current?.getBoundingClientRect(), c = camRef.current;
    if (!r) return;
    const nz = Math.min(1.6, Math.max(0.3, z)), px = cx - r.left, py = cy - r.top;
    setCam({ x: px - (px - c.x) * (nz / c.z), y: py - (py - c.y) * (nz / c.z), z: nz });
  };
  /** The whole route in view, as big as it'll go; or, if it can't be read that small, its start and Up next. On a phone, Up next, readable. */
  const fit = useCallback((all = false) => {
    const el = vp.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const focus = !wide && !all ? layout.cards.get(nextKeyRef.current ?? '')?.box : null;
    if (focus) {
      const z = 0.85;
      setCam({ x: W * 0.28 - (focus.x + focus.w / 2) * z, y: H * 0.42 - (focus.y + focus.h / 2) * z, z });
      return;
    }
    const pad = wide ? { l: 32, r: 32, t: 84, b: 108 } : { l: 12, r: 12, t: 72, b: 96 };
    const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const z = Math.max(wide ? 0.55 : 0.5, Math.min(1, w / layout.width, h / layout.height));
    const x = layout.width * z <= w ? pad.l + (w - layout.width * z) / 2 : pad.l;
    const y = layout.height * z <= h ? pad.t + (h - layout.height * z) / 2 : pad.t;
    setCam({ x, y, z });
  }, [layout, wide, setCam]);
  const nextKeyRef = useRef<string | null>(null);
  const fitted = useRef(false);
  useLayoutEffect(() => { if (!fitted.current && layout.cards.size >= 0) { fitted.current = true; fit(); } }, [fit, layout.cards.size]);
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const size = () => setVpSize({ w: el.clientWidth, h: el.clientHeight });
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    // Two fingers or the wheel move around; pinch, or ⌘ and the wheel, zooms where the pointer is.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(camRef.current.z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
      else { const c = camRef.current; setCam({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }); }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCam]);
  /** Keep a step in view: move the camera only as far as it takes. */
  const reveal = (b: Box) => {
    const c = camRef.current, el = vp.current;
    if (!el) return;
    const W = el.clientWidth - (wide && panelOpen ? 400 : 0), H = el.clientHeight - 100;
    const x0 = b.x * c.z + c.x, y0 = b.y * c.z + c.y, x1 = x0 + b.w * c.z, y1 = y0 + b.h * c.z;
    let dx = 0, dy = 0;
    if (x0 < 24) dx = 24 - x0; else if (x1 > W - 24) dx = W - 24 - x1;
    if (y0 < 80) dy = 80 - y0; else if (y1 > H) dy = H - y1;
    if (dx || dy) setCam({ ...c, x: c.x + dx, y: c.y + dy });
  };

  /* ---------- pointers: pan the background, pinch to zoom ---------- */

  const pointers = useRef(new Map<number, Pt>());
  const bgDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-step],[data-edge],button,input,textarea,select,.mp-hud,.mp-pop')) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setSel(null); setPicking(null); setMenu(false); setTray(false);
    const el = vp.current;
    el?.setPointerCapture?.(e.pointerId);
    const start = { ...camRef.current }, x0 = e.clientX, y0 = e.clientY;
    let pinch: { d: number; z: number; cx: number; cy: number } | null = null;
    const move = (ev: PointerEvent) => {
      if (!pointers.current.has(ev.pointerId)) return;
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const pts = [...pointers.current.values()];
      if (pts.length >= 2) {
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        if (!pinch) pinch = { d, z: camRef.current.z, cx, cy };
        zoomAt(pinch.z * (d / pinch.d), cx, cy);
        return;
      }
      if (pinch) return;
      setCam({ ...start, x: start.x + ev.clientX - x0, y: start.y + ev.clientY - y0 });
    };
    const up = (ev: PointerEvent) => {
      pointers.current.delete(ev.pointerId);
      if (pointers.current.size) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el?.classList.remove('panning');
    };
    el?.classList.add('panning');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /* ---------- moving a step: drag it (on a touch screen, hold it first), with guides to line it up ---------- */

  const startMove = (e: React.PointerEvent, c: Card) => {
    justMoved.current = false;
    if ((e.button !== 0 && e.pointerType === 'mouse') || picking || c.depth || (e.target as HTMLElement).closest('button,input,textarea,select,.mp-port')) return;
    const b = c.box, id = c.id;
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, p0 = toWorld(x0, y0);
    const touch = e.pointerType === 'touch';
    let armed = !touch, moving = false, last: Pos | null = null;
    const hold = touch ? window.setTimeout(() => { armed = true; setLifting(c.key); navigator.vibrate?.(8); }, 320) : 0;
    const block = (ev: TouchEvent) => { if (armed) ev.preventDefault(); };
    const others = [...layout.cards.values()].filter(o => !o.depth && o.key !== c.key).map(o => o.box);
    const end = () => {
      window.clearTimeout(hold);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', block);
      setLifting(null);
      setGuides({});
    };
    const move = (ev: PointerEvent) => {
      const far = Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5;
      if (!armed) { if (far) end(); return; }
      if (!moving && !far) return;
      if (!moving) { moving = true; setHover(null); }
      const p = toWorld(ev.clientX, ev.clientY);
      let x = Math.max(0, b.x + p.x - p0.x), y = Math.max(0, b.y + p.y - p0.y);
      const near = 7 / camRef.current.z;
      const g: typeof guides = {};
      const mid = y + b.h / 2;
      const hy = others.find(o => Math.abs(o.y + o.h / 2 - mid) < near);
      if (hy) { y = hy.y + hy.h / 2 - b.h / 2; g.h = { y: hy.y + hy.h / 2, x1: Math.min(hy.x, x) - 24, x2: Math.max(hy.x + hy.w, x + b.w) + 24 }; } else y = snap(y);
      const vx = others.find(o => Math.abs(o.x - x) < near);
      if (vx) { x = vx.x; g.v = { x: vx.x, y1: Math.min(vx.y, y) - 24, y2: Math.max(vx.y + vx.h, y + b.h) + 24 }; } else x = snap(x);
      setGuides(g);
      last = { x, y };
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
      setSettled(c.key);
      window.setTimeout(() => setSettled(s => (s === c.key ? null : s)), 450);
      setSel({ kind: 'step', id: c.key });
      vp.current?.focus({ preventScroll: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    if (touch) window.addEventListener('touchmove', block, { passive: false });
  };
  const [settled, setSettled] = useState<string | null>(null);

  /* ---------- drawing an arrow: drag from a step's dot, snapping to the step it reaches ---------- */

  const nearest = (p: Pt, from: string): string | null => {
    let best: string | null = null, d0 = 64 / camRef.current.z;
    for (const c of layout.cards.values()) {
      if (c.key === from) continue;
      const b = c.box;
      const inside = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + (c.open ? 56 : b.h);
      // An open sub-goal is reached at its header; anything else anywhere on it, or near its left edge.
      if (c.open && !inside) continue;
      const d = inside ? 0 : Math.hypot(p.x - b.x, p.y - (b.y + b.h / 2));
      if (d < d0 || (inside && d0 > 0)) { d0 = d; best = c.key; }
    }
    return best;
  };
  const startDraw = (e: React.PointerEvent, from: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p0 = toWorld(e.clientX, e.clientY);
    setHover(null);
    setDrawing({ from, ...p0, moved: false, to: null, bad: null });
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const to = nearest(p, from);
      setDrawing(d => (d ? { ...d, ...p, moved: d.moved || Math.hypot(p.x - p0.x, p.y - p0.y) > 6, to, bad: to ? canJoin(from, to) : null } : d));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = toWorld(ev.clientX, ev.clientY);
      const moved = Math.hypot(p.x - p0.x, p.y - p0.y) > 6;
      setDrawing(null);
      if (!moved) { setPicking(from); return; }
      const to = nearest(p, from);
      if (to) { join(from, to); return; }
      // Let go on an empty spot: the next step goes there.
      const c = cardOf(from);
      if (c && c.step.kind !== 'milestone') addTask({ after: c.id, at: { x: p.x - 12, y: p.y - NODE_H / 2 } }, onOf(c));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const clickStep = (key: string) => {
    if (justMoved.current) { justMoved.current = false; return; }
    vp.current?.focus({ preventScroll: true });
    if (confirm && confirm !== key) setConfirm(null);
    if (picking) {
      if (picking !== key) join(picking, key);
      setPicking(null);
      return;
    }
    setSel({ kind: 'step', id: key });
    setPanel('inspect');
  };

  /* ---------- bringing something onto the map: it shows where it'll go before you let go ---------- */

  const GHOST = '__new', GHOST_WAIT = 'wghostnew';
  /** The map as it would be with this dropped there: the real one, with a ghost in it. */
  const hypo = (kind: StepKind, d: Drop, t?: Task): { tasks: Task[]; goals: Goal[]; ghost: string } | null => {
    if (kind !== 'task' && kind !== 'wait') return null;
    if (d.type === 'at' || d.type === 'under') return null;
    const on = d.on, id = kind === 'wait' ? GHOST_WAIT : t ? (occurrenceOf(t.id) && repeats.some(r => r.id === occurrenceOf(t.id)?.repeat) ? `rep:${occurrenceOf(t.id)?.repeat}` : t.id) : GHOST;
    const card = d.type === 'between' ? null : cardOf(d.card);
    const sid = card?.id;
    let p = planOf(on.goal);
    if (kind === 'wait') p = withWait(p, { id, title: 'Someone or something', done: false, created: now, doneAt: null });
    if (d.type === 'between') p = withLink(withLink(withoutLink(p, d.link), { from: d.link.from, to: id }), { from: id, to: d.link.to });
    else if (d.type === 'after' && sid) p = withLink(p, { from: sid, to: id });
    else if ((d.type === 'before' || d.type === 'holds') && sid) p = withLink(p, { from: id, to: sid });
    else if (d.type === 'beside' && sid) p = parallelLinks(p, sid, id).reduce(withLink, p);
    const gs = goals.map(g => (g.id === on.goal.id ? { ...g, plan: p } : g));
    let ts = tasks;
    if (kind === 'task') ts = t ? tasks.map(x => (x.id === t.id ? { ...x, goal: on.goal.id } : x)) : [...tasks, { ...newTask(on, 'New step'), id: GHOST }];
    return { tasks: ts, goals: gs, ghost: on.key(id) };
  };

  /** What a point on the screen would drop onto; 'keep' over the ghost and its arrows, so the preview holds still. */
  const dropAt = (cx: number, cy: number, kind: StepKind, ghost: string | null = null): Drop | 'keep' | null => {
    const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
    if (!el || !vp.current?.contains(el) || el.closest('.mp-hud,.mp-pop')) return null;
    if (ghost) {
      const k = el.closest<HTMLElement>('[data-step]')?.dataset.step, ek = el.closest<SVGElement>('[data-edge]')?.dataset.edge, id = ghost.split('/').pop() as string;
      if (k === ghost || (ek && (ek.split('/').pop() as string).split('>').includes(id))) return 'keep';
    }
    const p = toWorld(cx, cy);
    const ed = el.closest<SVGElement>('[data-edge]')?.dataset.edge;
    const edge = ed ? base.edges.find(x => x.key === ed) : null;
    if (edge) {
      if (edge.kind === 'finish') {
        const c = base.cards.get(edge.from);
        if (c && c.step.kind !== 'milestone') return { type: 'after', card: c.key, on: onTree(c.tree) };
      } else if (edge.link && !edge.link.auto && (kind === 'task' || kind === 'wait')) return { type: 'between', edge: edge.key, on: onTree(edge.tree), link: edge.link };
    }
    const key = el.closest<HTMLElement>('[data-step]')?.dataset.step;
    const c = key && key !== preview?.ghost ? base.cards.get(key) : null;
    if (c) {
      const on = onTree(c.tree), s = c.step, b = c.box;
      if (kind === 'wait') return s.kind === 'wait' ? { type: 'beside', card: c.key, on } : { type: 'holds', card: c.key, on };
      if (s.kind === 'milestone') return kind === 'milestone' && (s.depth ?? 0) < 2 ? { type: 'under', card: c.key, on } : kind === 'goal' ? { type: 'under', card: c.key, on } : { type: 'before', card: c.key, on };
      if (kind === 'goal' || kind === 'milestone') return { type: 'at', at: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }, on: onAt(p) };
      const fx = (p.x - b.x) / b.w, fy = (p.y - b.y) / (c.open ? 56 : b.h);
      if (fy > 0.72 && !c.open) return { type: 'beside', card: c.key, on };
      if (fx < 0.28) return { type: 'before', card: c.key, on };
      return { type: 'after', card: c.key, on };
    }
    return { type: 'at', at: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }, on: onAt(p) };
  };
  const sameDrop = (a: Drop | null, b: Drop | null) => !!a && !!b && a.type === b.type && a.on.goal.id === b.on.goal.id
    && ('card' in a ? a.card === (b as { card?: string }).card : true) && ('edge' in a ? a.edge === (b as { edge?: string }).edge : true);

  /** Carry something from beside the map onto it. A click (no drag) adds it next to the selected step instead. */
  const carry = (e: React.PointerEvent, what: { kind: StepKind; label: string; task?: Task }, click: () => void) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const x0 = e.clientX, y0 = e.clientY;
    let moving = false, cur: Drop | null = null, ghost: string | null = null;
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moving) { moving = true; setTray(false); setHover(null); setHoverEdge(null); }
      const got = dropAt(ev.clientX, ev.clientY, what.kind, ghost);
      const d = got === 'keep' ? cur : got;
      if (got !== 'keep' && !sameDrop(d, cur)) {
        const h = d ? hypo(what.kind, d, what.task) : null;
        ghost = h?.ghost ?? null;
        setPreview(h);
      }
      cur = d;
      setCarrying({ ...what, x: ev.clientX, y: ev.clientY, drop: d });
    };
    const finish = (ev: PointerEvent, drop: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setCarrying(null);
      setPreview(null);
      if (!moving) { if (drop) click(); return; }
      justMoved.current = true;
      window.setTimeout(() => { justMoved.current = false; }, 0);
      const got = drop ? dropAt(ev.clientX, ev.clientY, what.kind, ghost) : null;
      const d = got === 'keep' ? cur : got;
      if (d) place(what, d);
    };
    const up = (ev: PointerEvent) => finish(ev, true);
    const cancel = (ev: PointerEvent) => finish(ev, false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  /** Make the drop. */
  const place = (what: { kind: StepKind; task?: Task }, d: Drop) => {
    const on = d.on, c = 'card' in d ? cardOf(d.card) : null, s = c?.step;
    const at = d.type === 'at' ? d.at : undefined;
    if (what.task) {
      const t = what.task;
      if (d.type === 'between') adopt(t, { between: d.link }, on);
      else if (s && (d.type === 'before' || d.type === 'holds')) adopt(t, { before: s.id }, on);
      else if (s && (d.type === 'after' || d.type === 'beside')) adopt(t, { after: s.id }, on);
      else adopt(t, { at }, on);
      return;
    }
    if (what.kind === 'task') {
      if (d.type === 'between') addTask({ between: d.link }, on);
      else if (s && d.type === 'after') addTask({ after: s.id }, on);
      else if (s && (d.type === 'before' || d.type === 'holds')) addTask({ before: s.id }, on);
      else if (s && d.type === 'beside') addTask({ beside: s.id }, on);
      else addTask({ at }, on);
    } else if (what.kind === 'wait') {
      if (d.type === 'between') addWait(undefined, undefined, on, d.link);
      else if (s && s.kind !== 'wait' && d.type !== 'beside') addWait(s.id, undefined, on);
      else addWait(undefined, at ?? (c ? { x: c.box.x, y: c.box.y + ROW_H } : undefined), on);
    } else if (what.kind === 'goal') {
      addSubGoal(s?.result?.id, at, on);
    } else {
      addKr(s?.result && (s.depth ?? 0) < 2 ? s.result.id : null, at, on);
    }
  };

  /** A click on the dock: next to the selected step, as Tab does. */
  const addKind = (kind: StepKind) => {
    const s = selStep, on = selOn;
    if (kind === 'task') addTask(s ? (s.kind === 'milestone' ? { before: s.id } : { after: s.id }) : {}, on);
    else if (kind === 'wait') addWait(s && s.kind !== 'wait' ? s.id : undefined, undefined, on);
    else if (kind === 'goal') addSubGoal(s?.result?.id, undefined, on);
    else addKr(s?.result?.id ?? null, undefined, on);
  };
  /** The backlog's +: after the selected step, as Tab does. */
  const adoptHere = (t: Task) => adopt(t, selStep ? (selStep.kind === 'milestone' ? { before: selStep.id } : { after: selStep.id }) : {}, selOn);

  /* ---------- saying what to change: the AI's changes are shown on the map, then made ---------- */

  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  type Asked = { said: string; reply: string; lines: string[]; skipped: string[]; apply?: () => void };
  const [asked, setAsked] = useState<Asked | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);

  const tell = async (text: string, spoken = false) => {
    const said = text.trim();
    if (!said || asking) return;
    setAsking(true);
    setAsked(null);
    setPreview(null);
    try {
      const live = liveTasks();
      const { refs: taskRefs } = promptContext(live);
      const { prompt, refs } = workflowPrompt({ text: said, now: Date.now(), goals, tasks: live, repeats, focus: goal.id, spoken, taskRefs, taskLines: taskLinesFor(live, taskRefs) });
      const { result, via } = await askWorkflow(prompt);
      if (!result) {
        setAsked({ said, lines: [], skipped: [], reply: via === 'no-key' ? 'Changing the plan by what you say needs the AI, and it isn’t set up here.' : 'Couldn’t reach the AI just now. Try again in a moment.' });
        return;
      }
      const ops = normalizeOps(result.ops);
      const heard = result.heard || said;
      if (!ops.length) { setAsked({ said: heard, lines: [], skipped: [], reply: result.reply || 'Nothing to change in that.' }); return; }
      const st = { goals, tasks, repeats, now: Date.now() };
      const rec = recordedIds();
      const out: WorkflowResult = applyWorkflow(ops, st, refs, { focus: goal.id, ids: rec });
      if (!out.lines.length) { setAsked({ said: heard, lines: [], skipped: out.skipped, reply: result.reply || 'Nothing changed.' }); return; }
      // Shown on the map first: what it adds is in green.
      const removed = new Set(out.removes);
      const written = new Map(out.writes.map(t => [t.id, t]));
      const next = [...tasks.filter(t => !removed.has(t.id)).map(t => written.get(t.id) ?? t), ...out.writes.filter(t => !tasks.some(x => x.id === t.id))];
      setPreview({ tasks: next, goals: out.goals, ghost: null });
      const apply = () => {
        // Laid over the goals as they are when it's saved, with the same new ids. Repeats first, then tasks.
        const undoGoals = changeGoals(list => applyWorkflow(ops, { ...st, goals: list }, refs, { focus: goal.id, ids: rec.replay() }).goals);
        const unrepeat = applyRepeats(out.repeatOps);
        const before = new Map([...(out.removes.length ? store.remove(out.removes) : []), ...(out.writes.length ? store.write(out.writes) : [])]);
        logGoal(out.log);
        remember('the change you asked for', () => { store.restore(before); unrepeat(); undoGoals(); });
        setPreview(null);
        setAsked(null);
        say(<>{out.lines.length} change{out.lines.length === 1 ? '' : 's'} made</>, true);
      };
      setAsked({ said: heard, reply: result.reply || '', lines: out.lines, skipped: out.skipped, apply });
      setAsk('');
    } finally {
      setAsking(false);
    }
  };
  const discard = () => { setPreview(null); setAsked(null); };

  const listen = useVoice({
    lang: voice.profile.lang,
    phrases: () => [goal.title, ...[...layout.cards.values()].map(c => c.step.title)].slice(0, 80),
    onHeard: h => setHearing(joinWords(h.text, h.interim)),
    onFinish: x => { setHearing(null); if (x.text.trim()) void tell(x.text, true); },
    onCutOff: x => { setHearing(null); if (x.text.trim()) { setAsk(x.text); say('Stopped listening. What you said is in the box.'); } },
    onUnsupported: why => { setHearing(null); say(noVoiceText(why)); },
  });
  const mic = () => (listen.listening ? listen.finishVoice() : listen.startVoice(ask));

  /* ---------- the keyboard ---------- */

  const selCard = sel?.kind === 'step' ? cardOf(sel.id) : null;
  const selStep = selCard?.step ?? null;
  const selOn = onOf(selCard);
  const selEdge = sel?.kind === 'link' ? layout.edges.find(e => e.kind === 'link' && e.key === sel.key) ?? null : null;
  const selLink = selEdge?.link ?? null;
  const linkOn = selEdge ? onTree(selEdge.tree) : TOP;
  const panelOpen = panel === 'history' || !!selStep || !!selLink;
  /** A sub-goal with nothing on its own chart yet. */
  const isEmpty = (c: Card | null) => !!c?.sub && !c.sub.flow.steps.length && !c.sub.flow.older;

  const onKey = (e: KeyLike) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const typing = target?.closest('input,textarea,select');
    const onButton = target?.closest('button');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); mic(); return; }
    if (e.key === 'Escape') {
      if (asked?.apply || preview) { e.preventDefault(); discard(); return; }
      if (asked) { e.preventDefault(); setAsked(null); return; }
      if (menu || tray) { e.preventDefault(); setMenu(false); setTray(false); return; }
      if (confirm) { e.preventDefault(); setConfirm(null); vp.current?.focus({ preventScroll: true }); return; }
      if (picking || drawing) { e.preventDefault(); setPicking(null); setDrawing(null); return; }
      if (typing) { e.preventDefault(); (typing as HTMLElement).blur(); vp.current?.focus({ preventScroll: true }); return; }
      if (sel) { e.preventDefault(); setSel(null); return; }
      if (panel === 'history') { e.preventDefault(); setPanel('inspect'); return; }
      return;
    }
    if (e.key === 'Enter' && asked?.apply && !typing) { e.preventDefault(); asked.apply(); return; }
    if (typing || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); (document.querySelector('.mp-ask input') as HTMLInputElement | null)?.focus(); return; }
    if (e.key === '!' || (e.shiftKey && e.key === '1')) { e.preventDefault(); fit(true); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selLink && !selLink.auto) { e.preventDefault(); unlink(selLink, linkOn); return; }
      if (selCard) { e.preventDefault(); if (confirm === selCard.key) confirmDelete(selCard.step, 'delete', selOn); else setConfirm(selCard.key); }
      return;
    }
    if (confirm) return;
    if (e.key === 'Tab' && selStep && !e.shiftKey) { e.preventDefault(); addTask(selStep.kind === 'milestone' ? { before: selStep.id } : { after: selStep.id }, selOn); return; }
    if (e.key === 'Enter' && !onButton && selStep && selStep.kind !== 'milestone') { e.preventDefault(); addTask({ beside: selStep.id }, selOn); return; }
    if (e.key === ' ' && selStep && !onButton) { e.preventDefault(); toggle(selStep, selOn, document.querySelector(`[data-step="${CSS.escape(selCard?.key ?? '')}"] .mp-ck`)); return; }
    if (selCard && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
      const a = selCard.box;
      if (!dir) return;
      let go: Card | null = null, best = Infinity;
      for (const c of layout.cards.values()) {
        const b = c.box;
        if (c === selCard) continue;
        const dx = b.x - a.x, dy = b.y - a.y, along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        if (along <= 4) continue;
        if (along + across * 2 < best) { best = along + across * 2; go = c; }
      }
      if (go) { setSel({ kind: 'step', id: go.key }); reveal(go.box); }
    }
  };
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
    const text = toMermaidTree(tree);
    const done = navigator.clipboard?.writeText(text);
    if (done) done.then(() => say('Copied as a Mermaid flowchart: paste it into GitHub, Notion or any Mermaid editor.'), () => download(`${slug}.mmd`, text, 'text/plain'));
    else download(`${slug}.mmd`, text, 'text/plain');
  };

  /** What the side panel can do to a step, on the chart it's on. */
  const actsFor = (on: On): Acts => ({
    rename: (s, t) => rename(s, t, on), toggle: s => toggle(s, on), link: l => link(l, on), unlink: l => unlink(l, on),
    addTask: o => addTask(o, on), addWait: h => addWait(h, undefined, on), removeStep: (s, how) => removeStep(s, how, on), patchTask,
    addSubGoal: kr => addSubGoal(kr, undefined, on), addKr: u => addKr(u, undefined, on),
    open: id => openSheet('flow', id), goalById, repeatOf: id => repeats.find(r => r.id === id) ?? null, slot,
    go: id => { const k = on.key(id), c = cardOf(k); if (c) { setSel({ kind: 'step', id: k }); reveal(c.box); } },
  });

  /* ---------- drawing it ---------- */

  const z = cam.z;
  /** The one to do now, and the first steps on it you'd see. */
  const next = useMemo(() => pickNext(view), [view]);
  const nextKey = next ? (next.tree.goal.id === goal.id ? next.step.id : nodeKey(goal.id, next.tree.goal.id, next.step.id)) : null;
  nextKeyRef.current = nextKey;
  /** Hover a step: the steps before it and after it on its chart light up, and the rest step back. */
  const trace = useMemo(() => {
    const c = hover ? layout.cards.get(hover) : null;
    if (!c || drawing || carrying || dragPos) return null;
    const f = c.tree.flow, on = onTree(c.tree), out = new Set([c.id]);
    const up = (id: string) => f.byId.get(id)?.needs.forEach(n => { if (!out.has(n)) { out.add(n); up(n); } });
    const down = (id: string) => f.byId.get(id)?.unblocks.forEach(n => { if (!out.has(n)) { out.add(n); down(n); } });
    up(c.id); down(c.id);
    const keys = new Set([...out].map(on.key));
    if (on.top && [...out].some(id => !f.byId.get(id)?.unblocks.length)) keys.add(FINISH);
    // The frames around it stay lit.
    for (const fr of layout.frames) { const b = fr.box; if (c.box.x >= b.x && c.box.y >= b.y && c.box.x + c.box.w <= b.x + b.w && c.box.y + c.box.h <= b.y + b.h) keys.add(fr.key); }
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, layout, drawing, carrying, dragPos]);
  const hoverT = useRef(0);
  const enter = (key: string) => { window.clearTimeout(hoverT.current); hoverT.current = window.setTimeout(() => setHover(key), 380); };
  const leave = () => { window.clearTimeout(hoverT.current); hoverT.current = window.setTimeout(() => setHover(null), 120); };

  const added = (key: string) => !!preview && !base.cards.has(key);
  const edgeEnds = (e: Edge): [Box | undefined, Pt | null] => {
    const a = shown.cards.get(e.from);
    if (e.to === FINISH) return [a, shown.port];
    const b = shown.cards.get(e.to);
    return [a, b ? { x: b.x, y: b.y + b.h / 2 } : null];
  };
  const live = drawing && drawing.moved ? (() => {
    const a = cardOf(drawing.from)?.box;
    if (!a) return null;
    const t = drawing.to ? cardOf(drawing.to)?.box : null;
    const to = t ? { x: t.x, y: t.y + (cardOf(drawing.to)?.open ? 28 : t.h / 2) } : { x: drawing.x + 4, y: drawing.y };
    return plainD(a, to);
  })() : null;

  const doneAll = flow.counts.done, stepsAll = flow.counts.steps;
  const left = goal.by ? daysLeft(goal.by, now) : null;
  const tz = Math.min(1.3, Math.max(1, 0.92 / z)).toFixed(3);
  const nextBox = nextKey ? shown.cards.get(nextKey) : null;
  const dropping = carrying?.drop;
  const dropCard = dropping && 'card' in dropping ? dropping.card : null;
  const dropLabel = dropping ? (dropping.type === 'between' ? 'Put it in between'
    : dropping.type === 'after' ? 'Then this' : dropping.type === 'before' ? (cardOf(dropCard)?.step.kind === 'milestone' ? 'Leads here' : 'Before it')
    : dropping.type === 'beside' ? 'Alongside' : dropping.type === 'holds' ? 'Holds it up' : dropping.type === 'under' ? (carrying?.kind === 'goal' ? 'For this key result' : 'Under it')
    : dropping.on.top ? null : `On “${shortTitle(dropping.on.goal.title, 24)}”`) : null;

  return (
    <div className={'mp' + (wide ? '' : ' ph') + (z < 0.8 ? ' far' : '')} style={tint} onKeyDown={onKey}>
      <div ref={vp} className={'mp-vp' + (picking || drawing ? ' connecting' : '') + (dragPos ? ' moving' : '') + (trace ? ' tracing' : '')} tabIndex={0}
        aria-label={`Map of ${goal.title}`} onPointerDown={bgDown}
        style={{ '--g': `${24 * z}px`, '--gx': `${cam.x % (24 * z)}px`, '--gy': `${cam.y % (24 * z)}px` } as React.CSSProperties}
        onDoubleClick={e => {
          if ((e.target as HTMLElement).closest('[data-step],[data-edge],button,.mp-goal,.mp-pop,.mp-hud')) return;
          const p = toWorld(e.clientX, e.clientY);
          addTask({ at: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } }, onAt(p));
        }}>
        <div className="mp-world" style={{ transform: `translate(${cam.x}px,${cam.y}px) scale(${z})`, '--tz': tz } as React.CSSProperties}>
          {nextBox && !preview && <div className="mp-spot" aria-hidden="true" style={{ transform: `translate(${nextBox.x + nextBox.w / 2}px,${nextBox.y + nextBox.h / 2}px)` }} />}

          {/* Open sub-goals: a frame each, its header a handle. */}
          {layout.frames.map(f => {
            const c = layout.cards.get(f.key) as Card, b = shown.cards.get(f.key) as Box, s = c.step, sub = c.sub as FlowTree;
            const on1 = sel?.kind === 'step' && sel.id === c.key;
            const cnt = sub.flow.counts;
            return (
              <div key={'f:' + f.key} className={'mp-frame' + (on1 ? ' sel' : '') + (c.depth ? ' nested' : '') + (trace && !trace.has(f.key) ? ' dim' : '') + (s.state === 'blocked' && !s.done ? ' locked' : '') + (s.done ? ' done' : '') + (!c.depth && dragPos?.id === c.id ? ' lifted' : '')}
                style={{ transform: `translate(${b.x}px,${b.y}px)`, width: b.w, height: b.h }}>
                <div className="mp-fh" data-step={c.key} onPointerDown={c.depth ? undefined : e => startMove(e, c)} onClick={e => { e.stopPropagation(); clickStep(c.key); }}
                  onDoubleClick={e => { e.stopPropagation(); openSheet('flow', (s.goal as Goal).id); }} title="Double-click to open its own map">
                  <Ring value={s.done ? 1 : shareOf(sub)} size={30} stroke={3.2} />
                  <span className="mp-eb">Sub-goal</span>
                  <span className="mp-ft">{s.title}</span>
                  <span className="mp-fm num">{s.done ? 'Achieved' : `${cnt.done} of ${cnt.steps} done${s.minutes ? ` · ${fmtDur(s.minutes)} left` : ''}`}</span>
                  {s.state === 'blocked' && !s.done && <span className="mp-chip lock"><LockIcon size={10} />Locked</span>}
                  <span className="spacer" />
                  <button type="button" className="mp-fb" aria-label={`Close ${s.title} to one card`} title="Close it to one card" onClick={e => { e.stopPropagation(); fold((s.goal as Goal).id); }}><ChevronDown size={13} /></button>
                  <button type="button" className="mp-fb" aria-label={`Open the map of ${s.title}`} title="Its own map" onClick={e => { e.stopPropagation(); openSheet('flow', (s.goal as Goal).id); }}><OpenIcon size={14} /></button>
                  {s.kind !== 'milestone' && !preview && <span className="mp-port out" role="button" aria-label={`Draw an arrow from ${s.title}`} onPointerDown={e => startDraw(e, c.key)} />}
                </div>
              </div>
            );
          })}

          <svg className="mp-wires" width={layout.width + 400} height={layout.height + 400} aria-hidden="true">
            <defs>
              {(['n', 'c', 'a', 'g', 'r'] as const).map(k => (
                <marker key={k} id={`mpa-${k}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M1 1.2L7.5 5 1 8.8" className={`mpa mpa-${k}`} />
                </marker>
              ))}
              <linearGradient id="mp-gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="mp-gg0" /><stop offset="1" className="mp-gg1" /></linearGradient>
            </defs>
            {layout.edges.map(e => {
              const [a, b] = edgeEnds(e);
              if (!a || !b) return null;
              const d = shown.moving ? plainD(a, b) : pathD(e);
              const from = e.tree.flow.byId.get(e.link?.from ?? e.from.split('/').pop() ?? '');
              const k = e.link ? linkKey(e.link) : '';
              const walked = !!from?.done;
              const isSel = sel?.kind === 'link' && sel.key === e.key;
              const hot = hoverEdge === e.key || (dropping?.type === 'between' && dropping.edge === e.key);
              const isNew = !!preview && !base.edges.some(x => x.key === e.key);
              const crit = !walked && (e.kind === 'finish' ? !!from?.critical : e.tree.flow.critical.links.has(k));
              const cls = isNew ? (preview?.ghost ? 'sel' : 'add') : isSel || hot ? 'sel' : walked ? 'walked' : crit ? 'crit' : 'n';
              const paint = fresh?.edges.has(e.key);
              const dim = trace && !(trace.has(e.from) && trace.has(e.to));
              const mk = isNew ? (preview?.ghost ? 'a' : 'g') : isSel || hot ? 'a' : walked || crit || e.kind === 'finish' ? 'c' : 'n';
              return (
                <g key={e.key} className={dim ? 'dim' : undefined}>
                  <path d={d} pathLength={paint ? 1 : undefined} className={`mp-w ${cls}${e.kind === 'finish' ? ' fin' : ''}${e.link?.auto ? ' auto' : ''}${paint ? ' paint' : ''}`} markerEnd={`url(#mpa-${mk})`} />
                  {!dragPos && !drawing && (
                    <path d={d} className="mp-hit" data-edge={e.key}
                      onPointerEnter={() => { if (!carrying && !preview) setHoverEdge(e.key); }} onPointerLeave={() => setHoverEdge(h => (h === e.key ? null : h))}
                      onClick={ev => { ev.stopPropagation(); if (e.kind === 'link') { vp.current?.focus({ preventScroll: true }); setSel({ kind: 'link', key: e.key }); } }}>
                      <title>{e.kind === 'finish' ? `${from?.title ?? ''} → the goal` : `${from?.title ?? ''} → ${e.tree.flow.byId.get(e.link?.to ?? '')?.title ?? ''}`}</title>
                    </path>
                  )}
                </g>
              );
            })}
            {live && <path d={live} className={'mp-w ' + (drawing?.bad ? 'bad' : 'sel')} markerEnd={`url(#mpa-${drawing?.bad ? 'r' : 'a'})`} />}
          </svg>

          {[...layout.cards.values()].filter(c => !c.open).map(c => {
            const b = shown.cards.get(c.key) as Box;
            return (
              <Node key={c.key} c={c} b={b} next={c.key === nextKey} sel={sel?.kind === 'step' && sel.id === c.key}
                cls={(picking === c.key ? ' from' : '') + (!c.depth && dragPos?.id === c.id ? ' lifted' : '') + (lifting === c.key ? ' lifting' : '') + (confirm === c.key ? ' doomed' : '')
                  + (trace && !trace.has(c.key) ? ' dim' : '') + (settled === c.key ? ' settle' : '') + (fresh?.opened.has(c.key) ? ' unlocking' : '')
                  + (drawing?.to === c.key ? (drawing.bad ? ' invalid' : ' target') : '') + (dropCard === c.key ? ' target' : '')
                  + (preview?.ghost === c.key ? ' ghost' : added(c.key) ? ' added' : '') + (isEmpty(c) ? ' empty' : '')}
                now={now} preview={!!preview}
                onDown={e => startMove(e, c)} onClick={() => clickStep(c.key)} onEnter={() => enter(c.key)} onLeave={leave}
                onTick={el => toggle(c.step, onOf(c), el)} onDraw={e => startDraw(e, c.key)}
                onOpen={() => c.step.goal && openSheet('flow', c.step.goal.id)} onUnfold={() => c.step.goal && fold(c.step.goal.id)}
                onAdd={how => { const on = onOf(c); if (how === 'next') addTask({ after: c.id }, on); else if (how === 'par') addTask({ beside: c.id }, on); else addTask({ before: c.id }, on); }} />
            );
          })}

          <div className={'mp-goal' + (trace && !trace.has(FINISH) ? ' dim' : '') + (share >= 1 ? ' won' : '')} style={{ transform: `translate(${shown.goal.x}px,${shown.goal.y}px)` }}>
            <span className="mp-glow" aria-hidden="true" />
            <span className="mp-geb"><TrophyIcon size={12} />Goal</span>
            <div className="mp-med" role="img" aria-label={`${Math.round(share * 100)}% there`}>
              <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
                <circle cx={RING / 2} cy={RING / 2} r={RING / 2 - 8} className="mp-rt" />
                <circle cx={RING / 2} cy={RING / 2} r={RING / 2 - 8} className="mp-rv" strokeDasharray={2 * Math.PI * (RING / 2 - 8)}
                  strokeDashoffset={2 * Math.PI * (RING / 2 - 8) * (1 - pct)} transform={`rotate(-90 ${RING / 2} ${RING / 2})`} />
              </svg>
              <span className="mp-pct"><b className="num">{Math.round(pct * 100)}<small>%</small></b><span>there</span></span>
            </div>
            <div className="mp-gt">{goal.title}</div>
            <div className="mp-gm">{goal.by ? `By ${fromYmd(goal.by).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${left ? ` · ${left.text}` : ''}` : `${doneAll} of ${stepsAll} steps done`}</div>
          </div>

          {(guides.h || guides.v) && (
            <svg className="mp-guides" width={layout.width + 400} height={layout.height + 400} aria-hidden="true">
              {guides.h && <line x1={guides.h.x1} x2={guides.h.x2} y1={guides.h.y} y2={guides.h.y} />}
              {guides.v && <line x1={guides.v.x} x2={guides.v.x} y1={guides.v.y1} y2={guides.v.y2} />}
            </svg>
          )}

          {hoverEdge && !selEdge && !preview && !carrying && (() => {
            const e = layout.edges.find(x => x.key === hoverEdge);
            if (!e || e.link?.auto || shown.moving) return null;
            return (
              <button type="button" className="mp-eplus" style={{ left: e.mid.x, top: e.mid.y }} aria-label="Put a step in between" title={e.kind === 'finish' ? 'Add a step after it' : 'Put a step in between'}
                onPointerEnter={() => setHoverEdge(e.key)} onPointerLeave={() => setHoverEdge(null)}
                onClick={ev => {
                  ev.stopPropagation();
                  setHoverEdge(null);
                  const on = onTree(e.tree);
                  if (e.kind === 'finish') { const c = cardOf(e.from); if (c) addTask({ after: c.id }, on); }
                  else if (e.link) addTask({ between: e.link }, on);
                }}><PlusIcon size={12} /></button>
            );
          })()}
          {selEdge && selLink && !selLink.auto && (
            <button type="button" className="mp-ex" style={{ left: selEdge.mid.x, top: selEdge.mid.y }} aria-label="Remove this arrow" title="Remove this arrow (Delete)"
              onClick={e => { e.stopPropagation(); unlink(selLink, linkOn); }}><XIcon size={11} /></button>
          )}
          {drawing?.moved && (() => {
            const t = drawing.to ? cardOf(drawing.to)?.box : null;
            const text = drawing.to ? drawing.bad ?? `Then: ${shortTitle(cardOf(drawing.to)?.step.title ?? '', 30)}` : 'Let go for a new step here';
            return <span className={'mp-label' + (drawing.bad ? ' bad' : '')} style={t ? { left: t.x + 8, top: t.y - 16 } : { left: drawing.x + 16, top: drawing.y - 18 }}>{text}</span>;
          })()}
          {dropLabel && preview?.ghost && (() => {
            const g = shown.cards.get(preview.ghost);
            return g ? <span className="mp-label" style={{ left: g.x + 8, top: g.y - 16 }}>{dropLabel}</span> : null;
          })()}
          {dropLabel && !preview?.ghost && dropCard && (() => {
            const t = cardOf(dropCard)?.box;
            return t ? <span className="mp-label" style={{ left: t.x + 8, top: t.y - 16 }}>{dropLabel}</span> : null;
          })()}

          {confirm && (() => {
            const c = cardOf(confirm);
            if (!c) return null;
            const s = c.step, b = c.box, on = onOf(c);
            const external = !!s.task?.externalId;
            const under = s.result ? flatResults(s.result.results ?? []).length : s.goal ? descendantsOf(goals, s.goal.id).filter(d => d.status === 'active').length : 0;
            const what = s.repeat ? `Stop repeating “${shortTitle(s.title, 40)}”?`
              : s.kind === 'goal' ? `Drop the sub-goal “${shortTitle(s.title, 40)}”${under ? `, and the ${under} under it` : ''}?`
              : s.kind === 'milestone' ? `Delete the key result “${shortTitle(s.title, 40)}”${under ? `, and the ${under} under it` : ''}?`
              : s.kind === 'wait' ? `Remove “Waiting on ${shortTitle(s.title, 40)}”?`
              : external ? `Take “${shortTitle(s.title, 40)}” off ${on.top ? 'this goal' : 'its goal'}?` : `Delete “${shortTitle(s.title, 40)}”?`;
            return (
              <div className="mp-confirm mp-pop" role="alertdialog" aria-label={what} style={{ left: b.x, top: b.y + (c.open ? 60 : b.h) + 12 }}
                onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                <p>{what}</p>
                {s.repeat ? <p className="muted sm">No more of it will come{s.task ? ', and the open one goes' : ''}. The ones you’ve done stay done.</p>
                  : s.task && !external && <p className="muted sm">It’s a task in your planner too, so it goes from there as well.</p>}
                <div className="acts">
                  <button type="button" className="btn sm pri" autoFocus onClick={() => confirmDelete(s, 'delete', on)}>
                    {s.repeat ? 'Stop it' : s.kind === 'goal' ? 'Drop it' : s.kind === 'wait' ? 'Remove' : external ? 'Take it off' : 'Delete'}
                  </button>
                  {(s.repeat || (s.task && !external)) && <button type="button" className="btn sec sm" onClick={() => confirmDelete(s, 'off', on)}>Only off {on.top ? 'this goal' : 'its goal'}</button>}
                  <button type="button" className="btn text sm" onClick={() => { setConfirm(null); vp.current?.focus({ preventScroll: true }); }}>Cancel</button>
                </div>
                <p className="muted sm"><kbd>Delete</kbd> or <kbd>Enter</kbd> to confirm · <kbd>Esc</kbd> to keep it</p>
              </div>
            );
          })()}

          {!flow.counts.steps && !preview && (() => {
            // Under whatever's there already (its key results), else just before the goal.
            const below = [...layout.cards.values()].map(c => c.box.y + c.box.h);
            const at = below.length ? { x: 40, y: Math.max(...below) + 48 } : { x: layout.port.x - 360, y: layout.port.y - 42 };
            const kr = flow.steps.find(s => s.kind === 'milestone' && !s.done && !s.needs.length);
            return (
            <>
              <button type="button" className="mp-first" style={{ left: at.x, top: at.y }} onClick={() => addTask(kr ? { before: kr.id } : {})}>
                <span className="mp-first-p"><PlusIcon size={16} /></span>{kr ? `A first step to “${shortTitle(kr.title, 22)}”` : 'Add the first step'}
              </button>
              <p className="mp-hint" style={{ left: at.x, top: at.y + 100 }}>
                Or say the plan in the bar below, and it’s drawn for you. Or start from a draft:<br />
                <button type="button" className="mp-ex-say" disabled={asking} onClick={() => void tell(`Draft the first few steps to “${goal.title}”, in the order they come: what has to be done before what, and anything it waits on`)}>
                  <SparkIcon size={14} />Draft a plan for “{shortTitle(goal.title, 40)}”
                </button>
              </p>
            </>
            );
          })()}
        </div>
      </div>

      {/* ---------- what floats over the map ---------- */}

      <div className="mp-hud mp-where" role="navigation" aria-label="Where you are">
        <button type="button" className="mp-hb icon" aria-label="Close the map" title="Back (Esc)" onClick={closeSheet}><ChevronLeft size={16} /></button>
        {trail.length > 0 ? trail.map(a => (
          <span key={a.id} className="mp-crumb"><button type="button" className="link" onClick={() => openSheet('flow', a.id)}>{shortTitle(a.title, 22)}</button><span aria-hidden="true">/</span></span>
        )) : <span className="mp-crumb wide-only"><button type="button" className="link" onClick={() => openSheet('goals')}>Goals</button><span aria-hidden="true">/</span></span>}
        <span className="mp-gname"><i aria-hidden="true" />{goal.title}</span>
        <span className="mp-vsep wide-only" />
        <span className="mp-prog wide-only"><span className="mp-bar"><i style={{ width: `${Math.round(pct * 100)}%` }} /></span><span><b className="num">{Math.round(pct * 100)}%</b> there</span>{left && <><span>·</span><span className={left.hot ? 'hot' : undefined}>{left.text}</span></>}</span>
      </div>

      <div className="mp-hud mp-tools">
        {onRoute && <button type="button" className="mp-hb icon" aria-label="Back to the route" title="The route" onClick={onRoute}><RouteIcon size={16} /></button>}
        <button type="button" className={'mp-hb' + (wide ? '' : ' icon')} disabled={!undoLabel} aria-label="Undo" onClick={undo} title={undoLabel ? `Undo: ${undoLabel} (⌘Z)` : 'Nothing to undo'}><UndoIcon size={15} /><span className="wide-only">Undo</span></button>
        {wide && <button type="button" className="mp-hb" aria-pressed={panel === 'history'} onClick={() => { setSel(null); setPanel(p => (p === 'history' ? 'inspect' : 'history')); }}><HistoryIcon size={15} />History</button>}
        <button type="button" className="mp-hb icon" aria-label="More" aria-expanded={menu} onClick={() => setMenu(m => !m)}><MoreIcon size={16} /></button>
        <button type="button" className="mp-hb icon wide-only" aria-label="Close the map" title="Close (Esc)" onClick={closeSheet}><XIcon size={14} /></button>
        {menu && (
          <div className="mp-menu mp-pop" role="menu" onClick={() => setMenu(false)}>
            <button type="button" role="menuitemcheckbox" aria-checked={all} onClick={() => setAll(a => !a)}><CheckIcon size={13} />{all ? 'Hide' : 'Show'} older finished steps{flow.older ? ` (${flow.older})` : ''}</button>
            {pinned && <button type="button" role="menuitem" onClick={tidy}><FitIcon size={13} />Tidy up: lay every step out again</button>}
            {!wide && <button type="button" role="menuitem" onClick={() => { setSel(null); setPanel('history'); }}><HistoryIcon size={13} />History</button>}
            <button type="button" role="menuitem" onClick={() => fit(true)}><FitIcon size={13} />Fit the whole route <kbd>⇧1</kbd></button>
            <button type="button" role="menuitem" onClick={copyMermaid}><OpenIcon size={13} />Copy as a Mermaid flowchart</button>
            <button type="button" role="menuitem" onClick={() => download(`${slug}-map.json`, JSON.stringify(toJson(goal, flow), null, 2))}><OpenIcon size={13} />Download as JSON</button>
          </div>
        )}
      </div>

      <div className="mp-hud mp-nav">
        {wide && <Minimap layout={layout} cam={cam} size={vpSize} nextKey={nextKey} onJump={(x, y) => setCam({ ...camRef.current, x: vpSize.w / 2 - x * camRef.current.z, y: vpSize.h / 2 - y * camRef.current.z })} />}
        <div className="mp-zoom">
          <button type="button" className="mp-hb icon" aria-label="Zoom out" onClick={() => zoomAt(z / 1.2, vpSize.w / 2, vpSize.h / 2)}><MinusIcon size={15} /></button>
          <button type="button" className="mp-z num" onClick={() => setCam({ ...camRef.current, z: 1 })} title="Back to 100%">{Math.round(z * 100)}%</button>
          <button type="button" className="mp-hb icon" aria-label="Zoom in" onClick={() => zoomAt(z * 1.2, vpSize.w / 2, vpSize.h / 2)}><PlusIcon size={15} /></button>
          <button type="button" className="mp-hb icon" aria-label="Fit the whole route" title="Fit the whole route (⇧1)" onClick={() => fit(true)}><FitIcon size={15} /></button>
        </div>
      </div>

      <div className="mp-hud mp-dock" role="toolbar" aria-label="Add to the plan">
        {TOOLS.map(x => (
          <button key={x.kind} type="button" className="mp-tool" title={x.hint} aria-label={`Add a ${x.label.toLowerCase()}`}
            onPointerDown={e => carry(e, { kind: x.kind, label: x.kind === 'task' ? 'New step' : x.kind === 'wait' ? 'Someone or something' : x.kind === 'goal' ? 'New sub-goal' : 'New key result' }, () => addKind(x.kind))}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addKind(x.kind); } }}>
            <ToolShape kind={x.kind} /><span>{x.label}</span>
          </button>
        ))}
        <span className="mp-dsep" />
        <Backlog open={tray} onToggle={() => setTray(t => !t)} sel={selStep && selStep.kind !== 'milestone' ? selStep.title : null}
          onCarry={(e, t) => carry(e, { kind: 'task', label: t.title, task: t }, () => adoptHere(t))} onAdd={adoptHere} />
        <span className="mp-dsep" />
        <form className={'mp-ask' + (listen.listening ? ' on' : '')} onSubmit={e => { e.preventDefault(); void tell(ask); }}>
          <SparkIcon size={16} />
          <input type="text" value={hearing ?? ask} readOnly={hearing != null} disabled={asking} aria-label="Change the plan in your words"
            placeholder={asking ? 'Working it out…' : wide ? 'Change the plan in your words…' : 'Ask…'} onChange={e => setAsk(e.target.value)} />
          {wide && !ask && <kbd className="mp-k">/</kbd>}
          <button type="button" className={'mp-hb icon mp-mic' + (listen.listening ? ' on' : '')} onClick={mic}
            aria-label={listen.listening ? 'Stop and change it' : 'Say what to change'} title={listen.listening ? 'Stop and change it (⌘K)' : 'Say what to change (⌘K)'}>
            {listen.listening ? <StopIcon size={13} /> : <MicIcon size={15} />}
          </button>
        </form>
      </div>

      {asked && (
        <div className={'mp-asked mp-pop' + (asked.apply ? ' has' : '')} role="status">
          <div className="mp-ah"><SparkIcon size={15} /><span>{asked.apply ? <><b>{asked.lines.length} change{asked.lines.length === 1 ? '' : 's'}</b> to make, shown on the map in green</> : asked.reply}</span>
            <span className="spacer" /><button type="button" className="mp-hb icon" aria-label="Close" onClick={discard}><XIcon size={12} /></button></div>
          {asked.apply && asked.reply && <p className="mp-ar">{asked.reply}</p>}
          {asked.lines.length > 0 && <ul>{asked.lines.map((l, i) => <li key={i}><span className="mp-dot">+</span>{l}</li>)}</ul>}
          {asked.skipped.length > 0 && <ul className="skip">{asked.skipped.map((l, i) => <li key={i}><span className="mp-dot">–</span>{l}</li>)}</ul>}
          {asked.apply && (
            <div className="mp-af">
              <span className="mp-q">You said “{asked.said}”</span>
              <button type="button" className="btn sm text" onClick={discard}>Discard</button>
              <button type="button" className="btn sm mp-good" onClick={asked.apply}>Make the changes <kbd>⏎</kbd></button>
            </div>
          )}
        </div>
      )}

      {toast && !asked && (
        <div key={toast.id} className="mp-toast mp-pop" role="status">
          <span className="mp-tok"><CheckIcon size={12} w={2.4} /></span><span>{toast.msg}</span>
          {toast.undo && undoLabel && <button type="button" onClick={() => { undo(); setToast(null); }}>Undo</button>}
        </div>
      )}

      {picking && <p className="mp-note" role="status">Click the step that comes after “{shortTitle(cardOf(picking)?.step.title ?? '', 40)}” · <kbd>Esc</kbd> to stop</p>}

      <aside className={'mp-side mp-hud' + (panelOpen ? ' on' : '')} aria-label={panel === 'history' ? 'History' : 'Step'} aria-hidden={!panelOpen}>
        {panel === 'history' ? <History goal={goal} onClose={() => setPanel('inspect')} />
          : selCard ? <Inspector key={selCard.key} s={selCard.step} flow={selOn.flow} focus={focusId === selCard.key} onFocused={() => setFocusId(null)} goal={selOn.goal}
            within={selOn.top ? null : selOn.goal} empty={isEmpty(selCard)} next={selCard.key === nextKey} act={actsFor(selOn)} onClose={() => setSel(null)}
            onDelete={() => setConfirm(selCard.key)} />
          : selLink ? (
            <div className="mp-i">
              <div className="mp-ih"><span className="mp-ieb">Arrow{linkOn.top ? '' : ` · on “${shortTitle(linkOn.goal.title, 30)}”`}</span><span className="spacer" /><button type="button" className="mp-hb icon" aria-label="Close" onClick={() => setSel(null)}><XIcon size={13} /></button></div>
              <div className="mp-ib">
                {selLink.auto ? (
                  <p className="mp-link"><b>{titleOf(selLink.from, linkOn)}</b> is part of <b>{titleOf(selLink.to, linkOn)}</b>: one of the things that has to be true for it. This arrow comes from the goal’s structure.</p>
                ) : (
                  <>
                    <p className="mp-link"><b>{titleOf(selLink.from, linkOn)}</b> has to be done before <b>{titleOf(selLink.to, linkOn)}</b> can start.</p>
                    <div className="mp-row"><button type="button" className="btn sec sm" onClick={() => addTask({ between: selLink }, linkOn)}><PlusIcon size={12} />A step in between</button>
                      <button type="button" className="btn sec sm" onClick={() => unlink(selLink, linkOn)}>Remove the arrow</button></div>
                  </>
                )}
              </div>
            </div>
          ) : null}
      </aside>

      {carrying && (
        <div className="mp-carry" style={{ transform: `translate(${carrying.x}px,${carrying.y}px)` }} aria-hidden="true">
          {carrying.drop && carrying.drop.type !== 'at'
            ? <span className="mp-chipghost"><i className={carrying.kind} />{shortTitle(carrying.label, 40)}</span>
            : <div className={`mp-n ${carrying.kind === 'goal' ? 'sub' : carrying.kind} ready mp-held`} style={{ width: NODE_W, height: NODE_H, transform: `translate(-50%,-50%) scale(${z})` }}>
              <span className="mp-ck" />{carrying.kind === 'milestone' && <span className="mp-bg" />}
              <span className="mp-body"><span className="mp-t">{carrying.label}</span></span>
            </div>}
        </div>
      )}
    </div>
  );
}

/* ---------- one step on the map ---------- */

function Node({ c, b, next, sel, cls, now, preview, onDown, onClick, onEnter, onLeave, onTick, onDraw, onOpen, onUnfold, onAdd }: {
  c: Card; b: Box; next: boolean; sel: boolean; cls: string; now: number; preview: boolean;
  onDown: (e: React.PointerEvent) => void; onClick: () => void; onEnter: () => void; onLeave: () => void;
  onTick: (el: Element | null) => void; onDraw: (e: React.PointerEvent) => void; onOpen: () => void; onUnfold: () => void; onAdd: (how: 'next' | 'par' | 'prev') => void;
}) {
  const s = c.step;
  const kind = s.kind === 'goal' ? 'sub' : s.kind;
  const locked = s.state === 'blocked' && !s.done;
  const open = s.needs.filter(id => !c.tree.flow.byId.get(id)?.done);
  const sched = s.kind === 'task' && !s.done && s.task?.start != null;
  const inside = c.sub?.flow.steps.length ?? 0;
  const t = s.task;
  const ckRef = useRef<HTMLButtonElement>(null);
  return (
    <div className={`mp-n ${kind} ${s.state}${s.done ? ' done' : ''}${next ? ' next' : ''}${sel ? ' sel' : ''}${s.critical && !s.done ? ' crit' : ''}${c.depth ? ' nested' : ''}${sched ? ' sched' : ''}${cls}`}
      data-step={c.key} style={{ transform: `translate(${b.x}px,${b.y}px)`, width: b.w, height: b.h }}
      onPointerDown={c.depth ? undefined : onDown} onClick={e => { e.stopPropagation(); onClick(); }} onPointerEnter={onEnter} onPointerLeave={onLeave}
      onDoubleClick={s.goal ? e => { e.stopPropagation(); onOpen(); } : undefined}
      title={s.goal ? 'Double-click to open its own map' : c.depth ? `On “${c.tree.goal.title}”` : undefined}>
      {next && <span className="mp-tag"><PlayIcon />Up next</span>}
      {s.kind === 'milestone' && <span className="mp-bg" aria-hidden="true" />}
      {s.kind === 'goal' ? (
        <span className="mp-ring"><Ring value={s.done ? 1 : c.sub ? shareOf(c.sub) : s.progress ?? 0} size={36} stroke={3.5} /></span>
      ) : s.kind === 'milestone' ? (
        <button type="button" ref={ckRef} className="mp-flag mp-ck" disabled={!s.done && s.state !== 'reached'} aria-label={s.done ? `Untick ${s.title}` : `Reached: ${s.title}`}
          title={s.done ? 'Untick it' : s.state === 'reached' ? 'Tick it: reached' : 'Ticks itself once everything before it is done, or tick it here once it is'}
          onClick={e => { e.stopPropagation(); onTick(ckRef.current); }}>{s.done ? <CheckIcon size={13} w={2.4} /> : <FlagIcon size={14} />}</button>
      ) : (
        <button type="button" ref={ckRef} className="mp-ck" aria-label={`${s.done ? 'Not done' : s.kind === 'wait' ? 'Heard back' : 'Done'}: ${s.title}`}
          title={s.kind === 'wait' ? (s.done ? 'Waiting again' : 'Heard back') : locked ? 'Locked: finish what’s before it first' : s.done ? 'Reopen' : 'Tick it off'}
          onClick={e => { e.stopPropagation(); onTick(ckRef.current); }}>
          {s.kind === 'wait' && !s.done ? <HourglassIcon size={14} /> : locked ? <LockIcon size={11} /> : <CheckIcon size={12} w={2.4} />}
        </button>
      )}
      <span className="mp-body">
        {s.kind === 'wait' && <span className="mp-eb">Waiting on{s.done ? ' · Heard back' : <> · <span className="num">{waited(s.wait?.created ?? now, now)}</span></>}</span>}
        {s.kind === 'milestone' && (
          <span className="mp-eb">Key result{(() => {
            const ins = s.needs.map(id => c.tree.flow.byId.get(id)).filter(Boolean) as Step[];
            const word = s.done ? 'Reached' : s.state === 'reached' ? 'Tick it' : ins.length ? `${ins.filter(x => x.done).length}/${ins.length}` : '';
            return word ? <span className="mp-cnt num">{word}</span> : null;
          })()}</span>
        )}
        {s.kind === 'goal' && <span className="mp-eb">Sub-goal{inside > 0 && <button type="button" className="mp-inside" onClick={e => { e.stopPropagation(); onUnfold(); }} onDoubleClick={e => e.stopPropagation()} title="Open it here" aria-label={`Show the ${inside} inside ${s.title}`}>{inside} inside<ChevronDown size={10} /></button>}</span>}
        <span className="mp-t">{s.title}</span>
        {s.kind === 'task' && (
          <span className="mp-m">
            {s.done ? <span>Done{t?.doneAt ? ` · ${shortDate(t.doneAt, now)}` : ''}</span> : <>
              {locked && <span className="mp-chip lock"><LockIcon size={10} />After {open.length} step{open.length === 1 ? '' : 's'}</span>}
              {s.repeat && <span className="mp-x"><RepeatIcon size={11} />{s.repeat.week ? `${s.repeat.week.done}/${s.repeat.week.per} wk` : s.repeat.times ? `${s.repeat.done}/${s.repeat.times}` : 'Repeats'}</span>}
              <span className="mp-x"><ClockIcon size={11} />{fmtDur(s.repeat ? t?.minutes ?? s.minutes : s.minutes)}</span>
              {sched && <span className="mp-chip cal" title={fmtWhen(t?.start as number, now)}><CalendarIcon size={10} />{dayWord(t?.start as number, now) === 'Today' ? fmtShort(t?.start as number) : `${dayWord(t?.start as number, now).replace(/^(\w{3})\w*/, '$1')} ${fmtShort(t?.start as number)}`}</span>}
              {t?.priority === 1 && <span className="mp-chip urg" title="Urgent">!</span>}
            </>}
          </span>
        )}
        {s.kind === 'goal' && (
          <span className="mp-m">{s.done ? <span>Achieved</span> : c.sub && c.sub.flow.counts.steps ? <><span>{c.sub.flow.counts.done} of {c.sub.flow.counts.steps} done</span>{s.minutes ? <span>{fmtDur(s.minutes)} left</span> : null}</> : <span>No steps yet</span>}
            {locked && <span className="mp-chip lock"><LockIcon size={10} />Locked</span>}</span>
        )}
      </span>
      {!preview && <span className="mp-port in" aria-hidden="true" />}
      {!preview && s.kind !== 'milestone' && <span className="mp-port out" role="button" aria-label={`Draw an arrow from ${s.title}`} title="Drag to the step that comes after this one" onPointerDown={onDraw} />}
      {!preview && (s.kind !== 'milestone' ? (
        <>
          <button type="button" className="mp-plus next" aria-label={`Add the next step after ${s.title}`} title="Add the next step (Tab)" onClick={e => { e.stopPropagation(); onAdd('next'); }}><PlusIcon size={12} /></button>
          <button type="button" className="mp-plus par" aria-label={`Add a step alongside ${s.title}`} title="Add a step alongside (Enter)" onClick={e => { e.stopPropagation(); onAdd('par'); }}><PlusIcon size={12} /></button>
        </>
      ) : (
        <button type="button" className="mp-plus prev" aria-label={`Add a step that leads to ${s.title}`} title="Add a step that leads here (Tab)" onClick={e => { e.stopPropagation(); onAdd('prev'); }}><PlusIcon size={12} /></button>
      ))}
    </div>
  );
}

/* ---------- the minimap ---------- */

function Minimap({ layout, cam, size, nextKey, onJump }: { layout: TreeLayout; cam: { x: number; y: number; z: number }; size: { w: number; h: number }; nextKey: string | null; onJump: (x: number, y: number) => void }) {
  const W = 184, H = 100, pad = 8;
  const k = Math.min((W - pad * 2) / layout.width, (H - pad * 2) / layout.height);
  const ox = pad + (W - pad * 2 - layout.width * k) / 2, oy = pad + (H - pad * 2 - layout.height * k) / 2;
  const jump = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    onJump((e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k);
  };
  return (
    <div className="mp-mini" title="Click or drag to move around"
      onPointerDown={e => { e.stopPropagation(); jump(e); const el = e.currentTarget; el.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (e.buttons) jump(e); }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {layout.frames.map(f => <rect key={f.key} x={ox + f.box.x * k} y={oy + f.box.y * k} width={f.box.w * k} height={f.box.h * k} rx={3} className="mm-f" />)}
        {[...layout.cards.values()].filter(c => !c.open).map(c => (
          <rect key={c.key} x={ox + c.box.x * k} y={oy + c.box.y * k} width={Math.max(2, c.box.w * k)} height={Math.max(2, c.box.h * k)} rx={1.5}
            className={'mm-n ' + (c.key === nextKey ? 'next' : c.step.done || c.step.state === 'reached' ? 'done' : c.step.kind === 'wait' ? 'wait' : c.step.state === 'blocked' ? 'locked' : 'ready')} />
        ))}
        <circle cx={ox + (layout.goal.x + GOAL_W / 2) * k} cy={oy + layout.port.y * k} r={(RING / 2) * k} className="mm-g" />
      </svg>
      <span className="mp-view" style={{ left: ox + (-cam.x / cam.z) * k, top: oy + (-cam.y / cam.z) * k, width: (size.w / cam.z) * k, height: (size.h / cam.z) * k }} />
    </div>
  );
}

/* ---------- the side panel: one step ---------- */

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
  /** Open a goal's own map. */
  open: (goal: string) => void;
  /** Select another step on the map. */
  go: (id: string) => void;
  repeatOf: (id: string) => Repeat | null;
  goalById: (id: string | null | undefined) => Goal | null;
  slot: (id: string) => void;
}

const LENGTHS = [15, 30, 60, 90, 120, 240];

/** A step in a list in the side panel, with its state's glyph. */
function DepGlyph({ s }: { s: Step | undefined }) {
  if (!s) return <span className="mp-dg" />;
  if (s.kind === 'wait') return <span className={'mp-dg wait' + (s.done ? ' on' : '')}>{s.done ? <CheckIcon size={10} w={2.4} /> : <HourglassIcon size={11} />}</span>;
  if (s.kind === 'milestone') return <span className={'mp-dg flag' + (s.done ? ' on' : '')}>{s.done ? <CheckIcon size={10} w={2.4} /> : <FlagIcon size={11} />}</span>;
  if (s.done) return <span className="mp-dg on"><CheckIcon size={10} w={2.4} /></span>;
  if (s.state === 'blocked') return <span className="mp-dg lock"><LockIcon size={9} /></span>;
  return <span className="mp-dg" />;
}

function Inspector({ s, flow, focus, onFocused, goal, within, empty, next, act, onClose, onDelete }: {
  s: Step; flow: ReturnType<typeof buildFlow>; focus: boolean; onFocused: () => void; goal: Goal;
  /** The sub-goal whose chart the step is on, when that's open inside this one. */
  within: Goal | null;
  /** A sub-goal with nothing on its own chart yet. */
  empty: boolean;
  next: boolean;
  act: Acts;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { now, openEditor } = usePlanner();
  const [title, setTitle] = useState(s.title);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setTitle(s.title), [s.title]);
  useEffect(() => { if (focus && input.current) { input.current.focus(); input.current.select(); onFocused(); } }, [focus, onFocused]);
  const others = flow.steps.filter(x => x.id !== s.id);
  const links = planOf(goal).links;
  const canNeed = others.filter(x => x.kind !== 'milestone' && !s.needs.includes(x.id) && !wouldLoop(links, x.id, s.id));
  const canUnblock = s.kind === 'milestone' ? [] : others.filter(x => !s.unblocks.includes(x.id) && !wouldLoop(links, s.id, x.id));
  const name = (id: string) => flow.byId.get(id)?.title ?? 'a step';
  const fixed = (from: string, to: string) => flow.links.some(l => l.from === from && l.to === to && l.auto);
  const t = s.task;
  const locked = s.state === 'blocked' && !s.done;
  const open = s.needs.filter(id => !flow.byId.get(id)?.done);
  const banner = s.done ? { k: 'done', text: s.kind === 'milestone' ? 'Reached.' : s.kind === 'wait' ? 'Heard back.' : `Done${t?.doneAt ? ` ${shortDate(t.doneAt, now).toLowerCase()}` : ''}.${s.unblocks.length ? ` It opened the way for ${s.unblocks.length}.` : ''}` }
    : locked ? { k: 'locked', text: `Locked until ${open.map(id => `“${shortTitle(name(id), 30)}”`).join(' and ')} ${open.length > 1 ? 'are' : 'is'} done.` }
    : s.kind === 'wait' ? { k: 'wait', text: `${stateText(s, flow.byId, now)}. It holds up ${s.unblocks.length || 'nothing yet'}${s.unblocks.length ? ` step${s.unblocks.length === 1 ? '' : 's'}` : ''}.` }
    : next ? { k: 'next', text: `Up next. Nothing is in its way${s.critical ? ', and it’s on the critical path' : ''}.` }
    : { k: 'ready', text: stateText(s, flow.byId, now, empty) };
  const doneLabel = s.kind === 'milestone' ? (s.done ? 'Untick' : 'Tick: reached') : s.kind === 'goal' ? (s.done ? 'Bring it back' : 'Achieved') : s.kind === 'wait' ? (s.done ? 'Waiting again' : 'Heard back') : s.done ? 'Reopen' : 'Mark done';
  return (
    <div className="mp-i">
      <div className="mp-ih">
        <span className="mp-ieb">{s.repeat ? 'Repeating step' : KIND[s.kind]}{s.critical && !s.done ? <> · <b>Critical path</b></> : null}</span>
        <span className="spacer" />
        <button type="button" className="mp-hb icon" aria-label="Close" onClick={onClose}><XIcon size={13} /></button>
      </div>
      <div className="mp-ib">
        {within && <p className="mp-in">On “{shortTitle(within.title, 44)}”, inside this map. <button type="button" className="link sm" onClick={() => act.open(within.id)}>Its own map</button></p>}
        <div className="mp-ititle">
          <DepGlyph s={s} />
          <textarea ref={input} rows={2} aria-label="Title" value={title} maxLength={s.kind === 'wait' ? WAIT_TITLE_MAX : 160}
            onChange={e => setTitle(e.target.value)} onBlur={() => act.rename(s, title)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              e.currentTarget.blur();
              (document.querySelector('.mp-vp') as HTMLElement | null)?.focus({ preventScroll: true });
            }} />
        </div>
        <p className={'mp-banner ' + banner.k}>{banner.k === 'next' ? <PlayIcon /> : banner.k === 'locked' ? <LockIcon size={12} /> : banner.k === 'wait' ? <HourglassIcon size={13} /> : banner.k === 'done' ? <CheckIcon size={12} w={2.2} /> : null}{banner.text}</p>
        {s.repeat && (
          <div className="mp-rep">
            <RepeatIcon size={14} />
            <span><b>{s.repeat.rule}</b>{s.repeat.times ? <> · <span className="num">{s.repeat.done} of {s.repeat.times} done</span></> : s.repeat.done ? <> · <span className="num">{s.repeat.done} done so far</span></> : null}</span>
            {s.repeat.times ? <span className="mp-rep-bar" aria-hidden="true"><i style={{ width: `${Math.round((s.repeat.done / s.repeat.times) * 100)}%` }} /></span> : null}
          </div>
        )}
        {s.repeat?.week && act.repeatOf(s.repeat.id) && <WeekLog repeat={act.repeatOf(s.repeat.id) as Repeat} />}

        <div className="mp-row">
          {!(locked && s.kind === 'task') && (s.kind !== 'milestone' || s.done || s.state === 'reached') && (
            <button type="button" className={'btn ' + (s.done ? 'sec' : 'mp-pri')} onClick={() => act.toggle(s)}>{!s.done && <CheckIcon size={14} w={2.2} />}{doneLabel}</button>
          )}
          {s.goal && <button type="button" className="btn sec" onClick={() => act.open((s.goal as Goal).id)}><MapIcon size={14} />Its map</button>}
          {t && t.status === 'open' && !t.externalId && (t.start == null
            ? <button type="button" className="btn sec" onClick={() => act.slot(t.id)}><CalendarIcon size={14} />Next free slot</button>
            : <span className="mp-when"><CalendarIcon size={13} />{fmtWhen(t.start, now)}</span>)}
        </div>

        {t && !t.externalId && (
          <>
            <div className="mp-fld">
              <span className="mp-lbl">Length</span>
              <div className="mp-seg" role="radiogroup" aria-label="Length">
                {LENGTHS.map(m => <button key={m} type="button" className="num" role="radio" aria-checked={t.minutes === m} onClick={() => act.patchTask(s, { minutes: m }, 'change the length')}>{fmtDur(m)}</button>)}
              </div>
            </div>
            <div className="mp-fld">
              <span className="mp-lbl">Priority</span>
              <div className="mp-seg" role="radiogroup" aria-label="Priority">
                {([1, 2, 3] as Priority[]).map(p => <button key={p} type="button" role="radio" aria-checked={t.priority === p} onClick={() => act.patchTask(s, { priority: p }, 'change the priority')}>{PRI[p]}</button>)}
              </div>
            </div>
          </>
        )}

        <div className="mp-fld">
          <span className="mp-lbl">{s.kind === 'milestone' ? 'What leads here' : 'Before this'}</span>
          <ul className="mp-dep">
            {s.needs.map(id => (
              <li key={id}><button type="button" className="mp-dl" onClick={() => act.go(id)}><DepGlyph s={flow.byId.get(id)} /><span className="ell">{flow.byId.get(id)?.kind === 'wait' ? 'Waiting on ' : ''}{name(id)}</span></button>
                {fixed(id, s.id) ? <span className="muted sm" title="Part of the goal’s structure">under it</span>
                  : <button type="button" className="mp-hb icon" aria-label={`Doesn’t need ${name(id)}`} title="Take the arrow away" onClick={() => act.unlink({ from: id, to: s.id })}><XIcon size={11} /></button>}</li>
            ))}
            {!s.needs.length && <li className="mp-none">{s.kind === 'milestone' ? 'Nothing leads here yet.' : 'Nothing: it can start now.'}</li>}
          </ul>
          <div className="mp-adds">
            {canNeed.length > 0 && (
              <select className="mp-sel" value="" aria-label="Add a step this one needs first" onChange={e => { if (e.target.value) act.link({ from: e.target.value, to: s.id }); }}>
                <option value="">{s.kind === 'milestone' ? '+ A step that leads here…' : '+ Needs…'}</option>
                {canNeed.map(x => <option key={x.id} value={x.id}>{x.kind === 'wait' ? 'Waiting on ' : ''}{shortTitle(x.title, 50)}</option>)}
              </select>
            )}
            <button type="button" className="mp-add" onClick={() => act.addTask({ before: s.id })}><PlusIcon size={11} />A new step before it</button>
            {s.kind !== 'wait' && <button type="button" className="mp-add" onClick={() => act.addWait(s.id)}><HourglassIcon size={11} />Wait on someone or something</button>}
          </div>
        </div>

        {s.kind !== 'milestone' && (
          <div className="mp-fld">
            <span className="mp-lbl">Unlocks</span>
            <ul className="mp-dep">
              {s.unblocks.map(id => (
                <li key={id}><button type="button" className="mp-dl" onClick={() => act.go(id)}><DepGlyph s={flow.byId.get(id)} /><span className="ell">{name(id)}</span></button>
                  {fixed(s.id, id) ? <span className="muted sm" title="Part of the goal’s structure">for it</span>
                    : <button type="button" className="mp-hb icon" aria-label={`Doesn’t unlock ${name(id)}`} title="Take the arrow away" onClick={() => act.unlink({ from: s.id, to: id })}><XIcon size={11} /></button>}</li>
              ))}
              {!s.unblocks.length && <li className="mp-none">Nothing yet: it leads straight to the goal.</li>}
            </ul>
            <div className="mp-adds">
              {canUnblock.length > 0 && (
                <select className="mp-sel" value="" aria-label="Add a step this one unlocks" onChange={e => { if (e.target.value) act.link({ from: s.id, to: e.target.value }); }}>
                  <option value="">+ Unlocks…</option>
                  {canUnblock.map(x => <option key={x.id} value={x.id}>{x.kind === 'milestone' ? '◆ ' : x.kind === 'wait' ? 'Waiting on ' : ''}{shortTitle(x.title, 50)}</option>)}
                </select>
              )}
              <button type="button" className="mp-add" onClick={() => act.addTask({ after: s.id })}><PlusIcon size={11} />What comes next</button>
              <button type="button" className="mp-add" onClick={() => act.addTask({ beside: s.id })}><PlusIcon size={11} />A step alongside it</button>
            </div>
          </div>
        )}

        {s.kind === 'milestone' && (
          <div className="mp-row">
            {(s.depth ?? 0) < 2 && <button type="button" className="btn sec sm" onClick={() => act.addKr(s.result?.id ?? null)}><PlusIcon size={12} />Key result under it</button>}
            <button type="button" className="btn sec sm" onClick={() => act.addSubGoal(s.result?.id)}><PlusIcon size={12} />Sub-goal for it</button>
          </div>
        )}
        {s.goal && (
          <p className="mp-note2">
            {s.goal.results.length ? `${s.goal.results.length} key result${s.goal.results.length === 1 ? '' : 's'} of its own. ` : 'No key results of its own yet: open its map to add them. '}
            {s.goal.parentKr ? <>It’s there for “{shortTitle(flow.byId.get(`kr:${s.goal.parentKr}`)?.title ?? '', 40)}”.</> : 'It’s for this goal as a whole.'}
          </p>
        )}
        {s.kind === 'milestone' && <p className="mp-note2">Key results are the goal’s “Done when” lines. One with key results under it is reached when they all are.</p>}
      </div>
      <div className="mp-if">
        {t && !t.externalId && <button type="button" className="btn text sm" onClick={() => openEditor(t.id)} title={s.repeat ? 'Change how it repeats, or when it ends' : 'Make it repeat: days of the week, monthly, until a date or a number of times'}><RepeatIcon size={12} />{s.repeat ? 'Repeats' : 'Repeat'}</button>}
        {t && <button type="button" className="btn text sm" onClick={() => openEditor(t.id)}>Editor</button>}
        <span className="spacer" />
        {t && <button type="button" className="btn text sm" onClick={() => act.removeStep(s, 'off')} title="Take it off this goal: it stays in your planner, off-goal">Off this goal</button>}
        <button type="button" className="btn text sm mp-warn" onClick={onDelete}>{s.kind === 'goal' ? 'Drop' : s.kind === 'wait' ? 'Remove' : s.repeat ? 'Stop' : 'Delete'}</button>
      </div>
    </div>
  );
}

/** Off-goal tasks, to bring onto this goal: drag one onto the map, or + to add it after the selected step. */
function Backlog({ open, onToggle, sel, onCarry, onAdd }: { open: boolean; onToggle: () => void; sel: string | null; onCarry: (e: React.PointerEvent, t: Task) => void; onAdd: (t: Task) => void }) {
  const { tasks, isOff, goalOf, now, wide } = usePlanner();
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = tasks.filter(t => t.status === 'open' && !isEvent(t) && !isOff(t) && !goalOf(t));
  const list = all.filter(t => words.every(w => t.title.toLowerCase().includes(w)))
    .sort((a, b) => a.priority - b.priority || (a.start ?? Infinity) - (b.start ?? Infinity) || (b.created || 0) - (a.created || 0));
  return (
    <>
      <button type="button" className="mp-tool" aria-expanded={open} onClick={onToggle} title="Off-goal tasks to bring onto this goal">
        <InboxIcon size={17} /><span>Backlog</span>{all.length > 0 && <span className="mp-ct num">{all.length}</span>}
      </button>
      {open && (
        <div className="mp-tray mp-pop" aria-label="Backlog">
          <div className="mp-th"><b>Backlog</b><span>{wide ? 'Off-goal. Drag one onto the route.' : 'Off-goal. Tap + to add it.'}</span></div>
          {all.length > 6 && <input className="mp-find" type="search" placeholder="Find a task" value={q} aria-label="Find an off-goal task" onChange={e => setQ(e.target.value)} />}
          {list.length ? (
            <ul>
              {list.slice(0, 200).map(t => (
                <li key={t.id} onPointerDown={e => { if (e.pointerType !== 'touch' && !(e.target as HTMLElement).closest('button')) onCarry(e, t); }}>
                  <span className={`mp-tp p${t.priority}`} title={PRI[t.priority]} />
                  <span className="mp-tt">{occurrenceOf(t.id) && <RepeatIcon size={11} />}{t.title}</span>
                  <span className="mp-tm num">{t.start != null ? fmtWhen(t.start, now) : fmtDur(t.minutes)}</span>
                  <button type="button" className="mp-hb icon" aria-label={`Put “${t.title}” on this goal`} title={sel ? `Add it after “${sel}”` : 'Add it to the map'} onClick={() => onAdd(t)}><PlusIcon size={13} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="mp-none">{q ? 'No off-goal task matches.' : 'Nothing off-goal: every task is on a goal.'}</p>}
        </div>
      )}
    </>
  );
}

/* ---------- the side: history ---------- */

function History({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { readGoalLog, now } = usePlanner();
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    readGoalLog().then(l => { if (alive) setEntries(l.filter(e => e.goal === goal.id).reverse()); });
    return () => { alive = false; };
  }, [readGoalLog, goal.id]);
  const days = new Map<string, LogEntry[]>();
  for (const e of entries ?? []) { const k = ymd(e.at); days.set(k, [...(days.get(k) ?? []), e]); }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ goal: { id: goal.id, title: goal.title }, history: [...(entries ?? [])].reverse() }, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'goal-history.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="mp-i">
      <div className="mp-ih"><span className="mp-ieb">History</span><span className="spacer" />{!!entries?.length && <button type="button" className="link sm" onClick={download}>Download</button>}<button type="button" className="mp-hb icon" aria-label="Close" onClick={onClose}><XIcon size={13} /></button></div>
      <div className="mp-ib">
        {!entries ? <p className="mp-none">Reading the history…</p>
          : !entries.length ? <p className="mp-none">Nothing yet. Every step you add, link, finish or rename shows up here, so you can see how the plan changed.</p>
          : [...days].map(([day, list]) => (
            <section key={day} className="mp-hd">
              <h4>{day === ymd(now) ? 'Today' : longDate(list[0].at)}</h4>
              <ul>{list.map((e, i) => <li key={i} className={'mp-he ' + e.op}><span className="num">{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span>{describeEntry(e)}</span></li>)}</ul>
            </section>
          ))}
      </div>
    </div>
  );
}

/** A burst of the goal's colour where something was ticked off. */
function burst(x: number, y: number) {
  const host = document.querySelector('.mp') ?? document.body;
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('i');
    s.className = 'mp-spark' + (i % 3 === 0 ? ' alt' : '');
    const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4, d = 22 + Math.random() * 18;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    host.appendChild(s);
    window.setTimeout(() => s.remove(), 760);
  }
}

/** A goal's chart, for what's blocked on it. */
export function useGoalFlow(goal: Goal) {
  const { tasks, now, goals, repeats } = usePlanner();
  return useMemo(() => buildFlow(goal, tasks, now, { goals, repeats }), [goal, tasks, now, goals, repeats]);
}

/** The goal's step count, for buttons that open its map. */
export const useFlowCount = (goal: Goal) => useGoalFlow(goal).counts;
