import type { Priority } from './model';
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

/* ---------- lens: what the backlog and calendar focus on ---------- */

/** Priorities up to `pri`, and these labels ('' for unlabelled), or every label when null so new labels join in. */
export interface Lens { pri: Priority; labels: string[] | null }
/** A lens you can pick in one tap. */
export interface Preset extends Lens { id: string; name: string }

export const DEFAULT_LENS: Lens = { pri: 3, labels: null };
export const MAX_PRESETS = 8;
/** The starter presets go by the starter labels' ids, so they keep working when those labels are renamed. */
export const DEFAULT_PRESETS: Preset[] = [
  { id: 'all', name: 'Everything', pri: 3, labels: null },
  { id: 'work', name: 'Work focus', pri: 2, labels: ['work'] },
  { id: 'life', name: 'Personal time', pri: 3, labels: ['personal', 'others', ''] },
  { id: 'urgent', name: 'Just urgent', pri: 1, labels: null },
];

const record = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;

export function normalizeLens(raw: unknown): Lens {
  const o = record(raw);
  const pri = o.pri === 1 || o.pri === 2 || o.pri === 3 ? o.pri : DEFAULT_LENS.pri;
  const labels = Array.isArray(o.labels) ? [...new Set(o.labels.filter((x): x is string => typeof x === 'string' && (x === '' || ID.test(x))))] : [];
  return { pri, labels: labels.length ? labels : null };
}

/** Stored presets, cleaned up. Never set gets the starter set; a list you emptied stays empty. */
export function normalizePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return DEFAULT_PRESETS;
  const out: Preset[] = [];
  for (const x of raw) {
    const o = record(x);
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, LABEL_NAME_MAX) : '';
    if (!id || !name || out.length >= MAX_PRESETS || out.some(p => p.id === id)) continue;
    out.push({ id, name, ...normalizeLens(o) });
  }
  return out;
}

/** Every label id a lens can hold, '' standing for no label. */
const allIds = (labels: Label[]) => [...labels.map(l => l.id), ''];

/** The labels a lens keeps, among the ones that exist. */
export function lensIds(lens: Lens, labels: Label[]): string[] {
  const all = allIds(labels);
  return lens.labels == null ? all : all.filter(id => (lens.labels as string[]).includes(id));
}

export function sameLens(a: Lens, b: Lens, labels: Label[]): boolean {
  const x = lensIds(a, labels), y = lensIds(b, labels);
  return a.pri === b.pri && x.length === y.length && x.every(id => y.includes(id));
}

/** In view: the priority is in, and so is the label (or no label). */
export function inLens(lens: Lens, priority: number, labelId: string | null): boolean {
  return priority <= lens.pri && (lens.labels == null || lens.labels.includes(labelId ?? ''));
}

/** Presets that still show something: one whose labels were all removed drops out. */
export const usablePresets = (presets: Preset[], labels: Label[]) => presets.filter(p => lensIds(p, labels).length > 0);

/** Turn one label on or off. It never leaves nothing, and all of them on reads as every label. */
export function toggleLensLabel(lens: Lens, id: string, labels: Label[]): Lens {
  const all = allIds(labels), cur = lensIds(lens, labels);
  const next = cur.includes(id) ? cur.filter(x => x !== id) : all.filter(x => x === id || cur.includes(x));
  if (!next.length) return lens;
  return { ...lens, labels: next.length === all.length ? null : next };
}
