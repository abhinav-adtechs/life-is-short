import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import type { Goal } from './goals';
import { MAX_DAYS, MAX_FOCUS, MAX_STEPS, OUTCOME_MAX, clearPlan, normalizeDays, outcomeView, planOn, setPlan, type DayPlan } from './today';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const FROM = at(20, 0), TO = at(21, 0);

let n = 0;
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: 't' + n++, title, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});
const goal = (id: string, title: string, extra: Partial<Goal> = {}): Goal => ({
  id, title, section: null, results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, ...extra,
});
const plan = (day: string, extra: Partial<DayPlan> = {}): DayPlan => ({
  day, at: 1, by: 'claude', focus: [{ goal: 'gseed', text: 'Deck out to both leads', tasks: [] }], ...extra,
});

describe('day plans', () => {
  it('keeps one plan a day, the latest planned, oldest day first, and drops junk', () => {
    const out = normalizeDays([
      plan('2026-11-20', { at: 5 }),
      plan('2026-11-20', { at: 9, focus: [{ goal: 'grun', text: '  Easy   8k  ', tasks: [] }] }),
      plan('2026-11-19'),
      { day: 'tomorrow', focus: [{ goal: 'g', text: 'x' }] },
      { day: '2026-11-18', focus: [] },
      { day: '2026-11-17', focus: [{ goal: '', text: 'no goal' }, { goal: 'g', text: '' }] },
      'junk', null,
    ]);
    expect(out.map(p => p.day)).toEqual(['2026-11-19', '2026-11-20']);
    expect(out[1]).toEqual({ day: '2026-11-20', at: 9, by: 'claude', focus: [{ goal: 'grun', text: 'Easy 8k', tasks: [] }] });
    expect(normalizeDays(undefined)).toEqual([]);
  });

  it('caps goals in focus, outcome length, named tasks and days kept, and drops a goal named twice', () => {
    const focus = Array.from({ length: MAX_FOCUS + 2 }, (_, i) => ({ goal: `g${i}`, text: 'x'.repeat(OUTCOME_MAX + 20), tasks: Array.from({ length: MAX_STEPS + 3 }, (_, k) => `t${k}`) }));
    const [p] = normalizeDays([{ day: '2026-11-20', at: 1, by: 'app', focus: [focus[0], ...focus] }]);
    expect(p.by).toBe('app');
    expect(p.focus).toHaveLength(MAX_FOCUS);
    expect(p.focus[0].text).toHaveLength(OUTCOME_MAX);
    expect(p.focus[0].tasks).toHaveLength(MAX_STEPS);
    const many = Array.from({ length: MAX_DAYS + 5 }, (_, i) => plan(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)));
    const kept = normalizeDays(many);
    expect(kept).toHaveLength(MAX_DAYS);
    expect(kept[kept.length - 1].day).toBe(many[many.length - 1].day);
  });

  it('plans a day in place of what it had, un-plans it with nothing in focus, and finds a day’s plan', () => {
    let days = setPlan(plan('2026-11-19'))([]);
    days = setPlan(plan('2026-11-20'))(days);
    expect(planOn(days, '2026-11-20')?.focus[0].text).toBe('Deck out to both leads');
    days = setPlan(plan('2026-11-20', { at: 2, focus: [{ goal: 'grun', text: 'Easy 8k', tasks: [] }] }))(days);
    expect(days.filter(p => p.day === '2026-11-20')).toHaveLength(1);
    expect(planOn(days, '2026-11-20')?.focus[0].goal).toBe('grun');
    expect(planOn(setPlan(plan('2026-11-20', { focus: [] }))(days), '2026-11-20')).toBeNull();
    expect(planOn(clearPlan('2026-11-20')(days), '2026-11-20')).toBeNull();
    expect(planOn(days, '2026-11-21')).toBeNull();
  });
});

describe('how an outcome stands', () => {
  const SEED = goal('gseed', 'Close the seed round', { results: [
    { id: 'k1', text: 'Lead signed', done: true }, { id: 'k2', text: 'Money in', done: false, results: [{ id: 'k3', text: 'Wire sent', done: false }] },
  ] });
  const LAW = goal('glaw', 'Close the lawyer’s side', { parent: 'gseed' });
  const RUN = goal('grun', 'Run a half marathon');
  const goals = [SEED, LAW, RUN];

  const deck = task('Rework the deck', { goal: 'gseed', start: at(20, 10) });
  const send = task('Send the deck', { goal: 'gseed' });
  const spa = task('Send the SPA', { goal: 'glaw', start: at(20, 15) });
  const early = task('Book the room', { goal: 'gseed', status: 'done', doneAt: at(20, 8) });
  const old = task('Old prep', { goal: 'gseed', status: 'done', doneAt: at(19, 9) });
  const later = task('Investor update', { goal: 'gseed', start: at(22, 17) });
  const run = task('Easy 8k', { goal: 'grun', start: at(20, 18) });
  const meet = task('Call with Fern', { goal: 'gseed', start: at(20, 14), externalId: 'gcal:me:1' });
  const tasks = [deck, send, spa, early, old, later, run, meet];

  it('steps are the named tasks first, then the goal’s and its sub-goals’ tasks on today’s calendar or ticked off today', () => {
    const v = outcomeView({ goal: 'gseed', text: 'Deck out', tasks: [send.id, 'gone'] }, goals, tasks, FROM, TO);
    expect(v?.steps.map(t => t.title)).toEqual(['Send the deck', 'Book the room', 'Rework the deck', 'Send the SPA']);
    expect(v?.done).toBe(1);
  });

  it('counts the goal’s tasks now and by tonight, and its top key results, never time', () => {
    const v = outcomeView({ goal: 'gseed', text: 'Deck out', tasks: [send.id] }, goals, tasks, FROM, TO);
    // On the goal or under it: deck, send, spa, early, old, later. Done: early, old. Today's open steps: send, deck, spa.
    expect(v?.tasks).toEqual({ done: 2, tonight: 5, all: 6 });
    expect(v?.results).toEqual({ done: 1, all: 2 });
  });

  it('a step named from another goal shows but doesn’t count towards this one, and a goal that’s gone has no view', () => {
    const v = outcomeView({ goal: 'grun', text: 'Week 6 done', tasks: [deck.id] }, goals, tasks, FROM, TO);
    expect(v?.steps.map(t => t.title)).toEqual(['Rework the deck', 'Easy 8k']);
    expect(v?.tasks).toEqual({ done: 0, tonight: 1, all: 1 });
    expect(outcomeView({ goal: 'nope', text: 'x', tasks: [] }, goals, tasks, FROM, TO)).toBeNull();
  });
});
