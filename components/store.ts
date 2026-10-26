'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';

const newer = (a: Task | undefined, b: Task) => !!a && (a.updatedAt || 0) > (b.updatedAt || 0);

/** Merge a fresh server list into local state without losing writes still in flight. */
function mergeList(local: Map<string, Task>, server: Task[], now: number): Map<string, Task> {
  const out = new Map<string, Task>();
  for (const t of server) { const l = local.get(t.id); out.set(t.id, newer(l, t) ? (l as Task) : t); }
  for (const [id, l] of local) if (!out.has(id) && now - (l.updatedAt || 0) < 15000) out.set(id, l);
  return out;
}

/** Tasks in memory, written through to the repository. Writes are optimistic and queued in order. */
export function useTaskStore(repo: TaskRepo, onError: (msg: string) => void) {
  const [map, setMap] = useState<Map<string, Task>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(map);
  ref.current = map;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const err = useRef(onError);
  err.current = onError;

  const enqueue = useCallback((fn: () => Promise<void>) => {
    queue.current = queue.current.then(fn).catch(e => err.current(e instanceof Error ? e.message : 'That change didn’t save.'));
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await repo.list();
      setMap(m => mergeList(m, list, Date.now()));
    } catch (e) {
      err.current(e instanceof Error ? e.message : 'Could not load your tasks.');
    } finally {
      setLoaded(true);
    }
  }, [repo]);

  useEffect(() => {
    reload();
    const unsub = repo.subscribe(c => {
      if (c.type === 'reload') { reload(); return; }
      if (c.type === 'remove') { setMap(m => { if (!m.has(c.id)) return m; const n = new Map(m); n.delete(c.id); return n; }); return; }
      setMap(m => (newer(m.get(c.task.id), c.task) ? m : new Map(m).set(c.task.id, c.task)));
    });
    const vis = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', vis);
    return () => { unsub(); document.removeEventListener('visibilitychange', vis); };
  }, [repo, reload]);

  /** Write tasks. Returns what they were before, for Undo. */
  const write = useCallback((list: Task[]) => {
    if (!list.length) return new Map<string, Task | null>();
    const before = new Map<string, Task | null>();
    const now = Date.now();
    const stamped = list.map(t => ({ ...t, updatedAt: Math.max(now, (t.updatedAt || 0) + 1) }));
    const next = new Map(ref.current);
    for (const t of stamped) { before.set(t.id, ref.current.get(t.id) ?? null); next.set(t.id, t); }
    ref.current = next;
    setMap(next);
    enqueue(() => repo.put(stamped));
    return before;
  }, [repo, enqueue]);

  const patch = useCallback((id: string, part: Partial<Task>) => {
    const cur = ref.current.get(id);
    return cur ? write([{ ...cur, ...part }]) : new Map<string, Task | null>();
  }, [write]);

  const remove = useCallback((ids: string[]) => {
    const before = new Map<string, Task | null>();
    const next = new Map(ref.current);
    for (const id of ids) { before.set(id, ref.current.get(id) ?? null); next.delete(id); }
    ref.current = next;
    setMap(next);
    enqueue(() => repo.remove(ids));
    return before;
  }, [repo, enqueue]);

  /** Put every id back the way it was: re-write old versions, delete ones that didn't exist. */
  const restore = useCallback((before: Map<string, Task | null>) => {
    const puts: Task[] = [], dels: string[] = [];
    for (const [id, t] of before) { if (t) puts.push(t); else dels.push(id); }
    if (puts.length) write(puts);
    if (dels.length) remove(dels);
  }, [write, remove]);

  const tasks = useMemo(() => [...map.values()], [map]);
  const get = useCallback((id: string) => ref.current.get(id), []);
  const all = useCallback(() => [...ref.current.values()], []);

  return { tasks, loaded, get, all, write, patch, remove, restore, reload };
}

export type Store = ReturnType<typeof useTaskStore>;
