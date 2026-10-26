import { contrast, ensureContrast, isHex, mix, onColor, rgba } from './color';
import { DEFAULT_SCENE, LAYERS, SCENES, sceneById, type Scene, type SceneId } from './scenes';

/** How things look and how the calendar behaves. Stored per device and synced through your settings row. */
export interface Prefs {
  /** Light or dark. Per device: a phone can follow the system while a laptop stays dark. */
  mode: 'system' | 'light' | 'dark';
  /** The view out of the window (lib/scenes.ts), or a plain page. */
  scene: SceneId | 'plain';
  surface: SurfaceId;
  /** An accent preset id, or a custom #RRGGBB. */
  accent: string;
  font: FontId;
  /** Multiplies every font size. */
  textSize: number;
  corners: 'round' | 'soft' | 'square';
  density: 'compact' | 'cozy' | 'roomy';
  contrast: boolean;
  trueBlack: boolean;
  motion: 'system' | 'full' | 'reduce';
  clock: '12' | '24';

  /** Calendar view. Per device; null picks Week on a laptop and Day on a phone. */
  calView: CalView | null;
  /** 0 Sunday, 1 Monday, 6 Saturday. */
  weekStart: 0 | 1 | 6;
  /** What the 5-day view shows. */
  fiveDay: 'workweek' | 'rolling';
  /** Your day, in whole hours: the calendar shows it and auto-slotting stays inside it. */
  dayStart: number;
  dayEnd: number;
  /** Pixels per hour on the time grid. */
  hourHeight: number;
  colorBy: 'none' | 'account' | 'calendar' | 'priority';
  showDone: boolean;
  shadeWeekends: boolean;
  weekNumbers: boolean;

  /** Last change to a synced field, so the newest device wins. */
  updatedAt: number;
}

export type CalView = 'day' | 'work' | 'week' | 'month';

/** These stay on this device; everything else follows you between devices. */
export const DEVICE_KEYS = ['mode', 'calView'] as const;

export const DEFAULT_PREFS: Prefs = {
  mode: 'system', scene: DEFAULT_SCENE, surface: 'paper', accent: 'ember', font: 'geist', textSize: 1, corners: 'round', density: 'cozy',
  contrast: false, trueBlack: false, motion: 'system', clock: '12',
  calView: null, weekStart: 1, fiveDay: 'workweek', dayStart: 9, dayEnd: 21, hourHeight: 56,
  colorBy: 'account', showDone: true, shadeWeekends: false, weekNumbers: false,
  updatedAt: 0,
};

/* ---------- surfaces ---------- */

export interface Palette { bg: string; ink: string; muted: string; hair: string; hair2: string; soft: string; block: string; blockH: string }
export interface Surface { id: string; name: string; light: Palette; dark: Palette }

