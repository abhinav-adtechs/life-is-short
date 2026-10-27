'use client';

import { useRef } from 'react';
import { DEFAULT_SPLIT, clampSplit, daysFor, snapSplit, stepSplit } from '@/lib/layout';
import { usePlanner } from './Planner';

const daysText = (d: number) => (d === 7 ? 'week' : d === 1 ? '1 day' : `${d} days`);

/**
 * The handle between the matrix and the calendar. Drag it and the calendar takes as many days as fit, settling on
 * Day, 2, 3 or 5 days or Week when you let go. Double-click puts it back at three days; the arrow keys step through.
 */
export function Divider() {
  const { split, setSplit, dragSplit } = usePlanner();
  const box = useRef<{ right: number; width: number } | null>(null);
  const at = (clientX: number) => {
    const b = box.current;
    return b ? clampSplit((b.right - 12 - clientX) / (b.width - 24)) : split.f;
  };
  const pct = Math.round(split.f * 100);
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize the calendar"
      aria-valuenow={pct} aria-valuemin={30} aria-valuemax={88} aria-valuetext={`Calendar ${pct}%, ${daysText(split.days)}`}
      tabIndex={0} className={'divider' + (split.dragging ? ' on' : '')}
      title="Drag to resize. Double-click to reset."
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const grid = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        box.current = { right: grid.right, width: grid.width };
        dragSplit(split.f);
      }}
      onPointerMove={e => { if (box.current) dragSplit(at(e.clientX)); }}
      onPointerUp={e => {
        if (!box.current) return;
        const f = at(e.clientX);
        box.current = null;
        setSplit(snapSplit(f));
        dragSplit(null);
      }}
      onPointerCancel={() => { box.current = null; dragSplit(null); }}
      onDoubleClick={() => setSplit(DEFAULT_SPLIT)}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setSplit(stepSplit(split.f, e.key === 'ArrowLeft' ? 1 : -1));
      }}>
      <i aria-hidden="true" />
      {split.dragging && <span className="tip num">Calendar {pct}% · {daysText(daysFor(split.f))}</span>}
    </div>
  );
}
