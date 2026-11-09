'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI, newId } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';
import { applyCapture, promptContext, type Via } from '@/lib/capture';
import { changesOf, changedFields, commitChanges, draftOf, kindOf, type Change, type ChangeKind } from '@/lib/plan';
import type { Label } from '@/lib/labels';
import { buildPrompt, type PromptVoice } from '@/lib/prompt';
import { sortDump } from '@/lib/api';
import { findSlot, type WorkHours } from '@/lib/place';
import { dueLabel, fmtDur, fmtWhen } from '@/lib/format';
import { dayName, describeRule, placeFirst, repeatChoices, sameRule, type Repeat, type RepeatOp, type Rule } from '@/lib/repeat';
import { atMinutes, fromYmd, pad, startOfDay, ymd } from '@/lib/time';
import { haptic, native } from '@/lib/native';
import { joinWords, wordsOf, type Doubt } from '@/lib/speech';
import {
  LANGS, applyFixes, hasPhrase, keyOf, learnFrom, lessonOf, mergeLearned, readLearned, speechPhrases, voiceHints,
  type ChatLesson, type Learned, type Lesson, type Span,
} from '@/lib/voice';
import { useVoice, type Heard, type NoVoice, type Spoken, type VoicePhase } from './hooks';
import type { VoiceApi } from './voiceProfile';
import { usePlanner } from './Planner';
import type { Store } from './store';
import { LENGTHS, lenLabel } from './Editor';
import { LabelPicker } from './Labels';
import { ArrowUpIcon, ChatIcon, HistoryIcon, MicIcon, StopIcon, XIcon } from './icons';
import { Toast } from './Toast';
import { DropTray } from './Tray';

/* ---------- state ---------- */

export type ChatMsg =
  | YouMsg
  | { id: string; role: 'ai'; kind: 'thinking' }
  /** `learn` is what the AI suggests remembering about how you talk, learned only if you apply the plan. */
  | { id: string; role: 'ai'; kind: 'plan'; reply: string; note: string | null; changes: Change[]; learn?: Learned }
  | { id: string; role: 'ai'; kind: 'error'; text: string };
/**
 * What you said. Spoken, `mic` is what the mic typed when the fixes it knows changed it, `doubts` where it wasn't sure,
 * and `heard` what the AI took you to mean, shown in its place. `live` when it takes the place of the words that
 * streamed in as you spoke, so it settles there rather than arriving again.
 */
type YouMsg = { id: string; role: 'you'; text: string; spoken: boolean; mic?: string; doubts?: Doubt[]; heard?: string; live?: boolean };
type PlanMsg = Extract<ChatMsg, { kind: 'plan' }>;

/**
 * How something was said: out loud, with what the mic typed before any fix and where it wasn't sure, or typed. `live`
 * when it was just showing as you spoke.
 */
interface Said { spoken?: boolean; mic?: string; doubts?: Doubt[]; live?: boolean }

/**
 * What a chat has to teach, beyond what the AI suggests now: your corrections, titles you changed (by change), and
 * what it suggested for turns you fixed and asked again.
 */
interface Teaching { corrections: Span[]; retitled: Record<string, Span>; carried: Learned[]; skip: boolean }
const NO_TEACHING: Teaching = { corrections: [], retitled: {}, carried: [], skip: false };

/** One finished conversation: what you said and what came of it. Kept in your settings, newest first. */
export interface Past { at: number; said: string[]; did: string }

const HISTORY = 'chats';
const KEEP = 30;
const DRAFT = 'ds.draft';

const lastPlan = (msgs: ChatMsg[]) => [...msgs].reverse().find((m): m is PlanMsg => m.role === 'ai' && m.kind === 'plan') ?? null;
/** What you said, as the AI understood it. */
const said = (msgs: ChatMsg[]) => msgs.flatMap(m => (m.role === 'you' ? [m.heard ?? m.text] : []));

/** A chat, for learning from: what the mic typed, what you meant, what the AI suggested, and what you corrected. */
const lessonFor = (msgs: ChatMsg[], t: Teaching): ChatLesson => ({
  mic: msgs.flatMap(m => (m.role === 'you' && m.spoken ? [m.mic ?? m.text] : [])),
  said: said(msgs),
  model: mergeLearned([...t.carried, ...msgs.flatMap(m => (m.role === 'ai' && m.kind === 'plan' && m.learn ? [m.learn] : []))]),
  corrections: t.corrections,
  retitled: Object.values(t.retitled),
});

/** What the AI took a dictation to mean, when it's a cleaner telling of the same words rather than something else. */
function heardOf(h: string | undefined, text: string): string | null {
  const t = h?.replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!t || t === text) return null;
  const words = wordsOf(t), said = new Set(wordsOf(text));
  if (!words.length) return null;
  return words.filter(w => said.has(w)).length / words.length >= 0.5 ? t : null;
}

const langName = (id: string) => LANGS.find(l => l.id === id)?.name ?? id;

/** A keyboard and pointer, where the box can take the cursor without a keyboard sliding up over everything. */
const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

/** Why the mic can't listen, and what to do about it. */
function noVoiceText(why: NoVoice): string {
  if (why === 'denied') {
    const app = native();
    if (app) return `Life is short can’t use the mic. Allow Microphone and Speech Recognition for it in ${app.platform === 'macos' ? 'System Settings' : 'Settings'} → Privacy & Security.`;
    return 'The mic is blocked for this site. Allow it in your browser’s site settings, then try again.';
  }
  if (why === 'no-mic') return 'No microphone found. Plug one in, or type it here.';
  return window.matchMedia('(pointer: coarse)').matches
    ? 'Tap the mic on your keyboard and talk. It types straight into this box.'
    : 'This browser can’t take dictation. Type it here instead.';
}

function readHistory(v: unknown): Past[] {
  if (!Array.isArray(v)) return [];
  return v.filter((h): h is Past => !!h && typeof h === 'object' && typeof h.at === 'number' && typeof h.did === 'string'
    && Array.isArray(h.said) && h.said.every((s: unknown) => typeof s === 'string'));
}

const NOTES: Partial<Record<Via, string>> = {
  'no-key': 'Sorted by keywords: there’s no AI key, so I can only read days, times and priorities.',
  'ai-error': 'Sorted by keywords: the AI didn’t answer. Edit the cards, or try again in a moment.',
  empty: 'Sorted by keywords.',
};

