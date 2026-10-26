import { DAY_MS, DOW, DOWL, MIN, MON, MONL, fromYmd, pad, startOfDay } from './time';

export function fmtTime(ms: number, period = true) {
  const d = new Date(ms), h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())}${period ? (h < 12 ? ' AM' : ' PM') : ''}`;
}

/** "2:00 – 2:30 PM", or "11:30 AM – 12:30 PM" across noon. */
export function fmtRange(s: number, mins: number) {
  const e = s + mins * MIN;
  const same = (new Date(s).getHours() < 12) === (new Date(e).getHours() < 12);
  return `${fmtTime(s, !same)} – ${fmtTime(e)}`;
}

/** "30 min", "2 h", "1.5 h", "1 h 15 min". */
export function fmtDur(m: number) {
  if (m < 60) return `${m} min`;
  if (m % 30 === 0) return `${m / 60} h`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function dayWord(ms: number, nowMs = Date.now()) {
  const diff = Math.round((startOfDay(ms).getTime() - startOfDay(nowMs).getTime()) / DAY_MS);
  const x = new Date(ms);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DOWL[x.getDay()];
  return `${DOW[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]}`;
}

export const fmtWhen = (ms: number, nowMs = Date.now()) => `${dayWord(ms, nowMs)}, ${fmtTime(ms)}`;

export function dueLabel(due: string, nowMs = Date.now()): { text: string; hot: boolean } {
  const ms = fromYmd(due).getTime();
  const diff = Math.round((ms - startOfDay(nowMs).getTime()) / DAY_MS);
  if (diff < 0) return { text: 'Overdue', hot: true };
  if (diff === 0) return { text: 'Due today', hot: true };
  if (diff === 1) return { text: 'Due tomorrow', hot: true };
  return { text: `Due ${dayWord(ms, nowMs)}`, hot: false };
}

/** "Monday, 26 October". */
export const longDate = (ms: number) => { const d = new Date(ms); return `${DOWL[d.getDay()]}, ${d.getDate()} ${MONL[d.getMonth()]}`; };

/** "26 Oct – 1 Nov". */
export const rangeLabel = (a: Date, b: Date) => `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]}`;

export const shortTitle = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 2).trimEnd() + '…' : s);
