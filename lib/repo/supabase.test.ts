import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task } from '../model';
import { fromRow, supabaseRepo, toRow } from './supabase';

const task: Task = {
  id: 't1', title: 'Board deck', raw: '', notes: '', priority: 1, minutes: 60, start: null, due: '2026-10-28',
  status: 'open', created: 1, order: 1, doneAt: null, externalId: null, label: 'work', goal: 'gexit', updatedAt: 5,
};

/** A client whose upserts answer with the given errors in turn, keeping what was sent. */
function fakeClient(errors: (string | null)[]) {
  const sent: Record<string, unknown>[][] = [];
  const sb = { from: () => ({ upsert: async (rows: Record<string, unknown>[]) => {
    sent.push(rows);
    const msg = errors[sent.length - 1];
    return { error: msg ? { message: msg } : null };
  } }) } as unknown as SupabaseClient;
  return { sb, sent };
}

describe('supabase rows', () => {
  it('round-trips the label and the goal', () => {
    expect(toRow(task, 'u').label).toBe('work');
    expect(toRow(task, 'u').goal).toBe('gexit');
    expect(fromRow(toRow(task, 'u'))).toEqual(task);
    expect(toRow({ ...task, label: undefined, goal: undefined }, 'u')).toMatchObject({ label: null, goal: null });
    // A row from before migration 0010 has no goal.
    const { goal: _, ...old } = toRow(task, 'u');
    expect(fromRow(old).goal).toBeNull();
  });

  it('still saves when the goal column is missing, and says how to fix it', async () => {
    const { sb, sent } = fakeClient(["Could not find the 'goal' column of 'tasks' in the schema cache", null]);
    await expect(supabaseRepo(sb, 'u').put([task])).rejects.toThrow(/Saved without goals.*0010/);
    expect(sent).toHaveLength(2);
    expect(sent[1][0]).not.toHaveProperty('goal');
    expect(sent[1][0]).toMatchObject({ id: 't1', label: 'work' });
  });

  it('drops both on a database from before labels', async () => {
    const { sb, sent } = fakeClient(["Could not find the 'goal' column of 'tasks'", "Could not find the 'label' column of 'tasks'", null]);
    await expect(supabaseRepo(sb, 'u').put([task])).rejects.toThrow(/Saved without goals or labels.*0010 and .*0006/);
    expect(sent).toHaveLength(3);
    expect(sent[2][0]).not.toHaveProperty('goal');
    expect(sent[2][0]).not.toHaveProperty('label');
  });

  it('still saves when the label column is missing, and says how to fix it', async () => {
    const { sb, sent } = fakeClient(["Could not find the 'label' column of 'tasks' in the schema cache", null]);
    await expect(supabaseRepo(sb, 'u').put([task])).rejects.toThrow(/Saved without labels.*0006/);
    expect(sent).toHaveLength(2);
    expect(sent[1][0]).not.toHaveProperty('label');
    expect(sent[1][0]).toMatchObject({ id: 't1', title: 'Board deck' });
  });

  it('reports other errors as before', async () => {
    const { sb, sent } = fakeClient(['permission denied for table tasks']);
    await expect(supabaseRepo(sb, 'u').put([task])).rejects.toThrow('Could not save: permission denied for table tasks');
    expect(sent).toHaveLength(1);
  });
});
