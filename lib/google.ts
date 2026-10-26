import type { Task } from './model';
import { newId as defaultNewId } from './model';
import { DAY_MS, MIN } from './time';

/** A Google Calendar event or Google Task, ready to merge into the planner. */
export interface ExternalItem {
  externalId: string;
  source: 'gcal' | 'gtask';
  title: string;
  notes: string;
  start: number | null;
  minutes: number;
  due: string | null;
  done: boolean;
  /** The same meeting seen from two connected accounts shares this (iCalUID plus start), so it lands once. */
  uid?: string | null;
}

export interface GEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

export interface GTask { id: string; title?: string; notes?: string; due?: string; status?: string; deleted?: boolean }

const plain = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const len = (ms: number) => Math.min(480, Math.max(15, Math.round(ms / MIN / 15) * 15));

export function mapEvent(ev: GEvent, calendarId: string, now: number): ExternalItem | null {
  if (ev.status === 'cancelled') return null;
  if (ev.attendees?.some(a => a.self && a.responseStatus === 'declined')) return null;
  const base = {
    externalId: `gcal:${calendarId}:${ev.id}`, source: 'gcal' as const,
    title: (ev.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160) || '(No title)',
    notes: plain(ev.description || '').slice(0, 1000),
  };
  if (ev.start?.dateTime) {
    const s = Date.parse(ev.start.dateTime);
    const e = Date.parse(ev.end?.dateTime || '') || s + 30 * MIN;
    if (!isFinite(s)) return null;
    return { ...base, start: s, minutes: len(e - s), due: null, done: e <= now, uid: ev.iCalUID ? `${ev.iCalUID}|${s}` : null };
  }
  if (ev.start?.date) {
    // A one-day all-day event reads as a deadline; multi-day ones (trips, leave) are skipped.
    const days = ev.end?.date ? (Date.parse(ev.end.date) - Date.parse(ev.start.date)) / DAY_MS : 1;
    if (days > 1) return null;
    return { ...base, start: null, minutes: 30, due: ev.start.date, done: false, uid: ev.iCalUID ? `${ev.iCalUID}|${ev.start.date}` : null };
  }
  return null;
}

export function mapTask(t: GTask): ExternalItem | null {
  if (t.deleted) return null;
  const title = (t.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!title) return null;
  return {
    externalId: `gtask:${t.id}`, source: 'gtask', title, notes: (t.notes || '').slice(0, 1000),
    start: null, minutes: 30, due: t.due ? t.due.slice(0, 10) : null, done: t.status === 'completed',
  };
}

/** Calendar id of a pulled event, from its externalId "gcal:<calendar>:<event>". */
export function calendarOf(externalId: string | null | undefined): string | null {
  if (!externalId || !externalId.startsWith('gcal:')) return null;
  const rest = externalId.slice(5), i = rest.lastIndexOf(':');
  return i > 0 ? rest.slice(0, i) : null;
}

/** A calendar event's title and time, to spot one meeting pulled from two accounts. */
const fingerprint = (title: string, start: number | null, due: string | null) => `${title}|${start ?? due}`;

/**
 * One meeting on calendars in two connected accounts arrives twice with different externalIds.
 * Copies already in the planner always come through, so each keeps updating. A new copy is dropped when its twin
 * is already here: in this pull (same uid), or stored from an earlier one (same title and time; accounts connected
 * one at a time, or one account's pull failed). `blocks` says which stored events count: a calendar you switched off
 * shouldn't hide a meeting another account still shows.
 */
export function dedupeItems(items: ExternalItem[], tasks: Task[], blocks: (t: Task) => boolean = () => true): ExternalItem[] {
  const known = new Set(tasks.map(t => t.externalId).filter(Boolean));
  const pulled = new Set(tasks.filter(t => t.externalId?.startsWith('gcal:') && blocks(t)).map(t => fingerprint(t.title, t.start, t.due)));
  const seen = new Set(items.filter(it => it.uid && known.has(it.externalId)).map(it => it.uid));
  return items.filter(it => {
    if (known.has(it.externalId) || !it.uid) return true;
    if (seen.has(it.uid) || pulled.has(fingerprint(it.title, it.start, it.due))) return false;
    seen.add(it.uid);
    return true;
  });
}

/**
 * One-way pull: new items are added; items pulled before take Google's title, time and length.
 * Your priority, notes and done state stay yours, except a Google Task completed in Google is ticked off here.
 */
export function mergeExternal(tasks: Task[], items: ExternalItem[], now: number, makeId: () => string = defaultNewId, blocks?: (t: Task) => boolean) {
  const byExt = new Map(tasks.filter(t => t.externalId).map(t => [t.externalId as string, t]));
  const puts: Task[] = [];
  // A calendar shared by two accounts comes back once per account: handle each externalId once.
  const done = new Set<string>();
  let added = 0, updated = 0, ticked = 0;
  dedupeItems(items, tasks, blocks).forEach((it, i) => {
    if (done.has(it.externalId)) return;
    done.add(it.externalId);
    const cur = byExt.get(it.externalId);
    if (cur) {
      const patch: Partial<Task> = {};
      if (cur.title !== it.title) patch.title = it.title;
      if (it.source === 'gcal' && it.start != null && cur.start !== it.start) patch.start = it.start;
      if (it.source === 'gcal' && it.start != null && cur.minutes !== it.minutes) patch.minutes = it.minutes;
      if (it.due && cur.due !== it.due) patch.due = it.due;
      if (it.source === 'gtask' && it.done && cur.status === 'open') { patch.status = 'done'; patch.doneAt = now; ticked++; }
      else if (Object.keys(patch).length) updated++;
      if (Object.keys(patch).length) puts.push({ ...cur, ...patch });
      return;
    }
    if (it.done && it.source === 'gtask') return; // finished before we ever saw it
    puts.push({
      id: makeId(), title: it.title, raw: '', notes: it.notes, priority: 2, minutes: it.minutes,
      start: it.start, due: it.due, status: it.done ? 'done' : 'open', created: now, order: now + i,
      doneAt: it.done ? (it.start != null ? it.start + it.minutes * MIN : now) : null, externalId: it.externalId,
    });
    added++;
  });
  return { puts, added, updated, ticked };
}
