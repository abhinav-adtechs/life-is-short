'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { DAYS_KEY, normalizeDays, type DayPlan, type DaysFn } from '@/lib/today';

/** How often an open, visible app looks for a plan Claude made: settings aren't realtime. */
const POLL_MS = 2 * 60 * 1000;

/**
 * Your day plans (lib/today.ts), kept in your synced settings. Claude writes them over the connector while the app is
 * open, so they're read again when this window comes back to the front, and every couple of minutes while it's in view.
 * A change is laid over what's stored when it's saved.
 */
export function useDayPlans(repo: TaskRepo, onError: (msg: string) => void) {
  const [list, setList] = useState<DayPlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const cur = useRef<DayPlan[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const err = useRef(onError);
  err.current = onError;

  const show = useCallback((l: DayPlan[]) => { cur.current = l; setList(l); }, []);

  const enqueue = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(job).catch(() => undefined);
  }, []);

  const read = useCallback(() => enqueue(async () => {
    try { show(normalizeDays(await repo.getSetting(DAYS_KEY))); } catch { /* keep what we have */ }
    setLoaded(true);
  }), [repo, enqueue, show]);

  /** Change your day plans. Returns a function that puts them back as they were. */
  const change = useCallback((fn: DaysFn) => {
    const was = cur.current;
    show(fn(was));
    enqueue(async () => {
      let base = cur.current;
      try { base = normalizeDays(await repo.getSetting(DAYS_KEY)); } catch { /* offline: build on what we have */ }
      const next = fn(base);
      try {
        await repo.setSetting(DAYS_KEY, next);
        show(next);
      } catch (e) {
        err.current(e instanceof Error ? e.message : 'Couldn’t save today’s plan.');
        show(base);
      }
    });
    return () => { change(() => was); };
  }, [repo, enqueue, show]);

  useEffect(() => {
    read();
    const back = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    const poll = window.setInterval(back, POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
      window.clearInterval(poll);
    };
  }, [read]);

  return { list, loaded, change, read };
}
