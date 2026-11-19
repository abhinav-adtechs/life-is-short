import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import type { Goal } from './goals';
import type { Repeat } from './repeat';
import { applyWorkflow, chartsForPrompt, normalizeOps, recordedIds, taskLinesFor, workflowPrompt, type WorkflowIds } from './workflow';

const NOW = new Date(2026, 10, 18, 12).getTime();
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null, status: 'open', created: 1, order: 1, doneAt: null, goal: 'gexit', label: 'sj', ...extra,
});
const exit: Goal = {
  id: 'gexit', title: 'Give Sam an exit', section: 'sj', by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1,
  results: [{ id: 'k1', text: 'Shares transferred', done: false }],
  plan: { links: [{ from: 'lawyer', to: 'spa' }], waits: [{ id: 'wfunds', title: 'Buyer’s funds', done: false, created: 1, doneAt: null }] },
};
const run: Goal = { id: 'grun', title: 'Run a half marathon', section: 'me', by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, results: [] };
const tasks = [task('lawyer', { title: 'Call the lawyer' }), task('spa', { title: 'Draft the SPA' }), task('sign', { title: 'Sign it' }), task('hair', { title: 'Book a haircut', goal: null, label: null })];
const runs: Repeat = {
  id: 'rrun', title: 'Run 5 km', notes: '', priority: 2, minutes: 45, label: 'me', goal: 'grun', time: null, from: '2026-11-09', made: '2026-11-18',
  rule: { freq: 'week', every: 1, days: [1, 3, 5], monthDay: null, times: 20 }, raw: '', created: 1, updatedAt: 1,
};
const taskRefs = new Map([['T1', 'lawyer'], ['T2', 'spa'], ['T3', 'sign'], ['T4', 'hair']]);
const st = { goals: [exit, run], tasks, repeats: [runs], now: NOW };
/** Ids in order, for steady tests. */
const ids = (): WorkflowIds => { let n = 0; const next = (p: string) => () => `${p}${++n}`; return { task: next('tnew'), goal: next('gnew'), kr: next('knew'), wait: next('wnew'), repeat: next('rnew') }; };
const refs = () => chartsForPrompt(st.goals, tasks, taskRefs, st.repeats, NOW).refs;

describe('what the model sees', () => {
  it('lists each goal’s chart with refs for every step', () => {
    const { lines, refs: r } = chartsForPrompt(st.goals, tasks, taskRefs, st.repeats, NOW);
    expect(lines).toEqual([
      '- gexit "Give Sam an exit"',
      '  key results: R1 "Shares transferred"',
      '  waiting on: W1 "Buyer’s funds"',
      '  open tasks on it: T1, T2, T3',
      '  arrows: T1 → T2',
      '- grun "Run a half marathon"',
      '  repeating: S1 "Run 5 km" (Every Mon, Wed and Fri, 20 times, 0 done)',
    ]);
    expect(r.waits.get('W1')).toEqual({ goal: 'gexit', id: 'wfunds' });
    expect(r.results.get('R1')).toEqual({ goal: 'gexit', id: 'k1' });
    expect(r.series.get('S1')).toEqual({ goal: 'grun', id: 'rrun' });
  });

  it('builds a prompt that knows which chart they’re on', () => {
    const { prompt } = workflowPrompt({ text: 'sign after the funds', now: NOW, goals: st.goals, tasks, repeats: st.repeats, focus: 'gexit', taskRefs, taskLines: taskLinesFor(tasks, taskRefs) });
    expect(prompt).toContain('They are looking at the chart of gexit "Give Sam an exit"');
    expect(prompt).toContain('T4 | Book a haircut | off-goal');
    expect(prompt).toContain('- link {from, to}');
    expect(prompt).toContain('"sign after the funds"');
  });

  it('cleans up what the model sends', () => {
    expect(normalizeOps([{ op: 'link', from: ' T1 ', to: 'T3' }, { op: 'nuke' }, { op: 'add_step', title: 'X', minutes: 50, priority: 7, by: 'soon' }, 'junk'])).toEqual([
      { op: 'link', from: 'T1', to: 'T3' }, { op: 'add_step', title: 'X', minutes: 45 },
    ]);
    expect(normalizeOps('nope')).toEqual([]);
  });
});

