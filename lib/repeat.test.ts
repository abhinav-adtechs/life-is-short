import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import {
  applyOps, describeRepeat, describeRule, dueNow, firstDay, followTask, lastOn, makeRepeating, markMade, nextOn, nextWhen,
  normalizeRepeats, occurrence, occurrenceId, occurrenceOf, occursOn, repeatChoices, startRepeat, takeRepeat, toRule,
  undoOps, upcoming, upcomingOn, type Repeat, type Rule,
} from './repeat';
import { localParse } from './parse';
import { applyCapture } from './capture';
import { changesOf, commitChanges, draftOf } from './plan';
import { review, periodOf } from './review';
import { fromYmd } from './time';

const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m, d, h, min).getTime();
// Monday 2 Nov 2026, 09:00 local.
const NOW = at(10, 2, 9);

const WEEKLY = (days: number[], every = 1): Rule => ({ freq: 'week', every, days, monthDay: null });
const R = (extra: Partial<Repeat> = {}): Repeat => ({
  id: 'rgroc', title: 'Order groceries', notes: '', priority: 2, minutes: 15, label: 'personal',
  rule: WEEKLY([1, 4]), time: null, from: '2026-10-26', made: '2026-10-29', raw: '', created: 0, updatedAt: 0, ...extra,
});
const task = (extra: Partial<Task> = {}): Task => ({
  id: 'a', title: 'Order groceries', raw: '', notes: '', priority: 2, minutes: 15, start: null, due: null,
  status: 'open', created: 0, order: 0, doneAt: null, label: 'personal', ...extra,
});

describe('occursOn', () => {
  it('lands on the weekdays of a weekly rule, from its first day', () => {
    const r = { rule: WEEKLY([1, 4]), from: '2026-10-26' };
    expect(['2026-10-26', '2026-10-29', '2026-11-02', '2026-11-05'].map(d => occursOn(r, d))).toEqual([true, true, true, true]);
    expect(['2026-10-27', '2026-10-30', '2026-11-01'].map(d => occursOn(r, d))).toEqual([false, false, false]);
    expect(occursOn(r, '2026-10-22')).toBe(false);
  });

  it('counts every other week from the first day’s week, Monday to Sunday', () => {
    const r = { rule: WEEKLY([1, 0], 2), from: '2026-10-26' };
    expect(occursOn(r, '2026-10-26')).toBe(true);
    expect(occursOn(r, '2026-11-01')).toBe(true);
    expect(occursOn(r, '2026-11-02')).toBe(false);
    expect(occursOn(r, '2026-11-09')).toBe(true);
  });

  it('counts days, and keeps a monthly date inside short months', () => {
    expect(occursOn({ rule: { freq: 'day', every: 3, days: [], monthDay: null }, from: '2026-11-01' }, '2026-11-04')).toBe(true);
    expect(occursOn({ rule: { freq: 'day', every: 3, days: [], monthDay: null }, from: '2026-11-01' }, '2026-11-03')).toBe(false);
    const m = { rule: { freq: 'month' as const, every: 1, days: [], monthDay: 31 }, from: '2026-10-31' };
    expect(['2026-11-30', '2026-12-31', '2027-02-28'].map(d => occursOn(m, d))).toEqual([true, true, true]);
    expect(occursOn(m, '2026-11-29')).toBe(false);
    expect(occursOn({ ...m, rule: { ...m.rule, every: 2 } }, '2026-11-30')).toBe(false);
    expect(occursOn({ ...m, rule: { ...m.rule, every: 2 } }, '2026-12-31')).toBe(true);
  });

  it('finds the next day and the last one in a stretch', () => {
    const r = { rule: WEEKLY([1, 4]), from: '2026-10-26' };
    expect(nextOn(r, '2026-11-02')).toBe('2026-11-05');
    expect(nextOn(r, '2026-10-01')).toBe('2026-10-26');
    expect(lastOn(r, '2026-10-26', '2026-11-03')).toBe('2026-11-02');
    expect(lastOn(r, '2026-10-29', '2026-11-01')).toBeNull();
  });
});

