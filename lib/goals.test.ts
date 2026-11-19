import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import {
  MAX_ACTIVE, MAX_GOAL_DEPTH, MAX_RESULTS, activeGoalOf, addGoal, addResult, ancestorsOf, cantMoveGoal, cantMoveResult, descendantsOf, findResult,
  flatResults, goalNamed, goalProgress, goalRanker, goalSection, goalTree, heightOf, makeGoal, mergeResults, moveGoal, moveResult, normalizeGoals,
  onGoalShare, openResults, outlineOf, parseOutline, patchGoal, patchResult, pickGoal, rankGoal, removeGoal, reparentGoal, resultDone, resultPath,
  resultsLine, rootOf, setGoalStatus, tallyGoals, topGoals, type Goal,
} from './goals';
import { OFF_GOAL, backlogList, focus } from './select';
import { applyCapture, promptContext } from './capture';
import { localParse } from './parse';
import { buildPrompt } from './prompt';
import { changesOf, commitChanges, draftOf } from './plan';
import { followTask, makeRepeating, occurrence, startRepeat } from './repeat';
import { slipsFrom } from './slips';
import { periodOf, review } from './review';
import type { Label } from './labels';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const NOW = at(18, 14);

let n = 0;
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: 'id' + n++, title, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});
const goal = (id: string, title: string, extra: Partial<Goal> = {}): Goal => ({
  id, title, section: null, results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, ...extra,
});
const LABELS: Label[] = [{ id: 'sj', name: 'Superjoin', color: '#4F5BD5' }, { id: 'personal', name: 'Personal', color: '#D98E04' }];
const EXIT = goal('gexit', 'Give Sam an exit', { section: 'sj', results: [{ id: 'k1', text: 'Share transfer signed', done: false }] });
const RUN = goal('grun', 'Run a half marathon', { section: 'personal' });
const OLD = goal('gold', 'Launch v1', { status: 'achieved', closedAt: 5 });
const GOALS = [EXIT, RUN, OLD];

describe('normalizeGoals', () => {
  it('keeps well-formed goals and cleans up the rest', () => {
    const out = normalizeGoals([
      { id: 'g1', title: '  Close   the round ', section: 'sj', by: '2026-12-01', status: 'active', results: [{ id: 'k1', text: 'Lead signed', done: true }, { text: '' }, { text: 'Money in' }] },
      { id: 'g1', title: 'Duplicate id' },
      { id: 'bad id!', title: 'Bad id' },
      { id: 'g2', title: '' },
      { id: 'g3', title: 'Done one', status: 'achieved', closedAt: 9 },
      'junk',
    ]);
    expect(out.map(g => g.id)).toEqual(['g1', 'g3']);
    expect(out[0]).toMatchObject({ title: 'Close the round', section: 'sj', by: '2026-12-01', status: 'active', closedAt: null });
    expect(out[0].results).toEqual([{ id: 'k1', text: 'Lead signed', done: true }, { id: 'k2', text: 'Money in', done: false }]);
    expect(out[1]).toMatchObject({ status: 'achieved', closedAt: 9 });
    expect(normalizeGoals(null)).toEqual([]);
  });

  it(`keeps at most ${MAX_ACTIVE} active`, () => {
    const many = Array.from({ length: MAX_ACTIVE + 2 }, (_, i) => ({ id: `g${i}`, title: `Goal ${i}` }));
    const out = normalizeGoals(many);
    expect(out.filter(g => g.status === 'active')).toHaveLength(MAX_ACTIVE);
    expect(out.slice(MAX_ACTIVE).every(g => g.status === 'dropped')).toBe(true);
  });
});

describe('finding a goal', () => {
  it('by id, whole title or a key word, among active goals only', () => {
    expect(pickGoal(GOALS, 'gexit')).toBe('gexit');
    expect(pickGoal(GOALS, 'Give Sam an exit')).toBe('gexit');
    expect(goalNamed(GOALS, 'exit')?.id).toBe('gexit');
    expect(goalNamed(GOALS, 'marathon')?.id).toBe('grun');
    // Fillers don't name a goal; achieved ones can't be picked.
    expect(goalNamed(GOALS, 'give')).toBeNull();
    expect(pickGoal(GOALS, 'Launch v1')).toBeNull();
    expect(pickGoal(GOALS, '')).toBeNull();
    expect(pickGoal(GOALS, 42)).toBeNull();
  });

  it('a task on an achieved goal counts as off-goal, and takes its goal’s section', () => {
    const index = new Map(GOALS.map(g => [g.id, g]));
    expect(activeGoalOf({ goal: 'gexit' }, index)?.id).toBe('gexit');
    expect(activeGoalOf({ goal: 'gold' }, index)).toBeNull();
    expect(activeGoalOf({ goal: 'gone' }, index)).toBeNull();
    expect(goalSection({ goal: 'grun' }, index)).toBe('personal');
    expect(goalSection({ goal: null }, index)).toBeNull();
  });
});

