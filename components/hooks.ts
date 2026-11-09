'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { joinWords, readResults, type Doubt, type SRResult } from '@/lib/speech';
import { native } from '@/lib/native';

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
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; processLocally?: boolean; phrases?: unknown;
  onresult: ((ev: { results: ArrayLike<SRResult> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SRCtor = (new () => SR) & { available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> };
type PhraseCtor = new (phrase: string, boost?: number) => unknown;

const speechCtor = () => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
};
const deviceLang = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-IN';
/** How strongly the recogniser leans towards your words (0 to 10). Enough to prefer a name, not to hear one everywhere. */
const BOOST = 3;

/** What you've said so far: words the recogniser has settled on, and the guess it's still revising. */
export interface Heard { text: string; interim: string }
/** Everything said, once listening stops: the words, and where the recogniser wasn't sure. */
export interface Spoken { text: string; doubts: Doubt[] }

/**
 * Where listening is, for the bar to show: off; `starting` until the mic is open (a permission prompt waits here);
 * `ready` and listening; `speaking` while words are coming in; `finishing` once stopped, until the last words land.
 */
export type VoicePhase = 'off' | 'starting' | 'ready' | 'speaking' | 'finishing';
/** Why it can't listen: no dictation in this browser, the mic is blocked for the site, or there's no mic. */
export type NoVoice = 'unsupported' | 'denied' | 'no-mic';

/** Words this long apart are still one stretch of speaking. */
const QUIET_MS = 900;

/**
 * Dictation that keeps listening until you stop it. Words stream in through `onHeard` as you speak. Browsers end a
 * session after a pause, so a new one starts where it left off. `finishVoice` waits for the last words, then hands
 * over everything through `onFinish`. Where the browser can recognise speech on the device, nothing leaves it.
 * Without speech support, or with the mic blocked or missing, `onUnsupported` runs instead, saying which. `phase` says
 * where it is (VoicePhase), for the bar to show.
 *
 * It listens in `lang` (your Settings → Voice choice, else the device's language), asks for the recogniser's top three
 * guesses, and leans towards `phrases` (your names and words) where the recogniser takes them: Chrome on the device,
 * and the apps' native recogniser.
 */
export function useVoice(opts: {
  onHeard: (h: Heard) => void;
  onFinish: (s: Spoken) => void;
  /** Listening stopped by itself (no connection, or a minute of silence): here's what was said. */
  onCutOff: (s: Spoken) => void;
  onUnsupported: (why: NoVoice) => void;
  /** The language to listen in; null for the device's. */
  lang?: string | null;
  /** The words to listen out for, read as each session starts. */
  phrases?: () => string[];
  /** The browser can't listen in `lang`; it listens in the device's language instead. */
  onLangUnsupported?: (lang: string) => void;
}) {
  type Session = {
    r: SR; said: string; interim: string; doubts: Doubt[]; finishing: boolean; quick: number; at: number; heardAt: number; timer: number;
  };
  const cur = useRef<Session | null>(null);
  /** Why the last try couldn't listen. Only a browser without dictation stays that way; the rest are tried again. */
  const blocked = useRef<NoVoice | null>(null);
  const local = useRef(false);
  /** The browser refused the phrases, or the language: sessions after go without. */
  const noPhrases = useRef(false);
  const badLang = useRef<string | null>(null);
  const [phase, setPhase] = useState<VoicePhase>('off');
  const quiet = useRef(0);
  const [onDevice, setOnDevice] = useState(false);
  const o = useRef(opts);
  o.current = opts;
  const want = opts.lang || null;
  const langOf = useCallback(() => (o.current.lang && o.current.lang !== badLang.current ? o.current.lang : deviceLang()), []);

  // On-device recognition (Chrome) when its language pack is already installed. Never downloads one unasked.
  useEffect(() => {
    const Ctor = speechCtor();
    local.current = false;
    if (!Ctor?.available) return;
    let alive = true;
    Ctor.available({ langs: [langOf()], processLocally: true })
      .then(s => { if (alive) local.current = s === 'available'; })
      .catch(() => { /* cloud recognition, then */ });
    return () => { alive = false; };
  }, [want, langOf]);

  const end = useCallback((s: Session) => {
    if (cur.current !== s) return;
    cur.current = null;
    clearTimeout(s.timer);
    clearTimeout(quiet.current);
    setPhase('off');
  }, []);

  /** The mic is open, or words are coming in: show it, and settle back to listening once they stop. */
  const hear = useCallback((sess: Session, speaking: boolean) => {
    if (cur.current !== sess || sess.finishing) return;
    blocked.current = null;
    if (!speaking) { setPhase(p => (p === 'starting' ? 'ready' : p)); return; }
    setPhase('speaking');
    clearTimeout(quiet.current);
    // A session that ended by itself carries on as a new one, so this asks whichever is listening now.
    quiet.current = window.setTimeout(() => {
      if (cur.current && !cur.current.finishing) setPhase('ready');
    }, QUIET_MS);
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
    r.lang = langOf();
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 3;
    if (local.current && 'processLocally' in r) r.processLocally = true;
    // Your words, where the recogniser takes them: Chrome only on the device, the apps always.
    const Phrase = (window as unknown as { SpeechRecognitionPhrase?: PhraseCtor }).SpeechRecognitionPhrase;
    const phrases = !noPhrases.current && Phrase && 'phrases' in r && (r.processLocally || native()) ? o.current.phrases?.() ?? [] : [];
    if (phrases.length && Phrase) {
      try { r.phrases = phrases.map(p => new Phrase(p, BOOST)); } catch { noPhrases.current = true; }
    }
    // Everything said before this session; each session's results start from empty.
    const before = sess.said, doubtsBefore = sess.doubts;
    r.onaudiostart = () => hear(sess, false);
    r.onspeechstart = () => hear(sess, true);
    r.onresult = ev => {
      if (cur.current !== sess) return;
      const { fin, int, doubts } = readResults(ev.results);
      sess.said = joinWords(before, fin);
      sess.interim = int;
      sess.doubts = [...doubtsBefore, ...doubts].slice(-12);
      sess.quick = 0;
      sess.heardAt = Date.now();
      hear(sess, true);
      o.current.onHeard({ text: sess.said, interim: sess.interim });
    };
    r.onerror = ev => {
      if (cur.current !== sess) return;
      // Without them, or in the device's language: onend starts the next session that way.
      if (ev.error === 'phrases-not-supported') { noPhrases.current = true; return; }
      if (ev.error === 'language-not-supported' && r.lang !== deviceLang()) {
        badLang.current = r.lang;
        o.current.onLangUnsupported?.(r.lang);
        return;
      }
      const why: NoVoice | null = ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'denied'
        : ev.error === 'audio-capture' ? 'no-mic'
        : ev.error === 'language-not-supported' ? 'unsupported' : null;
      if (why) {
        blocked.current = why;
        end(sess);
        o.current.onUnsupported(why);
      }
      // Anything else (no speech, a network blip) ends the session; onend decides what next.
    };
    r.onend = () => {
      if (cur.current !== sess) return;
      const text = joinWords(sess.said, sess.interim);
      if (sess.finishing) { end(sess); o.current.onFinish({ text, doubts: sess.doubts }); return; }
      // Ended by itself: listen on, unless it keeps ending straight away or nobody has spoken for a minute.
      const quick = Date.now() - sess.at < 1500 ? sess.quick + 1 : 0;
      const next: Session = { ...sess, said: text, interim: '', quick, at: Date.now() };
      cur.current = next;
      if (quick >= 3 || Date.now() - sess.heardAt > 60000 || !begin(next, Ctor)) { end(next); o.current.onCutOff({ text, doubts: next.doubts }); }
    };
    try { r.start(); } catch { return false; }
    setOnDevice(!!r.processLocally);
    return true;
  }, [end, langOf, hear]);

  const open = useCallback((base: string, Ctor: SRCtor) => {
    if (cur.current) return;
    const s = { said: base.trim(), interim: '', doubts: [], finishing: false, quick: 0, at: Date.now(), heardAt: Date.now(), timer: 0 } as Omit<Session, 'r'>;
    cur.current = s as Session;
    if (!begin(s, Ctor)) { cur.current = null; blocked.current = 'unsupported'; o.current.onUnsupported('unsupported'); return; }
    setPhase('starting');
    o.current.onHeard({ text: s.said, interim: '' });
  }, [begin]);

  /** Start listening; `base` is text already typed, which what you say is added to. */
  const startVoice = useCallback((base = '') => {
    if (cur.current) return;
    const Ctor = speechCtor();
    if (!Ctor || blocked.current === 'unsupported') { o.current.onUnsupported('unsupported'); return; }
    // Blocked last time: if it still is, say so rather than flash the mic on and off. Allowed since, it just starts.
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (blocked.current === 'denied' && perms?.query) {
      perms.query({ name: 'microphone' as PermissionName })
        .then(st => { if (st.state === 'denied') o.current.onUnsupported('denied'); else open(base, Ctor); })
        .catch(() => open(base, Ctor));
      return;
    }
    open(base, Ctor);
  }, [open]);

  /** Stop listening and hand over everything said, once the last words are in. */
  const finishVoice = useCallback(() => {
    const s = cur.current;
    if (!s || s.finishing) return;
    s.finishing = true;
    clearTimeout(quiet.current);
    setPhase('finishing');
    try { s.r.stop(); } catch { /* ended already */ }
    // Some browsers never fire onend after stop(); don't keep you waiting.
    s.timer = window.setTimeout(() => {
      if (cur.current !== s) return;
      end(s);
      try { s.r.abort(); } catch { /* gone */ }
      o.current.onFinish({ text: joinWords(s.said, s.interim), doubts: s.doubts });
    }, 1500);
  }, [end]);

  useEffect(() => () => {
    const s = cur.current;
    cur.current = null;
    clearTimeout(quiet.current);
    if (s) { clearTimeout(s.timer); try { s.r.abort(); } catch { /* noop */ } }
  }, []);

  return {
    listening: phase !== 'off', phase, onDevice, startVoice, stopVoice, finishVoice,
    supported: () => !!speechCtor() && !blocked.current,
  };
}
