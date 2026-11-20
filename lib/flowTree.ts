import type { Task } from './model';
import type { Goal } from './goals';
import type { Repeat } from './repeat';
import { FINISH, MERMAID_CLASSES, buildFlow, linkKey, mermaidNode, mm, mmId, toJson, type Flow, type Link, type Pos, type Step } from './flow';

/*
 * A goal's map: its chart with its sub-goals' charts inside it, so one canvas shows the whole tree.
 *
 * Each goal's own chart is still buildFlow's (lib/flow.ts): its steps, their arrows, columns and critical path. The
 * steps run left to right in their columns, and the goal is the finish, on the right: every step nothing comes after
 * leads on to it. A sub-goal's step can open in place, as a frame with a header bar on top and its own chart laid out
 * under it, as deep as the tree goes; the columns of the chart around it grow to fit.
 *
 * Every arrow leaves a card straight to the right edge of its column and only bends in the gap between two columns,
 * where nothing else is, so in a laid-out chart no line runs through a card.
 */

/* ---------- geometry ---------- */

export const PAD = 40, NODE_W = 236, NODE_H = 80, GAP_X = 64, ROW_H = 100;
/** Between two steps in a column. */
export const GAP_Y = ROW_H - NODE_H;
/** An open sub-goal's frame: its header bar, and the room inside it on the other three sides. */
export const HEAD = 56, FRAME = 16;
/** The goal, at the end: a ring, its title under it. Arrows reach the ring's left edge, at its middle. */
export const GOAL_W = 216, GOAL_H = 252, RING = 152, RING_TOP = 34;
/** Where the first column starts. */
export const COL1_X = PAD;

export interface Box { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

/** Two boxes too close for comfort. */
export const clash = (a: Box, b: Box, gap = 12) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/* ---------- the tree ---------- */

export interface FlowTree {
  goal: Goal;
  flow: Flow;
  /** Its sub-goals' charts, by their step id here ("goal:<id>"), as deep as asked for. */
  subs: Map<string, FlowTree>;
}

/**
 * A goal's chart and, `depth` levels down (1 is the goal's chart alone; the default is all of them), each of its
 * sub-goals' charts. Every chart is the one that goal's own canvas shows; the goal's own has its lanes on to the goal.
 */
export function buildTree(goal: Goal, tasks: Task[], now: number, opts: { all?: boolean; goals?: Goal[]; repeats?: Repeat[]; depth?: number } = {}): FlowTree {
  const depth = opts.depth ?? Infinity;
  const fo = { all: opts.all, goals: opts.goals, repeats: opts.repeats };
  const seen = new Set<string>();
  const grow = (g: Goal, level: number): FlowTree => {
    seen.add(g.id);
    const flow = buildFlow(g, tasks, now, { ...fo, finish: level === 1 });
    const subs = new Map<string, FlowTree>();
    if (level < depth) for (const s of flow.steps) if (s.goal && !seen.has(s.goal.id)) subs.set(s.id, grow(s.goal, level + 1));
    return { goal: g, flow, subs };
  };
  return grow(goal, 1);
}

/** A step's key on the canvas: its id on the goal's own chart, "<goal id>/<step id>" on a sub-goal's inside it. */
export const nodeKey = (root: string, owner: string, id: string) => (owner === root ? id : `${owner}/${id}`);

/** An arrow's key: linkKey on the goal's own chart, "<goal id>/" before it on a sub-goal's. */
export const edgeKey = (root: string, owner: string, l: Link) => (owner === root ? linkKey(l) : `${owner}/${linkKey(l)}`);

/* ---------- which sub-goals are open ---------- */

/** Sub-goals you've closed on a map, by goal id, kept in this browser. Every other one is open. */
export const COLLAPSED_KEY = 'ds.flow.collapsed';
export const MAX_COLLAPSED = 400;

export function normalizeCollapsed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) && !out.includes(v)) out.push(v);
  return out.slice(-MAX_COLLAPSED);
}

export const toggleCollapsed = (list: string[], id: string): string[] =>
  (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-MAX_COLLAPSED));

/* ---------- laying it out ---------- */

export interface Card {
  key: string;
  /** The step's id on its own goal's chart. */
  id: string;
  step: Step;
  /** The chart it's on, and how far down (0 for the goal's own). */
  tree: FlowTree;
  depth: number;
  /** The card; for an open sub-goal, its whole frame. */
  box: Box;
  /** For a sub-goal: its own chart, and whether it's open here. */
  sub: FlowTree | null;
  open: boolean;
  /** Where you put it by hand (or out of the way of that), so its arrows go straight, not through lanes. */
  moved: boolean;
  /** Where its arrows start (its right edge), and where they run straight to (its column's edge). */
  out: number;
  exit: number;
}

/** An open sub-goal: its frame, around its header and its chart. */
export interface Frame { key: string; depth: number; box: Box }

