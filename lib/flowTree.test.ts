import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import { normalizeGoals, type Goal } from './goals';
import { buildFlow, toMermaid, type Plan } from './flow';
import {
  COL1_X, FRAME, GAP_X, HEAD, NODE_H, NODE_W, RING, ROW_H, buildTree, layoutTree, normalizeCollapsed, pathD, toMermaidTree, toggleCollapsed, treeJson,
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
 * Close the round
 * ├─ Reach out to 20 capital raisers
 * │   ├─ Raiser A, Raiser B, Raiser C (no tasks yet)
 * │   └─ Find the rest of the 20 capital raisers
 * ├─ Reach out to 20 angels
 * │   ├─ Fund North
 * │   │   └─ Send the market memo to Fund North
 * │   └─ Find the rest of the 20 angels
 * └─ Ask founders for advice
 *     └─ List founders to ask
 */
const closeGoals = (extra: { fty?: Plan; top?: Plan; people?: number } = {}): Goal[] => normalizeGoals([
  g('ground', 'Close the round', null, extra.top),
  g('gcap', 'Reach out to 20 capital raisers', 'ground'),
  ...(extra.people
    ? Array.from({ length: extra.people }, (_, i) => g(`gp${i}`, `Person ${i + 1}`, 'gcap'))
    : [g('gra', 'Raiser A', 'gcap'), g('grb', 'Raiser B', 'gcap'), g('grc', 'Raiser C', 'gcap')]),
  g('gang', 'Reach out to 20 angels', 'ground'),
  g('gfund', 'Fund North', 'gang', extra.fty),
  g('gfound', 'Ask founders for advice', 'ground'),
]);
const closeTasks = (more: Task[] = []): Task[] => [
  task('tcapid', 'gcap', { title: 'Find the rest of the 20 capital raisers' }),
  task('tmemo', 'gfund', { title: 'Send the market memo to Fund North' }),
  task('tangid', 'gang', { title: 'Find the rest of the 20 angels' }),
  task('tfound', 'gfound', { title: 'List founders to ask' }),
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

/**
 * No two cards overlap, no card sits half in a frame, frames only nest, nothing covers the goal, and no connector
 * crosses a card, or a frame it isn't in or coming out of.
 */
function expectClean(l: TreeLayout) {
  // An open sub-goal's card is its frame.
  const cards = [...l.cards.values()].filter(c => !c.open);
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    if (overlap(cards[i].box, cards[j].box)) throw new Error(`${cards[i].key} overlaps ${cards[j].key}`);
  }
  for (const c of l.cards.values()) if (overlap(c.box, l.goal)) throw new Error(`${c.key} covers the goal`);
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
    const ends = [l.cards.get(e.from)?.box, l.cards.get(e.to)?.box].filter(Boolean) as Box[];
    for (const f of l.frames) {
      if (f.key === e.from || f.key === e.to || ends.some(b => contains(f.box, b))) continue;
      const hit = pts.find(p => inside(p, f.box));
      if (hit) throw new Error(`${e.key} runs through ${f.key} at ${Math.round(hit.x)},${Math.round(hit.y)}`);
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
    expect(cap.flow.steps.map(s => s.id).sort()).toEqual(['goal:gra', 'goal:grb', 'goal:grc', 'tcapid']);
    expect(cap.subs.get('goal:gra')!.flow.steps).toEqual([]);
    expect(t.subs.get('goal:gang')!.subs.get('goal:gfund')!.flow.steps.map(s => s.id)).toEqual(['tmemo']);
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
  it('lays a flat chart out in columns, each centred on the goal’s ring, and the goal at the end as the finish', () => {
    const goals = normalizeGoals([g('g1', 'G', null, { waits: [], links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] })]);
    const l = layoutTree(treeOf(goals, [task('a', 'g1'), task('b', 'g1'), task('c', 'g1')]));
    const box = (k: string) => l.cards.get(k)!.box;
    const midY = (b: Box) => b.y + b.h / 2;
    expect(box('a')).toMatchObject({ x: COL1_X, w: NODE_W, h: NODE_H });
    expect(midY(box('a'))).toBe(l.port.y);
    expect([box('b').x, box('c').x]).toEqual([COL1_X + NODE_W + GAP_X, COL1_X + NODE_W + GAP_X]);
    expect([box('b').y, box('c').y].sort((x, y) => x - y)).toEqual([l.port.y - ROW_H / 2 - NODE_H / 2, l.port.y + ROW_H / 2 - NODE_H / 2]);
    // The goal is past the last column; arrows reach its ring's left edge.
    expect(l.goal.x).toBeGreaterThan(box('b').x + NODE_W + GAP_X);
    expect(l.port.x).toBe(l.goal.x + (l.goal.w - RING) / 2);
    expect(l.frames).toEqual([]);
    // The steps nothing comes after lead on to the goal; nothing leads from it.
    expect(l.edges.map(e => `${e.kind}:${e.key}`).sort()).toEqual(['finish:b>@goal', 'finish:c>@goal', 'link:a>b', 'link:a>c']);
    const fin = l.edges.find(e => e.key === 'b>@goal')!;
    expect(fin.segs[fin.segs.length - 1].to).toEqual({ x: l.port.x - 4, y: l.port.y });
    expect(fin.start).toEqual({ x: box('b').x + NODE_W, y: midY(box('b')) });
    expect(pathD(fin)).toMatch(/^M 576 /);
    expectClean(l);
  });

  it('runs an arrow on to the goal through lanes, past the steps in later columns', () => {
    const goals = normalizeGoals([g('g1', 'G', null, { waits: [], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'd' }] })]);
    const l = layoutTree(treeOf(goals, ['a', 'b', 'c', 'd', 'e'].map(id => task(id, 'g1'))));
    // d and e lead nowhere; e is in the first column, so its line crosses two more.
    expect(l.edges.filter(e => e.kind === 'finish').map(e => e.from).sort()).toEqual(['c', 'd', 'e']);
    expectClean(l);
  });

  it('opens every sub-goal in place: all three layers of Close the round, each to the right of its card', () => {
    const l = layoutTree(treeOf(closeGoals(), closeTasks()));
    expect([...l.cards.keys()].sort()).toEqual([
      'gang/goal:gfund', 'gang/tangid', 'gcap/goal:gra', 'gcap/goal:grb', 'gcap/goal:grc', 'gcap/tcapid',
      'gfound/tfound', 'gfund/tmemo', 'goal:gang', 'goal:gcap', 'goal:gfound',
    ]);
    const c = (k: string) => l.cards.get(k)!;
    for (const card of l.cards.values()) {
      if (!card.depth) continue;
      // Inside its parent's frame, under the header; the first column just inside the frame's edge.
      const parent = [...l.cards.values()].find(p => p.sub === card.tree)!;
      expect(contains(parent.box, card.box)).toBe(true);
      expect(card.box.y).toBeGreaterThanOrEqual(parent.box.y + HEAD);
      if (card.step.col === 1) expect(card.box.x).toBe(parent.box.x + FRAME);
    }
    expect([c('goal:gcap').depth, c('gcap/goal:gra').depth, c('gfund/tmemo').depth]).toEqual([0, 1, 2]);
    // Open, with a frame: the three threads and Fund North. The people with no tasks are plain cards.
    expect(l.frames.map(f => f.key).sort()).toEqual(['gang/goal:gfund', 'goal:gang', 'goal:gcap', 'goal:gfound']);
    expect(c('gcap/goal:gra')).toMatchObject({ open: false, sub: expect.objectContaining({ flow: expect.objectContaining({ steps: [] }) }) });
    // No arrows, the goals have none: each of the three threads leads on to the goal, and nothing inside them does.
    expect(l.edges.map(e => `${e.kind}:${e.from}>${e.to}`).sort()).toEqual(['finish:goal:gang>@goal', 'finish:goal:gcap>@goal', 'finish:goal:gfound>@goal']);
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
    expect(l.edges.some(e => e.from.startsWith('gcap/'))).toBe(false);
    expect(l.frames.some(f => f.key === 'goal:gcap')).toBe(false);
    expect(l.height).toBeLessThan(all.height);
    // Closing one deeper down leaves the rest open.
    const deep = layoutTree(tree, { open: id => id !== 'gfund' });
    expect(deep.cards.has('gfund/tmemo')).toBe(false);
    expect(deep.cards.has('gang/goal:gfund')).toBe(true);
    expectClean(deep);
  });

  it('draws a sub-goal’s arrows inside it as its own chart does, and none it doesn’t have', () => {
    const goals = closeGoals({ fty: { waits: [{ id: 'wreply', title: 'Reply from Fund North', done: false, created: 1, doneAt: null }], links: [{ from: 'tmemo', to: 'tcall' }, { from: 'wreply', to: 'tcall' }] } });
    const l = layoutTree(treeOf(goals, closeTasks([task('tcall', 'gfund', { title: 'Call them' })])));
    const links = l.edges.filter(e => e.kind === 'link');
    expect(links.map(e => [e.key, e.from, e.to])).toEqual([
      ['gfund/tmemo>tcall', 'gfund/tmemo', 'gfund/tcall'], ['gfund/wreply>tcall', 'gfund/wreply', 'gfund/tcall'],
    ]);
    // Arrows run left to right, as on Fund North's own chart, starting just inside its frame.
    expect(l.cards.get('gfund/tcall')!.box.x).toBe(l.cards.get('gfund/tmemo')!.box.x + NODE_W + GAP_X);
    expect(l.cards.get('gfund/tmemo')!.box.x).toBe(l.cards.get('gang/goal:gfund')!.box.x + FRAME);
    expectClean(l);
  });

  it('an arrow leaves an open sub-goal from its frame, and a step beside a wide one runs straight past it first', () => {
    // On Close the round itself: the pitch deck goes out after the angels thread, and the term sheet after the deck.
    const top: Plan = { waits: [], links: [{ from: 'goal:gang', to: 'tterm' }, { from: 'tdeck', to: 'tterm' }] };
    const l = layoutTree(treeOf(closeGoals({ top }), closeTasks([task('tdeck', 'ground', { title: 'Pitch deck' }), task('tterm', 'ground', { title: 'Term sheet' })])));
    const ang = l.cards.get('goal:gang')!, frame = l.frames.find(f => f.key === 'goal:gang')!.box;
    const out = l.edges.find(e => e.key === 'goal:gang>tterm')!;
    expect(out.start).toEqual({ x: frame.x + frame.w, y: frame.y + frame.h / 2 });
    expect(ang.box).toEqual(frame);
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
    const tree = treeOf(closeGoals(), closeTasks([task('tdeck', 'ground')]));
    // The deck put right where the capital raisers thread opens out; the founders thread put on top of the deck.
    const plain = layoutTree(tree);
    const people = plain.cards.get('gcap/goal:gra')!.box;
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
    expect(d.cards.get('gfound/tfound')!.box.x).toBe(900 + FRAME);
    // Not off the top of the canvas.
    const t = layoutTree(tree, { pos: { 'goal:gcap': { x: 600, y: 0 } } });
    expect(t.frames.find(f => f.key === 'goal:gcap')!.box.y).toBeGreaterThanOrEqual(FRAME);
  });
});

