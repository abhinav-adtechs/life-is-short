import { PALETTE, isHex } from './color';

/** A part of your life a task belongs to, like Work or Personal. Its colour marks the task in the backlog and on the calendar. */
export interface Label { id: string; name: string; color: string }

export const MAX_LABELS = 12;
export const LABEL_NAME_MAX = 24;

/** Where everyone starts. Rename, recolour, reorder or remove them in Settings → Labels. */
export const DEFAULT_LABELS: Label[] = [
  { id: 'work', name: 'Work', color: PALETTE[0] },
  { id: 'personal', name: 'Personal', color: PALETTE[1] },
  { id: 'others', name: 'Helping others', color: PALETTE[2] },
];

export const newLabelId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Stored labels, cleaned up. Never set gets the starter set; a list you emptied stays empty. */
export function normalizeLabels(raw: unknown): Label[] {
  if (!Array.isArray(raw)) return DEFAULT_LABELS;
  const out: Label[] = [];
  for (const x of raw) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, LABEL_NAME_MAX) : '';
    if (!id || !name || out.length >= MAX_LABELS || out.some(l => l.id === id)) continue;
    out.push({ id, name, color: isHex(o.color) ? o.color.toUpperCase() : PALETTE[out.length % PALETTE.length] });
  }
  return out;
}

/** Just enough of a pulled event's account and calendar to read their labels. */
export interface LabelSource { account: { label: string | null }; calendar: { label: string | null } | null }

/**
 * A task's label: its own, else for a Google event its calendar's, else its account's.
 * An id that's no longer in the list (a removed label) counts as none.
 */
export function resolveLabel(t: { label?: string | null }, labels: Map<string, Label>, src?: LabelSource | null): Label | null {
  for (const id of [t.label, src?.calendar?.label, src?.account.label]) {
    const l = id ? labels.get(id) : undefined;
    if (l) return l;
  }
  return null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The label a #tag or a word names: its whole name, its id, or its first word ("#helping" for Helping others). */
export function labelNamed(labels: Label[], word: string): Label | null {
  const w = squash(word);
  if (!w) return null;
  return labels.find(l => squash(l.name) === w || squash(l.id) === w)
    ?? labels.find(l => squash(l.name.split(' ')[0]) === w)
    ?? null;
}

/** A label id from the model or the parser: an id from the list, or failing that a name. */
export function pickLabel(labels: Label[], v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return labels.find(l => l.id === v)?.id ?? labelNamed(labels, v)?.id ?? null;
}
