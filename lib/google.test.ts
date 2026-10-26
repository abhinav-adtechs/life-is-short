import { describe, expect, it } from 'vitest';
import { calendarOf, mapEvent, mapTask, mergeExternal, type ExternalItem } from './google';
import type { Task } from './model';

const NOW = Date.parse('2026-10-26T13:30:00+05:30');

describe('mapEvent', () => {
  it('maps a timed event to a scheduled item, rounded to 15 minutes', () => {
    expect(mapEvent({ id: 'e1', summary: ' Design  review ', description: 'Agenda<br>Notes', start: { dateTime: '2026-10-27T10:00:00+05:30' }, end: { dateTime: '2026-10-27T10:50:00+05:30' } }, 'me@x.com', NOW))
      .toEqual({ externalId: 'gcal:me@x.com:e1', source: 'gcal', title: 'Design review', notes: 'Agenda\nNotes', start: Date.parse('2026-10-27T10:00:00+05:30'), minutes: 45, due: null, done: false, uid: null });
  });

  it('marks events that already ended as done', () => {
    expect(mapEvent({ id: 'e', start: { dateTime: '2026-10-26T09:00:00+05:30' }, end: { dateTime: '2026-10-26T10:00:00+05:30' } }, 'c', NOW)?.done).toBe(true);
  });

  it('turns a one-day all-day event into a due date and skips multi-day ones', () => {
    expect(mapEvent({ id: 'a', summary: 'Tax filing', start: { date: '2026-10-30' }, end: { date: '2026-10-31' } }, 'c', NOW))
      .toMatchObject({ start: null, due: '2026-10-30' });
    expect(mapEvent({ id: 'b', summary: 'Trip', start: { date: '2026-11-02' }, end: { date: '2026-11-06' } }, 'c', NOW)).toBeNull();
  });

  it('skips cancelled and declined events', () => {
    expect(mapEvent({ id: 'x', status: 'cancelled' }, 'c', NOW)).toBeNull();
    expect(mapEvent({ id: 'y', start: { dateTime: '2026-10-27T10:00:00Z' }, attendees: [{ self: true, responseStatus: 'declined' }] }, 'c', NOW)).toBeNull();
  });
});

describe('mapTask', () => {
  it('maps a Google Task to a backlog item with a due date', () => {
    expect(mapTask({ id: 't1', title: 'Pay rent', due: '2026-11-01T00:00:00.000Z', status: 'needsAction' }))
      .toEqual({ externalId: 'gtask:t1', source: 'gtask', title: 'Pay rent', notes: '', start: null, minutes: 30, due: '2026-11-01', done: false });
    expect(mapTask({ id: 't2', title: '  ' })).toBeNull();
    expect(mapTask({ id: 't3', title: 'x', deleted: true })).toBeNull();
  });
});

describe('mergeExternal', () => {
  const item = (o: Partial<ExternalItem>): ExternalItem => ({ externalId: 'gcal:c:e1', source: 'gcal', title: 'Standup', notes: '', start: NOW + 3600000, minutes: 30, due: null, done: false, ...o });
  const existing: Task = { id: 'k', title: 'Standup', raw: '', notes: 'mine', priority: 1, minutes: 30, start: NOW + 3600000, due: null, status: 'open', created: 1, order: 1, doneAt: null, externalId: 'gcal:c:e1' };
  let n = 0;
  const ids = () => 'g' + n++;

  it('adds new items once', () => {
    const r = mergeExternal([], [item({}), item({ externalId: 'gtask:1', source: 'gtask', start: null, title: 'Buy gift' })], NOW, ids);
    expect(r.added).toBe(2);
    expect(r.puts[0]).toMatchObject({ title: 'Standup', start: NOW + 3600000, priority: 2, externalId: 'gcal:c:e1', status: 'open' });
  });

  it('updates time and title from Google but keeps priority and notes', () => {
    const r = mergeExternal([existing], [item({ title: 'Daily standup', start: NOW + 7200000, minutes: 45 })], NOW, ids);
    expect(r.updated).toBe(1);
    expect(r.puts[0]).toMatchObject({ id: 'k', title: 'Daily standup', start: NOW + 7200000, minutes: 45, priority: 1, notes: 'mine' });
  });

  it('does nothing when nothing changed', () => {
    expect(mergeExternal([existing], [item({})], NOW, ids)).toEqual({ puts: [], added: 0, updated: 0, ticked: 0 });
  });

  it('ticks off a Google Task completed in Google, and ignores ones completed before we saw them', () => {
    const t = { ...existing, externalId: 'gtask:9', start: null };
    const r = mergeExternal([t], [item({ externalId: 'gtask:9', source: 'gtask', start: null, done: true }), item({ externalId: 'gtask:10', source: 'gtask', done: true })], NOW, ids);
    expect(r.ticked).toBe(1);
    expect(r.added).toBe(0);
    expect(r.puts[0]).toMatchObject({ id: 'k', status: 'done', doneAt: NOW });
  });
});

describe('several accounts', () => {
  const NOW2 = Date.parse('2026-10-26T13:30:00+05:30');
  const meeting = (cal: string) => mapEvent({ id: 'm1', iCalUID: 'abc@google.com', summary: 'Sync', start: { dateTime: '2026-10-27T10:00:00+05:30' }, end: { dateTime: '2026-10-27T10:30:00+05:30' } }, cal, NOW2) as ExternalItem;
  let n = 0;
  const ids = () => 'h' + n++;

  it('finds the calendar in an externalId', () => {
    expect(calendarOf('gcal:me@x.com:e1')).toBe('me@x.com');
    expect(calendarOf('gcal:en.indian#holiday@group.v.calendar.google.com:20261102_x')).toBe('en.indian#holiday@group.v.calendar.google.com');
    expect(calendarOf('gtask:1')).toBeNull();
    expect(calendarOf(null)).toBeNull();
  });

  it('lands a meeting on two accounts once', () => {
    const r = mergeExternal([], [meeting('work@x.com'), meeting('me@gmail.com')], NOW2, ids);
    expect(r.added).toBe(1);
    expect(r.puts[0].externalId).toBe('gcal:work@x.com:m1');
  });

  it('keeps the copy already in the planner when a second account shows the same meeting', () => {
    const had = { ...mergeExternal([], [meeting('me@gmail.com')], NOW2, ids).puts[0] };
    const r = mergeExternal([had], [meeting('work@x.com'), meeting('me@gmail.com')], NOW2, ids);
    expect(r).toMatchObject({ added: 0, updated: 0, puts: [] });
  });

  it('lands it once when the second account is connected later, or its twin failed to pull', () => {
    const had = mergeExternal([], [meeting('me@gmail.com')], NOW2, ids).puts[0];
    expect(mergeExternal([had], [meeting('work@x.com')], NOW2, ids)).toMatchObject({ added: 0, puts: [] });
    // A different meeting at the same time still comes in.
    const other = { ...meeting('work@x.com'), externalId: 'gcal:work@x.com:m2', title: 'Interview', uid: 'zzz|1' };
    expect(mergeExternal([had], [other], NOW2, ids).added).toBe(1);
  });

  it('keeps different instances of a repeating meeting apart', () => {
    const a = meeting('work@x.com');
    const b = { ...a, externalId: 'gcal:work@x.com:m1_2', start: (a.start as number) + 7 * 864e5, uid: `abc@google.com|${(a.start as number) + 7 * 864e5}` };
    expect(mergeExternal([], [a, b], NOW2, ids).added).toBe(2);
  });
});
