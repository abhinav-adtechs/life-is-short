'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { SLIPS_KEY, mergeSlips, normalizeSlips, slipsFrom, type Change, type Slip } from '@/lib/slips';

/**
 * Missed slots you moved on from, kept in your synced settings so the review still counts them.
 * Every save re-reads what's stored and adds to it, so two devices noting slips never write over each other.
 */
export function useSlips(repo: TaskRepo) {
  const [slips, setSlips] = useState<Slip[]>([]);
  /** Noted here and not saved yet. A failed save keeps them for the next one. */
  const pending = useRef<Slip[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const sync = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const fresh = [...pending.current];
      try {
        const next = mergeSlips(normalizeSlips(await repo.getSetting(SLIPS_KEY)), fresh, Date.now());
        if (fresh.length) await repo.setSetting(SLIPS_KEY, next);
        pending.current = pending.current.slice(fresh.length);
        setSlips(mergeSlips(next, pending.current, Date.now()));
      } catch { /* offline: try again with the next one */ }
    });
  }, [repo]);

  useEffect(() => { sync(); }, [sync]);

  /** Every write to tasks comes through here; most aren't slips. */
  const record = useCallback((changes: Change[]) => {
    const found = slipsFrom(changes, Date.now());
    if (!found.length) return;
    pending.current.push(...found);
    setSlips(s => mergeSlips(s, found, Date.now()));
    sync();
  }, [sync]);

  return { slips, record, refresh: sync };
}
