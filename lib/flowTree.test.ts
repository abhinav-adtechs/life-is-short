import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import { normalizeGoals, type Goal } from './goals';
import { buildFlow, toMermaid, type Plan } from './flow';
import {
  COL1_X, FRAME, GAP_X, NODE_H, NODE_W, PAD, ROW_H, buildTree, layoutTree, normalizeCollapsed, pathD, toMermaidTree, toggleCollapsed, treeJson,
  type Box, type Edge, type Pt, type TreeLayout,
} from './flowTree';

const NOW = new Date(2026, 10, 18, 12).getTime();
const task = (id: string, goal: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, raw: '', notes: '', priority: 2, minutes: 60, start: null, due: null, status: 'open', created: 1, order: 1, doneAt: null, goal, ...extra,
});
const g = (id: string, title: string, parent: string | null, plan?: Plan): Record<string, unknown> => ({
  id, title, section: null, results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, ...(parent ? { parent } : {}), ...(plan ? { plan } : {}),
});

/*
 * Close 1Cr
 * ├─ Reach out to 20 capital raisers and syndicates
 * │   ├─ Utpal, Rakesh, Ishan (no tasks yet)
 * │   └─ Identify the rest of the 20 capital raisers and syndicates
 * ├─ Reach out to 20 angels and VCs
 * │   ├─ FinTech Yatra
 * │   │   └─ Prepare and send industry outlook and TAM doc to FinTech Yatra
 * │   └─ Identify the rest of the 20 angels and VCs
 * └─ Reach out to founders for advice
 *     └─ Identify founders to ask for advice
 */
const closeGoals = (extra: { fty?: Plan; top?: Plan; people?: number } = {}): Goal[] => normalizeGoals([
  g('g1cr', 'Close 1Cr', null, extra.top),
  g('gcap', 'Reach out to 20 capital raisers and syndicates', 'g1cr'),
  ...(extra.people
    ? Array.from({ length: extra.people }, (_, i) => g(`gp${i}`, `Person ${i + 1}`, 'gcap'))
    : [g('gutpal', 'Utpal', 'gcap'), g('grakesh', 'Rakesh', 'gcap'), g('gishan', 'Ishan', 'gcap')]),
  g('gang', 'Reach out to 20 angels and VCs', 'g1cr'),
  g('gfty', 'FinTech Yatra', 'gang', extra.fty),
  g('gfound', 'Reach out to founders for advice', 'g1cr'),
]);
const closeTasks = (more: Task[] = []): Task[] => [
  task('tcapid', 'gcap', { title: 'Identify the rest of the 20 capital raisers and syndicates' }),
  task('ttam', 'gfty', { title: 'Prepare and send industry outlook and TAM doc to FinTech Yatra' }),
  task('tangid', 'gang', { title: 'Identify the rest of the 20 angels and VCs' }),
  task('tfound', 'gfound', { title: 'Identify founders to ask for advice' }),
  ...more,
];
const treeOf = (goals: Goal[], tasks: Task[], depth?: number) => buildTree(goals[0], tasks, NOW, { goals, depth });

/* ---------- geometry checks ---------- */

const inside = (p: Pt, b: Box, inset = 2) => p.x > b.x + inset && p.x < b.x + b.w - inset && p.y > b.y + inset && p.y < b.y + b.h - inset;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (outer: Box, b: Box) => b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h;

/** Points along a connector, every few pixels. */
function samples(e: Edge): Pt[] {
  const out: Pt[] = [];
  let p = e.start;
  for (const s of e.segs) {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, u = 1 - t;
      out.push(s.c1 && s.c2
        ? { x: u * u * u * p.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.to.x, y: u * u * u * p.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.to.y }
        : { x: p.x + (s.to.x - p.x) * t, y: p.y + (s.to.y - p.y) * t });
    }
    p = s.to;
  }
  return out;
}

