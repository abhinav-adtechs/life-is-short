'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';
import { findSlot } from '@/lib/place';
import { backToBacklog, backlogList, doneList, focus, isEvent, type Rank } from '@/lib/select';
import { fmtDur, fmtTime, fmtWhen, shortTitle } from '@/lib/format';
import { atMinutes, ceil15, fromYmd, minsOf, startOfDay, ymd } from '@/lib/time';
import { VIEW_FOR_DAYS, viewDays, type CalView } from '@/lib/calview';
import { calendarOf, mergeExternal } from '@/lib/google';
import {
  MAX_ACCOUNTS, PENDING_KEY, addAccount, disconnectGoogle, fetchGoogleItems, mergeCalendars, normalizeAccounts, ownCalendars,
  sourceIndex, sourceOf, startGoogleConnect, storedAccounts, type GoogleAccount, type GoogleCalendar, type GoogleConn, type PullResult, type Source,
} from '@/lib/google-client';
import { resolveLabel, type Label } from '@/lib/labels';
import { activeGoalOf, activeGoals, goalRanker, goalSection, rootOf, topGoals, type Goal, type GoalsFn } from '@/lib/goals';
import { blockedTasks, logFromWrites, type LogEntry } from '@/lib/flow';
import { kindOf } from '@/lib/plan';
import { daysFor, fullMatrix, type Days } from '@/lib/layout';
import { resolveTheme, workHours, type Prefs, type ThemeId } from '@/lib/prefs';
import { pendingCount } from '@/lib/share-client';
import { haptic, nativeReady, onNativeCommand } from '@/lib/native';
import type { WorkHours } from '@/lib/place';
import type { Change as Write, Slip } from '@/lib/slips';
import { dueNow, followTask, liveRepeats, markMade, nextWhen, occurrenceOf, upcoming, upcomingOn, type Repeat, type RepeatOp } from '@/lib/repeat';
import { prefersReducedMotion, useMedia, useNow, useWidth } from './hooks';
import { usePrefs } from './prefs';
import { useTaskStore, type Store } from './store';
import { useSlips } from './slips';
import { useRepeats } from './repeats';
import { useGoals } from './goalStore';
import { useGoalLog } from './goalLog';
import { useVoiceProfile, type VoiceApi } from './voiceProfile';
import { useDrag } from './drag';
import { useChat, type Chat } from './Chat';
import type { ToastState } from './Toast';
import { Laptop } from './Laptop';
import { Phone } from './Phone';

/**
 * The side panels on a laptop, bottom sheets on a phone. Settings, Share, Analytics and the review live in the URL
 * hash, so Back closes them. The review's section is its span: #review/day, #review/week or #review/month.
 */
export type SheetKind = 'goals' | 'flow' | 'analytics' | 'review' | 'share' | 'settings';

