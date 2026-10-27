'use client';

import { useEffect } from 'react';

export interface ToastState { key: number; msg: string; undo?: () => void }

/** One message at a time, above the chat bar. Every write passes an undo; it stays six seconds. */
export function Toast({ state, onDone }: { state: ToastState; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, state.undo ? 6000 : 3800);
    return () => clearTimeout(t);
  }, [state, onDone]);
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{state.msg}</span>
      {state.undo && <button type="button" onClick={() => { state.undo?.(); onDone(); }}>Undo</button>}
    </div>
  );
}