/** One piece of a connector: a straight line, or a curve with two control points, to `to`. */
export interface Seg { to: Pt; c1?: Pt; c2?: Pt }

export interface Edge {
  key: string;
  /** An arrow between two steps; or, from a step nothing comes after, on to the goal ("<id>>@goal"). */
  kind: 'link' | 'finish';
  tree: FlowTree;
  depth: number;
  link?: Link;
  /** Card keys; `to` is FINISH for the goal. */
  from: string;
  to: string;
  start: Pt;
  segs: Seg[];
  /** The middle of it, for the buttons on it. */
  mid: Pt;
}

export interface TreeLayout {
  /** The goal, at the end, and where arrows reach its ring. */
  goal: Box;
  port: Pt;
  cards: Map<string, Card>;
  frames: Frame[];
  edges: Edge[];
  width: number;
  height: number;
}

export interface LayoutOpts {
  /** Whether a sub-goal opens in place; all do by default. */
  open?: (goal: string) => boolean;
  /** Where you've put steps of the goal's own chart by hand. */
  pos?: Record<string, Pos>;
  /** The step being dragged, where it is now: it follows the pointer, and the rest stay put. */
  drag?: { id: string; x: number; y: number } | null;
}

interface Item { step?: Step; lane?: string; idx: number; row: number; w: number; h: number; open: boolean }
interface Measure { w: number; h: number; cols: { w: number; h: number; items: Item[] }[] }
interface Slot { step: Step; box: Box; open: boolean; exit: number }

const midY = (b: Box) => b.y + b.h / 2;

/** How much room each chart takes, with its open sub-goals' charts inside: each column as wide as its widest. */
function measurer(open: (goal: string) => boolean) {
  const memo = new Map<string, Measure>();
  const measure = (t: FlowTree): Measure => {
    const hit = memo.get(t.goal.id);
    if (hit) return hit;
    const f = t.flow;
    const cols = Array.from({ length: f.cols + 1 }, () => ({ w: NODE_W, h: 0, items: [] as Item[] }));
    for (const s of f.steps) {
      const sub = t.subs.get(s.id);
      const inner = sub && sub.flow.steps.length && open(sub.goal.id) ? measure(sub) : null;
      cols[s.col].items.push({
        step: s, idx: 0, row: s.row, open: !!inner,
        w: inner ? Math.max(NODE_W, inner.w) + 2 * FRAME : NODE_W, h: inner ? HEAD + inner.h + FRAME : NODE_H,
      });
    }
    for (const [key, list] of f.lanes) list.forEach((l, idx) => { if (cols[l.col]) cols[l.col].items.push({ lane: key, idx, row: l.row, open: false, w: NODE_W, h: NODE_H }); });
    let w = 0, h = 0;
    cols.forEach((c, i) => {
      if (!i) return;
      c.items.sort((a, b) => a.row - b.row);
      c.w = Math.max(NODE_W, ...c.items.map(x => x.w));
      c.h = c.items.reduce((n, x) => n + x.h, 0) + GAP_Y * Math.max(0, c.items.length - 1);
      w += c.w + (i > 1 ? GAP_X : 0);
      h = Math.max(h, c.h);
    });
    const m = { w, h, cols };
    memo.set(t.goal.id, m);
    return m;
  };
  return measure;
}

/** Where each step and lane of a chart goes, its first column at x0, each column centred in a height h from y0. */
function slots(m: Measure, x0: number, y0: number, h: number) {
  const steps: Slot[] = [];
  const lanes = new Map<string, Box[]>();
  let x = x0;
  m.cols.forEach((c, i) => {
    if (!i) return;
    let y = y0 + (h - c.h) / 2;
    for (const it of c.items) {
      // A lane is as wide as its column, so an arrow runs straight across it.
      const box = { x, y, w: it.lane ? c.w : it.w, h: it.h };
      if (it.step) steps.push({ step: it.step, box, open: it.open, exit: x + c.w });
      else { const l = lanes.get(it.lane as string) ?? []; l[it.idx] = box; lanes.set(it.lane as string, l); }
      y += it.h + GAP_Y;
    }
    x += c.w + GAP_X;
  });
  return { steps, lanes };
}

/**
 * A connector from `start`, straight to `exit`, then through each lane (curving into it, straight across it) and into
 * the left edge of `end`, curving only between columns.
 */
