import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import { normalizeGoals, type Goal } from './goals';
import type { Repeat } from './repeat';
import {
  liftStep, placeStep,
  RECENT_DONE, blockedTasks, buildFlow, coalesce, describeEntry, goalNode, holdups, krNode, repeatNode, logFromWrites, normalizeLog, normalizePlan, parallelLinks, toJson,
  toMermaid, withLink, withPos, withWait, withoutLink, withoutPos, withoutStep, wouldLoop, type Plan,
} from './flow';

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
const NOW = at(18, 12);
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, raw: '', notes: '', priority: 2, minutes: 60, start: null, due: null, status: 'open', created: 1, order: 1, doneAt: null, goal: 'g1', ...extra,
});
const goal = (plan: Plan, extra: Partial<Goal> = {}): Goal => ({
  id: 'g1', title: 'Give Sam an exit', section: null, by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1,
  results: [{ id: 'k1', text: 'Shares transferred', done: false }], plan, ...extra,
});

/*
 *            ┌─ price ──┐
 *   goal ────┤          ├─ spa ── sign ── ◆ Shares transferred
 *            └─ lawyer ─┘          ▲
 *                     waiting: buyer's funds
 */
const plan: Plan = {
  waits: [{ id: 'wfunds', title: 'Buyer’s funds', done: false, created: 1, doneAt: null }],
  links: [
    { from: 'price', to: 'spa' }, { from: 'lawyer', to: 'spa' }, { from: 'spa', to: 'sign' }, { from: 'wfunds', to: 'sign' },
    { from: 'sign', to: krNode({ id: 'k1' }) },
  ],
};
const tasks = [
  task('price', { status: 'done', doneAt: at(17, 10), minutes: 30 }),
  task('lawyer', { minutes: 45 }),
  task('spa', { minutes: 120 }),
  task('sign', { minutes: 30 }),
  task('other', { goal: 'g2' }),
];

describe('normalizePlan', () => {
  it('keeps good arrows and waits, and drops duplicates, self-arrows and loops', () => {
    const p = normalizePlan({
      waits: [{ id: 'w1', title: '  Reply   from Sam ', done: true, doneAt: 5 }, { id: 'bad', title: 'x' }, { id: 'w1', title: 'dupe' }],
      links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'b', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'kr:k1', to: 'a' }, 'junk'],
    });
    expect(p.waits).toEqual([{ id: 'w1', title: 'Reply from Sam', done: true, created: 0, doneAt: 5 }]);
    expect(p.links).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'kr:k1', to: 'a' }]);
    expect(normalizePlan(null)).toEqual({ links: [], waits: [] });
  });

  it('rides along on a goal, and an empty one is left off', () => {
    const [a, b] = normalizeGoals([{ id: 'g1', title: 'A', plan: { links: [{ from: 'x', to: 'y' }] } }, { id: 'g2', title: 'B', plan: { links: [] } }]);
    expect(a.plan).toEqual({ links: [{ from: 'x', to: 'y' }], waits: [] });
    expect(b).not.toHaveProperty('plan');
  });

  it('knows a loop when it sees one', () => {
    const links = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    expect(wouldLoop(links, 'c', 'a')).toBe(true);
    expect(wouldLoop(links, 'a', 'c')).toBe(false);
    expect(wouldLoop(links, 'a', 'a')).toBe(true);
  });
});

