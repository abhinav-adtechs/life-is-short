'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Current time, re-read every 30 seconds and whenever the page comes back into view. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    let interval = 0;
    // Line ticks up with the minute so labels change on time.
    const first = window.setTimeout(() => { tick(); interval = window.setInterval(tick, 30000); }, 60000 - (Date.now() % 60000) + 50);
    const vis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearTimeout(first); clearInterval(interval); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return now;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The window's width, kept current. */
export function useWidth(): number {
  return useSyncExternalStore(
    cb => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); },
    () => window.innerWidth,
    () => 1440,
  );
}

/** Keep Tab inside an open dialog. */
export function useTrap(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref]);
}

/** Settings → Motion wins; otherwise the system setting. */
export const prefersReducedMotion = () => {
  if (typeof window === 'undefined') return false;
  const m = document.documentElement.dataset.motion;
  return m === 'reduce' || (m !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
};

type SRResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SR = {
  lang: string; interimResults: boolean; continuous: boolean; processLocally?: boolean;
  onresult: ((ev: { results: ArrayLike<SRResult> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SRCtor = (new () => SR) & { available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> };

const speechCtor = () => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
};
const join = (...parts: string[]) => parts.map(p => p.trim()).filter(Boolean).join(' ');

/** What you've said so far: words the recogniser has settled on, and the guess it's still revising. */
export interface Heard { text: string; interim: string }

/**
 * Dictation that keeps listening until you stop it. Words stream in through `onHeard` as you speak. Browsers end a
 * session after a pause, so a new one starts where it left off. `finishVoice` waits for the last words, then hands
 * over everything through `onFinish`. Where the browser can recognise speech on the device, nothing leaves it.
 * Without speech support, `onUnsupported` runs instead.
 */
export function useVoice(opts: {
  onHeard: (h: Heard) => void;
  onFinish: (text: string) => void;
  /** Listening stopped by itself (no connection, or a minute of silence): here's what was said. */
  onCutOff: (text: string) => void;
  onUnsupported: () => void;
}) {
  type Session = { r: SR; said: string; interim: string; finishing: boolean; quick: number; at: number; heardAt: number; timer: number };
  const cur = useRef<Session | null>(null);
  const blocked = useRef(false);
  const local = useRef(false);
  const [listening, setListening] = useState(false);
  const [onDevice, setOnDevice] = useState(false);
  const o = useRef(opts);
  o.current = opts;

  // On-device recognition (Chrome) when its language pack is already installed. Never downloads one unasked.
  useEffect(() => {
    const Ctor = speechCtor();
    if (!Ctor?.available) return;
    let alive = true;
    Ctor.available({ langs: [navigator.language || 'en-IN'], processLocally: true })
      .then(s => { if (alive) local.current = s === 'available'; })
      .catch(() => { /* cloud recognition, then */ });
    return () => { alive = false; };
  }, []);

  const end = useCallback((s: Session) => {
    if (cur.current !== s) return;
    cur.current = null;
    clearTimeout(s.timer);
    setListening(false);
  }, []);

  /** Stop without handing anything over. */
  const stopVoice = useCallback(() => {
    const s = cur.current;
    if (!s) return;
    end(s);
    try { s.r.abort(); } catch { /* already stopped */ }
  }, [end]);

  const begin = useCallback((s: Omit<Session, 'r'>, Ctor: SRCtor): boolean => {
    let r: SR;
    try { r = new Ctor(); } catch { return false; }
    const sess = s as Session;
    sess.r = r;
    r.lang = navigator.language || 'en-IN';
    r.interimResults = true;
    r.continuous = true;
    if (local.current && 'processLocally' in r) r.processLocally = true;
    // Everything said before this session; each session's results start from empty.
    const before = sess.said;
    r.onresult = ev => {
      if (cur.current !== sess) return;
      let fin = '', int = '';
      // Some browsers start each result with a space and some don't; join them with exactly one.
      for (let i = 0; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) fin = join(fin, ev.results[i][0].transcript);
        else int = join(int, ev.results[i][0].transcript);
      }
      sess.said = join(before, fin);
      sess.interim = int;
      sess.quick = 0;
      sess.heardAt = Date.now();
      o.current.onHeard({ text: sess.said, interim: sess.interim });
    };
    r.onerror = ev => {
      if (cur.current !== sess) return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(ev.error)) {
        blocked.current = true;
        end(sess);
        o.current.onUnsupported();
      }
      // Anything else (no speech, a network blip) ends the session; onend decides what next.
    };
    r.onend = () => {
      if (cur.current !== sess) return;
      const text = join(sess.said, sess.interim);
      if (sess.finishing) { end(sess); o.current.onFinish(text); return; }
      // Ended by itself: listen on, unless it keeps ending straight away or nobody has spoken for a minute.
      const quick = Date.now() - sess.at < 1500 ? sess.quick + 1 : 0;
      const next: Session = { ...sess, said: text, interim: '', quick, at: Date.now() };
      cur.current = next;
      if (quick >= 3 || Date.now() - sess.heardAt > 60000 || !begin(next, Ctor)) { end(next); o.current.onCutOff(text); }
    };
    try { r.start(); } catch { return false; }
    setOnDevice(!!r.processLocally);
    return true;
  }, [end]);

  /** Start listening; `base` is text already typed, which what you say is added to. */
  const startVoice = useCallback((base = '') => {
    if (cur.current) return;
    const Ctor = speechCtor();
    if (!Ctor || blocked.current) { o.current.onUnsupported(); return; }
    const s = { said: base.trim(), interim: '', finishing: false, quick: 0, at: Date.now(), heardAt: Date.now(), timer: 0 } as Session;
    cur.current = s;
    if (!begin(s, Ctor)) { cur.current = null; blocked.current = true; o.current.onUnsupported(); return; }
    setListening(true);
    o.current.onHeard({ text: s.said, interim: '' });
  }, [begin]);

  /** Stop listening and hand over everything said, once the last words are in. */
  const finishVoice = useCallback(() => {
    const s = cur.current;
    if (!s || s.finishing) return;
    s.finishing = true;
    try { s.r.stop(); } catch { /* ended already */ }
    // Some browsers never fire onend after stop(); don't keep you waiting.
    s.timer = window.setTimeout(() => {
      if (cur.current !== s) return;
      end(s);
      try { s.r.abort(); } catch { /* gone */ }
      o.current.onFinish(join(s.said, s.interim));
    }, 1500);
  }, [end]);

  useEffect(() => () => { const s = cur.current; cur.current = null; if (s) { clearTimeout(s.timer); try { s.r.abort(); } catch { /* noop */ } } }, []);

  return { listening, onDevice, startVoice, stopVoice, finishVoice, supported: () => !!speechCtor() && !blocked.current };
}