describe('the backlog with goals', () => {
  it('puts goal work before off-goal work at the same priority, then deadlines, then your goals’ order', () => {
    const errand = task('Errand', { due: '2026-11-19' });
    const deck = task('Exit deck', { goal: 'gexit' });
    const shoes = task('Buy shoes', { goal: 'grun', due: '2026-11-25' });
    const urgentChore = task('Urgent chore', { priority: 1 });
    const relic = task('Old launch thing', { goal: 'gold' });
    const later = task('Someday', { priority: 3, goal: 'gexit' });
    const rank = goalRanker(GOALS);
    expect(rank(deck)).toBe(0);
    expect(rank(shoes)).toBe(1);
    expect(rank(relic)).toBe(OFF_GOAL);
    expect(backlogList([errand, deck, shoes, urgentChore, relic, later], rank).map(t => t.title))
      .toEqual(['Urgent chore', 'Buy shoes', 'Exit deck', 'Errand', 'Old launch thing', 'Someday']);
    // Without a ranking, as before: priority, then due date.
    expect(backlogList([deck, errand]).map(t => t.title)).toEqual(['Errand', 'Exit deck']);
    expect(focus([errand, deck], NOW, rank).now?.title).toBe('Exit deck');
  });
});

describe('tallyGoals', () => {
  const tasks = [
    task('Done on exit', { goal: 'gexit', status: 'done', start: at(17, 10), minutes: 90, doneAt: at(17, 12) }),
    task('Ticked off, never slotted', { goal: 'gexit', status: 'done', doneAt: at(18, 9), minutes: 30 }),
    task('Planned on exit', { goal: 'gexit', start: at(19, 10), minutes: 60 }),
    task('Off-goal chore', { status: 'done', start: at(18, 8), doneAt: at(18, 9), minutes: 30 }),
    task('Investor call', { goal: 'gexit', externalId: 'gcal:me:1', start: at(18, 11), minutes: 45 }),
    task('Meeting later', { externalId: 'gcal:me:2', start: at(18, 16), minutes: 60 }),
    task('Last week', { goal: 'grun', status: 'done', start: at(9, 7), doneAt: at(9, 8), minutes: 60 }),
  ];
  const week = tallyGoals(tasks, at(16, 0), at(23, 0), NOW);

  it('counts what got done and meetings that are over, and plans what is still to come', () => {
    expect(week.get('gexit')).toEqual({ spent: 90 + 30 + 45, planned: 60, done: 3 });
    expect(week.get('')).toEqual({ spent: 30, planned: 60, done: 1 });
    expect(week.get('grun')).toBeUndefined();
  });

  it('says what share of the time went to goals', () => {
    expect(onGoalShare(week)).toBeCloseTo(165 / 195);
    expect(onGoalShare(new Map())).toBeNull();
  });
});

describe('changing goals', () => {
  it('adds, patches, ranks, achieves, brings back and removes, as pure functions', () => {
    const g = makeGoal({ title: '  Ship v2  ', section: 'sj', results: ['10 accounts live', ' ', 'Churn under 2%'], by: '2027-01-15' }, 7, 'gship');
    expect(g).toMatchObject({ id: 'gship', title: 'Ship v2', status: 'active', created: 7, by: '2027-01-15' });
    expect(g.results.map(r => r.text)).toEqual(['10 accounts live', 'Churn under 2%']);
    expect(resultsLine(g)).toBe('0 of 2');

    let list = addGoal(g)(GOALS);
    expect(list.map(x => x.id)).toEqual(['gexit', 'grun', 'gold', 'gship']);
    expect(addGoal(g)(list)).toBe(list);
    list = moveGoal('gship', -1)(list);
    expect(list.filter(x => x.status === 'active').map(x => x.id)).toEqual(['gexit', 'gship', 'grun']);
    expect(moveGoal('gexit', -1)(list)).toBe(list);
    list = patchGoal('gexit', { title: 'Give Sam a clean exit' }, 9)(list);
    expect(list[0]).toMatchObject({ title: 'Give Sam a clean exit', updatedAt: 9 });
    list = setGoalStatus('gexit', 'achieved', 10)(list);
    expect(list.find(x => x.id === 'gexit')).toMatchObject({ status: 'achieved', closedAt: 10 });
    // Back among the active ones, last.
    list = setGoalStatus('gold', 'active', 11)(list);
    expect(list.filter(x => x.status === 'active').map(x => x.id)).toEqual(['gship', 'grun', 'gold']);
    expect(removeGoal('gold')(list).some(x => x.id === 'gold')).toBe(false);
  });
});

