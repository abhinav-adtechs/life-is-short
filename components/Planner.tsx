'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';
import { findSlot } from '@/lib/place';
import { backlogList, doneList, focus, missedList } from '@/lib/select';
import { fmtDur, fmtTime, fmtWhen, shortTitle } from '@/lib/format';
import { atMinutes, ceil15, endOf, fromYmd, minsOf, startOfDay, ymd } from '@/lib/time';
import { viewDays } from '@/lib/calview';
import { calendarOf, mergeExternal } from '@/lib/google';
import {
  MAX_ACCOUNTS, PENDING_KEY, addAccount, disconnectGoogle, fetchGoogleItems, mergeCalendars, normalizeAccounts, ownCalendars,
  sourceIndex, sourceOf, startGoogleConnect, storedAccounts, type GoogleAccount, type GoogleCalendar, type GoogleConn, type PullResult, type Source,
} from '@/lib/google-client';
import { inLens as lensHas, lensIds, resolveLabel, type Label, type Lens } from '@/lib/labels';
import { DAYS_FOR_VIEW, SNAP, VIEW_FOR_DAYS, calendarWidth, daysFor, type Days, type Split } from '@/lib/layout';
import { workHours, type CalView, type Prefs } from '@/lib/prefs';
import { pendingCount } from '@/lib/share-client';
import type { WorkHours } from '@/lib/place';
import { prefersReducedMotion, useMedia, useNow, useWidth } from './hooks';
import { usePrefs } from './prefs';
import { useTaskStore, type Store } from './store';
import { useDrag, type DragKind } from './drag';
import { Toast, type ToastState } from './Toast';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { PhoneScreen, LaptopSide } from './Side';
import { LaptopCalendar, PhoneCalendar } from './Calendar';
import { Divider } from './Split';
import { useChat, type Chat } from './Chat';

export interface PlannerApi {
  store: Store;
  tasks: Task[];
  now: number;
  wide: boolean;
  repo: TaskRepo;
  email: string | null;
  completing: Set<string>;
  picked: string | null;
  setPicked: (id: string | null) => void;
  drag: ReturnType<typeof useDrag>;
  /** Day the calendar is showing. */
  day: Date;
  setDay: (d: Date) => void;
  /** Calendar view on this device. On a laptop the split decides it, except for Month. */
  view: CalView;
  /** On a laptop, picking a number of days also pins the split to fit them. */
  setView: (v: CalView) => void;
  /** The laptop split: both widths, the days that fit, whether Auto sizes it, and whether the divider is being dragged. */
  split: { calW: number; matrixW: number; days: Days; auto: boolean; dragging: boolean };
  setSplit: (s: Split) => void;
  /** The width while the divider is dragged, or null when it's let go. */
  dragSplit: (w: number | null) => void;
  /** What the backlog and calendar focus on. */
  lens: Lens;
  setLens: (l: Lens) => void;
  /** In the lens: the backlog keeps it and the calendar shows it at full strength. */
  inLens: (t: Task) => boolean;
  /** A label spotlit for now from the matrix: everything else fades. */
  focusLabel: string | null;
  setFocusLabel: (id: string | null) => void;
  /** Faded on the calendar: outside the lens, or not the spotlit label. */
  faded: (t: Task) => boolean;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  /** Your day, for slotting. */
  hours: WorkHours;
  phoneView: 'list' | 'calendar';
  setPhoneView: (v: 'list' | 'calendar') => void;
  toast: (msg: string, undo?: () => void) => void;
  done: (id: string, animate?: boolean) => void;
  slot: (id: string) => void;
  schedule: (id: string) => void;
  unslot: (id: string) => void;
  place: (id: string, start: number) => void;
  /** Put a task on a day without a time: a moved event keeps its time, a backlog task gets that day's first free slot. */
  placeOnDay: (id: string, dayKey: string) => void;
  /** The conversation behind the dump bar. */
  chat: Chat;
  /** Tasks for the calendar: what you have, with an open plan's changes shown in place. */
  calTasks: Task[];
  openEditor: (id: string) => void;
  openSettings: (section?: string) => void;
  undoable: (msg: string, before: Map<string, Task | null>) => void;
  accounts: GoogleAccount[];
  /** Account and calendar of a pulled event. */
  sourceOf: (t: Task) => Source | null;
  /** From a calendar you switched off: kept, but not shown, not Now, and not busy time. */
  isOff: (t: Task) => boolean;
  /** Every task except switched-off events, for slotting. */
  liveTasks: () => Task[];
  /** Whether a scheduled task shows on the calendar (hidden accounts and calendars, done tasks). */
  onCalendar: (t: Task) => boolean;
  /** Block colour from Settings → Calendar → Colour events by, or null for the plain block. */
  colorOf: (t: Task) => string | null;
  /** The task's label: its own, or for a Google event its calendar's or account's. */
  labelOf: (t: Task) => Label | null;
  /** The colour an account's events show in right now. */
  accountColor: (a: GoogleAccount) => string;
  pullGoogle: (quiet?: boolean, onlyId?: string) => Promise<void>;
  connectGoogle: (hint?: string | null) => Promise<void>;
  removeGoogle: (id: string, removeEvents: boolean) => Promise<void>;
  changeAccount: (id: string, patch: Partial<Pick<GoogleAccount, 'color' | 'show' | 'tasks' | 'label'>>) => void;
  changeCalendar: (accountId: string, calendarId: string, patch: Partial<Pick<GoogleCalendar, 'pull' | 'label'>>) => void;
  pulling: boolean;
  /** Suggestions from people you share with, waiting for you. */
  inbox: number;
  refreshInbox: () => void;
}

