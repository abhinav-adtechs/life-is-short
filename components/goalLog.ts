'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { LOG_KEY, MAX_LOG, coalesce, normalizeLog, type LogEntry } from '@/lib/flow';

/**
 * The history of your goals' charts (lib/flow.ts), in your synced settings. Entries are gathered for a moment and
 * written together, laid over what's stored, so a burst of changes is one write and two devices both keep theirs. An
 * entry that couldn't be saved waits for the next one.
 */
export function useGoalLog(repo: TaskRepo) {
  const pending = useRef<LogEntry[]>([]);
  const timer = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = 0;
    queue.current = queue.current.then(async () => {
      const batch = pending.current;
      if (!batch.length) return;
      pending.current = [];
      try {
        const stored = normalizeLog(await repo.getSetting(LOG_KEY));
        await repo.setSetting(LOG_KEY, coalesce([...stored, ...batch]).slice(-MAX_LOG));
      } catch {
        // Offline or refused: keep them for the next write.
        pending.current = [...batch, ...pending.current];
      }
    });
    return queue.current;
  }, [repo]);

  const add = useCallback((entries: LogEntry[]) => {
    if (!entries.length) return;
    pending.current.push(...entries);
    if (!timer.current) timer.current = window.setTimeout(flush, 1500);
  }, [flush]);

  /** Everything logged so far, oldest first, including entries still on their way. */
  const read = useCallback(async () => {
    await flush();
    try { return coalesce([...normalizeLog(await repo.getSetting(LOG_KEY)), ...pending.current]); } catch { return coalesce([...pending.current]); }
  }, [repo, flush]);

  // Leaving the page with entries waiting: send them now.
  useEffect(() => {
    const go = () => { if (pending.current.length) flush(); };
    window.addEventListener('pagehide', go);
    document.addEventListener('visibilitychange', go);
    return () => { window.removeEventListener('pagehide', go); document.removeEventListener('visibilitychange', go); go(); };
  }, [flush]);

  return { add, read };
}

export type GoalLog = ReturnType<typeof useGoalLog>;
