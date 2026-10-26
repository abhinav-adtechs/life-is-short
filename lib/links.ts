import type { Task } from './model';
import { endOf, pad } from './time';

/** A Google Calendar "create event" link pre-filled from the task. */
export function gcalUrl(t: Pick<Task, 'title' | 'notes' | 'start' | 'minutes'>): string {
  const f = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`; };
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { tz = ''; }
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + encodeURIComponent(t.title)
    + (t.start != null ? '&dates=' + f(t.start) + '/' + f(endOf(t)) : '')
    + (t.notes ? '&details=' + encodeURIComponent(t.notes) : '')
    + (tz ? '&ctz=' + encodeURIComponent(tz) : '');
}