describe('goals through the chat', () => {
  it('tells the model your goals and each task’s goal', () => {
    const t = task('Board deck', { label: 'sj', goal: 'gexit' });
    const { ctx } = promptContext([t], undefined, undefined, x => x.goal ?? null);
    const p = buildPrompt('call the lawyer about escrow', NOW, ctx, undefined, LABELS, undefined, undefined,
      [{ id: 'gexit', title: 'Give Sam an exit', section: 'sj', results: ['Share transfer signed'], by: '2026-12-31' }]);
    expect(p).toContain('- gexit = Give Sam an exit (Superjoin). Done when: Share transfer signed. By 2026-12-31');
    expect(p).toMatch(/T1 \| P2 \| Board deck \| backlog \| - \| sj \| gexit/);
    expect(p).toContain('"goal": the id of the goal this task directly moves forward');
    expect(p).toContain('"goal": "none" takes it off its goal');
    expect(buildPrompt('x', NOW)).toContain('"goal": null,');
  });

  it('puts a new task on the goal the model picked, in its section, and moves tasks on and off goals', () => {
    const chore = task('Chore', { label: 'personal' });
    const deck = task('Deck', { goal: 'gexit', label: 'sj' });
    const { refs } = promptContext([chore, deck]);
    const out = applyCapture({
      text: 'call the lawyer for the exit, and the chore is for the marathon, deck is not for the exit', tasks: [chore, deck], refs,
      result: {
        add: [{ title: 'Call the lawyer', goal: 'gexit', label: 'personal' }, { title: 'Water plants', goal: 'gold' }],
        update: [{ ref: 'T1', goal: 'grun' }, { ref: 'T2', goal: 'none' }],
      },
      via: 'ai', now: NOW, newId: () => 'n' + n++, labels: LABELS, goals: GOALS,
    });
    expect(out.added[0]).toMatchObject({ title: 'Call the lawyer', goal: 'gexit', label: 'sj' });
    // An achieved goal can't take new tasks.
    expect(out.added[1]).toMatchObject({ title: 'Water plants', goal: null });
    expect(out.puts.find(t => t.id === chore.id)).toMatchObject({ goal: 'grun', label: 'personal' });
    expect(out.puts.find(t => t.id === deck.id)).toMatchObject({ goal: null, label: 'sj' });
    expect(out.summary).toBe('2 added: 0 on the calendar, 2 in the backlog, 1 on goals · 2 updated');
  });

  it('says which goal one new task is on', () => {
    const out = applyCapture({ text: 'x', tasks: [], refs: new Map(), result: { add: [{ title: 'Draft the transfer', goal: 'exit' }], update: [] }, via: 'ai', now: NOW, goals: GOALS });
    expect(out.summary).toBe('In the backlog · Give Sam an exit · Important');
  });

  it('the keyword parser takes a #tag naming a goal, after labels', () => {
    const [a, b] = localParse('Draft the transfer #exit\nBuy running shoes #personal #marathon', NOW, LABELS, GOALS);
    expect(a).toMatchObject({ title: 'Draft the transfer', goal: 'gexit', label: null });
    expect(b).toMatchObject({ title: 'Buy running shoes', label: 'personal', goal: 'grun' });
    expect(localParse('Fix #nothing', NOW, LABELS, GOALS)[0]).not.toHaveProperty('goal');
  });

  it('a plan keeps the goal through a draft and onto the task', () => {
    const deck = task('Deck', { goal: 'gexit' });
    const { refs } = promptContext([deck]);
    const out = applyCapture({
      text: 'x', tasks: [deck], refs, via: 'ai', now: NOW, newId: () => 'p' + n++, goals: GOALS,
      result: { add: [{ title: 'Shoes', goal: 'grun' }], update: [{ ref: 'T1', goal: 'none' }] },
    });
    const changes = changesOf(out);
    const draft = draftOf(changes, new Map([[deck.id, 'T1']]));
    expect(draft.add[0]).toMatchObject({ title: 'Shoes', goal: 'grun' });
    expect(draft.update).toEqual([{ ref: 'T1', goal: 'none' }]);
    const done = commitChanges(changes, id => (id === deck.id ? deck : undefined), NOW, LABELS, [], undefined, GOALS);
    expect(done.puts.map(t => [t.title, t.goal])).toEqual([['Shoes', 'grun'], ['Deck', null]]);
    expect(done.summary).toMatch(/^In the backlog · Run a half marathon/);
  });
});

