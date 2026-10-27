import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from './model';
import type { Label } from './labels';
import type { Slip } from './slips';
import { setClock24 } from './format';
import { hourRange, periodName, periodOf, review, shiftPeriod, type ReviewInput } from './review';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
// Tuesday 27 Oct 2026, 15:00 local. Its week (from Monday) runs 26 Oct to 1 Nov.
const NOW = at(27, 15);
const LABELS: Label[] = [{ id: 'work', name: 'Work', color: '#3E63DD' }, { id: 'personal', name: 'Personal', color: '#12A594' }];

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: at(20, 9), order: 0, doneAt: null, ...extra,
});
const slip = (id: string, start: number, extra: Partial<Slip> = {}): Slip => ({
  id, start, minutes: 30, title: id, label: 'work', priority: 2, at: start + 3600000, how: 'moved', ...extra,
});

const TASKS: Task[] = [
  task('t1', { label: 'work', priority: 1, start: at(26, 10), minutes: 60, status: 'done', doneAt: at(26, 11) }),
  task('t2', { label: 'work', priority: 1, start: at(26, 14) }),
  task('t3', { label: 'personal', start: at(26, 9), status: 'done', doneAt: at(27, 10) }),
  task('t4', { label: 'personal', due: '2026-10-27' }),
  task('t5', { label: 'work', priority: 3, due: '2026-10-26' }),
  task('t6', { label: 'work', start: at(28, 9), minutes: 45 }),
  task('t7', { label: 'personal', priority: 3, status: 'done', doneAt: at(27, 12), created: at(27, 11) }),
  task('t8', { label: 'work', start: at(29, 9) }),
  task('t9', { label: 'work', minutes: 60, status: 'done', doneAt: at(23, 17) }),
  // Google events: one over (on a calendar labelled Work), one still to come.
  task('e1', { externalId: 'gcal:cal:e1', start: at(26, 16), minutes: 60 }),
  task('e2', { externalId: 'gcal:cal:e2', start: at(28, 10), minutes: 60 }),
];
const SLIPS: Slip[] = [
  slip('t8', at(26, 9, 30)),
  // t2 still sits on this slot, so the task tells it.
  slip('t2', at(26, 14), { priority: 1 }),
  slip('gone', at(25, 10), { how: 'dropped' }),
];
const input = (extra: Partial<ReviewInput> = {}): ReviewInput => ({
  tasks: TASKS, slips: SLIPS, labels: LABELS, now: NOW,
  labelOf: t => (t.externalId ? 'work' : t.label ?? null), ...extra,
});
const week = periodOf('week', NOW);

describe('periods', () => {
  it('finds the day, week and month around a time', () => {
    expect(periodOf('day', NOW)).toEqual({ span: 'day', start: at(26 + 1, 0), end: at(28, 0) });
    expect(week).toEqual({ span: 'week', start: at(26, 0), end: new Date(2026, 10, 2).getTime() });
    expect(periodOf('week', NOW, 0).start).toBe(at(25, 0));
    expect(periodOf('month', NOW)).toEqual({ span: 'month', start: at(1, 0), end: new Date(2026, 10, 1).getTime() });
  });

  it('steps back and forward', () => {
    expect(shiftPeriod(week, -1).start).toBe(at(19, 0));
    expect(shiftPeriod(periodOf('month', new Date(2026, 0, 31).getTime()), 1).start).toBe(new Date(2026, 1, 1).getTime());
    expect(shiftPeriod(periodOf('day', NOW), 6).start).toBe(new Date(2026, 10, 2).getTime());
  });

  it('names them', () => {
    expect(periodName(week, NOW)).toEqual({ title: 'This week', sub: '26 Oct – 1 Nov' });
    expect(periodName(shiftPeriod(week, -1), NOW).title).toBe('Last week');
    expect(periodName(shiftPeriod(week, -2), NOW).title).toBe('Week of 12 Oct');
    expect(periodName(week, NOW, { weekNumbers: true }).sub).toBe('26 Oct – 1 Nov · Week 44');
    expect(periodName(periodOf('day', NOW), NOW)).toEqual({ title: 'Tuesday, 27 October', sub: 'Today' });
    expect(periodName(periodOf('month', NOW), NOW)).toEqual({ title: 'October 2026', sub: 'This month' });
  });
});