describe('moving a step', () => {
  // a -> x -> b, and a -> c
  const p: Plan = { waits: [], links: [{ from: 'a', to: 'x' }, { from: 'x', to: 'b' }, { from: 'a', to: 'c' }], pos: { x: { x: 10, y: 20 } } };

  it('lifts it out, joining what came before it to what came after, so the route stays whole', () => {
    const q = liftStep(p, 'x');
    expect(q.links).toEqual([{ from: 'a', to: 'c' }, { from: 'a', to: 'b' }]);
    expect(q.pos).toBeUndefined();
    // A waiting step keeps its record, to be put back elsewhere.
    const w = { waits: [{ id: 'wr', title: 'Reply', done: false, created: 1, doneAt: null }], links: [{ from: 'wr', to: 'b' }] };
    expect(liftStep(w, 'wr')).toEqual({ waits: w.waits, links: [] });
  });

  it('puts it between the ends of an arrow, after a step, before one or alongside one', () => {
    const q = liftStep(p, 'x');
    expect(placeStep(q, 'x', { between: { from: 'a', to: 'c' } }).links).toEqual([{ from: 'a', to: 'b' }, { from: 'a', to: 'x' }, { from: 'x', to: 'c' }]);
    expect(placeStep(q, 'x', { after: 'c' }).links).toContainEqual({ from: 'c', to: 'x' });
    expect(placeStep(q, 'x', { before: 'a' }).links).toContainEqual({ from: 'x', to: 'a' });
    expect(placeStep(q, 'x', { beside: 'c' }).links).toContainEqual({ from: 'a', to: 'x' });
    expect(placeStep(q, 'x', {})).toBe(q);
  });

  it('never closes a loop', () => {
    // b comes after a; putting a after b is refused.
    expect(placeStep({ waits: [], links: [{ from: 'a', to: 'b' }] }, 'a', { after: 'b' }).links).toEqual([{ from: 'a', to: 'b' }]);
  });
});

describe('buildFlow', () => {
  const f = buildFlow(goal(plan), tasks, NOW);
  const s = (id: string) => f.byId.get(id)!;

  it('puts every task on the goal, its waits and its key results on the chart, and only those', () => {
    expect(f.steps.map(x => x.id).sort()).toEqual(['kr:k1', 'lawyer', 'price', 'sign', 'spa', 'wfunds']);
    expect(s('kr:k1')).toMatchObject({ kind: 'milestone', title: 'Shares transferred' });
    expect(s('wfunds')).toMatchObject({ kind: 'wait', title: 'Buyer’s funds' });
  });

  it('says what each step is waiting for', () => {
    expect(s('price').state).toBe('done');
    expect(s('lawyer').state).toBe('ready');
    expect(s('wfunds').state).toBe('ready');
    expect(s('spa')).toMatchObject({ state: 'blocked', needs: ['price', 'lawyer'] });
    expect(s('sign').state).toBe('blocked');
    expect(s('kr:k1').state).toBe('open');
    expect(f.counts).toEqual({ steps: 5, done: 1, ready: 2, blocked: 2 });
  });

  it('lays steps out in columns by what comes before them, the goal leading to the ones nothing comes before', () => {
    // The buyer's funds hold up signing, so they wait right before it rather than back at the start.
    expect([s('price').col, s('lawyer').col, s('wfunds').col, s('spa').col, s('sign').col, s('kr:k1').col]).toEqual([1, 1, 2, 2, 3, 4]);
    expect(f.roots.sort()).toEqual(['lawyer', 'price', 'wfunds']);
    expect(f.cols).toBe(4);
    // Two in a column are on different rows.
    expect(s('price').row).not.toBe(s('lawyer').row);
    expect(s('wfunds').row).not.toBe(s('spa').row);
  });

  it('knows the steps nothing comes after, and with `finish` gives each a lane on to the goal', () => {
    expect(f.ends).toEqual(['kr:k1']);
    expect(f.lanes.size).toBe(0);
    // A step nothing comes after, in the first column: lanes across the three after it.
    const loose = buildFlow(goal(plan), [...tasks, task('call', {})], NOW, { finish: true });
    expect(loose.ends.sort()).toEqual(['call', 'kr:k1']);
    expect(loose.lanes.get('call>@goal')?.map(l => l.col)).toEqual([2, 3, 4]);
    // The last column needs none, and the steps' own arrows are as they were.
    expect(loose.lanes.has('kr:k1>@goal')).toBe(false);
    expect(loose.byId.get('call')?.unblocks).toEqual([]);
    expect(buildFlow(goal(plan), [...tasks, task('call', {})], NOW).lanes.size).toBe(0);
  });

  it('finds the critical path: the chain with the most work left', () => {
    expect(f.critical.steps).toEqual(['lawyer', 'spa', 'sign']);
    expect(f.critical.minutes).toBe(45 + 120 + 30);
    expect([...f.critical.links]).toEqual(['lawyer>spa', 'spa>sign']);
    expect(s('spa').critical).toBe(true);
    expect(s('price').critical).toBe(false);
  });

  it('a milestone is reached once everything before it is done', () => {
    const done = tasks.map(t => ({ ...t, status: 'done' as const, doneAt: at(18, 9) }));
    const g = goal({ ...plan, waits: [{ ...plan.waits[0], done: true, doneAt: 1 }] });
    const f2 = buildFlow(g, done, NOW);
    expect(f2.byId.get('kr:k1')?.state).toBe('reached');
    expect(f2.critical.steps).toEqual([]);
    expect(buildFlow({ ...g, results: [{ id: 'k1', text: 'Shares transferred', done: true }] }, done, NOW).byId.get('kr:k1')?.state).toBe('done');
  });

  it('keeps old finished tasks off the chart unless they are tied in, or you ask for all', () => {
    const old = task('old', { status: 'done', doneAt: NOW - RECENT_DONE - 1 });
    expect(buildFlow(goal(plan), [...tasks, old], NOW)).toMatchObject({ older: 1 });
    expect(buildFlow(goal(plan), [...tasks, old], NOW, { all: true }).byId.has('old')).toBe(true);
    const tied = { ...plan, links: [...plan.links, { from: 'old', to: 'spa' }] };
    expect(buildFlow(goal(tied), [...tasks, old], NOW).byId.has('old')).toBe(true);
  });

  it('ignores arrows to steps that are gone, and counts a meeting as done once it is over', () => {
    const g = goal({ ...plan, links: [...plan.links, { from: 'deleted', to: 'spa' }, { from: 'kr:gone', to: 'sign' }] });
    expect(buildFlow(g, tasks, NOW).links).toHaveLength(plan.links.length);
    const meet = task('meet', { externalId: 'gcal:me:1', start: at(18, 9), minutes: 60 });
    expect(buildFlow(goal(plan), [meet], NOW).byId.get('meet')?.done).toBe(true);
  });
});