/** A cell of the matrix: one goal ('' for off-goal) at one priority. */
export interface Cell { goal: string; priority: Priority }
/** The matrix filter: a cell, or a whole goal's row (priority null). */
export interface Filter { goal: string; priority: Priority | null }

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
  /**
   * Change a task's goal and priority, as dropping it on a goal's card or a priority chip does. A calendar block
   * dropped there goes back to the backlog; a task moved between cards keeps its time.
   */
  moveToCell: (id: string, cell: Cell, opts?: { keepTime?: boolean }) => void;
  /** Every goal, active ones first in your order (lib/goals.ts). */
  goals: Goal[];
  /** The ones you're working on, in your order, sub-goals included. */
  activeGoals: Goal[];
  /** The active goals that aren't anyone's sub-goal: the rows of the matrix. */
  topGoals: Goal[];
  goalsLoaded: boolean;
  /** Change your goals. Returns what undoes it. */
  changeGoals: (fn: GoalsFn) => () => void;
  /** The active goal a task moves, or null for off-goal work. */
  goalOf: (t: Task) => Goal | null;
  /** The top goal above the goal a task moves (the goal itself when it's a top goal), or null for off-goal work. */
  rootGoalOf: (t: Task) => Goal | null;
  /** Any goal by id, achieved and dropped ones too. */
  goalById: (id: string | null | undefined) => Goal | null;
  /** Give tasks a goal (null takes them off-goal); a goal brings its section. */
  setGoal: (ids: string[], goal: string | null) => void;
  /** Open tasks held up by a step before them on their goal's chart (lib/flow.ts). */
  blocked: Set<string>;
  /** Note changes to a goal's chart in its history. Task changes are noted on their own. */
  logGoal: (entries: LogEntry[]) => void;
  /** The history of your goals' charts, oldest first. */
  readGoalLog: () => Promise<LogEntry[]>;
  chat: Chat;
  /** How you talk: the mic's language, your words, what it mishears (lib/voice.ts). */
  voice: VoiceApi;
  plan: PlanView;
  openEditor: (id: string) => void;
  editorId: string | null;
  closeEditor: () => void;
  sheet: SheetKind | null;
  /** Settings section to show, from #settings/<section>; the review's span, from #review/<span>. */
  section: string | null;
  openSheet: (kind: SheetKind, section?: string) => void;
  closeSheet: () => void;
  /** A toast with Undo, which puts these tasks back (and runs `also`, for changes to repeats). */
  undoable: (msg: string, before: Map<string, Task | null>, also?: () => void) => void;
  /** Missed slots the task has since left (back to the backlog, moved or deleted), for Analytics and the review. */
  slips: Slip[];
  refreshSlips: () => void;
  accounts: GoogleAccount[];
  /** Account and calendar of a pulled event. */
  sourceOf: (t: Task) => Source | null;
  /** From a calendar you switched off: kept, but not shown, not Now, and not busy time. */
  isOff: (t: Task) => boolean;
  /** Every task except switched-off events. */
  liveTasks: () => Task[];
  /** Those and the repeating tasks still to come: what a free slot has to miss. */
  busyTasks: () => Task[];
  /** Your repeats (lib/repeat.ts). */
  repeats: Repeat[];
  /** The repeat a task is one of, while it still repeats. */
  repeatOf: (t: Task) => Repeat | null;
  /** Start, change or stop repeats. Returns what undoes it. */
  applyRepeats: (ops: RepeatOp[]) => () => void;
  /** The timed repeating tasks still to come on a day, not made yet: faint on the calendar. */
  upcomingOn: (d: Date) => Task[];
  /** "Deleted" for a task, or for one of a repeat's, "Skipped" and when the next one comes. */
  deletedText: (t: Task) => string;
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

const SHEET_HASH = /^#(goals|flow|settings|share|analytics|review)(?:\/([a-z0-9-]+))?$/;
type AccountsFn = (list: GoogleAccount[]) => GoogleAccount[];
/** The laptop body's padding on both sides and the divider between the panels. */
const LP_CHROME = 24 + 14;

