'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { GOALS_KEY, normalizeGoals, type Goal, type GoalsFn } from '@/lib/goals';

/**
 * Your goals, kept in your synced settings (lib/goals.ts). Settings aren't realtime, so they're read again whenever
 * this tab comes back. Every change is a pure function of the list, laid over what's stored when it's saved, so two
 * devices changing goals keep both, and a save that fails stays pending for the next one.
 */
export function useGoals(repo: TaskRepo, onError: (msg: string) => void) {
  const [list, setList] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const stored = useRef<Goal[]>([]);
  const pending = useRef<GoalsFn[]>([]);
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

  const read = useCallback(() => enqueue(async () => {
    try { stored.current = normalizeGoals(await repo.getSetting(GOALS_KEY)); } catch { /* keep what we have */ }
    setLoaded(true);
    show();
  }), [repo, enqueue, show]);

  /** Change the goals. Returns a function that puts them back the way they were. */
  const change = useCallback((fn: GoalsFn) => {
    const was = view();
    pending.current.push(fn);
    show();
    enqueue(async () => {
      const fns = [...pending.current];
      if (!fns.length) return;
      let base = stored.current;
      try { base = normalizeGoals(await repo.getSetting(GOALS_KEY)); } catch { /* offline: build on what we have */ }
      const next = normalizeGoals(fns.reduce((l, f) => f(l), base));
      try {
        await repo.setSetting(GOALS_KEY, next);
      } catch (e) {
        err.current(e instanceof Error ? e.message : 'Couldn’t save your goals. Trying again with your next change.');
        stored.current = base;
        show();
        return;
      }
      stored.current = next;
      pending.current = pending.current.slice(fns.length);
      show();
    });
    // Undo puts back each goal this touched, as it was, and leaves the rest alone.
    return () => {
      const after = fn(was);
      const ids = new Set([...was, ...after].filter(g => was.find(x => x.id === g.id) !== after.find(x => x.id === g.id)).map(g => g.id));
      const order = was.map(g => g.id);
      change(l => {
        const kept = l.filter(g => !ids.has(g.id));
        const back = was.filter(g => ids.has(g.id));
        const out = [...kept, ...back];
        return out.sort((a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9));
      });
    };
  }, [repo, enqueue, show, view]);

  useEffect(() => {
    read();
    const vis = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [read]);

  return { list, loaded, change, read };
}

export type GoalsApi = ReturnType<typeof useGoals>;