describe('firstDay', () => {
  it('is today when the rule lands today and its time is still ahead, else the next day it lands on', () => {
    expect(firstDay(WEEKLY([1, 4]), null, NOW)).toBe('2026-11-02');
    expect(firstDay(WEEKLY([1, 4]), '18:00', NOW)).toBe('2026-11-02');
    expect(firstDay(WEEKLY([1, 4]), '07:00', NOW)).toBe('2026-11-05');
    expect(firstDay(WEEKLY([3]), null, NOW)).toBe('2026-11-04');
  });

  it('starts every other Monday on the coming one, and takes a day you gave', () => {
    expect(firstDay(WEEKLY([1], 2), null, at(10, 3, 10))).toBe('2026-11-09');
    expect(firstDay(WEEKLY([1, 4]), null, NOW, '2026-11-12')).toBe('2026-11-12');
    expect(firstDay(WEEKLY([1, 4]), null, NOW, '2026-10-01')).toBe('2026-11-02');
  });
});

describe('dueNow', () => {
  it('makes the day’s task: in the backlog, due that day, with an id from the repeat and the day', () => {
    const due = dueNow([R()], [], NOW);
    expect(due.puts).toEqual([expect.objectContaining({
      id: 'rgroc.2026-11-02', title: 'Order groceries', start: null, due: '2026-11-02', status: 'open', label: 'personal', minutes: 15,
    })]);
    expect(due.made).toEqual(new Map([['rgroc', '2026-11-02']]));
    expect(occurrenceOf('rgroc.2026-11-02')).toEqual({ repeat: 'rgroc', day: '2026-11-02' });
    expect(occurrenceOf('t123')).toBeNull();
  });

  it('puts one with a time on the calendar then', () => {
    const due = dueNow([R({ id: 'rgym', title: 'Gym', time: '07:00', minutes: 60 })], [], NOW);
    expect(due.puts[0]).toMatchObject({ id: 'rgym.2026-11-02', start: at(10, 2, 7), due: null, minutes: 60 });
  });

  it('does nothing once a repeat is handled for today, so one you deleted stays gone', () => {
    expect(dueNow([R({ made: '2026-11-02' })], [], NOW)).toEqual({ puts: [], removes: [], slips: [], made: new Map() });
  });

  it('doesn’t make one another device made already', () => {
    const mine = occurrence(R(), '2026-11-02', NOW - 1000);
    expect(dueNow([R()], [{ ...mine, status: 'done' }], NOW).puts).toEqual([]);
  });

  it('lets go of days the planner wasn’t open, rather than piling them up', () => {
    const due = dueNow([R({ made: '2026-10-25' })], [], at(10, 5, 9));
    expect(due.puts.map(t => t.id)).toEqual(['rgroc.2026-11-05']);
  });

  it('notes a day with nothing to make as handled', () => {
    const due = dueNow([R({ made: '2026-11-02' })], [], at(10, 3, 9));
    expect(due.puts).toEqual([]);
    expect(due.made.get('rgroc')).toBe('2026-11-03');
  });

  it('replaces one still open from before, and notes it missed on its day', () => {
    const thu = occurrence(R(), '2026-10-29', at(9, 29, 0));
    const due = dueNow([R()], [thu], NOW);
    expect(due.removes).toEqual(['rgroc.2026-10-29']);
    expect(due.slips).toEqual([{
      id: 'rgroc.2026-10-29', start: fromYmd('2026-10-29').getTime(), minutes: 15, title: 'Order groceries', label: 'personal',
      priority: 2, at: NOW, how: 'replaced', due: true,
    }]);
  });

  it('notes a replaced one still on its slot by its slot, and one already back in the backlog not again', () => {
    const r = R({ id: 'rgym', time: '07:00' });
    const onSlot = occurrence(r, '2026-10-29', 0);
    const backlog = { ...occurrence(r, '2026-10-26', 0), start: null };
    const due = dueNow([r], [onSlot, backlog], NOW);
    expect(due.removes.sort()).toEqual(['rgym.2026-10-26', 'rgym.2026-10-29']);
    expect(due.slips).toEqual([expect.objectContaining({ id: 'rgym.2026-10-29', start: at(9, 29, 7), how: 'replaced' })]);
    expect(due.slips[0].due).toBeUndefined();
  });

  it('keeps one done, one you moved to that day or later, and other tasks', () => {
    const done = { ...occurrence(R(), '2026-10-26', 0), status: 'done' as const };
    const moved = { ...occurrence(R(), '2026-10-29', 0), due: null, start: at(10, 2, 18) };
    const other = task({ id: 'rother.2026-10-29', due: '2026-10-29' });
    const plain = task({ due: '2026-10-29' });
    expect(dueNow([R()], [done, moved, other, plain], NOW).removes).toEqual([]);
  });
});

