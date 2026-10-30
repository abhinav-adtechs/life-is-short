import type { Rule } from './repeat';

export type Priority = 1 | 2 | 3;
export type Status = 'open' | 'done';

/** One task. Field names match data/tasks.json so an import is a straight copy. */
export interface Task {
  id: string;
  title: string;
  raw: string;
  notes: string;
  priority: Priority;
  /** 15–480, multiples of 15 (10 allowed from import). */
  minutes: number;
  /** Epoch ms when scheduled; null keeps it in the backlog. */
  start: number | null;
  /** YYYY-MM-DD deadline, separate from when it's scheduled. */
  due: string | null;
  status: Status;
  created: number;
  order: number;
  doneAt: number | null;
  /** Source id for pulled items, e.g. "gcal:<calendar>:<event>" or "gtask:<id>". */
  externalId?: string | null;
  /** Label id from Settings → Labels. A Google event without one takes its calendar's. */
  label?: string | null;
  /** Epoch ms of the last local write; newer wins when sync events cross. */
  updatedAt?: number;
}

export const PRI: Record<Priority, string> = { 1: 'Urgent', 2: 'Important', 3: 'Later' };

/** What the parser or the model says about one dumped item, before placement. */
export interface ParsedItem {
  title: string;
  priority: Priority;
  minutes: number;
  /** YYYY-MM-DD or null. */
  date: string | null;
  /** HH:MM (24h) or null. */
  time: string | null;
  deadline: boolean;
  notes: string;
  /** A label id, or null. */
  label: string | null;
  /** Said to happen again and again: the days it lands on (lib/repeat.ts). `date` is the first one. */
  repeat?: Rule | null;
}

export const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