describe('goals on repeats and missed slots', () => {
  it('a repeat keeps its goal for every one it makes, and follows an edit', () => {
    const r = startRepeat({ title: 'Long run', notes: '', priority: 2, minutes: 90, label: 'personal', goal: 'grun', raw: '', rule: { freq: 'week', every: 1, days: [6], monthDay: null }, time: '07:00', from: '2026-11-21' }, NOW, 'rrun');
    expect(occurrence(r, '2026-11-21', NOW).goal).toBe('grun');
    const t = { ...occurrence(r, '2026-11-21', NOW), goal: null };
    expect(followTask(r, t, NOW)?.goal).toBeNull();
    const made = makeRepeating(task('Stretch', { goal: 'grun' }), { freq: 'day', every: 1, days: [], monthDay: null }, null, NOW, 'rstretch');
    expect(made.repeat.goal).toBe('grun');
    expect(occurrence(startRepeat({ ...r, goal: null }, NOW, 'rnone'), '2026-11-21', NOW)).not.toHaveProperty('goal');
  });

  it('a missed slot remembers its goal', () => {
    const b = task('Exit call', { goal: 'gexit', start: at(18, 9) });
    expect(slipsFrom([{ before: b, after: { ...b, start: null } }], NOW)[0]).toMatchObject({ id: b.id, goal: 'gexit' });
  });
});

describe('the review, by goal', () => {
  const tasks = [
    task('Exit work', { goal: 'gexit', status: 'done', start: at(17, 10), doneAt: at(17, 11), minutes: 120 }),
    task('Missed exit call', { goal: 'gexit', start: at(17, 15), minutes: 30 }),
    task('Errand', { status: 'done', start: at(17, 9), doneAt: at(17, 9, 30), minutes: 60 }),
    task('Old launch work', { goal: 'gold', status: 'done', start: at(16, 9), doneAt: at(16, 10), minutes: 60 }),
  ];
  const r = review({ tasks, labels: LABELS, goals: GOALS, now: NOW }, periodOf('week', NOW));

  it('has a row per goal with time, share and misses, then off-goal', () => {
    expect(r.goals.map(g => [g.name, g.minutes, g.outcomes.missed])).toEqual([
      ['Give Sam an exit', 120, 1], ['Run a half marathon', 0, 0], ['Launch v1', 60, 0], ['Off-goal', 60, 0],
    ]);
    expect(r.goals[0]).toMatchObject({ color: '#4F5BD5', status: 'active', share: 0.5 });
    expect(r.byGoal).toEqual({ gexit: 120, gold: 60, '': 60 });
  });

  it('says how much went to goals, and which goal got nothing', () => {
    expect(r.insights).toContain('75% of your time went to your goals.');
    expect(r.insights).toContain('Nothing moved “Run a half marathon” in this stretch.');
  });

  it('has no goal rows without goals', () => {
    expect(review({ tasks, labels: LABELS, now: NOW }, periodOf('week', NOW)).goals).toEqual([]);
  });
});

