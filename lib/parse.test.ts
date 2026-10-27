import { describe, expect, it } from 'vitest';
import { localParse } from './parse';

// Monday 26 Oct 2026, 13:30 local.
const NOW = new Date(2026, 9, 26, 13, 30).getTime();
const one = (s: string) => {
  const r = localParse(s, NOW);
  expect(r).toHaveLength(1);
  return r[0];
};

describe('localParse', () => {
  it('runs in the pinned zone', () => {
    expect(new Date(NOW).getTimezoneOffset()).toBe(-330);
  });

  it('reads a day, a time and urgency', () => {
    expect(one('call the bank tomorrow at 11, urgent')).toEqual({
      title: 'Call the bank', priority: 1, minutes: 30,
      date: '2026-10-27', time: '11:00', deadline: false, notes: '', label: null,
    });
  });

  it('treats "by <day>" as a deadline, not a time to do it', () => {
    const r = one('renew passport by Friday');
    expect(r).toMatchObject({ title: 'Renew passport', date: '2026-10-30', time: null, deadline: true, priority: 2 });
  });

  it('makes a deadline today or tomorrow urgent', () => {
    expect(one('submit the report by eod')).toMatchObject({ deadline: true, date: '2026-10-26', priority: 1 });
    expect(one('pay rent by tomorrow')).toMatchObject({ deadline: true, date: '2026-10-27', priority: 1 });
  });

  it('reads durations', () => {
    expect(one('read the contract draft by Friday, 1 hour').minutes).toBe(60);
    expect(one('write the memo 90 mins').minutes).toBe(90);
    expect(one('quick sync for half an hour').minutes).toBe(30);
    expect(one('deep work 2h').minutes).toBe(120);
  });

  it('puts a bare time today if still ahead, else tomorrow', () => {
    expect(one('email Sam at 3')).toMatchObject({ date: '2026-10-26', time: '15:00' });
    expect(one('email Sam at 9am')).toMatchObject({ date: '2026-10-27', time: '09:00' });
    expect(one('standup at 10:15')).toMatchObject({ date: '2026-10-27', time: '10:15' });
  });

  it('reads parts of the day', () => {
    expect(one('gym this evening')).toMatchObject({ date: '2026-10-26', time: '18:30' });
    expect(one('plan the week tomorrow morning')).toMatchObject({ date: '2026-10-27', time: '10:00' });
    expect(one('lunch with Ana at noon tomorrow')).toMatchObject({ date: '2026-10-27', time: '12:00' });
  });

  it('reads weekdays, "next" and calendar dates', () => {
    expect(one('review budget wednesday').date).toBe('2026-10-28');
    expect(one('standup next monday').date).toBe('2026-11-02');
    expect(one('standup monday').date).toBe('2026-10-26');
    expect(one('dentist on 5th nov').date).toBe('2026-11-05');
    expect(one('dentist nov 5').date).toBe('2026-11-05');
    expect(one('renew lease on 2 jan').date).toBe('2027-01-02');
  });

  it('reads low priority words', () => {
    expect(one('someday learn the piano')).toMatchObject({ priority: 3, date: null, title: 'Learn the piano' });
  });

  it('splits on new lines and semicolons', () => {
    const r = localParse('call mom; buy milk\nbook flights', NOW);
    expect(r.map(x => x.title)).toEqual(['Call mom', 'Buy milk', 'Book flights']);
  });

  it('keeps the original text when stripping leaves too little', () => {
    expect(one('tomorrow').title).toBe('Tomorrow');
  });
});
