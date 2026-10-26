import type { Task } from '../model';

export type RepoChange =
  | { type: 'put'; task: Task }
  | { type: 'remove'; id: string }
  /** Something changed that the adapter can't describe; list() again. */
  | { type: 'reload' };

/** Where tasks live. Swap adapters without touching the UI. */
export interface TaskRepo {
  readonly kind: 'local' | 'supabase';
  list(): Promise<Task[]>;
  put(tasks: Task[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** Changes made elsewhere: another device or another tab. Returns an unsubscribe. */
  subscribe(onChange: (change: RepoChange) => void): () => void;
  getSetting<T>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;
}
