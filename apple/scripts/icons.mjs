// Draws the app icons from the brand logo (scripts/brand/logo.py), in Chromium, like the website's icons:
//   iOS    public/brand/logo-square.svg at 1024, opaque (iOS rounds it; App Store Connect refuses an alpha channel)
//   macOS  public/brand/logo.svg on Apple's icon grid (an 824 plate on 1024, with the standard soft shadow), at every
//          size the Mac asks for, each drawn at its own size so the small ones stay crisp
// Run from the repo root: node apple/scripts/icons.mjs  (needs Playwright: npm i -g playwright && npx playwright install chromium)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = path.join(root, 'apple/Shared/Resources/Assets.xcassets/AppIcon.appiconset');
const svg = (name, px) => readFileSync(path.join(root, 'public/brand', name), 'utf8').replace('width="512" height="512"', `width="${px}" height="${px}"`);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const draw = async (px, html, file, transparent) => {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<!doctype html><body style="margin:0;background:${transparent ? 'transparent' : '#fff'}">${html}</body>`);
  await page.screenshot({ path: path.join(out, file), omitBackground: transparent, clip: { x: 0, y: 0, width: px, height: px } });
};

await draw(1024, svg('logo-square.svg', 1024), 'icon-ios-1024.png', false);
for (const px of [16, 32, 64, 128, 256, 512, 1024]) {
  const plate = Math.round(px * 824 / 1024);
  const shadow = `drop-shadow(0 ${(px * 10 / 1024).toFixed(2)}px ${(px * 12 / 1024).toFixed(2)}px rgba(0,0,0,.28))`;
  await draw(px, `<div style="width:${px}px;height:${px}px;display:grid;place-items:center"><div style="width:${plate}px;height:${plate}px;filter:${px >= 64 ? shadow : 'none'}">${svg('logo.svg', plate)}</div></div>`, `icon-mac-${px}.png`, true);
}
await browser.close();
console.log(`Wrote the app icons to ${path.relative(root, out)}`);
