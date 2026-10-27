'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Default pixels per hour. Each column says its own in data-hour (Settings → Calendar → Hour height). */
export const HOUR = 56;
const snap15 = (m: number) => Math.round(m / 15) * 15;

export type DragKind = 'row' | 'block' | 'resize';

export interface DragView {
  kind: DragKind;
  id: string;
  x: number;
  y: number;
  /** Snapped start under the pointer, for row and block drags. min is -1 over a month-view day: no time picked. */
  target: { day: string; min: number } | null;
  /** Backlog matrix cell under the pointer, as "label|priority" ('' for no label). */
  cell: string | null;
  overBacklog: boolean;
  /** New length while resizing. */
  minutes: number | null;
}

interface Pending {
  kind: DragKind;
  id: string;
  pointerId: number;
  touch: boolean;
  sx: number;
  sy: number;
  /** Pointer offset from the top of the block, in px. */
  grabY: number;
  /** Task start in minutes from midnight and length, for resizing. */
  startMin: number;
  minutes: number;
  active: boolean;
  timer: number;
  view: DragView;
}

export interface DragHandlers {
  /** The task's length, so the drop target can be clamped. */
  lengthOf: (id: string) => number;
  onDrop: (id: string, day: string, min: number, kind: DragKind) => void;
  onDropBacklog: (id: string) => void;
  /** Dropped on a matrix cell: take that cell's label and priority. */
  onDropCell: (id: string, cell: string, kind: DragKind) => void;
  onResize: (id: string, minutes: number) => void;
}

/** Column under a point: an element with data-day, data-h0, data-h1 (visible hour range) and data-hour; or a month-view day with data-month. */
function columnAt(x: number, y: number) {
  for (const el of document.elementsFromPoint(x, y)) {
    const col = (el as HTMLElement).closest?.('[data-day]') as HTMLElement | null;
    if (col) return col;
  }
  return null;
}
function cellAt(x: number, y: number) {
  for (const el of document.elementsFromPoint(x, y)) {
    const cell = (el as HTMLElement).closest?.('[data-cell]') as HTMLElement | null;
    if (cell) return cell.dataset.cell as string;
  }
  return null;
}
function overBacklogAt(x: number, y: number) {
  return document.elementsFromPoint(x, y).some(el => (el as HTMLElement).closest?.('[data-backlog]'));
}

/** Minutes from midnight at a y position inside a column, snapped to 15 and kept inside the visible hours. */
export const hourOf = (col: HTMLElement) => Number(col.dataset.hour || HOUR);

export function minuteAt(col: HTMLElement, clientY: number, grabY: number, length: number) {
  if (col.dataset.month != null) return -1;
  const r = col.getBoundingClientRect();
  const h0 = Number(col.dataset.h0 || 9), h1 = Number(col.dataset.h1 || 21);
  const m = h0 * 60 + snap15(((clientY - grabY - r.top) / hourOf(col)) * 60);
  return Math.max(h0 * 60, Math.min(h1 * 60 - 15, 24 * 60 - Math.max(15, Math.min(length, 60)), m));
}

/**
 * Pointer-event drag for backlog rows and calendar blocks, plus bottom-edge resize.
 * Mouse and pen start after a few pixels; touch starts after a long press so the page still scrolls.
 */
