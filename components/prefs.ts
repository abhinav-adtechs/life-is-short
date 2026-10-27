'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { DEFAULT_PREFS, DEVICE_KEYS, computeLook, normalizePrefs, syncable, type Prefs } from '@/lib/prefs';
import { setClock24 } from '@/lib/format';

const LOCAL = 'ds.prefs';
/** What layout.tsx's startup script replays before first paint, so the page never flashes the defaults. */
export const LOOK_KEY = 'ds.look';
const ATTRS = ['data-theme', 'data-motion', 'data-contrast', 'data-scene'];

/** This device's prefs. Older builds kept only the theme and the calendar view; carry those over. */
function loadLocal(): Prefs {
  try {
    const raw = localStorage.getItem(LOCAL);
    if (raw) return normalizePrefs(JSON.parse(raw));
    const theme = localStorage.getItem('ds.theme');
    const view = localStorage.getItem('ds.view');
    return normalizePrefs({ ...DEFAULT_PREFS, mode: theme, calView: view === 'day' || view === 'week' ? view : null });
  } catch {
    return DEFAULT_PREFS;
  }
}

function saveLocal(p: Prefs) {
  try { localStorage.setItem(LOCAL, JSON.stringify(p)); } catch { /* private mode: prefs last this visit */ }
}

/** Put the prefs on <html>: colour tokens, font, sizes, attributes, the font stylesheet and the browser bar colour. */
export function applyLook(p: Prefs) {
  const look = computeLook(p);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(k, v);
  for (const a of ATTRS) { const v = look.attrs[a]; if (v == null) root.removeAttribute(a); else root.setAttribute(a, v); }
  let link = document.getElementById('ds-font') as HTMLLinkElement | null;
  if (look.font) {
    if (!link) { link = document.createElement('link'); link.id = 'ds-font'; link.rel = 'stylesheet'; document.head.appendChild(link); }
    if (link.href !== look.font) link.href = look.font;
  } else link?.remove();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(m => {
    m.content = (m.media || '').includes('dark') ? look.themeColor.dark : look.themeColor.light;
  });
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* startup flash is the only cost */ }
}

/**
 * Prefs for this planner. Changes apply at once and save on this device; everything but light/dark and the
 * calendar view also goes to your settings row, and the newest copy wins when another device changed it.
 */
export function usePrefs(repo: TaskRepo) {
  const [prefs, setPrefsState] = useState<Prefs>(() => (typeof window === 'undefined' ? DEFAULT_PREFS : loadLocal()));
  const ref = useRef(prefs);
  const timer = useRef(0);
  // Nothing is sent until this device has read what's stored: a fresh device's defaults must never overwrite it.
  const ready = useRef(false);
  /** Synced keys changed here and not yet sent. */
  const dirty = useRef(new Set<keyof Prefs>());

  // Labels read the clock setting while rendering, so set it before children render.
  setClock24(prefs.clock === '24');
  useLayoutEffect(() => applyLook(prefs), [prefs]);

  const set = useCallback((next: Prefs) => { ref.current = next; saveLocal(next); setPrefsState(next); }, []);

  const send = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = 0;
    const keys = [...dirty.current];
    repo.setSetting('prefs', syncable(ref.current))
      .then(() => keys.forEach(k => dirty.current.delete(k)))
      .catch(() => { /* still dirty: the next read sends it again */ });
  }, [repo]);

  // Another device may have changed them: check on load and whenever this tab comes back.
  // If this device's copy is the newer one (a send that never went out), send it now.
  useEffect(() => {
    if (repo.kind === 'local') return;
    let alive = true;
    const pull = async () => {
      let raw: unknown = null;
      try { raw = await repo.getSetting('prefs'); } catch { return; }
      if (!alive) return;
      ready.current = true;
      const remote = raw ? normalizePrefs(raw) : null;
      const device = Object.fromEntries(DEVICE_KEYS.map(k => [k, ref.current[k]]));
      if (remote && dirty.current.size) {
        // Changes made here before this read go on top of what's stored, key by key.
        const mine = Object.fromEntries([...dirty.current].map(k => [k, ref.current[k]]));
        set(normalizePrefs({ ...remote, ...mine, ...device, updatedAt: Math.max(remote.updatedAt, ref.current.updatedAt) }));
        send();
      } else if (remote && remote.updatedAt > ref.current.updatedAt) {
        set({ ...remote, ...device });
      } else if (ref.current.updatedAt > (remote?.updatedAt ?? 0)) send();
    };
    pull();
    const vis = () => { if (!document.hidden) pull(); else if (timer.current) send(); };
    // Leaving the page with a change still waiting to go: send it now.
    const hide = () => { if (timer.current) send(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', hide);
    return () => { alive = false; hide(); document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', hide); };
  }, [repo, set, send]);

  // Other tabs on this device.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === LOCAL) { const p = loadLocal(); ref.current = p; setPrefsState(p); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    const keys = (Object.keys(patch) as (keyof Prefs)[]).filter(k => !(DEVICE_KEYS as readonly string[]).includes(k));
    const synced = keys.length > 0;
    keys.forEach(k => dirty.current.add(k));
    const next = normalizePrefs({ ...ref.current, ...patch, updatedAt: synced ? Date.now() : ref.current.updatedAt });
    set(next);
    if (!synced || repo.kind === 'local' || !ready.current) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(send, 700);
  }, [repo, set, send]);

  return { prefs, update };
}
