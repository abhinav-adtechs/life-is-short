import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, MAX_LABELS, labelNamed, normalizeLabels, pickLabel, resolveLabel, type Label } from './labels';
import { groupBacklog, timeBucket } from './select';
import { applyCapture, promptContext } from './capture';
import { buildPrompt } from './prompt';
import { localParse } from './parse';
import { DEFAULT_PREFS, normalizePrefs } from './prefs';
import type { Task } from './model';

const L: Label[] = [
  { id: 'work', name: 'Superjoin', color: '#3E63DD' },
  { id: 'side', name: 'Series N', color: '#8E4EC6' },
  { id: 'personal', name: 'Personal', color: '#12A594' },
  { id: 'others', name: 'Helping others', color: '#D6409F' },
];
const byId = new Map(L.map(l => [l.id, l]));

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
// Tuesday 27 October 2026, 13:30.
const NOW = at(27, 13, 30);

let n = 0;
const task = (title: string, extra: Partial<Task> = {}): Task => ({
  id: 'id' + n++, title, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null,
  status: 'open', created: 0, order: n, doneAt: null, ...extra,
});

describe('labels', () => {
  it('starts everyone with a starter set, and keeps a list you emptied empty', () => {
    expect(normalizeLabels(undefined)).toEqual(DEFAULT_LABELS);
    expect(normalizeLabels([])).toEqual([]);
  });

  it('cleans what is stored: bad ids, blank names, duplicates and colours', () => {
    const out = normalizeLabels([
      { id: 'a', name: '  Deep   work ', color: '#abcdef' }, { id: 'a', name: 'Again' }, { id: 'b c', name: 'Bad id' },
      { id: 'c', name: '   ' }, { id: 'd', name: 'No colour', color: 'red' }, null,
    ]);
    expect(out).toEqual([{ id: 'a', name: 'Deep work', color: '#ABCDEF' }, { id: 'd', name: 'No colour', color: expect.stringMatching(/^#[0-9A-F]{6}$/) }]);
    expect(normalizeLabels(Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, name: `L${i}` })))).toHaveLength(MAX_LABELS);
  });

  it('takes a task’s own label, else its calendar’s, else its account’s', () => {
    const src = { account: { label: 'work' }, calendar: { label: 'personal' } };
    expect(resolveLabel({ label: 'others' }, byId, src)?.id).toBe('others');
    expect(resolveLabel({ label: null }, byId, src)?.id).toBe('personal');
    expect(resolveLabel({}, byId, { account: { label: 'work' }, calendar: { label: null } })?.id).toBe('work');
    expect(resolveLabel({}, byId, { account: { label: 'work' }, calendar: null })?.id).toBe('work');
    expect(resolveLabel({ label: 'side' }, byId)?.id).toBe('side');
    expect(resolveLabel({}, byId)).toBeNull();
  });

  it('treats a removed label as none, so the next one down applies', () => {
    expect(resolveLabel({ label: 'gone' }, byId, { account: { label: 'work' }, calendar: null })?.id).toBe('work');
    expect(resolveLabel({ label: 'gone' }, byId)).toBeNull();
  });

  it('finds a label by name, id or first word', () => {
    expect(labelNamed(L, 'superjoin')?.id).toBe('work');
    expect(labelNamed(L, 'SeriesN')?.id).toBe('side');
    expect(labelNamed(L, 'series-n')?.id).toBe('side');
    expect(labelNamed(L, 'helping')?.id).toBe('others');
    expect(labelNamed(L, 'personal')?.id).toBe('personal');
    expect(labelNamed(L, 'gym')).toBeNull();
    expect(pickLabel(L, 'side')).toBe('side');
    expect(pickLabel(L, 'Helping others')).toBe('others');
    expect(pickLabel(L, 'nope')).toBeNull();
    expect(pickLabel(L, 42)).toBeNull();
  });
});

describe('time axis', () => {
  it('puts a due date in its stretch of time, weeks starting Monday', () => {
    expect(timeBucket(null, NOW)).toBe('anytime');
    expect(timeBucket('2026-10-26', NOW)).toBe('overdue');
    expect(timeBucket('2026-10-27', NOW)).toBe('today');
    expect(timeBucket('2026-11-01', NOW)).toBe('week');
    expect(timeBucket('2026-11-02', NOW)).toBe('next');
    expect(timeBucket('2026-11-08', NOW)).toBe('next');
    expect(timeBucket('2026-11-09', NOW)).toBe('later');
  });

  it('follows the first day of the week', () => {
    expect(timeBucket('2026-11-01', NOW, 0)).toBe('next');
    expect(timeBucket('2026-10-31', NOW, 0)).toBe('week');
  });
});

describe('groupBacklog', () => {
  const labelOf = (t: Task) => (t.label ? byId.get(t.label) ?? null : null);
  const o = { labels: L, labelOf, now: NOW };
  const deck = task('Board deck', { label: 'work', due: '2026-10-27' });
  const pr = task('Review PR', { label: 'work' });
  const spec = task('Write spec', { label: 'work', due: '2026-10-29' });
  const mom = task('Call mom', { label: 'personal' });
  const loose = task('Unsorted thing');
  const mentor = task('Mentor call', { label: 'others', due: '2026-10-29' });
  const list = [deck, pr, spec, mom, loose, mentor];

  it('by label: a section per label in your order, split by time, unlabelled last', () => {
    const g = groupBacklog(list, 'label', o);
    expect(g.map(x => [x.name, x.count])).toEqual([['Superjoin', 3], ['Personal', 1], ['Helping others', 1], ['No label', 1]]);
    expect(g[0].color).toBe('#3E63DD');
    expect(g[0].subs.map(s => [s.name, s.tasks.map(t => t.title)])).toEqual([
      ['Today', ['Board deck']], ['This week', ['Write spec']], ['Anytime', ['Review PR']],
    ]);
    expect(g[1].subs).toHaveLength(1);
  });

  it('by time: a section per stretch of time, labels kept together in your order', () => {
    const g = groupBacklog(list, 'time', o);
    expect(g.map(x => x.name)).toEqual(['Today', 'This week', 'Anytime']);
    expect(g[1].subs[0].tasks.map(t => t.title)).toEqual(['Write spec', 'Mentor call']);
    expect(g[2].subs[0].tasks.map(t => t.title)).toEqual(['Review PR', 'Call mom', 'Unsorted thing']);
  });

  it('by priority: as before', () => {
    const g = groupBacklog([task('A', { priority: 3 }), task('B', { priority: 1 })], 'priority', o);
    expect(g.map(x => [x.name, x.count])).toEqual([['Urgent', 1], ['Later', 1]]);
  });

  it('goes by the label a Google event takes from its calendar', () => {
    const ev = task('Standup', { externalId: 'gcal:work@x:1' });
    const g = groupBacklog([ev], 'label', { ...o, labelOf: t => (t.externalId ? byId.get('work')! : null) });
    expect(g.map(x => x.key)).toEqual(['work']);
  });
});

describe('labels in prefs', () => {
  it('defaults to labels, the label grouping and label colours', () => {
    expect(DEFAULT_PREFS).toMatchObject({ labels: DEFAULT_LABELS, backlogBy: 'label', colorBy: 'label' });
    expect(normalizePrefs({ backlogBy: 'time' }).backlogBy).toBe('time');
    expect(normalizePrefs({ backlogBy: 'size' }).backlogBy).toBe('label');
  });

  it('moves the old default, account colours, to label colours once', () => {
    expect(normalizePrefs({ colorBy: 'account' }).colorBy).toBe('label');
    expect(normalizePrefs({ colorBy: 'account', labels: [] }).colorBy).toBe('account');
    expect(normalizePrefs({ colorBy: 'calendar' }).colorBy).toBe('calendar');
  });
});

describe('labels when capturing', () => {
  it('lists your labels and each task’s label for the model', () => {
    const t = task('Board deck', { label: 'work' });
    const { ctx } = promptContext([t]);
    expect(ctx[0].label).toBe('work');
    const p = buildPrompt('call mom', NOW, ctx, undefined, L);
    expect(p).toContain('work = Superjoin, side = Series N, personal = Personal, others = Helping others');
    expect(p).toContain('| due | label)');
    expect(p).toMatch(/T1 \| P2 \| Board deck \| backlog \| - \| work/);
    expect(p).toContain('"label": the id of the label');
    expect(buildPrompt('x', NOW)).toContain('"label": null');
  });

  it('keeps the model’s label when it is one of yours, by id or by name', () => {
    const out = applyCapture({
      text: 'x', tasks: [], refs: new Map(), labels: L, via: 'ai', now: NOW,
      result: { add: [
        { title: 'Ship it', priority: 2, minutes: 30, date: null, time: null, deadline: false, notes: '', label: 'side' },
        { title: 'Mentor', priority: 2, minutes: 30, date: null, time: null, deadline: false, notes: '', label: 'Helping others' },
        { title: 'Odd', priority: 2, minutes: 30, date: null, time: null, deadline: false, notes: '', label: 'made-up' },
      ], update: [] },
    });
    expect(out.added.map(t => t.label)).toEqual(['side', 'others', null]);
  });

  it('relabels an existing task through an update', () => {
    const t = task('Gym', { label: 'work' });
    const { refs } = promptContext([t]);
    const out = applyCapture({ text: 'gym is personal', tasks: [t], refs, labels: L, via: 'ai', now: NOW, result: { add: [], update: [{ ref: 'T1', label: 'personal' }] } });
    expect(out.puts[0]).toMatchObject({ id: t.id, label: 'personal' });
    expect(out.summary).toBe('1 updated');
  });

  it('names the label when one task lands', () => {
    const out = applyCapture({
      text: 'x', tasks: [], refs: new Map(), labels: L, via: 'ai', now: NOW,
      result: { add: [{ title: 'Call mom', priority: 2, minutes: 30, date: null, time: null, deadline: false, notes: '', label: 'personal' }], update: [] },
    });
    expect(out.summary).toBe('In the backlog · Personal · Important');
  });

  it('reads a #tag without the AI and leaves it out of the title', () => {
    expect(localParse('#superjoin send the investor update', NOW, L)[0]).toMatchObject({ title: 'Send the investor update', label: 'work' });
    expect(localParse('mentor call with Priya tomorrow at 5pm #helping', NOW, L)[0]).toMatchObject({ title: 'Mentor call with Priya', label: 'others', time: '17:00' });
    expect(localParse('fix the #hashtag bug', NOW, L)[0]).toMatchObject({ title: 'Fix the #hashtag bug', label: null });
    const out = applyCapture({ text: 'renew passport #personal', tasks: [], refs: new Map(), labels: L, result: null, via: 'no-key', now: NOW });
    expect(out.added[0]).toMatchObject({ title: 'Renew passport', label: 'personal' });
  });
});
