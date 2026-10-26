'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { DEFAULT_PREFS, DEVICE_KEYS, computeLook, normalizePrefs, syncable, type Prefs } from '@/lib/prefs';
import { setClock24 } from '@/lib/format';

const LOCAL = 'ds.prefs';
/** What layout.tsx's startup script replays before first paint, so the page never flashes the defaults. */
export const LOOK_KEY = 'ds.look';
const ATTRS = ['data-theme', 'data-motion', 'data-contrast'];

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

  // Labels read the clock setting while rendering, so set it before children render.
  setClock24(prefs.clock === '24');
  useLayoutEffect(() => applyLook(prefs), [prefs]);

  const set = useCallback((next: Prefs) => { ref.current = next; saveLocal(next); setPrefsState(next); }, []);

  // Another device may have changed them: check on load and whenever this tab comes back.
  useEffect(() => {
    if (repo.kind === 'local') return;
    let alive = true;
    const pull = async () => {
      let raw: unknown = null;
      try { raw = await repo.getSetting('prefs'); } catch { return; }
      if (!alive || !raw) return;
      const remote = normalizePrefs(raw);
      if (remote.updatedAt <= ref.current.updatedAt) return;
      const device = Object.fromEntries(DEVICE_KEYS.map(k => [k, ref.current[k]]));
      set({ ...remote, ...device });
    };
    pull();
    const vis = () => { if (!document.hidden) pull(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; document.removeEventListener('visibilitychange', vis); };
  }, [repo, set]);

  // Other tabs on this device.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === LOCAL) { const p = loadLocal(); ref.current = p; setPrefsState(p); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    const synced = Object.keys(patch).some(k => !(DEVICE_KEYS as readonly string[]).includes(k));
    const next = normalizePrefs({ ...ref.current, ...patch, updatedAt: synced ? Date.now() : ref.current.updatedAt });
    set(next);
    if (!synced || repo.kind === 'local') return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { repo.setSetting('prefs', syncable(ref.current)).catch(() => { /* next change retries */ }); }, 700);
  }, [repo, set]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { prefs, update };
}
