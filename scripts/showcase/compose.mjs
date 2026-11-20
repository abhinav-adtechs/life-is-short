// Frames the raw screenshots into the README images in docs/images: node scripts/showcase/compose.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const DIR = new URL('./', import.meta.url).pathname;
const IMAGES = new URL('../../docs/images/', import.meta.url).pathname;
const sizes = { 'hero-light': [1200, 705], 'hero-dark': [1200, 705], phone: [1200, 650], themes: [1200, 384], settings: [1200, 757] };
const browser = await chromium.launch({ channel: 'chromium' });
for (const [mode, [w, h]] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto(`file://${DIR}compose.html?mode=${mode}`);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); });
  await page.screenshot({ path: `${IMAGES}${mode}.png` });
  await page.close(); console.log('made', mode);
}
await browser.close();
