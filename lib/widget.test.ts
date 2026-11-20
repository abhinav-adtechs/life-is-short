import { describe, expect, it } from 'vitest';
import type { Task } from './model';
import { focusOrder } from './select';
import { MAX_BACKLOG, TITLE_MAX, widgetKey, widgetLook, widgetSnapshot, type WidgetInput } from './widget';

const NOW = new Date(2026, 10, 20, 10, 50).getTime();
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 20 + dayOffset, h, m).getTime();

let n = 0;
function task(p: Partial<Task>): Task {
  n += 1;
  return { id: `t${n}`, title: `Task ${n}`, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null, status: 'open', created: 0, order: n, doneAt: null, ...p };
}

const goals = new Map([['g1', { title: 'Ship v2 of the app' }], ['g2', { title: 'Launch the podcast' }]]);
const colours = new Map([['g1', '#3e63dd'], ['g2', '#D6409F']]);

function input(tasks: Task[], extra: Partial<WidgetInput> = {}): WidgetInput {
  const blocked = extra.blocked ?? new Set<string>();
  return {
    tasks, blocked, now: NOW,
    backlog: focusOrder(tasks.filter(t => !t.externalId), undefined, t => blocked.has(t.id)),
    goalOf: t => (t.goal ? goals.get(t.goal) ?? null : null),
    colorOf: t => (t.goal ? colours.get(t.goal) : null),
    today: { done: 2, total: 7 },
    outcomes: null,
    theme: null,
    accent: { light: '#0A7DB2', dark: '#F2A541', picked: false },
    hours: { start: 9, end: 21 },
    ...extra,
  };
}

describe('widgetSnapshot', () => {
  it('carries the calendar from a missed slot’s grace to the end of tomorrow, then the backlog in Now’s order', () => {
    const live = task({ title: 'Fix the onboarding crash', start: at(10, 30), minutes: 60, priority: 1, goal: 'g1' });
    const missed = task({ title: 'Reply to Sam', start: at(9, 30), minutes: 30 });
    const gone = task({ title: 'Stand-up', start: at(8), minutes: 30 });
    const later = task({ title: 'Book 3 guests', start: at(12), minutes: 30, goal: 'g2' });
    const tomorrow = task({ title: 'Record episode 1', start: at(14, 30, 1), minutes: 90, goal: 'g2' });
    const farOff = task({ title: 'Dentist', start: at(9, 0, 2), minutes: 60 });
    const done = task({ title: 'Done already', start: at(11), status: 'done', doneAt: at(10) });
    const meeting = task({ title: 'Design review', start: at(15), minutes: 60, externalId: 'gcal:primary:abc' });
    const first = task({ title: 'Cut a trailer', priority: 1, goal: 'g2' });
    const held = task({ title: 'Submit the feed', priority: 1, goal: 'g2' });
    const third = task({ title: 'Call the plumber', priority: 3 });
    const s = widgetSnapshot(input([live, missed, gone, later, tomorrow, farOff, done, meeting, first, held, third], { blocked: new Set([held.id]) }));

    expect(s.items.map(i => i.title)).toEqual([
      'Reply to Sam', 'Fix the onboarding crash', 'Book 3 guests', 'Design review', 'Record episode 1',
      'Cut a trailer', 'Call the plumber', 'Submit the feed',
    ]);
    expect(s.items[1]).toEqual({ id: live.id, title: 'Fix the onboarding crash', start: at(10, 30), minutes: 60, priority: 1, goal: 'Ship v2 of the app', color: '#3E63DD' });
    expect(s.items.find(i => i.title === 'Design review')).toMatchObject({ event: true, start: at(15) });
    expect(s.items.find(i => i.title === 'Submit the feed')).toMatchObject({ blocked: true });
    expect(s.items.find(i => i.title === 'Cut a trailer')).not.toHaveProperty('start');
    expect(s.day).toBe('2026-11-20');
    expect(s.at).toBe(NOW);
    expect(s.today).toEqual({ done: 2, total: 7 });
    expect(s.outcomes).toBeNull();
  });

  it('keeps it small: titles cleaned and capped, the backlog’s top only', () => {
    const long = task({ title: `  So   much\nto  say ${'x'.repeat(200)}` });
    const rest = Array.from({ length: 20 }, () => task({}));
    const s = widgetSnapshot(input([long, ...rest]));
    expect(s.items).toHaveLength(MAX_BACKLOG);
    expect(s.items[0].title.startsWith('So much to say x')).toBe(true);
    expect(s.items[0].title).toHaveLength(TITLE_MAX);
    expect(widgetSnapshot(input([task({ title: '   ' })])).items[0].title).toBe('Untitled');
  });

  it('brings today’s outcomes, cleaned', () => {
    const s = widgetSnapshot(input([], { outcomes: [{ goal: 'Ship v2', color: '#3e63dd', text: '  Crash fixed  and the build in ', done: 1, steps: 2 }, { goal: 'Podcast', color: 'blue', text: 'Guests booked', done: 0, steps: 0 }] }));
    expect(s.outcomes).toEqual([
      { goal: 'Ship v2', color: '#3E63DD', text: 'Crash fixed and the build in', done: 1, steps: 2 },
      { goal: 'Podcast', text: 'Guests booked', done: 0, steps: 0 },
    ]);
  });

  it('says how the planner looks, light and dark', () => {
    expect(widgetLook(null)).toEqual({ light: 'tide', dark: 'night' });
    expect(widgetLook('tide')).toEqual({ light: 'tide', dark: 'night' });
    expect(widgetLook('day')).toEqual({ light: 'day', dark: 'night' });
    expect(widgetLook('night')).toEqual({ light: 'night', dark: 'night' });
    const own = widgetSnapshot(input([], { theme: 'day', accent: { light: '#3e63dd', dark: '#3e63dd', picked: true } }));
    expect(own.look).toEqual({ light: 'day', dark: 'night', accentLight: '#3E63DD', accentDark: '#5B7AE2' });
    expect(widgetSnapshot(input([])).look).toEqual({ light: 'tide', dark: 'night', accentLight: '#0A7DB2', accentDark: '#F2A541' });
  });

  it('matches itself whenever it was made, so an unchanged day isn’t sent again', () => {
    const tasks = [task({ title: 'Same', start: at(12) })];
    const a = widgetSnapshot(input(tasks));
    const b = widgetSnapshot({ ...input(tasks), now: NOW + 60000 });
    expect(widgetKey(a)).toBe(widgetKey(b));
    expect(widgetKey(a)).not.toBe(widgetKey(widgetSnapshot(input([task({ title: 'Other', start: at(12) })]))));
    expect(widgetKey(null)).toBe('none');
  });
});