describe('upcoming', () => {
  it('shows the timed ones still to come, after today and after what’s made', () => {
    const gym = R({ id: 'rgym', title: 'Gym', time: '07:00', made: '2026-11-02' });
    expect(upcomingOn([gym, R({ made: '2026-11-02' })], '2026-11-05', NOW)).toEqual([expect.objectContaining({ id: 'rgym.2026-11-05', start: at(10, 5, 7) })]);
    expect(upcomingOn([gym], '2026-11-02', NOW)).toEqual([]);
    expect(upcomingOn([gym], '2026-11-04', NOW)).toEqual([]);
    expect(upcoming([gym], NOW, 7).map(t => t.id)).toEqual(['rgym.2026-11-05', 'rgym.2026-11-09']);
  });
});

describe('starting and changing a repeat', () => {
  const spec = { title: 'Gym', notes: '', priority: 2 as const, minutes: 60, label: null, raw: 'gym', time: '07:00' };

  it('counts today as handled when it starts today, else up to the day before its first', () => {
    expect(startRepeat({ ...spec, rule: WEEKLY([1]), from: '2026-11-02' }, NOW, 'rx').made).toBe('2026-11-02');
    expect(startRepeat({ ...spec, rule: WEEKLY([3]), from: '2026-11-04' }, NOW, 'rx').made).toBe('2026-11-03');
  });

  it('fills in a weekly rule’s day and a monthly rule’s date from the first day', () => {
    expect(startRepeat({ ...spec, rule: WEEKLY([]), from: '2026-11-04' }, NOW, 'rx').rule.days).toEqual([3]);
    expect(startRepeat({ ...spec, rule: { freq: 'month', every: 1, days: [], monthDay: null }, from: '2026-11-15' }, NOW, 'rx').rule.monthDay).toBe(15);
  });

  it('turns a task into its repeat’s current one, for its own day or today', () => {
    const t = task({ id: 't1', start: at(10, 4, 18), minutes: 60, title: 'Gym' });
    const m = makeRepeating(t, WEEKLY([1, 4]), '18:00', NOW, 'rgym');
    expect(m.task).toMatchObject({ id: 'rgym.2026-11-04', start: at(10, 4, 18) });
    expect(m.removes).toEqual(['t1']);
    expect(m.repeat).toMatchObject({ from: '2026-11-04', made: '2026-11-04', time: '18:00', title: 'Gym' });
    expect(makeRepeating(task({ id: 't2' }), WEEKLY([1, 4]), null, NOW, 'rg').task.id).toBe('rg.2026-11-02');
  });

  it('follows an edit to an open one: title, priority, length, label and notes', () => {
    const t = occurrence(R(), '2026-11-02', NOW);
    expect(followTask(R(), t, NOW)).toBeNull();
    expect(followTask(R(), { ...t, start: at(10, 2, 15) }, NOW)).toBeNull();
    expect(followTask(R(), { ...t, title: 'Big shop', minutes: 30 }, NOW)).toMatchObject({ title: 'Big shop', minutes: 30, rule: R().rule });
    expect(followTask(R(), { ...t, title: 'Big shop', status: 'done' }, NOW)).toBeNull();
  });

  it('undoes starting, changing and stopping', () => {
    const list = [R()];
    const ops = [{ kind: 'set' as const, repeat: R({ id: 'rnew' }) }, { kind: 'set' as const, repeat: R({ title: 'Big shop' }) }];
    const after = applyOps(list, ops);
    expect(after.map(r => r.title)).toEqual(['Big shop', 'Order groceries']);
    expect(applyOps(after, undoOps(list, ops))).toEqual(list);
    const stop = [{ kind: 'stop' as const, id: 'rgroc' }];
    expect(applyOps(list, stop)).toEqual([]);
    expect(applyOps([], undoOps(list, stop))).toEqual(list);
  });

  it('only ever moves what’s made forward', () => {
    const f = markMade(new Map([['rgroc', '2026-10-30'], ['rnone', '2026-11-02']]));
    expect(f([R()])[0].made).toBe('2026-10-30');
    expect(f([R({ made: '2026-11-01' })])[0].made).toBe('2026-11-01');
  });
});

