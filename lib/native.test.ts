import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_STATE, appReturnUrl, googleState, onNativeCommand, readCommand } from './native';

describe('readCommand', () => {
  it('takes the commands the app sends', () => {
    expect(readCommand({ name: 'dump' })).toEqual({ name: 'dump' });
    expect(readCommand({ name: 'dump', text: '  Call mum tomorrow at 9 ' })).toEqual({ name: 'dump', text: 'Call mum tomorrow at 9' });
    expect(readCommand({ name: 'dump', text: '   ' })).toEqual({ name: 'dump' });
    expect(readCommand({ name: 'dump', text: 'a'.repeat(5000) })).toEqual({ name: 'dump', text: 'a'.repeat(4000) });
    expect(readCommand({ name: 'listen' })).toEqual({ name: 'listen' });
    expect(readCommand({ name: 'open', sheet: 'review' })).toEqual({ name: 'open', sheet: 'review' });
  });

  it('drops anything else', () => {
    expect(readCommand(null)).toBeNull();
    expect(readCommand('dump')).toBeNull();
    expect(readCommand({ name: 'open', sheet: 'billing' })).toBeNull();
    expect(readCommand({ name: 'eval', code: '1' })).toBeNull();
  });
});

describe('Google sign-in from the app', () => {
  it('marks the state only in the app', () => {
    expect(googleState('abc', true)).toBe(`${APP_STATE}abc`);
    expect(googleState('abc', false)).toBe('abc');
  });

  it('hands the answer back to the app from the system sign-in sheet', () => {
    expect(appReturnUrl('?code=4%2F0AQ&state=app.123&scope=x', false)).toBe('lifeisshort://google/callback?code=4%2F0AQ&state=app.123&scope=x');
    expect(appReturnUrl('error=access_denied&state=app.123', false)).toBe('lifeisshort://google/callback?error=access_denied&state=app.123');
  });

  it('finishes on the page in a browser, and in the app itself', () => {
    expect(appReturnUrl('?code=1&state=123', false)).toBeNull();
    expect(appReturnUrl('?code=1', false)).toBeNull();
    expect(appReturnUrl('?code=1&state=app.123', true)).toBeNull();
  });
});

/* ---------- apple/Shared/Resources/Bridge.js, run against a stand-in for an app's web view ---------- */

type Message = Record<string, unknown> & { type: string };
type Fake = { win: Record<string, any>; posted: Message[]; nav: Record<string, any>; meta: { content: string } };

const BRIDGE = readFileSync(fileURLToPath(new URL('../apple/Shared/Resources/Bridge.js', import.meta.url)), 'utf8');

