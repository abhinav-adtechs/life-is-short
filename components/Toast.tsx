'use client';

import { useEffect } from 'react';

export interface ToastState { key: number; msg: string; undo?: () => void }

/** One message at a time. Destructive and bulk actions pass an undo. */
export function Toast({ state, wide, onDone }: { state: ToastState; wide: boolean; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, state.undo ? 6500 : 3800);
    return () => clearTimeout(t);
  }, [state, onDone]);
  return (
    <div key={state.key} className={'toast' + (state.undo ? '' : ' solo') + (wide ? ' wide' : '')} role="status" aria-live="polite">
      <span>{state.msg}</span>
      {state.undo && <button type="button" onClick={() => { state.undo?.(); onDone(); }}>Undo</button>}
    </div>
  );
}