/** No two cards overlap, no card sits half in a frame, and no connector crosses a card. */
function expectClean(l: TreeLayout) {
  const cards = [...l.cards.values()];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    if (overlap(cards[i].box, cards[j].box)) throw new Error(`${cards[i].key} overlaps ${cards[j].key}`);
  }
  for (const c of cards) expect(overlap(c.box, l.goal)).toBe(false);
  for (const f of l.frames) for (const c of cards) {
    if (overlap(f.box, c.box) && !contains(f.box, c.box)) throw new Error(`${c.key} is half in the frame of ${f.key}`);
  }
  for (let i = 0; i < l.frames.length; i++) for (let j = i + 1; j < l.frames.length; j++) {
    const a = l.frames[i].box, b = l.frames[j].box;
    if (overlap(a, b) && !contains(a, b) && !contains(b, a)) throw new Error(`frames ${l.frames[i].key} and ${l.frames[j].key} cross`);
  }
  for (const e of l.edges) {
    const pts = samples(e);
    for (const c of cards) {
      if (c.key === e.from || c.key === e.to) continue;
      const hit = pts.find(p => inside(p, c.box));
      if (hit) throw new Error(`${e.key} runs through ${c.key} at ${Math.round(hit.x)},${Math.round(hit.y)}`);
    }
  }
}

/* ---------- the tree ---------- */

describe('buildTree', () => {
  const goals = closeGoals();
  it('has each sub-goal’s own chart under its step, all the way down', () => {
    const t = treeOf(goals, closeTasks());
    expect([...t.subs.keys()]).toEqual(['goal:gcap', 'goal:gang', 'goal:gfound']);
    const cap = t.subs.get('goal:gcap')!;
    expect(cap.flow.steps.map(s => s.id).sort()).toEqual(['goal:gishan', 'goal:grakesh', 'goal:gutpal', 'tcapid']);
    expect(cap.subs.get('goal:gutpal')!.flow.steps).toEqual([]);
    expect(t.subs.get('goal:gang')!.subs.get('goal:gfty')!.flow.steps.map(s => s.id)).toEqual(['ttam']);
    // Each chart is exactly the one that goal's own canvas shows.
    expect(cap.flow.steps.map(s => [s.id, s.state, s.minutes])).toEqual(buildFlow(goals[1], closeTasks(), NOW, { goals }).steps.map(s => [s.id, s.state, s.minutes]));
  });

  it('goes only as deep as asked', () => {
    expect(treeOf(goals, closeTasks(), 1).subs.size).toBe(0);
    const two = treeOf(goals, closeTasks(), 2);
    expect(two.subs.size).toBe(3);
    expect(two.subs.get('goal:gang')!.subs.size).toBe(0);
  });
});

/* ---------- the layout ---------- */