describe('blockedTasks', () => {
  it('lists open tasks held up by something before them, on active goals only', () => {
    expect([...blockedTasks([goal(plan)], tasks, NOW)].sort()).toEqual(['sign', 'spa']);
    expect(blockedTasks([goal(plan, { status: 'achieved' })], tasks, NOW).size).toBe(0);
    // Once the lawyer's done, the SPA is free; the signing still waits for the SPA and the funds.
    const after = tasks.map(t => (t.id === 'lawyer' ? { ...t, status: 'done' as const } : t));
    expect([...blockedTasks([goal(plan)], after, NOW)]).toEqual(['sign']);
    // A task that left the goal no longer blocks or is blocked through it.
    const moved = tasks.map(t => (t.id === 'lawyer' ? { ...t, goal: 'g2' } : t));
    expect([...blockedTasks([goal(plan)], moved, NOW)]).toEqual(['sign']);
  });
});

describe('changing a plan', () => {
  it('adds and removes arrows and waits, never closing a loop', () => {
    let p = withLink(plan, { from: 'sign', to: 'price' });
    expect(p).toBe(plan);
    p = withLink(plan, { from: 'price', to: 'sign' });
    expect(p.links).toContainEqual({ from: 'price', to: 'sign' });
    expect(withoutLink(p, { from: 'price', to: 'sign' }).links).toEqual(plan.links);
    p = withWait(plan, { id: 'wsig', title: 'Sam’s signature', done: false, created: 2, doneAt: null });
    expect(p.waits.map(w => w.id)).toEqual(['wfunds', 'wsig']);
    p = withoutStep(p, 'wfunds');
    expect(p.waits.map(w => w.id)).toEqual(['wsig']);
    expect(p.links.some(l => l.from === 'wfunds')).toBe(false);
  });

  it('a parallel step shares what comes before and after', () => {
    expect(parallelLinks(plan, 'lawyer', 'tax')).toEqual([{ from: 'tax', to: 'spa' }]);
    expect(parallelLinks(plan, 'spa', 'escrow')).toEqual([{ from: 'price', to: 'escrow' }, { from: 'lawyer', to: 'escrow' }, { from: 'escrow', to: 'sign' }]);
  });
});