/**
 * The conversation behind the dump bar. What you say becomes a plan of changes; nothing touches your tasks until you
 * accept it. Say more to change the plan, or edit its cards by hand. Accepting or discarding files the conversation
 * away in your history and starts a fresh one.
 */
export function useChat({ store, repo, liveTasks, busyTasks, hours, toast, labels, labelId, repeats, voice }: {
  store: Store; repo: TaskRepo; liveTasks: () => Task[]; busyTasks: () => Task[]; hours: WorkHours; toast: (msg: string, undo?: () => void) => void;
  /** Your labels, and the label a task counts as (a Google event takes its calendar's). */
  labels: Label[]; labelId: (t: Task) => string | null;
  /** Your repeats, the one a task is one of, and how to change them. */
  repeats: { list: Repeat[]; repeatOf: (t: Task) => Repeat | null; apply: (ops: RepeatOp[]) => () => void };
  /** How you talk (lib/voice.ts): what the mic listens for, what the AI is told, and what each chat teaches. */
  voice: VoiceApi;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgsState] = useState<ChatMsg[]>([]);
  const msgsRef = useRef(msgs);
  const setMsgs = useCallback((fn: (m: ChatMsg[]) => ChatMsg[]) => { msgsRef.current = fn(msgsRef.current); setMsgsState(msgsRef.current); }, []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [draft, setDraftState] = useState('');
  const [heard, setHeard] = useState<Heard | null>(null);
  const [history, setHistory] = useState<Past[] | null>(null);
  const [view, setView] = useState<'thread' | 'history'>('thread');
  /** A finished conversation opened from History, shown read-only until you say something new. */
  const [past, setPast] = useState<Past | null>(null);
  /** Undo for conversations applied while the planner has been open, by when they were filed. */
  const undos = useRef(new Map<number, () => void>());
  /** Bumped whenever the conversation is cleared, so an answer still on its way lands nowhere. */
  const thread = useRef(0);
  const input = useRef<HTMLTextAreaElement | null>(null);
  /** What the mic typed, before any fix, while you're speaking. */
  const rawHeard = useRef<Heard | null>(null);
  /** Words the mic put in the box: sent from there, they still count as spoken, and what you changed teaches it. */
  const dictated = useRef<{ mic: string; text: string; doubts: Doubt[] } | null>(null);
  /** The message you're fixing: sending takes that turn back and asks again. */
  const [fixing, setFixingState] = useState<string | null>(null);
  const fixingRef = useRef<string | null>(null);
  const setFixing = useCallback((id: string | null) => { fixingRef.current = id; setFixingState(id); }, []);
  const [teaching, setTeachingState] = useState<Teaching>(NO_TEACHING);
  const teachingRef = useRef(teaching);
  const setTeaching = useCallback((fn: (t: Teaching) => Teaching) => { teachingRef.current = fn(teachingRef.current); setTeachingState(teachingRef.current); }, []);
  const correct = useCallback((span: Span) => setTeaching(t => ({ ...t, corrections: [...t.corrections, span] })), [setTeaching]);
  const profile = voice.profile;
  const fix = useCallback((text: string) => applyFixes(text, profile.fixes), [profile.fixes]);

  const setDraft = useCallback((v: string) => {
    setDraftState(v);
    if (!v) { dictated.current = null; if (fixingRef.current) setFixing(null); }
    try { if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { /* draft is a nicety */ }
  }, [setFixing]);
  /** Put what the mic heard in the box, to send or fix. */
  const dictate = useCallback((s: Spoken) => {
    const text = fix(s.text);
    setDraft(text);
    dictated.current = { mic: s.text, text, doubts: s.doubts };
  }, [fix, setDraft]);
  useEffect(() => { try { const d = localStorage.getItem(DRAFT); if (d) setDraftState(d); } catch { /* none */ } }, []);

  const focusInput = useCallback(() => { setTimeout(() => input.current?.focus(), 0); }, []);

  const send = useCallback(async (raw: string, by: Said = {}) => {
    const text = raw.trim();
    if (!text) return;
    // One question at a time: words that arrive mid-answer wait in the box.
    if (busyRef.current) {
      setDraft(text);
      if (by.spoken) dictated.current = { mic: by.mic ?? text, text, doubts: by.doubts ?? [] };
      return;
    }
    // Fixing what you said: that turn is taken back and asked again. What you changed in it teaches it, and so does
    // what the AI suggested for it, as far as your fix kept it.
    const fixId = fixingRef.current;
    if (fixId) {
      setFixing(null);
      const i = msgsRef.current.findIndex(m => m.id === fixId);
      const old = msgsRef.current[i];
      if (old?.role === 'you') {
        const answer = msgsRef.current[i + 1];
        if (answer?.role === 'ai' && answer.kind === 'plan' && answer.learn) {
          const kept: Learned = { ...answer.learn, fixes: answer.learn.fixes.filter(f => hasPhrase(text, f.meant)) };
          setTeaching(t => ({ ...t, carried: [...t.carried, kept] }));
        }
        setMsgs(m => m.slice(0, i));
        if (!by.spoken && old.spoken) {
          by = { spoken: true, mic: old.mic ?? old.text, doubts: old.doubts };
          correct({ from: old.heard ?? old.text, to: text });
        }
      }
    }
    // Words the mic put in the box: still spoken, and whatever you changed teaches it.
    const d = dictated.current;
    if (!by.spoken && d) {
      by = { spoken: true, mic: d.mic, doubts: d.doubts };
      if (keyOf(text) !== keyOf(d.text)) correct({ from: d.mic, to: text });
    }
    setOpen(true);
    setView('thread');
    if (past) { setPast(null); setMsgs(() => []); }
    setDraft('');
    const t0 = thread.current;
    const prior = msgsRef.current;
    const plan = lastPlan(prior);
    const earlier = said(prior);
    const waitId = newId(), youId = newId();
    const spoken = !!by.spoken;
    const you: YouMsg = {
      id: youId, role: 'you', text, spoken,
      ...(spoken && by.mic && by.mic.trim() !== text ? { mic: by.mic.trim() } : {}),
      ...(spoken && by.doubts?.length ? { doubts: by.doubts } : {}),
      ...(spoken && by.live ? { live: true } : {}),
    };
    setMsgs(m => [...m, you, { id: waitId, role: 'ai', kind: 'thinking' }]);
    busyRef.current = true;
    setBusy(true);
    let msg: ChatMsg;
    let heard: string | null = null;
    try {
      const tasks = liveTasks();
      // Slotting goes around the repeating tasks still to come, too.
      const busy = busyTasks();
      const ruleOf = (id: string) => { const t = store.get(id); return (t && repeats.repeatOf(t)?.rule) ?? null; };
      const { refs, ctx } = promptContext(tasks, labelId, repeats.repeatOf);
      const live = plan ? plan.changes.filter(c => !c.skip) : [];
      const refOf = new Map([...refs].map(([ref, id]) => [id, ref]));
      const convo = plan ? { earlier, draft: draftOf(live, refOf) } : undefined;
      const v: PromptVoice = { spoken, doubts: you.doubts, learn: profile.learn, ...voiceHints(profile) };
      const { result, via } = await sortDump(buildPrompt(text, Date.now(), ctx, hours, labels, convo, v));
      if (thread.current !== t0) return;
      heard = spoken && via === 'ai' ? heardOf(result?.heard, text) : null;
      let changes: Change[];
      let how: Via = via;
      if (plan && via !== 'ai') {
        // No model to revise the plan: keep it, and add whatever the keywords find in what you just said.
        const view = new Map(busy.map(x => [x.id, x]));
        for (const c of live) view.set(c.id, c.after);
        changes = [...live, ...changesOf(applyCapture({ text, tasks: [...view.values()], refs: new Map(), result: null, via, hours, labels }))];
      } else {
        const out = applyCapture({ text: [...earlier, text].join('\n'), tasks: busy, refs, result, via, hours, labels, revise: !!plan, ruleOf });
        changes = changesOf(out);
        how = out.via;
      }
      const reply = how === 'ai' && result?.reply ? result.reply
        : changes.length ? (plan ? 'Here’s the plan now.' : 'Here’s what I’ll do.')
        : plan ? 'That leaves nothing in the plan.' : 'I couldn’t find anything to add in that.';
      const learn = how === 'ai' && result?.learn ? readLearned(result.learn) : null;
      msg = { id: waitId, role: 'ai', kind: 'plan', reply, note: NOTES[how] ?? null, changes, ...(learn ? { learn } : {}) };
    } catch {
      if (thread.current !== t0) return;
      msg = { id: waitId, role: 'ai', kind: 'error', text: 'Something went wrong there. Try saying it again.' };
    } finally {
      if (thread.current === t0) { busyRef.current = false; setBusy(false); }
    }
    setMsgs(m => m.map(x => (x.id === waitId ? msg : x.id === youId && heard ? { ...x, heard } : x)));
  }, [liveTasks, busyTasks, store, repeats, hours, labels, labelId, setDraft, setMsgs, past, profile, correct, setFixing, setTeaching]);

  /** What the mic has typed so far, before any fix, with where it wasn't sure. */
  const micSoFar = (): Spoken | null => {
    const h = rawHeard.current;
    const text = h ? joinWords(h.text, h.interim) : '';
    return text ? { text, doubts: [] } : null;
  };

  const listen = useVoice({
    lang: profile.lang,
    // Your words, the ones it mishears, your labels and the names in your tasks.
    phrases: () => speechPhrases(profile, { labels: labels.map(l => l.name), titles: liveTasks().filter(t => t.status === 'open').map(t => t.title) }),
    // The fixes it's sure of are made as you speak.
    onHeard: h => { rawHeard.current = h; setHeard({ text: fix(h.text), interim: fix(h.interim) }); },
    // What streamed in as you spoke settles in place as what you said, and the answer starts.
    onFinish: s => { setHeard(null); rawHeard.current = null; if (s.text.trim()) send(fix(s.text), { spoken: true, mic: s.text, doubts: s.doubts, live: true }); },
    onCutOff: s => {
      setHeard(null);
      rawHeard.current = null;
      if (!s.text.trim()) { toast('Stopped listening: I didn’t hear anything.'); return; }
      dictate(s);
      if (finePointer()) focusInput();
      toast('Stopped listening. What you said is in the box.');
    },
    onUnsupported: why => {
      setHeard(null);
      rawHeard.current = null;
      haptic('warning');
      if (why !== 'denied' || finePointer()) focusInput();
      toast(noVoiceText(why));
    },
    onLangUnsupported: lang => toast(`This browser can’t listen in ${langName(lang)}, so it’s listening in its own language. Change it in Settings → Voice.`),
  });

  /** The mic button and ⌘K: start listening, or stop and send what you said. */
  const mic = useCallback(() => {
    if (listen.listening) {
      if (listen.phase !== 'finishing') haptic('selection');
      listen.finishVoice();
      return;
    }
    setOpen(true);
    setView('thread');
    dictated.current = null;
    haptic('light');
    listen.startVoice(draft);
  }, [listen, draft]);

  /** Drop the recording, with Undo putting the words in the box. */
  const cancelVoice = useCallback(() => {
    const words = micSoFar();
    listen.stopVoice();
    setHeard(null);
    rawHeard.current = null;
    if (words) toast('Recording discarded', () => { dictate(words); if (finePointer()) focusInput(); });
  }, [listen, toast, dictate, focusInput]);

  /** Stop listening and keep what you said in the box, to finish by hand. */
  const keepWords = useCallback(() => {
    if (!listen.listening) return;
    const words = micSoFar();
    listen.stopVoice();
    setHeard(null);
    rawHeard.current = null;
    if (words) dictate(words);
  }, [listen, dictate]);

  const remember = useCallback((list: string[], did: string, undo?: () => void) => {
    if (!list.length) return;
    const entry: Past = { at: Date.now(), said: list.map(s => s.slice(0, 1000)), did };
    if (undo) undos.current.set(entry.at, undo);
    setHistory(h => (h ? [entry, ...h].slice(0, KEEP) : h));
    // History is a nicety: a failed save never gets in the way.
    repo.getSetting(HISTORY).then(v => repo.setSetting(HISTORY, [entry, ...readHistory(v)].slice(0, KEEP))).catch(() => undefined);
  }, [repo]);

  const reset = useCallback(() => {
    thread.current++;
    listen.stopVoice();
    setHeard(null);
    rawHeard.current = null;
    dictated.current = null;
    setFixing(null);
    setTeaching(() => NO_TEACHING);
    setMsgs(() => []);
    busyRef.current = false;
    setBusy(false);
  }, [listen, setMsgs, setFixing, setTeaching]);

  const accept = useCallback(() => {
    const plan = lastPlan(msgsRef.current);
    if (!plan || busyRef.current) return;
    const { puts, removes, ops, summary } = commitChanges(plan.changes, store.get, Date.now(), labels, repeats.list);
    if (!puts.length && !removes.length && !ops.length) { toast('Nothing left to change. Edit the plan or discard it.'); return; }
    // The repeats first, so the tasks written next already belong to them.
    const unrepeat = repeats.apply(ops);
    const before = new Map([...store.remove(removes), ...store.write(puts)]);
    const undo = () => { store.restore(before); unrepeat(); };
    haptic('success');
    toast(summary, undo);
    remember(said(msgsRef.current), summary, undo);
    // Each chat you apply teaches it how you talk; Settings → Voice shows what it learned.
    if (profile.learn && !teachingRef.current.skip) {
      const lesson = lessonFor(msgsRef.current, teachingRef.current);
      voice.change(p => learnFrom(p, lesson, Date.now()));
    }
    reset();
    setOpen(false);
  }, [store, toast, remember, reset, labels, repeats, profile.learn, voice]);

  const discard = useCallback(() => {
    remember(said(msgsRef.current), 'Discarded');
    reset();
    setOpen(false);
    toast('Plan discarded');
  }, [remember, reset, toast]);

  /** Undo a conversation applied earlier, from History. */
  const undoPast = useCallback((h: Past) => {
    const fn = undos.current.get(h.at);
    if (!fn) return;
    fn();
    undos.current.delete(h.at);
    toast(`Undid “${h.said[0].length > 40 ? h.said[0].slice(0, 38).trimEnd() + '…' : h.said[0]}”`);
  }, [toast]);
  const canUndo = useCallback((h: Past) => undos.current.has(h.at), []);

  /** Start afresh: an empty thread, ready to type. Nothing pending is lost: a plan stays until you apply or discard it. */
  const newChat = useCallback(() => {
    setPast(null);
    setView('thread');
    if (!lastPlan(msgsRef.current)) setMsgs(() => []);
    focusInput();
  }, [setMsgs, focusInput]);

  const openPast = useCallback((h: Past) => { setPast(h); setView('thread'); }, []);

  /** Change the plan by talking: the mic if you spoke it, otherwise the box. */
  const modify = useCallback(() => {
    const last = [...msgsRef.current].reverse().find((m): m is YouMsg => m.role === 'you');
    if (last?.spoken && listen.supported() && !listen.listening) { listen.startVoice(draft); return; }
    focusInput();
  }, [listen, draft, focusInput]);

  /** Fix what you said: it goes in the box, and sending it takes that turn back and asks again. */
  const fixSaid = useCallback((id: string) => {
    const m = msgsRef.current.find((x): x is YouMsg => x.id === id && x.role === 'you');
    if (!m || busyRef.current) return;
    dictated.current = null;
    setDraftState(m.heard ?? m.text);
    setFixing(id);
    focusInput();
  }, [setFixing, focusInput]);

  /** Leave out what this chat would teach, or put it back. */
  const skipTeaching = useCallback(() => setTeaching(t => ({ ...t, skip: !t.skip })), [setTeaching]);

  const close = useCallback(() => {
    keepWords();
    setOpen(false);
    setPast(null);
  }, [keepWords]);

  /** ⇧⌘K: open the chat and put the cursor in the box. Mid-sentence, what you've said so far goes in it. */
  const focus = useCallback(() => { keepWords(); setOpen(true); focusInput(); }, [keepWords, focusInput]);
  const showHistory = useCallback(() => { setOpen(true); setView('history'); }, []);

  const updatePlan = useCallback((fn: (c: Change) => Change) => {
    setMsgs(m => {
      const plan = lastPlan(m);
      return plan ? m.map(x => (x === plan ? { ...plan, changes: plan.changes.map(fn) } : x)) : m;
    });
  }, [setMsgs]);
  /** Change a proposed change; `repeat` (when given) is how a new task repeats, or null for not at all. */
  const edit = useCallback((id: string, patch: Partial<Task>, repeat?: Rule | null) => {
    // A title you change teaches it: the first one it proposed, against your last.
    const was = lastPlan(msgsRef.current)?.changes.find(c => c.id === id)?.after.title;
    const to = patch.title;
    if (was && to && to !== was) setTeaching(t => ({ ...t, retitled: { ...t.retitled, [id]: { from: t.retitled[id]?.from ?? was, to } } }));
    updatePlan(c => (c.id === id ? { ...c, after: { ...c.after, ...patch }, ...(repeat !== undefined ? { repeat } : {}) } : c));
  }, [updatePlan, setTeaching]);
  const toggle = useCallback((id: string) => updatePlan(c => (c.id === id ? { ...c, skip: !c.skip } : c)), [updatePlan]);

  const loadHistory = useCallback(() => {
    repo.getSetting(HISTORY).then(v => setHistory(readHistory(v))).catch(() => setHistory(h => h ?? []));
  }, [repo]);

  const plan = lastPlan(msgs);
  /** What applying this chat would teach, for the plan to show. Null when learning is off. */
  const lesson = useMemo<{ will: Lesson; skip: boolean } | null>(
    () => (profile.learn ? { will: lessonOf(lessonFor(msgs, teaching)), skip: teaching.skip } : null),
    [msgs, teaching, profile.learn]);
  /** Tasks as the open plan would leave them, for the calendar to show. */
  const preview = useMemo(() => {
    const m = new Map<string, Task>();
    if (plan) for (const c of plan.changes) if (!c.skip) m.set(c.id, c.after);
    return m;
  }, [plan]);

  return {
    open, show: () => { setOpen(true); setView('thread'); }, close, focus, msgs, busy, plan, preview,
    draft, setDraft, input, heard, listening: listen.listening, phase: listen.phase, onDevice: listen.onDevice,
    send, mic, cancelVoice, accept, discard, modify, edit, toggle, history, loadHistory,
    view, setView, showHistory, past, openPast, newChat, undoPast, canUndo,
    fixing, fixSaid, lesson, skipTeaching,
  };
}

export type Chat = ReturnType<typeof useChat>;

/* ---------- the conversation ---------- */

const VERB: Record<ChangeKind, string> = { add: 'Add', done: 'Tick off', move: 'Move', edit: 'Change' };

/** "Tomorrow, 9:00 AM", or where it waits when it has no time. */
const whenText = (t: Pick<Task, 'start'>, now: number) => (t.start != null ? fmtWhen(t.start, now) : 'Backlog');

/** The line under a change: everything about a new task, only what changes for one you have. */
function metaOf(c: Change, now: number, labels: Label[]): { text: string; hot?: boolean }[] {
  const a = c.after;
  const name = (id: string | null | undefined) => labels.find(l => l.id === id)?.name;
  if (!c.before) {
    const label = name(a.label);
    const due = a.due ? dueLabel(a.due, now) : null;
    return [
      { text: PRI[a.priority], hot: a.priority === 1 },
      ...(label ? [{ text: label }] : []),
      { text: fmtDur(a.minutes) },
      // A repeat: how, and its first one.
      ...(c.repeat ? [
        { text: describeRule(c.repeat) },
        { text: `from ${a.start != null ? fmtWhen(a.start, now) : dayName(a.due ?? ymd(now), now)}` },
      ] : [a.start != null ? { text: fmtWhen(a.start, now) } : due ? { text: due.text, hot: due.hot } : { text: 'Backlog' }]),
    ];
  }
  const b = c.before;
  if (kindOf(c) === 'done') return [{ text: 'Marks it done' }];
  const out: { text: string; hot?: boolean }[] = [];
  if (c.repeat) out.push({ text: describeRule(c.repeat) });
  else if (c.repeat === null) out.push({ text: 'Stops repeating' });
  for (const f of changedFields(b, a)) {
    if (f === 'start') out.push({ text: `${whenText(b, now)} → ${whenText(a, now)}` });
    if (f === 'priority') out.push({ text: `${PRI[b.priority]} → ${PRI[a.priority]}`, hot: a.priority === 1 });
    if (f === 'minutes') out.push({ text: `${fmtDur(b.minutes)} → ${fmtDur(a.minutes)}` });
    if (f === 'due') out.push({ text: a.due ? dueLabel(a.due, now).text : 'No due date' });
    if (f === 'title') out.push({ text: `Was “${b.title}”` });
    if (f === 'label') out.push({ text: `${name(b.label) ?? 'No label'} → ${name(a.label) ?? 'No label'}` });
    if (f === 'notes' && a.notes) out.push({ text: 'Adds a note' });
  }
  return out;
}

/** The chat's title: the first clause of what you said. */
function titleOf(msgs: ChatMsg[], phone?: boolean) {
  const first = msgs.find((m): m is Extract<ChatMsg, { role: 'you' }> => m.role === 'you')?.text ?? '';
  const clause = (first.split(/[.;!?\n]/)[0] || first).trim();
  const max = phone ? 30 : 42;
  return clause.length > max ? clause.slice(0, max - 2).trimEnd() + '…' : clause || 'New chat';
}

/** Follow the thread as it grows. A plan too tall to see at once shows from its top. */
function useFollow(dep: unknown) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const last = el.querySelector<HTMLElement>('[role="log"] > :last-child');
    if (last && last.offsetHeight > el.clientHeight) el.scrollTop = last.offsetTop - 12;
    else el.scrollTop = el.scrollHeight;
  }, [dep]);
  return box;
}

