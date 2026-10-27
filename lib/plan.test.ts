import { describe, expect, it } from 'vitest';
import { applyCapture, promptContext } from './capture';
import { changesOf, commitChanges, draftOf, kindOf, type Change } from './plan';
import type { Task } from './model';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(26, 13, 30);

let n = 0;
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: 'id' + n++, title, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});
const ids = () => { let i = 0; return () => 'new' + i++; };
const inverse = (refs: Map<string, string>) => new Map([...refs].map(([ref, id]) => [id, ref]));

/** A plan the way the chat builds one: the model's answer, applied to your tasks without writing anything. */
function plan(tasks: Task[], result: { add: unknown[]; update: unknown[] }) {
  const { refs } = promptContext(tasks);
  return { refs, changes: changesOf(applyCapture({ text: 'said', tasks, refs, result, via: 'ai', now: NOW, newId: ids() })) };
}

describe('changesOf and kindOf', () => {
  it('lists new tasks first and labels each change', () => {
    const photos = task('Passport photos');
    const dentist = task('Dentist', { start: at(28, 9) });
    const call = task('Call mum');
    const { changes } = plan([photos, dentist, call], {
      add: [{ title: 'Book a haircut', minutes: 30 }],
      update: [{ ref: 'T1', date: '2026-10-29', time: '16:00' }, { ref: 'T2', done: true }, { ref: 'T3', priority: 1 }],
    });
    expect(changes.map(c => [c.after.title, kindOf(c)])).toEqual([
      ['Book a haircut', 'add'], ['Dentist', 'move'], ['Passport photos', 'done'], ['Call mum', 'edit'],
    ]);
  });
});

describe('draftOf', () => {
  it('round-trips through the model unchanged', () => {
    const dentist = task('Dentist', { start: at(28, 9) });
    const report = task('Write the report', { notes: 'Q3 numbers' });
    const tasks = [dentist, report];
    const first = plan(tasks, {
      add: [
        { title: 'Call the plumber', priority: 1, minutes: 30, date: '2026-10-27', time: '09:00', notes: 'Boiler' },
        { title: 'Renew passport', minutes: 60, date: '2026-10-30', deadline: true },
        { title: 'Book a haircut', priority: 3, minutes: 45 },
      ],
      update: [{ ref: 'T1', date: '2026-10-29', time: '16:00' }, { ref: 'T2', notes: 'Ask Sam for the charts', priority: 1 }],
    });
    // The model keeps everything as it was: the same plan comes back.
    const draft = draftOf(first.changes, inverse(first.refs));
    const again = changesOf(applyCapture({ text: 'said', tasks, refs: first.refs, result: draft, via: 'ai', now: NOW, newId: ids(), revise: true }));
    expect(again.map(c => c.after)).toEqual(first.changes.map(c => c.after));
    expect(draft.update).toEqual([
      { ref: 'T1', date: '2026-10-29', time: '16:00', deadline: false },
      { ref: 'T2', priority: 1, notes: 'Ask Sam for the charts' },
    ]);
  });

  it('carries hand edits, leaves out skipped changes and tasks it has no ref for', () => {
    const dentist = task('Dentist', { start: at(28, 9) });
    const { refs, changes } = plan([dentist], {
      add: [{ title: 'A', minutes: 30 }, { title: 'B', minutes: 30 }],
      update: [{ ref: 'T1', unschedule: true }],
    });
    const edited: Change[] = changes.map(c => (c.after.title === 'A' ? { ...c, after: { ...c.after, title: 'A, edited', start: at(27, 10) } } : c));
    edited[1] = { ...edited[1], skip: true };
    expect(draftOf(edited, inverse(refs))).toEqual({
      add: [{ title: 'A, edited', priority: 2, minutes: 30, date: '2026-10-27', time: '10:00', deadline: false, notes: '' }],
      update: [{ ref: 'T1', unschedule: true }],
    });
    expect(draftOf(edited, new Map()).update).toEqual([]);
  });
});

describe('commitChanges', () => {
  it('lays edits over the task as it is now and skips what is gone or left out', () => {
    const dentist = task('Dentist', { start: at(28, 9) });
    const gone = task('Gone');
    const photos = task('Photos');
    const { changes } = plan([dentist, gone, photos], {
      add: [{ title: 'Call the plumber', minutes: 30, date: '2026-10-27', time: '09:00' }, { title: 'Left out' }],
      update: [{ ref: 'T1', date: '2026-10-29', time: '16:00' }, { ref: 'T2', done: true }, { ref: 'T3', done: true }],
    });
    const plan2 = changes.map(c => (c.after.title === 'Left out' ? { ...c, skip: true } : c));
    // Meanwhile, on another device: the dentist got notes, and "Gone" was deleted.
    const now = { ...dentist, notes: 'Bring the X-rays' };
    const later = NOW + 60000;
    const out = commitChanges(plan2, id => (id === dentist.id ? now : id === gone.id ? undefined : id === photos.id ? photos : undefined), later);
    expect(out.puts.map(t => t.title)).toEqual(['Call the plumber', 'Dentist', 'Photos']);
    expect(out.puts[1]).toMatchObject({ start: at(29, 16), notes: 'Bring the X-rays', updatedAt: later });
    expect(out.puts[2]).toMatchObject({ status: 'done', doneAt: later });
    expect(out.summary).toBe('On the calendar · Tomorrow, 9:00 AM · 1 updated · 1 ticked off');
  });
});

describe('applyCapture when revising', () => {
  it('takes an empty answer as "drop everything" instead of falling back to keywords', () => {
    const out = applyCapture({ text: 'never mind', tasks: [], refs: new Map(), result: { add: [], update: [] }, via: 'ai', now: NOW, newId: ids(), revise: true });
    expect(out.puts).toEqual([]);
    expect(out.via).toBe('ai');
  });
});