describe('layoutTree', () => {
  it('lays a flat chart out as it always has: columns from the goal, each centred on the tallest', () => {
    const goals = normalizeGoals([g('g1', 'G', null, { waits: [], links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] })]);
    const l = layoutTree(treeOf(goals, [task('a', 'g1'), task('b', 'g1'), task('c', 'g1')]));
    const box = (k: string) => l.cards.get(k)!.box;
    expect(box('a')).toEqual({ x: COL1_X, y: PAD + ROW_H / 2, w: NODE_W, h: NODE_H });
    expect([box('b').x, box('c').x]).toEqual([COL1_X + NODE_W + GAP_X, COL1_X + NODE_W + GAP_X]);
    expect([box('b').y, box('c').y].sort((x, y) => x - y)).toEqual([PAD, PAD + ROW_H]);
    expect(l.goal).toMatchObject({ x: PAD, w: 176 });
    expect(l.frames).toEqual([]);
    expect(l.edges.map(e => e.key).sort()).toEqual(['a>b', 'a>c', 'root:a']);
    expect(pathD(l.edges.find(e => e.key === 'root:a')!)).toMatch(/^M 212 \d+(\.\d+)? C /);
  });

  it('opens every sub-goal in place: all three layers of Close 1Cr, each to the right of its card', () => {
    const l = layoutTree(treeOf(closeGoals(), closeTasks()));
    expect([...l.cards.keys()].sort()).toEqual([
      'gang/goal:gfty', 'gang/tangid', 'gcap/goal:gishan', 'gcap/goal:grakesh', 'gcap/goal:gutpal', 'gcap/tcapid',
      'gfound/tfound', 'gfty/ttam', 'goal:gang', 'goal:gcap', 'goal:gfound',
    ]);
    const c = (k: string) => l.cards.get(k)!;
    for (const card of l.cards.values()) {
      if (!card.depth) continue;
      // Its parent's card is the head of the chart it's on.
      const parent = [...l.cards.values()].find(p => p.sub === card.tree)!;
      expect(card.box.x).toBe(parent.box.x + NODE_W + GAP_X);
    }
    expect([c('goal:gcap').depth, c('gcap/goal:gutpal').depth, c('gfty/ttam').depth]).toEqual([0, 1, 2]);
    // Open, with a frame: the three threads and FinTech Yatra. The people with no tasks are plain cards.
    expect(l.frames.map(f => f.key).sort()).toEqual(['gang/goal:gfty', 'goal:gang', 'goal:gcap', 'goal:gfound']);
    expect(c('gcap/goal:gutpal')).toMatchObject({ open: false, sub: expect.objectContaining({ flow: expect.objectContaining({ steps: [] }) }) });
    // A dashed line from each head to the steps on its chart, and no arrows: the goals have none.
    expect(l.edges.filter(e => e.kind === 'root').map(e => `${e.from ?? 'goal'}>${e.to}`).sort()).toEqual([
      'gang/goal:gfty>gfty/ttam', 'goal:gang>gang/goal:gfty', 'goal:gang>gang/tangid', 'goal:gcap>gcap/goal:gishan', 'goal:gcap>gcap/goal:grakesh',
      'goal:gcap>gcap/goal:gutpal', 'goal:gcap>gcap/tcapid', 'goal:gfound>gfound/tfound', 'goal>goal:gang', 'goal>goal:gcap', 'goal>goal:gfound',
    ]);
    expect(l.edges.filter(e => e.kind === 'link')).toEqual([]);
    expectClean(l);
    // Each frame holds its card and everything inside it.
    for (const f of l.frames) {
      const head = c(f.key);
      expect(contains(f.box, head.box)).toBe(true);
      for (const k of l.cards.values()) if (k.tree === head.sub) expect(contains(f.box, k.box)).toBe(true);
    }
  });

  it('a closed sub-goal is one card again, and the canvas shrinks', () => {
    const tree = treeOf(closeGoals(), closeTasks());
    const all = layoutTree(tree);
    const l = layoutTree(tree, { open: id => id !== 'gcap' });
    expect(l.cards.get('goal:gcap')).toMatchObject({ open: false, sub: expect.objectContaining({ flow: expect.objectContaining({ steps: expect.any(Array) }) }) });
    expect(l.cards.get('goal:gcap')!.sub!.flow.steps).toHaveLength(4);
    expect([...l.cards.keys()].some(k => k.startsWith('gcap/'))).toBe(false);
    expect(l.edges.some(e => e.from === 'goal:gcap')).toBe(false);
    expect(l.frames.some(f => f.key === 'goal:gcap')).toBe(false);
    expect(l.height).toBeLessThan(all.height);
    // Closing one deeper down leaves the rest open.
    const deep = layoutTree(tree, { open: id => id !== 'gfty' });
    expect(deep.cards.has('gfty/ttam')).toBe(false);
    expect(deep.cards.has('gang/goal:gfty')).toBe(true);
    expectClean(deep);
  });

  it('draws a sub-goal’s arrows inside it as its own chart does, and none it doesn’t have', () => {
    const goals = closeGoals({ fty: { waits: [{ id: 'wreply', title: 'Reply from FinTech Yatra', done: false, created: 1, doneAt: null }], links: [{ from: 'ttam', to: 'tcall' }, { from: 'wreply', to: 'tcall' }] } });
    const l = layoutTree(treeOf(goals, closeTasks([task('tcall', 'gfty', { title: 'Call them' })])));
    const links = l.edges.filter(e => e.kind === 'link');
    expect(links.map(e => [e.key, e.from, e.to])).toEqual([
      ['gfty/ttam>tcall', 'gfty/ttam', 'gfty/tcall'], ['gfty/wreply>tcall', 'gfty/wreply', 'gfty/tcall'],
    ]);
    // Arrows run left to right, as on FinTech Yatra's own chart; the dashed lines go to the steps nothing comes before.
    expect(l.cards.get('gfty/tcall')!.box.x).toBe(l.cards.get('gfty/ttam')!.box.x + NODE_W + GAP_X);
    expect(l.edges.filter(e => e.from === 'gang/goal:gfty').map(e => e.to).sort()).toEqual(['gfty/ttam', 'gfty/wreply']);
    expectClean(l);
  });

  it('an arrow leaves an open sub-goal from its frame, and a step beside a wide one runs straight past it first', () => {
    // On Close 1Cr itself: the pitch deck goes out after the angels thread, and the term sheet after the deck.
    const top: Plan = { waits: [], links: [{ from: 'goal:gang', to: 'tterm' }, { from: 'tdeck', to: 'tterm' }] };
    const l = layoutTree(treeOf(closeGoals({ top }), closeTasks([task('tdeck', 'g1cr', { title: 'Pitch deck' }), task('tterm', 'g1cr', { title: 'Term sheet' })])));
    const ang = l.cards.get('goal:gang')!, frame = l.frames.find(f => f.key === 'goal:gang')!.box;
    const out = l.edges.find(e => e.key === 'goal:gang>tterm')!;
    expect(out.start).toEqual({ x: frame.x + frame.w, y: ang.box.y + NODE_H / 2 });
    const deck = l.edges.find(e => e.key === 'tdeck>tterm')!;
    const deckCard = l.cards.get('tdeck')!;
    // The deck is narrower than its column: straight to the column's edge, then the curve.
    expect(deck.segs[0]).toEqual({ to: { x: deckCard.exit, y: deck.start.y } });
    expect(deckCard.exit).toBeGreaterThan(deckCard.box.x + NODE_W);
    expectClean(l);
  });

  it('stacks twenty people under one thread without overlap, growing the canvas', () => {
    const tasks = closeTasks(Array.from({ length: 20 }, (_, i) => (i % 3 ? [task(`tp${i}`, `gp${i}`, { title: `Email person ${i + 1}` })] : [])).flat());
    const l = layoutTree(treeOf(closeGoals({ people: 20 }), tasks));
    const people = [...l.cards.values()].filter(c => c.key.startsWith('gcap/goal:gp'));
    expect(people).toHaveLength(20);
    // In one column, top to bottom.
    expect(new Set(people.map(c => c.box.x)).size).toBe(1);
    expect(l.height).toBeGreaterThan(20 * NODE_H);
    expect([...l.cards.values()].filter(c => c.depth === 2 && c.key.startsWith('gp'))).toHaveLength(13);
    expectClean(l);
  });

  it('keeps steps you moved by hand, and an open sub-goal you moved never covers them', () => {
    const tree = treeOf(closeGoals(), closeTasks([task('tdeck', 'g1cr')]));
    // The deck put right where the capital raisers thread opens out; the founders thread put on top of the deck.
    const plain = layoutTree(tree);
    const people = plain.cards.get('gcap/goal:gutpal')!.box;
    const l = layoutTree(tree, { pos: { tdeck: { x: people.x, y: people.y }, 'goal:gfound': { x: people.x - 20, y: people.y + 10 } } });
    expect(l.cards.get('tdeck')!.box).toMatchObject({ x: people.x, y: people.y });
    const found = l.cards.get('goal:gfound')!;
    expect(found.box.x).toBe(people.x - 20);
    expect(found.box.y).toBeGreaterThan(people.y + 10);
    expect(found.moved).toBe(true);
    expectClean(l);
    // A step being dragged follows the pointer; its chart comes with it.
    const d = layoutTree(tree, { drag: { id: 'goal:gfound', x: 900, y: 40 } });
    expect(d.cards.get('goal:gfound')!.box).toMatchObject({ x: 900, y: 40 });
    expect(d.cards.get('gfound/tfound')!.box.x).toBe(900 + NODE_W + GAP_X);
    // Not off the top of the canvas.
    const t = layoutTree(tree, { pos: { 'goal:gcap': { x: 600, y: 0 } } });
    expect(t.frames.find(f => f.key === 'goal:gcap')!.box.y).toBeGreaterThanOrEqual(FRAME);
  });
});

