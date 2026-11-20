import { describe, expect, it } from 'vitest';
import type { Task } from '../model';
import type { TaskRepo } from '../repo/types';
import { normalizeRepeats, startRepeat, occurrence, REPEATS_KEY } from '../repeat';
import { SLIPS_KEY } from '../slips';
import { TaskError, changeGoals, completeTask, createTask, cutByLimits, deleteGoal, deleteTask, getGoal, getTask, listGoals, listTasks, refsFor, reopenTask, updateTask, type Ctx } from './tools';
import { normalizeGoals } from '../goals';
import { LOG_KEY, normalizeLog } from '../flow';

const NOW = Date.parse('2026-11-11T10:00:00Z');
const H = 3600000;
const TZ = 'America/New_York';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: NOW - 10 * H, order: 1, doneAt: null, externalId: null, label: null, updatedAt: NOW - 5 * H, ...extra,
});

/** A TaskRepo in memory, counting writes. */
function memRepo(tasks: Task[], settings: Record<string, unknown> = {}) {
  const rows = new Map(tasks.map(t => [t.id, t]));
  const store = { ...settings };
  const log = { puts: 0, removes: 0, settings: [] as string[] };
  const repo: TaskRepo = {
    kind: 'supabase',
    async list() { return [...rows.values()]; },
    async put(ts) { log.puts++; for (const t of ts) rows.set(t.id, t); },
    async remove(ids) { log.removes++; for (const id of ids) rows.delete(id); },
    subscribe() { return () => undefined; },
    async getSetting<T>(k: string) { return (store[k] ?? null) as T | null; },
    async setSetting(k, v) { log.settings.push(k); store[k] = v; },
  };
  return { repo, rows, store, log };
}

const LABELS = { labels: [{ id: 'work', name: 'Work', color: '#336699' }, { id: 'home', name: 'Home life', color: '#993366' }] };
const ctx = (m: ReturnType<typeof memRepo>): Ctx => ({ repo: m.repo, tz: TZ, now: () => NOW });

describe('list_tasks', () => {
  const seed = () => memRepo([
    task('later', { priority: 3, label: 'work' }),
    task('urgent', { priority: 1, due: '2026-11-20', notes: 'call the bank first' }),
    task('soon', { priority: 2, due: '2026-11-12', label: 'home' }),
    task('cal', { priority: 2, start: Date.parse('2026-11-11T15:00:00Z') }),
    task('done', { status: 'done', doneAt: NOW - H }),
    task('meet', { externalId: 'gcal:me@example.com:e1', start: Date.parse('2026-11-11T18:00:00Z') }),
    task('gt', { externalId: 'gtask:abc', title: 'Google task' }),
  ], { prefs: LABELS });

  // Ties on priority and due date: the one on the calendar first.
  it('lists open tasks the way the backlog ranks them, with Google events left out', async () => {
    const out = await listTasks(ctx(seed()), {});
    expect(out.tasks.map(t => t.id)).toEqual(['urgent', 'soon', 'cal', 'gt', 'later']);
    expect(out).toMatchObject({ total: 5, next_cursor: null, today: '2026-11-11', timezone: TZ });
    expect(out.tasks.find(t => t.id === 'cal')).toEqual({
      id: 'cal', title: 'cal', status: 'open', priority: 'important', project: null, goal: null, due: null,
      scheduled: '2026-11-11T10:00:00-05:00', minutes: 30, updated: '2026-11-11T00:00:00-05:00',
    });
    expect(out.tasks.find(t => t.id === 'gt')?.source).toBe('google_tasks');
    expect((await listTasks(ctx(seed()), { include_events: true })).tasks.find(t => t.id === 'meet')?.source).toBe('google_calendar');
  });

  it('filters by status, project, due date, time on the calendar and words', async () => {
    const m = seed();
    expect((await listTasks(ctx(m), { status: 'done' })).tasks.map(t => t.id)).toEqual(['done']);
    expect((await listTasks(ctx(m), { status: 'any' })).total).toBe(6);
    expect((await listTasks(ctx(m), { project: 'work' })).tasks.map(t => t.id)).toEqual(['later']);
    expect((await listTasks(ctx(m), { project: 'home' })).tasks.map(t => [t.id, t.project])).toEqual([['soon', 'Home life']]);
    expect((await listTasks(ctx(m), { project: 'none' })).tasks.map(t => t.id)).toEqual(['urgent', 'cal', 'gt']);
    expect((await listTasks(ctx(m), { due_after: '2026-11-12', due_before: '2026-11-12' })).tasks.map(t => t.id)).toEqual(['soon']);
    expect((await listTasks(ctx(m), { due_before: '2026-11-30' })).tasks.map(t => t.id)).toEqual(['urgent', 'soon']);
    expect((await listTasks(ctx(m), { scheduled_after: '2026-11-11', scheduled_before: '2026-11-11', include_events: true })).tasks.map(t => t.id)).toEqual(['cal', 'meet']);
    expect((await listTasks(ctx(m), { scheduled_after: '2026-11-11T11:00' , include_events: true })).tasks.map(t => t.id)).toEqual(['meet']);
    expect((await listTasks(ctx(m), { query: 'BANK call' })).tasks.map(t => t.id)).toEqual(['urgent']);
  });

  it('pages with a cursor', async () => {
    const m = seed();
    const one = await listTasks(ctx(m), { limit: 2 });
    expect(one.tasks.map(t => t.id)).toEqual(['urgent', 'soon']);
    const two = await listTasks(ctx(m), { limit: 2, cursor: one.next_cursor! });
    expect(two.tasks.map(t => t.id)).toEqual(['cal', 'gt']);
    const three = await listTasks(ctx(m), { limit: 2, cursor: two.next_cursor! });
    expect(three).toMatchObject({ tasks: [{ id: 'later' }], next_cursor: null });
    await expect(listTasks(ctx(m), { cursor: 'nonsense' })).rejects.toThrow(TaskError);
  });

  it('says which projects exist when one is unknown', async () => {
    await expect(listTasks(ctx(seed()), { project: 'Gardening' })).rejects.toThrow(/Work, Home life/);
    await expect(listTasks(ctx(seed()), { due_after: '2026-02-30' })).rejects.toThrow(/date like/);
  });
});

