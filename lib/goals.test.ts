import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import {
  MAX_ACTIVE, activeGoalOf, addGoal, goalNamed, goalRanker, goalSection, makeGoal, moveGoal, normalizeGoals, onGoalShare, patchGoal,
  pickGoal, removeGoal, resultsLine, setGoalStatus, tallyGoals, type Goal,
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