describe('reading and saying repeats', () => {
  it('reads a rule from the model, by weekday names', () => {
    expect(toRule({ freq: 'week', every: 1, days: ['mon', 'Thursday', 'mon'], monthday: null })).toEqual(WEEKLY([1, 4]));
    expect(toRule({ freq: 'monthly', every: 0, days: [], monthday: 1 })).toEqual({ freq: 'month', every: 1, days: [], monthDay: 1 });
    expect(toRule({ freq: 'day', every: 900 })).toEqual({ freq: 'day', every: 365, days: [], monthDay: null });
    expect(toRule({ freq: 'yearly' })).toBeNull();
    expect(toRule(null)).toBeNull();
  });

  it('cleans up what’s stored', () => {
    const ok = R();
    expect(normalizeRepeats([ok, { ...ok }, { ...ok, id: 'bad id' }, { ...ok, id: 'rx', title: ' ' }, { ...ok, id: 'ry', rule: { freq: 'hourly' } }, null])).toEqual([ok]);
    expect(normalizeRepeats([{ ...ok, made: 'x', time: '25:00', priority: 7 }])[0]).toMatchObject({ made: '2026-10-25', time: null, priority: 2 });
    expect(normalizeRepeats('nope')).toEqual([]);
  });

  it('says how it repeats', () => {
    expect(describeRule({ freq: 'day', every: 1, days: [], monthDay: null })).toBe('Every day');
    expect(describeRule({ freq: 'day', every: 3, days: [], monthDay: null })).toBe('Every 3 days');
    expect(describeRule(WEEKLY([1, 4]))).toBe('Every Mon and Thu');
    expect(describeRule(WEEKLY([0, 1, 3]))).toBe('Every Mon, Wed and Sun');
    expect(describeRule(WEEKLY([1]))).toBe('Every Monday');
    expect(describeRule(WEEKLY([1, 2, 3, 4, 5]))).toBe('Every weekday');
    expect(describeRule(WEEKLY([0, 6]))).toBe('Every weekend');
    expect(describeRule(WEEKLY([2], 2))).toBe('Every other week on Tuesday');
    expect(describeRule({ freq: 'month', every: 1, days: [], monthDay: 1 })).toBe('Every month on the 1st');
    expect(describeRule({ freq: 'month', every: 3, days: [], monthDay: 22 })).toBe('Every 3 months on the 22nd');
    expect(describeRepeat({ rule: WEEKLY([1, 4]), time: '07:30' })).toBe('Every Mon and Thu · 7:30 AM');
  });

  it('says when the next one comes', () => {
    expect(nextWhen(R({ made: '2026-11-02' }), NOW)).toBe('Thursday');
    expect(nextWhen(R({ made: '2026-11-02', rule: WEEKLY([2]) }), NOW)).toBe('tomorrow');
  });

  it('offers the rules that fit a task’s day, and its own when it’s none of them', () => {
    const names = repeatChoices(null, '2026-11-04').map(c => c.name);
    expect(names).toEqual(['Doesn’t repeat', 'Every day', 'Every weekday', 'Every Wednesday', 'Every other week on Wednesday', 'Every month on the 4th']);
    expect(repeatChoices(WEEKLY([1, 4]), '2026-11-02')[1]).toMatchObject({ key: 'cur', name: 'Every Mon and Thu' });
  });
});

