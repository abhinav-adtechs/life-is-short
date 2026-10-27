import { describe, expect, it } from 'vitest';
import { applyCapture, promptContext } from './capture';
import { focus, backlogList, backToBacklog, missedList } from './select';
import type { Task } from './model';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(26, 13, 30);

let n = 0;
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: 'id' + n++, title, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});
const ids = () => { let i = 0; return () => 'new' + i++; };

describe('applyCapture', () => {
  it('ticks off an existing task instead of adding one', () => {
    const photos = task('Get passport photos taken');
    const other = task('Book flights');
    const { refs } = promptContext([photos, other]);
    const ref = [...refs].find(([, id]) => id === photos.id)![0];
    const out = applyCapture({
      text: 'done with the passport photos', tasks: [photos, other], refs,
      result: { add: [], update: [{ ref, done: true }] }, via: 'ai', now: NOW, newId: ids(),
    });
    expect(out.added).toHaveLength(0);
    expect(out.ticked).toBe(1);
    expect(out.puts).toEqual([expect.objectContaining({ id: photos.id, status: 'done', doneAt: NOW })]);
    expect(out.before.get(photos.id)).toEqual(photos);
    expect(out.summary).toBe('1 ticked off');
  });

  it('reschedules and annotates through updates', () => {
    const t = task('Call the plumber');
    const { refs } = promptContext([t]);
    const out = applyCapture({
      text: 'move the plumber call to tomorrow at 4pm, ask about the boiler', tasks: [t], refs,
      result: { add: [], update: [{ ref: 'T1', date: '2026-10-27', time: '16:00', notes: 'Ask about the boiler' }] },
      via: 'ai', now: NOW, newId: ids(),
    });
    expect(out.puts[0]).toMatchObject({ start: at(27, 16), notes: 'Ask about the boiler' });
    expect(out.summary).toBe('1 updated');
  });

  it('adds model items through cleanItem and placeItem', () => {
    const out = applyCapture({
      text: 'call the bank tomorrow at 11, urgent', tasks: [], refs: new Map(),
      result: { add: [{ title: 'Call the bank', priority: 1, minutes: 30, date: '2026-10-27', time: '11:00', deadline: false, notes: '' }], update: [] },
      via: 'ai', now: NOW, newId: ids(),
    });
    expect(out.added[0]).toMatchObject({ id: 'new0', title: 'Call the bank', priority: 1, start: at(27, 11), due: null, raw: 'call the bank tomorrow at 11, urgent' });
    expect(out.before.get('new0')).toBeNull();
    expect(out.summary).toBe('On the calendar · Tomorrow, 11:00 AM');
  });

  it('falls back to keywords without a key and says so', () => {
    const out = applyCapture({ text: 'renew passport by Friday', tasks: [], refs: new Map(), result: null, via: 'no-key', now: NOW, newId: ids() });
    expect(out.added[0]).toMatchObject({ title: 'Renew passport', start: null, due: '2026-10-30' });
    expect(out.summary).toBe('In the backlog · Important · due friday · sorted by keywords (no AI key)');
  });

  it('falls back to keywords when the model returns nothing', () => {
    const out = applyCapture({ text: 'buy milk', tasks: [], refs: new Map(), result: { add: [], update: [] }, via: 'ai', now: NOW, newId: ids() });
    expect(out.added).toHaveLength(1);
    expect(out.via).toBe('empty');
  });

  it('ignores unknown refs', () => {
    const out = applyCapture({ text: 'x', tasks: [], refs: new Map(), result: { add: [], update: [{ ref: 'T9', done: true }] }, via: 'ai', now: NOW, newId: ids() });
    expect(out.puts).toHaveLength(0);
    expect(out.summary).toBe('Nothing to add from that');
  });

  it('slots several stated-day items around each other', () => {
    const out = applyCapture({
      text: 'two things wednesday', tasks: [], refs: new Map(),
      result: { add: [{ title: 'A', minutes: 60, date: '2026-10-28' }, { title: 'B', minutes: 60, date: '2026-10-28' }], update: [] },
      via: 'ai', now: NOW, newId: ids(),
    });
    expect(out.added.map(t => t.start)).toEqual([at(28, 9), at(28, 10)]);
  });
});

describe('focus', () => {
  it('prefers the task scheduled over now, then the next one today', () => {
    const live = task('Live', { start: at(26, 13), minutes: 60 });
    const later = task('Later today', { start: at(26, 16) });
    const tomorrow = task('Tomorrow', { start: at(27, 10) });
    const bl = task('Backlog top', { priority: 1 });
    expect(focus([live, later, tomorrow, bl], NOW)).toEqual({ now: live, live: true, next: later });
  });

  it('falls back to the backlog for both', () => {
    const a = task('A', { priority: 2, due: '2026-10-28' });
    const b = task('B', { priority: 1 });
    const c = task('C', { priority: 2 });
    const tomorrow = task('Tomorrow', { start: at(27, 10) });
    expect(focus([a, b, c, tomorrow], NOW)).toEqual({ now: b, live: false, next: a });
  });

  it('is empty when nothing is open', () => {
    expect(focus([task('x', { status: 'done' })], NOW)).toEqual({ now: null, live: false, next: null });
  });
});

describe('backlog and missed', () => {
  it('orders by priority, due date, then order', () => {
    const a = task('a', { priority: 2, order: 1 });
    const b = task('b', { priority: 2, due: '2026-11-01', order: 2 });
    const c = task('c', { priority: 1, order: 3 });
    const d = task('d', { priority: 2, due: '2026-10-28', order: 4 });
    expect(backlogList([a, b, c, d]).map(t => t.title)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('lists open scheduled tasks that already ended', () => {
    const missed = task('missed', { start: at(26, 10), minutes: 30 });
    const ongoing = task('ongoing', { start: at(26, 13), minutes: 60 });
    const done = task('done', { start: at(26, 9), status: 'done' });
    expect(missedList([missed, ongoing, done], NOW)).toEqual([missed]);
  });

  it('never counts a Google Calendar event as missed, but does a scheduled Google Task', () => {
    const meeting = task('Standup', { start: at(26, 9), externalId: 'gcal:primary:ev1' });
    const gtask = task('Expenses', { start: at(26, 11), externalId: 'gtask:abc' });
    expect(missedList([meeting, gtask], NOW)).toEqual([gtask]);
  });

  it('sends missed tasks back to the top of the backlog, the latest miss first', () => {
    const waiting = task('waiting', { order: 5 });
    const urgent = task('urgent', { priority: 1, order: 6 });
    const morning = task('morning', { start: at(26, 9), order: 7 });
    const noon = task('noon', { start: at(26, 12), order: 8 });
    const later = task('later', { start: at(26, 16), order: 9 });
    const back = backToBacklog([waiting, urgent, morning, noon, later], NOW);
    expect(back.map(t => [t.title, t.start])).toEqual([['morning', null], ['noon', null]]);
    const list = backlogList([waiting, urgent, later, ...back]);
    // Priority still comes first; the misses go ahead of the task they tie with.
    expect(list.map(t => t.title)).toEqual(['urgent', 'noon', 'morning', 'waiting']);
    expect(focus([waiting, urgent, later, ...back], NOW).now).toBe(urgent);
  });

  it('has nothing to send back when nothing was missed', () => {
    expect(backToBacklog([task('a'), task('b', { start: at(26, 16) })], NOW)).toEqual([]);
  });
});