describe('the goal tree', () => {
  // Exit, with a key result that has two under it, a sub-goal for one of those, and a sub-goal for the goal as a whole.
  const exit = goal('gexit', 'Give Sam an exit', {
    section: 'sj',
    results: [
      { id: 'k1', text: 'Share transfer signed', done: false, results: [
        { id: 'k1a', text: 'Buyer’s lawyer approves the SPA', done: true },
        { id: 'k1b', text: 'Board approves', done: false },
      ] },
      { id: 'k2', text: 'Money in the bank', done: false },
    ],
  });
  const lawyer = goal('glaw', 'Close the board', { parent: 'gexit', parentKr: 'k1b', results: [{ id: 'kb', text: 'Minutes signed', done: false }] });
  const comms = goal('gcomms', 'Tell the team', { parent: 'gexit' });
  const deep = goal('gdeep', 'Book the room', { parent: 'glaw' });
  const TREE = [exit, RUN, lawyer, comms, deep];
  const index = new Map(TREE.map(g => [g.id, g]));

  it('keeps parents that are there, drops ones that loop or are missing, and keeps a key result only when it is the parent’s', () => {
    const list = normalizeGoals([
      ...TREE,
      { id: 'ga', title: 'A', parent: 'gb' }, { id: 'gb', title: 'B', parent: 'ga' },
      { id: 'gself', title: 'Self', parent: 'gself' },
      { id: 'gorphan', title: 'Orphan', parent: 'gnone' },
      { id: 'gbadkr', title: 'Bad key result', parent: 'gexit', parentKr: 'knope' },
    ]);
    const by = new Map(list.map(g => [g.id, g]));
    expect(by.get('glaw')).toMatchObject({ parent: 'gexit', parentKr: 'k1b' });
    expect(by.get('gdeep')?.parent).toBe('glaw');
    // One of a loop stays under the other; the other becomes a top goal.
    expect([by.get('ga')?.parent, by.get('gb')?.parent].filter(Boolean)).toHaveLength(1);
    expect(by.get('gself')?.parent).toBeUndefined();
    expect(by.get('gorphan')?.parent).toBeUndefined();
    expect(by.get('gbadkr')).toMatchObject({ parent: 'gexit' });
    expect(by.get('gbadkr')?.parentKr).toBeUndefined();
    expect(findResult(by.get('gexit')?.results ?? [], 'k1b')?.text).toBe('Board approves');
  });

  it('only counts top goals towards the most at once, and closes a sub-goal left open under a closed goal', () => {
    const many = Array.from({ length: MAX_ACTIVE }, (_, i) => goal(`g${i}`, `Goal ${i}`));
    const subs = Array.from({ length: 4 }, (_, i) => goal(`s${i}`, `Sub ${i}`, { parent: 'g0' }));
    const list = normalizeGoals([...many, ...subs, goal('gdone', 'Done', { status: 'achieved', closedAt: 4 }), goal('gstray', 'Stray', { parent: 'gdone' })]);
    expect(list.filter(g => g.status === 'active')).toHaveLength(MAX_ACTIVE + 4);
    expect(list.find(g => g.id === 'gstray')).toMatchObject({ status: 'achieved', closedAt: 4 });
  });

  it('keeps a sub-goal in its top goal’s section, also when the section changes', () => {
    const list = normalizeGoals([exit, { ...lawyer, section: 'personal' }, { ...deep, section: null }]);
    expect(list.map(g => g.section)).toEqual(['sj', 'sj', 'sj']);
    const moved = patchGoal('gexit', { section: 'personal' }, 5)(list);
    expect(moved.map(g => g.section)).toEqual(['personal', 'personal', 'personal']);
    expect(patchGoal('glaw', { title: 'Close the board, fast' }, 6)(list)[0]).toBe(list[0]);
  });

  it('walks up and down the tree', () => {
    expect(topGoals(TREE).map(g => g.id)).toEqual(['gexit', 'grun']);
    expect(descendantsOf(TREE, 'gexit').map(g => g.id)).toEqual(['glaw', 'gdeep', 'gcomms']);
    expect(ancestorsOf(index, deep).map(g => g.id)).toEqual(['glaw', 'gexit']);
    expect(rootOf(index, deep).id).toBe('gexit');
    expect(rootOf(index, exit).id).toBe('gexit');
    expect(goalTree(TREE).map(x => `${x.depth}:${x.goal.id}`)).toEqual(['0:gexit', '1:glaw', '2:gdeep', '1:gcomms', '0:grun']);
    expect(MAX_GOAL_DEPTH).toBeGreaterThanOrEqual(3);
  });

  it('a task on a sub-goal takes its top goal’s section and rank', () => {
    expect(goalSection({ goal: 'gdeep' }, index)).toBe('sj');
    const rank = goalRanker(TREE);
    expect(rank({ goal: 'gdeep' })).toBe(0);
    expect(rank({ goal: 'grun' })).toBe(1);
    expect(activeGoalOf({ goal: 'glaw' }, index)?.id).toBe('glaw');
  });

  it('works out how far along each goal is, key results counting what is under them and the sub-goals that serve them', () => {
    expect(resultDone(exit.results[0])).toBe(false);
    expect(resultDone({ id: 'x', text: 'x', done: false, results: [{ id: 'y', text: 'y', done: true }] })).toBe(true);
    expect(goalProgress(deep, TREE)).toBeNull();
    expect(goalProgress(lawyer, TREE)).toBe(0);
    // k1: mean of k1a (1) and k1b (mean of its sub-goal, 0) = 0.5; k2: 0; comms (nothing to count): 0. (0.5 + 0 + 0) / 3.
    expect(goalProgress(exit, TREE)).toBeCloseTo(1 / 6);
    const won = TREE.map(g => (g.id === 'glaw' ? { ...g, status: 'achieved' as const } : g));
    // k1b now 1, so k1 = 1: (1 + 0 + 0) / 3.
    expect(goalProgress(exit, won)).toBeCloseTo(1 / 3);
    expect(goalProgress({ ...exit, status: 'achieved' }, TREE)).toBe(1);
  });

  it('lists the open key results with their parents, and paths for one', () => {
    expect(openResults(exit)).toEqual(['Share transfer signed › Board approves', 'Money in the bank']);
    expect(resultPath(exit, 'k1b')).toBe('Share transfer signed › Board approves');
    expect(resultPath(exit, 'knope')).toBe('');
    expect(resultsLine(exit)).toBe('0 of 2');
  });

  it('closing a goal closes what is under it; bringing one back brings back what is above it', () => {
    let list = setGoalStatus('gexit', 'achieved', 20)(TREE);
    expect(list.filter(g => g.status === 'achieved').map(g => g.id).sort()).toEqual(['gcomms', 'gdeep', 'gexit', 'glaw']);
    list = setGoalStatus('gdeep', 'active', 21)(list);
    expect(list.filter(g => g.status === 'active').map(g => g.id)).toEqual(['grun', 'gexit', 'glaw', 'gdeep']);
    // A sibling that went with it stays closed.
    expect(list.find(g => g.id === 'gcomms')?.status).toBe('achieved');
    // Dropping a sub-goal leaves its parent alone.
    list = setGoalStatus('glaw', 'dropped', 22)(list);
    expect(list.find(g => g.id === 'gexit')?.status).toBe('active');
    expect(list.find(g => g.id === 'gdeep')?.status).toBe('dropped');
  });

  it('moves a goal among its siblings only, and deletes a goal with everything under it', () => {
    const list = moveGoal('gcomms', -1)(TREE);
    expect(list.map(g => g.id)).toEqual(['gexit', 'grun', 'gcomms', 'glaw', 'gdeep']);
    expect(moveGoal('gcomms', 1)(TREE)).toBe(TREE);
    expect(moveGoal('gexit', 1)(TREE).map(g => g.id)).toEqual(['grun', 'gexit', 'glaw', 'gcomms', 'gdeep']);
    expect(removeGoal('glaw')(TREE).map(g => g.id)).toEqual(['gexit', 'grun', 'gcomms']);
  });

  it('adds, ticks, renames and removes key results anywhere in the tree', () => {
    let list = addResult('gexit', 'k2', 'Escrow released', 30, 'k2a')(TREE);
    expect(findResult(list[0].results, 'k2')?.results).toEqual([{ id: 'k2a', text: 'Escrow released', done: false }]);
    list = addResult('gexit', null, '  Press release out ', 31, 'k3')(list);
    expect(list[0].results.map(r => r.text)).toEqual(['Share transfer signed', 'Money in the bank', 'Press release out']);
    list = patchResult('gexit', 'k1b', { done: true }, 32)(list);
    expect(resultDone(list[0].results[0])).toBe(true);
    list = patchResult('gexit', 'k1', null, 33)(list);
    expect(list[0].results.map(r => r.id)).toEqual(['k2', 'k3']);
    expect(list[0].updatedAt).toBe(33);
  });

  it('reads and writes key results as an indented outline, keeping ticks on lines kept as they were', () => {
    expect(outlineOf(exit.results)).toBe('Share transfer signed\n  Buyer’s lawyer approves the SPA\n  Board approves\nMoney in the bank');
    expect(parseOutline('- One\n  - One a\n\tOne b\n      One b i\n        Too deep\nTwo\n\n')).toEqual([
      { text: 'One', results: [{ text: 'One a' }, { text: 'One b', results: [{ text: 'One b i' }, { text: 'Too deep' }] }] },
      { text: 'Two' },
    ]);
    const merged = mergeResults(exit.results, parseOutline('Share transfer signed\n  Buyer’s lawyer approves the SPA\n  Board approves by vote\nMoney in the bank'));
    expect(merged[0]).toMatchObject({ id: 'k1', done: false });
    expect(merged[0].results?.[0]).toMatchObject({ id: 'k1a', done: true });
    expect(merged[0].results?.[1].id).not.toBe('k1b');
    expect(merged[1].id).toBe('k2');
    const made = makeGoal({ title: 'Sub', section: 'sj', results: parseOutline('A\n  B'), parent: 'gexit', parentKr: 'k2' }, 1, 'gsub');
    expect(made).toMatchObject({ parent: 'gexit', parentKr: 'k2' });
    expect(made.results[0].results?.[0].text).toBe('B');
  });

  it('tells the model sub-goals under their goals, with the key result each serves', () => {
    const p = buildPrompt('book the board room', NOW, [], undefined, LABELS, undefined, undefined, [
      { id: 'gexit', title: 'Give Sam an exit', section: 'sj', results: openResults(exit) },
      { id: 'glaw', title: 'Close the board', section: 'sj', parent: 'gexit', forResult: 'Share transfer signed › Board approves' },
      { id: 'gdeep', title: 'Book the room', section: 'sj', parent: 'glaw' },
    ]);
    expect(p).toContain('- gexit = Give Sam an exit (Superjoin). Done when: Share transfer signed › Board approves; Money in the bank');
    expect(p).toContain('  - glaw = Close the board (sub-goal of gexit, for its key result "Share transfer signed › Board approves")');
    expect(p).toContain('    - gdeep = Book the room (sub-goal of glaw)');
    expect(p).toContain('Pick the most specific one');
  });

  it('the review lists sub-goals under their goal, and a goal whose sub-goal got time isn’t idle', () => {
    const tasks = [task('Room', { goal: 'gdeep', status: 'done', start: at(17, 10), doneAt: at(17, 11), minutes: 60 })];
    const r = review({ tasks, labels: LABELS, goals: TREE, now: NOW }, periodOf('week', NOW));
    expect(r.goals.map(g => `${g.depth}:${g.id || '-'}:${g.minutes}`)).toEqual(['0:gexit:0', '1:glaw:0', '2:gdeep:60', '1:gcomms:0', '0:grun:0']);
    expect(r.goals.find(g => g.id === 'gdeep')?.color).toBe('#4F5BD5');
    expect(r.insights).toContain('Nothing moved “Run a half marathon” in this stretch.');
  });
});

