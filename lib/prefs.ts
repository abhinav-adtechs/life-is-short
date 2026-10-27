import { ensureContrast, isHex } from './color';
import { DEFAULT_LABELS, normalizeLabels, type Label } from './labels';
import { DEFAULT_SPLIT, normalizeSplit } from './layout';

/**
 * How things look and how the calendar behaves. The theme, its accent, the ambient light and the split stay on this
 * device; everything else is stored in your settings row and follows you to your other devices.
 */
export interface Prefs {
  /** Tide, Night train or Day train. Null matches the device: Night train when it's dark, Tide when it's light. */
  theme: ThemeId | null;
  /** An accent preset, your own #RRGGBB, or null for the theme's own accent. */
  accent: string | null;
  /** The light moving through the planner: all of it, at half strength, or holding still. */
  ambient: Ambient;
  font: FontId;
  /** Multiplies every font size. */
  textSize: number;
  density: 'compact' | 'cozy' | 'roomy';
  contrast: boolean;
  /** Reduced stops every animation, the ambient light included. System follows the device. */
  motion: 'system' | 'full' | 'reduce';
  clock: '12' | '24';

  /** The calendar's share of a laptop screen (lib/layout.ts). */
  split: number;
  /** 0 Sunday, 1 Monday, 6 Saturday. */
  weekStart: 0 | 1 | 6;
  /** What the 5-day view shows. */
  fiveDay: 'workweek' | 'rolling';
  /** Your day, in whole hours: the calendar shows it and auto-slotting stays inside it. */
  dayStart: number;
  dayEnd: number;
  /** Pixels per hour on the phone's timeline. A laptop fits your day to the screen. */
  hourHeight: number;
  colorBy: 'none' | 'label' | 'account' | 'calendar' | 'priority';
  showDone: boolean;
  shadeWeekends: boolean;
  weekNumbers: boolean;

  /** Your labels, in the order the matrix shows them. */
  labels: Label[];

  /** Last change to a synced field, so the newest device wins. */
  updatedAt: number;
}

export type Ambient = 'present' | 'quiet' | 'still';

/** These stay on this device; everything else follows you between devices. */
export const DEVICE_KEYS = ['theme', 'accent', 'ambient', 'split'] as const;

export const DEFAULT_PREFS: Prefs = {
  theme: null, accent: null, ambient: 'present', font: 'geist', textSize: 1, density: 'cozy', contrast: false, motion: 'system', clock: '12',
  split: DEFAULT_SPLIT, weekStart: 1, fiveDay: 'rolling', dayStart: 9, dayEnd: 21, hourHeight: 56,
  colorBy: 'label', showDone: true, shadeWeekends: true, weekNumbers: false,
  labels: DEFAULT_LABELS,
  updatedAt: 0,
};

/* ---------- themes ---------- */

/** The main colours of each theme; globals.css holds the full token set. These are for Settings, the browser bar and tests. */
export interface Theme {
  id: string; name: string; note: string; dark: boolean;
  page: string; bg: string; raised: string; ink: string; muted: string; soft: string; block: string; accent: string;
}

export const THEMES = [
  { id: 'tide', name: 'Tide', note: 'Light · the rest of today as calm water', dark: false,
    page: '#E5EBEE', bg: '#EDF2F4', raised: '#FFFFFF', ink: '#12202A', muted: '#4F5E69', soft: '#EBF1F4', block: '#E8EFF2', accent: '#0A7DB2' },
  { id: 'night', name: 'Night train', note: 'Dark · light from passing platforms', dark: true,
    page: '#0A0D12', bg: '#0D1117', raised: '#141A22', ink: '#E9E7E2', muted: '#9DA4AE', soft: '#1A212A', block: '#1C232D', accent: '#F2A541' },
  { id: 'day', name: 'Day train', note: 'Light · a sunlit carriage', dark: false,
    page: '#ECE6DA', bg: '#F3EEE4', raised: '#FFFCF6', ink: '#1B2230', muted: '#545C69', soft: '#EFE9DE', block: '#EEE8DC', accent: '#D98A1C' },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof THEMES)[number]['id'];

export const themeById = (id: ThemeId) => THEMES.find(t => t.id === id) ?? THEMES[0];

/** The theme showing: the one you picked, or for "match the device", Night train in the dark and Tide in the light. */
export const resolveTheme = (p: Pick<Prefs, 'theme'>, systemDark: boolean): ThemeId => p.theme ?? (systemDark ? 'night' : 'tide');

