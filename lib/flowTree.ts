import type { Task } from './model';
import type { Goal } from './goals';
import type { Repeat } from './repeat';
import { MERMAID_CLASSES, buildFlow, linkKey, mermaidNode, mm, mmId, toJson, type Flow, type Link, type Pos, type Step } from './flow';

/*
 * A goal's chart with its sub-goals' charts inside it, so one canvas shows the whole tree.
 *
 * Each goal's own chart is still buildFlow's (lib/flow.ts): its steps, their arrows, columns and critical path. Here a
 * sub-goal's step can open in place: its card stays where its chart puts it, and the sub-goal's own chart is laid out
 * to its right, its card standing in for the goal pill. That makes the sub-goal a block as tall and wide as everything
 * in it, and the columns of the chart around it grow to fit. A dashed line from a card to the first steps of its chart
 * means "belongs to", as from the goal pill; arrows between steps are only the ones the goals' own charts have.
 *
 * Every arrow leaves a card straight to the right edge of its column and only bends in the gap between two columns,
 * where nothing else is, so in a laid-out chart no line runs through a card.
 */

/* ---------- geometry ---------- */

export const PAD = 36, GOAL_W = 176, GOAL_H = 76, NODE_W = 200, NODE_H = 72, GAP_X = 72, ROW_H = 96;
/** Between two steps in a column. */
export const GAP_Y = ROW_H - NODE_H;
/** Room inside an open sub-goal's frame, around its card and its chart. */
export const FRAME = 12;
/** Where the first column of the goal's chart starts. */
export const COL1_X = PAD + GOAL_W + GAP_X;

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
 * sub-goals' charts. Every chart is the one that goal's own canvas shows.
 */
export function buildTree(goal: Goal, tasks: Task[], now: number, opts: { all?: boolean; goals?: Goal[]; repeats?: Repeat[]; depth?: number } = {}): FlowTree {
  const depth = opts.depth ?? Infinity;
  const fo = { all: opts.all, goals: opts.goals, repeats: opts.repeats };
  const seen = new Set<string>();
  const grow = (g: Goal, level: number): FlowTree => {
    seen.add(g.id);
    const flow = buildFlow(g, tasks, now, fo);
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

/** Sub-goals you've closed on the chart, by goal id, kept in this browser. Every other one is open. */
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
  box: Box;
  /** For a sub-goal: its own chart, and whether it's open here. */
  sub: FlowTree | null;
  open: boolean;
  /** Where you put it by hand (or out of the way of that), so its arrows go straight, not through lanes. */
  moved: boolean;
  /** Where its arrows start (its right edge; its frame's, when open), and where they run straight to (its column's edge). */
  out: number;
  exit: number;
}

/** An open sub-goal: a faint frame around its card and its chart. */
export interface Frame { key: string; depth: number; box: Box }

/** One piece of a connector: a straight line, or a curve with two control points, to `to`. */
export interface Seg { to: Pt; c1?: Pt; c2?: Pt }

export interface Edge {
  key: string;
  /** A dashed "belongs to" line from a goal (or an open sub-goal's card) to a first step of its chart; or an arrow. */
  kind: 'root' | 'link';
  tree: FlowTree;
  depth: number;
  link?: Link;
  /** Card keys; null `from` is the goal pill. */
  from: string | null;
  to: string;
  start: Pt;
  segs: Seg[];
  /** The middle of it, for the button that removes it. */
  mid: Pt;
}

export interface TreeLayout {
  goal: Box;
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
        w: inner ? NODE_W + GAP_X + inner.w + FRAME : NODE_W, h: inner ? Math.max(NODE_H, inner.h) + 2 * FRAME : NODE_H,
      });
    }
    for (const [key, list] of f.lanes) list.forEach((l, idx) => cols[l.col].items.push({ lane: key, idx, row: l.row, open: false, w: NODE_W, h: NODE_H }));
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

/** An open sub-goal's block around its card: the card in the middle of its left edge. */
const blockAt = (card: Box, size: { w: number; h: number }): Box => ({ x: card.x, y: midY(card) - size.h / 2, w: size.w, h: size.h });
const frameOf = (block: Box): Box => ({ x: block.x - FRAME, y: block.y, w: block.w + FRAME, h: block.h });

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
 * Where everything goes. The goal on the left; its chart's columns, each centred on the tallest, with every open
 * sub-goal's chart laid out the same way inside its block, as deep as they go. A step you've moved by hand on the
 * goal's own chart stays where you put it, and a laid-out one in its way moves down a row at a time; an open sub-goal
 * you've moved keeps its card where you put it unless what's inside it would cover something, when it moves down too.
 */