describe('the checks themselves', () => {
  it('catch a line through a card, and two cards on top of each other', () => {
    const l = layoutTree(treeOf(closeGoals(), closeTasks()));
    const card = l.cards.get('goal:gcap')!.box;
    const through: Edge = { key: 'x', kind: 'link', tree: l.cards.get('goal:gcap')!.tree, depth: 0, from: null, to: 'goal:gang', start: { x: card.x - 10, y: card.y + 10 }, segs: [{ to: { x: card.x + card.w + 10, y: card.y + 10 } }], mid: { x: 0, y: 0 } };
    expect(() => expectClean({ ...l, edges: [...l.edges, through] })).toThrow(/runs through goal:gcap/);
    const cards = new Map(l.cards);
    cards.set('goal:gang', { ...cards.get('goal:gang')!, box: { ...card, x: card.x + 30 } });
    expect(() => expectClean({ ...l, cards })).toThrow(/overlaps/);
  });
});

describe('which sub-goals are closed', () => {
  it('keeps goal ids, once each, and drops junk', () => {
    expect(normalizeCollapsed(['gcap', 'gcap', 7, 'bad id!', 'gang'])).toEqual(['gcap', 'gang']);
    expect(normalizeCollapsed('gcap')).toEqual([]);
    expect(toggleCollapsed(['gcap'], 'gcap')).toEqual([]);
    expect(toggleCollapsed(['gcap'], 'gang')).toEqual(['gcap', 'gang']);
    expect(normalizeCollapsed(Array.from({ length: 500 }, (_, i) => `g${i}`))).toHaveLength(400);
  });
});

