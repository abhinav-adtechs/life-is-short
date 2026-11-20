// Draws the widgets' window views from the planner's own scenes (public/scenes), in Chromium: each scene's layers,
// framed for each widget size, at 2x and 3x, as JPEGs in apple/Widgets/Resources/Scenes.xcassets. The art uses SVG
// blur filters iOS can't draw, so the widgets get pictures. Each is about the widget's own size in pixels: WidgetKit
// refuses images much bigger than the widget.
// Run from the repo root: node apple/scripts/scenes.mjs  (needs Playwright: npm i -g playwright && npx playwright install chromium)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = path.join(root, 'apple/Widgets/Resources/Scenes.xcassets');

/** Back to front. The near fields are drawn twice as wide as the view, so they can pass in the home page. */
const LAYERS = {
  meadow: ['sky', 'glow', 'clouds', 'land', 'near'],
  amber: ['sky', 'glow', 'clouds', 'land', 'near'],
  night: ['sky', 'clouds', 'land', 'near', 'twinkle'],
  balloon: ['sky', 'glow', 'clouds', 'float'],
};
/** Where the land meets the sky in each scene's 16:10 art, as a share of its height. */
const HORIZON = { meadow: 0.655, amber: 0.655, night: 0.66, balloon: 0.58 };
/** Each widget size, in points on the largest iPhones, and how it's framed: which part of the art across (0 left, 1
 *  right) and where the horizon sits (a share of the height). The art is scaled up only as far as that needs. */
const SIZES = {
  small: { w: 170, h: 170, across: { meadow: 0.82, amber: 0.62, night: 0.86, balloon: 0.74 }, horizon: 0.64 },
  medium: { w: 364, h: 170, across: {}, horizon: 0.66 },
  // The ticket covers the land, so the sky shows at the art's own scale; the balloons come in closer.
  large: { w: 364, h: 382, across: { meadow: 0.62, amber: 0.58, night: 0.64, balloon: 0.7 }, horizon: { ...HORIZON, balloon: 0.48 } },
};

function frame(scene, { w, h, across, horizon }) {
  const ax = across[scene] ?? 0.5;
  const hy = (typeof horizon === 'number' ? horizon : horizon[scene]) * h;
  const f = HORIZON[scene];
  const sh = Math.max(h, w / 1.6, hy / f, (h - hy) / (1 - f));
  const sw = sh * 1.6;
  const left = (w - sw) * ax, top = hy - f * sh;
  const layers = LAYERS[scene].map(l => {
    const src = pathToFileURL(path.join(root, 'public/scenes', scene, `${l}.svg`)).href;
    const style = l === 'near' ? `width:200%;left:${-0.12 * sw}px` : 'width:100%;left:0';
    return `<img src="${src}" style="position:absolute;top:0;height:100%;${style}">`;
  }).join('');
  return `<!doctype html><body style="margin:0;background:#000"><div style="position:relative;overflow:hidden;width:${w}px;height:${h}px">`
    + `<div style="position:absolute;left:${left}px;top:${top}px;width:${sw}px;height:${sh}px">${layers}</div></div></body>`;
}

// A page from a file, so it may load the art's files.
const work = mkdtempSync(path.join(tmpdir(), 'lis-scenes-'));
const browser = await chromium.launch();
for (const scale of [2, 3]) {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 400, height: 400 } });
  for (const scene of Object.keys(LAYERS)) {
    for (const [size, spec] of Object.entries(SIZES)) {
      const dir = path.join(out, `window-${scene}-${size}.imageset`);
      mkdirSync(dir, { recursive: true });
      const html = path.join(work, 'frame.html');
      writeFileSync(html, frame(scene, spec));
      await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
      await page.screenshot({ path: path.join(dir, `${scene}-${size}@${scale}x.jpg`), type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: spec.w, height: spec.h } });
      const images = [2, 3].map(s => ({ filename: `${scene}-${size}@${s}x.jpg`, idiom: 'universal', scale: `${s}x` }));
      writeFileSync(path.join(dir, 'Contents.json'), JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
    }
  }
  await page.close();
}
writeFileSync(path.join(out, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log(`Wrote the widgets' window views to ${path.relative(root, out)}`);