describe('moving goals and key results', () => {
  const krs = [
    { id: 'k1', text: 'Shares transferred', done: false, results: [{ id: 'k1a', text: 'Board approves', done: false }] },
    { id: 'k2', text: 'Paid', done: false },
    { id: 'k3', text: 'Announced', done: false },
  ];
  const exit = goal('gexit', 'Give Sam an exit', { section: 'sj', results: krs });
  const run = goal('grun', 'Run a half marathon', { section: 'personal' });
  const legal = goal('glegal', 'Close the lawyer’s side', { parent: 'gexit', parentKr: 'k1', section: 'sj' });
  const docs = goal('gdocs', 'Get the documents', { parent: 'glegal', section: 'sj' });
  const old = goal('gold', 'Launch v1', { status: 'achieved', closedAt: 5 });
  const list = [exit, run, legal, docs, old];

  it('puts an existing goal under another, with everything under it, in its new section', () => {
    expect(cantMoveGoal(list, 'glegal', 'grun')).toBeNull();
    const out = normalizeGoals(reparentGoal('glegal', 'grun', null, 9)(list));
    const byId = new Map(out.map(g => [g.id, g]));
    expect(byId.get('glegal')).toMatchObject({ parent: 'grun', section: 'personal', updatedAt: 9 });
    expect(byId.get('glegal')!.parentKr).toBeUndefined();
    expect(byId.get('gdocs')).toMatchObject({ parent: 'glegal', section: 'personal' });
    // Last among the goals beside it there.
    expect(out.filter(g => g.parent === 'grun').map(g => g.id)).toEqual(['glegal']);
  });

  it('makes a sub-goal a top goal, last among them, keeping its section', () => {
    const out = normalizeGoals(reparentGoal('glegal', null, null, 9)(list));
    expect(topGoals(out).map(g => g.id)).toEqual(['gexit', 'grun', 'glegal']);
    const g = out.find(x => x.id === 'glegal')!;
    expect(g.parent).toBeUndefined();
    expect(g.section).toBe('sj');
    expect(out.find(x => x.id === 'gdocs')!.parent).toBe('glegal');
  });

  it('changes which key result a sub-goal serves without moving it', () => {
    const out = reparentGoal('glegal', 'gexit', 'k2', 9)(list);
    expect(out.map(g => g.id)).toEqual(list.map(g => g.id));
    expect(out.find(x => x.id === 'glegal')).toMatchObject({ parent: 'gexit', parentKr: 'k2' });
    // A key result the parent doesn't have serves the goal as a whole.
    expect(reparentGoal('glegal', 'grun', 'k2', 9)(list).find(x => x.id === 'glegal')!.parentKr).toBeUndefined();
  });

  it('says why a goal can’t go somewhere', () => {
    expect(cantMoveGoal(list, 'gexit', 'gexit')).toMatch(/under itself/);
    expect(cantMoveGoal(list, 'gexit', 'gdocs')).toMatch(/is under “Give Sam an exit”/);
    expect(cantMoveGoal(list, 'grun', 'gold')).toMatch(/is achieved; bring it back first/);
    expect(cantMoveGoal(list, 'gold', 'grun')).toBeNull();
    expect(cantMoveGoal(list, 'glegal', 'gnope')).toMatch(/no goal/);
    expect(cantMoveGoal(list, 'glegal', 'gexit')).toBeNull();
    // Too deep, counting what's under it.
    const chain = Array.from({ length: MAX_GOAL_DEPTH }, (_, i) => goal(`c${i}`, `Level ${i}`, i ? { parent: `c${i - 1}` } : {}));
    expect(heightOf([...list, ...chain], 'c0')).toBe(MAX_GOAL_DEPTH - 1);
    expect(cantMoveGoal([...list, ...chain], 'glegal', `c${MAX_GOAL_DEPTH - 1}`)).toMatch(/levels deep/);
    expect(cantMoveGoal([...list, ...chain], 'gdocs', `c${MAX_GOAL_DEPTH - 2}`)).toBeNull();
    // A full set of top goals has no room for one more.
    const full = [...list, ...Array.from({ length: MAX_ACTIVE - 2 }, (_, i) => goal(`t${i}`, `Top ${i}`))];
    expect(cantMoveGoal(full, 'glegal', null)).toMatch(new RegExp(`${MAX_ACTIVE} top goals`));
    expect(cantMoveGoal(full, 'grun', 'gexit')).toBeNull();
  });

  it('ranks a goal among the open ones beside it', () => {
    const tops = [exit, run, old, goal('g3', 'Third')];
    expect(topGoals(rankGoal('g3', 1)(tops)).map(g => g.id)).toEqual(['g3', 'gexit', 'grun']);
    expect(topGoals(rankGoal('gexit', 99)(tops)).map(g => g.id)).toEqual(['grun', 'g3', 'gexit']);
    expect(rankGoal('gold', 1)(tops)).toBe(tops);
    expect(rankGoal('grun', 2)(tops)).toBe(tops);
  });

  it('moves and reorders key results on a goal', () => {
    const under = moveResult('gexit', 'k3', 'k1', null, 9)([exit])[0];
    expect(flatResults(under.results).map(x => [x.kr.id, x.parent])).toEqual([['k1', null], ['k1a', 'k1'], ['k3', 'k1'], ['k2', null]]);
    const first = moveResult('gexit', 'k1a', null, 1, 9)([exit])[0];
    expect(first.results.map(r => r.id)).toEqual(['k1a', 'k1', 'k2', 'k3']);
    expect(first.results[1].results).toBeUndefined();
    const reorder = moveResult('gexit', 'k3', null, 2, 9)([exit])[0];
    expect(reorder.results.map(r => r.id)).toEqual(['k1', 'k3', 'k2']);
    expect(normalizeGoals([reorder])[0].results).toEqual(reorder.results);
  });

  it('says why a key result can’t go somewhere', () => {
    expect(cantMoveResult(exit, 'k1', 'k1a')).toMatch(/under itself/);
    expect(cantMoveResult(exit, 'k1', 'k1')).toMatch(/under itself/);
    expect(cantMoveResult(exit, 'k2', 'k1a')).toBeNull();
    // k1 has one level under it: under k2 that's two deep, fine; under k1a's level it would be past three.
    expect(cantMoveResult(exit, 'k1', 'k2')).toBeNull();
    const deep = moveResult('gexit', 'k2', 'k1a', null, 9)([exit])[0];
    expect(cantMoveResult(deep, 'k1', 'k3')).toMatch(/levels deep/);
    expect(cantMoveResult(exit, 'k9', null)).toMatch(/no such/);
    const crowded = goal('gc', 'Crowded', { results: Array.from({ length: MAX_RESULTS }, (_, i) => ({ id: `r${i}`, text: `R${i}`, done: false, ...(i ? {} : { results: [{ id: 'rin', text: 'In', done: false }] }) })) });
    expect(cantMoveResult(crowded, 'rin', null)).toMatch(`${MAX_RESULTS} key results`);
  });
});
