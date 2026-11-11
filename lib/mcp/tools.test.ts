import { describe, expect, it } from 'vitest';
import type { Task } from '../model';
import type { TaskRepo } from '../repo/types';
import { normalizeRepeats, startRepeat, occurrence, REPEATS_KEY } from '../repeat';
import { SLIPS_KEY } from '../slips';
import { TaskError, completeTask, createTask, deleteTask, getTask, listTasks, reopenTask, updateTask, type Ctx } from './tools';

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
      id: 'cal', title: 'cal', status: 'open', priority: 'important', project: null, due: null,
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