export function useDrag(h: DragHandlers) {
  const [view, setView] = useState<DragView | null>(null);
  const p = useRef<Pending | null>(null);
  const handlers = useRef(h);
  handlers.current = h;
  const suppressUntil = useRef(0);
  const frame = useRef(0);

  const publish = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; setView(p.current?.active ? { ...p.current.view } : null); });
  };

  const end = useCallback((commit: boolean) => {
    const cur = p.current;
    p.current = null;
    if (!cur) return;
    clearTimeout(cur.timer);
    document.documentElement.classList.remove('dragging', 'resizing-all');
    if (cur.active) {
      suppressUntil.current = performance.now() + 350;
      if (commit) {
        const v = cur.view;
        if (cur.kind === 'resize') { if (v.minutes != null && v.minutes !== cur.minutes) handlers.current.onResize(cur.id, v.minutes); }
        else if (v.cell) handlers.current.onDropCell(cur.id, v.cell, cur.kind);
        else if (v.overBacklog && cur.kind === 'block') handlers.current.onDropBacklog(cur.id);
        else if (v.target) handlers.current.onDrop(cur.id, v.target.day, v.target.min, cur.kind);
      }
    }
    setView(null);
  }, []);

  const update = (x: number, y: number) => {
    const cur = p.current;
    if (!cur) return;
    cur.view.x = x; cur.view.y = y;
    if (cur.kind === 'resize') {
      const col = document.querySelector(`[data-block="${CSS.escape(cur.id)}"]`)?.closest('[data-day]') as HTMLElement | null;
      if (col) {
        const r = col.getBoundingClientRect();
        const h0 = Number(col.dataset.h0 || 9);
        const endMin = h0 * 60 + snap15(((y - r.top) / hourOf(col)) * 60);
        cur.view.minutes = Math.max(15, Math.min(480, endMin - cur.startMin, 24 * 60 - cur.startMin));
      }
    } else {
      cur.view.cell = cellAt(x, y);
      cur.view.overBacklog = !cur.view.cell && cur.kind === 'block' && overBacklogAt(x, y);
      const col = cur.view.cell || cur.view.overBacklog ? null : columnAt(x, y);
      cur.view.target = col ? { day: col.dataset.day as string, min: minuteAt(col, y, cur.grabY, handlers.current.lengthOf(cur.id)) } : null;
    }
    publish();
  };

  const activate = () => {
    const cur = p.current;
    if (!cur || cur.active) return;
    cur.active = true;
    document.documentElement.classList.add(cur.kind === 'resize' ? 'resizing-all' : 'dragging');
    if (cur.touch && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* unsupported */ } }
    update(cur.view.x, cur.view.y);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const cur = p.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      const dist = Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy);
      if (!cur.active) {
        cur.view.x = e.clientX; cur.view.y = e.clientY;
        if (cur.touch) { if (dist > 8) end(false); return; }
        if (dist > 4 || cur.kind === 'resize') activate();
        return;
      }
      update(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => { if (p.current && e.pointerId === p.current.pointerId) end(true); };
    const cancel = (e: PointerEvent) => { if (p.current && e.pointerId === p.current.pointerId) end(false); };
    // Once a touch drag is live, stop the page from scrolling under it.
    const touchmove = (e: TouchEvent) => { if (p.current?.active) e.preventDefault(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && p.current) end(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchmove, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchmove);
      window.removeEventListener('keydown', key);
    };
  }, [end]);

  /** Start a possible drag from a pointerdown. */
  const begin = useCallback((e: React.PointerEvent, kind: DragKind, id: string, opts: { grabY?: number; startMin?: number; minutes?: number } = {}) => {
    if (e.button !== 0 || p.current) return;
    const touch = e.pointerType === 'touch';
    const cur: Pending = {
      kind, id, pointerId: e.pointerId, touch, sx: e.clientX, sy: e.clientY,
      grabY: opts.grabY ?? 14, startMin: opts.startMin ?? 0, minutes: opts.minutes ?? 30,
      active: false, timer: 0,
      view: { kind, id, x: e.clientX, y: e.clientY, target: null, cell: null, overBacklog: false, minutes: kind === 'resize' ? (opts.minutes ?? 30) : null },
    };
    p.current = cur;
    if (touch) cur.timer = window.setTimeout(activate, 320);
    if (kind === 'resize') e.preventDefault();
  }, []);

  /** True right after a drag, so the click it ends with doesn't also open or pick. */
  const ignoreClick = useCallback(() => performance.now() < suppressUntil.current, []);

  return { view, begin, ignoreClick, cancel: () => end(false) };
}