describe('exporting the tree', () => {
  const goals = closeGoals({ fty: { waits: [], links: [{ from: 'ttam', to: 'tcall' }] } });
  const tasks = closeTasks([task('tcall', 'gfty', { title: 'Call them' })]);

  it('as data, each sub-goal with its own chart inside it', () => {
    const j = treeJson(treeOf(goals, tasks));
    const ang = j.steps.find(s => s.id === 'goal:gang')!;
    expect(ang).toMatchObject({ kind: 'goal', title: 'Reach out to 20 angels and VCs' });
    const fty = ang.flow!.steps.find(s => s.id === 'goal:gfty')!;
    expect(fty.flow!.steps.map(s => s.id).sort()).toEqual(['tcall', 'ttam']);
    expect(fty.flow!.arrows).toEqual([{ from: 'ttam', to: 'tcall' }]);
    expect(fty.flow!.steps.find(s => s.id === 'tcall')).toMatchObject({ state: 'blocked', needs: ['ttam'] });
    expect(j.steps.find(s => s.id === 'goal:gcap')!.flow!.steps.find(s => s.id === 'goal:gutpal')).toMatchObject({ flow: { steps: [], arrows: [] } });
  });

  it('as Mermaid: a subgraph per sub-goal with steps, and the one-level chart when there are none', () => {
    const one = treeOf(goals, tasks, 1);
    expect(toMermaidTree(one)).toBe(toMermaid(goals[0], one.flow));
    const m = toMermaidTree(treeOf(goals, tasks));
    expect(m.split('\n')[0]).toBe('flowchart LR');
    expect(m).toContain('subgraph sg_gcap [" "]');
    expect(m).toContain('subgraph sg_gfty [" "]');
    expect(m).not.toContain('sg_gutpal');
    expect(m).toContain('n_gcap__goal_gutpal[["Utpal"]]');
    expect(m).toContain('  goal --> n_goal_gang');
    expect(m).toContain('  n_goal_gang --> n_gang__goal_gfty');
    expect(m).toContain('  n_gang__goal_gfty --> n_gfty__ttam');
    expect(m).toContain('  n_gfty__ttam --> n_gfty__tcall');
    // Every subgraph is closed, and the edges come after them all.
    expect(m.match(/subgraph /g)!.length).toBe(m.match(/^\s*end$/gm)!.length);
    const lines = m.split('\n');
    expect(lines.findIndex(x => x.includes('-->'))).toBeGreaterThan(lines.map(x => x.trim()).lastIndexOf('end'));
  });
});