export function route(start: Pt, exit: number, via: Box[], end: Box): { start: Pt; segs: Seg[]; mid: Pt } {
  const segs: Seg[] = [];
  const mids: Pt[] = [];
  let p = start;
  const line = (x: number) => { if (x > p.x + 0.5) { p = { x, y: p.y }; segs.push({ to: p }); } };
  const bend = (q: Pt) => {
    const dx = Math.max(28, (q.x - p.x) / 2);
    const c1 = { x: p.x + dx, y: p.y }, c2 = { x: q.x - dx, y: q.y };
    segs.push({ c1, c2, to: q });
    mids.push({ x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 });
    p = q;
  };
  line(exit);
  for (const v of via) { bend({ x: v.x, y: midY(v) }); line(v.x + v.w); }
  bend({ x: end.x - 4, y: midY(end) });
  return { start, segs, mid: mids[Math.floor((mids.length - 1) / 2)] };
}

/** A connector as an SVG path. */
export const pathD = (e: Pick<Edge, 'start' | 'segs'>) =>
  `M ${e.start.x} ${e.start.y}` + e.segs.map(s => (s.c1 && s.c2 ? ` C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.to.x} ${s.to.y}` : ` L ${s.to.x} ${s.to.y}`)).join('');

/**
 * Where everything goes. The goal's chart in its columns, each centred on the middle of the goal's ring; every open
 * sub-goal's frame holding its own chart, laid out the same way, as deep as they go; then the goal, past the last of
 * them. A step you've moved by hand on the goal's own chart stays where you put it, and a laid-out one in its way moves
 * down a row at a time; an open sub-goal you've moved keeps its place unless its frame would cover something, when it
 * moves down too.
 */
export function layoutTree(tree: FlowTree, opts: LayoutOpts = {}): TreeLayout {
  const open = opts.open ?? (() => true);
  const measure = measurer(open);
  const root = tree.goal.id;
  const cards = new Map<string, Card>();
  const frames: Frame[] = [];
  const charts: { tree: FlowTree; depth: number; lanes: Map<string, Box[]>; finish: boolean }[] = [];

  /** A card on a chart and, for an open sub-goal, everything inside its frame. */
  const emit = (t: FlowTree, s: Slot, box: Box, depth: number, moved: boolean) => {
    const key = nodeKey(root, t.goal.id, s.step.id);
    const sub = t.subs.get(s.step.id) ?? null;
    const isOpen = s.open && !!sub;
    const out = box.x + box.w;
    if (isOpen) frames.push({ key, depth, box });
    cards.set(key, { key, id: s.step.id, step: s.step, tree: t, depth, box, sub, open: isOpen, moved, out, exit: moved ? out : Math.max(out, s.exit) });
    if (!isOpen || !sub) return;
    const m = measure(sub);
    const inner = slots(m, box.x + FRAME, box.y + HEAD, m.h);
    charts.push({ tree: sub, depth: depth + 1, lanes: inner.lanes, finish: false });
    for (const x of inner.steps) emit(sub, x, x.box, depth + 1, false);
  };

  // The goal's own chart, its middle level with the middle of the goal's ring.
  const m = measure(tree);
  const contentH = Math.max(NODE_H, m.h);
  const ringMid = RING_TOP + RING / 2;
  const mid = PAD + Math.max(contentH / 2, ringMid);
  const top = slots(m, COL1_X, mid - contentH / 2, contentH);
  const pos = opts.pos ?? {};
  const placed: Box[] = [];
  const moved = new Set<string>();
  const at = new Map<string, Box>();
  const down = (b: Box) => {
    let c = b;
    for (let i = 0; i < 200 && placed.some(o => clash(c, o)); i++) c = { ...c, y: c.y + ROW_H };
    return c;
  };
  // Steps you've put by hand: exactly there, but an open sub-goal never on top of anything, nor off the top.
  const pinned = top.steps.filter(s => pos[s.step.id]);
  for (const s of [...pinned.filter(x => !x.open), ...pinned.filter(x => x.open)]) {
    const p = pos[s.step.id];
    let box: Box = { x: p.x, y: p.y, w: s.box.w, h: s.box.h };
    if (s.open) box = down({ ...box, y: Math.max(box.y, FRAME) });
    at.set(s.step.id, box);
    placed.push(box);
    moved.add(s.step.id);
  }
  for (const s of top.steps) {
    if (at.has(s.step.id)) continue;
    let box = s.box;
    if (moved.size && placed.some(o => clash(box, o))) { moved.add(s.step.id); box = down(box); }
    at.set(s.step.id, box);
    placed.push(box);
  }
  const drag = opts.drag;
  if (drag && at.has(drag.id)) { const b = at.get(drag.id) as Box; at.set(drag.id, { ...b, x: drag.x, y: drag.y }); moved.add(drag.id); }
  charts.push({ tree, depth: 0, lanes: top.lanes, finish: true });
  for (const s of top.steps) emit(tree, s, at.get(s.step.id) as Box, 0, moved.has(s.step.id));

  // The goal: past everything on its chart (not counting a step on its way somewhere), level with the chart's middle.
  const still = top.steps.filter(s => !(drag && drag.id === s.step.id)).map(s => at.get(s.step.id) as Box);
  const right = Math.max(COL1_X + m.w, ...still.map(b => b.x + b.w));
  const goal: Box = { x: right + GAP_X + 12, y: mid - ringMid, w: GOAL_W, h: GOAL_H };
  const port: Pt = { x: goal.x + (GOAL_W - RING) / 2, y: mid };
  const portBox: Box = { x: port.x, y: port.y - 1, w: 0, h: 2 };

  // The connectors: each chart's arrows, and on the goal's own, from the steps nothing comes after on to the goal.
  const edges: Edge[] = [];
  for (const ch of charts) {
    const owner = ch.tree.goal.id;
    const card = (id: string) => cards.get(nodeKey(root, owner, id));
    for (const l of ch.tree.flow.links) {
      const a = card(l.from), b = card(l.to);
      if (!a || !b) continue;
      const via = !a.moved && !b.moved ? ch.lanes.get(linkKey(l)) ?? [] : [];
      edges.push({
        key: edgeKey(root, owner, l), kind: 'link', tree: ch.tree, depth: ch.depth, link: l, from: a.key, to: b.key,
        ...route({ x: a.out, y: midY(a.box) }, a.exit, via, b.box),
      });
    }
    if (!ch.finish) continue;
    for (const id of ch.tree.flow.ends) {
      const a = card(id);
      if (!a) continue;
      const via = !a.moved ? ch.lanes.get(`${id}>${FINISH}`) ?? [] : [];
      edges.push({ key: `${id}>${FINISH}`, kind: 'finish', tree: ch.tree, depth: 0, from: a.key, to: FINISH, ...route({ x: a.out, y: midY(a.box) }, a.exit, via, portBox) });
    }
  }

  const all = [goal, ...[...cards.values()].map(c => c.box), ...frames.map(f => f.box)];
  return {
    goal, port, cards, frames, edges,
    width: Math.max(...all.map(b => b.x + b.w)) + PAD,
    height: Math.max(...all.map(b => b.y + b.h)) + PAD,
  };
}

