import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import { normalizeGoals } from './goals';
import { buildTree } from './flowTree';
import { pickNext, routeOf } from './route';

const NOW = new Date(2026, 10, 19, 12).getTime();
const task = (id: string, goal: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, raw: '', notes: '', priority: 2, minutes: 60, start: null, due: null, status: 'open', created: 1, order: 1, doneAt: null, goal, ...extra,
});
const done = (at: number) => ({ status: 'done' as const, doneAt: NOW - at * 3600e3 });

/*
 * Close the seed round: the deck and the list are done, so sending it is up next; prep and the term sheet come after
 * it (the term sheet also waits on the lead's reply). The data room is a sub-goal with one thing done and two ready.
 */
const goals = normalizeGoals([
  {
    id: 'gseed', title: 'Close the seed round', section: null, by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1,
    results: [{ id: 'k1', text: 'Term sheet signed', done: false }],
    plan: {
      links: [{ from: 'deck', to: 'send' }, { from: 'list', to: 'send' }, { from: 'send', to: 'prep' }, { from: 'prep', to: 'nego' }, { from: 'wlead', to: 'nego' }, { from: 'nego', to: 'kr:k1' }],
      waits: [{ id: 'wlead', title: 'Lead investor’s reply', done: false, created: 1, doneAt: null }],
    },
  },
  {
    id: 'gdata', title: 'Data room', section: null, parent: 'gseed', by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, results: [],
    plan: { links: [{ from: 'collect', to: 'upload' }, { from: 'collect', to: 'legal' }], waits: [] },
  },
]);
const tasks = [
  task('deck', 'gseed', done(48)), task('list', 'gseed', done(24)), task('send', 'gseed', { priority: 1 }), task('prep', 'gseed', { minutes: 120 }),
  task('nego', 'gseed', { minutes: 240 }), task('collect', 'gdata', done(30)), task('upload', 'gdata'), task('legal', 'gdata', { minutes: 120, start: NOW + 3600e3 }),
];
const tree = (ts = tasks) => buildTree(goals[0], ts, NOW, { goals });

describe('routeOf', () => {
  const r = routeOf(tree());
  const ids = (l: { step: { id: string } }[]) => l.map(x => x.step.id);

  it('puts the first step you can start on the critical path up next, and says what it opens', () => {
    expect(r.next?.step.id).toBe('send');
    expect(r.next?.on).toBeNull();
    expect(r.opens.map(s => s.id)).toEqual(['prep']);
  });

  it('lists what else is ready, in the sub-goals too, the one on the calendar first', () => {
    expect(ids(r.ready)).toEqual(['legal', 'upload']);
    expect(r.ready[0].on?.id).toBe('gdata');
  });

  it('keeps what you wait on, what’s still locked and the key results ahead, in the order they come', () => {
    expect(ids(r.waiting)).toEqual(['wlead']);
    expect(ids(r.ahead)).toEqual(['prep', 'nego', 'kr:k1']);
  });

  it('has the sub-goals with their own charts, and what’s done on the goal itself, latest first', () => {
    expect(r.subs.map(s => s.step.id)).toEqual(['goal:gdata']);
    expect(r.subs[0].tree.flow.steps.map(s => s.id).sort()).toEqual(['collect', 'legal', 'upload']);
    expect(ids(r.done)).toEqual(['list', 'deck']);
  });

  it('looks inside a sub-goal when nothing on the goal itself can start', () => {
    const t = tree(tasks.map(x => (x.id === 'send' ? { ...x, status: 'done' as const, doneAt: NOW } : x.id === 'prep' ? { ...x, start: NOW + 9e6 } : x)));
    // Prep is ready now, and on the critical path.
    expect(pickNext(t)?.step.id).toBe('prep');
    const stuck = tree(tasks.filter(x => x.goal === 'gdata' || x.id === 'deck'));
    expect(pickNext(stuck)?.step.id).toBe('legal');
    expect(pickNext(stuck)?.on?.id).toBe('gdata');
  });

  it('has nothing up next when everything open is waiting', () => {
    const t = buildTree(goals[1], [task('collect', 'gdata', done(1))], NOW, { goals });
    expect(routeOf(t)).toMatchObject({ next: null, opens: [], ready: [] });
  });
});