const Ctx = createContext<PlannerApi | null>(null);
export const usePlanner = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanner outside Planner');
  return v;
};

const SETTINGS_HASH = /^#settings(?:\/([a-z]+))?$/;
type AccountsFn = (list: GoogleAccount[]) => GoogleAccount[];

export default function Planner({ repo, email }: { repo: TaskRepo; email: string | null }) {
  const [toastState, setToast] = useState<ToastState | null>(null);
  const toast = useCallback((msg: string, undo?: () => void) => setToast({ key: Date.now() + Math.random(), msg, undo }), []);
  const store = useTaskStore(repo, msg => toast(msg));
  const now = useNow();
  const wide = useMedia('(min-width: 860px)');
  const [mounted, setMounted] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  /** Open settings section, from the URL hash (#settings/calendar), or null. */
  const [settings, setSettings] = useState<string | null>(null);
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [phoneView, setPhoneView] = useState<'list' | 'calendar'>('list');
  const lastFocus = useRef<HTMLElement | null>(null);
  const settingsOpenedHere = useRef(false);
  const [accounts, setAccountsState] = useState<GoogleAccount[]>([]);
  const [pulling, setPulling] = useState(false);
  const pullingRef = useRef(false);
  const { prefs, update: setPrefs } = usePrefs(repo);
  const hours = useMemo(() => workHours(prefs), [prefs]);

  /* ---------- the laptop split: one width, set by Auto, the day picker or the divider ---------- */

  const width = useWidth();
  const [splitDrag, setSplitDrag] = useState<number | null>(null);
  const calW = calendarWidth(width, splitDrag != null ? { mode: 'pinned', cal: splitDrag } : prefs.split, prefs.lens.pri);
  const days = daysFor(calW);
  const split = useMemo(() => ({ calW, matrixW: width - calW, days, auto: prefs.split.mode === 'auto' && splitDrag == null, dragging: splitDrag != null }),
    [calW, width, days, prefs.split.mode, splitDrag]);
  // Stored already kept inside this screen, so arrow keys and drags start from what you see.
  const setSplit = useCallback((s: Split) => setPrefs({ split: { mode: s.mode, cal: calendarWidth(width, { mode: 'pinned', cal: s.cal }, 3) } }), [setPrefs, width]);
  const view: CalView = wide ? (prefs.calView === 'month' ? 'month' : VIEW_FOR_DAYS[days]) : prefs.calView ?? 'day';
  const setView = useCallback((v: CalView) => {
    if (!wide) { setPrefs({ calView: v }); return; }
    const d = DAYS_FOR_VIEW[v];
    setPrefs({ calView: v, split: { mode: 'pinned', cal: d ? SNAP[d] : Math.max(calW, SNAP[7]) } });
  }, [wide, setPrefs, calW]);

  const sources = useMemo(() => sourceIndex(accounts), [accounts]);
  const srcOf = useCallback((t: Task) => sourceOf(sources, t.externalId), [sources]);
  const labelIndex = useMemo(() => new Map(prefs.labels.map(l => [l.id, l])), [prefs.labels]);
  const labelOf = useCallback((t: Task) => resolveLabel(t, labelIndex, srcOf(t)), [labelIndex, srcOf]);

  /* ---------- the lens and the spotlight ---------- */

  const lens = prefs.lens;
  const setLens = useCallback((l: Lens) => setPrefs({ lens: l }), [setPrefs]);
  const inLens = useCallback((t: Task) => lensHas(lens, t.priority, labelOf(t)?.id ?? null), [lens, labelOf]);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const faded = useCallback((t: Task) => !inLens(t) || (focusLabel != null && (labelOf(t)?.id ?? '') !== focusLabel), [inLens, focusLabel, labelOf]);
  // A spotlit label that leaves the lens (or is removed) lets go.
  useEffect(() => { if (focusLabel != null && !lensIds(lens, prefs.labels).includes(focusLabel)) setFocusLabel(null); }, [focusLabel, lens, prefs.labels]);
  const isOff = useCallback((t: Task) => { const src = srcOf(t); return !!src?.calendar && !src.calendar.pull; }, [srcOf]);
  const liveTasks = useCallback(() => store.all().filter(t => !isOff(t)), [store, isOff]);

  useEffect(() => { setMounted(true); }, []);

  const undoable = useCallback((msg: string, before: Map<string, Task | null>) => {
    toast(msg, before.size ? () => store.restore(before) : undefined);
  }, [store, toast]);

  const done = useCallback((id: string, animate = false) => {
    const t = store.get(id);
    if (!t) return;
    if (t.status === 'done') {
      undoable('Back on the list', store.patch(id, { status: 'open', doneAt: null }));
      return;
    }
    const commit = () => undoable(`Done: ${shortTitle(t.title)}`, store.patch(id, { status: 'done', doneAt: Date.now() }));
    if (!animate || prefersReducedMotion()) { commit(); return; }
    // Let the check pop and the strike draw before the row moves to Done.
    setCompleting(s => new Set(s).add(id));
    setTimeout(() => {
      setCompleting(s => { const n = new Set(s); n.delete(id); return n; });
      commit();
    }, 650);
  }, [store, undoable]);

  const openEditor = useCallback((id: string) => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setEditorId(id);
  }, []);

  const slot = useCallback((id: string) => {
    const t = store.get(id);
    if (!t) return;
    const s = findSlot(liveTasks(), t.minutes, { exclude: id, hours });
    if (s == null) { toast('No free slot in the next two weeks. Pick a time instead.'); openEditor(id); return; }
    undoable(`Slotted for ${fmtWhen(s)}`, store.patch(id, { start: s }));
    if (picked === id) setPicked(null);
  }, [store, liveTasks, toast, undoable, openEditor, picked, hours]);

  /** The Now block's Schedule: a live task is pushed past its end, a backlog task gets the next free slot. */
  const schedule = useCallback((id: string) => {
    const t = store.get(id);
    if (!t) return;
    if (t.start == null) { slot(id); return; }
    const s = findSlot(liveTasks(), t.minutes, { exclude: id, after: endOf(t), hours });
    undoable(s != null ? `Pushed to ${fmtWhen(s)}` : 'Moved to the backlog', store.patch(id, { start: s }));
  }, [store, liveTasks, slot, undoable, hours]);

  const unslot = useCallback((id: string) => {
    undoable('Moved to the backlog', store.patch(id, { start: null }));
  }, [store, undoable]);

  const place = useCallback((id: string, start: number) => {
    const t = store.get(id);
    if (!t) return;
    const verb = t.start == null ? 'Scheduled for' : 'Moved to';
    undoable(`${verb} ${fmtWhen(start)}`, store.patch(id, { start }));
    setPicked(null);
  }, [store, undoable]);

  const placeOnDay = useCallback((id: string, dayKey: string) => {
    const t = store.get(id);
    if (!t) return;
    const d = fromYmd(dayKey);
    // No free slot that day: the start of your day, or for today the next quarter hour rather than a time already gone.
    const fallback = Math.max(atMinutes(d, hours.start), ymd(d) === ymd(Date.now()) ? ceil15(Date.now()) : 0);
    const start = t.start != null
      ? atMinutes(d, minsOf(t.start))
      : findSlot(liveTasks(), t.minutes, { onDate: d, sameDay: true, exclude: id, hours }) ?? fallback;
    place(id, start);
  }, [store, liveTasks, place, hours]);

  const labelId = useCallback((t: Task) => labelOf(t)?.id ?? null, [labelOf]);
  const chat = useChat({ store, repo, liveTasks, hours, toast, labels: prefs.labels, labelId });
  const calTasks = useMemo(() => {
    if (!chat.preview.size) return store.tasks;
    const out = store.tasks.map(t => chat.preview.get(t.id) ?? t);
    for (const t of chat.preview.values()) if (!store.get(t.id)) out.push(t);
    return out;
  }, [store.tasks, store.get, chat.preview]);

  // A new plan with times on it: bring the calendar to them if none are in view.
  const shownPlan = useRef<string | null>(null);
  useEffect(() => {
    if (!chat.open || !chat.plan || shownPlan.current === chat.plan.id) return;
    shownPlan.current = chat.plan.id;
    const starts = [...chat.preview.values()].flatMap(t => (t.start != null && t.status === 'open' ? [t.start] : [])).sort((a, b) => a - b);
    if (!wide || !starts.length) return;
    const inView = view === 'month'
      ? (s: number) => new Date(s).getMonth() === day.getMonth() && new Date(s).getFullYear() === day.getFullYear()
      : (s: number) => viewDays(view, day, prefs).some(d => ymd(d) === ymd(s));
    if (!starts.some(inView)) setDay(startOfDay(starts[0]));
  }, [chat.open, chat.plan, chat.preview, wide, view, day, prefs]);

  const drag = useDrag({
    lengthOf: id => store.get(id)?.minutes ?? 30,
    onDrop: (id: string, dayKey: string, min: number, _kind: DragKind) => (min < 0 ? placeOnDay(id, dayKey) : place(id, atMinutes(fromYmd(dayKey), min))),
    onDropBacklog: id => unslot(id),
    onDropCell: (id, cell, kind) => {
      const t = store.get(id);
      if (!t) return;
      const [labelId, p] = cell.split('|');
      const patch: Partial<Task> = { priority: Number(p) as Priority };
      // Only a change of row sets the label, so a Google event keeps taking its calendar's.
      if ((labelOf(t)?.id ?? '') !== labelId) patch.label = labelId || null;
      if (kind === 'block' && t.start != null) patch.start = null;
      if (patch.priority === t.priority && !('label' in patch) && !('start' in patch)) return;
      const name = prefs.labels.find(l => l.id === labelId)?.name ?? 'No label';
      undoable(`${patch.start === null ? 'Back in the backlog · ' : ''}${name} · ${PRI[patch.priority as Priority]}`, store.patch(id, patch));
    },
    onResize: (id, minutes) => {
      const t = store.get(id);
      if (!t || t.start == null) return;
      undoable(`${fmtDur(minutes)} · ends ${fmtTime(t.start + minutes * 60000)}`, store.patch(id, { minutes }));
    },
  });

  const closeEditor = useCallback(() => {
    setEditorId(null);
    const el = lastFocus.current;
    if (el && document.contains(el)) { try { el.focus({ preventScroll: true }); } catch { /* gone */ } }
  }, []);

  /* ---------- settings page, routed by the URL hash so Back closes it ---------- */

  useEffect(() => {
    const read = () => { const m = SETTINGS_HASH.exec(window.location.hash); setSettings(m ? m[1] || 'appearance' : null); };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const openSettings = useCallback((section?: string) => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    settingsOpenedHere.current = true;
    window.location.hash = section ? `settings/${section}` : 'settings';
  }, []);

  const closeSettings = useCallback(() => {
    // Opened from the app: step back. Landed on it (e.g. back from Google): drop the hash without leaving.
    if (settingsOpenedHere.current) { settingsOpenedHere.current = false; history.back(); return; }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setSettings(null);
  }, []);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !settings) {
      // Back where you opened it from; after a trip to Google there's nothing to go back to, so the Settings button.
      const prev = lastFocus.current;
      const el = prev && document.contains(prev) ? prev : document.querySelector<HTMLElement>('[data-settings-button]');
      try { el?.focus({ preventScroll: true }); } catch { /* gone */ }
    }
    wasOpen.current = !!settings;
  }, [settings]);

  // Esc: close the editor or settings first, then cancel a pick, then stop listening or close the conversation.
  const chatRef = useRef(chat);
  chatRef.current = chat;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editorId) { e.preventDefault(); closeEditor(); return; }
      if (settings) { e.preventDefault(); closeSettings(); return; }
      if (picked) { e.preventDefault(); setPicked(null); return; }
      const c = chatRef.current;
      if (c.listening) { e.preventDefault(); c.cancelVoice(); return; }
      if (c.open) { e.preventDefault(); c.close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorId, settings, picked, closeEditor, closeSettings]);

  // A picked task that disappears (done elsewhere, deleted) can't be placed.
  useEffect(() => { if (picked && !store.get(picked)) setPicked(null); }, [picked, store, store.tasks]);

  /* ---------- Google accounts ---------- */

  // What's stored, plus changes still on their way there. Settings aren't realtime, so every change re-reads
  // the stored list and re-applies itself: an account added on the phone survives the laptop's next pull.
  const storedRef = useRef<GoogleAccount[]>([]);
  const pendingFns = useRef<AccountsFn[]>([]);
  const gQueue = useRef<Promise<unknown>>(Promise.resolve());
  const accountsNow = useCallback(() => pendingFns.current.reduce((l, f) => f(l), storedRef.current), []);
  const showAccounts = useCallback(() => setAccountsState(accountsNow()), [accountsNow]);

  const enqueue = useCallback(<T,>(job: () => Promise<T>) => {
    const run = gQueue.current.then(job);
    gQueue.current = run.catch(() => undefined);
    return run;
  }, []);

  const readAccounts = useCallback(() => enqueue(async () => {
    try { storedRef.current = normalizeAccounts(await repo.getSetting('google')); } catch { /* keep what we have */ }
    showAccounts();
    return accountsNow();
  }), [repo, enqueue, showAccounts, accountsNow]);

  // Every change is a pure function of the list, so a save that fails keeps it pending and the next save retries it.
  const changeAccounts = useCallback((fn: AccountsFn) => {
    pendingFns.current.push(fn);
    showAccounts();
    return enqueue(async () => {
      const fns = [...pendingFns.current];
      if (!fns.length) return storedRef.current;
      let base = storedRef.current;
      try { base = normalizeAccounts(await repo.getSetting('google')); } catch { /* offline: build on what we have */ }
      const next = fns.reduce((l, f) => f(l), base);
      try {
        await repo.setSetting('google', storedAccounts(next));
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Couldn’t save the Google accounts. Trying again with your next change.');
        storedRef.current = base;
        showAccounts();
        return accountsNow();
      }
      storedRef.current = next;
      pendingFns.current = pendingFns.current.slice(fns.length);
      showAccounts();
      return next;
    });
  }, [repo, enqueue, showAccounts, accountsNow, toast]);

  /** Pull every connected account (or one) and merge them into the planner in one go. Quiet pulls only speak up when something changed. */
  const pullGoogle = useCallback(async (quiet = false, onlyId?: string) => {
    if (pullingRef.current) return;
    pullingRef.current = true;
    setPulling(true);
    try {
      const list = await readAccounts();
      const targets = list.filter(a => (onlyId ? a.id === onlyId : !a.error));
      if (!targets.length) return;
      const fetched = await Promise.all(targets.map(async a => [a.id, await fetchGoogleItems(a)] as const));
      // An account disconnected while this pull was out: drop what it brought back, or its removed events return.
      const live = new Set(accountsNow().map(a => a.id));
      const results = new Map<string, PullResult>(fetched.filter(([id]) => live.has(id)));
      const items = [...results.values()].flatMap(r => ('items' in r ? r.items : []));
      const errors = [...results.values()].filter((r): r is Extract<PullResult, { error: string }> => 'error' in r);
      const unread = [...results.values()].flatMap(r => ('calendars' in r ? r.calendars.filter(c => c.failed).map(c => c.name) : []));
      const m = mergeExternal(store.all(), items, Date.now(), undefined, t => !isOff(t));
      const before = store.write(m.puts);
      const at = Date.now();
      await changeAccounts(l => l.map(a => {
        const r = results.get(a.id);
        if (!r) return a;
        if ('error' in r) return r.revoked ? { ...a, error: 'revoked' } : a;
        return { ...a, pulledAt: at, error: null, calendars: mergeCalendars(a.calendars, r.calendars) };
      }));
      const parts = [m.added && `${m.added} new`, m.updated && `${m.updated} updated`, m.ticked && `${m.ticked} ticked off`].filter(Boolean);
      const problem = errors.find(e => e.revoked)?.error ?? errors[0]?.error
        ?? (unread.length ? `Couldn’t read ${unread.length === 1 ? unread[0] : `${unread.length} calendars`} from Google` : null);
      if (parts.length) undoable(`From Google · ${parts.join(', ')}${problem ? ` · ${problem}` : ''}`, before);
      else if (problem && (!quiet || errors.some(e => e.revoked))) toast(problem);
      else if (!quiet) toast(targets.length > 1 ? `All ${targets.length} Google accounts are up to date` : 'Google is up to date');
    } finally {
      pullingRef.current = false;
      setPulling(false);
    }
  }, [readAccounts, changeAccounts, accountsNow, isOff, store, toast, undoable]);

  const connectGoogle = useCallback(async (hint?: string | null) => {
    if (!hint && storedRef.current.length >= MAX_ACCOUNTS) { toast(`You can connect up to ${MAX_ACCOUNTS} Google accounts.`); return; }
    const err = await startGoogleConnect(hint);
    if (err) toast(err);
  }, [toast]);

  const removeGoogle = useCallback(async (id: string, removeEvents: boolean) => {
    const acct = storedRef.current.find(a => a.id === id);
    if (!acct) return;
    let before = new Map<string, Task | null>();
    if (removeEvents) {
      const own = ownCalendars(storedRef.current, id);
      before = store.remove(store.all().filter(t => own.has(calendarOf(t.externalId) || '')).map(t => t.id));
    }
    await changeAccounts(l => l.filter(a => a.id !== id));
    disconnectGoogle(acct);
    const who = acct.email || 'Google account';
    if (removeEvents) undoable(`Disconnected ${who} · removed ${before.size} event${before.size === 1 ? '' : 's'}`, before);
    else toast(`Disconnected ${who}. Its events stay.`);
  }, [store, changeAccounts, toast, undoable]);

  const changeAccount = useCallback((id: string, patch: Partial<Pick<GoogleAccount, 'color' | 'show' | 'tasks' | 'label'>>) => {
    changeAccounts(l => l.map(a => (a.id === id ? { ...a, ...patch } : a)));
  }, [changeAccounts]);

  const changeCalendar = useCallback((accountId: string, calendarId: string, patch: Partial<Pick<GoogleCalendar, 'pull' | 'label'>>) => {
    changeAccounts(l => l.map(a => (a.id === accountId ? { ...a, calendars: a.calendars.map(c => (c.id === calendarId ? { ...c, ...patch } : c)) } : a)));
  }, [changeAccounts]);

  // Load the accounts; finish a connect that just came back from Google; pull if it's been a while.
  const pullRef = useRef(pullGoogle);
  pullRef.current = pullGoogle;
  useEffect(() => {
    let alive = true;
    (async () => {
      let pending: GoogleConn | null = null;
      try { const raw = sessionStorage.getItem(PENDING_KEY); if (raw) { sessionStorage.removeItem(PENDING_KEY); pending = JSON.parse(raw); } } catch { pending = null; }
      const list = await readAccounts();
      if (pending) {
        // Saved even if this effect was torn down meanwhile: the token was taken out of sessionStorage already.
        const conn = pending;
        let added: GoogleAccount | null = null;
        await changeAccounts(l => { const r = addAccount(l, conn); added = r.account; return r.list; });
        if (!alive) return;
        const acct = added as GoogleAccount | null;
        if (!acct) { toast(`You can connect up to ${MAX_ACCOUNTS} Google accounts. Disconnect one first.`); disconnectGoogle(conn); return; }
        toast(`Google connected${acct.email ? ' · ' + acct.email : ''}. Pulling…`);
        pullRef.current(false, acct.id);
        return;
      }
      if (alive && list.some(a => !a.error && (!a.pulledAt || Date.now() - a.pulledAt > 30 * 60000))) pullRef.current(true);
    })();
    // Then again every 30 minutes while the app is open and in view.
    const timer = window.setInterval(() => { if (!document.hidden && storedRef.current.some(a => !a.error)) pullRef.current(true); }, 30 * 60000);
    return () => { alive = false; clearInterval(timer); };
    // Once per planner.
  }, [repo]);

  /* ---------- sharing: suggestions waiting for you ---------- */

  const [inbox, setInbox] = useState(0);
  const refreshInbox = useCallback(() => {
    if (repo.kind !== 'supabase') return;
    pendingCount().then(n => { if (n != null) setInbox(n); });
  }, [repo]);
  useEffect(() => {
    refreshInbox();
    const again = () => { if (!document.hidden) refreshInbox(); };
    const timer = window.setInterval(again, 5 * 60000);
    document.addEventListener('visibilitychange', again);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', again); };
  }, [refreshInbox]);

  const onCalendar = useCallback((t: Task) => {
    if (!prefs.showDone && t.status === 'done') return false;
    const src = srcOf(t);
    return !src || (src.account.show && !isOff(t));
  }, [prefs.showDone, srcOf, isOff]);
  const colorOf = useCallback((t: Task): string | null => {
    if (prefs.colorBy === 'priority') return t.priority === 1 ? 'var(--accent)' : t.priority === 2 ? 'var(--muted)' : null;
    if (prefs.colorBy === 'none') return null;
    // By label: the task's label, else an unlabelled event keeps its account's colour.
    const label = prefs.colorBy === 'label' ? labelOf(t) : null;
    if (label) return label.color;
    const src = srcOf(t);
    if (!src) return null;
    return prefs.colorBy === 'calendar' ? src.calendar?.color ?? src.account.color : src.account.color;
  }, [prefs.colorBy, srcOf, labelOf]);
  const accountColor = useCallback((a: GoogleAccount) => {
    const label = prefs.colorBy === 'label' && a.label ? labelIndex.get(a.label) : undefined;
    return label?.color ?? a.color;
  }, [prefs.colorBy, labelIndex]);

  const api: PlannerApi = {
    store, tasks: store.tasks, now, wide, repo, email, completing, picked, setPicked, drag,
    day, setDay, view, setView, split, setSplit, dragSplit: setSplitDrag, lens, setLens, inLens, focusLabel, setFocusLabel, faded,
    prefs, setPrefs, hours, phoneView, setPhoneView,
    toast, done, slot, schedule, unslot, place, placeOnDay, chat, calTasks, openEditor, openSettings, undoable,
    accounts, sourceOf: srcOf, isOff, liveTasks, onCalendar, colorOf, labelOf, accountColor, pullGoogle, connectGoogle, removeGoogle, changeAccount, changeCalendar, pulling,
    inbox, refreshInbox,
  };

  if (!mounted) return <div className="boot" />;
  const editing = editorId ? store.get(editorId) : undefined;

  return (
    <Ctx.Provider value={api}>
      {wide ? (
        <div className={'lp' + (split.dragging ? ' sizing' : '')} inert={!!settings}>
          <LaptopSide />
          <Divider />
          <LaptopCalendar />
        </div>
      ) : (
        <div className="ph" inert={!!settings}>{phoneView === 'list' ? <PhoneScreen /> : <PhoneCalendar />}</div>
      )}
      {drag.view?.kind === 'row' && <Ghost id={drag.view.id} x={drag.view.x} y={drag.view.y} />}
      {editing && <Editor key={editing.id} task={editing} onClose={closeEditor} />}
      {settings && <Settings section={settings} onClose={closeSettings} />}
      {toastState && <Toast state={toastState} wide={wide} onDone={() => setToast(null)} />}
    </Ctx.Provider>
  );
}

function Ghost({ id, x, y }: { id: string; x: number; y: number }) {
  const { store } = usePlanner();
  const t = store.get(id);
  if (!t) return null;
  return <div className="ghost" style={{ left: x + 12, top: y + 10 }} aria-hidden="true">{t.title}</div>;
}

/** Backlog sections, shared by phone and laptop. */
export function useLists() {
  const { tasks: all, now, isOff, inLens } = usePlanner();
  return useMemo(() => {
    const tasks = all.filter(t => !isOff(t));
    // The lens narrows what can be Now and what waits in the backlog. The calendar, and so Missed, keep everything.
    const scoped = tasks.filter(t => t.start != null || inLens(t));
    const f = focus(scoped, now);
    const backlog = backlogList(scoped).filter(t => t.id !== f.now?.id);
    const outside = backlogList(tasks).length - backlogList(scoped).length;
    return { focus: f, backlog, outside, missed: missedList(tasks, now), done: doneList(tasks).slice(0, 50) };
  }, [all, now, isOff, inLens]);
}
