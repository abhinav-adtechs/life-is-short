import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, mix, onColor } from './color';
import { ACCENTS, DEFAULT_PREFS, SKY, SURFACES, computeLook, normalizePrefs, palettes, syncable, worstPanelContrast, worstTextContrast, workHours, type Prefs } from './prefs';

const p = (o: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, ...o });

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
    expect(onColor('#FF6A33')).toBe('#0B0B0C');
    expect(onColor('#FFB224')).toBe('#0B0B0C');
  });
});

describe('look', () => {
  it('keeps the design values by default: the sky, its surface and the ember accent', () => {
    const v = computeLook(DEFAULT_PREFS).vars;
    expect(v['--l-bg']).toBe('#F8FBFD');
    expect(v['--d-bg']).toBe('#0A1220');
    expect(v['--l-panel']).toBe('rgba(248,251,253,0.86)');
    expect(v['--d-panel']).toBe('rgba(10,18,32,0.82)');
    expect(v['--l-accent']).toBe('#F04A0C');
    expect(v['--l-on-accent']).toBe('#FFFFFF');
    expect(v['--l-accent-soft']).toBe('rgba(240,74,12,0.08)');
    expect(v['--d-accent']).toBe('#FF6A33');
    expect(v['--d-on-accent']).toBe('#0B0B0C');
    expect(v['--font']).toContain('Geist');
    expect(computeLook(DEFAULT_PREFS).attrs).toEqual({ 'data-theme': null, 'data-motion': null, 'data-contrast': null, 'data-scene': 'sky' });
    expect(computeLook(DEFAULT_PREFS).themeColor).toEqual({ light: SKY.light[0], dark: SKY.dark[0] });
  });

  it('keeps text readable on every surface, mode and contrast setting', () => {
    for (const s of SURFACES) for (const contrastOn of [false, true]) for (const trueBlack of [false, true]) {
      const { light, dark } = palettes(p({ surface: s.id, contrast: contrastOn, trueBlack }));
      expect(worstTextContrast(light), `${s.id} light`).toBeGreaterThanOrEqual(4.5);
      expect(worstTextContrast(dark), `${s.id} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps text readable on a panel anywhere over the sky, on every surface', () => {
    for (const s of SURFACES) for (const contrastOn of [false, true]) {
      const { light, dark } = palettes(p({ surface: s.id, contrast: contrastOn }));
      expect(worstPanelContrast(light, 'light'), `${s.id} by day`).toBeGreaterThanOrEqual(4.5);
      expect(worstPanelContrast(dark, 'dark'), `${s.id} at dusk`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every accent at 3:1 against every background', () => {
    for (const s of SURFACES) for (const a of ACCENTS) {
      const v = computeLook(p({ surface: s.id, accent: a.id, trueBlack: true })).vars;
      expect(contrast(v['--l-accent'], v['--l-bg']), `${a.id} on ${s.id} light`).toBeGreaterThanOrEqual(3);
      expect(contrast(v['--d-accent'], v['--d-bg']), `${a.id} on ${s.id} dark`).toBeGreaterThanOrEqual(3);
      expect(contrast(v['--l-on-accent'], v['--l-accent'])).toBeGreaterThanOrEqual(3);
      expect(contrast(v['--d-on-accent'], v['--d-accent'])).toBeGreaterThanOrEqual(3);
    }
  });

  it('nudges a custom accent that would vanish into the background', () => {
    const v = computeLook(p({ accent: '#FFF3B0' })).vars;
    expect(contrast(v['--l-accent'], '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrast(v['--d-accent'], '#0B0B0C')).toBeGreaterThanOrEqual(3);
  });

  it('turns choices into root variables and attributes', () => {
    const look = computeLook(p({ mode: 'dark', font: 'lexend', textSize: 1.25, corners: 'square', motion: 'reduce', contrast: true, trueBlack: true }));
    expect(look.vars['--d-bg']).toBe('#000000');
    expect(look.vars['--fs']).toBe('1.25');
    expect(look.vars['--pill']).toBe('5px');
    expect(look.attrs).toEqual({ 'data-theme': 'dark', 'data-motion': 'reduce', 'data-contrast': 'more', 'data-scene': 'sky' });
    expect(look.font).toContain('family=Lexend');
    expect(look.themeColor).toEqual({ light: SKY.dark[0], dark: SKY.dark[0] });
  });

  it('gives a plain page its own colour in the browser bar', () => {
    const look = computeLook(p({ scene: 'plain', mode: 'dark', trueBlack: true }));
    expect(look.attrs['data-scene']).toBe('plain');
    expect(look.themeColor).toEqual({ light: '#000000', dark: '#000000' });
  });
});

describe('normalizePrefs', () => {
  it('falls back to defaults for anything unknown', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ surface: 'neon', font: 'comic', textSize: 3, hourHeight: 13, weekStart: 3, calView: 'year' })).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid values and upper-cases custom colours', () => {
    const n = normalizePrefs({ accent: '#12ab34', surface: 'paper', calView: 'month', weekStart: 0, dayStart: 7, dayEnd: 23, clock: '24' });
    expect(n).toMatchObject({ accent: '#12AB34', surface: 'paper', calView: 'month', weekStart: 0, dayStart: 7, dayEnd: 23, clock: '24' });
  });

  it('moves prefs saved before the sky onto it, keeping a surface chosen since', () => {
    expect(normalizePrefs({ surface: 'neutral', accent: 'teal' })).toMatchObject({ scene: 'sky', surface: 'sky', accent: 'teal' });
    expect(normalizePrefs({ surface: 'paper' })).toMatchObject({ scene: 'sky', surface: 'paper' });
    expect(normalizePrefs({ scene: 'sky', surface: 'neutral' })).toMatchObject({ scene: 'sky', surface: 'neutral' });
    expect(normalizePrefs({ scene: 'plain', surface: 'neutral' })).toMatchObject({ scene: 'plain', surface: 'neutral' });
    expect(normalizePrefs({ scene: 'meadow' }).scene).toBe('sky');
  });

  it('rejects a day shorter than two hours', () => {
    expect(normalizePrefs({ dayStart: 20, dayEnd: 21 })).toMatchObject({ dayStart: 9, dayEnd: 21 });
    expect(workHours(normalizePrefs({ dayStart: 6, dayEnd: 22 }))).toEqual({ start: 360, end: 1320 });
  });

  it('leaves per-device keys out of what syncs', () => {
    const s = syncable(p({ mode: 'dark', calView: 'day', accent: 'teal' }));
    expect(s).not.toHaveProperty('mode');
    expect(s).not.toHaveProperty('calView');
    expect(s.accent).toBe('teal');
  });
});
