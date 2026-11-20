/**
 * The iPhone, iPad and Mac apps (apple/, docs/apple.md) wrap this page in a native window and put `window.lisNative` on
 * it before the page's own scripts run (apple/Shared/Resources/Bridge.js): commands from Siri, Home Screen quick
 * actions and the Mac's menu bar, haptics, and native dictation behind SpeechRecognition. In a browser there's no
 * `lisNative` and everything here does nothing.
 */

import type { WidgetSnapshot } from './widget';

export type NativeSheet = 'settings' | 'analytics' | 'review' | 'share';

/** What the app asks the planner to do. apple/Core/Sources/LifeIsShortCore/DeepLink.swift sends the same shapes. */
export type NativeCommand =
  | { name: 'dump'; text?: string }
  | { name: 'listen' }
  | { name: 'open'; sheet: NativeSheet }
  /** A task tapped on a widget: open it. */
  | { name: 'task'; id: string };

export type Haptic = 'success' | 'warning' | 'error' | 'light' | 'medium' | 'selection';

interface LisNative {
  platform: 'ios' | 'ipados' | 'macos';
  version: string;
  build: string;
  /** The app is linked to this site (webcredentials), so passkeys work inside it. */
  passkeys?: boolean;
  post(type: string, body?: Record<string, unknown>): Promise<unknown>;
  onCommand(fn: (command: unknown) => void): () => void;
  ready(): Promise<unknown>;
  haptic(kind: Haptic): void;
}

export function native(): LisNative | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { lisNative?: LisNative }).lisNative ?? null;
}

const SHEETS: readonly string[] = ['settings', 'analytics', 'review', 'share'];
/** The longest dump the app hands over (DeepLink.maxText). */
const MAX_TEXT = 4000;
/** A task's id, as the app's links carry it (DeepLink.isTaskId). */
const TASK_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** A command from the app, checked; anything else is dropped. */
export function readCommand(raw: unknown): NativeCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.name) {
    case 'dump': {
      const text = typeof c.text === 'string' ? c.text.trim().slice(0, MAX_TEXT) : '';
      return text ? { name: 'dump', text } : { name: 'dump' };
    }
    case 'listen':
      return { name: 'listen' };
    case 'open':
      return typeof c.sheet === 'string' && SHEETS.includes(c.sheet) ? { name: 'open', sheet: c.sheet as NativeSheet } : null;
    case 'task':
      return typeof c.id === 'string' && TASK_ID.test(c.id) ? { name: 'task', id: c.id } : null;
    default:
      return null;
  }
}

/**
 * The app's commands, from now until the returned function is called. Ones sent before the planner was up (a quick
 * action that launched the app) arrive straight away. The CI smoke test's `ping` is answered here.
 */
export function onNativeCommand(fn: (command: NativeCommand) => void): () => void {
  const app = native();
  if (!app) return () => undefined;
  return app.onCommand(raw => {
    if ((raw as { name?: unknown } | null)?.name === 'ping') { app.post('pong').catch(() => undefined); return; }
    const command = readCommand(raw);
    if (command) fn(command);
  });
}

/** The planner is showing: the app sends the commands that were waiting for it. */
export function nativeReady() {
  native()?.ready();
}

/**
 * Hand the iPhone and iPad widgets today's picture (lib/widget.ts), or null to empty them (signed out). The app keeps
 * it where its widgets read it. Nothing in a browser, and nothing on the Mac yet.
 */
export function sendWidget(snapshot: WidgetSnapshot | null) {
  const app = native();
  if (!app || app.platform === 'macos') return;
  app.post('widget', { snapshot }).catch(() => undefined);
}

/** A tap of feedback on iPhone (and a Force Touch trackpad); nothing in a browser. */
export function haptic(kind: Haptic) {
  native()?.haptic(kind);
}

/* ---------- Google sign-in from the app ---------- */

/** The app's own link scheme (DeepLink.scheme, and CFBundleURLSchemes in its Info.plist). */
export const APP_SCHEME = 'lifeisshort';
/** A Google sign-in that started in the app has a state starting with this. */
export const APP_STATE = 'app.';

/** The state for a Google sign-in, marked when it starts in the app. */
export const googleState = (id: string, inApp = native() != null) => (inApp ? APP_STATE : '') + id;

/**
 * Google won't sign in inside an app's web view, so the app runs it in the system's sign-in sheet. That sheet lands on
 * the callback page without the app's session, so the page hands Google's answer (the query, unchanged) back through
 * the app's link, and the app finishes on the callback page in its own window. Null anywhere else.
 */
export function appReturnUrl(search: string, inApp = native() != null): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const state = new URLSearchParams(query).get('state');
  if (inApp || !state?.startsWith(APP_STATE)) return null;
  return `${APP_SCHEME}://google/callback?${query}`;
}
