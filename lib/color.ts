/** Small colour helpers for the appearance settings. Colours are #RRGGBB. */
export type RGB = [number, number, number];

export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

/** Colours for accounts and labels: distinct in light and dark, and away from the default orange accent. */
export const PALETTE = ['#3E63DD', '#12A594', '#D6409F', '#E5A000', '#8E4EC6', '#0B84D8', '#E5484D', '#5C7C2E'];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (c: RGB) =>
  '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Move a toward b by t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map(i => x[i] + (y[i] - x[i]) * t) as RGB);
}

export const rgba = (hex: string, a: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

/** WCAG relative luminance. */
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Nudge fg toward black or white, whichever is away from bg, until it reaches `ratio` against bg. */
export function ensureContrast(fg: string, bg: string, ratio: number) {
  if (contrast(fg, bg) >= ratio) return fg.toUpperCase();
  const toward = luminance(bg) > 0.18 ? '#000000' : '#FFFFFF';
  for (let t = 0.04; t < 1; t += 0.04) {
    const c = mix(fg, toward, t);
    if (contrast(c, bg) >= ratio) return c;
  }
  return toward;
}

/** Icon colour on a filled accent: white while it reads at 3:1, otherwise near-black. */
export const onColor = (fill: string, dark = '#0B0B0C') => (contrast('#FFFFFF', fill) >= 3 ? '#FFFFFF' : dark);
