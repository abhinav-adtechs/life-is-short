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

type SR = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
};

/**
 * Web Speech dictation with interim results streaming into the field.
 * Without speech support, focus the field and hint at the keyboard's own mic.
 */
export function useVoice(opts: { getValue: () => string; setValue: (v: string) => void; focusField: () => void; hint: (msg: string) => void }) {
  const rec = useRef<SR | null>(null);
  const blocked = useRef(false);
  const [listening, setListening] = useState(false);
  const o = useRef(opts);
  o.current = opts;

  const fallback = useCallback(() => {
    o.current.focusField();
    o.current.hint('Tap the mic on your keyboard and talk. It types straight into this box.');
  }, []);

  const stopVoice = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (r) { try { r.stop(); } catch { /* already stopped */ } }
    setListening(false);
  }, []);

  const startVoice = useCallback(() => {
    if (rec.current) { stopVoice(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor || blocked.current) { fallback(); return; }
    let r: SR;
    try { r = new Ctor(); } catch { blocked.current = true; fallback(); return; }
    rec.current = r;
    r.lang = navigator.language || 'en-IN';
    r.interimResults = true;
    r.continuous = true;
    const base = o.current.getValue().trim();
    r.onresult = ev => {
      let txt = '';
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      o.current.setValue((base ? base + ' ' : '') + txt.trim());
    };
    r.onerror = ev => {
      const hard = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(ev.error);
      stopVoice();
      if (hard) { blocked.current = true; fallback(); }
    };
    r.onend = () => { if (rec.current === r) stopVoice(); };
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null; blocked.current = true; fallback();
    }
  }, [fallback, stopVoice]);

  useEffect(() => () => { const r = rec.current; rec.current = null; try { r?.stop(); } catch { /* noop */ } }, []);

  return { listening, startVoice, stopVoice };
}
