import { describe, expect, it } from 'vitest';
import { normalizeImport } from './importer';

describe('normalizeImport', () => {
  it('copies the exported fields and drops prototype-only ones', () => {
    const [t] = normalizeImport([{
      id: 'a1', created: 1, doneAt: null, due: '2026-10-26', minutes: 10, notes: 'n', order: 2,
      priority: 1, raw: 'r', sorting: false, start: 1793002500000, status: 'open', title: 'Title',
    }]);
    expect(t).toEqual({
      id: 'a1', title: 'Title', raw: 'r', notes: 'n', priority: 1, minutes: 10, start: 1793002500000,
      due: '2026-10-26', status: 'open', created: 1, order: 2, doneAt: null, externalId: null,
    });
  });

  it('accepts an id-keyed object and skips junk', () => {
    const out = normalizeImport({ x: { title: 'From map', priority: 9, minutes: 'abc' }, y: { title: '' } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'x', title: 'From map', priority: 2, minutes: 30, start: null, status: 'open' });
  });
});