describe('the checks themselves', () => {
  it('catch a line through a card or a frame, and two cards on top of each other', () => {
    const l = layoutTree(treeOf(closeGoals(), closeTasks()));
    const frame = l.cards.get('goal:gcap')!.box;
    const line = (b: Box, to: string): Edge => ({ key: 'x', kind: 'link', tree: l.cards.get('goal:gcap')!.tree, depth: 0, from: 'goal:gfound', to, start: { x: b.x - 10, y: b.y + 30 }, segs: [{ to: { x: b.x + b.w + 10, y: b.y + 30 } }], mid: { x: 0, y: 0 } });
    expect(() => expectClean({ ...l, edges: [...l.edges, line(frame, 'goal:gang')] })).toThrow(/runs through/);
    const card = l.cards.get('gcap/goal:gra')!.box;
    expect(() => expectClean({ ...l, edges: [...l.edges, line(card, 'goal:gang')] })).toThrow(/runs through gcap\/goal:gra/);
    const cards = new Map(l.cards);
    cards.set('gcap/goal:grb', { ...cards.get('gcap/goal:grb')!, box: { ...card, x: card.x + 30 } });
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
  const goals = closeGoals({ fty: { waits: [], links: [{ from: 'tmemo', to: 'tcall' }] } });
  const tasks = closeTasks([task('tcall', 'gfund', { title: 'Call them' })]);

  it('as data, each sub-goal with its own chart inside it', () => {
    const j = treeJson(treeOf(goals, tasks));
    const ang = j.steps.find(s => s.id === 'goal:gang')!;
    expect(ang).toMatchObject({ kind: 'goal', title: 'Reach out to 20 angels' });
    const fty = ang.flow!.steps.find(s => s.id === 'goal:gfund')!;
    expect(fty.flow!.steps.map(s => s.id).sort()).toEqual(['tcall', 'tmemo']);
    expect(fty.flow!.arrows).toEqual([{ from: 'tmemo', to: 'tcall' }]);
    expect(fty.flow!.steps.find(s => s.id === 'tcall')).toMatchObject({ state: 'blocked', needs: ['tmemo'] });
    expect(j.steps.find(s => s.id === 'goal:gcap')!.flow!.steps.find(s => s.id === 'goal:gra')).toMatchObject({ flow: { steps: [], arrows: [] } });
  });

  it('as Mermaid: a subgraph per sub-goal with steps, and the one-level chart when there are none', () => {
    const one = treeOf(goals, tasks, 1);
    expect(toMermaidTree(one)).toBe(toMermaid(goals[0], one.flow));
    const m = toMermaidTree(treeOf(goals, tasks));
    expect(m.split('\n')[0]).toBe('flowchart LR');
    expect(m).toContain('subgraph sg_gcap [" "]');
    expect(m).toContain('subgraph sg_gfund [" "]');
    expect(m).not.toContain('sg_gra');
    expect(m).toContain('n_gcap__goal_gra[["Raiser A"]]');
    expect(m).toContain('  goal --> n_goal_gang');
    expect(m).toContain('  n_goal_gang --> n_gang__goal_gfund');
    expect(m).toContain('  n_gang__goal_gfund --> n_gfund__tmemo');
    expect(m).toContain('  n_gfund__tmemo --> n_gfund__tcall');
    // Every subgraph is closed, and the edges come after them all.
    expect(m.match(/subgraph /g)!.length).toBe(m.match(/^\s*end$/gm)!.length);
    const lines = m.split('\n');
    expect(lines.findIndex(x => x.includes('-->'))).toBeGreaterThan(lines.map(x => x.trim()).lastIndexOf('end'));
  });
});