describe('applying it', () => {
  it('adds a step after another, with what waits on it, and an arrow from the funds', () => {
    const out = applyWorkflow(normalizeOps([
      { op: 'add_step', goal: 'gexit', title: 'Get board approval', after: 'T2', key: 'board', minutes: 60 },
      { op: 'link', from: 'board', to: 'T3' },
      { op: 'link', from: 'W1', to: 'T3' },
    ]), st, refs(), { ids: ids() });
    expect(out.writes).toMatchObject([{ id: 'tnew1', title: 'Get board approval', goal: 'gexit', label: 'sj', minutes: 60 }]);
    expect(out.goals[0].plan?.links).toEqual([
      { from: 'lawyer', to: 'spa' }, { from: 'spa', to: 'tnew1' }, { from: 'tnew1', to: 'sign' }, { from: 'wfunds', to: 'sign' },
    ]);
    expect(out.lines).toEqual([
      '“Give Sam an exit”: step “Get board approval” after “Draft the SPA”',
      '“Sign it” now waits on “Get board approval”',
      '“Sign it” now waits on “Buyer’s funds”',
    ]);
    expect(out.log.map(e => e.op)).toEqual(['link', 'link', 'link']);
    expect(out.skipped).toEqual([]);
  });

  it('defaults to the chart you’re on, finds steps by name, and brings an off-goal task in', () => {
    const out = applyWorkflow(normalizeOps([{ op: 'link', from: 'Book a haircut', to: 'Sign it' }, { op: 'add_wait', title: 'Sam’s signature', holds: 'T3' }]), st, refs(), { focus: 'gexit', ids: ids() });
    expect(out.writes).toMatchObject([{ id: 'hair', goal: 'gexit', label: 'sj' }]);
    expect(out.goals[0].plan?.waits.map(w => w.title)).toEqual(['Buyer’s funds', 'Sam’s signature']);
    expect(out.goals[0].plan?.links).toContainEqual({ from: 'wnew1', to: 'sign' });
  });

  it('looks names up on the operation’s own goal when no chart is in focus', () => {
    const op = { op: 'link' as const, from: 'Draft the SPA', to: 'Shares transferred' };
    // With no chart in focus and no goal on it, a key result named by its text isn't found.
    expect(applyWorkflow([op], st, refs(), { ids: ids() }).skipped).toEqual(['Couldn’t draw the arrow: there’s no step “Shares transferred”.']);
    const out = applyWorkflow([{ ...op, goal: 'gexit' }], st, refs(), { ids: ids() });
    expect(out.skipped).toEqual([]);
    expect(out.goals.find(g => g.id === 'gexit')?.plan?.links).toContainEqual({ from: 'spa', to: 'kr:k1' });
  });

  it('refuses loops and made-up refs, and says so', () => {
    const out = applyWorkflow(normalizeOps([{ op: 'link', from: 'T2', to: 'T1' }, { op: 'link', from: 'T9', to: 'T1' }, { op: 'unlink', from: 'T3', to: 'T1' }]), st, refs(), { ids: ids() });
    expect(out.goals[0].plan?.links).toEqual([{ from: 'lawyer', to: 'spa' }]);
    expect(out.skipped).toEqual([
      '“Call the lawyer” after “Draft the SPA” would make a loop.',
      'Couldn’t draw the arrow: there’s no step “T9”.',
      'Couldn’t take the arrow away: there’s no arrow from “Sign it” to “Call the lawyer”.',
    ]);
  });

  it('adds goals, sub-goals for a key result, and key results under each other', () => {
    const out = applyWorkflow(normalizeOps([
      { op: 'add_goal', parent: 'gexit', title: 'Get the board on side', for_result: 'R1', results: ['Every director briefed'], key: 'sub' },
      { op: 'add_result', goal: 'gexit', text: 'Board approves', under: 'R1' },
      { op: 'add_step', goal: 'sub', title: 'Send the directors the terms' },
      { op: 'add_goal', title: 'Learn Spanish', section: 'me' },
    ]), st, refs(), { ids: ids() });
    const sub = out.goals.find(g => g.title === 'Get the board on side');
    expect(sub).toMatchObject({ parent: 'gexit', parentKr: 'k1', section: 'sj' });
    expect(sub?.results.map(r => r.text)).toEqual(['Every director briefed']);
    expect(out.goals[0].results[0].results?.map(r => r.text)).toEqual(['Board approves']);
    expect(out.writes).toMatchObject([{ title: 'Send the directors the terms', goal: sub?.id }]);
    const es = out.goals.find(g => g.title === 'Learn Spanish');
    expect(es?.section).toBe('me');
    expect(es?.parent).toBeUndefined();
  });

  it('edits, ticks, removes and deletes steps of every kind', () => {
    const out = applyWorkflow(normalizeOps([
      { op: 'edit_step', ref: 'T2', title: 'Draft the share transfer agreement', priority: 1 },
      { op: 'edit_step', ref: 'W1', done: true },
      { op: 'edit_result', ref: 'R1', done: true },
      { op: 'remove_step', ref: 'T1' },
      { op: 'remove_step', ref: 'T3', delete: true },
      { op: 'edit_goal', goal: 'grun', by: '2027-04-01' },
    ]), st, refs(), { ids: ids() });
    expect(out.writes).toMatchObject([{ id: 'spa', title: 'Draft the share transfer agreement', priority: 1 }, { id: 'lawyer', goal: null }]);
    expect(out.removes).toEqual(['sign']);
    expect(out.goals[0].plan?.waits[0]).toMatchObject({ done: true, doneAt: NOW });
    expect(out.goals[0].results[0].done).toBe(true);
    expect(out.goals[0].plan?.links).toEqual([]);
    expect(out.goals[1].by).toBe('2027-04-01');
  });

  it('makes a repeating step, and works on a repeat’s series as one step', () => {
    const out = applyWorkflow(normalizeOps([
      { op: 'add_step', goal: 'grun', title: 'Check support tickets', repeat: { freq: 'week', per: 4 }, key: 'sup' },
      { op: 'link', from: 'S1', to: 'sup' },
      { op: 'edit_step', ref: 'S1', title: 'Run 6 km' },
    ]), st, refs(), { ids: ids() });
    expect(out.repeatOps).toMatchObject([
      { kind: 'set', repeat: { id: 'rnew1', title: 'Check support tickets', goal: 'grun', rule: { freq: 'week', per: 4, days: [] } } },
      { kind: 'set', repeat: { id: 'rrun', title: 'Run 6 km' } },
    ]);
    expect(out.writes).toMatchObject([{ id: 'rnew1.2026-11-18', goal: 'grun', due: '2026-11-22' }]);
    expect(out.goals[1].plan?.links).toEqual([{ from: 'rep:rrun', to: 'rep:rnew1' }]);
  });

  it('plays the same ids back, so the change lays over newer goals the same way', () => {
    const rec = recordedIds();
    const ops = normalizeOps([{ op: 'add_step', goal: 'gexit', title: 'New one' }, { op: 'add_wait', goal: 'gexit', title: 'A reply' }]);
    const a = applyWorkflow(ops, st, refs(), { ids: rec });
    const b = applyWorkflow(ops, st, refs(), { ids: rec.replay() });
    expect(b.writes.map(t => t.id)).toEqual(a.writes.map(t => t.id));
    expect(b.goals[0].plan?.waits.map(w => w.id)).toEqual(a.goals[0].plan?.waits.map(w => w.id));
  });
});
