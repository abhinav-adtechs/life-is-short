// Records the showcase video's frames into out/: node scripts/showcase/record.mjs [dry]. `dry` takes a screenshot per
// scene instead. Needs the app running locally in local-only mode (see README.md), Playwright and Chromium.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
import { storage, NOW } from './seed.mjs';
const DIR = new URL('./', import.meta.url).pathname;
const OUT = DIR + 'out/';
fs.mkdirSync(OUT + 'shots', { recursive: true });
const DRY = process.argv[2] === 'dry';
const BASE = 'http://localhost:3000';

const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'Asia/Kolkata', locale: 'en-GB', colorScheme: 'light' });
await ctx.addInitScript(d => {
  if (location.pathname === '/__stage') { localStorage.clear(); for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }
}, storage({ 'ds.prefs': JSON.stringify({ theme: 'tide' }) }));
// The stage page, and /app without its no-framing headers so the stage can hold it.
await ctx.route(`${BASE}/__stage`, r => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(DIR + 'stage.html', 'utf8') }));
await ctx.route(`${BASE}/app`, async r => {
  const res = await r.fetch();
  const headers = { ...res.headers() };
  delete headers['x-frame-options'];
  if (headers['content-security-policy']) headers['content-security-policy'] = headers['content-security-policy'].replace(/frame-ancestors[^;]*;?/g, '');
  await r.fulfill({ response: res, headers });
});
// The recording runs without an AI key, so the sort is answered here in the AI route's own shape: what Gemini returns
// for this dump. Everything else on screen is the app itself.
await ctx.route(`${BASE}/api/sort`, async r => {
  const prompt = String(JSON.parse(r.request().postData() || '{}').prompt || '');
  const ref = (/^(\S+) \| P\d \| Book 3 guests/m.exec(prompt) || [])[1];
  await new Promise(res => setTimeout(res, 1100));
  await r.fulfill({ json: {
    heard: '',
    add: [
      { title: 'Call the bank about the card', priority: 2, minutes: 15, date: '2026-11-21', time: '09:00', deadline: false, notes: '', label: 'personal', goal: null, repeat: null },
      { title: 'Renew my passport', priority: 1, minutes: 30, date: '2026-11-27', time: null, deadline: true, notes: '', label: 'personal', goal: null, repeat: null },
      { title: 'Order a new mic', priority: 2, minutes: 15, date: null, time: null, deadline: false, notes: '', label: 'work', goal: 'gpodcast', repeat: null },
    ],
    update: ref ? [{ ref, done: true }] : [],
    reply: 'Ticked off booking the guests. The bank call goes on tomorrow at 9, the passport is due Friday, and the mic goes on the podcast.',
  } });
});

const page = await ctx.newPage();
await page.clock.setFixedTime(NOW);
page.on('pageerror', e => console.log('pageerror', e.message.slice(0, 200)));
await page.goto(`${BASE}/__stage`);
await page.evaluate(() => document.fonts.ready);
const app = page.frameLocator('#app');
const phone = page.frameLocator('#ph');
const S = (fn, ...a) => page.evaluate(fn, ...a);
const wait = ms => page.waitForTimeout(ms);

// The fake cursor follows the real mouse, eased.
let cx = 960, cy = 700;
async function moveTo(x, y, ms = 650) {
  await S(([a, b, d]) => stage.glide(a, b, d), [x, y, ms]);
  await page.mouse.move(x, y, { steps: 4 });
  await wait(ms);
  cx = x; cy = y;
}
async function to(loc, fx = .5, fy = .5, ms) { const b = await loc.boundingBox(); if (!b) throw new Error('no box'); await moveTo(b.x + b.width * fx, b.y + b.height * fy, ms); }
async function click(loc, fx = .5, fy = .5) {
  await to(loc, fx, fy); await S(() => stage.press());
  const b = await loc.boundingBox();
  await loc.click({ position: { x: b.width * fx, y: b.height * fy } });
}

