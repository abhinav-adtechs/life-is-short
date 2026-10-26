import type { SupabaseClient } from '@supabase/supabase-js';
import type { Priority, Status, Task } from '../model';
import type { RepoChange, TaskRepo } from './types';

interface Row {
  user_id: string;
  id: string;
  title: string;
  raw: string;
  notes: string;
  priority: number;
  minutes: number;
  start: number | string | null;
  due: string | null;
  status: string;
  created: number | string;
  sort_order: number | string;
  done_at: number | string | null;
  external_id: string | null;
  updated_at: number | string;
}

// bigint columns can arrive as strings; epoch ms fits in a double.
const num = (v: number | string | null) => (v == null ? null : Number(v));

export const fromRow = (r: Row): Task => ({
  id: r.id, title: r.title, raw: r.raw, notes: r.notes,
  priority: r.priority as Priority, minutes: r.minutes,
  start: num(r.start), due: r.due, status: r.status as Status,
  created: Number(r.created), order: Number(r.sort_order), doneAt: num(r.done_at),
  externalId: r.external_id, updatedAt: Number(r.updated_at),
});

export const toRow = (t: Task, userId: string): Row => ({
  user_id: userId, id: t.id, title: t.title.slice(0, 160), raw: t.raw || '', notes: t.notes || '',
  priority: t.priority, minutes: t.minutes, start: t.start, due: t.due, status: t.status,
  created: t.created, sort_order: t.order, done_at: t.doneAt, external_id: t.externalId ?? null,
  updated_at: t.updatedAt ?? Date.now(),
});

/** Postgres + row-level security on user_id, with realtime so other devices see changes within seconds. */
export function supabaseRepo(sb: SupabaseClient, userId: string): TaskRepo {
  const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };
  return {
    kind: 'supabase',
    async list() {
      const { data, error } = await sb.from('tasks').select('*').eq('user_id', userId);
      fail('Could not load tasks', error);
      return (data as Row[]).map(fromRow);
    },
    async put(tasks) {
      if (!tasks.length) return;
      const { error } = await sb.from('tasks').upsert(tasks.map(t => toRow(t, userId)), { onConflict: 'user_id,id' });
      fail('Could not save', error);
    },
    async remove(ids) {
      if (!ids.length) return;
      const { error } = await sb.from('tasks').delete().eq('user_id', userId).in('id', ids);
      fail('Could not delete', error);
    },
    subscribe(onChange: (c: RepoChange) => void) {
      const ch = sb.channel(`tasks:${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, payload => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as Partial<Row>;
            if (old.id && (!old.user_id || old.user_id === userId)) onChange({ type: 'remove', id: old.id });
            return;
          }
          const row = payload.new as Row;
          if (row.user_id === userId) onChange({ type: 'put', task: fromRow(row) });
        })
        .subscribe(status => {
          // After a dropped connection, catch up on anything missed.
          if (status === 'SUBSCRIBED') onChange({ type: 'reload' });
        });
      return () => { sb.removeChannel(ch); };
    },
    async getSetting<T>(key: string) {
      const { data, error } = await sb.from('settings').select('value').eq('user_id', userId).eq('key', key).maybeSingle();
      fail('Could not load settings', error);
      return (data?.value ?? null) as T | null;
    },
    async setSetting(key, value) {
      const { error } = await sb.from('settings').upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
      fail('Could not save settings', error);
    },
  };
}
