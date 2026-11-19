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

  it('defaults to the chart you’re on and finds steps by name, but never pulls an off-goal task onto it by linking', () => {
    const out = applyWorkflow(normalizeOps([{ op: 'link', from: 'Book a haircut', to: 'Sign it' }, { op: 'add_wait', title: 'Sam’s signature', holds: 'T3' }]), st, refs(), { focus: 'gexit', ids: ids() });
    expect(out.writes).toEqual([]);
    expect(out.skipped).toEqual(['“Book a haircut” is off-goal, not on “Give Sam an exit”, so it can’t have an arrow there: arrows only join steps on the same goal, and drawing one doesn’t move a task. Put it on “Give Sam an exit” with move_step first if it belongs there.']);
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

describe('moving, reordering and deleting', () => {
  // A sub-goal on the exit's chart, for its key result, after the lawyer call, with tasks and a repeat of its own.
  const legal: Goal = { id: 'glegal', title: 'Close the lawyer’s side', section: 'sj', parent: 'gexit', parentKr: 'k1', by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, results: [] };
  const docs: Goal = { ...legal, id: 'gdocs', title: 'Get the documents', parent: 'glegal', parentKr: null };
  const exit2: Goal = { ...exit, results: [...exit.results, { id: 'k2', text: 'Paid', done: false }], plan: { ...exit.plan!, links: [...exit.plan!.links, { from: 'lawyer', to: 'goal:glegal' }] } };
  const legalTasks = [task('nda', { title: 'Sign the NDA', goal: 'glegal' }), task('ids', { title: 'Copy the IDs', goal: 'gdocs' }), task('old', { title: 'Old call', goal: 'glegal', status: 'done', doneAt: 5 }), task('gt', { title: 'From Google', goal: 'gdocs', externalId: 'gtask:list:1' })];
  const filing: Repeat = { ...runs, id: 'rfile', title: 'File the papers', goal: 'gdocs' };
  const s2 = { goals: [exit2, run, legal, docs], tasks: [...tasks, ...legalTasks], repeats: [runs, filing], now: NOW };
  // Refs go in tree order: S1 is the documents' filing, S2 the runs.
  const r2 = () => chartsForPrompt(s2.goals, s2.tasks, taskRefs, s2.repeats, NOW).refs;
  const apply = (ops: unknown[], opts = {}) => applyWorkflow(normalizeOps(ops), s2, r2(), { ids: ids(), ...opts });
  const byId = (goals: Goal[]) => new Map(goals.map(g => [g.id, g]));

  it('moves an existing goal under another, off its old parent’s chart, after a step on the new one', () => {
    const out = apply([{ op: 'move_goal', goal: 'glegal', parent: 'grun', after: 'S2' }]);
    // Its arrow on the exit's chart can't come along, and says so.
    expect(out.skipped).toEqual(['“Close the lawyer’s side”’s 1 arrow on “Give Sam an exit” was taken off: arrows only join steps on the same goal.']);
    const g = byId(out.goals);
    expect(g.get('glegal')).toMatchObject({ parent: 'grun', section: 'me' });
    expect(g.get('glegal')!.parentKr).toBeUndefined();
    expect(g.get('gdocs')).toMatchObject({ parent: 'glegal', section: 'me' });
    expect(g.get('gexit')!.plan!.links).toEqual([{ from: 'lawyer', to: 'spa' }]);
    expect(g.get('grun')!.plan!.links).toEqual([{ from: 'rep:rrun', to: 'goal:glegal' }]);
    expect(out.lines).toEqual(['“Close the lawyer’s side” is under “Run a half marathon” now, after “Run 5 km”']);
    expect(out.log.map(e => [e.goal, e.op])).toEqual([['gexit', 'remove'], ['grun', 'add'], ['grun', 'link']]);
  });

  it('makes a sub-goal a top goal, ranked, in a section; and back under a key result', () => {
    const top = apply([{ op: 'move_goal', goal: 'Close the lawyer’s side', parent: null, rank: 1, section: 'me' }]);
    expect(top.goals.filter(g => !g.parent && g.status === 'active').map(g => g.id)).toEqual(['glegal', 'gexit', 'grun']);
    expect(byId(top.goals).get('glegal')).toMatchObject({ section: 'me' });
    expect(top.lines).toEqual(['“Close the lawyer’s side” is a top goal now, in “me”, ranked 1']);
    const back = applyWorkflow(normalizeOps([{ op: 'move_goal', goal: 'glegal', parent: 'gexit', for_result: 'Paid' }]), { ...s2, goals: top.goals }, r2(), { ids: ids() });
    expect(byId(back.goals).get('glegal')).toMatchObject({ parent: 'gexit', parentKr: 'k2', section: 'sj' });
    expect(back.lines).toEqual(['“Close the lawyer’s side” is under “Give Sam an exit” now, for “Paid”']);
  });

  it('changes the key result a sub-goal serves, or serves the goal as a whole', () => {
    const out = apply([{ op: 'move_goal', goal: 'glegal', for_result: 'R2' }]);
    expect(byId(out.goals).get('glegal')!.parentKr).toBe('k2');
    expect(out.lines).toEqual(['“Close the lawyer’s side” serves “Paid” now']);
    const whole = apply([{ op: 'move_goal', goal: 'glegal', for_result: null }]);
    expect(byId(whole.goals).get('glegal')!.parentKr).toBeUndefined();
    expect(whole.lines).toEqual(['“Close the lawyer’s side” serves “Give Sam an exit” as a whole now']);
    // Its arrows on the parent's chart stay: it didn't move.
    expect(byId(whole.goals).get('gexit')!.plan!.links).toContainEqual({ from: 'lawyer', to: 'goal:glegal' });
  });

  it('moves a sub-goal by dragging it, as a step, onto another goal’s chart', () => {
    const out = apply([{ op: 'move_step', ref: 'glegal', goal: 'grun' }]);
    expect(byId(out.goals).get('glegal')!.parent).toBe('grun');
    expect(out.skipped).toEqual(['“Close the lawyer’s side”’s 1 arrow on “Give Sam an exit” was taken off: arrows only join steps on the same goal.']);
  });

  it('refuses moves that would loop, go too deep, overfill the top or hide an open goal', () => {
    const out = apply([
      { op: 'move_goal', goal: 'gexit', parent: 'gdocs' },
      { op: 'move_goal', goal: 'glegal', parent: 'gnope' },
      { op: 'move_goal', goal: 'glegal', parent: 'grun', for_result: 'Nope' },
    ]);
    expect(out.goals).toBe(s2.goals);
    expect(out.skipped).toEqual([
      'Couldn’t move the goal: “Get the documents” is under “Give Sam an exit”, so “Give Sam an exit” can’t go under it.',
      'Couldn’t move the goal: there’s no goal gnope to put it under.',
      'Couldn’t move the goal: “Run a half marathon” has no key result “Nope”.',
    ]);
    const full = { ...s2, goals: [...s2.goals, ...Array.from({ length: 6 }, (_, i): Goal => ({ ...run, id: `gt${i}`, title: `Top ${i}` }))] };
    expect(applyWorkflow(normalizeOps([{ op: 'move_goal', goal: 'glegal', parent: null }]), full, r2(), { ids: ids() }).skipped)
      .toEqual(['Couldn’t move the goal: 8 top goals at once is the most; achieve or drop one first.']);
    const dropped = { ...s2, goals: s2.goals.map(g => (g.id === 'grun' ? { ...g, status: 'dropped' as const, closedAt: 2 } : g)) };
    expect(applyWorkflow(normalizeOps([{ op: 'move_goal', goal: 'glegal', parent: 'grun' }]), dropped, r2(), { ids: ids() }).skipped)
      .toEqual(['Couldn’t move the goal: “Run a half marathon” is dropped; bring it back first.']);
  });

  it('won’t bring a goal back past 8 top goals, which would drop another', () => {
    const full = { ...s2, goals: [...s2.goals.map(g => (g.id === 'grun' ? { ...g, status: 'dropped' as const, closedAt: 2 } : g)), ...Array.from({ length: 7 }, (_, i): Goal => ({ ...run, id: `gt${i}`, title: `Top ${i}` }))] };
    const out = applyWorkflow(normalizeOps([{ op: 'edit_goal', goal: 'grun', status: 'active' }]), full, r2(), { ids: ids() });
    expect(out.skipped).toEqual(['Couldn’t change the goal: 8 top goals at once is the most; achieve or drop one first.']);
    expect(out.goals).toBe(full.goals);
  });

  it('sets a top goal’s section, by its name for the lines, and not a sub-goal’s', () => {
    const out = applyWorkflow(normalizeOps([{ op: 'edit_goal', goal: 'gexit', section: 'me' }, { op: 'edit_goal', goal: 'glegal', section: 'me' }]), { ...s2, labels: new Map([['me', 'Personal']]) }, r2(), { ids: ids() });
    const g = byId(out.goals);
    expect(g.get('gexit')!.section).toBe('me');
    // Its sub-goals go with it.
    expect(g.get('gdocs')!.section).toBe('me');
    expect(out.lines).toEqual(['“Give Sam an exit”, in “Personal”']);
    expect(out.skipped).toEqual(['“Close the lawyer’s side” is a sub-goal, so it’s in its top goal’s section; change that goal’s, or move it to the top.']);
  });

  it('deletes a goal for good with its sub-goals: open tasks go off-goal, done ones stay, repeats go off-goal', () => {
    const out = apply([{ op: 'delete_goal', goal: 'glegal' }]);
    expect(out.goals.map(g => g.id)).toEqual(['gexit', 'grun']);
    expect(out.goals[0].plan!.links).toEqual([{ from: 'lawyer', to: 'spa' }]);
    expect(out.removes).toEqual([]);
    expect(out.writes.map(t => [t.id, t.goal])).toEqual([['nda', null], ['ids', null], ['gt', null]]);
    expect(out.repeatOps).toMatchObject([{ kind: 'set', repeat: { id: 'rfile', goal: null } }]);
    expect(out.lines).toEqual(['Deleted “Close the lawyer’s side” and 1 sub-goal under it; 3 open tasks off-goal now']);
    expect(out.log).toMatchObject([{ goal: 'gexit', op: 'remove', step: 'goal:glegal' }]);
  });

  it('deletes a goal with its open tasks when asked, stopping its repeats, but not Google’s', () => {
    const out = apply([{ op: 'delete_goal', goal: 'glegal', with_tasks: true }]);
    expect(out.removes.sort()).toEqual(['ids', 'nda']);
    expect(out.writes.map(t => [t.id, t.goal])).toEqual([['gt', null]]);
    expect(out.repeatOps).toEqual([{ kind: 'stop', id: 'rfile' }]);
    expect(out.lines).toEqual(['Deleted “Close the lawyer’s side” and 1 sub-goal under it; 2 open tasks deleted; 1 repeating task stopped; 1 open task off-goal now (1 from Google, which can’t be deleted here)']);
  });

  it('deletes a sub-goal from its parent’s chart with remove_step and delete; without, drops it', () => {
    expect(apply([{ op: 'remove_step', ref: 'glegal', delete: true }]).goals.map(g => g.id)).toEqual(['gexit', 'grun']);
    const dropped = apply([{ op: 'remove_step', ref: 'glegal' }]);
    expect(byId(dropped.goals).get('glegal')!.status).toBe('dropped');
    expect(applyWorkflow(normalizeOps([{ op: 'remove_step', ref: 'glegal' }]), { ...s2, goals: dropped.goals }, r2(), { ids: ids() }).skipped)
      .toEqual(['Couldn’t remove the step: “Close the lawyer’s side” is already dropped; delete true deletes it.']);
  });

  it('finds a closed goal by its title, to delete or bring it back', () => {
    const closed = { ...s2, goals: s2.goals.map(g => (g.id === 'grun' ? { ...g, status: 'achieved' as const, closedAt: 2 } : g)) };
    expect(applyWorkflow(normalizeOps([{ op: 'delete_goal', goal: 'Run a half marathon' }]), closed, r2(), { ids: ids() }).goals.map(g => g.id)).not.toContain('grun');
  });

  it('moves and reorders key results, and takes a removed one’s children off the chart too', () => {
    const nested: Goal = { ...exit2, results: [{ id: 'k1', text: 'Shares transferred', done: false, results: [{ id: 'k1a', text: 'Board approves', done: false }] }, { id: 'k2', text: 'Paid', done: false }], plan: { ...exit2.plan!, links: [...exit2.plan!.links, { from: 'spa', to: 'kr:k1a' }] } };
    const s3 = { ...s2, goals: [nested, run] };
    const r3 = chartsForPrompt(s3.goals, s3.tasks, taskRefs, s3.repeats, NOW).refs;
    const out = applyWorkflow(normalizeOps([
      { op: 'move_result', ref: 'Paid', goal: 'gexit', under: 'Shares transferred' },
      { op: 'move_result', ref: 'Board approves', goal: 'gexit', under: null, rank: 1 },
    ]), s3, r3, { ids: ids() });
    expect(out.skipped).toEqual([]);
    expect(out.goals[0].results).toEqual([
      { id: 'k1a', text: 'Board approves', done: false },
      { id: 'k1', text: 'Shares transferred', done: false, results: [{ id: 'k2', text: 'Paid', done: false }] },
    ]);
    expect(out.lines).toEqual(['Key result “Paid” is under “Shares transferred” now', 'Key result “Board approves” is first at the top now']);
    const last = applyWorkflow(normalizeOps([{ op: 'move_result', ref: 'Shares transferred', goal: 'gexit', rank: 9 }]), s3, r3, { ids: ids() });
    expect(last.lines).toEqual(['Key result “Shares transferred” is number 2 now']);
    expect(applyWorkflow(normalizeOps([{ op: 'move_result', ref: 'Shares transferred', goal: 'gexit', under: 'Board approves' }]), s3, r3, { ids: ids() }).skipped)
      .toEqual(['Couldn’t move the key result: a key result can’t go under itself or one under it.']);
    const gone = applyWorkflow(normalizeOps([{ op: 'remove_step', ref: 'Shares transferred', goal: 'gexit' }]), s3, r3, { ids: ids() });
    expect(gone.goals[0].results.map(r => r.id)).toEqual(['k2']);
    expect(gone.goals[0].plan!.links).not.toContainEqual({ from: 'spa', to: 'kr:k1a' });
  });

  it('changes how a repeating step repeats', () => {
    const out = apply([{ op: 'edit_step', ref: 'S2', repeat: { freq: 'week', days: ['tue', 'thu'], times: 30 } }, { op: 'edit_step', ref: 'T1', repeat: { freq: 'day' } }]);
    expect(out.repeatOps).toMatchObject([{ kind: 'set', repeat: { id: 'rrun', rule: { freq: 'week', every: 1, days: [2, 4], times: 30 } } }]);
    expect(out.lines[0]).toBe('“Run 5 km” every Tue and Thu, 30 times');
    expect(out.skipped).toEqual(['“Call the lawyer” isn’t a repeating task: add a repeating step for that.']);
  });

  it('moves a waiting step to another goal, and refs to it keep working in the same call', () => {
    const out = apply([{ op: 'move_step', ref: 'W1', goal: 'grun' }, { op: 'link', from: 'W1', to: 'S2' }]);
    const g = byId(out.goals);
    expect(g.get('gexit')!.plan!.waits).toEqual([]);
    expect(g.get('grun')!.plan!.waits.map(w => w.id)).toEqual(['wfunds']);
    expect(g.get('grun')!.plan!.links).toEqual([{ from: 'wfunds', to: 'rep:rrun' }]);
  });

  it('cleans up the new fields', () => {
    expect(normalizeOps([{ op: 'move_goal', goal: 'g', parent: null, for_result: null, rank: 2.4, with_tasks: 'yes' }, { op: 'delete_goal', goal: 'g', with_tasks: true, rank: 0 }])).toEqual([
      { op: 'move_goal', goal: 'g', parent: null, for_result: null, rank: 2 }, { op: 'delete_goal', goal: 'g', with_tasks: true },
    ]);
  });
});