let shot = 0;
const mark = async name => { if (DRY) await page.screenshot({ path: `${OUT}shots/s${String(++shot).padStart(2, '0')}-${name}.png` }); };

// ---- recorder ----
const frames = [];
let cdp, t0;
if (!DRY) {
  fs.rmSync(OUT + 'frames', { recursive: true, force: true }); fs.mkdirSync(OUT + 'frames');
  cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const n = frames.length; frames.push(metadata.timestamp);
    fs.writeFile(`${OUT}frames/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'), () => {});
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
}

// Load the planner before the camera rolls.
await S(() => { document.getElementById('app').src = '/app'; });
// It opens on Today; the walkthrough starts from the Calendar view.
await app.locator('.td').waitFor();
await app.getByRole('button', { name: 'Calendar', exact: true }).click();
await app.locator('section.next').waitFor();
await wait(1500);
if (!DRY) { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 }); }
const start = Date.now();
const at = label => console.log(((Date.now() - start) / 1000).toFixed(1).padStart(5), label);

// 0 · Title
at('title'); await S(() => stage.show('#title')); await wait(3600); await mark('title');
await S(() => stage.show('#title', false)); await wait(500);

// 1 · The planner
at('planner'); await S(() => stage.show('#win')); await wait(500);
await S(() => stage.caption('The planner', 'Your goals, today’s outcomes and the one thing to do now.'));
await S(() => stage.cursorOn(true));
await to(app.locator('section.next h1'), .4, .5, 900); await wait(700);
await to(app.getByText('TODAY’S OUTCOMES').or(app.getByText('Today’s outcomes')).first(), .5, .5, 900); await wait(900);
await to(app.getByText('Launch the podcast').nth(1), .5, .5, 800); await wait(900);
await mark('planner');

// 2 · Dump it
at('dump'); await S(() => stage.caption('Dump it', 'Type it or say it. It pulls out every task — and shows you the plan first.'));
await click(app.getByPlaceholder(/Dump a task/));
await wait(300);
await page.keyboard.type('Booked all 3 guests! Call the bank tomorrow at 9 about my card, renew my passport by Friday, and order a new mic for the podcast', { delay: 22 });
await wait(400); await page.keyboard.press('Enter');
try { await app.getByRole('button', { name: /^Apply \d/ }).waitFor({ timeout: 15000 }); } catch (e) { await page.screenshot({ path: OUT + 'shots/fail.png' }); throw e; }
await wait(2600); await mark('plan');
await click(app.getByRole('button', { name: /^Apply \d/ }));
await wait(1600); await mark('applied');
await page.keyboard.press('Escape'); await wait(600);

// 3 · Do it
at('do'); await S(() => stage.caption('Do it', 'One task on screen. Done — and the next one is up.'));
await click(app.locator('section.next').getByRole('button', { name: 'Done', exact: true }));
await wait(2200); await mark('done');

// 4 · Goals
at('goals'); await S(() => stage.caption('Goals first', 'Every task moves a goal — or it’s off-goal. Each goal has a route to the finish.'));
await click(app.getByRole('button', { name: 'Goals', exact: true }).first());
await wait(1500); await mark('goals');
await to(app.locator('.gv-route'), .5, .3, 800);
await page.mouse.wheel(0, 380); await wait(1500);
await page.mouse.wheel(0, -380); await wait(800);

// 5 · Map
at('map'); await S(() => stage.caption('The map', 'Steps, waits, sub-goals and key results — and the critical path to the finish.'));
await click(app.getByRole('tab', { name: 'Map' }));
await wait(1200);
await click(app.getByRole('button', { name: /Full screen/ }));
await wait(1800); await mark('map');
const step = t => app.getByRole('dialog', { name: 'Map' }).getByText(t, { exact: true }).last();
await to(step('Record episode 1'), .5, .5, 800); await wait(1000);
await S(() => stage.caption('Tick it off', 'What it held up unlocks, the route fills in, and the ring counts up.'));
await click(app.getByRole('dialog', { name: 'Map' }).getByRole('button', { name: 'Heard back: Guests confirm a date' }));
await wait(2200); await mark('map-tick');
await click(app.getByRole('dialog', { name: 'Map' }).getByRole('button', { name: 'Done: Order a new mic' }));
await wait(2000);
await to(step('Edit episode 1'), .5, .5, 700); await wait(900);
await to(step('Submit the feed to Spotify and Apple'), .5, .5, 700); await wait(900);
await mark('map-hover');
await click(app.getByRole('dialog', { name: 'Map' }).getByRole('button', { name: 'Close the map' }).first());
await wait(900);

// 6 · Review
at('review'); await S(() => stage.caption('See how it went', 'Time on goals, done and missed, rhythm and load — for a day, week or month.'));
await click(app.getByRole('button', { name: /Analytics/ }).first());
await wait(1600); await mark('analytics');
await click(app.getByRole('button', { name: /Full review/ }).first());
await wait(2200); await mark('review');
await page.mouse.wheel(0, 420); await wait(1400);
await page.keyboard.press('Escape'); await wait(400); await page.keyboard.press('Escape'); await wait(500);

// 7 · Themes
at('themes'); await S(() => stage.caption('Make it yours', 'Three themes — Tide, Night train and Day train — accents, fonts and contrast.'));
await click(app.getByRole('button', { name: /Settings/ }).first());
await wait(1000);
await click(app.getByText('Night train', { exact: true }).first()); await wait(1800); await mark('night');
await click(app.getByText('Day train', { exact: true }).first()); await wait(1600);
await click(app.getByText('Night train', { exact: true }).first()); await wait(900);
await page.keyboard.press('Escape'); await wait(400);
await S(() => { document.getElementById('ph').src = '/app'; });
await wait(1200);

// 8 · Phone
at('phone'); await S(() => stage.cursorOn(false));
await S(() => { stage.show('#win', false); stage.caption('On every screen', 'Phone and laptop in sync — plus iPhone, iPad and Mac apps with Siri.'); });
await phone.locator('.td').waitFor(); await phone.getByRole('tab', { name: /Goals/ }).click();
await phone.locator('section.next').waitFor(); await wait(700);
await S(() => stage.show('#phone')); await wait(2200); await mark('phone');
await S(() => stage.cursorOn(true));
await to(phone.locator('section.next h1'), .5, .5, 700); await wait(400);
await page.mouse.wheel(0, 360); await wait(1600);
await page.mouse.wheel(0, -360); await wait(900);
await S(() => stage.cursorOn(false));

// 9 · Claude
at('claude'); await S(() => { stage.show('#phone', false); stage.caption('', ''); }); await wait(500);
await S(() => stage.show('#mcp')); await wait(500);
await S(() => stage.seq('#mcp .t1', 90)); 
await S(() => stage.seq('#mcp .msg', 850)); await wait(2600); await mark('mcp');
await S(() => stage.show('#mcp', false)); await wait(500);

// 10 · Security
at('security'); await S(() => stage.show('#sec')); await wait(300);
await S(() => stage.seq('#sec .tile', 260)); await wait(3000); await mark('security');
await S(() => stage.show('#sec', false)); await wait(500);

// 11 · Run your own
at('end'); await S(() => stage.show('#end')); await wait(5200); await mark('end');
at('stop'); const stopTs = Date.now() / 1000;

if (!DRY) {
  await cdp.send('Page.stopScreencast');
  await wait(300);
  const end = Math.max(frames[frames.length - 1] + 0.6, stopTs);
  const lines = frames.map((t, i) => `file 'frames/f${String(i).padStart(5, '0')}.jpg'\nduration ${(((frames[i + 1] ?? end) - t)).toFixed(4)}`);
  lines.push(`file 'frames/f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  fs.writeFileSync(OUT + 'frames.txt', lines.join('\n') + '\n');
  console.log('frames', frames.length, 'seconds', (end - frames[0]).toFixed(1));
}
await browser.close();