function loadBridge(config: Record<string, unknown>, reply: (m: Message) => unknown = () => true): Fake {
  const posted: Message[] = [];
  const win: Record<string, any> = {
    webkit: { messageHandlers: { lis: { postMessage: (m: Message) => { posted.push(m); return Promise.resolve(reply(m)); } } } },
    addEventListener: () => undefined,
  };
  const nav: Record<string, any> = { language: 'en-IN' };
  const meta = { content: 'width=device-width, initial-scale=1, viewport-fit=cover' };
  const globals: Record<string, unknown> = {
    window: win,
    navigator: nav,
    document: { readyState: 'complete', documentElement: {}, body: {}, querySelector: () => meta, addEventListener: () => undefined },
    location: { href: 'https://lis.example.com/app' },
    getComputedStyle: () => ({ backgroundColor: 'rgb(13, 17, 23)' }),
    matchMedia: () => ({ addEventListener: () => undefined }),
    MutationObserver: class { observe() { /* nothing changes here */ } },
  };
  const bridge = new Function(...Object.keys(globals), `return (\n${BRIDGE}\n);`)(...Object.values(globals));
  bridge({ platform: 'ios', version: '1.0.0', build: '7', ...config });
  return { win, posted, nav, meta };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe('Bridge.js', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('puts lisNative on the page, read-only', () => {
    const { win } = loadBridge({});
    expect(win.lisNative.platform).toBe('ios');
    expect(win.lisNative.build).toBe('7');
    expect(Object.isFrozen(win.lisNative)).toBe(true);
    expect(() => { win.lisNative = null; }).toThrow();
  });

  it('says whether passkeys work in this app: only when it’s linked to the site', () => {
    expect(loadBridge({}).win.lisNative.passkeys).toBe(false);
    expect(loadBridge({ passkeys: 'yes' }).win.lisNative.passkeys).toBe(false);
    expect(loadBridge({ passkeys: true }).win.lisNative.passkeys).toBe(true);
  });

  it('holds commands until the planner listens', () => {
    const { win } = loadBridge({});
    win.lisNative._receive({ kind: 'command', command: { name: 'dump', text: 'Call mum' } });
    const got: unknown[] = [];
    const off = win.lisNative.onCommand((c: unknown) => got.push(c));
    expect(got).toEqual([{ name: 'dump', text: 'Call mum' }]);
    win.lisNative._receive({ kind: 'command', command: { name: 'listen' } });
    off();
    win.lisNative._receive({ kind: 'command', command: { name: 'open', sheet: 'review' } });
    expect(got).toEqual([{ name: 'dump', text: 'Call mum' }, { name: 'listen' }]);
  });

  it('answers the smoke test’s ping through lib/native, and checks commands', () => {
    const { win, posted } = loadBridge({});
    vi.stubGlobal('window', win);
    const got: unknown[] = [];
    onNativeCommand(c => got.push(c));
    win.lisNative._receive({ kind: 'command', command: { name: 'ping' } });
    win.lisNative._receive({ kind: 'command', command: { name: 'open', sheet: 'nope' } });
    win.lisNative._receive({ kind: 'command', command: { name: 'open', sheet: 'settings' } });
    expect(posted.map(m => m.type)).toContain('pong');
    expect(got).toEqual([{ name: 'open', sheet: 'settings' }]);
  });

  it('reports the page colour and stops pinch zoom on iPhone and iPad', () => {
    const { posted, meta } = loadBridge({});
    expect(posted).toContainEqual({ type: 'appearance', background: 'rgb(13, 17, 23)' });
    expect(meta.content).toBe('width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1');
    expect(loadBridge({ platform: 'macos' }).meta.content).not.toContain('maximum-scale');
  });

  it('stands in for navigator.share with the share sheet', async () => {
    const { nav, posted } = loadBridge({}, m => m.type !== 'share' || m.title === 'My planner');
    await nav.share({ title: 'My planner', url: '/shared#abc' });
    expect(posted).toContainEqual({ type: 'share', title: 'My planner', url: 'https://lis.example.com/shared#abc' });
    await expect(nav.share({ title: 'Other', text: 'x' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(nav.canShare({ url: 'https://x.app' })).toBe(true);
  });

  it('leaves dictation to the browser unless the app offers it', () => {
    expect(loadBridge({ speech: false }).win.webkitSpeechRecognition).toBeUndefined();
  });

  it('speaks SpeechRecognition with the app’s recogniser behind it, as useVoice reads it', async () => {
    const { win, posted } = loadBridge({ speech: true }, m => (m.type === 'speech.available' ? 'available' : true));
    const Recognition = win.webkitSpeechRecognition;
    expect(win.SpeechRecognition).toBe(Recognition);
    expect(await Recognition.available({ langs: ['en-IN'], processLocally: true })).toBe('available');

    const r = new Recognition();
    r.lang = 'en-IN';
    r.interimResults = true;
    r.continuous = true;
    r.processLocally = true;
    const heard: { fin: string; int: string }[] = [];
    const events: string[] = [];
    r.onstart = () => events.push('start');
    r.onresult = (ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => {
      // The same walk components/hooks.ts does.
      let fin = '', int = '';
      for (let i = 0; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) fin = [fin, ev.results[i][0].transcript].filter(Boolean).join(' ');
        else int = [int, ev.results[i][0].transcript].filter(Boolean).join(' ');
      }
      heard.push({ fin, int });
    };
    r.onerror = (ev: { error: string }) => events.push(`error:${ev.error}`);
    r.onend = () => events.push('end');

    r.start();
    expect(posted.at(-1)).toEqual({ type: 'speech.start', id: '1', lang: 'en-IN', interim: true, onDevice: true });
    expect(() => r.start()).toThrow();
    const send = (event: Record<string, unknown>) => win.lisNative._receive({ kind: 'speech', id: '1', ...event });
    send({ event: 'start' });
    send({ event: 'result', segments: [{ text: 'Call the plumber tomorrow', isFinal: true }, { text: 'buy milk', isFinal: false }] });
    r.stop();
    expect(posted.at(-1)).toEqual({ type: 'speech.stop', id: '1' });
    send({ event: 'result', segments: [{ text: 'Call the plumber tomorrow', isFinal: true }, { text: 'buy milk.', isFinal: true }] });
    send({ event: 'end' });
    expect(heard).toEqual([
      { fin: 'Call the plumber tomorrow', int: 'buy milk' },
      { fin: 'Call the plumber tomorrow buy milk.', int: '' },
    ]);
    expect(events).toEqual(['start', 'end']);

    // A session that's over hears nothing more, and the next one starts afresh.
    send({ event: 'result', segments: [{ text: 'late', isFinal: true }] });
    expect(heard).toHaveLength(2);
    r.start();
    expect(posted.at(-1)).toMatchObject({ type: 'speech.start', id: '2' });
  });

  it('reports a refusal from the app as an error, then the end', async () => {
    const { win } = loadBridge({ speech: true }, m => (m.type === 'speech.start' ? Promise.reject(new Error('no')) : true));
    const r = new win.webkitSpeechRecognition();
    const events: string[] = [];
    r.onerror = (ev: { error: string }) => events.push(`error:${ev.error}`);
    r.onend = () => events.push('end');
    r.start();
    await tick();
    expect(events).toEqual(['error:service-not-allowed', 'end']);
  });
});
