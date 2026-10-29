'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';
import { findSlot } from '@/lib/place';
import { backToBacklog, backlogList, doneList, focus, isEvent } from '@/lib/select';
import { fmtDur, fmtTime, fmtWhen, shortTitle } from '@/lib/format';
import { atMinutes, ceil15, fromYmd, minsOf, startOfDay, ymd } from '@/lib/time';
import { VIEW_FOR_DAYS, viewDays, type CalView } from '@/lib/calview';
import { calendarOf, mergeExternal } from '@/lib/google';
import {
  MAX_ACCOUNTS, PENDING_KEY, addAccount, disconnectGoogle, fetchGoogleItems, mergeCalendars, normalizeAccounts, ownCalendars,
  sourceIndex, sourceOf, startGoogleConnect, storedAccounts, type GoogleAccount, type GoogleCalendar, type GoogleConn, type PullResult, type Source,
} from '@/lib/google-client';
import { resolveLabel, type Label } from '@/lib/labels';
import { kindOf } from '@/lib/plan';
import { daysFor, fullMatrix, type Days } from '@/lib/layout';
import { resolveTheme, workHours, type Prefs, type ThemeId } from '@/lib/prefs';
import { pendingCount } from '@/lib/share-client';
import { haptic, nativeReady, onNativeCommand } from '@/lib/native';
import type { WorkHours } from '@/lib/place';
import type { Slip } from '@/lib/slips';
import { prefersReducedMotion, useMedia, useNow, useWidth } from './hooks';
import { usePrefs } from './prefs';
import { useTaskStore, type Store } from './store';
import { useSlips } from './slips';
import { useDrag } from './drag';
import { useChat, type Chat } from './Chat';
import type { ToastState } from './Toast';
import { Laptop } from './Laptop';
import { Phone } from './Phone';

/**
 * The side panels on a laptop, bottom sheets on a phone. Settings, Share, Analytics and the review live in the URL
 * hash, so Back closes them. The review's section is its span: #review/day, #review/week or #review/month.
 */
export type SheetKind = 'analytics' | 'review' | 'share' | 'settings';

/** The matrix filter: one label ('' for no label) at one priority. */
export interface Filter { label: string; priority: Priority }

/** An open plan, as the matrix and the calendar show it before you apply it. */
export interface PlanView {
  /** Tasks the plan ticks off. */
  ticks: Set<string>;
  /** Scheduled tasks the plan moves: they fade where they are. */
  moves: Set<string>;
  /** New tasks with no time: dashed in the matrix. */
  added: Task[];
  /** New or moved tasks with a time: dashed on the calendar. */
  proposed: Task[];
}

