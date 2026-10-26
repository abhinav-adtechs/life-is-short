import type { Task } from '../model';
import type { RepoChange, TaskRepo } from './types';

const KEY = 'ds.tasks.v1';
const SETTINGS = 'ds.settings.v1';

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { throw new Error('This browser would not save the change.'); }
}

/** Tasks in this browser only. Other tabs hear about changes through the storage event. */
export function localRepo(): TaskRepo {
  const all = () => read<Record<string, Task>>(KEY, {});
  return {
    kind: 'local',
    async list() { return Object.values(all()); },
    async put(tasks) { const m = all(); for (const t of tasks) m[t.id] = t; write(KEY, m); },
    async remove(ids) { const m = all(); for (const id of ids) delete m[id]; write(KEY, m); },
    subscribe(onChange: (c: RepoChange) => void) {
      const h = (e: StorageEvent) => { if (e.key === KEY) onChange({ type: 'reload' }); };
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
    async getSetting<T>(key: string) { return (read<Record<string, unknown>>(SETTINGS, {})[key] ?? null) as T | null; },
    async setSetting(key, value) { const s = read<Record<string, unknown>>(SETTINGS, {}); s[key] = value; write(SETTINGS, s); },
  };
}