export function layoutTree(tree: FlowTree, opts: LayoutOpts = {}): TreeLayout {
  const open = opts.open ?? (() => true);
  const measure = measurer(open);
  const root = tree.goal.id;
  const cards = new Map<string, Card>();
  const frames: Frame[] = [];
  const charts: { tree: FlowTree; depth: number; head: Box; headKey: string | null; lanes: Map<string, Box[]> }[] = [];

  /** A card on a chart and, for an open sub-goal, everything inside it. */
  const emit = (t: FlowTree, s: Slot, card: Box, depth: number, moved: boolean) => {
    const key = nodeKey(root, t.goal.id, s.step.id);
    const sub = t.subs.get(s.step.id) ?? null;
    const isOpen = s.open && !!sub;
    let out = card.x + card.w;
    if (isOpen && sub) {
      const block = blockAt(card, s.box);
      frames.push({ key, depth, box: frameOf(block) });
      out = block.x + block.w;
    }
    cards.set(key, { key, id: s.step.id, step: s.step, tree: t, depth, box: card, sub, open: isOpen, moved, out, exit: moved ? out : Math.max(out, s.exit) });
    if (!isOpen || !sub) return;
    const m = measure(sub);
    const inner = slots(m, card.x + NODE_W + GAP_X, midY(card) - m.h / 2, m.h);
    charts.push({ tree: sub, depth: depth + 1, head: card, headKey: key, lanes: inner.lanes });
    for (const x of inner.steps) emit(sub, x, cardIn(x), depth + 1, false);
  };
  /** A laid-out slot's card: the slot itself, or the middle of an open sub-goal's block's left edge. */
  const cardIn = (s: Slot): Box => (s.open ? { x: s.box.x, y: midY(s.box) - NODE_H / 2, w: NODE_W, h: NODE_H } : { ...s.box, w: NODE_W, h: NODE_H });

  // The goal's own chart.
  const m = measure(tree);
  const contentH = Math.max(NODE_H, m.h);
  const height0 = PAD * 2 + contentH;
  const goal: Box = { x: PAD, y: height0 / 2 - GOAL_H / 2, w: GOAL_W, h: GOAL_H };
  const top = slots(m, COL1_X, PAD, contentH);
  const pos = opts.pos ?? {};
  const placed: Box[] = [goal];
  const moved = new Set<string>();
  const at = new Map<string, Box>();
  const bounds = (s: Slot, card: Box) => (s.open ? frameOf(blockAt(card, s.box)) : card);
  const down = (s: Slot, card: Box) => {
    let c = card;
    for (let i = 0; i < 200 && placed.some(o => clash(bounds(s, c), o)); i++) c = { ...c, y: c.y + ROW_H };
    return c;
  };
  // Steps you've put by hand: exactly there, but an open sub-goal never on top of anything, nor off the top.
  const pinned = top.steps.filter(s => pos[s.step.id]);
  for (const s of [...pinned.filter(x => !x.open), ...pinned.filter(x => x.open)]) {
    const p = pos[s.step.id];
    let card: Box = { x: p.x, y: p.y, w: NODE_W, h: NODE_H };
    if (s.open) {
      const above = bounds(s, card).y;
      if (above < FRAME) card = { ...card, y: card.y + FRAME - above };
      card = down(s, card);
    }
    at.set(s.step.id, card);
    placed.push(bounds(s, card));
    moved.add(s.step.id);
  }
  for (const s of top.steps) {
    if (at.has(s.step.id)) continue;
    let card = cardIn(s);
    if (moved.size && placed.some(o => clash(bounds(s, card), o))) { moved.add(s.step.id); card = down(s, card); }
    at.set(s.step.id, card);
    placed.push(bounds(s, card));
  }
  const drag = opts.drag;
  if (drag && at.has(drag.id)) { at.set(drag.id, { x: drag.x, y: drag.y, w: NODE_W, h: NODE_H }); moved.add(drag.id); }
  charts.push({ tree, depth: 0, head: goal, headKey: null, lanes: top.lanes });
  for (const s of top.steps) emit(tree, s, at.get(s.step.id) as Box, 0, moved.has(s.step.id));

  // The connectors: from each chart's head to the steps nothing comes before, and its arrows.
  const edges: Edge[] = [];
  for (const ch of charts) {
    const owner = ch.tree.goal.id;
    const card = (id: string) => cards.get(nodeKey(root, owner, id));
    const head = { x: ch.head.x + ch.head.w, y: midY(ch.head) };
    for (const id of ch.tree.flow.roots) {
      const c = card(id);
      if (c) edges.push({ key: `root:${c.key}`, kind: 'root', tree: ch.tree, depth: ch.depth, from: ch.headKey, to: c.key, ...route(head, head.x, [], c.box) });
    }
    for (const l of ch.tree.flow.links) {
      const a = card(l.from), b = card(l.to);
      if (!a || !b) continue;
      const via = !a.moved && !b.moved ? ch.lanes.get(linkKey(l)) ?? [] : [];
      edges.push({
        key: edgeKey(root, owner, l), kind: 'link', tree: ch.tree, depth: ch.depth, link: l, from: a.key, to: b.key,
        ...route({ x: a.out, y: midY(a.box) }, a.exit, via, b.box),
      });
    }
  }

  const all = [...[...cards.values()].map(c => c.box), ...frames.map(f => f.box)];
  return {
    goal, cards, frames, edges,
    width: Math.max(COL1_X + m.w, ...all.map(b => b.x + b.w)) + PAD,
    height: Math.max(height0, GOAL_H + PAD * 2, ...all.map(b => b.y + b.h + PAD)),
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