/* ---------- accents ---------- */

/** A picked accent wins over the theme's own. */
export const ACCENTS = [
  { id: 'ember', name: 'Ember', color: '#F04A0C' },
  { id: 'coral', name: 'Coral', color: '#E5484D' },
  { id: 'amber', name: 'Amber', color: '#D98E04' },
  { id: 'moss', name: 'Moss', color: '#3E8E41' },
  { id: 'teal', name: 'Teal', color: '#0F9488' },
  { id: 'ocean', name: 'Ocean', color: '#0B84D8' },
  { id: 'indigo', name: 'Indigo', color: '#4F5BD5' },
  { id: 'violet', name: 'Violet', color: '#8E4EC6' },
  { id: 'rose', name: 'Rose', color: '#D6409F' },
  { id: 'graphite', name: 'Graphite', color: '#3F3F46' },
] as const;

/** Accent ids from before the redesign that have a new name. */
const OLD_ACCENTS: Record<string, string> = { ruby: 'coral', green: 'moss' };

/** The accent colour on a theme. Your own colour is nudged until it reads against the panels. */
export function accentColor(accent: string | null, theme: ThemeId): string {
  const t = themeById(theme);
  if (accent == null) return t.accent;
  const preset = ACCENTS.find(a => a.id === accent);
  return preset ? preset.color : ensureContrast(accent, t.raised, 3);
}

/* ---------- fonts ---------- */

export interface Font { id: string; name: string; note: string; stack: string; /** Google Fonts family spec, or null when nothing needs loading. */ gf: string | null }