describe('review of a week', () => {
  const r = review(input(), week);

  it('sorts what came due into on time, late, missed and still to come', () => {
    // t1 on time; t3 late; t2, t5 and t8's first slot missed; t4, t6 and t8's new slot to come.
    expect(r.outcomes).toEqual({ onTime: 1, late: 1, missed: 3, pending: 3 });
    expect(r.completion).toBeCloseTo(2 / 5);
    expect(r.onTimeRate).toBeCloseTo(1 / 5);
    expect(r.lists.missed.map(i => [i.id, i.how])).toEqual([['t5', 'open'], ['t8', 'moved'], ['t2', 'open']]);
    expect(r.lists.late.map(i => i.id)).toEqual(['t3']);
    expect(r.lists.pending.map(i => i.id)).toEqual(['t4', 't6', 't8']);
  });

  it('counts time done and meetings held', () => {
    expect(r.done).toEqual({ count: 3, minutes: 120 });
    expect(r.held).toEqual({ count: 1, minutes: 60 });
    expect(r.lists.done.map(i => i.id)).toEqual(['t1', 't3', 't7']);
    expect(r.sources.own).toEqual({ count: 3, minutes: 120 });
    expect(r.sources.gcal).toEqual({ count: 1, minutes: 60 });
    expect(r.sizes).toEqual({ quick: { count: 2, minutes: 60 }, medium: { count: 1, minutes: 60 }, deep: { count: 0, minutes: 0 } });
  });

  it('splits the time by type of work', () => {
    expect(r.labels.map(l => [l.id, l.done.minutes, l.held.minutes, Math.round(l.share * 100)])).toEqual([['work', 60, 60, 67], ['personal', 60, 0, 33]]);
    expect(r.labels[0].outcomes).toEqual({ onTime: 1, late: 0, missed: 3, pending: 2 });
  });

  it('scores it', () => {
    // Done 2/5 (40), on time 1/5 (20), steady 2 of 2 busy days (20), Urgent and Important 3 of 6 weighted (20).
    expect(r.score?.parts.map(p => [p.id, +p.value.toFixed(2)])).toEqual([['completion', 0.4], ['onTime', 0.2], ['steady', 1], ['priorities', 0.5]]);
    expect(r.score?.value).toBe(50);
    expect(r.score?.grade).toBe('Mixed');
  });

  it('charts the days and the hours', () => {
    expect(r.buckets).toHaveLength(7);
    expect(r.buckets[0]).toMatchObject({ minutes: 120, done: 1, held: 1, missed: 3, byLabel: { work: 120 } });
    expect(r.buckets[1]).toMatchObject({ minutes: 60, done: 2, byLabel: { personal: 60 } });
    expect(r.best?.start).toBe(at(26, 0));
    // t1 in its slot at 10; t3 ticked off a day late, so the half hour before 10; t7 the half hour before noon.
    expect(r.hours[10]).toBe(60);
    expect(r.hours[9]).toBe(30);
    expect(r.hours[11]).toBe(30);
    expect(r.peakHour).toBe(10);
    expect(r.weekdays.slice(1, 3)).toEqual([60, 60]);
  });

  it('measures load, flow and the backlog', () => {
    // Slots in the week, the slot t8 missed included, against 12-hour days.
    expect(r.load).toEqual({ planned: 60 + 30 + 30 + 45 + 30 + 60 + 60 + 30, capacity: 7 * 12 * 60 });
    expect(r.created).toBe(1);
    expect(r.leadTime).toBe(at(26, 11) - at(20, 9));
    expect(r.backlog).toEqual({ open: 2, minutes: 60, overdue: 1, missed: 1, oldest: at(20, 9) });
  });

  it('still counts a missed slot once the task is back in the backlog', () => {
    // t2 missed Monday 14:00 and went back to the backlog: its slip says so.
    const back = review(input({ tasks: TASKS.map(t => (t.id === 't2' ? { ...t, start: null } : t)) }), week);
    expect(back.outcomes).toEqual(r.outcomes);
    expect(back.lists.missed.map(i => [i.id, i.how])).toEqual([['t5', 'open'], ['t8', 'moved'], ['t2', 'moved']]);
    expect(back.backlog).toMatchObject({ open: 3, missed: 1 });
  });

  it('holds a week under way up against the week before up to the same point', () => {
    // Monday 19 Oct to Tuesday 20 Oct, 15:00: t9 (Friday) and the slip on Sunday come later.
    expect(r.compared).toEqual({ vs: 'this point last week', than: 'by this point last week' });
    expect(r.prev.period).toEqual({ span: 'week', start: at(19, 0), end: at(20, 15) });
    expect(r.prev.done.count).toBe(0);
    expect(r.trend).toHaveLength(8);
    expect(r.trend[7].period).toEqual(week);
    expect(r.trend[6].done).toEqual({ count: 1, minutes: 60 });
    expect(r.trend[6].outcomes.missed).toBe(1);
  });

  it('holds a week that’s over against the whole week before', () => {
    const last = review(input(), shiftPeriod(week, -1));
    expect(last.compared.vs).toBe('the week before');
    expect(last.prev).toBe(last.trend[6]);
    expect(last.insights[0]).toBe('You finished 1 task, 1 more than the week before.');
  });

  it('says what it found', () => {
    expect(r.insights).toEqual([
      'You finished 3 tasks, 3 more than by this point last week.',
      '3 tasks missed their slot or deadline, 1 of them Urgent.',
      'Work took the most time: 2 h, 67% of it.',
      'Your fullest day was Monday: 2 h of work.',
      'You get the most done from 10 to 11 AM.',
      'Meetings took 1 h, 33% of your time.',
      'You added 1 task and finished 3: the list shrank by 2.',
      'A typical task went from capture to done in 6 d.',
    ]);
  });
});