const EXAMPLES = ['Call the plumber tomorrow at 9', 'Move the support playbook to Friday at 2', 'Book a haircut at some point'];

function Thread({ phone }: { phone?: boolean }) {
  const { chat } = usePlanner();
  const { msgs, heard, plan, past } = chat;
  const live = heard ? `${heard.text} ${heard.interim}` : '';
  const last = msgs.at(-1);
  const lastYou = [...msgs].reverse().find(m => m.role === 'you')?.id;
  const box = useFollow(`${msgs.length}:${last && 'kind' in last ? last.kind : last?.role}:${live.length}:${past?.at}`);
  const use = (t: string) => { chat.setDraft(t); setTimeout(() => chat.input.current?.focus(), 0); };
  return (
    <div className="thread" ref={box}>
      <div className="thread-fill" />
      <div role="log" aria-label="Conversation" aria-live="polite">
        {past ? (
          <>
            {past.said.map((s, i) => <div key={i} className="you"><p>{s}</p></div>)}
            <div className="ai"><p>{past.did}.</p></div>
          </>
        ) : !msgs.length && !heard ? (
          <div className="intro">
            <p className="intro-t">Dump anything, or ask for a change.</p>
            <p className="note">Nothing changes until you apply it. Try one of these:</p>
            <div className="examples">
              {(phone ? EXAMPLES.filter((_, i) => i !== 1) : EXAMPLES).map(x => <button key={x} type="button" className="btn sec" onClick={() => use(x)}>{x}</button>)}
            </div>
          </div>
        ) : null}
        {!past && msgs.map(m => {
          if (m.role === 'you') return <YouSaid key={m.id} m={m} last={m.id === lastYou} />;
          if (m.kind === 'thinking') return <div key={m.id} className="ai"><p className="think" aria-label="Working it out"><i /><i /><i /></p></div>;
          if (m.kind === 'error') return <div key={m.id} className="ai"><p>{m.text}</p></div>;
          return <PlanCard key={m.id} m={m} live={m === plan} phone={phone} />;
        })}
        {heard && (
          <div className="you live" data-phase={chat.phase} aria-live="off">
            <MicIcon size={13} />
            <p>
              {heard.text}{heard.interim && <span> {heard.interim}</span>}
              {!heard.text && !heard.interim && <span>{chat.phase === 'starting' ? 'Starting the mic…' : 'Listening…'}</span>}
              <i className="caret" aria-hidden="true" />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What you said. Spoken, it shows what the AI took you to mean, with what the mic heard a tap away, and the last thing
 * you said can be fixed: the fix goes in the box, and sending it asks again (and teaches it the words it misheard).
 */
function YouSaid({ m, last }: { m: YouMsg; last: boolean }) {
  const { chat } = usePlanner();
  const [raw, setRaw] = useState(false);
  const shown = m.heard ?? m.text;
  const mic = m.spoken ? m.mic ?? m.text : null;
  const differs = !!mic && keyOf(mic) !== keyOf(shown);
  const canFix = m.spoken && last && !chat.busy;
  const fixing = chat.fixing === m.id;
  return (
    <div className={'you' + (fixing ? ' fixing' : '') + (m.live ? ' was-live' : '')}>
      {m.spoken && <MicIcon size={13} />}
      <div className="you-b">
        <p>{shown}</p>
        {raw && differs && <p className="you-raw"><span className="sr">The mic heard: </span>{mic}</p>}
        {(differs || canFix) && (
          <span className="you-f">
            {differs && <button type="button" className="link" aria-expanded={raw} onClick={() => setRaw(r => !r)}>{raw ? 'Hide what the mic heard' : 'What the mic heard'}</button>}
            {canFix && !fixing && <button type="button" className="link" onClick={() => chat.fixSaid(m.id)}>Fix what I said</button>}
            {fixing && <span>Fix it in the box, then send</span>}
          </span>
        )}
      </div>
    </div>
  );
}

/** What applying this chat will teach it, with the way to leave that out. */
function Teaches() {
  const { chat } = usePlanner();
  const l = chat.lesson;
  if (!l) return null;
  const { will } = l;
  const items = [
    ...will.fixes.map(f => `“${f.from}” is ${f.to}`),
    ...will.words,
    ...will.habits,
  ];
  if (!items.length) return null;
  return (
    <p className="note teaches">
      {l.skip ? 'It won’t remember anything from this chat. ' : <>Will remember: {items.join(' · ')}. </>}
      <button type="button" className="link" onClick={chat.skipTeaching}>{l.skip ? 'Remember it' : 'Don’t'}</button>
    </p>
  );
}

/** The plan: one row per change, ticked to keep. Apply writes the ticked ones; until then they're dashed on the calendar and in the matrix. */
function PlanCard({ m, live, phone }: { m: PlanMsg; live: boolean; phone?: boolean }) {
  const { chat, now, prefs } = usePlanner();
  const [editing, setEditing] = useState<string | null>(null);
  const kept = m.changes.filter(c => !c.skip).length;
  if (!live) {
    return (
      <div className="ai old">
        <p>{m.reply}</p>
        {m.changes.length > 0 && <p className="note">Earlier draft · {m.changes.length} change{m.changes.length === 1 ? '' : 's'}</p>}
      </div>
    );
  }
  return (
    <>
      <div className="ai">
        <p>{m.reply}</p>
        {m.note && <p className="note">{m.note}</p>}
      </div>
      {m.changes.length > 0 ? (
        <div className="plan">
          <div className="plan-h"><b>Plan</b><span className="muted sm">{m.changes.length === 1 ? '1 change' : `${m.changes.length} changes`}</span></div>
          {m.changes.map(c => {
            const kind = kindOf(c);
            if (editing === c.id) return <div key={c.id} className="plan-edit"><CardEditor c={c} onDone={() => setEditing(null)} /></div>;
            return (
              <div key={c.id} className={'plan-row' + (c.skip ? ' off' : '')}>
                <input type="checkbox" checked={!c.skip} aria-label={`${c.skip ? 'Put back' : 'Leave out'}: ${c.after.title}`} onChange={() => chat.toggle(c.id)} />
                {!phone && <span className="plan-v">{VERB[kind]}</span>}
                <button type="button" className="plan-b" disabled={kind === 'done' || !!c.skip} title={kind === 'done' ? undefined : 'Edit this change'}
                  onClick={() => setEditing(c.id)}>
                  {phone && <span className="plan-v">{VERB[kind]}</span>}
                  <span className={'plan-t' + (kind === 'done' ? ' struck' : '')}>{c.after.title}</span>
                  <span className="plan-m">{metaOf(c, now, prefs.labels).map((x, i) => <span key={i} className={x.hot ? 'hot' : undefined}>{i ? ' · ' : ''}{x.text}</span>)}</span>
                </button>
              </div>
            );
          })}
          <Teaches />
          <div className="plan-f">
            <button type="button" className={'btn pri' + (phone ? ' tall' : ' sm')} disabled={!kept || chat.busy} onClick={chat.accept}>Apply {kept}</button>
            <button type="button" className={'btn ghost' + (phone ? ' tall' : ' sm')} onClick={chat.discard}>Discard</button>
            {!phone && <span className="note plan-n">Dashed on the calendar and in the matrix until you apply.</span>}
          </div>
        </div>
      ) : (
        <div className="acts"><button type="button" className="btn ghost sm" onClick={chat.discard}>Start over</button></div>
      )}
      {phone && m.changes.length > 0 && <p className="note">Shown dashed in the matrix and calendar until you apply.</p>}
    </>
  );
}

/** Edit one change in place. Day and Start work like the task editor's: a day alone takes that day's first free slot. */
function CardEditor({ c, onDone }: { c: Change; onDone: () => void }) {
  const { chat, busyTasks, hours, prefs, now } = usePlanner();
  const t = c.after;
  const id = useId();
  const [title, setTitle] = useState(t.title);
  const [priority, setPriority] = useState<Priority>(t.priority);
  // A new repeat without a time has its first day as its due date.
  const [date, setDate] = useState(t.start != null ? ymd(t.start) : c.repeat && !c.before ? t.due ?? '' : '');
  const [time, setTime] = useState(t.start != null ? `${pad(new Date(t.start).getHours())}:${pad(new Date(t.start).getMinutes())}` : '');
  const [minutes, setMinutes] = useState(t.minutes);
  const [due, setDue] = useState(t.due || '');
  const [notes, setNotes] = useState(t.notes || '');
  const [label, setLabel] = useState<string | null>(t.label ?? null);
  // Only a new task can be made to repeat here.
  const [repeat, setRepeat] = useState<Rule | null>(c.repeat ?? null);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const repeats = !c.before ? repeatChoices(c.repeat ?? null, date || (t.start != null ? ymd(t.start) : t.due) || ymd(now)) : [];

  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
    const fields = { title: title.replace(/\s+/g, ' ').trim().slice(0, 160) || t.title, priority, minutes, notes: notes.trim(), label };
    if (repeat) {
      // Its first one: at its time on its day, else in the backlog, due that day.
      const pl = placeFirst(repeat, { date: date || null, time: time || null, deadline: false }, Date.now());
      chat.edit(c.id, { ...fields, ...pl }, repeat);
      onDone();
      return;
    }
    let start: number | null = null;
    if (date || time) {
      const day = date ? fromYmd(date) : startOfDay(Date.now());
      if (time) { const [h, m] = time.split(':').map(Number); start = atMinutes(day, h * 60 + m); }
      else if (t.start != null && ymd(t.start) === ymd(day)) start = t.start;
      else {
        // Around your calendar and the rest of this plan.
        const others = [...busyTasks().filter(x => !chat.preview.has(x.id)), ...chat.preview.values()];
        start = findSlot(others, minutes, { onDate: day, sameDay: true, exclude: t.id, hours }) ?? atMinutes(day, hours.start);
      }
    }
    chat.edit(c.id, { ...fields, start, due: due || null }, c.before ? undefined : null);
    onDone();
  };
  const lengths = LENGTHS.includes(minutes) ? LENGTHS : [...LENGTHS, minutes].sort((a, b) => a - b);

  return (
    <form className="ced" onSubmit={save} autoComplete="off"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); } }}>
      <div className="fld">
        <label htmlFor={`${id}-t`} className="sr">Task</label>
        <textarea ref={first} id={`${id}-t`} className="ed-title sm" rows={2} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } }} />
      </div>
      <div className="fld">
        <span className="flabel" id={`${id}-p`}>Priority</span>
        <div className="seg fill" role="radiogroup" aria-labelledby={`${id}-p`}>
          {([1, 2, 3] as Priority[]).map(p => (
            <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => setPriority(p)}>{PRI[p]}</button>
          ))}
        </div>
      </div>
      {prefs.labels.length > 0 && (
        <div className="fld">
          <span className="flabel" id={`${id}-b`}>Label</span>
          <LabelPicker labelledBy={`${id}-b`} value={label} onChange={setLabel} />
        </div>
      )}
      <div className="two">
        <div className="fld"><label htmlFor={`${id}-d`}>Day</label><input id={`${id}-d`} type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="fld"><label htmlFor={`${id}-s`}>Start</label><input id={`${id}-s`} type="time" step={900} value={time} onChange={e => setTime(e.target.value)} /></div>
      </div>
      <div className="two">
        <div className="fld">
          <label htmlFor={`${id}-l`}>Length</label>
          <select id={`${id}-l`} value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
            {lengths.map(m => <option key={m} value={m}>{lenLabel(m)}</option>)}
          </select>
        </div>
        {repeat
          ? <div className="fld" />
          : <div className="fld"><label htmlFor={`${id}-u`}>Due by</label><input id={`${id}-u`} type="date" value={due} onChange={e => setDue(e.target.value)} /></div>}
      </div>
      {!c.before && (
        <div className="fld">
          <label htmlFor={`${id}-r`}>Repeat</label>
          <select id={`${id}-r`} value={repeats.find(x => sameRule(x.rule, repeat))?.key ?? ''}
            onChange={e => setRepeat(repeats.find(x => x.key === e.target.value)?.rule ?? null)}>
            {repeats.map(x => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
          {repeat && <p className="note">Day is its first one. With a start, each one goes on the calendar then; without, each waits in the backlog on its day.</p>}
        </div>
      )}
      <div className="fld">
        <label htmlFor={`${id}-n`}>Notes</label>
        <textarea id={`${id}-n`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="acts">
        <button type="submit" className="btn pri sm">Save</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** Past conversations: what you said, when, and what came of it. Ones applied since you opened the planner can be undone. */
function History() {
  const { chat, now } = usePlanner();
  const { loadHistory, history } = chat;
  const [q, setQ] = useState('');
  useEffect(() => { loadHistory(); }, [loadHistory]);
  const today = startOfDay(now).getTime(), yesterday = today - 864e5;
  const query = q.trim().toLowerCase();
  const list = (history ?? []).filter(h => !query || h.did.toLowerCase().includes(query) || h.said.some(s => s.toLowerCase().includes(query)));
  const groups = [
    { name: 'Today', items: list.filter(h => h.at >= today) },
    { name: 'Yesterday', items: list.filter(h => h.at >= yesterday && h.at < today) },
    { name: 'Earlier', items: list.filter(h => h.at < yesterday) },
  ].filter(g => g.items.length);
  return (
    <div className="hist">
      <input className="input hist-q" type="search" placeholder="Search chats" aria-label="Search chats" value={q} onChange={e => setQ(e.target.value)} />
      {!history ? <p className="note hist-e">Opening your history…</p>
        : !history.length ? <p className="note hist-e">Nothing here yet. Each conversation lands here once you apply or discard it.</p>
        : !groups.length ? <p className="note hist-e">No chats match.</p>
        : groups.map(g => (
          <div key={g.name}>
            <div className="hist-g">{g.name}</div>
            {g.items.map(h => (
              <div key={h.at} className="hist-row">
                <button type="button" className="hist-b" onClick={() => chat.openPast(h)}>
                  <span className="hist-t">{h.said[0]}</span>
                  <span className="note">{fmtWhen(h.at, now)} · {h.did}</span>
                </button>
                {chat.canUndo(h) && <button type="button" className="btn sec sm" onClick={() => chat.undoPast(h)}>Undo</button>}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

/* ---------- the bar ---------- */

const noSub = () => () => undefined;
/** The shortcut as this keyboard writes it: ⌘K on a Mac, iPhone and iPad, Ctrl K elsewhere. */
function useKeys(): string {
  return useSyncExternalStore(noSub, () => {
    const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;
    return /mac|iphone|ipad|ipod/i.test(p) ? '⌘K' : 'Ctrl K';
  }, () => '⌘K');
}

/** What the bar says while the mic is on: getting ready, listening, then finishing once you stop. */
function phaseText(phase: VoicePhase, slow: boolean, onDevice: boolean): string {
  if (phase === 'starting') return slow ? 'Waiting for the mic. Allow it if asked.' : 'Starting the mic…';
  if (phase === 'finishing') return 'Finishing…';
  return onDevice ? 'Listening · on this device' : 'Listening…';
}

/** The bar while the mic is on: bars that move with you, where it's at, and the ways out. */
function Listening({ phone, keys }: { phone?: boolean; keys: string }) {
  const { chat } = usePlanner();
  const { phase } = chat;
  // A mic that takes a while to open is usually waiting on a permission prompt.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (phase !== 'starting') return;
    const t = setTimeout(() => setSlow(true), 1200);
    return () => clearTimeout(t);
  }, [phase]);
  const text = phaseText(phase, slow, chat.onDevice);
  return (
    <div className="listen" data-phase={phase} role="status">
      <span className="bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span key={text} className="listen-t ell">{text}</span>
      {!phone && phase !== 'finishing' && phase !== 'starting' && (
        <span className="listen-k" aria-hidden="true"><span className="kbd">{keys}</span>to send</span>
      )}
      <button type="button" className="btn text sm" onClick={chat.cancelVoice} aria-keyshortcuts="Escape">
        Cancel{!phone && <span className="kbd" aria-hidden="true">esc</span>}
      </button>
    </div>
  );
}

/**
 * The chat bar: one box to dump into, a mic, and the way back to past chats. It floats at the bottom of the
 * laptop; when there's a conversation it grows upward into a panel in the same card. On a phone it rises into a sheet.
 */
export function ChatDock({ phone, inert }: { phone?: boolean; inert?: boolean }) {
  const { chat, toastState, dismissToast, split, drag } = usePlanner();
  const [tall, setTall] = useState(false);
  const keys = useKeys();
  const { input } = chat;
  const open = chat.open;
  const history = open && chat.view === 'history';

  // Grow with what you type, up to five lines.
  useLayoutEffect(() => {
    const el = input.current;
    // While the mic is on there's no box, and the bar sits at one line.
    if (!el) { setTall(false); return; }
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * 5)}px`;
    setTall(el.scrollHeight > line * 1.5);
  }, [chat.draft, input, chat.listening]);

  const submit = () => {
    if (!chat.draft.trim()) { input.current?.focus(); return; }
    chat.send(chat.draft);
  };
  const waiting = !open && (chat.busy || !!chat.plan?.changes.length);
  const dropping = !!drag.view && drag.view.kind !== 'resize';
  const count = chat.plan?.changes.filter(c => !c.skip).length ?? 0;
  const width = split.calW + split.matrixW + 38;
  const placeholder = chat.fixing ? 'Fix what you said, then send'
    : open && chat.plan ? (phone ? 'Change the plan, or add more' : 'Change something in the plan, or add more') : phone ? 'Dump a task, or ask…' : 'Dump a task, or ask for a change';

  return (
    <>
      {phone && open && <div className="scrim chat-scrim" onClick={chat.close} />}
      <div className={'dock' + (phone ? ' ph' : '') + (open ? ' open' : '') + (dropping ? ' dropping' : '')} style={phone ? undefined : { width: width >= 1100 ? 600 : width - 80 }} inert={inert}>
        {waiting && (
          <button type="button" className="waiting" onClick={chat.show}>
            <span className="nowdot" aria-hidden="true" />{chat.busy ? 'Working on your plan…' : `Your plan is waiting · ${count} change${count === 1 ? '' : 's'}`}<b>Review</b>
          </button>
        )}
        {toastState && !(phone && open) && <Toast key={toastState.key} state={toastState} onDone={dismissToast} />}
        <div className="chat">
          {open && (
            <div className="chat-panel" role="dialog" aria-label="Chat">
              {phone && <div className="grab" aria-hidden="true" />}
              <div className="chat-h">
                <span className="chat-title ell">{history ? 'History' : chat.past ? titleOf([{ id: '', role: 'you', text: chat.past.said[0], spoken: false }], phone) : titleOf(chat.msgs, phone)}</span>
                <span className="spacer" />
                {history && <button type="button" className={'btn ghost' + (phone ? ' tall' : ' sm')} onClick={chat.newChat}>New chat</button>}
                <button type="button" className={'ib bare' + (phone ? ' touch' : '')} aria-pressed={history} aria-label="History" title="History"
                  onClick={() => chat.setView(history ? 'thread' : 'history')}><HistoryIcon size={phone ? 15 : 14} /></button>
                <button type="button" className={'ib' + (phone ? ' bare touch' : '')} aria-label="Close" title="Close" onClick={chat.close}><XIcon size={phone ? 16 : 14} /></button>
              </div>
              {history ? <History /> : <Thread phone={phone} />}
            </div>
          )}
          {/* On a phone the open chat fills the sheet, so its notes (and their Undo) sit just above the bar. */}
          {toastState && phone && open && <div className="chat-toast"><Toast key={toastState.key} state={toastState} onDone={dismissToast} /></div>}
          <form className={'chat-bar' + (tall ? ' tall' : '') + (open ? ' ruled' : '')} autoComplete="off" onSubmit={e => { e.preventDefault(); submit(); }}>
            {chat.listening ? <Listening phone={phone} keys={keys} /> : (
              <>
                <ChatIcon size={phone ? 18 : 17} />
                <label className="sr" htmlFor={phone ? 'chat-ph' : 'chat-lp'}>{chat.fixing ? 'Fix what you said' : chat.plan && open ? 'Change the plan' : 'Dump a task, or ask for a change'}</label>
                <textarea id={phone ? 'chat-ph' : 'chat-lp'} ref={input} rows={1} enterKeyHint="send" placeholder={placeholder} value={chat.draft}
                  onChange={e => { chat.setDraft(e.target.value); if (!open && e.target.value) chat.show(); }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
              </>
            )}
            {/* One button from start to finish: a pill with its shortcut, then a round stop that pulses as you speak. */}
            <button type="button" className={'mic' + (chat.listening ? ' on' : '')} data-phase={chat.phase} aria-pressed={chat.listening}
              aria-keyshortcuts="Meta+K Control+K" aria-label={chat.listening ? 'Stop and send' : 'Speak'}
              title={`${chat.listening ? 'Stop and send' : 'Speak'}${phone ? '' : ` (${keys})`}`} onClick={chat.mic}>
              <span className="mic-i" aria-hidden="true"><MicIcon size={phone ? 18 : 15} /><StopIcon size={phone ? 16 : 14} /></span>
              {!phone && <span className="mic-k" aria-hidden="true">{keys}</span>}
            </button>
            {!chat.listening && chat.draft.trim() && (
              <button type="submit" className="send" aria-label="Send" disabled={chat.busy}><ArrowUpIcon size={phone ? 16 : 14} /></button>
            )}
            {!open && !chat.listening && !(phone && chat.draft.trim()) && (
              <>
                {!phone && <span className="vsep" aria-hidden="true" />}
                <button type="button" className={'ib bare' + (phone ? ' touch hist-btn' : '')} aria-label="Chat history" title="Chat history" onClick={chat.showHistory}><HistoryIcon size={phone ? 15 : 14} /></button>
              </>
            )}
          </form>
        </div>
        {dropping && <DropTray />}
      </div>
    </>
  );
}