export const FONTS = [
  { id: 'geist', name: 'Geist', note: 'Clean. The default', stack: "'Geist',system-ui,-apple-system,sans-serif", gf: null },
  { id: 'inter', name: 'Inter', note: 'Neutral and compact', stack: "'Inter',system-ui,-apple-system,sans-serif", gf: 'Inter:wght@400..700' },
  { id: 'system', name: 'System', note: 'Your device’s own font', stack: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", gf: null },
  { id: 'dm', name: 'DM Sans', note: 'Friendly, geometric', stack: "'DM Sans',system-ui,sans-serif", gf: 'DM+Sans:opsz,wght@9..40,400..700' },
  { id: 'nunito', name: 'Nunito', note: 'Soft and rounded', stack: "'Nunito',system-ui,sans-serif", gf: 'Nunito:wght@400..700' },
  { id: 'lexend', name: 'Lexend', note: 'Made for easy reading', stack: "'Lexend',system-ui,sans-serif", gf: 'Lexend:wght@400..700' },
  { id: 'atkinson', name: 'Atkinson', note: 'Clear letters for low vision', stack: "'Atkinson Hyperlegible Next',system-ui,sans-serif", gf: 'Atkinson+Hyperlegible+Next:wght@400..700' },
  { id: 'serif', name: 'Source Serif', note: 'Bookish serif', stack: "'Source Serif 4',Georgia,serif", gf: 'Source+Serif+4:opsz,wght@8..60,400..700' },
  { id: 'mono', name: 'Geist Mono', note: 'Monospaced', stack: "'Geist Mono',ui-monospace,Menlo,monospace", gf: null },
] as const satisfies readonly Font[];

export type FontId = (typeof FONTS)[number]['id'];

export const fontHref = (gf: string) => `https://fonts.googleapis.com/css2?family=${gf}&display=swap`;

/* ---------- choices ---------- */

export const TEXT_SIZES = [{ value: 0.875, label: 'Small' }, { value: 1, label: 'Default' }, { value: 1.125, label: 'Large' }, { value: 1.25, label: 'Larger' }];
export const HOUR_HEIGHTS = [{ value: 44, label: 'Compact' }, { value: 56, label: 'Default' }, { value: 72, label: 'Tall' }];
const DENSITY = { compact: 0.6, cozy: 1, roomy: 1.5 };

/* ---------- normalising stored values ---------- */

const oneOf = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const ids = <T extends { id: string }>(list: readonly T[]) => list.map(x => x.id as T['id']);
/** Keys only prefs from before the themes have. */
const LEGACY_KEYS = ['scene', 'surface', 'mode', 'corners', 'lens', 'presets', 'tight', 'backlogBy', 'calView'];

function normalizeAccent(v: unknown, legacy: boolean): string | null {
  if (isHex(v)) return v.toUpperCase();
  if (typeof v !== 'string') return null;
  // Ember was everyone's accent before the themes, so it reads as "the theme's own" rather than a choice.
  if (legacy && v === 'ember') return null;
  const id = OLD_ACCENTS[v] ?? v;
  return ACCENTS.some(a => a.id === id) ? id : null;
}

/** Anything read from storage or another device, turned into valid prefs. */
export function normalizePrefs(raw: unknown): Prefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  // Saved before the themes: a view out of the window, light or dark, and the old calendar defaults.
  const legacy = LEGACY_KEYS.some(k => k in o);
  let dayStart = Number.isInteger(o.dayStart) ? Math.max(0, Math.min(23, o.dayStart as number)) : d.dayStart;
  let dayEnd = Number.isInteger(o.dayEnd) ? Math.max(1, Math.min(24, o.dayEnd as number)) : d.dayEnd;
  if (dayEnd - dayStart < 2) { dayStart = d.dayStart; dayEnd = d.dayEnd; }
  const theme = oneOf(o.theme, [...ids(THEMES), null] as const, null)
    ?? (legacy ? (o.mode === 'dark' ? 'night' : o.mode === 'light' ? 'tide' : null) : null);
  return {
    theme,
    accent: normalizeAccent(o.accent, legacy),
    ambient: oneOf(o.ambient, ['present', 'quiet', 'still'] as const, d.ambient),
    font: oneOf(o.font, ids(FONTS), d.font),
    textSize: oneOf(o.textSize, TEXT_SIZES.map(s => s.value), d.textSize),
    density: oneOf(o.density, ['compact', 'cozy', 'roomy'] as const, d.density),
    contrast: bool(o.contrast, d.contrast),
    motion: oneOf(o.motion, ['system', 'full', 'reduce'] as const, d.motion),
    clock: oneOf(o.clock, ['12', '24'] as const, d.clock),
    split: normalizeSplit(o.split),
    weekStart: oneOf(o.weekStart, [0, 1, 6] as const, d.weekStart),
    fiveDay: legacy ? d.fiveDay : oneOf(o.fiveDay, ['workweek', 'rolling'] as const, d.fiveDay),
    dayStart, dayEnd,
    hourHeight: oneOf(o.hourHeight, HOUR_HEIGHTS.map(h => h.value), d.hourHeight),
    // Account was the default before labels. Label colours events the same way until something has a label.
    colorBy: o.colorBy === 'account' && !Array.isArray(o.labels) ? 'label' : oneOf(o.colorBy, ['none', 'label', 'account', 'calendar', 'priority'] as const, d.colorBy),
    showDone: bool(o.showDone, d.showDone),
    shadeWeekends: legacy ? d.shadeWeekends : bool(o.shadeWeekends, d.shadeWeekends),
    weekNumbers: bool(o.weekNumbers, d.weekNumbers),
    labels: normalizeLabels(o.labels),
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

/* ---------- prefs → the root element ---------- */

export interface Look {
  /** CSS custom properties for the root element. */
  vars: Record<string, string>;
  /** Attributes for the root element; null removes one. */
  attrs: Record<string, string | null>;
  /** True when the theme follows the device, so the startup script picks it from the system before first paint. */
  auto: boolean;
  /** Stylesheet for the chosen font, if it needs loading. */
  font: string | null;
  /** The browser bar's colour: the theme's outermost wall. */
  themeColor: string;
}

export function computeLook(p: Prefs, systemDark = false): Look {
  const theme = resolveTheme(p, systemDark);
  const font = FONTS.find(f => f.id === p.font) ?? FONTS[0];
  const vars: Record<string, string> = {
    '--font-ui': font.stack,
    '--fs': String(p.textSize),
    '--dens': String(DENSITY[p.density]),
  };
  if (p.accent != null) vars['--accent-user'] = accentColor(p.accent, theme);
  return {
    vars,
    attrs: {
      'data-theme': theme,
      'data-accent': p.accent == null ? null : ACCENTS.some(a => a.id === p.accent) ? p.accent : 'custom',
      'data-ambient': p.ambient === 'present' ? null : p.ambient,
      'data-motion': p.motion === 'system' ? null : p.motion,
      'data-contrast': p.contrast ? 'more' : null,
    },
    auto: p.theme == null,
    font: font.gf ? fontHref(font.gf) : null,
    themeColor: themeById(theme).page,
  };
}

/** The look's own variables, so applying a new look can clear ones the old one set. */
export const LOOK_VARS = ['--font-ui', '--fs', '--dens', '--accent-user'];