export default function Planner({ repo, email }: { repo: TaskRepo; email: string | null }) {
  const [toastState, setToast] = useState<ToastState | null>(null);
  const toast = useCallback((msg: string, undo?: () => void) => setToast({ key: Date.now() + Math.random(), msg, undo }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const slipLog = useSlips(repo);
  const repeats = useRepeats(repo, toast);
  const goals = useGoals(repo, toast);
  const goalLog = useGoalLog(repo);
  const { add: logGoal } = goalLog;
  const voice = useVoiceProfile(repo, toast);
  const { record: recordSlips, note: noteSlips } = slipLog;
  const { get: getRepeat, read: readRepeats, change: changeRepeats } = repeats;
  // What a repeating task is (title, priority, length, label, notes) belongs to its repeat: an edit to its open one,
  // made anywhere in the planner, goes on to the ones to come.
  const heard = useCallback((changes: Write[]) => {
    recordSlips(changes);
    logGoal(logFromWrites(changes, Date.now()));
    for (const { after } of changes) {
      const o = after && occurrenceOf(after.id);
      const r = o ? getRepeat(o.repeat) : null;
      if (!after || !r || !followTask(r, after, Date.now())) continue;
      changeRepeats(l => l.map(x => (x.id === r.id ? followTask(x, after, Date.now()) ?? x : x)));
    }
  }, [recordSlips, getRepeat, changeRepeats, logGoal]);
  const store = useTaskStore(repo, msg => toast(msg), heard);
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
  const goalIndex = useMemo(() => new Map(goals.list.map(g => [g.id, g])), [goals.list]);
  const liveGoals = useMemo(() => activeGoals(goals.list), [goals.list]);
  const rank = useMemo(() => goalRanker(goals.list), [goals.list]);
  const tops = useMemo(() => topGoals(goals.list), [goals.list]);
  const goalOf = useCallback((t: Task) => activeGoalOf(t, goalIndex), [goalIndex]);
  const rootGoalOf = useCallback((t: Task) => { const g = activeGoalOf(t, goalIndex); return g ? rootOf(goalIndex, g) : null; }, [goalIndex]);
  const goalById = useCallback((id: string | null | undefined) => (id ? goalIndex.get(id) ?? null : null), [goalIndex]);
  // A task on a goal is in that goal's section; otherwise its own label, or a Google event's calendar's or account's.
  const labelOf = useCallback((t: Task) => resolveLabel({ label: goalSection(t, goalIndex) ?? t.label }, labelIndex, srcOf(t)), [goalIndex, labelIndex, srcOf]);
  const isOff = useCallback((t: Task) => { const src = srcOf(t); return !!src?.calendar && !src.calendar.pull; }, [srcOf]);
  const liveTasks = useCallback(() => store.all().filter(t => !isOff(t)), [store, isOff]);
  const repeatIndex = useMemo(() => new Map(repeats.list.map(r => [r.id, r])), [repeats.list]);
  const repeatOf = useCallback((t: Task) => { const o = occurrenceOf(t.id); return o ? repeatIndex.get(o.repeat) ?? null : null; }, [repeatIndex]);
  // A repeat that's over (done enough times, or past its last day) has nothing more to come.
  const going = useMemo(() => liveRepeats(repeats.list, store.tasks, now), [repeats.list, store.tasks, now]);
  const busyTasks = useCallback(() => [...liveTasks(), ...upcoming(going, Date.now())], [liveTasks, going]);
  const upcomingDay = useCallback((d: Date) => upcomingOn(going, ymd(d), now), [going, now]);
  const deletedText = useCallback((t: Task) => {
    const r = repeatOf(t), next = r && nextWhen(r, Date.now());
    return r ? `Skipped · ${shortTitle(t.title, 30)}${next ? ` · next one ${next}` : ''}` : `Deleted · ${shortTitle(t.title, 34)}`;
  }, [repeatOf]);

  useEffect(() => { setMounted(true); }, []);

  const undoable = useCallback((msg: string, before: Map<string, Task | null>, also?: () => void) => {
    toast(msg, before.size || also ? () => { store.restore(before); also?.(); } : undefined);
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

  /** The panel the editor was opened from (a goal's chart, or Goals): it comes back when the editor closes. */
  const returnTo = useRef<{ kind: SheetKind; section: string | null } | null>(null);
  const openEditor = useCallback((id: string) => {
    if (!editorId && !hashSheet) lastFocus.current = document.activeElement as HTMLElement | null;
    if (hashSheet) {
      returnTo.current = hashSheet.kind === 'flow' || hashSheet.kind === 'goals' ? hashSheet : null;
      sheetOpenedHere.current = false;
      dropHash();
    } else if (!editorId) returnTo.current = null;
    setPickedState(null);
    setEditorId(id);
  }, [editorId, hashSheet, dropHash]);

  const closeEditor = useCallback(() => {
    setEditorId(null);
    const back = returnTo.current;
    returnTo.current = null;
    if (back) openSheet(back.kind, back.section ?? undefined);
  }, [openSheet]);

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
    const s = findSlot(busyTasks(), t.minutes, { exclude: id, hours });
    if (s == null) { toast('No free slot in the next two weeks. Pick a time instead.'); setPickedState(id); return; }
    undoable(`Slotted for ${fmtWhen(s)}`, store.patch(id, { start: s }));
    setPickedState(p => (p === id ? null : p));
  }, [store, busyTasks, toast, undoable, hours]);

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

  /** What a task becomes on a goal: the goal, and its section when it has one. */
  const onGoal = useCallback((goal: string | null): Partial<Task> => {
    const g = goal ? goalIndex.get(goal) : undefined;
    const section = g ? rootOf(goalIndex, g).section : null;
    return g ? { goal: g.id, ...(section ? { label: section } : {}) } : { goal: null };
  }, [goalIndex]);

  const moveToCell = useCallback((id: string, cell: Cell, opts: { keepTime?: boolean } = {}) => {
    const t = store.get(id);
    if (!t) return;
    const patch: Partial<Task> = { priority: cell.priority };
    // Only a change of card changes the goal: a task on a sub-goal stays on it within its top goal's card.
    if ((rootGoalOf(t)?.id ?? '') !== cell.goal) Object.assign(patch, onGoal(cell.goal || null));
    if (t.start != null && !opts.keepTime) patch.start = null;
    if (patch.priority === t.priority && !('goal' in patch) && !('start' in patch)) return;
    const name = goalIndex.get(cell.goal)?.title ?? 'Off-goal';
    undoable(`${patch.start === null ? 'Back in the backlog · ' : 'Moved to '}${shortTitle(name, 30)} · ${PRI[cell.priority]}`, store.patch(id, patch));
  }, [store, rootGoalOf, onGoal, goalIndex, undoable]);

  const setGoal = useCallback((ids: string[], goal: string | null) => {
    const list = ids.map(id => store.get(id)).filter((t): t is Task => !!t).map(t => ({ ...t, ...onGoal(goal) }));
    if (!list.length) return;
    const name = goal ? goalIndex.get(goal)?.title ?? 'a goal' : null;
    undoable(name ? `${list.length === 1 ? 'On' : `${list.length} tasks on`} ${shortTitle(name, 34)}` : `${list.length === 1 ? 'Off-goal' : `${list.length} tasks off-goal`}`, store.write(list));
  }, [store, onGoal, goalIndex, undoable]);

  // A slot that came and went without a tick sends its task back to the backlog, on top of the stack, an hour after it
  // ended (BACKLOG_GRACE), so there's time to tick it off first. Checked every minute and on every change, so a task
  // put well in the past comes straight back too. No Undo: it would only bounce.
  const { loaded, tasks: allTasks, all: allNow, write, remove } = store;
  useEffect(() => {
    if (!loaded) return;
    const back = backToBacklog(allNow(), now);
    if (!back.length) return;
    write(back);
    toast(back.length === 1 ? `Missed, so back in the backlog: ${shortTitle(back[0].title)}` : `${back.length} missed tasks are back in the backlog`);
  }, [loaded, allTasks, allNow, write, now, toast]);

  // Each day a repeat lands on gets its task, which replaces one still open from before (lib/repeat.ts). The repeats
  // are read fresh first: another device may have made today's already, and you may have deleted it since.
  const today = ymd(now);
  const behind = repeats.list.some(r => r.made < today);
  const making = useRef(false);
  useEffect(() => {
    if (!loaded || !behind || making.current) return;
    making.current = true;
    readRepeats().then(fresh => {
      if (!fresh) return;
      const due = dueNow(fresh, allNow(), Date.now());
      noteSlips(due.slips);
      if (due.puts.length) write(due.puts);
      if (due.removes.length) remove(due.removes);
      if (due.made.size) changeRepeats(markMade(due.made));
    }).finally(() => { making.current = false; });
  }, [loaded, behind, today, readRepeats, changeRepeats, noteSlips, allNow, write, remove]);

  const labelId = useCallback((t: Task) => labelOf(t)?.id ?? null, [labelOf]);
  const chatRepeats = useMemo(() => ({ list: repeats.list, repeatOf, apply: repeats.apply }), [repeats.list, repeatOf, repeats.apply]);
  const chat = useChat({ store, repo, liveTasks, busyTasks, hours, toast, labels: prefs.labels, labelId, goals: goals.list, repeats: chatRepeats, voice });

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
    // A goal's card is "<goal>|*" (keep the priority); a priority chip is "*|<priority>" (keep the goal).
    onDropCell: (id, cell, kind) => {
      const [g, p] = cell.split('|');
      const t = store.get(id);
      if (!t) return;
      moveToCell(id, { goal: g === '*' ? rootGoalOf(t)?.id ?? '' : g, priority: p === '*' ? t.priority : (Number(p) as Priority) }, { keepTime: kind === 'row' });
    },
    // Rows tick off with their check-and-strike; a block just goes.
    onDropZone: (id, zone, kind) => {
      const t = store.get(id);
      if (!t) return;
      if (zone === 'done') done(id, kind === 'row');
      else undoable(deletedText(t), store.remove([id]));
    },
    onResize: (id, minutes) => {
      const t = store.get(id);
      if (!t || t.start == null) return;
      undoable(`${fmtDur(minutes)} · ends ${fmtTime(t.start + minutes * 60000)}`, store.patch(id, { minutes }));
    },
  });

  /* ---------- keys: ⌘K speaks (again to send), ⇧⌘K types; Esc closes the editor or panel, then the pick, then the mic, then the chat ---------- */

  const keys = useRef({ editorId, hashSheet, picked, chat, closeEditor, closeSheet, openSheet });
  keys.current = { editorId, hashSheet, picked, chat, closeEditor, closeSheet, openSheet };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      // K by its letter, or by where it sits on a keyboard that doesn't type Latin letters.
      const isK = e.key.toLowerCase() === 'k' || (e.code === 'KeyK' && !/^[a-z]$/i.test(e.key));
      if ((e.metaKey || e.ctrlKey) && !e.altKey && isK) {
        e.preventDefault();
        // Held down, the key repeats: one press, one start or stop.
        if (e.repeat || e.isComposing || k.editorId || k.hashSheet) return;
        if (e.shiftKey) k.chat.focus();
        else k.chat.mic();
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
      // Speak again (⌘K in the apps' menus) stops and sends, like the mic button.
      if (c.name === 'listen') { k.chat.mic(); return; }
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

  const blocked = useMemo(() => blockedTasks(goals.list, store.tasks, now, repeats.list), [goals.list, store.tasks, now, repeats.list]);
  const derived = useMemo(() => lists(store.tasks, now, isOff, rank, blocked), [store.tasks, now, isOff, rank, blocked]);

  const api: PlannerApi = {
    lists: derived, store, tasks: store.tasks, now, wide, repo, email, theme, completing, picked, setPicked, drag,
    day, setDay, view, split, setSplit, dragSplit: setSplitDrag, filter, setFilter,
    prefs, setPrefs, hours, phoneTab, setPhoneTab,
    toast, toastState, dismissToast, done, slot, schedule, unslot, place, moveToCell, chat, voice, plan,
    goals: goals.list, activeGoals: liveGoals, topGoals: tops, goalsLoaded: goals.loaded, changeGoals: goals.change, goalOf, rootGoalOf, goalById, setGoal,
    blocked, logGoal, readGoalLog: goalLog.read,
    openEditor, editorId, closeEditor, sheet: hashSheet?.kind ?? null, section: hashSheet?.section ?? null, openSheet, closeSheet, undoable,
    slips: slipLog.slips, refreshSlips: slipLog.refresh,
    repeats: repeats.list, repeatOf, applyRepeats: repeats.apply, upcomingOn: upcomingDay, deletedText, busyTasks,
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
function lists(all: Task[], now: number, isOff: (t: Task) => boolean, rank?: Rank, blocked?: Set<string>) {
  const live = all.filter(t => !isOff(t));
  const mine = live.filter(t => !isEvent(t));
  const f = focus(mine, now, rank, blocked?.size ? t => blocked.has(t.id) : undefined);
  // Free until the next thing on the calendar today, or busy in a meeting right now.
  const dayEnd = startOfDay(now).getTime() + 864e5;
  const sched = live.filter(t => t.status === 'open' && t.start != null).sort((a, b) => (a.start as number) - (b.start as number));
  const busy = sched.find(t => isEvent(t) && (t.start as number) <= now && (t.start as number) + t.minutes * 60000 > now) ?? null;
  const freeUntil = f.now && !f.live ? sched.find(t => (t.start as number) > now && (t.start as number) < dayEnd) ?? null : null;
  return { focus: f, busy, freeUntil, backlog: backlogList(mine, rank), done: doneList(mine).slice(0, 50) };
}

export type Lists = ReturnType<typeof lists>;
export const useLists = () => usePlanner().lists;

/** The minute the next free slot after `from` starts, today only; for the phone's suggestion. */
export function suggestOn(tasks: Task[], t: Task, dayDate: Date, hours: WorkHours, now: number) {
  const today = ymd(dayDate) === ymd(now);
  const s = findSlot(tasks, t.minutes, { onDate: dayDate, sameDay: true, exclude: t.id, hours, now: today ? Math.max(now, ceil15(now)) : startOfDay(dayDate).getTime() });
  return s == null ? null : minsOf(s);
}