export const SURFACES = [
  {
    id: 'neutral', name: 'Neutral',
    light: { bg: '#FFFFFF', ink: '#0F0F10', muted: '#6B6B70', hair: '#EDEDEF', hair2: '#F6F6F7', soft: '#F4F4F5', block: '#F1F1F3', blockH: '#E8E8EB' },
    dark: { bg: '#0B0B0C', ink: '#F2F2F3', muted: '#8E8E93', hair: '#1F1F22', hair2: '#141416', soft: '#18181B', block: '#1C1C1F', blockH: '#26262A' },
  },
  {
    id: 'paper', name: 'Paper',
    light: { bg: '#FBF8F2', ink: '#1F1B16', muted: '#68604F', hair: '#EAE3D6', hair2: '#F4EFE6', soft: '#F1EBE0', block: '#EDE6D8', blockH: '#E3DAC8' },
    dark: { bg: '#14110D', ink: '#F3EDE4', muted: '#9C9384', hair: '#2A241D', hair2: '#1A1611', soft: '#201B15', block: '#251F18', blockH: '#302820' },
  },
  {
    id: 'slate', name: 'Slate',
    light: { bg: '#F8FAFC', ink: '#0F172A', muted: '#556072', hair: '#E2E8F0', hair2: '#F1F5F9', soft: '#EDF1F6', block: '#E8EDF4', blockH: '#DCE3ED' },
    dark: { bg: '#0A0F1A', ink: '#E6EBF3', muted: '#8994A7', hair: '#1B2333', hair2: '#111725', soft: '#151C2B', block: '#1A2233', blockH: '#232D41' },
  },
  {
    id: 'sage', name: 'Sage',
    light: { bg: '#F7F9F6', ink: '#141A14', muted: '#596659', hair: '#E1E8E0', hair2: '#EFF3EE', soft: '#ECF1EB', block: '#E6ECE5', blockH: '#DAE4D9' },
    dark: { bg: '#0C110D', ink: '#E9F0E9', muted: '#8B998C', hair: '#1C251D', hair2: '#121912', soft: '#162017', block: '#1A241B', blockH: '#233025' },
  },
  {
    id: 'lilac', name: 'Lilac',
    light: { bg: '#FAF8FD', ink: '#19142A', muted: '#635B74', hair: '#E8E3F1', hair2: '#F4F1F9', soft: '#F0ECF7', block: '#EBE6F4', blockH: '#E1DAEE' },
    dark: { bg: '#0F0C16', ink: '#EDE9F5', muted: '#978EAA', hair: '#241F31', hair2: '#17131F', soft: '#1C1727', block: '#211B2E', blockH: '#2B243B' },
  },
] as const satisfies readonly Surface[];

export type SurfaceId = (typeof SURFACES)[number]['id'];

/* ---------- accents ---------- */

export interface Accent { id: string; name: string; light: string; dark: string }

export const ACCENTS = [
  { id: 'ember', name: 'Ember', light: '#F04A0C', dark: '#FF6A33' },
  { id: 'ruby', name: 'Ruby', light: '#DC2E45', dark: '#FF5C70' },
  { id: 'rose', name: 'Rose', light: '#D6337A', dark: '#F7609D' },
  { id: 'violet', name: 'Violet', light: '#7C4DDB', dark: '#A385F5' },
  { id: 'indigo', name: 'Indigo', light: '#3B5BDB', dark: '#7591FF' },
  { id: 'ocean', name: 'Ocean', light: '#0B78C9', dark: '#4AAFFF' },
  { id: 'teal', name: 'Teal', light: '#0E8579', dark: '#2DC5B3' },
  { id: 'green', name: 'Green', light: '#2D8539', dark: '#4CC764' },
  { id: 'amber', name: 'Amber', light: '#B86E00', dark: '#FFB224' },
  { id: 'graphite', name: 'Graphite', light: '#3A3A3F', dark: '#C9C9CE' },
] as const satisfies readonly Accent[];

/** The light and dark versions of an accent. A custom colour is nudged until it reads on the background; `adjusted` says where. */
export function accentPair(accent: string, light: Palette, dark: Palette) {
  const preset = ACCENTS.find(a => a.id === accent);
  const base = preset ? { light: preset.light, dark: preset.dark } : isHex(accent) ? { light: accent.toUpperCase(), dark: mix(accent, '#FFFFFF', 0.15) } : ACCENTS[0];
  const out = { light: ensureContrast(base.light, light.bg, 3), dark: ensureContrast(base.dark, dark.bg, 3) };
  return { ...out, adjusted: { light: out.light !== base.light.toUpperCase(), dark: out.dark !== base.dark.toUpperCase() } };
}

/* ---------- fonts ---------- */

export interface Font { id: string; name: string; note: string; stack: string; /** Google Fonts family spec, or null when nothing needs loading. */ gf: string | null }

