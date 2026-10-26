/**
 * The views out of the window. Each is painted in layers (public/scenes/<id>/<layer>.svg, drawn by
 * scripts/scenes/scenes.py) and comes with the colours around it: the wall, the frame, the sign-in card.
 * lib/prefs.ts turns the chosen one into CSS variables; globals.css lays the layers out and moves them.
 */

export type SceneId = 'meadow' | 'amber' | 'night' | 'rain' | 'balloon' | 'above';

/** Back to front. Static layers are drawn once; the rest move with CSS transforms only. */
export const LAYERS = ['sky', 'glow', 'twinkle', 'clouds', 'land', 'float', 'blink', 'near', 'wires', 'drops'] as const;
export type Layer = (typeof LAYERS)[number];

export interface Scene {
  id: SceneId;
  /** For Settings. */
  name: string;
  note: string;
  layers: readonly Layer[];
  /** Sign-in: a small line over the title, the title's second line, a sentence, and the card. */
  eyebrow: string;
  line: string;
  lead: string;
  card: { kind: 'ticket' | 'postcard' | 'tag' | 'pass'; head: readonly [string, string]; stamp?: string };
  /** Where the glow breathes from, in % of the view. */
  sun: readonly [number, number];
  /** Which part a short, wide window shows (0 the top of the view, 1 the bottom), and a narrow one (0 left, 1 right). */
  band: number;
  across: number;
  /** Shown while the art loads. */
  sky: string;
  /** Around the window and behind the panels, by day and in dark mode, and text that sits straight on it. */
  wall: { light: string; dark: string; ink: string; inkDark: string; texture?: string };
  /** The window's frame (inset rings) and corner radius at full size. */
  frame: string;
  radius: number;
  /** Text on the view, and the shadow and scrim that keep it readable. */
  view: { ink: string; shade: string };
  /** The sign-in card. */
  paper: { bg: string; ink: string; muted: string; line: string; cta: string; ctaInk: string; mark: string };
  bird: string;
  /** Dust in the light, or fireflies; null for none. */
  mote: string | null;
}

