/*
 * Times for the MCP server, in your time zone rather than the server's. The planner itself works in the device's local
 * time (lib/time.ts); the server runs in UTC, so a connection keeps the zone you were in when you connected Claude.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ZONED = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formats.set(tz, f);
  }
  return f;
}

/** An IANA zone this runtime knows, else UTC. */
export function zoneOr(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try { format(tz); return tz; } catch { return 'UTC'; }
}

/** The wall clock in `tz` at `ms`. */
function parts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const x of format(tz).formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** Minutes `tz` is ahead of UTC at `ms`. */
export function offsetAt(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in `tz`. */
export function dayIn(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** RFC 3339 with `tz`'s offset, like 2026-11-12T15:00:00+05:30. */
export function isoIn(ms: number, tz: string): string {
  const p = parts(ms, tz), off = offsetAt(ms, tz), a = Math.abs(off);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Epoch ms of a wall-clock time in `tz`. A time a clock change skips lands just after it. */
export function fromWallClock(y: number, m: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, h, mi, s);
  let ms = wall - offsetAt(wall, tz) * 60000;
  ms = wall - offsetAt(ms, tz) * 60000;
  return ms;
}

/** A real calendar date as YYYY-MM-DD, or null. */
export function validDay(s: string): string | null {
  const m = YMD.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : null;
}

/** Midnight starting a YYYY-MM-DD in `tz`. */
export function dayStart(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return fromWallClock(y, m, d, 0, 0, 0, tz);
}

/** The day after a YYYY-MM-DD. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * A date-time from a tool call: with Z or an offset it means that instant; without one, the wall clock in `tz`.
 * Null when it isn't one.
 */
export function parseWhen(s: string, tz: string): number | null {
  const v = s.trim();
  if (ZONED.test(v)) {
    const ms = Date.parse(v.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isFinite(ms) ? ms : null;
  }
  const m = LOCAL.exec(v);
  if (!m || !validDay(`${m[1]}-${m[2]}-${m[3]}`) || +m[4] > 23 || +m[5] > 59 || +(m[6] ?? 0) > 59) return null;
  return fromWallClock(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), tz);
}