describe('the keyword parser', () => {
  const one = (s: string) => {
    const r = localParse(s, NOW);
    expect(r).toHaveLength(1);
    return r[0];
  };

  it('reads weekdays to repeat on, and leaves them out of the title', () => {
    expect(one('order groceries every Monday and Thursday')).toMatchObject({ title: 'Order groceries', date: null, time: null, repeat: WEEKLY([1, 4]) });
    expect(one('gym every mon wed fri at 7am')).toMatchObject({ title: 'Gym', date: null, time: '07:00', repeat: WEEKLY([1, 3, 5]) });
    expect(one('gym mondays and thursdays')).toMatchObject({ title: 'Gym', repeat: WEEKLY([1, 4]) });
    expect(one('call mum every sunday evening')).toMatchObject({ title: 'Call mum', time: '18:30', repeat: WEEKLY([0]) });
    expect(one('team sync every other week on Tuesday')).toMatchObject({ title: 'Team sync', repeat: WEEKLY([2], 2) });
  });

  it('reads days, weekdays, weeks and months', () => {
    expect(one('take vitamins daily').repeat).toEqual({ freq: 'day', every: 1, days: [], monthDay: null });
    expect(one('water the plants every 3 days')).toMatchObject({ title: 'Water the plants', repeat: { freq: 'day', every: 3 } });
    expect(one('check the inbox on weekdays')).toMatchObject({ title: 'Check the inbox', repeat: WEEKLY([1, 2, 3, 4, 5]) });
    expect(one('meditate every morning')).toMatchObject({ title: 'Meditate', time: '10:00', date: null, repeat: { freq: 'day', every: 1 } });
    expect(one('pay rent on the 1st of every month')).toMatchObject({ title: 'Pay rent', date: '2026-12-01', repeat: { freq: 'month', every: 1 } });
    expect(one('review finances every 2 weeks').repeat).toEqual(WEEKLY([], 2));
  });

  it('leaves alone a one-off on a weekday, and "daily" or "weekly" naming a thing', () => {
    expect(one('gym monday').repeat).toBeUndefined();
    expect(one('prep the daily standup notes').repeat).toBeUndefined();
    expect(one('write the weekly report by Friday').repeat).toBeUndefined();
    expect(takeRepeat('book flights')).toBeNull();
  });
});

