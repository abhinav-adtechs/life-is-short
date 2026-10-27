import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, mix, onColor } from './color';
import { ACCENTS, DEFAULT_PREFS, THEMES, accentColor, computeLook, normalizePrefs, resolveTheme, syncable, workHours, type Prefs } from './prefs';

const p = (o: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, ...o });
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

describe('colour helpers', () => {
  it('measures WCAG contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('mixes and nudges colours until they read', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    const pale = ensureContrast('#FFE08A', '#FFFFFF', 3);
    expect(contrast(pale, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(ensureContrast('#F04A0C', '#FFFFFF', 3)).toBe('#F04A0C');
  });

  it('puts white on strong accents and dark on bright ones', () => {
    expect(onColor('#F04A0C')).toBe('#FFFFFF');
    expect(onColor('#FFB224')).toBe('#0B0B0C');
  });
});

describe('themes', () => {
  it('keeps text readable on every theme’s surfaces', () => {
    for (const t of THEMES) for (const bg of [t.bg, t.raised, t.soft, t.block]) {
      expect(contrast(t.ink, bg), `${t.id} ink`).toBeGreaterThanOrEqual(7);
      expect(contrast(t.muted, bg), `${t.id} muted`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps each theme’s accent and every preset visible on its panels', () => {
    for (const t of THEMES) {
      expect(contrast(t.accent, t.raised), t.id).toBeGreaterThanOrEqual(2);
      for (const a of ACCENTS) expect(contrast(accentColor(a.id, t.id), t.dark ? t.bg : t.raised), `${a.id} on ${t.id}`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('nudges your own accent until it reads, and leaves the presets as they are', () => {
    expect(contrast(accentColor('#FFF3B0', 'tide'), '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(accentColor('ember', 'night')).toBe('#F04A0C');
    expect(accentColor(null, 'day')).toBe('#D98A1C');
  });

  it('matches the device until you pick one', () => {
    expect(resolveTheme({ theme: null }, true)).toBe('night');
    expect(resolveTheme({ theme: null }, false)).toBe('tide');
    expect(resolveTheme({ theme: 'day' }, true)).toBe('day');
  });

  it('holds every theme’s tokens in the stylesheet, so the first paint matches', () => {
    for (const t of THEMES) {
      const block = css.slice(css.indexOf(`[data-theme="${t.id}"]{`));
      for (const [k, v] of [['page', t.page], ['bg', t.bg], ['raised', t.raised], ['ink', t.ink], ['muted', t.muted]]) {
        expect(block.slice(0, 1200).includes(`--${k}:${v};`), `${t.id} --${k}`).toBe(true);
      }
      expect(block.slice(0, 1200).includes(`--accent-user:${t.accent};`), `${t.id} accent`).toBe(true);
    }
  });
});

describe('look', () => {
  it('starts on the theme’s own accent, Geist and the device’s light or dark', () => {
    const look = computeLook(DEFAULT_PREFS, false);
    expect(look.attrs).toEqual({ 'data-theme': 'tide', 'data-accent': null, 'data-ambient': null, 'data-motion': null, 'data-contrast': null });
    expect(look.vars).not.toHaveProperty('--accent-user');
    expect(look.vars['--font-ui']).toContain('Geist');
    expect(look.auto).toBe(true);
    expect(look.themeColor).toBe('#E5EBEE');
    expect(computeLook(DEFAULT_PREFS, true).attrs['data-theme']).toBe('night');
  });

  it('turns choices into root variables and attributes', () => {
    const look = computeLook(p({ theme: 'day', accent: 'moss', font: 'lexend', textSize: 1.25, motion: 'reduce', contrast: true, ambient: 'still' }));
    expect(look.vars['--accent-user']).toBe('#3E8E41');
    expect(look.vars['--fs']).toBe('1.25');
    expect(look.attrs).toEqual({ 'data-theme': 'day', 'data-accent': 'moss', 'data-ambient': 'still', 'data-motion': 'reduce', 'data-contrast': 'more' });
    expect(look.font).toContain('family=Lexend');
    expect(look.auto).toBe(false);
    expect(look.themeColor).toBe('#ECE6DA');
  });

  it('marks your own accent as custom', () => {
    const look = computeLook(p({ theme: 'night', accent: '#12AB34' }));
    expect(look.attrs['data-accent']).toBe('custom');
    expect(look.vars['--accent-user']).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('normalizePrefs', () => {
  it('falls back to defaults for anything unknown', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ theme: 'neon', font: 'comic', textSize: 3, hourHeight: 13, weekStart: 3, ambient: 'loud', accent: 'plaid' })).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid values and upper-cases custom colours', () => {
    const n = normalizePrefs({ theme: 'night', accent: '#12ab34', weekStart: 0, dayStart: 7, dayEnd: 23, clock: '24', ambient: 'quiet', fiveDay: 'workweek' });
    expect(n).toMatchObject({ theme: 'night', accent: '#12AB34', weekStart: 0, dayStart: 7, dayEnd: 23, clock: '24', ambient: 'quiet', fiveDay: 'workweek' });
  });

  it('moves prefs from before the themes across: dark to Night train, ember to the theme’s accent', () => {
    expect(normalizePrefs({ mode: 'dark', scene: 'meadow', accent: 'ember' })).toMatchObject({ theme: 'night', accent: null });
    expect(normalizePrefs({ mode: 'light', scene: 'night', accent: 'ruby' })).toMatchObject({ theme: 'tide', accent: 'coral' });
    expect(normalizePrefs({ mode: 'system', surface: 'paper', accent: 'green' })).toMatchObject({ theme: null, accent: 'moss' });
    expect(normalizePrefs({ scene: 'meadow', shadeWeekends: false, fiveDay: 'workweek' })).toMatchObject({ shadeWeekends: true, fiveDay: 'rolling' });
    // Since the themes, Ember is a choice like any other.
    expect(normalizePrefs({ accent: 'ember' }).accent).toBe('ember');
  });

  it('rejects a day shorter than two hours', () => {
    expect(normalizePrefs({ dayStart: 20, dayEnd: 21 })).toMatchObject({ dayStart: 9, dayEnd: 21 });
    expect(workHours(normalizePrefs({ dayStart: 6, dayEnd: 22 }))).toEqual({ start: 360, end: 1320 });
  });

  it('leaves the theme, accent, ambient light and split on this device', () => {
    const s = syncable(p({ theme: 'night', accent: 'teal', ambient: 'still', split: 0.84, clock: '24' }));
    for (const k of ['theme', 'accent', 'ambient', 'split']) expect(s).not.toHaveProperty(k);
    expect(s.clock).toBe('24');
  });
});