describe('export', () => {
  const g = goal(plan);
  const f = buildFlow(g, tasks, NOW);

  it('writes a Mermaid flowchart, left to right', () => {
    const m = toMermaid(g, f);
    expect(m.split('\n')[0]).toBe('flowchart LR');
    expect(m).toContain('goal(["Give Sam an exit"])');
    expect(m).toContain('n_kr_k1{"Shares transferred"}');
    expect(m).toContain('n_wfunds>"Waiting on: Buyer’s funds"]');
    expect(m).toContain('n_price["price"]:::done');
    expect(m).toContain('n_spa["spa"]:::blocked');
    expect(m).toContain('goal --> n_lawyer');
    expect(m).toContain('n_spa --> n_sign');
  });

  it('and plain data', () => {
    const j = toJson(g, f);
    expect(j.goal).toMatchObject({ id: 'g1', title: 'Give Sam an exit' });
    expect(j.steps.find(x => x.id === 'spa')).toEqual({ id: 'spa', kind: 'task', title: 'spa', state: 'blocked', minutes: 120, needs: ['price', 'lawyer'], critical: true });
    expect(j.arrows).toEqual(plan.links);
    expect(j.critical_path).toEqual(['lawyer', 'spa', 'sign']);
  });
});

describe('the log', () => {
  it('turns task writes into chart history', () => {
    const t = task('spa', { title: 'Draft the SPA' });
    const entries = logFromWrites([
      { before: null, after: t },
      { before: t, after: { ...t, status: 'done', title: 'Draft and send the SPA' } },
      { before: t, after: { ...t, goal: 'g2' } },
      { before: t, after: null },
      { before: task('x', { goal: null }), after: task('x', { goal: null, status: 'done' }) },
    ], NOW);
    expect(entries.map(e => [e.goal, e.op, e.title])).toEqual([
      ['g1', 'add', 'Draft the SPA'],
      ['g1', 'done', 'Draft and send the SPA'], ['g1', 'rename', 'Draft and send the SPA'],
      ['g1', 'remove', 'Draft the SPA'], ['g2', 'add', 'Draft the SPA'],
      ['g1', 'remove', 'Draft the SPA'],
    ]);
    expect(entries[2].was).toBe('Draft the SPA');
  });

  it('a step named right after it was added reads as added under that name', () => {
    const add = { at: 1000, goal: 'g1', op: 'add' as const, step: 't9', title: 'New step' };
    const rename = { at: 9000, goal: 'g1', op: 'rename' as const, step: 't9', title: 'Sign the transfer', was: 'New step' };
    expect(coalesce([add, rename])).toEqual([{ ...add, title: 'Sign the transfer' }]);
    // Much later, or after something else happened to it, a rename is a rename.
    expect(coalesce([add, { ...rename, at: 1000 + 6 * 60000 }])).toHaveLength(2);
    const done = { at: 2000, goal: 'g1', op: 'done' as const, step: 't9', title: 'New step' };
    expect(coalesce([add, done, rename])).toHaveLength(3);
    // A waiting step too.
    expect(coalesce([{ at: 1, goal: 'g1', op: 'wait', step: 'w1', title: 'Someone or something' }, { at: 2, goal: 'g1', op: 'rename', step: 'w1', title: 'Buyer’s funds' }]))
      .toEqual([{ at: 1, goal: 'g1', op: 'wait', step: 'w1', title: 'Buyer’s funds' }]);
  });

  it('says each entry in words, and cleans up what it reads back', () => {
    expect(describeEntry({ at: 1, goal: 'g1', op: 'link', title: 'Draft the SPA', fromTitle: 'Agree the price' })).toBe('“Agree the price” now comes before “Draft the SPA”');
    expect(describeEntry({ at: 1, goal: 'g1', op: 'wait', title: 'Buyer’s funds' })).toBe('Waiting on “Buyer’s funds”');
    expect(normalizeLog([{ at: 1, goal: 'g1', op: 'done', title: 'x', junk: 1 }, { at: 'x', goal: 'g1', op: 'done' }, { at: 2, goal: 'g1', op: 'explode' }]))
      .toEqual([{ at: 1, goal: 'g1', op: 'done', title: 'x' }]);
  });
});