export const FONTS = [
  { id: 'geist', name: 'Geist', note: 'Clean. The default', stack: "'Geist',system-ui,-apple-system,sans-serif", gf: null },
  { id: 'inter', name: 'Inter', note: 'Neutral and compact', stack: "'Inter',system-ui,-apple-system,sans-serif", gf: 'Inter:wght@400..600' },
  { id: 'system', name: 'System', note: 'Your device’s own font', stack: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", gf: null },
  { id: 'dm', name: 'DM Sans', note: 'Friendly, geometric', stack: "'DM Sans',system-ui,sans-serif", gf: 'DM+Sans:opsz,wght@9..40,400..600' },
  { id: 'nunito', name: 'Nunito', note: 'Soft and rounded', stack: "'Nunito',system-ui,sans-serif", gf: 'Nunito:wght@400..700' },
  { id: 'lexend', name: 'Lexend', note: 'Made for easy reading', stack: "'Lexend',system-ui,sans-serif", gf: 'Lexend:wght@400..600' },
  { id: 'atkinson', name: 'Atkinson', note: 'Clear letters for low vision', stack: "'Atkinson Hyperlegible Next',system-ui,sans-serif", gf: 'Atkinson+Hyperlegible+Next:wght@400..700' },
  { id: 'serif', name: 'Source Serif', note: 'Bookish serif', stack: "'Source Serif 4',Georgia,serif", gf: 'Source+Serif+4:opsz,wght@8..60,400..600' },
  { id: 'mono', name: 'Geist Mono', note: 'Monospaced', stack: "'Geist Mono',ui-monospace,Menlo,monospace", gf: 'Geist+Mono:wght@400..600' },
] as const satisfies readonly Font[];

export type FontId = (typeof FONTS)[number]['id'];

export const fontHref = (gf: string) => `https://fonts.googleapis.com/css2?family=${gf}&display=swap`;

/* ---------- choices ---------- */

export const TEXT_SIZES = [{ value: 0.875, label: 'Small' }, { value: 1, label: 'Default' }, { value: 1.125, label: 'Large' }, { value: 1.25, label: 'Larger' }];
export const HOUR_HEIGHTS = [{ value: 44, label: 'Compact' }, { value: 56, label: 'Default' }, { value: 72, label: 'Tall' }];
const CORNERS = { round: { round: 1, pill: '999px' }, soft: { round: 0.6, pill: '12px' }, square: { round: 0.3, pill: '5px' } };
const DENSITY = { compact: 0.5, cozy: 1, roomy: 1.6 };

/* ---------- normalising stored values ---------- */

const oneOf = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const ids = <T extends { id: string }>(list: readonly T[]) => list.map(x => x.id as T['id']);

/** Anything read from storage or another device, turned into valid prefs. */
export function normalizePrefs(raw: unknown): Prefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const accent = ACCENTS.some(a => a.id === o.accent) ? (o.accent as string) : isHex(o.accent) ? o.accent.toUpperCase() : d.accent;
  let dayStart = Number.isInteger(o.dayStart) ? Math.max(0, Math.min(23, o.dayStart as number)) : d.dayStart;
  let dayEnd = Number.isInteger(o.dayEnd) ? Math.max(1, Math.min(24, o.dayEnd as number)) : d.dayEnd;
  if (dayEnd - dayStart < 2) { dayStart = d.dayStart; dayEnd = d.dayEnd; }
  // Prefs saved before the window have no scene; their Neutral was the old default, so they get the window's Paper.
  const surface = o.scene === undefined && o.surface === 'neutral' ? d.surface : oneOf(o.surface, ids(SURFACES), d.surface);
  // An early build called the only view 'sky'.
  const scene = o.scene === 'sky' ? d.scene : oneOf(o.scene, [...ids(SCENES), 'plain'] as const, d.scene);
  return {
    mode: oneOf(o.mode, ['system', 'light', 'dark'] as const, d.mode),
    scene,
    surface,
    accent,
    font: oneOf(o.font, ids(FONTS), d.font),
    textSize: oneOf(o.textSize, TEXT_SIZES.map(s => s.value), d.textSize),
    corners: oneOf(o.corners, ['round', 'soft', 'square'] as const, d.corners),
    density: oneOf(o.density, ['compact', 'cozy', 'roomy'] as const, d.density),
    contrast: bool(o.contrast, d.contrast),
    trueBlack: bool(o.trueBlack, d.trueBlack),
    motion: oneOf(o.motion, ['system', 'full', 'reduce'] as const, d.motion),
    clock: oneOf(o.clock, ['12', '24'] as const, d.clock),
    calView: oneOf(o.calView, ['day', 'work', 'week', 'month', null] as const, d.calView),
    weekStart: oneOf(o.weekStart, [0, 1, 6] as const, d.weekStart),
    fiveDay: oneOf(o.fiveDay, ['workweek', 'rolling'] as const, d.fiveDay),
    dayStart, dayEnd,
    hourHeight: oneOf(o.hourHeight, HOUR_HEIGHTS.map(h => h.value), d.hourHeight),
    colorBy: oneOf(o.colorBy, ['none', 'account', 'calendar', 'priority'] as const, d.colorBy),
    showDone: bool(o.showDone, d.showDone),
    shadeWeekends: bool(o.shadeWeekends, d.shadeWeekends),
    weekNumbers: bool(o.weekNumbers, d.weekNumbers),
    updatedAt: typeof o.updatedAt === 'number' && isFinite(o.updatedAt) ? o.updatedAt : 0,
  };
}

