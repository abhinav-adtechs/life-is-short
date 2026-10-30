'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { REPEATS_KEY, applyOps, normalizeRepeats, undoOps, type Repeat, type RepeatOp } from '@/lib/repeat';

type Fn = (list: Repeat[]) => Repeat[];

/**
 * Your repeats, kept in your synced settings (lib/repeat.ts). Settings aren't realtime, so they're read again whenever
 * this tab comes back. Every change is a pure function of the list, laid over what's stored when it's saved, so two
 * devices changing repeats keep both, and a save that fails stays pending for the next one.
 */
export function useRepeats(repo: TaskRepo, onError: (msg: string) => void) {
  const [list, setList] = useState<Repeat[]>([]);
  const stored = useRef<Repeat[]>([]);
  const pending = useRef<Fn[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const err = useRef(onError);
  err.current = onError;

  /** What's stored, plus changes still on their way there. */
  const view = useCallback(() => pending.current.reduce((l, f) => f(l), stored.current), []);
  const show = useCallback(() => setList(view()), [view]);

  const enqueue = useCallback(<T,>(job: () => Promise<T>) => {
    const run = queue.current.then(job);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  /** Read what's stored. Resolves to the repeats as they stand, or null when they couldn't be read. */
  const read = useCallback(() => enqueue(async () => {
    try { stored.current = normalizeRepeats(await repo.getSetting(REPEATS_KEY)); } catch { show(); return null; }
    show();
    return view();
  }), [repo, enqueue, show, view]);

  const change = useCallback((fn: Fn) => {
    pending.current.push(fn);
    show();
    return enqueue(async () => {
      const fns = [...pending.current];
      if (!fns.length) return;
      let base = stored.current;
      try { base = normalizeRepeats(await repo.getSetting(REPEATS_KEY)); } catch { /* offline: build on what we have */ }
      const next = fns.reduce((l, f) => f(l), base);
      try {
        await repo.setSetting(REPEATS_KEY, next);
      } catch (e) {
        err.current(e instanceof Error ? e.message : 'Couldn’t save your repeats. Trying again with your next change.');
        stored.current = base;
        show();
        return;
      }
      stored.current = next;
      pending.current = pending.current.slice(fns.length);
      show();
    });
  }, [repo, enqueue, show]);

  /** Start, change or stop repeats. Returns what undoes it. */
  const apply = useCallback((ops: RepeatOp[]) => {
    if (!ops.length) return () => undefined;
    const back = undoOps(view(), ops);
    change(l => applyOps(l, ops));
    return () => { change(l => applyOps(l, back)); };
  }, [view, change]);

  const get = useCallback((id: string) => view().find(r => r.id === id) ?? null, [view]);

  useEffect(() => {
    read();
    const vis = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [read]);

  return { list, get, read, change, apply };
}

export type Repeats = ReturnType<typeof useRepeats>;