describe('sub-goals and key results under key results', () => {
  // The exit's key result has two under it; a sub-goal serves one of those, another serves the goal as a whole.
  const exit = goal({ waits: [], links: [{ from: 'call', to: 'goal:gboard' }] }, {
    results: [
      { id: 'k1', text: 'Shares transferred', done: false, results: [
        { id: 'k1a', text: 'SPA agreed', done: true },
        { id: 'k1b', text: 'Board approves', done: false },
      ] },
    ],
  });
  const board = { ...goal({ waits: [], links: [] }, { results: [] }), id: 'gboard', title: 'Get the board on side', parent: 'g1', parentKr: 'k1b' };
  const room = { ...goal({ waits: [], links: [] }, { results: [] }), id: 'groom', title: 'Book the room', parent: 'gboard' };
  const press = { ...goal({ waits: [], links: [] }, { results: [] }), id: 'gpress', title: 'Press release', parent: 'g1' };
  const gone = { ...goal({ waits: [], links: [] }, { results: [] }), id: 'ggone', title: 'Dropped one', parent: 'g1', status: 'dropped' as const };
  const goals = [exit, board, room, press, gone];
  const ts = [
    task('call', { minutes: 30 }),
    task('pack', { goal: 'gboard', minutes: 45 }),
    task('chairs', { goal: 'groom', minutes: 15 }),
    task('old', { goal: 'groom', status: 'done', doneAt: at(17, 9) }),
  ];
  const f = buildFlow(exit, ts, NOW, { goals });

  it('puts each sub-goal on the chart as one step, as long as the open work on it and under it', () => {
    const sub = f.byId.get(goalNode(board));
    expect(sub).toMatchObject({ kind: 'goal', title: 'Get the board on side', minutes: 60, state: 'blocked' });
    expect(sub?.needs).toEqual(['call']);
    expect(f.byId.get('goal:gpress')).toMatchObject({ kind: 'goal', minutes: 0, state: 'ready' });
    expect(f.byId.has('goal:ggone')).toBe(false);
    // Only the goal's own sub-goals: one further down is inside its parent's step.
    expect(f.byId.has('goal:groom')).toBe(false);
  });

  it('draws the structure: a key result leads to the one above it, a sub-goal to the key result it serves', () => {
    expect(f.links.filter(l => l.auto).map(l => `${l.from}>${l.to}`).sort()).toEqual(['goal:gboard>kr:k1b', 'kr:k1a>kr:k1', 'kr:k1b>kr:k1']);
    expect(f.byId.get('kr:k1a')).toMatchObject({ kind: 'milestone', depth: 1, state: 'done' });
    expect(f.byId.get('kr:k1')).toMatchObject({ depth: 0, state: 'open' });
    // Left to right: the call, the board, its key result, the one above.
    const col = (id: string) => f.byId.get(id)?.col;
    expect([col('call'), col('goal:gboard'), col('kr:k1b'), col('kr:k1')]).toEqual([1, 2, 3, 4]);
  });

  it('a task after a sub-goal waits until it is achieved; a dropped one holds nothing up', () => {
    const after = { ...exit, plan: { waits: [], links: [{ from: 'goal:gboard', to: 'call' }, { from: 'goal:ggone', to: 'sign' }] } };
    const list = [after, board, room, press, gone];
    const more = [...ts, task('sign')];
    expect([...blockedTasks(list, more, NOW)]).toEqual(['call']);
    expect([...blockedTasks(list.map(g => (g.id === 'gboard' ? { ...g, status: 'achieved' as const } : g)), more, NOW)]).toEqual([]);
  });

  it('exports sub-goals as predefined processes and structure as dotted arrows', () => {
    const m = toMermaid(exit, f);
    expect(m).toMatch(/goal_gboard\[\["Get the board on side/);
    expect(m).toContain("n_goal_gboard -.-> n_kr_k1b");
    const j = toJson(exit, f);
    expect(j.steps.find(s => s.id === 'goal:gboard')).toMatchObject({ kind: 'goal', minutes: 60 });
    expect(j.arrows).toContainEqual({ from: 'kr:k1a', to: 'kr:k1', structure: true });
    expect(j.arrows).toContainEqual({ from: 'call', to: 'goal:gboard' });
  });
});

describe('steps moved by hand', () => {
  it('keeps where you put a step, in whole pixels on the chart, and drops junk', () => {
    const p = normalizePlan({ links: [], waits: [], pos: { a: { x: 10.6, y: 20.2 }, b: { x: -5, y: 1e9 }, 'bad id!': { x: 1, y: 1 }, c: { x: 'no', y: 2 }, d: null } });
    expect(p.pos).toEqual({ a: { x: 11, y: 20 }, b: { x: 0, y: 20000 } });
    expect(normalizePlan({ links: [], waits: [], pos: [1, 2] }).pos).toBeUndefined();
    // A plan with only positions is still kept on its goal.
    expect(normalizeGoals([{ id: 'g1', title: 'G', plan: { pos: { a: { x: 1, y: 2 } } } }])[0].plan).toEqual({ links: [], waits: [], pos: { a: { x: 1, y: 2 } } });
  });

  it('moves a step, lets it go back to the layout, and forgets it when it goes', () => {
    let p = withPos(plan, 'spa', { x: 400, y: 120 });
    expect(p.pos).toEqual({ spa: { x: 400, y: 120 } });
    p = withPos(p, 'sign', { x: 600.4, y: 120 });
    expect(withPos(p, 'spa', null).pos).toEqual({ sign: { x: 600, y: 120 } });
    expect(withoutStep(p, 'spa').pos).toEqual({ sign: { x: 600, y: 120 } });
    expect(withoutStep(p, 'spa').links.some(l => l.from === 'spa' || l.to === 'spa')).toBe(false);
    expect(withoutPos(p).pos).toBeUndefined();
    expect('pos' in withPos(withPos(plan, 'spa', { x: 1, y: 1 }), 'spa', null)).toBe(false);
    // Other changes keep the positions.
    expect(withLink(p, { from: 'lawyer', to: 'sign' }).pos).toEqual(p.pos);
  });
});

describe('holdups', () => {
  it('lists what is blocked and the open steps right before it that hold it up', () => {
    const f = buildFlow(goal(plan), tasks, NOW);
    const h = holdups(f);
    // The SPA waits on the lawyer; signing waits on the SPA (itself blocked) and on the funds.
    expect(h.blocked.map(s => s.id).sort()).toEqual(['sign', 'spa']);
    expect(h.by.map(s => s.id).sort()).toEqual(['lawyer', 'wfunds']);
    expect(holdups(buildFlow(goal({ links: [], waits: [] }), tasks, NOW))).toEqual({ blocked: [], by: [] });
  });
});

describe('repeating tasks', () => {
  // Run three times a week, 4 times in all, then the race.
  const runs: Repeat = {
    id: 'rrun', title: 'Run 5 km', notes: '', priority: 2, minutes: 45, label: null, goal: 'g1', time: null, from: '2026-11-09', made: '2026-11-18',
    rule: { freq: 'week', every: 1, days: [1, 3, 5], monthDay: null, times: 4 }, raw: '', created: 1, updatedAt: 1,
  };
  const occ = (day: string, extra: Partial<Task> = {}) => task(`rrun.${day}`, { title: 'Run 5 km', minutes: 45, ...extra });
  const g = goal({ waits: [], links: [{ from: repeatNode(runs), to: 'race' }] }, { results: [] });
  const ts = [occ('2026-11-09', { status: 'done', doneAt: at(9, 8) }), occ('2026-11-11', { status: 'done', doneAt: at(11, 8) }), occ('2026-11-18'), task('race')];

  it('draws the whole series as one step, with how many are done', () => {
    const f = buildFlow(g, ts, NOW, { repeats: [runs] });
    expect(f.steps.filter(s => s.id.startsWith('rrun.'))).toEqual([]);
    const s = f.byId.get('rep:rrun');
    expect(s).toMatchObject({ kind: 'task', title: 'Run 5 km', state: 'ready', done: false, minutes: 90 });
    expect(s?.repeat).toMatchObject({ id: 'rrun', done: 2, times: 4, rule: 'Every Mon, Wed and Fri, 4 times' });
    expect(s?.task?.id).toBe('rrun.2026-11-18');
    expect(f.byId.get('race')).toMatchObject({ state: 'blocked', needs: ['rep:rrun'] });
    expect(toJson(g, f).steps.find(x => x.id === 'rep:rrun')).toMatchObject({ repeats: 'Every Mon, Wed and Fri, 4 times', times_done: 2 });
  });

  it('holds up what comes after it until it’s been done enough times', () => {
    expect([...blockedTasks([g], ts, NOW, [runs])]).toEqual(['race']);
    const four = [...ts.slice(0, 2), occ('2026-11-13', { status: 'done', doneAt: at(13, 8) }), occ('2026-11-16', { status: 'done', doneAt: at(16, 8) }), task('race')];
    expect([...blockedTasks([g], four, NOW, [runs])]).toEqual([]);
    expect(buildFlow(g, four, NOW, { repeats: [runs] }).byId.get('rep:rrun')).toMatchObject({ done: true, state: 'done' });
    // Without the repeats, each one is a step of its own, as before.
    expect(buildFlow(g, ts, NOW).byId.has('rrun.2026-11-18')).toBe(true);
  });

  it('a repeat on the goal with none open yet says when the next one comes', () => {
    const s = buildFlow(g, [task('race')], NOW, { repeats: [runs] }).byId.get('rep:rrun');
    expect(s?.task).toBeUndefined();
    expect(s?.repeat?.next).toBe('2026-11-20');
  });
});

describe('a number of times a week on a goal', () => {
  const sup: Repeat = {
    id: 'rsup', title: 'Check support tickets', notes: '', priority: 2, minutes: 30, label: null, goal: 'g1', time: null, from: '2026-11-09', made: '2026-11-18',
    rule: { freq: 'week', every: 1, days: [], monthDay: null, per: 4 }, raw: '', created: 1, updatedAt: 1,
  };
  it('the step says how many are done this week, and never finishes', () => {
    // This week runs Mon 16 to Sun 22 Nov; one done last week, two this week, one open.
    const ts = [task('rsup.2026-11-12', { status: 'done', doneAt: 1 }), task('rsup.2026-11-16', { status: 'done', doneAt: 1 }), task('rsup.2026-11-17', { status: 'done', doneAt: 1 }), task('rsup.2026-11-18')];
    const s = buildFlow(goal({ waits: [], links: [] }, { results: [] }), ts, NOW, { repeats: [sup] }).byId.get('rep:rsup');
    expect(s?.repeat).toMatchObject({ rule: '4 times a week', done: 3, week: { done: 2, per: 4 } });
    expect(s).toMatchObject({ done: false, state: 'ready' });
  });
});