describe('get_task', () => {
  it('has the notes, what you said and the repeat', async () => {
    const r = startRepeat({ title: 'Groceries', notes: 'milk', priority: 2, minutes: 30, label: 'home', raw: 'groceries every monday',
      rule: { freq: 'week', every: 1, days: [1], monthDay: null }, time: null, from: '2026-11-09' }, NOW, 'rabc');
    const occ = occurrence(r, '2026-11-09', NOW);
    const m = memRepo([task('t1', { notes: 'bring the deck', raw: 'finish the board deck by friday', title: 'Board deck' }), occ],
      { prefs: LABELS, [REPEATS_KEY]: [r] });
    expect(await getTask(ctx(m), 't1')).toMatchObject({
      id: 't1', title: 'Board deck', notes: 'bring the deck', original_text: 'finish the board deck by friday',
      created: '2026-11-10T19:00:00-05:00', done_at: null,
    });
    expect(await getTask(ctx(m), occ.id)).toMatchObject({ repeating: true, repeat: 'Every Monday', project: 'Home life', due: '2026-11-09' });
    await expect(getTask(ctx(m), 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('create_task', () => {
  it('adds a task with the planner’s defaults, reading times in your zone', async () => {
    const m = memRepo([], { prefs: LABELS });
    const t = await createTask(ctx(m), { title: '  Call   the plumber ', scheduled: '2026-11-12T09:00', project: 'Home life', priority: 'urgent' });
    expect(t).toMatchObject({ title: 'Call the plumber', status: 'open', priority: 'urgent', project: 'Home life', minutes: 30,
      scheduled: '2026-11-12T09:00:00-05:00', due: null, updated: '2026-11-11T05:00:00-05:00' });
    const row = m.rows.get(t.id)!;
    expect(row).toMatchObject({ start: Date.parse('2026-11-12T14:00:00Z'), label: 'home', priority: 1, created: NOW, order: NOW, updatedAt: NOW });
    expect(t.id).toMatch(/^t[0-9a-z]+$/);
  });

  it('can add one already done, with a deadline and a description', async () => {
    const m = memRepo([], { prefs: LABELS });
    const t = await createTask(ctx(m), { title: 'Expenses', status: 'done', due: '2026-11-15', description: 'Q3', minutes: 60 });
    expect(t).toMatchObject({ status: 'done', due: '2026-11-15', notes: 'Q3', minutes: 60, done_at: '2026-11-11T05:00:00-05:00', priority: 'important' });
  });

  it('refuses a project or date it can’t place', async () => {
    const m = memRepo([], { prefs: LABELS });
    await expect(createTask(ctx(m), { title: 'x', project: 'Nope' })).rejects.toThrow(/no project called/);
    await expect(createTask(ctx(m), { title: 'x', scheduled: 'tomorrow' })).rejects.toThrow(/date and time/);
    expect(m.log.puts).toBe(0);
  });
});

describe('update_task', () => {
  it('changes only what it’s given, and clears with null', async () => {
    const m = memRepo([task('t1', { label: 'work', due: '2026-11-20', start: NOW + H, notes: 'keep' })], { prefs: LABELS });
    const out = await updateTask(ctx(m), 't1', { title: 'Renamed', scheduled: null, project: null });
    expect(out).toMatchObject({ changed: true, title: 'Renamed', scheduled: null, project: null, due: '2026-11-20', notes: 'keep' });
    expect(m.rows.get('t1')!.updatedAt).toBe(NOW);
  });

  it('writes nothing when nothing changes', async () => {
    const m = memRepo([task('t1', { priority: 1 })], { prefs: LABELS });
    expect(await updateTask(ctx(m), 't1', { priority: 'urgent' })).toMatchObject({ changed: false });
    expect(m.log.puts).toBe(0);
  });

  it('stamps a write newer than the one it replaces, so open screens take it', async () => {
    const m = memRepo([task('t1', { updatedAt: NOW + 5000 })], { prefs: LABELS });
    await updateTask(ctx(m), 't1', { minutes: 45 });
    expect(m.rows.get('t1')!.updatedAt).toBe(NOW + 5001);
  });

  it('leaves what Google owns to Google', async () => {
    const m = memRepo([task('ev', { externalId: 'gcal:me:e1', title: 'Standup', start: NOW + H })], { prefs: LABELS });
    await expect(updateTask(ctx(m), 'ev', { title: 'x', scheduled: null })).rejects.toThrow(/title, scheduled follow Google/);
    await expect(updateTask(ctx(m), 'ev', { title: 'x' })).rejects.toThrow(/its title follows Google/);
    expect(await updateTask(ctx(m), 'ev', { priority: 'urgent', project: 'Work' })).toMatchObject({ priority: 'urgent', project: 'Work' });
  });

  it('carries an edit to a repeat’s open task on to the ones to come', async () => {
    const r = startRepeat({ title: 'Gym', notes: '', priority: 2, minutes: 60, label: null, raw: '',
      rule: { freq: 'day', every: 1, days: [], monthDay: null }, time: '07:00', from: '2026-11-11' }, NOW, 'rgym');
    const occ = occurrence(r, '2026-11-11', NOW);
    const m = memRepo([occ], { prefs: LABELS, [REPEATS_KEY]: [r] });
    await updateTask(ctx(m), occ.id, { title: 'Gym, legs day', minutes: 90 });
    expect(normalizeRepeats(m.store[REPEATS_KEY])[0]).toMatchObject({ id: 'rgym', title: 'Gym, legs day', minutes: 90 });
  });

  it('notes a missed slot that’s moved, for the review', async () => {
    const m = memRepo([task('miss', { start: NOW - 3 * H, minutes: 30 })], { prefs: LABELS });
    await updateTask(ctx(m), 'miss', { scheduled: '2026-11-12T09:00' });
    expect(m.store[SLIPS_KEY]).toEqual([expect.objectContaining({ id: 'miss', start: NOW - 3 * H, how: 'moved' })]);
  });
});

describe('complete_task and reopen_task', () => {
  it('tick off and reopen, and say when nothing changed', async () => {
    const m = memRepo([task('t1')], { prefs: LABELS });
    expect(await completeTask(ctx(m), 't1')).toMatchObject({ status: 'done', done_at: '2026-11-11T05:00:00-05:00', changed: true });
    expect(await completeTask(ctx(m), 't1')).toMatchObject({ status: 'done', changed: false });
    expect(await reopenTask(ctx(m), 't1')).toMatchObject({ status: 'open', done_at: null, changed: true });
    expect(m.log.puts).toBe(2);
  });
  it('can tick off a Google event', async () => {
    const m = memRepo([task('ev', { externalId: 'gcal:me:e1' })], { prefs: LABELS });
    expect(await completeTask(ctx(m), 'ev')).toMatchObject({ status: 'done' });
  });
});

describe('delete_task', () => {
  it('deletes, and notes a missed slot', async () => {
    const m = memRepo([task('gone', { start: NOW - 3 * H, title: 'Dentist' })], { prefs: LABELS });
    expect(await deleteTask(ctx(m), 'gone')).toEqual({ deleted: { id: 'gone', title: 'Dentist' } });
    expect(m.rows.has('gone')).toBe(false);
    expect(m.store[SLIPS_KEY]).toEqual([expect.objectContaining({ id: 'gone', how: 'dropped' })]);
  });
  it('won’t delete what Google would send back', async () => {
    const m = memRepo([task('gt', { externalId: 'gtask:1' })], { prefs: LABELS });
    await expect(deleteTask(ctx(m), 'gt')).rejects.toMatchObject({ code: 'read_only' });
    expect(m.rows.has('gt')).toBe(true);
  });
  it('says when the task isn’t there', async () => {
    await expect(deleteTask(ctx(memRepo([])), 'x')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('goals', () => {
  const GOALS = [
    { id: 'gexit', title: 'Give Sam an exit', section: 'work', results: [{ id: 'k1', text: 'Shares transferred', done: true }, { id: 'k2', text: 'Paid', done: false }], by: '2026-12-31', status: 'active', created: 1, closedAt: null, updatedAt: 1,
      plan: { links: [{ from: 'lawyer', to: 'deck' }, { from: 'deck', to: 'kr:k2' }], waits: [] } },
    { id: 'grun', title: 'Run a half marathon', section: 'home', results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1 },
    { id: 'gold', title: 'Old launch', section: null, results: [], by: null, status: 'achieved', created: 1, closedAt: 2, updatedAt: 2 },
  ];
  const seed = () => memRepo([
    task('chore', { priority: 2 }),
    task('deck', { priority: 2, goal: 'gexit', label: 'work' }),
    task('lawyer', { priority: 2, goal: 'gexit', label: 'work', status: 'done', doneAt: NOW - H }),
    task('jog', { priority: 3, goal: 'grun' }),
    task('relic', { priority: 2, goal: 'gold' }),
  ], { prefs: LABELS, goals: GOALS });

  it('lists the goals, most important first, with what done means and their tasks', async () => {
    const out = await listGoals(ctx(seed()));
    expect(out.goals.map(g => g.id)).toEqual(['gexit', 'grun']);
    expect(out.goals[0]).toMatchObject({
      id: 'gexit', title: 'Give Sam an exit', section: 'Work', status: 'active', rank: 1, by: '2026-12-31',
      done_when: [{ text: 'Shares transferred', done: true }, { text: 'Paid', done: false }], open_tasks: 1, done_tasks: 1,
    });
    // Its flow chart: the deck needs the lawyer, and leads to being paid.
    expect(out.goals[0].flow.arrows).toEqual([{ from: 'lawyer', to: 'deck' }, { from: 'deck', to: 'kr:k2' }]);
    expect(out.goals[0].flow.steps.find(s => s.id === 'deck')).toMatchObject({ kind: 'task', state: 'ready', needs: ['lawyer'] });
    expect(out.goals[0].flow.steps.find(s => s.id === 'kr:k2')).toMatchObject({ kind: 'milestone', title: 'Paid', state: 'open' });
    // On an achieved goal is off-goal now.
    expect(out.off_goal_open_tasks).toBe(2);
    expect((await listGoals(ctx(seed()), { include_closed: true })).goals.map(g => [g.id, g.rank])).toEqual([['gexit', 1], ['grun', 2], ['gold', null]]);
  });

  it('ranks goal work before off-goal work at the same priority, and filters by goal', async () => {
    const out = await listTasks(ctx(seed()), {});
    expect(out.tasks.map(t => t.id)).toEqual(['deck', 'chore', 'relic', 'jog']);
    expect(out.tasks[0].goal).toBe('Give Sam an exit');
    expect((await listTasks(ctx(seed()), { goal: 'exit' })).tasks.map(t => t.id)).toEqual(['deck']);
    expect((await listTasks(ctx(seed()), { goal: 'none' })).tasks.map(t => t.id)).toEqual(['chore', 'relic']);
    await expect(listTasks(ctx(seed()), { goal: 'world peace' })).rejects.toThrow(/no goal called "world peace".*"Give Sam an exit", "Run a half marathon"/);
  });

  it('puts a new task on a goal, in its section', async () => {
    const m = seed();
    const t = await createTask(ctx(m), { title: 'Send the cap table', goal: 'Give Sam an exit' });
    expect(t).toMatchObject({ goal: 'Give Sam an exit', project: 'Work' });
    expect(m.rows.get(t.id)).toMatchObject({ goal: 'gexit', label: 'work' });
    // A project given wins over the goal's section.
    const u = await createTask(ctx(m), { title: 'Buy shoes', goal: 'marathon', project: 'Work' });
    expect(m.rows.get(u.id)).toMatchObject({ goal: 'grun', label: 'work' });
  });

  it('moves a task onto a goal and off it again', async () => {
    const m = seed();
    expect(await updateTask(ctx(m), 'chore', { goal: 'grun' })).toMatchObject({ changed: true, goal: 'Run a half marathon', project: 'Home life' });
    expect(await updateTask(ctx(m), 'chore', { goal: 'grun' })).toMatchObject({ changed: false });
    expect(await updateTask(ctx(m), 'chore', { goal: null })).toMatchObject({ changed: true, goal: null });
    expect(m.rows.get('chore')?.goal).toBeNull();
  });

  it('lists sub-goals under their goal, with the key result each serves and how far along it is', async () => {
    const sub = { id: 'gbank', title: 'Open the escrow account', section: null, results: [{ id: 'kb', text: 'Account open', done: false, results: [{ id: 'kb1', text: 'KYC done', done: true }] }],
      by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, parent: 'gexit', parentKr: 'k2' };
    const m = memRepo([task('kyc', { goal: 'gbank' })], { prefs: LABELS, goals: [...GOALS, sub] });
    const out = await listGoals(ctx(m));
    expect(out.goals.map(g => [g.id, g.rank, g.parent, g.parent_kr])).toEqual([['gexit', 1, null, null], ['gbank', null, 'gexit', 'k2'], ['grun', 2, null, null]]);
    // In its top goal's section; its key results depth first, each with the one it's under.
    expect(out.goals[1]).toMatchObject({ section: 'Work', progress: 1, open_tasks: 1 });
    expect(out.goals[1].done_when).toEqual([{ id: 'kb', text: 'Account open', done: true, under: null }, { id: 'kb1', text: 'KYC done', done: true, under: 'kb' }]);
    // On the goal's chart, the sub-goal is a step leading to the key result it serves.
    expect(out.goals[0].flow.steps.find(s => s.id === 'goal:gbank')).toMatchObject({ kind: 'goal', progress: 1 });
    expect(out.goals[0].flow.arrows).toContainEqual({ from: 'goal:gbank', to: 'kr:k2', structure: true });
    // A new task on a sub-goal takes its top goal's section.
    const t = await createTask(ctx(m), { title: 'Send the passport scan', goal: 'gbank' });
    expect(m.rows.get(t.id)).toMatchObject({ goal: 'gbank', label: 'work' });
  });

  it('has no goals on a database from before them', async () => {
    const m = seed();
    m.repo.getSetting = async <T,>(k: string) => { if (k === 'goals') throw new Error('mcp: setting not available'); return (k === 'prefs' ? LABELS : null) as T; };
    expect(await listGoals(ctx(m))).toEqual({ goals: [], off_goal_open_tasks: 4 });
    expect((await listTasks(ctx(m), {})).tasks.every(t => t.goal === null)).toBe(true);
  });
});

describe('building goals and their charts', () => {
  const EXIT = { id: 'gexit', title: 'Give Sam an exit', section: 'work', results: [{ id: 'k1', text: 'Shares transferred', done: false }, { id: 'k2', text: 'Paid', done: false }],
    by: '2026-12-31', status: 'active', created: 1, closedAt: null, updatedAt: 1, plan: { links: [{ from: 'lawyer', to: 'deck' }], waits: [] } };
  const seed = (extra: Record<string, unknown> = {}) => memRepo([
    task('lawyer', { goal: 'gexit', label: 'work' }),
    task('deck', { goal: 'gexit', label: 'work' }),
    task('stray', {}),
    task('standup', { externalId: 'gcal:me:s1', start: NOW + H }),
  ], { prefs: LABELS, goals: [EXIT], ...extra });
  const goalsIn = (m: ReturnType<typeof memRepo>) => normalizeGoals(m.store.goals);

  it('builds a new goal with key results, steps, a waiting step and arrows in one call', async () => {
    const m = seed();
    const out = await changeGoals(ctx(m), { ops: [
      { op: 'add_goal', title: 'Launch the newsletter', results: ['First issue sent'], key: 'news' },
      { op: 'add_step', goal: 'news', title: 'Pick a platform', minutes: 30, priority: 'urgent', key: 'pick' },
      { op: 'add_step', goal: 'news', title: 'Write issue one', minutes: 120, after: 'pick', key: 'write' },
      { op: 'add_wait', goal: 'news', title: 'Editor reviews it', holds: 'send', key: 'review' },
      { op: 'add_step', goal: 'news', title: 'Send issue one', after: 'write', key: 'send' },
      { op: 'link', from: 'review', to: 'send' },
      { op: 'link', goal: 'news', from: 'send', to: 'First issue sent' },
    ] });
    const g = goalsIn(m).find(x => x.title === 'Launch the newsletter')!;
    expect(g.results.map(r => r.text)).toEqual(['First issue sent']);
    const tasks = [...m.rows.values()].filter(t => t.goal === g.id);
    expect(tasks.map(t => [t.title, t.minutes, t.priority]).sort()).toEqual([['Pick a platform', 30, 1], ['Send issue one', 30, 2], ['Write issue one', 120, 2]]);
    const id = (title: string) => tasks.find(t => t.title === title)!.id;
    const wait = g.plan!.waits[0];
    expect(wait.title).toBe('Editor reviews it');
    expect(g.plan!.links).toEqual(expect.arrayContaining([
      { from: id('Pick a platform'), to: id('Write issue one') }, { from: id('Write issue one'), to: id('Send issue one') },
      { from: wait.id, to: id('Send issue one') }, { from: id('Send issue one'), to: `kr:${g.results[0].id}` },
    ]));
    // "holds: send" named a step not added yet, so it was said, and the explicit link drew it.
    expect(out.changed).toContain('“Launch the newsletter”: waiting on “Editor reviews it”');
    expect(out.goals.map(x => x.id)).toEqual([g.id]);
    const send = out.goals[0].flow.steps.find(s => s.title === 'Send issue one')!;
    expect(send).toMatchObject({ state: 'blocked', needs: expect.arrayContaining([wait.id, id('Write issue one')]) });
    // The chart's history has it all, tasks included.
    const log = normalizeLog(m.store[LOG_KEY]).filter(e => e.goal === g.id);
    expect(log.filter(e => e.op === 'add').map(e => e.title).sort()).toEqual(['Pick a platform', 'Send issue one', 'Write issue one']);
    expect(log.some(e => e.op === 'link' && e.fromTitle === 'Editor reviews it')).toBe(true);
  });

  it('changes an existing chart by the ids get_goal shows', async () => {
    const m = seed();
    const before = await getGoal(ctx(m), { goal: 'Give Sam an exit' });
    expect(before.flow.steps.map(s => s.id).sort()).toEqual(['deck', 'kr:k1', 'kr:k2', 'lawyer']);
    const out = await changeGoals(ctx(m), { goal: 'gexit', ops: [
      { op: 'link', from: 'deck', to: 'kr:k1' },
      { op: 'add_wait', title: 'Sam signs', holds: 'kr:k1' },
      { op: 'edit_step', ref: 'lawyer', done: true },
      { op: 'move_step', ref: 'stray', after: 'deck' },
      { op: 'edit_result', ref: 'k2', text: 'Paid in full' },
    ] });
    expect(out.skipped).toEqual([]);
    const g = goalsIn(m)[0];
    expect(g.plan!.links).toEqual(expect.arrayContaining([{ from: 'deck', to: 'kr:k1' }, { from: 'deck', to: 'stray' }]));
    expect(g.results.find(r => r.id === 'k2')!.text).toBe('Paid in full');
    expect(m.rows.get('lawyer')).toMatchObject({ status: 'done', doneAt: NOW });
    expect(m.rows.get('stray')).toMatchObject({ goal: 'gexit', label: 'work' });
    expect(out.goals[0].flow.steps.find(s => s.id === 'deck')).toMatchObject({ state: 'ready' });
    expect(normalizeLog(m.store[LOG_KEY]).map(e => e.op)).toEqual(expect.arrayContaining(['link', 'wait', 'done', 'add']));
  });

  it('adds a sub-goal for a key result, and takes "goal:" ids', async () => {
    const m = seed();
    await changeGoals(ctx(m), { ops: [
      { op: 'add_goal', title: 'Close the lawyer side', parent: 'gexit', for_result: 'kr:k1', key: 'sub' },
      { op: 'add_step', goal: 'sub', title: 'Send the draft SPA' },
    ] });
    const sub = goalsIn(m).find(x => x.title === 'Close the lawyer side')!;
    expect(sub).toMatchObject({ parent: 'gexit', parentKr: 'k1', section: 'work' });
    const out = await changeGoals(ctx(m), { ops: [{ op: 'link', from: 'lawyer', to: `goal:${sub.id}` }] });
    expect(out.changed).toEqual(['“Close the lawyer side” now waits on “lawyer”']);
    expect(goalsIn(m).find(x => x.id === 'gexit')!.plan!.links).toContainEqual({ from: 'lawyer', to: `goal:${sub.id}` });
  });

  it('says what it couldn’t do, and leaves Google’s items to Google', async () => {
    const m = seed();
    const out = await changeGoals(ctx(m), { goal: 'gexit', ops: [
      { op: 'link', from: 'deck', to: 'lawyer' },
      { op: 'link', from: 'nowhere', to: 'deck' },
      { op: 'edit_step', ref: 'standup', title: 'Renamed' },
      { op: 'remove_step', ref: 'standup', delete: true },
    ] });
    expect(out.changed).toEqual([]);
    expect(out.skipped).toHaveLength(4);
    expect(out.skipped[0]).toMatch(/comes from Google/);
    expect(out.skipped.join(' ')).toMatch(/would make a loop/);
    expect(out.skipped.join(' ')).toMatch(/no step “nowhere”/);
    expect(m.rows.get('standup')!.title).toBe('standup');
    expect(m.log.settings).not.toContain('goals');
  });

  it('refuses an unknown goal or no operations', async () => {
    await expect(changeGoals(ctx(seed()), { goal: 'Become an astronaut', ops: [{ op: 'add_step', title: 'x' }] })).rejects.toThrow(/no goal "Become an astronaut".*Give Sam an exit/);
    await expect(changeGoals(ctx(seed()), { ops: [{ op: 'fly' }] })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('shows one goal with its chart as Mermaid and its history', async () => {
    const m = seed({ [LOG_KEY]: [{ at: NOW - H, goal: 'gexit', op: 'link', step: 'deck', title: 'deck', from: 'lawyer', fromTitle: 'lawyer' }, { at: NOW, goal: 'other', op: 'add', title: 'x' }] });
    const g = await getGoal(ctx(m), { goal: 'gexit' });
    expect(g).toMatchObject({ id: 'gexit', title: 'Give Sam an exit', section: 'Work', progress: 0 });
    expect(g.mermaid).toMatch(/^flowchart LR/);
    expect(g.mermaid).toContain('n_lawyer --> n_deck');
    expect(g.history).toEqual([{ at: '2026-11-11T04:00:00-05:00', what: '“lawyer” now comes before “deck”' }]);
    await expect(getGoal(ctx(m), { goal: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('notes task changes on a goal in its chart history, and skips the history on an older database', async () => {
    const m = seed();
    await completeTask(ctx(m), 'deck');
    expect(normalizeLog(m.store[LOG_KEY])).toEqual([expect.objectContaining({ goal: 'gexit', op: 'done', step: 'deck' })]);
    const old = seed();
    const get = old.repo.getSetting.bind(old.repo);
    old.repo.getSetting = async <T,>(k: string) => { if (k === LOG_KEY) throw new Error('mcp_setting: mcp: setting not available'); return get<T>(k); };
    await expect(completeTask(ctx(old), 'deck')).resolves.toMatchObject({ status: 'done' });
  });

  it('moves an existing goal under a parent, for one of its key results, and back to the top', async () => {
    const RUN = { id: 'grun', title: 'Run a half marathon', section: 'home', results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1 };
    const m = seed({ goals: [EXIT, RUN] });
    m.rows.set('long', task('long', { goal: 'grun', label: 'home' }));
    const out = await changeGoals(ctx(m), { ops: [{ op: 'move_goal', goal: 'Run a half marathon', parent: 'goal:gexit', for_result: 'kr:k2', after: 'deck' }] });
    expect(out.skipped).toEqual([]);
    expect(out.changed).toEqual(['“Run a half marathon” is under “Give Sam an exit” now, for “Paid”, after “deck”']);
    expect(goalsIn(m).find(g => g.id === 'grun')).toMatchObject({ parent: 'gexit', parentKr: 'k2', section: 'work' });
    expect(goalsIn(m).find(g => g.id === 'gexit')!.plan!.links).toContainEqual({ from: 'deck', to: 'goal:grun' });
    // The goals it touched, as list_goals shows them: the moved one under its new parent, in its section.
    expect(out.goals.find(g => g.id === 'grun')).toMatchObject({ parent: 'gexit', parent_kr: 'k2', section: 'Work', rank: null });
    expect((await listGoals(ctx(m))).goals.map(g => [g.id, g.rank])).toEqual([['gexit', 1], ['grun', null]]);
    // Its tasks came along.
    expect((await getGoal(ctx(m), { goal: 'grun' })).open_tasks).toBe(1);

    const back = await changeGoals(ctx(m), { ops: [{ op: 'move_goal', goal: 'grun', parent: 'none', rank: 1, section: 'Home life' }] });
    expect(back.changed).toEqual(['“Run a half marathon” is a top goal now, in “Home life”, ranked 1']);
    expect((await listGoals(ctx(m))).goals.map(g => [g.id, g.rank, g.section])).toEqual([['grun', 1, 'Home life'], ['gexit', 2, 'Work']]);
    expect(goalsIn(m).find(g => g.id === 'gexit')!.plan!.links).not.toContainEqual({ from: 'deck', to: 'goal:grun' });
  });

  it('lists a goal as touched when only its repeating steps changed', async () => {
    const m = seed();
    // NOW is a Wednesday: a step every Friday makes no task today, only the repeat.
    const out = await changeGoals(ctx(m), { goal: 'gexit', ops: [{ op: 'add_step', title: 'Investor update', repeat: { freq: 'week', days: ['fri'] } }] });
    expect(m.store[REPEATS_KEY]).toHaveLength(1);
    expect(out.goals.map(g => g.id)).toEqual(['gexit']);
  });

  it('takes sections by name, and says which exist', async () => {
    const m = seed();
    await changeGoals(ctx(m), { ops: [{ op: 'add_goal', title: 'Fix the roof', section: 'Home life' }, { op: 'edit_goal', goal: 'gexit', section: 'none' }] });
    expect(goalsIn(m).map(g => [g.title, g.section])).toEqual([['Give Sam an exit', null], ['Fix the roof', 'home']]);
    await expect(changeGoals(ctx(m), { ops: [{ op: 'add_goal', title: 'X', section: 'Garden' }] })).rejects.toThrow(/no project called "Garden".*Work, Home life/);
  });

  it('deletes a goal for good: its open tasks go off-goal, or with with_tasks are deleted, never Google’s', async () => {
    const m = seed();
    m.rows.set('gt', task('gt', { goal: 'gexit', externalId: 'gtask:list:1' }));
    m.rows.set('was', task('was', { goal: 'gexit', status: 'done', doneAt: NOW - H }));
    const out = await changeGoals(ctx(m), { ops: [{ op: 'delete_goal', goal: 'gexit', with_tasks: true }] });
    expect(out.changed).toEqual(['Deleted “Give Sam an exit”; 2 open tasks deleted; 1 open task off-goal now (1 from Google, which can’t be deleted here)']);
    expect(out.goals).toEqual([]);
    expect(goalsIn(m)).toEqual([]);
    expect(m.rows.has('lawyer')).toBe(false);
    expect(m.rows.has('deck')).toBe(false);
    expect(m.rows.get('gt')!.goal).toBeNull();
    // Done work stays, as the record of it.
    expect(m.rows.get('was')!.goal).toBe('gexit');
    expect((await listGoals(ctx(m))).goals).toEqual([]);
  });

  describe('gaps found using it from Claude', () => {
    const RUN = { id: 'grun', title: 'Run a half marathon', section: 'home', results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1 };

    it('1. edit_goal moves an existing goal under a parent, or to the top with null, by add_goal’s rules', async () => {
      const m = seed({ goals: [EXIT, RUN] });
      const out = await changeGoals(ctx(m), { ops: [{ op: 'edit_goal', goal: 'grun', parent: 'gexit', for_result: 'kr:k2' }] });
      expect(out.skipped).toEqual([]);
      expect(out.changed).toEqual(['“Run a half marathon” is under “Give Sam an exit” now, for “Paid”']);
      expect(goalsIn(m).find(g => g.id === 'grun')).toMatchObject({ parent: 'gexit', parentKr: 'k2', section: 'work' });
      // Refused with the reason, and the rest of that operation left alone.
      const bad = await changeGoals(ctx(m), { ops: [
        { op: 'edit_goal', goal: 'gexit', parent: 'grun', title: 'Renamed' },
        { op: 'edit_goal', goal: 'grun', parent: 'Become an astronaut' },
      ] });
      expect(bad.changed).toEqual([]);
      expect(bad.skipped).toEqual([
        'Couldn’t change the goal: “Run a half marathon” is under “Give Sam an exit”, so “Give Sam an exit” can’t go under it.',
        'Couldn’t change the goal: there’s no goal Become an astronaut to put it under.',
      ]);
      expect(goalsIn(m).find(g => g.id === 'gexit')!.title).toBe('Give Sam an exit');
      const top = await changeGoals(ctx(m), { ops: [{ op: 'edit_goal', goal: 'grun', parent: null, title: 'Run a marathon' }] });
      expect(top.changed).toEqual(['“Run a half marathon” is a top goal now', '“Run a half marathon” is now “Run a marathon”']);
      expect(goalsIn(m).find(g => g.id === 'grun')!.parent).toBeUndefined();
    });

    it('2. sets a goal’s section by label name or id, and its sub-goals and their tasks take it', async () => {
      const m = seed({ goals: [] });
      const out = await changeGoals(ctx(m), { ops: [
        { op: 'add_goal', title: 'Fix the roof', section: 'Home life', key: 'roof' },
        { op: 'add_goal', title: 'Get quotes', parent: 'roof', key: 'quotes' },
        { op: 'add_step', goal: 'quotes', title: 'Call three roofers' },
        { op: 'add_goal', title: 'Ship v2', section: 'work' },
      ] });
      expect(out.skipped).toEqual([]);
      expect(out.changed).toContain('New goal “Fix the roof”, in “Home life”');
      expect(goalsIn(m).map(g => [g.title, g.section])).toEqual([['Fix the roof', 'home'], ['Get quotes', 'home'], ['Ship v2', 'work']]);
      expect([...m.rows.values()].find(t => t.title === 'Call three roofers')!.label).toBe('home');
      expect((await createTask(ctx(m), { title: 'Buy a ladder', goal: 'Get quotes' })).project).toBe('Home life');
      // A top goal's new section carries down to its sub-goals, and to the tasks made on them.
      await changeGoals(ctx(m), { ops: [{ op: 'edit_goal', goal: 'Fix the roof', section: 'Work' }] });
      expect(goalsIn(m).map(g => g.section)).toEqual(['work', 'work', 'work']);
      expect((await createTask(ctx(m), { title: 'Pick a roofer', goal: 'Get quotes' })).project).toBe('Work');
      await expect(changeGoals(ctx(m), { ops: [{ op: 'edit_goal', goal: 'Ship v2', section: 'Garden' }] })).rejects.toThrow(/no project called "Garden".*Work, Home life/);
    });

    it('3. edit_goal ranks a goal among the open ones beside it', async () => {
      const m = seed({ goals: [EXIT, RUN, { ...RUN, id: 'gold', title: 'Old', status: 'dropped', closedAt: 1 }] });
      const out = await changeGoals(ctx(m), { ops: [{ op: 'edit_goal', goal: 'grun', rank: 1 }] });
      expect(out.changed).toEqual(['“Run a half marathon” ranked 1']);
      expect((await listGoals(ctx(m))).goals.map(g => [g.id, g.rank])).toEqual([['grun', 1], ['gexit', 2]]);
      const again = await changeGoals(ctx(m), { ops: [{ op: 'edit_goal', goal: 'grun', rank: 1 }, { op: 'edit_goal', goal: 'gold', rank: 1 }] });
      expect(again.skipped).toEqual(['“Run a half marathon” is already ranked 1.', '“Old” isn’t ranked: it’s dropped, and only open goals have a rank.']);
    });

    it('4. add_step takes a due date, checked as create_task checks one', async () => {
      const m = seed();
      const out = await changeGoals(ctx(m), { goal: 'gexit', ops: [
        { op: 'add_step', title: 'File the forms', due: '2026-12-01' },
        { op: 'add_step', title: 'Weekly check-in', due: '2026-12-01', repeat: { freq: 'week', days: ['fri'] } },
      ] });
      expect(out.changed[0]).toBe('“Give Sam an exit”: step “File the forms”, due 2026-12-01');
      expect([...m.rows.values()].find(t => t.title === 'File the forms')!.due).toBe('2026-12-01');
      expect(out.skipped).toEqual(['“Weekly check-in” repeats, so each one is due on its own day; its due date was left out.']);
      await expect(changeGoals(ctx(m), { goal: 'gexit', ops: [{ op: 'add_step', title: 'X', due: '2026-02-30' }] })).rejects.toThrow(/due must be a date like 2026-11-12, not "2026-02-30"/);
    });

    it('5. never moves a task by linking it to a step on another goal, and keeps its arrows', async () => {
      const m = seed({ goals: [EXIT, RUN] });
      m.rows.set('shoes', task('shoes', { goal: 'grun', label: 'home' }));
      m.rows.set('route', task('route', { goal: 'grun', label: 'home' }));
      await changeGoals(ctx(m), { ops: [{ op: 'link', from: 'shoes', to: 'route' }] });
      const out = await changeGoals(ctx(m), { ops: [{ op: 'link', from: 'shoes', to: 'deck' }, { op: 'add_step', goal: 'gexit', title: 'Brief Sam', after: 'route' }] });
      const refusal = (t: string) => `“${t}” is on “Run a half marathon”, not on “Give Sam an exit”, so it can’t have an arrow there: arrows only join steps on the same goal, and drawing one doesn’t move a task. Put it on “Give Sam an exit” with move_step first if it belongs there.`;
      expect(out.skipped).toEqual([refusal('shoes'), refusal('route')]);
      expect(out.changed).toEqual(['“Give Sam an exit”: step “Brief Sam”']);
      expect(m.rows.get('shoes')).toMatchObject({ goal: 'grun', label: 'home' });
      expect(m.rows.get('route')).toMatchObject({ goal: 'grun', label: 'home' });
      expect(goalsIn(m).find(g => g.id === 'grun')!.plan!.links).toEqual([{ from: 'shoes', to: 'route' }]);
      expect(goalsIn(m).find(g => g.id === 'gexit')!.plan!.links).toEqual([{ from: 'lawyer', to: 'deck' }]);
      // Moving it is its own operation, which says its arrows stay behind.
      const moved = await changeGoals(ctx(m), { ops: [{ op: 'move_step', ref: 'shoes', goal: 'gexit', after: 'deck' }] });
      expect(moved.changed).toEqual(['“shoes” moved to “Give Sam an exit” after “deck”']);
      expect(moved.skipped).toEqual(['“shoes”’s 1 arrow on “Run a half marathon” doesn’t come with it: arrows only join steps on the same goal.']);
    });

    // A daily repeat on the exit, with today's one open and yesterday's done.
    const repeating = () => {
      const r = startRepeat({ title: 'Update Sam', notes: '', priority: 2, minutes: 30, label: 'work', goal: 'gexit', raw: '', rule: { freq: 'day', every: 1, days: [], monthDay: null }, time: null, from: '2026-11-09' }, NOW - 2 * 864e5, 'rupd');
      const open = occurrence(r, '2026-11-11', NOW), was: Task = { ...occurrence(r, '2026-11-10', NOW), status: 'done', doneAt: NOW - 864e5 };
      const m = seed({ goals: [EXIT, RUN], [REPEATS_KEY]: [r] });
      m.rows.set(open.id, open);
      m.rows.set(was.id, was);
      return { m, open, was };
    };

    it('6. moves a repeating task’s open occurrences with its series, so it shows on one chart', async () => {
      const { m, open, was } = repeating();
      expect((await getGoal(ctx(m), { goal: 'gexit' })).flow.steps.map(x => x.id)).toContain('rep:rupd');
      const out = await changeGoals(ctx(m), { ops: [{ op: 'move_step', ref: 'rep:rupd', goal: 'grun' }] });
      expect(out.changed).toEqual(['“Update Sam” moved to “Run a half marathon”']);
      expect(normalizeRepeats(m.store[REPEATS_KEY])[0]).toMatchObject({ goal: 'grun', label: 'home' });
      expect(m.rows.get(open.id)).toMatchObject({ goal: 'grun', label: 'home' });
      // The done one stays on the goal it was done for, as a task of its own there.
      expect(m.rows.get(was.id)!.goal).toBe('gexit');
      const exitSteps = (await getGoal(ctx(m), { goal: 'gexit' })).flow.steps.map(x => x.id);
      expect(exitSteps).not.toContain('rep:rupd');
      expect(exitSteps).toContain(was.id);
      expect((await getGoal(ctx(m), { goal: 'grun' })).flow.steps.find(x => x.id === 'rep:rupd')).toMatchObject({ title: 'Update Sam' });
    });

    it('6. takes a repeating task’s open occurrences off its goal with it', async () => {
      const { m, open } = repeating();
      await changeGoals(ctx(m), { ops: [{ op: 'remove_step', ref: 'rep:rupd' }] });
      expect(normalizeRepeats(m.store[REPEATS_KEY])[0].goal ?? null).toBeNull();
      expect(m.rows.get(open.id)!.goal).toBeNull();
      expect((await getGoal(ctx(m), { goal: 'gexit' })).flow.steps.map(x => x.id)).not.toContain('rep:rupd');
    });

    it('7. lists what an operation can’t use: a field it doesn’t take, a value it can’t read, a key it doesn’t know', async () => {
      const m = seed();
      const out = await changeGoals(ctx(m), { goal: 'gexit', ops: [
        { op: 'add_wait', title: 'Sam signs', minutes: 30 },
        { op: 'edit_goal', goal: 'gexit', by: 'next friday', colour: 'red' },
        { op: 'edit_step', ref: 'kr:k1', priority: 'urgent' },
      ] });
      expect(out.skipped).toEqual([
        'Operation 1: add_wait doesn’t take “minutes”, so it was left out; it takes goal, title, text, holds, key.',
        'Operation 2: edit_goal couldn’t use "next friday" for “by”, so it was left out.',
        'Operation 2: edit_goal doesn’t take “colour”, so it was left out; it takes goal, title, by, section, status, parent, for_result, rank.',
        'Couldn’t change the goal: there was nothing to change; it already looks like that.',
        '“Shares transferred” is a key result, so it has no length or priority; priority left out.',
      ]);
      expect(out.changed).toEqual(['“Give Sam an exit”: waiting on “Sam signs”']);
    });

    it('7. lists a section or due date on an operation that doesn’t take one, rather than checking it', async () => {
      const out = await changeGoals(ctx(seed()), { goal: 'gexit', ops: [{ op: 'add_wait', title: 'Sam signs', section: 'Garden', due: '2026-02-30' }] });
      expect(out.skipped).toEqual([
        'Operation 1: add_wait doesn’t take “section”, so it was left out; it takes goal, title, text, holds, key.',
        'Operation 1: add_wait doesn’t take “due”, so it was left out; it takes goal, title, text, holds, key.',
      ]);
      expect(out.changed).toEqual(['“Give Sam an exit”: waiting on “Sam signs”']);
    });

    it('7. says when an operation changes nothing, or can’t find a step it names', async () => {
      const m = seed();
      const out = await changeGoals(ctx(m), { goal: 'gexit', ops: [
        { op: 'edit_goal', goal: 'gexit', title: 'Give Sam an exit' },
        { op: 'link', from: 'lawyer', to: 'deck' },
        { op: 'add_step', title: 'Draft the email', before: 'nowhere', beside: 'nobody' },
        { op: 'add_wait', title: 'A reply', holds: 'nothing' },
        { op: 'add_result', text: 'Board approves', under: 'Nope' },
        { op: 'edit_result', ref: 'kr:k1', text: 'Shares transferred' },
        { op: 'move_step', ref: 'deck', goal: 'gexit' },
      ] });
      expect(out.skipped).toEqual([
        'Couldn’t change the goal: there was nothing to change; it already looks like that.',
        '“deck” already waits on “lawyer”.',
        'No step nowhere for “Draft the email” to lead to.',
        'No step nobody for “Draft the email” to run alongside.',
        'No step nothing for “A reply” to hold up.',
        'Couldn’t add the key result: “Give Sam an exit” has no key result “Nope” to put it under.',
        'Couldn’t change the key result: there was nothing to change; it already looks like that.',
        'Couldn’t move the step: “deck” is on “Give Sam an exit” already.',
      ]);
      expect(out.changed).toEqual(['“Give Sam an exit”: step “Draft the email”', '“Give Sam an exit”: waiting on “A reply”']);
    });

    it('7. refuses what the app’s limits would cut or move, instead of losing it', async () => {
      const OLD = { ...RUN, id: 'gold', title: 'Launch v1', status: 'achieved', closedAt: 1 };
      const deep = { ...EXIT, results: [{ id: 'k1', text: 'Shares transferred', done: false, results: [{ id: 'k1a', text: 'Board approves', done: false, results: [{ id: 'k1b', text: 'Minutes signed', done: false }] }] }] };
      const m = seed({ goals: [deep, OLD] });
      const out = await changeGoals(ctx(m), { ops: [
        { op: 'add_goal', title: 'Write the docs', parent: 'gold' },
        { op: 'add_goal', title: 'Legal side', parent: 'gexit', for_result: 'Nope' },
        { op: 'add_result', goal: 'gexit', text: 'Notarised', under: 'kr:k1b' },
      ] });
      expect(out.changed).toEqual([]);
      expect(out.skipped).toEqual([
        'Couldn’t add the goal: “Launch v1” is achieved; bring it back first.',
        'Couldn’t add the goal: “Give Sam an exit” has no key result “Nope”.',
        'Couldn’t add the key result: key results go 3 levels deep at most.',
      ]);
      expect(goalsIn(m).map(g => g.id)).toEqual(['gexit', 'gold']);
      // And should keeping goals in shape ever cut something anyway, that's said too.
      const tops = Array.from({ length: 9 }, (_, i) => ({ ...RUN, id: `g${i}`, title: `Goal ${i}` })) as Parameters<typeof cutByLimits>[0];
      expect(cutByLimits(tops, normalizeGoals(tops))).toEqual(['“Goal 8” is dropped: it was past the most top goals at once.']);
    });
  });

  it('names key results by "kr:<id>", and by goal where two goals share an id', () => {
    const twin = { ...EXIT, id: 'gtwin', title: 'Twin', plan: undefined };
    const refs = refsFor(normalizeGoals([EXIT, twin]), [], []);
    expect(refs.results.get('gexit/kr:k1')).toEqual({ goal: 'gexit', id: 'k1' });
    expect(refs.results.get('gtwin/kr:k1')).toEqual({ goal: 'gtwin', id: 'k1' });
    expect(refs.results.has('kr:k1')).toBe(false);
    expect(refsFor(normalizeGoals([EXIT]), [], []).results.get('kr:k1')).toEqual({ goal: 'gexit', id: 'k1' });
  });
});

describe('get_goal with depth', () => {
  // Close the round: three threads; the capital raisers thread has people with no tasks yet; Fund North has two steps in order.
  const G = (id: string, title: string, parent: string | null, extra: Record<string, unknown> = {}) => ({
    id, title, section: 'work', results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, ...(parent ? { parent } : {}), ...extra,
  });
  const GOALS = [
    G('ground', 'Close the round', null),
    G('gcap', 'Reach out to 20 capital raisers', 'ground'),
    G('gra', 'Raiser A', 'gcap'), G('grb', 'Raiser B', 'gcap'), G('grc', 'Raiser C', 'gcap'),
    G('gang', 'Reach out to 20 angels', 'ground'),
    G('gfund', 'Fund North', 'gang', { plan: { links: [{ from: 'tmemo', to: 'tcall' }], waits: [] } }),
    G('gfound', 'Ask founders for advice', 'ground'),
  ];
  const seed = () => memRepo([
    task('tcapid', { goal: 'gcap', title: 'Find the rest of the 20 capital raisers' }),
    task('tmemo', { goal: 'gfund', title: 'Send the market memo to Fund North' }),
    task('tcall', { goal: 'gfund', title: 'Call Fund North' }),
    task('tangid', { goal: 'gang', title: 'Find the rest of the 20 angels' }),
    task('tfound', { goal: 'gfound', title: 'List founders to ask' }),
  ], { prefs: LABELS, goals: GOALS });

  it('shows the goal’s own chart alone by default, as before', async () => {
    const m = seed();
    const one = await getGoal(ctx(m), { goal: 'Close the round' });
    expect(one.flow.steps.map(s => s.id)).toEqual(['goal:gcap', 'goal:gang', 'goal:gfound']);
    expect(one.flow.steps.every(s => !('flow' in s))).toBe(true);
    expect(one.mermaid).not.toContain('subgraph');
    expect(await getGoal(ctx(m), { goal: 'Close the round', depth: 1 })).toEqual(one);
    // The same chart list_goals shows for it.
    expect((await listGoals(ctx(m))).goals.find(g => g.id === 'ground')!.flow).toEqual(one.flow);
  });

  it('inlines each sub-goal’s steps and arrows under it, as many levels as asked', async () => {
    const two = await getGoal(ctx(seed()), { goal: 'ground', depth: 2 });
    const cap = two.flow.steps.find(s => s.id === 'goal:gcap')!;
    expect(cap).toMatchObject({ kind: 'goal', title: 'Reach out to 20 capital raisers' });
    expect(cap.flow!.steps.map(s => s.id).sort()).toEqual(['goal:gra', 'goal:grb', 'goal:grc', 'tcapid']);
    // Two levels: Fund North is a step on the angels thread, without its own chart yet.
    const fty2 = two.flow.steps.find(s => s.id === 'goal:gang')!.flow!.steps.find(s => s.id === 'goal:gfund')!;
    expect(fty2.flow).toBeUndefined();

    const three = await getGoal(ctx(seed()), { goal: 'ground', depth: 3 });
    const fty = three.flow.steps.find(s => s.id === 'goal:gang')!.flow!.steps.find(s => s.id === 'goal:gfund')!;
    expect(fty.flow).toEqual({
      steps: expect.arrayContaining([
        expect.objectContaining({ id: 'tmemo', kind: 'task', state: 'ready', title: 'Send the market memo to Fund North' }),
        expect.objectContaining({ id: 'tcall', kind: 'task', state: 'blocked', needs: ['tmemo'] }),
      ]),
      arrows: [{ from: 'tmemo', to: 'tcall' }],
      critical_path: ['tmemo', 'tcall'],
    });
    expect(fty.flow!.steps).toHaveLength(2);
    // A person with no tasks yet: an empty chart.
    expect(three.flow.steps.find(s => s.id === 'goal:gcap')!.flow!.steps.find(s => s.id === 'goal:gra')!.flow).toEqual({ steps: [], arrows: [], critical_path: [] });
    // The rest of what get_goal says is the same at any depth.
    const { flow: _a, mermaid: _b, ...rest } = three;
    const { flow: _c, mermaid: _d, ...rest1 } = await getGoal(ctx(seed()), { goal: 'ground' });
    expect(rest).toEqual(rest1);
    // Past the deepest level there's nothing more; a depth out of range is brought into it.
    expect(await getGoal(ctx(seed()), { goal: 'ground', depth: 5 })).toEqual(three);
    expect(await getGoal(ctx(seed()), { goal: 'ground', depth: 99 })).toEqual(three);
    expect(await getGoal(ctx(seed()), { goal: 'ground', depth: 0 })).toEqual(await getGoal(ctx(seed()), { goal: 'ground' }));
  });

  it('draws a subgraph per sub-goal with steps in the Mermaid', async () => {
    const { mermaid } = await getGoal(ctx(seed()), { goal: 'ground', depth: 3 });
    expect(mermaid).toMatch(/^flowchart LR/);
    for (const id of ['gcap', 'gang', 'gfund', 'gfound']) expect(mermaid).toContain(`subgraph sg_${id} [" "]`);
    expect(mermaid).not.toContain('sg_gra');
    expect(mermaid).toContain('goal --> n_goal_gcap');
    expect(mermaid).toContain('n_goal_gcap --> n_gcap__goal_gra');
    expect(mermaid).toContain('n_gang__goal_gfund --> n_gfund__tmemo');
    expect(mermaid).toContain('n_gfund__tmemo --> n_gfund__tcall');
  });
});

describe('delete_goal', () => {
  const G = (id: string, title: string, parent: string | null, extra: Record<string, unknown> = {}) => ({
    id, title, section: 'work', results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, ...(parent ? { parent } : {}), ...extra,
  });
  // A launch with a press sub-goal (which has one of its own), and the press sub-goal on the launch's chart.
  const GOALS = [
    G('glaunch', 'Launch the app', null, { plan: { links: [{ from: 'tbeta', to: 'goal:gpress' }], waits: [] } }),
    G('gpress', 'Get press', 'glaunch'),
    G('gpod', 'Book podcasts', 'gpress'),
    G('gfit', 'Get fit', null),
  ];
  const seed = () => {
    const r = startRepeat({ title: 'Pitch a journalist', notes: '', priority: 2, minutes: 30, label: 'work', goal: 'gpress', raw: '', rule: { freq: 'week', every: 1, days: [1], monthDay: null }, time: null, from: '2026-11-09' }, NOW - 48 * H, 'rpitch');
    return memRepo([
      task('tbeta', { goal: 'glaunch' }),
      task('tlist', { goal: 'gpress', title: 'List the outlets' }),
      task('tmail', { goal: 'gpod', title: 'Email hosts' }),
      task('told', { goal: 'gpress', status: 'done', doneAt: NOW - H }),
      task('tgoogle', { goal: 'gpress', externalId: 'gtask:x', title: 'From Google' }),
      task('trun', { goal: 'gfit' }),
    ], { prefs: LABELS, goals: GOALS, [REPEATS_KEY]: [r] });
  };
  const goalsIn = (m: ReturnType<typeof memRepo>) => normalizeGoals(m.store.goals);

  it('deletes a sub-goal with the goals under it, takes it off its parent’s chart, and leaves its open tasks off-goal', async () => {
    const m = seed();
    const out = await deleteGoal(ctx(m), { goal: 'Get press' });
    expect(out.deleted).toEqual({ id: 'gpress', title: 'Get press', sub_goals: 1 });
    expect(goalsIn(m).map(g => g.id)).toEqual(['glaunch', 'gfit']);
    expect(goalsIn(m)[0].plan?.links ?? []).toEqual([]);
    // Open tasks stay in the planner, off-goal; done ones and the rest are as they were.
    for (const id of ['tlist', 'tmail', 'tgoogle']) expect(m.rows.get(id)).toMatchObject({ goal: null, status: 'open' });
    expect(m.rows.get('told')).toMatchObject({ status: 'done' });
    expect(m.rows.get('tbeta')!.goal).toBe('glaunch');
    // Its repeating task carries on, off-goal.
    const [rep] = normalizeRepeats(m.store[REPEATS_KEY]);
    expect(rep).toMatchObject({ id: 'rpitch', title: 'Pitch a journalist' });
    expect(rep.goal ?? null).toBeNull();
    expect(out.changed.join(' ')).toMatch(/Deleted “Get press” and 1 sub-goal under it/);
    // The launch's chart history says the step went.
    expect(normalizeLog(m.store[LOG_KEY])).toContainEqual(expect.objectContaining({ goal: 'glaunch', op: 'remove', step: 'goal:gpress' }));
  });

  it('with with_tasks deletes the open tasks too, except Google’s, and stops the repeating ones', async () => {
    const m = seed();
    const out = await deleteGoal(ctx(m), { goal: 'gpress', with_tasks: true });
    expect([...m.rows.keys()].sort()).toEqual(['tbeta', 'tgoogle', 'told', 'trun']);
    expect(m.rows.get('tgoogle')!.goal).toBeNull();
    expect(normalizeRepeats(m.store[REPEATS_KEY])).toEqual([]);
    expect(out.changed.join(' ')).toMatch(/2 open tasks deleted.*1 repeating task stopped/);
  });

  it('deletes a top goal, or a closed one, by id or title, and says when there’s no such goal', async () => {
    const m = seed();
    await deleteGoal(ctx(m), { goal: 'gfit' });
    expect(goalsIn(m).map(g => g.id)).toEqual(['glaunch', 'gpress', 'gpod']);
    expect(m.rows.get('trun')!.goal).toBeNull();
    const closed = memRepo([], { prefs: LABELS, goals: [{ ...G('gold', 'Old plan', null), status: 'dropped', closedAt: 2 }] });
    expect((await deleteGoal(ctx(closed), { goal: 'Old plan' })).deleted.id).toBe('gold');
    expect(goalsIn(closed)).toEqual([]);
    await expect(deleteGoal(ctx(seed()), { goal: 'Run a marathon' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('repeating tasks', () => {
  // NOW is Wednesday 11 November, 05:00 in New York (the connection's zone); the test runner's clock is Kolkata's.
  const GOALS = [{ id: 'grun', title: 'Run a half marathon', section: 'home', results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1,
    plan: { links: [{ from: 'tshoes', to: 'tlong' }], waits: [], pos: { tshoes: { x: 300, y: 40 } } } }];
  const seed = (extra: Task[] = [], repeats: unknown[] = []) => memRepo([
    task('tplain', { title: 'Water the plants' }),
    task('tshoes', { goal: 'grun', title: 'Buy shoes' }),
    task('tlong', { goal: 'grun', title: 'Long run' }),
    task('gt', { externalId: 'gtask:abc', title: 'Google task' }),
    ...extra,
  ], { prefs: LABELS, goals: GOALS, [REPEATS_KEY]: repeats });
  const repeatsIn = (m: ReturnType<typeof memRepo>) => normalizeRepeats(m.store[REPEATS_KEY]);

  it('adds a repeating task on the calendar at a time of day, in the user’s zone', async () => {
    const m = seed();
    const t = await createTask(ctx(m), { title: 'Team sync prep', scheduled: '2026-11-12T09:00', repeat: { freq: 'week' } });
    const [r] = repeatsIn(m);
    expect(r).toMatchObject({ title: 'Team sync prep', time: '09:00', from: '2026-11-12', made: '2026-11-12', rule: { freq: 'week', every: 1, days: [4] } });
    // This task is its first one: Thursday at 09:00 New York time.
    expect(t).toMatchObject({ id: `${r.id}.2026-11-12`, scheduled: '2026-11-12T09:00:00-05:00', repeating: true, series: `rep:${r.id}`, repeat: expect.stringMatching(/Thu/) });
    expect(m.rows.has(t.id)).toBe(true);
  });

  it('adds one that waits in the backlog, or one whose time comes from repeat.time', async () => {
    const m = seed();
    const daily = await createTask(ctx(m), { title: 'Stretch', repeat: { freq: 'day', times: 30 } });
    const stretch = repeatsIn(m).find(r => r.title === 'Stretch')!;
    expect(daily).toMatchObject({ id: `${stretch.id}.2026-11-11`, scheduled: null });
    expect(stretch).toMatchObject({ time: null, rule: { freq: 'day', times: 30 } });
    const timed = await createTask(ctx(m), { title: 'Journal', repeat: { freq: 'day', time: '21:30' }, goal: 'marathon' });
    expect(timed).toMatchObject({ scheduled: '2026-11-11T21:30:00-05:00', goal: 'Run a half marathon', project: 'Home life' });
    expect(repeatsIn(m).find(r => r.title === 'Journal')).toMatchObject({ time: '21:30', goal: 'grun', label: 'home' });
  });

  it('refuses a repeat it can’t read, or one that starts done', async () => {
    await expect(createTask(ctx(seed()), { title: 'x', repeat: { freq: 'fortnight' } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(createTask(ctx(seed()), { title: 'x', repeat: { freq: 'day', until: 'soon' } })).rejects.toThrow(/until/);
    await expect(createTask(ctx(seed()), { title: 'x', repeat: { freq: 'day', time: '9am' } })).rejects.toThrow(/time of day/);
    await expect(createTask(ctx(seed()), { title: 'x', status: 'done', repeat: { freq: 'day' } })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('makes a task repeat, and on a goal its arrows go to the series', async () => {
    const m = seed();
    const out = await updateTask(ctx(m), 'tshoes', { repeat: { freq: 'month' } });
    const [r] = repeatsIn(m);
    expect(out).toMatchObject({ changed: true, id: `${r.id}.2026-11-11`, title: 'Buy shoes', series: `rep:${r.id}` });
    expect(m.rows.has('tshoes')).toBe(false);
    expect(r).toMatchObject({ goal: 'grun', rule: { freq: 'month', monthDay: 11 } });
    const g = normalizeGoals(m.store.goals)[0];
    expect(g.plan!.links).toEqual([{ from: `rep:${r.id}`, to: 'tlong' }]);
    expect(g.plan!.pos).toEqual({ [`rep:${r.id}`]: { x: 300, y: 40 } });
    // Google's items and done tasks can't start repeating.
    await expect(updateTask(ctx(m), 'gt', { repeat: { freq: 'day' } })).rejects.toMatchObject({ code: 'read_only' });
    await expect(updateTask(ctx(m), 'tplain', { status: 'done', repeat: { freq: 'day' } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(updateTask(ctx(m), 'tplain', { repeat: null })).rejects.toThrow(/doesn't repeat/);
  });

  it('changes how and when a series repeats from one of its tasks, and stops it', async () => {
    const r = startRepeat({ title: 'Weekly review', notes: '', priority: 2, minutes: 60, label: null, goal: null, raw: '', rule: { freq: 'week', every: 1, days: [3], monthDay: null }, time: '17:00', from: '2026-11-04' }, NOW - 200 * H, 'rweek');
    const open = occurrence(r, '2026-11-11', NOW);
    const m = seed([open], [r]);
    // New days and a new time for every one to come; this one stays where it is.
    const out = await updateTask(ctx(m), open.id, { repeat: { freq: 'week', days: ['mon', 'fri'], time: '18:00' } });
    expect(out.changed).toBe(true);
    expect(repeatsIn(m)[0]).toMatchObject({ time: '18:00', rule: { days: [1, 5] } });
    expect(m.rows.get(open.id)!.start).toBe(open.start);
    // The same again changes nothing; leaving the time out keeps it.
    expect((await updateTask(ctx(m), open.id, { repeat: { freq: 'week', days: ['mon', 'fri'] } })).changed).toBe(false);
    // Stopping it keeps this one.
    await updateTask(ctx(m), open.id, { repeat: null });
    expect(repeatsIn(m)).toEqual([]);
    expect(m.rows.get(open.id)).toMatchObject({ status: 'open', title: 'Weekly review' });
  });

  it('changes a series by "rep:<id>" when none of it is open, and says what a series doesn’t have', async () => {
    const r = startRepeat({ title: 'Call mum', notes: '', priority: 2, minutes: 30, label: null, goal: null, raw: '', rule: { freq: 'week', every: 1, days: [0], monthDay: null }, time: null, from: '2026-11-08' }, NOW - 200 * H, 'rmum');
    const done = { ...occurrence(r, '2026-11-08', NOW), status: 'done' as const, doneAt: NOW - 50 * H };
    const m = seed([done], [r]);
    expect((await getTask(ctx(m), done.id)).series).toBe('rep:rmum');
    const out = await updateTask(ctx(m), 'rep:rmum', { title: 'Call Mum and Dad', priority: 'urgent', repeat: { freq: 'week', days: ['sat'], time: '11:00' } });
    expect(out).toMatchObject({ id: 'rep:rmum', title: 'Call Mum and Dad', priority: 'urgent', changed: true, repeat: expect.stringMatching(/Sat/) });
    expect(repeatsIn(m)[0]).toMatchObject({ title: 'Call Mum and Dad', priority: 1, time: '11:00', rule: { days: [6] } });
    // A done one keeps its title.
    expect(m.rows.get(done.id)!.title).toBe('Call mum');
    await expect(updateTask(ctx(m), 'rep:rmum', { scheduled: '2026-11-14T10:00' })).rejects.toThrow(/series as a whole has no scheduled/);
    await expect(updateTask(ctx(m), 'rep:nope', { title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await updateTask(ctx(m), 'rep:rmum', { repeat: null }))).toMatchObject({ changed: true, repeat: expect.stringMatching(/^Stopped/) });
    expect(repeatsIn(m)).toEqual([]);
  });

  it('renames a series’ open one along with it', async () => {
    const r = startRepeat({ title: 'Stand-up notes', notes: '', priority: 2, minutes: 15, label: null, goal: null, raw: '', rule: { freq: 'day', every: 1, days: [], monthDay: null }, time: null, from: '2026-11-10' }, NOW - 30 * H, 'rstand');
    const open = occurrence(r, '2026-11-11', NOW);
    const m = seed([open], [r]);
    await updateTask(ctx(m), 'rep:rstand', { title: 'Stand-up', minutes: 30 });
    expect(m.rows.get(open.id)).toMatchObject({ title: 'Stand-up', minutes: 30 });
  });
});