/** The synced part: everything but the per-device keys. */
export function syncable(p: Prefs): Partial<Prefs> {
  const out: Partial<Prefs> = { ...p };
  for (const k of DEVICE_KEYS) delete out[k];
  return out;
}

/** Your day as minutes from midnight, for slotting. */
export const workHours = (p: Pick<Prefs, 'dayStart' | 'dayEnd'>) => ({ start: p.dayStart * 60, end: p.dayEnd * 60 });

/* ---------- prefs → CSS ---------- */

/** Stronger secondary text and lines for the contrast setting. */
function boost(p: Palette): Palette {
  return {
    ...p,
    muted: mix(p.muted, p.ink, 0.42), hair: mix(p.hair, p.ink, 0.2), hair2: mix(p.hair2, p.ink, 0.06),
    soft: mix(p.soft, p.ink, 0.03), block: mix(p.block, p.ink, 0.05), blockH: mix(p.blockH, p.ink, 0.08),
  };
}

/** Pure black for OLED screens, with surfaces a step darker so they still separate. */
function black(p: Palette): Palette {
  const dim = (c: string) => mix(c, '#000000', 0.3);
  return { ...p, bg: '#000000', hair2: dim(p.hair2), soft: dim(p.soft), block: dim(p.block), blockH: dim(p.blockH), hair: mix(p.hair, '#000000', 0.15) };
}

export function palettes(p: Prefs): { light: Palette; dark: Palette } {
  const s = SURFACES.find(x => x.id === p.surface) ?? SURFACES[0];
  let light: Palette = { ...s.light }, dark: Palette = { ...s.dark };
  if (p.trueBlack) dark = black(dark);
  if (p.contrast) { light = boost(light); dark = boost(dark); }
  return { light, dark };
}

const TOKENS: [keyof Palette, string][] = [['bg', 'bg'], ['ink', 'ink'], ['muted', 'muted'], ['hair', 'hair'], ['hair2', 'hair2'], ['soft', 'soft'], ['block', 'block'], ['blockH', 'block-h']];

export interface Look {
  /** CSS custom properties for the root element. */
  vars: Record<string, string>;
  /** Attributes for the root element; null removes one. */
  attrs: Record<string, string | null>;
  /** Stylesheet for the chosen font, if it needs loading. */
  font: string | null;
  /** Browser chrome colours. */
  themeColor: { light: string; dark: string };
}

