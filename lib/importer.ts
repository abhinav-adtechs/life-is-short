import type { Priority, Task } from './model';

/** Accepts an exported tasks file (the prototype's format) and returns clean tasks. Unknown fields are dropped. */
export function normalizeImport(data: unknown): Task[] {
  const list = Array.isArray(data) ? data
    : data && typeof data === 'object' ? Object.entries(data as Record<string, object>).map(([id, t]) => ({ id, ...t }))
    : [];
  const out: Task[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const id = typeof t.id === 'string' && t.id ? t.id : null;
    const title = String(t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!id || !title) continue;
    const num = (v: unknown) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
    const created = num(t.created) ?? Date.now();
    out.push({
      id, title,
      raw: String(t.raw ?? ''), notes: String(t.notes ?? ''),
      priority: ([1, 2, 3].includes(Number(t.priority)) ? Number(t.priority) : 2) as Priority,
      minutes: Math.min(480, Math.max(10, Math.round(num(t.minutes) ?? 30))),
      start: num(t.start),
      due: typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : null,
      status: t.status === 'done' ? 'done' : 'open',
      created, order: num(t.order) ?? created, doneAt: num(t.doneAt),
      externalId: typeof t.externalId === 'string' ? t.externalId : null,
    });
  }
  return out;
}
