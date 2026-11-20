// Raw screenshots of the planner with the demo data, for the README images: node scripts/showcase/capture.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { storage, NOW } from './seed.mjs';
import fs from 'node:fs';
const DIR = new URL('./out/raw/', import.meta.url).pathname;
fs.mkdirSync(DIR, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
async function shoot(name, { w, h, dsf, theme, act }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, timezoneId: 'Asia/Kolkata', locale: 'en-GB', hasTouch: w < 600, isMobile: w < 600 });
  await ctx.addInitScript(d => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } },
    storage({ 'ds.prefs': JSON.stringify({ theme }) }));
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto('http://localhost:3000/app');
  await page.locator('section.next').first().waitFor();
  await page.waitForTimeout(1800);
  if (act) await act(page);
  await page.screenshot({ path: DIR + name + '.png' });
  console.log('shot', name);
  await ctx.close();
}
const L = { w: 1536, h: 880, dsf: 2 }, P = { w: 390, h: 844, dsf: 3 };
await shoot('L-tide', { ...L, theme: 'tide' });
await shoot('L-night', { ...L, theme: 'night' });
await shoot('L-day', { ...L, theme: 'day' });
await shoot('L-settings', { ...L, theme: 'tide', act: async p => { await p.getByRole('button', { name: /Settings/ }).first().click(); await p.waitForTimeout(1200); } });
await shoot('L-goals', { ...L, theme: 'tide', act: async p => { await p.getByRole('button', { name: 'Goals', exact: true }).first().click(); await p.waitForTimeout(1000); await p.getByRole('tab', { name: 'Map' }).click(); await p.waitForTimeout(1500); } });
await shoot('P-tide', { ...P, theme: 'tide' });
await shoot('P-night', { ...P, theme: 'night' });
await shoot('P-cal', { ...P, theme: 'tide', act: async p => { await p.getByRole('tab', { name: /Calendar/ }).first().click().catch(() => p.getByText('Calendar', { exact: true }).first().click()); await p.waitForTimeout(1200); } });
await browser.close();