export function computeLook(p: Prefs): Look {
  const { light, dark } = palettes(p);
  const acc = accentPair(p.accent, light, dark);
  const vars: Record<string, string> = {};
  for (const [k, name] of TOKENS) { vars[`--l-${name}`] = light[k]; vars[`--d-${name}`] = dark[k]; }
  vars['--l-accent'] = acc.light;
  vars['--l-on-accent'] = onColor(acc.light);
  vars['--l-accent-soft'] = rgba(acc.light, 0.08);
  vars['--l-accent-line'] = rgba(acc.light, 0.5);
  vars['--d-accent'] = acc.dark;
  vars['--d-on-accent'] = onColor(acc.dark, dark.bg === '#000000' ? '#000000' : '#0B0B0C');
  vars['--d-accent-soft'] = rgba(acc.dark, 0.12);
  vars['--d-accent-line'] = rgba(acc.dark, 0.55);
  const font = FONTS.find(f => f.id === p.font) ?? FONTS[0];
  vars['--font'] = font.stack;
  vars['--fs'] = String(p.textSize);
  vars['--round'] = String(CORNERS[p.corners].round);
  vars['--pill'] = CORNERS[p.corners].pill;
  vars['--dens'] = String(DENSITY[p.density]);
  const scene = sceneById(p.scene);
  if (scene) Object.assign(vars, sceneVars(scene));
  // The browser bar continues the page: the wall around the window, or the plain page.
  const top = scene ? { light: scene.wall.light, dark: scene.wall.dark } : { light: light.bg, dark: dark.bg };
  return {
    vars,
    attrs: {
      'data-theme': p.mode === 'system' ? null : p.mode,
      'data-motion': p.motion === 'system' ? null : p.motion,
      'data-contrast': p.contrast ? 'more' : null,
      'data-scene': p.scene,
    },
    font: font.gf ? fontHref(font.gf) : null,
    themeColor: p.mode === 'system' ? top : p.mode === 'light' ? { light: top.light, dark: top.light } : { light: top.dark, dark: top.dark },
  };
}

/** Lowest contrast between text tokens and the surfaces they sit on, for tests and sanity checks. */
export function worstTextContrast(pal: Palette) {
  return Math.min(...[pal.bg, pal.soft, pal.block, pal.hair2].flatMap(bg => [contrast(pal.ink, bg), contrast(pal.muted, bg)]));
}

/** The window's CSS: its layers, where the light comes from, and the colours around it. */
export function sceneVars(s: Scene): Record<string, string> {
  const v: Record<string, string> = {};
  for (const l of LAYERS) v[`--img-${l}`] = s.layers.includes(l) ? `url("/scenes/${s.id}/${l}.svg")` : 'none';
  v['--sun'] = `${s.sun[0]}% ${s.sun[1]}%`;
  v['--band'] = String(s.band);
  v['--across'] = String(s.across);
  v['--sky-c'] = s.sky;
  v['--l-wall'] = s.wall.light;
  v['--d-wall'] = s.wall.dark;
  v['--l-wall-ink'] = s.wall.ink;
  v['--d-wall-ink'] = s.wall.inkDark;
  v['--wall-art'] = s.wall.texture ?? 'none';
  v['--frame'] = s.frame;
  v['--win-r'] = `${s.radius}px`;
  v['--view-ink'] = s.view.ink;
  v['--view-shade'] = s.view.shade;
  v['--paper'] = s.paper.bg;
  v['--paper-ink'] = s.paper.ink;
  v['--paper-muted'] = s.paper.muted;
  v['--paper-line'] = s.paper.line;
  v['--paper-mark'] = s.paper.mark;
  v['--cta'] = s.paper.cta;
  v['--cta-ink'] = s.paper.ctaInk;
  v['--bird'] = s.bird;
  v['--mote'] = s.mote ?? 'transparent';
  v['--motes'] = s.mote ? 'block' : 'none';
  v['--drips'] = s.layers.includes('drops') ? 'block' : 'none';
  return v;
}