describe('review of a day', () => {
  it('spreads time over the hours it took and marks missed slots', () => {
    const r = review(input(), periodOf('day', at(26, 12)));
    expect(r.buckets).toHaveLength(24);
    expect(r.buckets[10].minutes).toBe(60);
    expect(r.buckets[16]).toMatchObject({ minutes: 60, held: 1 });
    expect(r.buckets[14].missed).toBe(1);
    expect(r.buckets[9].missed).toBe(1);
    // t5's deadline has a day but no hour.
    expect(r.buckets.reduce((s, b) => s + b.missed, 0)).toBe(2);
    expect(r.outcomes.missed).toBe(3);
  });

  it('keeps an event running past midnight in its last hour', () => {
    const r = review(input({ tasks: [task('e', { externalId: 'gcal:c:e', start: at(25, 23, 30), minutes: 60 })] }), periodOf('day', at(25, 12)));
    expect(r.buckets[23].minutes).toBe(60);
  });
});

describe('quiet and future periods', () => {
  it('says so, with no score', () => {
    const quiet = review(input(), periodOf('week', at(5, 12)));
    expect(quiet.score).toBeNull();
    expect(quiet.insights).toEqual(['A quiet week: nothing came due and nothing was ticked off.']);
    const ahead = review(input(), shiftPeriod(week, 2));
    expect(ahead.insights).toEqual(['This week hasn’t started yet.']);
  });

  it('says when nothing has happened yet in a period under way', () => {
    const r = review(input({ tasks: [task('later', { start: at(29, 9) })], slips: [] }), week);
    expect(r.score).toBeNull();
    expect(r.insights).toEqual(['Nothing has come due or been ticked off yet this week. 1 still to come.']);
  });
});

describe('streaks', () => {
  const done = (d: number) => task('d' + d, { status: 'done', doneAt: at(d, 12) });

  it('counts days in a row, and today isn’t over yet', () => {
    const r = review(input({ tasks: [done(22), done(24), done(25), done(26)], slips: [] }), week);
    expect(r.streak).toBe(3);
    expect(r.bestRun).toBe(1);
  });

  it('ends a past period’s streak on its last day', () => {
    const r = review(input({ tasks: [done(17), done(18), done(19), done(20)], slips: [] }), periodOf('week', at(20, 12)));
    expect(r.streak).toBe(0);
    expect(r.bestRun).toBe(2);
    expect(review(input({ tasks: [done(24), done(25)], slips: [] }), periodOf('week', at(20, 12))).streak).toBe(2);
  });
});

describe('hourRange', () => {
  afterEach(() => setClock24(false));

  it('names an hour of the day', () => {
    expect(hourRange(10)).toBe('10 to 11 AM');
    expect(hourRange(11)).toBe('11 AM to noon');
    expect(hourRange(12)).toBe('noon to 1 PM');
    expect(hourRange(23)).toBe('11 PM to midnight');
    setClock24(true);
    expect(hourRange(14)).toBe('14:00 to 15:00');
  });
});