export interface PlannerApi {
  /** Now, Next, the backlog and Done. */
  lists: Lists;
  store: Store;
  tasks: Task[];
  now: number;
  wide: boolean;
  repo: TaskRepo;
  email: string | null;
  theme: ThemeId;
  /** Tasks finishing their check-and-strike before they leave the list. */
  completing: Set<string>;
  /** The task waiting for a time: click (or tap) one on the calendar. */
  picked: string | null;
  setPicked: (id: string | null) => void;
  drag: ReturnType<typeof useDrag>;
  /** The first day the calendar shows. */
  day: Date;
  setDay: (d: Date) => void;
  /** Days on the calendar: the split decides on a laptop; a phone shows one. */
  view: CalView;
  /** The laptop split: the calendar's share, the days that fit, whether the matrix draws every task, and whether it's being dragged. */
  split: { f: number; days: Days; full: boolean; dragging: boolean; calW: number; matrixW: number };
  setSplit: (f: number) => void;
  /** The share while the divider is dragged, or null when it's let go. */
  dragSplit: (f: number | null) => void;
  filter: Filter | null;
  setFilter: (f: Filter | null) => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  /** Your day, for slotting. */
  hours: WorkHours;
  phoneTab: 'matrix' | 'calendar';
  setPhoneTab: (t: 'matrix' | 'calendar') => void;
  toast: (msg: string, undo?: () => void) => void;
  /** The toast showing, if any; the chat bar's dock draws it. */
  toastState: ToastState | null;
  dismissToast: () => void;
  done: (id: string, animate?: boolean) => void;
  /** Next free slot. */
  slot: (id: string) => void;
  /** Pick a time for it: the calendar waits for a click (on a phone, a tap, with the best slot suggested). */
  schedule: (id: string) => void;
  unslot: (id: string) => void;
  place: (id: string, start: number) => void;
  /** Change a backlog task's label and priority, as dropping it on a matrix cell does. */
  moveToCell: (id: string, cell: Filter) => void;
  chat: Chat;
  plan: PlanView;
  openEditor: (id: string) => void;
  editorId: string | null;
  closeEditor: () => void;
  sheet: SheetKind | null;
  /** Settings section to show, from #settings/<section>; the review's span, from #review/<span>. */
  section: string | null;
  openSheet: (kind: SheetKind, section?: string) => void;
  closeSheet: () => void;
  undoable: (msg: string, before: Map<string, Task | null>) => void;
  /** Missed slots the task has since left (back to the backlog, moved or deleted), for Analytics and the review. */
  slips: Slip[];
  refreshSlips: () => void;
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

const SHEET_HASH = /^#(settings|share|analytics|review)(?:\/([a-z]+))?$/;
type AccountsFn = (list: GoogleAccount[]) => GoogleAccount[];
/** The laptop body's padding on both sides and the divider between the panels. */
const LP_CHROME = 24 + 14;

export default function Planner({ repo, email }: { repo: TaskRepo; email: string | null }) {
  const [toastState, setToast] = useState<ToastState | null>(null);
  const toast = useCallback((msg: string, undo?: () => void) => setToast({ key: Date.now() + Math.random(), msg, undo }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const slipLog = useSlips(repo);
  const store = useTaskStore(repo, msg => toast(msg), slipLog.record);
  const now = useNow();
  const wide = useMedia('(min-width: 860px)');
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const [mounted, setMounted] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [picked, setPickedState] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [hashSheet, setHashSheet] = useState<{ kind: SheetKind; section: string | null } | null>(null);
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [phoneTab, setPhoneTab] = useState<'matrix' | 'calendar'>('matrix');
  const [filter, setFilter] = useState<Filter | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const sheetOpenedHere = useRef(false);
  const [accounts, setAccountsState] = useState<GoogleAccount[]>([]);
  const [pulling, setPulling] = useState(false);
  const pullingRef = useRef(false);
  const { prefs, update: setPrefs } = usePrefs(repo, systemDark);
  const hours = useMemo(() => workHours(prefs), [prefs]);
  const theme = resolveTheme(prefs, systemDark);

  /* ---------- the laptop split ---------- */

  const width = useWidth();
  const [splitDrag, setSplitDrag] = useState<number | null>(null);
  const f = splitDrag ?? prefs.split;
  const days = daysFor(f);
  const split = useMemo(() => {
    const avail = Math.max(0, width - LP_CHROME);
    return { f, days, full: fullMatrix(f), dragging: splitDrag != null, calW: avail * f, matrixW: avail * (1 - f) };
  }, [f, days, splitDrag, width]);
  const setSplit = useCallback((v: number) => setPrefs({ split: v }), [setPrefs]);
  const view: CalView = wide ? VIEW_FOR_DAYS[days] : 'day';

  const sources = useMemo(() => sourceIndex(accounts), [accounts]);
  const srcOf = useCallback((t: Task) => sourceOf(sources, t.externalId), [sources]);
  const labelIndex = useMemo(() => new Map(prefs.labels.map(l => [l.id, l])), [prefs.labels]);
  const labelOf = useCallback((t: Task) => resolveLabel(t, labelIndex, srcOf(t)), [labelIndex, srcOf]);
  const isOff = useCallback((t: Task) => { const src = srcOf(t); return !!src?.calendar && !src.calendar.pull; }, [srcOf]);
  const liveTasks = useCallback(() => store.all().filter(t => !isOff(t)), [store, isOff]);

  useEffect(() => { setMounted(true); }, []);

  const undoable = useCallback((msg: string, before: Map<string, Task | null>) => {
    toast(msg, before.size ? () => store.restore(before) : undefined);
  }, [store, toast]);

  const setPicked = useCallback((id: string | null) => setPickedState(id), []);

  const done = useCallback((id: string, animate = false) => {
    const t = store.get(id);
    if (!t) return;
    if (t.status === 'done') {
      undoable('Back on the list', store.patch(id, { status: 'open', doneAt: null }));
      return;
    }
    haptic('success');
    const commit = () => undoable(`Done · ${shortTitle(t.title, 36)}`, store.patch(id, { status: 'done', doneAt: Date.now() }));
    if (!animate || prefersReducedMotion()) { commit(); return; }
    // The ring fills and the strike draws, then the row leaves for Done.
    setCompleting(s => new Set(s).add(id));
    setTimeout(() => {
      setCompleting(s => { const n = new Set(s); n.delete(id); return n; });
      commit();
    }, 650);
  }, [store, undoable]);

  /* ---------- panels: the editor, and Settings, Share and Analytics by the URL hash ---------- */

  useEffect(() => {
    const read = () => {
      const m = SHEET_HASH.exec(window.location.hash);
      setHashSheet(m ? { kind: m[1] as SheetKind, section: m[2] || null } : null);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const dropHash = useCallback(() => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setHashSheet(null);
  }, []);

  const openSheet = useCallback((kind: SheetKind, section?: string) => {
    if (!hashSheet) lastFocus.current = document.activeElement as HTMLElement | null;
    setEditorId(null);
    setPickedState(null);
    const hash = `#${kind}${section ? `/${section}` : ''}`;
    // Switching from one panel to another replaces it, so Back still closes the panel.
    if (hashSheet) { history.replaceState(null, '', hash); setHashSheet({ kind, section: section ?? null }); return; }
    sheetOpenedHere.current = true;
    window.location.hash = hash.slice(1);
  }, [hashSheet]);

  const closeSheet = useCallback(() => {
    // Opened from the app: step back. Landed on it (e.g. back from Google): drop the hash without leaving.
    if (sheetOpenedHere.current) { sheetOpenedHere.current = false; history.back(); return; }
    dropHash();
  }, [dropHash]);

  const openEditor = useCallback((id: string) => {
    if (!editorId && !hashSheet) lastFocus.current = document.activeElement as HTMLElement | null;
    if (hashSheet) { sheetOpenedHere.current = false; dropHash(); }
    setPickedState(null);
    setEditorId(id);
  }, [editorId, hashSheet, dropHash]);

  const closeEditor = useCallback(() => setEditorId(null), []);

  // Back where you were when the last panel closes; after a trip to Google, the Settings button.
  const panelOpen = !!editorId || !!hashSheet;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !panelOpen) {
      const prev = lastFocus.current;
      const el = prev && document.contains(prev) ? prev : document.querySelector<HTMLElement>('[data-settings-button]');
      try { el?.focus({ preventScroll: true }); } catch { /* gone */ }
    }
    wasOpen.current = panelOpen;
  }, [panelOpen]);

  /* ---------- scheduling ---------- */

  const slot = useCallback((id: string) => {
    const t = store.get(id);
    if (!t) return;
    const s = findSlot(liveTasks(), t.minutes, { exclude: id, hours });
    if (s == null) { toast('No free slot in the next two weeks. Pick a time instead.'); setPickedState(id); return; }
    undoable(`Slotted for ${fmtWhen(s)}`, store.patch(id, { start: s }));
    setPickedState(p => (p === id ? null : p));
  }, [store, liveTasks, toast, undoable, hours]);

  const schedule = useCallback((id: string) => {
    setEditorId(null);
    setPickedState(id);
    if (!wide) { setPhoneTab('calendar'); setDay(startOfDay(Date.now())); }
  }, [wide]);

  const unslot = useCallback((id: string) => {
    undoable('Moved to the backlog', store.patch(id, { start: null }));
  }, [store, undoable]);

  const place = useCallback((id: string, start: number) => {
    const t = store.get(id);
    if (!t) return;
    const verb = t.start == null ? 'Scheduled for' : 'Moved to';
    undoable(`${verb} ${fmtWhen(start)}`, store.patch(id, { start }));
    setPickedState(null);
  }, [store, undoable]);

  const moveToCell = useCallback((id: string, cell: Filter) => {
    const t = store.get(id);
    if (!t) return;
    const patch: Partial<Task> = { priority: cell.priority };
    // Only a change of row sets the label, so a Google event keeps taking its calendar's.
    if ((labelOf(t)?.id ?? '') !== cell.label) patch.label = cell.label || null;
    if (t.start != null) patch.start = null;
    if (patch.priority === t.priority && !('label' in patch) && !('start' in patch)) return;
    const name = prefs.labels.find(l => l.id === cell.label)?.name ?? 'No label';
    undoable(`${patch.start === null ? 'Back in the backlog · ' : 'Moved to '}${name} · ${PRI[cell.priority]}`, store.patch(id, patch));
  }, [store, labelOf, prefs.labels, undoable]);

  // A slot that came and went without a tick sends its task back to the backlog, on top of the stack. Checked every
  // minute and on every change, so a task put in the past comes straight back too. No Undo: it would only bounce.
  const { loaded, tasks: allTasks, all: allNow, write } = store;
  useEffect(() => {
    if (!loaded) return;
    const back = backToBacklog(allNow(), now);
    if (!back.length) return;
    write(back);
    toast(back.length === 1 ? `Missed, so back in the backlog: ${shortTitle(back[0].title)}` : `${back.length} missed tasks are back in the backlog`);
  }, [loaded, allTasks, allNow, write, now, toast]);

  const labelId = useCallback((t: Task) => labelOf(t)?.id ?? null, [labelOf]);
  const chat = useChat({ store, repo, liveTasks, hours, toast, labels: prefs.labels, labelId });

  const plan = useMemo<PlanView>(() => {
    const out: PlanView = { ticks: new Set(), moves: new Set(), added: [], proposed: [] };
    for (const c of chat.plan?.changes ?? []) {
      if (c.skip) continue;
      const k = kindOf(c);
      if (k === 'done') out.ticks.add(c.id);
      else if (k === 'add') (c.after.start == null ? out.added : out.proposed).push(c.after);
      else if (k === 'move') { out.moves.add(c.id); if (c.after.start != null) out.proposed.push(c.after); }
    }
    return out;
  }, [chat.plan]);

  // A new plan with times on it: bring the calendar to them if none are in view.
  const shownPlan = useRef<string | null>(null);
  useEffect(() => {
    if (!chat.plan || shownPlan.current === chat.plan.id) return;
    shownPlan.current = chat.plan.id;
    const starts = plan.proposed.map(t => t.start as number).sort((a, b) => a - b);
    if (!wide || !starts.length) return;
    const inView = new Set(viewDays(view, day, prefs).map(d => ymd(d)));
    if (!starts.some(s => inView.has(ymd(s)))) setDay(startOfDay(starts[0]));
  }, [chat.plan, plan, wide, view, day, prefs]);

  const drag = useDrag({
    lengthOf: id => store.get(id)?.minutes ?? 30,
    onDrop: (id: string, dayKey: string, min: number) => place(id, atMinutes(fromYmd(dayKey), Math.max(0, min))),
    onDropBacklog: id => unslot(id),
    onDropCell: (id, cell) => {
      const [label, p] = cell.split('|');
      moveToCell(id, { label, priority: Number(p) as Priority });
    },
    onResize: (id, minutes) => {
      const t = store.get(id);
      if (!t || t.start == null) return;
      undoable(`${fmtDur(minutes)} · ends ${fmtTime(t.start + minutes * 60000)}`, store.patch(id, { minutes }));
    },
  });

  /* ---------- keys: ⌘K to the chat; Esc closes the editor or panel, then the pick, then the mic, then the chat ---------- */

  const keys = useRef({ editorId, hashSheet, picked, chat, closeEditor, closeSheet, openSheet });
  keys.current = { editorId, hashSheet, picked, chat, closeEditor, closeSheet, openSheet };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (k.editorId || k.hashSheet) return;
        k.chat.focus();
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (k.editorId) { e.preventDefault(); k.closeEditor(); return; }
      if (k.hashSheet) { e.preventDefault(); k.closeSheet(); return; }
      if (k.picked) { e.preventDefault(); setPickedState(null); return; }
      if (k.chat.listening) { e.preventDefault(); k.chat.cancelVoice(); return; }
      if (k.chat.open) { e.preventDefault(); k.chat.close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- the iPhone, iPad and Mac apps: Siri, Home Screen quick actions and the menu bar (lib/native.ts) ---------- */

  useEffect(() => {
    const off = onNativeCommand(c => {
      const k = keys.current;
      if (c.name === 'open') { k.openSheet(c.sheet); return; }
      if (k.editorId) k.closeEditor();
      if (k.hashSheet) k.closeSheet();
      if (c.name === 'listen') { if (!k.chat.listening) k.chat.mic(); return; }
      // Words from Siri become a plan waiting for review; a half-typed thought keeps them in the box instead.
      if (!c.text) { k.chat.focus(); return; }
      if (k.chat.draft.trim()) { k.chat.setDraft(`${k.chat.draft.trim()} ${c.text}`); k.chat.focus(); return; }
      k.chat.send(c.text);
    });
    nativeReady();
    return off;
  }, []);

  // A picked or edited task that disappears (done elsewhere, deleted) lets go.
  useEffect(() => {
    if (picked && !store.get(picked)) setPickedState(null);
    if (editorId && !store.get(editorId) && store.loaded) setEditorId(null);
  }, [picked, editorId, store, store.tasks]);

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
    if (prefs.colorBy === 'label') return labelOf(t)?.color ?? null;
    const src = srcOf(t);
    if (!src) return null;
    return prefs.colorBy === 'calendar' ? src.calendar?.color ?? src.account.color : src.account.color;
  }, [prefs.colorBy, srcOf, labelOf]);
  const accountColor = useCallback((a: GoogleAccount) => {
    const label = prefs.colorBy === 'label' && a.label ? labelIndex.get(a.label) : undefined;
    return label?.color ?? a.color;
  }, [prefs.colorBy, labelIndex]);

  const derived = useMemo(() => lists(store.tasks, now, isOff), [store.tasks, now, isOff]);

  const api: PlannerApi = {
    lists: derived, store, tasks: store.tasks, now, wide, repo, email, theme, completing, picked, setPicked, drag,
    day, setDay, view, split, setSplit, dragSplit: setSplitDrag, filter, setFilter,
    prefs, setPrefs, hours, phoneTab, setPhoneTab,
    toast, toastState, dismissToast, done, slot, schedule, unslot, place, moveToCell, chat, plan,
    openEditor, editorId, closeEditor, sheet: hashSheet?.kind ?? null, section: hashSheet?.section ?? null, openSheet, closeSheet, undoable,
    slips: slipLog.slips, refreshSlips: slipLog.refresh,
    accounts, sourceOf: srcOf, isOff, liveTasks, onCalendar, colorOf, labelOf, accountColor, pullGoogle, connectGoogle, removeGoogle, changeAccount, changeCalendar, pulling,
    inbox, refreshInbox,
  };

  if (!mounted) return <div className="boot" />;

  return (
    <Ctx.Provider value={api}>
      {wide ? <Laptop /> : <Phone />}
      {drag.view?.kind === 'row' && <Ghost id={drag.view.id} x={drag.view.x} y={drag.view.y} />}
    </Ctx.Provider>
  );
}

/** The task following the pointer while you drag it out of the matrix. */
function Ghost({ id, x, y }: { id: string; x: number; y: number }) {
  const { store } = usePlanner();
  const t = store.get(id);
  if (!t) return null;
  return <div className="drag-ghost" style={{ left: x + 12, top: y + 10 }} aria-hidden="true">{t.title}</div>;
}

/** Now, Next, the backlog and Done, shared by phone and laptop. Google events are calendar items, not tasks to do. */
function lists(all: Task[], now: number, isOff: (t: Task) => boolean) {
  const live = all.filter(t => !isOff(t));
  const mine = live.filter(t => !isEvent(t));
  const f = focus(mine, now);
  // Free until the next thing on the calendar today, or busy in a meeting right now.
  const dayEnd = startOfDay(now).getTime() + 864e5;
  const sched = live.filter(t => t.status === 'open' && t.start != null).sort((a, b) => (a.start as number) - (b.start as number));
  const busy = sched.find(t => isEvent(t) && (t.start as number) <= now && (t.start as number) + t.minutes * 60000 > now) ?? null;
  const freeUntil = f.now && !f.live ? sched.find(t => (t.start as number) > now && (t.start as number) < dayEnd) ?? null : null;
  return { focus: f, busy, freeUntil, backlog: backlogList(mine), done: doneList(mine).slice(0, 50) };
}

export type Lists = ReturnType<typeof lists>;
export const useLists = () => usePlanner().lists;

/** The minute the next free slot after `from` starts, today only; for the phone's suggestion. */
export function suggestOn(tasks: Task[], t: Task, dayDate: Date, hours: WorkHours, now: number) {
  const today = ymd(dayDate) === ymd(now);
  const s = findSlot(tasks, t.minutes, { onDate: dayDate, sameDay: true, exclude: t.id, hours, now: today ? Math.max(now, ceil15(now)) : startOfDay(dayDate).getTime() });
  return s == null ? null : minsOf(s);
}
