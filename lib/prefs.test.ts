import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, isHex, mix, onColor } from './color';
import { ACCENTS, DEFAULT_PREFS, SURFACES, computeLook, normalizePrefs, palettes, sceneVars, syncable, worstTextContrast, workHours, type Prefs } from './prefs';
import { SCENES, sceneById } from './scenes';

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
  it('keeps the design values by default: the meadow, paper panels and the ember accent', () => {
    const v = computeLook(DEFAULT_PREFS).vars;
    expect(v['--l-bg']).toBe('#FBF8F2');
    expect(v['--d-bg']).toBe('#14110D');
    expect(v['--img-sky']).toBe('url("/scenes/meadow/sky.svg")');
    expect(v['--img-drops']).toBe('none');
    expect(v['--l-accent']).toBe('#F04A0C');
    expect(v['--l-on-accent']).toBe('#FFFFFF');
    expect(v['--l-accent-soft']).toBe('rgba(240,74,12,0.08)');
    expect(v['--d-accent']).toBe('#FF6A33');
    expect(v['--d-on-accent']).toBe('#0B0B0C');
    expect(v['--font']).toContain('Geist');
    expect(computeLook(DEFAULT_PREFS).attrs).toEqual({ 'data-theme': null, 'data-motion': null, 'data-contrast': null, 'data-scene': 'meadow' });
    expect(computeLook(DEFAULT_PREFS).themeColor).toEqual({ light: '#1F5E58', dark: '#0E2826' });
  });

  it('keeps text readable on every surface, mode and contrast setting', () => {
    for (const s of SURFACES) for (const contrastOn of [false, true]) for (const trueBlack of [false, true]) {
      const { light, dark } = palettes(p({ surface: s.id, contrast: contrastOn, trueBlack }));
      expect(worstTextContrast(light), `${s.id} light`).toBeGreaterThanOrEqual(4.5);
      expect(worstTextContrast(dark), `${s.id} dark`).toBeGreaterThanOrEqual(4.5);
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
    expect(look.attrs).toEqual({ 'data-theme': 'dark', 'data-motion': 'reduce', 'data-contrast': 'more', 'data-scene': 'meadow' });
    expect(look.font).toContain('family=Lexend');
    expect(look.themeColor).toEqual({ light: '#0E2826', dark: '#0E2826' });
  });

  it('gives a plain page its own colour in the browser bar', () => {
    const look = computeLook(p({ scene: 'plain', mode: 'dark', trueBlack: true }));
    expect(look.attrs['data-scene']).toBe('plain');
    expect(look.themeColor).toEqual({ light: '#000000', dark: '#000000' });
  });
});

describe('views', () => {
  it('keeps text readable on each wall, card and button', () => {
    for (const sc of SCENES) {
      expect(contrast(sc.wall.ink, sc.wall.light), `${sc.id} wall`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(sc.wall.inkDark, sc.wall.dark), `${sc.id} wall, dark`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(sc.paper.ink, sc.paper.bg), `${sc.id} card`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(sc.paper.muted, sc.paper.bg), `${sc.id} card labels`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(sc.paper.ctaInk, sc.paper.cta), `${sc.id} button`).toBeGreaterThanOrEqual(4.5);
      for (const c of [sc.sky, sc.wall.light, sc.wall.dark, sc.paper.bg, sc.paper.cta]) expect(isHex(c), `${sc.id} ${c}`).toBe(true);
    }
  });

  it('has exactly the art each view lists', () => {
    for (const sc of SCENES) {
      const files = readdirSync(join(__dirname, '..', 'public', 'scenes', sc.id)).sort();
      expect(files, sc.id).toEqual(sc.layers.map(l => `${l}.svg`).sort());
    }
  });

  it('starts the page with the default view and theme, so the first paint matches', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const look = computeLook(DEFAULT_PREFS).vars;
    const palette = Object.entries(look).filter(([k]) => /^--[ld]-(bg|ink|muted|hair|hair2|soft|block|block-h|accent)$/.test(k));
    for (const [k, v] of [...palette, ...Object.entries(sceneVars(sceneById(DEFAULT_PREFS.scene)!))]) {
      expect(css.includes(`${k}:${v};`) || css.includes(`${k}:${v}}`), `${k}:${v}`).toBe(true);
    }
  });

  it('gives a plain page no window colours', () => {
    expect(computeLook(p({ scene: 'plain' })).vars).not.toHaveProperty('--img-sky');
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

  it('moves prefs saved before the window onto the meadow, keeping a surface chosen since', () => {
    expect(normalizePrefs({ surface: 'neutral', accent: 'teal' })).toMatchObject({ scene: 'meadow', surface: 'paper', accent: 'teal' });
    expect(normalizePrefs({ surface: 'slate' })).toMatchObject({ scene: 'meadow', surface: 'slate' });
    expect(normalizePrefs({ scene: 'night', surface: 'neutral' })).toMatchObject({ scene: 'night', surface: 'neutral' });
    expect(normalizePrefs({ scene: 'plain', surface: 'neutral' })).toMatchObject({ scene: 'plain', surface: 'neutral' });
    // An early build's only view, and its own surface.
    expect(normalizePrefs({ scene: 'sky', surface: 'sky' })).toMatchObject({ scene: 'meadow', surface: 'paper' });
    expect(normalizePrefs({ scene: 'beach' }).scene).toBe('meadow');
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