/* ---------- export ---------- */

type StepJson = ReturnType<typeof toJson>['steps'][number];
/** A step as get_goal shows it; a sub-goal's carries its own chart when it's asked for. */
export type TreeStepJson = StepJson & { flow?: TreeFlowJson };
export interface TreeFlowJson { steps: TreeStepJson[]; arrows: ReturnType<typeof toJson>['arrows']; critical_path: string[] }

/** A chart as data, each sub-goal's step with its own chart inside it, as deep as the tree goes. */
export function treeJson(t: FlowTree): TreeFlowJson {
  const { steps, arrows, critical_path } = toJson(t.goal, t.flow);
  return {
    steps: steps.map(s => { const sub = t.subs.get(s.id); return sub ? { ...s, flow: treeJson(sub) } : s; }),
    arrows, critical_path,
  };
}

const sgId = (goal: string) => 'sg_' + goal.replace(/[^A-Za-z0-9_]/g, '_');
const innerId = (owner: string, id: string) => `n_${owner.replace(/[^A-Za-z0-9_]/g, '_')}__${id.replace(/[^A-Za-z0-9_]/g, '_')}`;

/**
 * The tree as a Mermaid flowchart. With no sub-goal's chart in it, it's toMermaid's. Otherwise each sub-goal with
 * steps of its own is a subgraph holding its node and its chart (one in another, as deep as the tree goes), joined the
 * way the goal is to its first steps; a step inside one is named by its goal, as "n_<goal id>__<step id>".
 */
export function toMermaidTree(t: FlowTree): string {
  const lines = ['flowchart LR', `  goal(["${mm(t.goal.title)}"])`];
  const edges: string[] = [];
  const walk = (x: FlowTree, owner: string | null, head: string, indent: string) => {
    const id = (sid: string) => (owner == null ? mmId(sid) : innerId(owner, sid));
    for (const r of x.flow.roots) edges.push(`  ${head} --> ${id(r)}`);
    for (const l of x.flow.links) edges.push(`  ${id(l.from)} ${l.auto ? '-.->' : '-->'} ${id(l.to)}`);
    for (const s of x.flow.steps) {
      const sub = x.subs.get(s.id);
      if (!sub?.flow.steps.length) { lines.push(`${indent}${id(s.id)}${mermaidNode(s)}`); continue; }
      // Its node and its chart, in a box of their own. Edges come after every box, so none moves a node out of its box.
      lines.push(`${indent}subgraph ${sgId(sub.goal.id)} [" "]`, `${indent}  ${id(s.id)}${mermaidNode(s)}`);
      walk(sub, sub.goal.id, id(s.id), indent + '  ');
      lines.push(`${indent}end`);
    }
  };
  walk(t, null, 'goal', '  ');
  lines.push(...edges, ...MERMAID_CLASSES);
  return lines.join('\n');
}