describe('repeats in a plan', () => {
  const ids = () => { let i = 0; return () => 'new' + i++; };
  const groceries = { title: 'Order groceries', priority: 2, minutes: 15, date: null, time: null, deadline: false, notes: '', label: null, repeat: { freq: 'week', every: 1, days: ['mon', 'thu'], monthday: null } };

  it('proposes a repeat as its first one, in the backlog due that day, or on the calendar at its time', () => {
    const out = applyCapture({ text: 'groceries mon thu', tasks: [], refs: new Map(), result: { add: [groceries], update: [] }, via: 'ai', now: NOW, newId: ids() });
    expect(out.puts[0]).toMatchObject({ start: null, due: '2026-11-02' });
    const [c] = changesOf(out);
    expect(c.repeat).toEqual(WEEKLY([1, 4]));
    const gym = applyCapture({ text: 'gym', tasks: [], refs: new Map(), result: { add: [{ ...groceries, title: 'Gym', time: '7:00', repeat: { freq: 'week', every: 1, days: ['wed'], monthday: null } }], update: [] }, via: 'ai', now: NOW, newId: ids() });
    expect(gym.puts[0]).toMatchObject({ start: at(10, 4, 7), due: null });
  });

  it('starts it on apply: today’s written now with the repeat’s id, a later first one left for its day', () => {
    const [c] = changesOf(applyCapture({ text: 'x', tasks: [], refs: new Map(), result: { add: [groceries], update: [] }, via: 'ai', now: NOW, newId: ids() }));
    const out = commitChanges([c], () => undefined, NOW, [], [], () => 'rnew');
    expect(out.ops).toEqual([{ kind: 'set', repeat: expect.objectContaining({ id: 'rnew', from: '2026-11-02', made: '2026-11-02', time: null, rule: WEEKLY([1, 4]) }) }]);
    expect(out.puts).toEqual([expect.objectContaining({ id: 'rnew.2026-11-02', due: '2026-11-02' })]);
    expect(out.summary).toBe('Every Mon and Thu · from today');

    const later = commitChanges([{ ...c, after: { ...c.after, start: at(10, 4, 7), due: null }, repeat: WEEKLY([3]) }], () => undefined, NOW, [], [], () => 'rgym');
    expect(later.puts).toEqual([]);
    expect(later.ops[0]).toMatchObject({ repeat: { from: '2026-11-04', made: '2026-11-03', time: '07:00' } });
    expect(later.summary).toBe('Every Wednesday · 7:00 AM · from Wednesday');
  });

  it('changes how one repeats, stops it, or makes a task you have repeat', () => {
    const occ = occurrence(R(), '2026-11-02', NOW);
    const get = (id: string) => (id === occ.id ? occ : id === 'p' ? task({ id: 'p' }) : undefined);
    const change = commitChanges([{ id: occ.id, before: occ, after: occ, repeat: WEEKLY([2, 5]) }], get, NOW, [], [R()]);
    expect(change.ops).toEqual([{ kind: 'set', repeat: expect.objectContaining({ id: 'rgroc', rule: WEEKLY([2, 5]), time: null }) }]);
    expect(change.puts).toEqual([]);
    expect(change.summary).toBe('1 updated');

    const stop = commitChanges([{ id: occ.id, before: occ, after: occ, repeat: null }], get, NOW, [], [R()]);
    expect(stop.ops).toEqual([{ kind: 'stop', id: 'rgroc' }]);
    expect(stop.summary).toBe('Stopped repeating');

    const p = task({ id: 'p' });
    const conv = commitChanges([{ id: 'p', before: p, after: p, repeat: WEEKLY([1]) }], get, NOW, [], [], () => 'rp');
    expect(conv.removes).toEqual(['p']);
    expect(conv.puts).toEqual([expect.objectContaining({ id: 'rp.2026-11-02' })]);
    expect(conv.ops[0]).toMatchObject({ kind: 'set', repeat: { id: 'rp', made: '2026-11-02' } });
  });

  it('sends the repeat back to the model when it revises the draft', () => {
    const occ = occurrence(R(), '2026-11-02', NOW);
    const d = draftOf([
      { id: 'n', before: null, after: task({ id: 'n', due: '2026-11-02' }), repeat: WEEKLY([1, 4]) },
      { id: occ.id, before: occ, after: occ, repeat: null },
    ], new Map([[occ.id, 'T1']]));
    expect(d.add[0]).toMatchObject({ date: '2026-11-02', time: null, deadline: false, repeat: { freq: 'week', every: 1, days: ['mon', 'thu'], monthday: null } });
    expect(d.update).toEqual([{ ref: 'T1', stop_repeat: true }]);
  });

  it('lets a stop only for a repeat’s task', () => {
    const t = task({ id: 'x' });
    const out = applyCapture({ text: 'x', tasks: [t], refs: new Map([['T1', 'x']]), result: { add: [], update: [{ ref: 'T1', stop_repeat: true }] }, via: 'ai', now: NOW, ruleOf: () => null });
    expect(out.puts).toEqual([]);
  });

  it('leaves out a repeat a task has already, and one for a pulled Google item', () => {
    const occ = occurrence(R(), '2026-11-02', NOW);
    const g = task({ id: 'g', externalId: 'gcal:c:e', start: at(10, 2, 15) });
    const refs = new Map([['T1', occ.id], ['T2', 'g']]);
    const repeat = { freq: 'week', every: 1, days: ['mon', 'thu'], monthday: null };
    const out = applyCapture({ text: 'x', tasks: [occ, g], refs, result: { add: [], update: [{ ref: 'T1', repeat }, { ref: 'T2', repeat }] }, via: 'ai', now: NOW, ruleOf: id => (id === occ.id ? R().rule : null) });
    expect(out.puts).toEqual([]);
    expect(changesOf(out)).toEqual([]);
  });
});

describe('the review', () => {
  it('counts a repeat the next one replaced as missed on its day', () => {
    const slip = dueNow([R()], [occurrence(R(), '2026-10-29', 0)], NOW).slips[0];
    const rv = review({ tasks: [], slips: [slip], labels: [], now: NOW }, periodOf('day', at(9, 29, 12)));
    expect(rv.outcomes.missed).toBe(1);
    expect(rv.lists.missed[0]).toMatchObject({ id: 'rgroc.2026-10-29', slot: false, how: 'replaced' });
    expect(rv.buckets.reduce((n, b) => n + b.missed, 0)).toBe(0);
    expect(occurrenceId('rgroc', '2026-10-29')).toBe(slip.id);
  });
});
