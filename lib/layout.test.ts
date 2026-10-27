import { describe, expect, it } from 'vitest';
import { CAL_MIN, DEFAULT_SPLIT, MATRIX_MIN, SNAP, calendarWidth, daysFor, matrixLayout, snapWidth } from './layout';
import { DEFAULT_LABELS, DEFAULT_LENS, DEFAULT_PRESETS, inLens, lensIds, normalizeLens, normalizePresets, sameLens, toggleLensLabel, usablePresets } from './labels';
import { DEFAULT_PREFS, normalizePrefs, syncable } from './prefs';
import { stepDay, viewDays, viewTitle } from './calview';

const P = { weekStart: 1, fiveDay: 'workweek', weekNumbers: false } as const;

describe('the split', () => {
  it('fits as many days as the calendar has room for, and each snap width holds its own count', () => {
    expect(daysFor(380)).toBe(1);
    expect(daysFor(620)).toBe(3);
    expect(daysFor(820)).toBe(5);
    expect(daysFor(1020)).toBe(7);
    for (const [d, w] of Object.entries(SNAP)) expect(daysFor(w)).toBe(Number(d));
  });

  it('starts pinned to 3 days', () => {
    expect(DEFAULT_SPLIT).toEqual({ mode: 'pinned', cal: SNAP[3] });
    expect(daysFor(calendarWidth(1440, DEFAULT_SPLIT, 3))).toBe(3);
  });

  it('in Auto, gives the calendar what the backlog columns leave: fewer priorities, more days', () => {
    const auto = { mode: 'auto', cal: 0 } as const;
    expect(daysFor(calendarWidth(1440, auto, 3))).toBe(3);
    expect(daysFor(calendarWidth(1440, auto, 2))).toBe(5);
    expect(daysFor(calendarWidth(1440, auto, 1))).toBe(7);
  });

  it('keeps both sides a minimum, whatever was pinned', () => {
    expect(calendarWidth(1200, { mode: 'pinned', cal: 2000 }, 3)).toBe(1200 - MATRIX_MIN);
    expect(calendarWidth(1200, { mode: 'pinned', cal: 100 }, 3)).toBe(CAL_MIN);
    expect(calendarWidth(700, { mode: 'pinned', cal: 600 }, 3)).toBe(CAL_MIN);
  });

  it('settles a dragged divider on a nearby day count, and leaves it elsewhere', () => {
    expect(snapWidth(650)).toBe(620);
    expect(snapWidth(790)).toBe(820);
    expect(snapWidth(720)).toBe(720);
  });
});

describe('matrix density', () => {
  it('goes cards, titles, then counts as it narrows', () => {
    expect(matrixLayout(904, [1, 2, 3], 'counts')).toMatchObject({ density: 'cards', open: [1, 2, 3], folded: [] });
    expect(matrixLayout(620, [1, 2, 3], 'counts')).toMatchObject({ density: 'titles', headW: 118 });
    expect(matrixLayout(420, [1, 2, 3], 'counts')).toMatchObject({ density: 'counts', open: [1, 2, 3], folded: [] });
  });

  it('with Fold, folds the lowest priorities first and keeps the rest readable', () => {
    expect(matrixLayout(420, [1, 2, 3], 'fold')).toMatchObject({ density: 'titles', open: [1], folded: [2, 3] });
    expect(matrixLayout(500, [1, 2, 3], 'fold')).toMatchObject({ open: [1, 2], folded: [3] });
  });

  it('never needs to fold one column', () => {
    expect(matrixLayout(420, [1], 'fold')).toMatchObject({ density: 'cards', open: [1], folded: [] });
  });
});

describe('the lens', () => {
  const L = DEFAULT_LABELS;
  it('keeps what it names, with no label as its own choice', () => {
    expect(inLens(DEFAULT_LENS, 3, null)).toBe(true);
    const work = { pri: 2, labels: ['work'] } as const;
    expect(inLens({ ...work, labels: [...work.labels] }, 2, 'work')).toBe(true);
    expect(inLens({ ...work, labels: [...work.labels] }, 3, 'work')).toBe(false);
    expect(inLens({ ...work, labels: [...work.labels] }, 1, 'personal')).toBe(false);
    expect(inLens({ pri: 3, labels: [''] }, 1, null)).toBe(true);
  });

  it('toggles labels without ever showing nothing, and all of them reads as every label', () => {
    const off = toggleLensLabel(DEFAULT_LENS, 'work', L);
    expect(off.labels).toEqual(['personal', 'others', '']);
    expect(toggleLensLabel(off, 'work', L).labels).toBeNull();
    const one = { pri: 3, labels: ['work'] } as const;
    expect(toggleLensLabel({ ...one, labels: [...one.labels] }, 'work', L).labels).toEqual(['work']);
  });

  it('matches presets by what they show', () => {
    expect(sameLens(DEFAULT_LENS, { pri: 3, labels: ['work', 'personal', 'others', ''] }, L)).toBe(true);
    expect(sameLens(DEFAULT_LENS, DEFAULT_PRESETS[3], L)).toBe(false);
    expect(lensIds(DEFAULT_PRESETS[1], L)).toEqual(['work']);
  });

  it('drops presets whose labels are all gone, and cleans what is stored', () => {
    const noWork = L.filter(l => l.id !== 'work');
    expect(usablePresets(DEFAULT_PRESETS, noWork).map(p => p.id)).toEqual(['all', 'life', 'urgent']);
    expect(normalizeLens({ pri: 7, labels: ['bad id', 'work', 'work', 4] })).toEqual({ pri: 3, labels: ['work'] });
    expect(normalizePresets(undefined)).toEqual(DEFAULT_PRESETS);
    expect(normalizePresets([{ id: 'x', name: ' Deep  work ', pri: 1, labels: [] }, { id: 'x', name: 'dup' }, { name: 'no id' }]))
      .toEqual([{ id: 'x', name: 'Deep work', pri: 1, labels: null }]);
  });
});

describe('layout prefs', () => {
  it('defaults to 3 days pinned, every label in view, and counts when tight', () => {
    expect(DEFAULT_PREFS).toMatchObject({ split: { mode: 'pinned', cal: 620 }, lens: { pri: 3, labels: null }, tight: 'counts' });
    expect(normalizePrefs({ split: { mode: 'auto', cal: 'wide' }, tight: 'squeeze' })).toMatchObject({ split: { mode: 'auto', cal: 620 }, tight: 'counts' });
  });

  it('keeps the split and the lens on this device', () => {
    const s = syncable(normalizePrefs({ split: { mode: 'auto', cal: 900 }, lens: { pri: 1 } }));
    expect(s).not.toHaveProperty('split');
    expect(s).not.toHaveProperty('lens');
    expect(s).toHaveProperty('presets');
  });
});

describe('3-day view', () => {
  const tue = new Date(2026, 9, 27), now = tue.getTime() + 10 * 3600000;
  it('shows the day and the two after it, and steps three at a time', () => {
    expect(viewDays('three', tue, P).map(d => d.getDate())).toEqual([27, 28, 29]);
    expect(stepDay('three', tue, 1, P).getDate()).toBe(30);
    expect(viewTitle('three', tue, now, P)).toEqual({ title: 'Next 3 days', sub: '27 Oct – 29 Oct' });
    expect(viewTitle('three', new Date(2026, 9, 30), now, P).title).toBe('From Friday');
  });
});
