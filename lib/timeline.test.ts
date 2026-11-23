import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import type { Slip } from './slips';
import { dayLine, type Row } from './timeline';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const FROM = at(20, 0), TO = at(21, 0);
const HOURS: [number, number] = [9, 21];

let n = 0;
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: 't' + n++, title, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});
const event = (title: string, start: number, minutes = 30) => task(title, { start, minutes, externalId: `gcal:work:${title}` });

/** The rows as short strings, to read a day at a glance. */
const shape = (rows: Row[]) => rows.map(r => {
  if (r.type === 'entry') return `${r.entry.task.title}:${r.entry.state}${r.entry.point ? '·point' : ''}`;
  if (r.type === 'free') return `free ${new Date(r.from).getHours()}:${String(new Date(r.from).getMinutes()).padStart(2, '0')}–${new Date(r.to).getHours()}:${String(new Date(r.to).getMinutes()).padStart(2, '0')}`;
  return `now until ${r.until == null ? 'end' : `${new Date(r.until).getHours()}:${String(new Date(r.until).getMinutes()).padStart(2, '0')}`}`;
});

describe('dayLine', () => {
  it('puts today in order with what is done, missed, on now and next, and the free time still to come', () => {
    const tasks = [
      task('Write the brief', { start: at(20, 9), minutes: 60, status: 'done', doneAt: at(20, 9, 50) }),
      task('Call the bank', { start: at(20, 10), minutes: 30 }),
      task('Fix the crash', { start: at(20, 10, 30), minutes: 60 }),
      event('Standup', at(20, 12)),
      task('Record episode 1', { start: at(20, 14, 30), minutes: 90 }),
      task('Tomorrow’s thing', { start: at(21, 10) }),
    ];
    const line = dayLine({ tasks, now: at(20, 10, 40), from: FROM, to: TO, hours: HOURS });
    expect(shape(line.rows)).toEqual([
      'Write the brief:done', 'Call the bank:missed', 'Fix the crash:now',
      'free 11:30–12:00', 'Standup:next', 'free 12:30–14:30', 'Record episode 1:later', 'free 16:00–21:00',
    ]);
    // 10:40 to 9 PM, less the rest of the crash fix, the standup and the recording.
    expect(line.booked).toBe(50 + 30 + 90);
    expect(line.free).toBe(620 - 170);
  });

  it('marks now between things when nothing is on, free until the next thing that takes time', () => {
    const tasks = [
      task('Early run', { start: at(20, 7), minutes: 45, status: 'done', doneAt: at(20, 7, 50) }),
      task('Finished early', { start: at(20, 12), status: 'done', doneAt: at(20, 10) }),
      task('Review the PR', { start: at(20, 14) }),
    ];
    const line = dayLine({ tasks, now: at(20, 10, 40), from: FROM, to: TO, hours: HOURS });
    expect(shape(line.rows)).toEqual(['Early run:done', 'now until 14:00', 'Finished early:done', 'Review the PR:next', 'free 14:30–21:00']);
  });

  it('says the rest of the day is free when nothing else is on, and only counts free time inside your day', () => {
    const tasks = [task('Late call', { start: at(20, 22), minutes: 60, externalId: 'gcal:work:late' })];
    const line = dayLine({ tasks, now: at(20, 19), from: FROM, to: TO, hours: HOURS });
    expect(shape(line.rows)).toEqual(['now until 22:00', 'Late call:next']);
    expect(line.free).toBe(120);
    expect(line.booked).toBe(0);
    const empty = dayLine({ tasks: [], now: at(20, 19), from: FROM, to: TO, hours: HOURS });
    expect(shape(empty.rows)).toEqual(['now until end']);
  });

  it('shows a task ticked off without a time at the moment it was done, and a repeat still to come', () => {
    const tasks = [task('Send the rent', { status: 'done', doneAt: at(20, 9, 30) }), task('Not today', { status: 'done', doneAt: at(19, 9) })];
    const upcoming = [task('Training run', { start: at(20, 18, 30), minutes: 45 })];
    const line = dayLine({ tasks, upcoming, now: at(20, 10), from: FROM, to: TO, hours: HOURS });
    expect(shape(line.rows)).toEqual(['Send the rent:done·point', 'now until 18:30', 'Training run:next', 'free 19:15–21:00']);
    expect(line.rows.find(r => r.type === 'entry' && r.entry.kind === 'repeat')).toMatchObject({ entry: { key: `rep:${upcoming[0].id}` } });
  });

  it('calls an event over once it ends and on now while it runs, and never missed', () => {
    const tasks = [event('Standup', at(20, 9)), event('Design review', at(20, 10, 30), 60)];
    const line = dayLine({ tasks, now: at(20, 10, 40), from: FROM, to: TO, hours: HOURS });
    expect(shape(line.rows)).toEqual(['Standup:over', 'Design review:now', 'free 11:30–21:00']);
  });

  it('skips free time too short to use', () => {
    const tasks = [task('A', { start: at(20, 11) }), task('B', { start: at(20, 11, 40) }), task('C', { start: at(20, 13) })];
    const line = dayLine({ tasks, now: at(20, 11, 10), from: FROM, to: TO, hours: HOURS, minFree: 15 });
    expect(shape(line.rows)).toEqual(['A:now', 'B:next', 'free 12:10–13:00', 'C:later', 'free 13:30–21:00']);
  });

  it('keeps what is today’s with no time beside the line: overdue, due today, then the plan’s steps', () => {
    const plan = task('Submit the build', { priority: 1 });
    const due = task('Register for the race', { due: '2026-11-20', priority: 1 });
    const late = task('Renew the insurance', { due: '2026-11-18', priority: 2 });
    const allDay = task('Mum’s birthday', { due: '2026-11-20', externalId: 'gcal:home:bday' });
    const oldAllDay = task('Last week’s holiday', { due: '2026-11-13', externalId: 'gcal:home:hol' });
    const later = task('Plan the meals', { due: '2026-11-25' });
    const doneDue = task('Paid it', { due: '2026-11-20', status: 'done', doneAt: at(19, 9) });
    const timedStep = task('Fix the crash', { start: at(20, 10, 30), minutes: 60 });
    const line = dayLine({
      tasks: [plan, due, late, allDay, oldAllDay, later, doneDue, timedStep], now: at(20, 10), from: FROM, to: TO, hours: HOURS,
      planSteps: [plan.id, timedStep.id],
    });
    expect(line.anytime.map(a => `${a.task.title}:${a.why}`)).toEqual([
      'Renew the insurance:overdue', 'Register for the race:due', 'Mum’s birthday:due', 'Submit the build:plan',
    ]);
  });

  it('runs on a day that isn’t today without a now row, counting free time from the day’s start', () => {
    const tasks = [task('Pair with Jo', { start: at(22, 11), minutes: 60 })];
    const line = dayLine({ tasks, now: at(20, 10), from: at(22, 0), to: at(23, 0), hours: HOURS });
    expect(shape(line.rows)).toEqual(['free 9:00–11:00', 'Pair with Jo:next', 'free 12:00–21:00']);
    expect(line.free).toBe(720 - 60);
  });

  it('puts what you missed today and is back in the backlog on the line once, at its last missed slot, to tick off or slot again', () => {
    const lawyers = task('Pay the lawyers', { goal: 'gexit' });
    const terms = task('Review heads of terms', { goal: 'gexit' });
    const later = task('Review the proposal', { start: at(20, 16, 15), minutes: 60 });
    const wednesday = task('Verify the undertaking', { start: at(25, 11, 15) });
    const doneSince = task('Confirm the quote', { status: 'done', doneAt: at(20, 13) });
    const restored = task('Fix the crash', { start: at(20, 9) });
    const slip = (t: Pick<Task, 'id' | 'title'>, start: number, extra: Partial<Slip> = {}): Slip => ({
      id: t.id, start, minutes: 15, title: t.title, label: null, priority: 2, at: start + 90 * 60000, how: 'moved', ...extra,
    });
    const slips = [
      // Missed twice today, back in the backlog both times: once, at 2:45.
      slip(lawyers, at(20, 11, 15)), slip(lawyers, at(20, 14, 45)),
      slip(terms, at(20, 14), { minutes: 30 }),
      // Moved to later today: it's on the line at its new time. Moved to another day: not today's any more.
      slip(later, at(20, 12, 15)), slip(wednesday, at(20, 11, 30)),
      // Ticked off since (it's on the line where you did it), deleted, or replaced by the next of its repeat.
      slip(doneSince, at(20, 12)), slip({ id: 'gone', title: 'Old errand' }, at(20, 9, 30), { how: 'dropped' }),
      // Undone: the task is back on the slot, so the task itself is the entry.
      slip(restored, at(20, 9)),
      // Another day's, and one that was due on the day rather than at a time.
      slip(terms, at(19, 12)), slip({ id: terms.id, title: 'x' }, at(20, 0), { due: true }),
    ];
    const line = dayLine({ tasks: [lawyers, terms, later, wednesday, doneSince, restored], slips, now: at(20, 15, 40), from: FROM, to: TO, hours: HOURS });
    expect(shape(line.rows)).toEqual([
      'Fix the crash:missed', 'Confirm the quote:done·point', 'Review heads of terms:missed', 'Pay the lawyers:missed',
      'now until 16:15', 'Review the proposal:next', 'free 17:15–21:00',
    ]);
    const missed = line.rows.flatMap(r => (r.type === 'entry' && r.entry.slipped ? [r.entry] : []));
    expect(missed.map(e => [e.task, e.slipped, e.key, e.end - e.at])).toEqual([
      [terms, 1, `slip:${terms.id}`, 30 * 60000], [lawyers, 2, `slip:${lawyers.id}`, 15 * 60000],
    ]);
    // A missed slot doesn't take up time, and the backlog's missed tasks aren't also listed as having no slot.
    expect(line.booked).toBe(60);
    expect(line.anytime).toEqual([]);
  });

  it('counts each of today’s tasks once, done or not: on the line, missed, to come and with no time, but not events', () => {
    const doneEarly = task('Brief', { start: at(20, 9), status: 'done', doneAt: at(20, 9, 40) });
    const slipped = task('Guests', { status: 'done', doneAt: at(20, 13) });
    const open = task('Record', { start: at(20, 15) });
    const due = task('Register', { due: '2026-11-20' });
    const line = dayLine({
      tasks: [doneEarly, slipped, open, due, event('Standup', at(20, 10)), task('Mum’s birthday', { due: '2026-11-20', externalId: 'gcal:home:b' })],
      upcoming: [task('Training run', { start: at(20, 18, 30) })],
      slips: [{ id: slipped.id, start: at(20, 12), minutes: 30, title: 'Guests', label: null, priority: 2, at: at(20, 13), how: 'moved' },
        { id: open.id, start: at(20, 11), minutes: 30, title: 'Record', label: null, priority: 2, at: at(20, 12), how: 'moved' }],
      now: at(20, 14), from: FROM, to: TO, hours: HOURS,
    });
    expect(line.tally).toEqual({ done: 2, total: 5 });
  });
});
