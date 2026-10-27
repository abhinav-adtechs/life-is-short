'use client';

import { useRef } from 'react';
import { CAL_MIN, snapWidth } from '@/lib/layout';
import { usePlanner } from './Planner';

/**
 * The handle between the backlog and the calendar. Drag it or use the arrow keys, and the calendar takes as many days
 * as fit; let go near Day, 3 days, 5 days or Week and it settles there. Double-click hands the split back to Auto.
 */
export function Divider() {
  const { split, setSplit, dragSplit } = usePlanner();
  const start = useRef<{ x: number; w: number } | null>(null);
  const at = (clientX: number) => (start.current ? start.current.w - (clientX - start.current.x) : split.calW);
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize the calendar"
      aria-valuenow={split.calW} aria-valuemin={CAL_MIN} aria-valuetext={`${split.days} ${split.days === 1 ? 'day' : 'days'} on the calendar`}
      tabIndex={0} className={'divider' + (split.dragging ? ' on' : '') + (split.auto ? ' auto' : '')}
      title="Drag to resize. Double-click to let your filters size it."
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: split.calW };
        dragSplit(split.calW);
      }}
      onPointerMove={e => { if (start.current) dragSplit(at(e.clientX)); }}
      onPointerUp={e => {
        if (!start.current) return;
        const w = at(e.clientX);
        start.current = null;
        setSplit({ mode: 'pinned', cal: snapWidth(w) });
        dragSplit(null);
      }}
      onPointerCancel={() => { start.current = null; dragSplit(null); }}
      onDoubleClick={() => setSplit({ mode: 'auto', cal: split.calW })}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setSplit({ mode: 'pinned', cal: split.calW + (e.key === 'ArrowLeft' ? 40 : -40) });
      }}>
      <i aria-hidden="true" />
    </div>
  );
}

/** On: your filters size the split. Off: it stays where you put it. Picking days or dragging turns it off. */
export function LayoutChip() {
  const { split, setSplit } = usePlanner();
  return (
    <button type="button" className={'lay' + (split.auto ? ' on' : '')} aria-pressed={split.auto} aria-label="Auto layout"
      title={split.auto ? 'Your filters size the split. Pick days or drag the divider to pin it.' : 'Pinned where you put it. Turn on to let your filters size the split.'}
      onClick={() => setSplit({ mode: split.auto ? 'pinned' : 'auto', cal: split.calW })}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>
      <span className="lay-t">Auto layout</span>
    </button>
  );
}