export const SCENES = [
  {
    id: 'meadow', name: 'Summer meadow', note: 'Fields, poppies and big clouds from a train',
    layers: ['sky', 'glow', 'clouds', 'land', 'near', 'wires'],
    eyebrow: 'Window seat', line: 'Look outside.',
    lead: 'Say what’s on your mind. We’ll keep the one thing that matters in view, and the rest of the day for the view.',
    card: { kind: 'ticket', head: ['Today · single', 'Seat 1A'], stamp: 'Valid today' },
    sun: [100, -7], band: 0.56, across: 0.5, sky: '#4F94E4',
    wall: { light: '#1F5E58', dark: '#0E2826', ink: '#F3EEE2', inkDark: '#E9E4D8' },
    frame: 'inset 0 0 0 10px #E9E0CC,inset 0 0 0 12px #C8BB9E,inset 0 18px 30px rgba(10,30,30,.45)', radius: 64,
    view: { ink: '#FFFFFF', shade: 'rgba(10,40,90,.38)' },
    paper: { bg: '#FBF6EA', ink: '#14382F', muted: '#476F5A', line: 'rgba(20,56,47,.3)', cta: '#14382F', ctaInk: '#FBF6EA', mark: '#D9452F' },
    bird: '#16233F', mote: 'rgba(255,255,255,.9)',
  },
  {
    id: 'amber', name: 'Golden hour', note: 'A low sun over the fields, dust in the light',
    layers: ['sky', 'glow', 'clouds', 'land', 'near', 'wires'],
    eyebrow: 'Window seat', line: 'Look up.',
    lead: 'Your day passes by the window. Say what’s on your mind, and we’ll keep the one thing that matters in view.',
    card: { kind: 'ticket', head: ['Today · single', 'Seat 1A'] },
    sun: [73.6, 65.1], band: 0.61, across: 0.75, sky: '#C9608C',
    wall: { light: '#E6D9C1', dark: '#2A2019', ink: '#3A2A1E', inkDark: '#F1E4CF' },
    frame: 'inset 0 0 0 10px #CDBB9C,inset 0 0 0 12px #B39F7F,inset 0 18px 30px rgba(60,30,20,.45)', radius: 64,
    view: { ink: '#FFF8EC', shade: 'rgba(50,10,50,.45)' },
    paper: { bg: '#FFF4E2', ink: '#3A1F2A', muted: '#8A4E40', line: 'rgba(58,31,42,.3)', cta: '#C8461F', ctaInk: '#FFFFFF', mark: '#C8461F' },
    bird: '#2A1630', mote: '#FFE7B8',
  },
  {
    id: 'night', name: 'Night train', note: 'Stars, a crescent moon, a lit farmhouse',
    layers: ['sky', 'twinkle', 'clouds', 'land', 'near', 'wires'],
    eyebrow: 'Night train', line: 'Rest well.',
    lead: 'The day is done and the lights are coming on. Put tomorrow’s first thing down, then look out the window.',
    card: { kind: 'ticket', head: ['Tonight · sleeper', 'Berth 4'] },
    sun: [80.6, 16.7], band: 0.58, across: 0.8, sky: '#43358A',
    wall: { light: '#3A2620', dark: '#24160F', ink: '#F7E9CC', inkDark: '#F7E9CC' },
    frame: 'inset 0 0 0 10px #5A3B28,inset 0 0 0 12px #C59A5C,inset 0 18px 30px rgba(0,0,0,.6)', radius: 64,
    view: { ink: '#FFF3DC', shade: 'rgba(0,0,30,.6)' },
    paper: { bg: '#161A40', ink: '#F6E7C8', muted: '#B9A98E', line: 'rgba(246,231,200,.3)', cta: '#FFC46A', ctaInk: '#1A1436', mark: '#FFC46A' },
    bird: '#0A0A24', mote: '#FFE78A',
  },
  {
    id: 'rain', name: 'After the rain', note: 'A rainbow from a cottage window, drops on the glass',
    layers: ['sky', 'glow', 'clouds', 'land', 'drops'],
    eyebrow: 'After the rain', line: 'Go outside.',
    lead: 'The rain has stopped. Say what’s on your mind, keep the one thing that matters, and take the rest of the afternoon back.',
    card: { kind: 'postcard', head: ['Postcard', 'From today'] },
    sun: [96.5, 4], band: 0.63, across: 0.2, sky: '#7DB3EC',
    wall: { light: '#EFE5D3', dark: '#26231E', ink: '#2A2A22', inkDark: '#EFE7DA' },
    frame: 'inset 0 0 0 14px #FBF8F2,inset 0 0 0 16px #D9D1C2,inset 0 22px 30px rgba(40,40,30,.35)', radius: 16,
    view: { ink: '#FFFFFF', shade: 'rgba(20,40,60,.45)' },
    paper: { bg: '#FFFDF7', ink: '#22302A', muted: '#5E6E64', line: 'rgba(34,48,42,.3)', cta: '#22302A', ctaInk: '#FFFDF7', mark: '#3D7FD8' },
    bird: '#24324A', mote: null,
  },
  {
    id: 'balloon', name: 'Balloon', note: 'Patchwork fields far below, other balloons drifting',
    layers: ['sky', 'glow', 'clouds', 'float'],
    eyebrow: 'Balloon', line: 'Rise above it.',
    lead: 'From up here the day looks small and the sky looks huge. Keep the one thing that matters; let the rest float.',
    card: { kind: 'tag', head: ['Flight log', 'Today'] },
    sun: [11.1, -4.4], band: 0.52, across: 0.75, sky: '#3A88E4',
    wall: {
      light: '#B98A55', dark: '#3A2716', ink: '#2B1A0E', inkDark: '#F2E3CC',
      texture: 'repeating-linear-gradient(90deg,rgba(70,40,15,.28) 0 3px,transparent 3px 22px),repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 9px,transparent 9px 18px)',
    },
    frame: 'inset 0 0 0 10px #6E4528,inset 0 0 0 12px #3E2614,inset 0 18px 30px rgba(40,20,10,.4)', radius: 40,
    view: { ink: '#FFFFFF', shade: 'rgba(10,40,90,.4)' },
    paper: { bg: '#FFF8EA', ink: '#1D2F4A', muted: '#536884', line: 'rgba(29,47,74,.3)', cta: '#D2322A', ctaInk: '#FFFFFF', mark: '#3A88E4' },
    bird: '#1A2A48', mote: null,
  },
  {
    id: 'above', name: 'Above the clouds', note: 'Sunrise over a sea of cloud, from seat 1A',
    layers: ['sky', 'glow', 'clouds', 'land', 'blink'],
    eyebrow: 'Above the clouds', line: 'Take the window seat.',
    lead: 'Every day is a short flight. Say what’s on your mind; we’ll keep the one thing that matters in view.',
    card: { kind: 'pass', head: ['Boarding · today', 'Seat 1A'] },
    sun: [73.6, 57.8], band: 0.5, across: 0.75, sky: '#9C7CC0',
    wall: { light: '#E9ECF0', dark: '#1A1D24', ink: '#1D2433', inkDark: '#E6E9EF' },
    frame: 'inset 0 0 0 10px #FBFBFC,inset 0 0 0 12px #C9CED7,inset 0 14px 30px rgba(20,30,60,.45)', radius: 120,
    view: { ink: '#FFFFFF', shade: 'rgba(30,20,80,.45)' },
    paper: { bg: '#FFFFFF', ink: '#1D2433', muted: '#566176', line: 'rgba(29,36,51,.22)', cta: '#1D2433', ctaInk: '#FFFFFF', mark: '#FF3B3B' },
    bird: '#1D2433', mote: null,
  },
] as const satisfies readonly Scene[];

export const DEFAULT_SCENE: SceneId = 'meadow';

export const sceneById = (id: string): Scene | undefined => (SCENES as readonly Scene[]).find(s => s.id === id);

/** What the sign-in screen says with no view. */
export const PLAIN_COPY = {
  lead: 'Dump a thought the moment it arrives. Slot it into your day. Then go outside.',
} as const;
