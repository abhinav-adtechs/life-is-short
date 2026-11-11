import { describe, expect, it } from 'vitest';
import { dayIn, dayStart, isoIn, parseWhen, validDay, zoneOr } from './when';

describe('times in your zone', () => {
  it('shows an instant on your clock, with its offset', () => {
    const ms = Date.parse('2026-11-11T10:30:00Z');
    expect(isoIn(ms, 'Asia/Kolkata')).toBe('2026-11-11T16:00:00+05:30');
    expect(isoIn(ms, 'America/New_York')).toBe('2026-11-11T05:30:00-05:00');
    expect(isoIn(ms, 'UTC')).toBe('2026-11-11T10:30:00+00:00');
    expect(dayIn(Date.parse('2026-11-11T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-12');
  });

  it('reads a time without an offset on your clock, and one with an offset as that instant', () => {
    expect(parseWhen('2026-11-12T09:00', 'America/New_York')).toBe(Date.parse('2026-11-12T14:00:00Z'));
    expect(parseWhen('2026-07-12 09:00:30', 'America/New_York')).toBe(Date.parse('2026-07-12T13:00:30Z'));
    expect(parseWhen('2026-11-12T09:00:00+05:30', 'America/New_York')).toBe(Date.parse('2026-11-12T03:30:00Z'));
    expect(parseWhen('2026-11-12T09:00Z', 'Asia/Kolkata')).toBe(Date.parse('2026-11-12T09:00:00Z'));
    for (const bad of ['tomorrow', '2026-11-12', '2026-13-01T09:00', '2026-11-12T25:00', '']) expect(parseWhen(bad, 'UTC')).toBeNull();
  });

  it('gets midnight right across a change of clocks', () => {
    // US clocks went back on 1 November 2026.
    expect(dayStart('2026-10-31', 'America/New_York')).toBe(Date.parse('2026-10-31T04:00:00Z'));
    expect(dayStart('2026-11-01', 'America/New_York')).toBe(Date.parse('2026-11-01T04:00:00Z'));
    expect(dayStart('2026-11-02', 'America/New_York')).toBe(Date.parse('2026-11-02T05:00:00Z'));
  });

  it('only takes real dates and known zones', () => {
    expect(validDay('2026-02-28')).toBe('2026-02-28');
    expect(validDay('2026-02-30')).toBeNull();
    expect(zoneOr('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(zoneOr('Mars/Olympus')).toBe('UTC');
    expect(zoneOr(null)).toBe('UTC');
  });
});
