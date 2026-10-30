// Injected by the iPhone, iPad and Mac apps (WebController.swift) into the main frame, before the page's own scripts.
// It gives the page `window.lisNative`, which lib/native.ts wraps for the planner, and stands in for what an app's web
// view lacks: dictation backed by the app's speech recogniser, the share sheet and the page colour for the window.
// The app calls this function with its config: platform, version, build, whether native speech is on, and the state of
// its bundled page when that's what's showing.
(function (config) {
  'use strict';
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.lis;
  if (!handler || window.lisNative) return;
  const noop = () => {};

  /** A message to the app; resolves with its answer, rejects when it refuses. */
  const post = (type, body) => {
    const message = { type };
    for (const [k, v] of Object.entries(body || {})) if (v !== undefined && v !== null) message[k] = v;
    try { return Promise.resolve(handler.postMessage(message)); } catch (e) { return Promise.reject(e); }
  };

  /* ---------- commands from the app: Siri, quick actions, links, the Mac menu bar ---------- */

  let listeners = [];
  let waiting = [];
  const deliver = (command) => {
    if (!listeners.length) { waiting.push(command); return; }
    for (const fn of listeners.slice()) {
      try { fn(command); } catch (e) { console.error(e); }
    }
  };

  /* ---------- dictation ---------- */

  const sessions = new Map();
  let lastId = 0;

  const lisNative = Object.freeze({
    platform: config.platform,
    version: config.version,
    build: config.build,
    /** The app is linked to this site (webcredentials), so passkeys work here. */
    passkeys: config.passkeys === true,
    /** The app's own setup and offline page reads its state here. */
    page: config.page || null,
    post,
    /** Commands wait until something listens, so a quick action that launched the app lands once the planner is up. */
    onCommand(fn) {
      listeners.push(fn);
      const queued = waiting;
      waiting = [];
      queued.forEach(deliver);
      return () => { listeners = listeners.filter((f) => f !== fn); };
    },
    ready() { return post('ready').catch(noop); },
    haptic(kind) { post('haptic', { kind }).catch(noop); },
    share(data) {
      const d = data || {};
      let url;
      try { url = d.url ? new URL(String(d.url), location.href).href : undefined; } catch (e) { return Promise.reject(new TypeError('Invalid URL')); }
      return post('share', { title: d.title && String(d.title), text: d.text && String(d.text), url }).then((done) => {
        if (!done) throw new DOMException('Share canceled', 'AbortError');
      });
    },
    openExternal(url) { return post('external.open', { url: String(url) }); },
    /** The app calls this with commands and speech events. */
    _receive(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'command' && msg.command) deliver(msg.command);
      else if (msg.kind === 'speech') { const r = sessions.get(msg.id); if (r) r._event(msg); }
    },
  });
  Object.defineProperty(window, 'lisNative', { value: lisNative, enumerable: false, configurable: false, writable: false });

  const define = (target, name, value) => {
    try { Object.defineProperty(target, name, { value, writable: true, configurable: true }); } catch (e) { try { target[name] = value; } catch (e2) { /* left as it was */ } }
  };

  /* SpeechRecognition with the app's recogniser behind it, on the device when the language allows. It speaks the same
     events as the browser's, so components/hooks.ts (useVoice) runs unchanged. */
  if (config.speech) {
    class NativeSpeechRecognition extends EventTarget {
      constructor() {
        super();
        this.lang = navigator.language || 'en-US';
        this.continuous = false;
        this.interimResults = false;
        this.maxAlternatives = 1;
        this.processLocally = false;
        this.onstart = null; this.onaudiostart = null; this.onresult = null; this.onerror = null; this.onend = null;
        this._id = null;
      }

      start() {
        if (this._id) throw new DOMException('Recognition has already started.', 'InvalidStateError');
        const id = String(++lastId);
        this._id = id;
        sessions.set(id, this);
        post('speech.start', { id, lang: this.lang, interim: !!this.interimResults, onDevice: !!this.processLocally }).catch(() => {
          if (this._id !== id) return;
          this._event({ event: 'error', error: 'service-not-allowed' });
          this._event({ event: 'end' });
        });
      }

      stop() { if (this._id) post('speech.stop', { id: this._id }).catch(noop); }

      abort() { if (this._id) post('speech.abort', { id: this._id }).catch(noop); }

      _event(msg) {
        switch (msg.event) {
          case 'start':
            this._fire(new Event('start'));
            this._fire(new Event('audiostart'));
            break;
          case 'result': {
            const results = (msg.segments || []).map((s) => {
              const alternative = { transcript: String(s.text || ''), confidence: s.isFinal ? 1 : 0 };
              const result = [alternative];
              result.isFinal = !!s.isFinal;
              result.item = (i) => result[i] || null;
              return result;
            });
            results.item = (i) => results[i] || null;
            const ev = new Event('result');
            ev.results = results;
            ev.resultIndex = Math.max(0, results.findIndex((r) => !r.isFinal));
            this._fire(ev);
            break;
          }
          case 'error': {
            const ev = new Event('error');
            ev.error = msg.error || 'aborted';
            ev.message = msg.message || '';
            this._fire(ev);
            break;
          }
          case 'end':
            sessions.delete(this._id);
            this._id = null;
            this._fire(new Event('end'));
            break;
        }
      }

      _fire(ev) {
        const on = this['on' + ev.type];
        if (typeof on === 'function') {
          try { on.call(this, ev); } catch (e) { console.error(e); }
        }
        this.dispatchEvent(ev);
      }

      /** 'available' when the device can recognise the language without the network. */
      static available(options) {
        const o = options || {};
        const lang = (o.langs && o.langs[0]) || navigator.language;
        return post('speech.available', { lang, onDevice: !!o.processLocally })
          .then((v) => (typeof v === 'string' ? v : 'unavailable'), () => 'unavailable');
      }
    }
    define(window, 'SpeechRecognition', NativeSpeechRecognition);
    define(window, 'webkitSpeechRecognition', NativeSpeechRecognition);
  }

  /* The share sheet, where the web view has no navigator.share. */
  if (typeof navigator.share !== 'function') {
    define(navigator, 'share', (data) => lisNative.share(data));
    if (typeof navigator.canShare !== 'function') define(navigator, 'canShare', (data) => !!data && !!(data.url || data.text || data.title));
  }

  /* ---------- the page's colour, for the status bar, title bar and window ---------- */

  let lastBackground = '';
  let timer = 0;
  const report = () => {
    const root = document.documentElement;
    if (!root) return;
    const clear = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
    let bg = document.body ? getComputedStyle(document.body).backgroundColor : '';
    if (clear(bg)) bg = getComputedStyle(root).backgroundColor;
    if (clear(bg) || bg === lastBackground) return;
    lastBackground = bg;
    post('appearance', { background: bg }).catch(noop);
  };
  // Once now, and again after any transition settles.
  const soon = () => { report(); clearTimeout(timer); timer = setTimeout(report, 400); };

  const start = () => {
    soon();
    const watch = { attributes: true, attributeFilter: ['data-theme', 'data-contrast', 'style', 'class'] };
    new MutationObserver(soon).observe(document.documentElement, watch);
    if (document.body) new MutationObserver(soon).observe(document.body, watch);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', soon);
    // An app doesn't pinch-zoom, and inputs under 16px mustn't zoom the page when focused.
    if (config.platform !== 'macos') {
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta && !/maximum-scale/.test(meta.content)) meta.content += ', maximum-scale=1';
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  /* ---------- errors, for the CI smoke test and debug builds ---------- */

  if (config.debug) {
    const send = (message) => post('log', { message: String(message).slice(0, 2000) }).catch(noop);
    window.addEventListener('error', (e) => send(`${e.message} (${e.filename}:${e.lineno})`));
    window.addEventListener('unhandledrejection', (e) => send(`Unhandled rejection: ${e.reason && (e.reason.stack || e.reason)}`));
    const error = console.error.bind(console);
    console.error = (...args) => { send(args.map(String).join(' ')); error(...args); };
  }
})
