'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@/lib/model';
import { newId } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';
import { applyCapture, promptContext } from '@/lib/capture';
import { buildPrompt } from '@/lib/prompt';
import { findSlot } from '@/lib/place';
import { backlogList, doneList, focus, missedList } from '@/lib/select';
import { fmtDur, fmtTime, fmtWhen, shortTitle } from '@/lib/format';
import { atMinutes, endOf, fromYmd, startOfDay } from '@/lib/time';
import { sortDump } from '@/lib/api';
import { prefersReducedMotion, useMedia, useNow } from './hooks';
import { useTaskStore, type Store } from './store';
import { useDrag, type DragKind } from './drag';
import { Toast, type ToastState } from './Toast';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { PhoneScreen, LaptopSide } from './Side';
import { LaptopCalendar, PhoneCalendar } from './Calendar';

export interface Pending { id: string; text: string }

export interface PlannerApi {
  store: Store;
  tasks: Task[];
  now: number;
  wide: boolean;
  repo: TaskRepo;
  email: string | null;
  pending: Pending[];
  completing: Set<string>;
  picked: string | null;
  setPicked: (id: string | null) => void;
  drag: ReturnType<typeof useDrag>;
  /** Day the calendar is showing. */
  day: Date;
  setDay: (d: Date) => void;
  calMode: 'day' | 'week';
  setCalMode: (m: 'day' | 'week') => void;
  phoneView: 'list' | 'calendar';
  setPhoneView: (v: 'list' | 'calendar') => void;
  toast: (msg: string, undo?: () => void) => void;
  done: (id: string, animate?: boolean) => void;
  slot: (id: string) => void;
  schedule: (id: string) => void;
  unslot: (id: string) => void;
  place: (id: string, start: number) => void;
  capture: (text: string) => void;
  openEditor: (id: string) => void;
  openSettings: () => void;
  undoable: (msg: string, before: Map<string, Task | null>) => void;
}

const Ctx = createContext<PlannerApi | null>(null);
export const usePlanner = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanner outside Planner');
  return v;
};

const loadView = (): 'day' | 'week' => { try { return localStorage.getItem('ds.view') === 'day' ? 'day' : 'week'; } catch { return 'week'; } };

export default function Planner({ repo, email }: { repo: TaskRepo; email: string | null }) {
  const [toastState, setToast] = useState<ToastState | null>(null);
  const toast = useCallback((msg: string, undo?: () => void) => setToast({ key: Date.now() + Math.random(), msg, undo }), []);
  const store = useTaskStore(repo, msg => toast(msg));
  const now = useNow();
  const wide = useMedia('(min-width: 860px)');
  const [mounted, setMounted] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [calMode, setCalModeState] = useState<'day' | 'week'>('week');
  const [phoneView, setPhoneView] = useState<'list' | 'calendar'>('list');
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => { setMounted(true); setCalModeState(loadView()); }, []);
  const setCalMode = useCallback((m: 'day' | 'week') => { setCalModeState(m); try { localStorage.setItem('ds.view', m); } catch { /* per-device nicety */ } }, []);

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
    const s = findSlot(store.all(), t.minutes, { exclude: id });
    if (s == null) { toast('No free slot in the next two weeks. Pick a time instead.'); openEditor(id); return; }
    undoable(`Slotted for ${fmtWhen(s)}`, store.patch(id, { start: s }));
    if (picked === id) setPicked(null);
  }, [store, toast, undoable, openEditor, picked]);

  /** The Now block's Schedule: a live task is pushed past its end, a backlog task gets the next free slot. */
  const schedule = useCallback((id: string) => {
    const t = store.get(id);
    if (!t) return;
    if (t.start == null) { slot(id); return; }
    const s = findSlot(store.all(), t.minutes, { exclude: id, after: endOf(t) });
    undoable(s != null ? `Pushed to ${fmtWhen(s)}` : 'Moved to the backlog', store.patch(id, { start: s }));
  }, [store, slot, undoable]);

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

  const capture = useCallback(async (text: string) => {
    const pid = newId();
    setPending(p => [...p, { id: pid, text }]);
    const { refs, ctx } = promptContext(store.all());
    const { result, via } = await sortDump(buildPrompt(text, Date.now(), ctx));
    setPending(p => p.filter(x => x.id !== pid));
    const out = applyCapture({ text, tasks: store.all(), refs, result, via });
    store.write(out.puts);
    toast(out.summary, out.puts.length ? () => store.restore(out.before) : undefined);
  }, [store, toast]);

  const drag = useDrag({
    lengthOf: id => store.get(id)?.minutes ?? 30,
    onDrop: (id: string, dayKey: string, min: number, _kind: DragKind) => place(id, atMinutes(fromYmd(dayKey), min)),
    onDropBacklog: id => unslot(id),
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

  // Esc: close the editor or settings first, then cancel a pick.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editorId) { e.preventDefault(); closeEditor(); return; }
      if (settingsOpen) { e.preventDefault(); setSettingsOpen(false); return; }
      if (picked) { e.preventDefault(); setPicked(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorId, settingsOpen, picked, closeEditor]);

  // A picked task that disappears (done elsewhere, deleted) can't be placed.
  useEffect(() => { if (picked && !store.get(picked)) setPicked(null); }, [picked, store, store.tasks]);

  const api: PlannerApi = {
    store, tasks: store.tasks, now, wide, repo, email, pending, completing, picked, setPicked, drag,
    day, setDay, calMode, setCalMode, phoneView, setPhoneView,
    toast, done, slot, schedule, unslot, place, capture, openEditor,
    openSettings: () => setSettingsOpen(true), undoable,
  };

  if (!mounted) return <div className="boot" />;
  const editing = editorId ? store.get(editorId) : undefined;

  return (
    <Ctx.Provider value={api}>
      {wide ? (
        <div className="lp">
          <LaptopSide />
          <LaptopCalendar />
        </div>
      ) : (
        <div className="ph">{phoneView === 'list' ? <PhoneScreen /> : <PhoneCalendar />}</div>
      )}
      {drag.view?.kind === 'row' && <Ghost id={drag.view.id} x={drag.view.x} y={drag.view.y} />}
      {editing && <Editor key={editing.id} task={editing} onClose={closeEditor} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
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
  const { tasks, now } = usePlanner();
  return useMemo(() => {
    const f = focus(tasks, now);
    const backlog = backlogList(tasks).filter(t => t.id !== f.now?.id);
    return { focus: f, backlog, missed: missedList(tasks, now), done: doneList(tasks).slice(0, 50) };
  }, [tasks, now]);
}
