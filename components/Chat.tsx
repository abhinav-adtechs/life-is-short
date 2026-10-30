'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI, newId } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';
import { applyCapture, promptContext, type Via } from '@/lib/capture';
import { changesOf, changedFields, commitChanges, draftOf, kindOf, type Change, type ChangeKind } from '@/lib/plan';
import type { Label } from '@/lib/labels';
import { buildPrompt } from '@/lib/prompt';
import { sortDump } from '@/lib/api';
import { findSlot, type WorkHours } from '@/lib/place';
import { dueLabel, fmtDur, fmtWhen } from '@/lib/format';
import { dayName, describeRule, placeFirst, repeatChoices, sameRule, type Repeat, type RepeatOp, type Rule } from '@/lib/repeat';
import { atMinutes, fromYmd, pad, startOfDay, ymd } from '@/lib/time';
import { haptic } from '@/lib/native';
import { useVoice, type Heard } from './hooks';
import { usePlanner } from './Planner';
import type { Store } from './store';
import { LENGTHS, lenLabel } from './Editor';
import { LabelPicker } from './Labels';
import { ArrowUpIcon, ChatIcon, HistoryIcon, MicIcon, StopIcon, XIcon } from './icons';
import { Toast } from './Toast';
import { DropTray } from './Tray';

/* ---------- state ---------- */

export type ChatMsg =
  | { id: string; role: 'you'; text: string; spoken: boolean }
  | { id: string; role: 'ai'; kind: 'thinking' }
  | { id: string; role: 'ai'; kind: 'plan'; reply: string; note: string | null; changes: Change[] }
  | { id: string; role: 'ai'; kind: 'error'; text: string };
type PlanMsg = Extract<ChatMsg, { kind: 'plan' }>;

/** One finished conversation: what you said and what came of it. Kept in your settings, newest first. */
export interface Past { at: number; said: string[]; did: string }

const HISTORY = 'chats';
const KEEP = 30;
const DRAFT = 'ds.draft';

const lastPlan = (msgs: ChatMsg[]) => [...msgs].reverse().find((m): m is PlanMsg => m.role === 'ai' && m.kind === 'plan') ?? null;
const said = (msgs: ChatMsg[]) => msgs.flatMap(m => (m.role === 'you' ? [m.text] : []));

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
export function useChat({ store, repo, liveTasks, busyTasks, hours, toast, labels, labelId, repeats }: {
  store: Store; repo: TaskRepo; liveTasks: () => Task[]; busyTasks: () => Task[]; hours: WorkHours; toast: (msg: string, undo?: () => void) => void;
  /** Your labels, and the label a task counts as (a Google event takes its calendar's). */
  labels: Label[]; labelId: (t: Task) => string | null;
  /** Your repeats, the one a task is one of, and how to change them. */
  repeats: { list: Repeat[]; repeatOf: (t: Task) => Repeat | null; apply: (ops: RepeatOp[]) => () => void };
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

  const setDraft = useCallback((v: string) => {
    setDraftState(v);
    try { if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { /* draft is a nicety */ }
  }, []);
  useEffect(() => { try { const d = localStorage.getItem(DRAFT); if (d) setDraftState(d); } catch { /* none */ } }, []);

  const focusInput = useCallback(() => { setTimeout(() => input.current?.focus(), 0); }, []);

  const send = useCallback(async (raw: string, spoken = false) => {
    const text = raw.trim();
    if (!text) return;
    // One question at a time: words that arrive mid-answer wait in the box.
    if (busyRef.current) { setDraft(text); return; }
    setOpen(true);
    setView('thread');
    if (past) { setPast(null); setMsgs(() => []); }
    setDraft('');
    const t0 = thread.current;
    const prior = msgsRef.current;
    const plan = lastPlan(prior);
    const earlier = said(prior);
    const waitId = newId();
    setMsgs(m => [...m, { id: newId(), role: 'you', text, spoken }, { id: waitId, role: 'ai', kind: 'thinking' }]);
    busyRef.current = true;
    setBusy(true);
    let msg: ChatMsg;
    try {
      const tasks = liveTasks();
      // Slotting goes around the repeating tasks still to come, too.
      const busy = busyTasks();
      const ruleOf = (id: string) => { const t = store.get(id); return (t && repeats.repeatOf(t)?.rule) ?? null; };
      const { refs, ctx } = promptContext(tasks, labelId, repeats.repeatOf);
      const live = plan ? plan.changes.filter(c => !c.skip) : [];
      const refOf = new Map([...refs].map(([ref, id]) => [id, ref]));
      const convo = plan ? { earlier, draft: draftOf(live, refOf) } : undefined;
      const { result, via } = await sortDump(buildPrompt(text, Date.now(), ctx, hours, labels, convo));
      if (thread.current !== t0) return;
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
      msg = { id: waitId, role: 'ai', kind: 'plan', reply, note: NOTES[how] ?? null, changes };
    } catch {
      if (thread.current !== t0) return;
      msg = { id: waitId, role: 'ai', kind: 'error', text: 'Something went wrong there. Try saying it again.' };
    } finally {
      if (thread.current === t0) { busyRef.current = false; setBusy(false); }
    }
    setMsgs(m => m.map(x => (x.id === waitId ? msg : x)));
  }, [liveTasks, busyTasks, store, repeats, hours, labels, labelId, setDraft, setMsgs, past]);

  const voice = useVoice({
    onHeard: setHeard,
    onFinish: text => { setHeard(null); if (text.trim()) send(text, true); },
    onCutOff: text => {
      setHeard(null);
      if (!text.trim()) return;
      setDraft(text);
      toast('Stopped listening. What you said is in the box.');
    },
    onUnsupported: () => {
      setHeard(null);
      focusInput();
      toast(window.matchMedia('(pointer: coarse)').matches
        ? 'Tap the mic on your keyboard and talk. It types straight into this box.'
        : 'This browser can’t take dictation. Type it here instead.');
    },
  });

  const mic = useCallback(() => {
    if (voice.listening) { voice.finishVoice(); return; }
    setOpen(true);
    setView('thread');
    voice.startVoice(draft);
  }, [voice, draft]);

  /** Drop the recording, with Undo putting the words in the box. */
  const cancelVoice = useCallback(() => {
    const words = [heard?.text, heard?.interim].filter(Boolean).join(' ').trim();
    voice.stopVoice();
    setHeard(null);
    if (words) toast('Recording discarded', () => setDraft(words));
  }, [voice, heard, toast, setDraft]);

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
    voice.stopVoice();
    setHeard(null);
    setMsgs(() => []);
    busyRef.current = false;
    setBusy(false);
  }, [voice, setMsgs]);

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
    reset();
    setOpen(false);
  }, [store, toast, remember, reset, labels, repeats]);

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
    const last = [...msgsRef.current].reverse().find((m): m is Extract<ChatMsg, { role: 'you' }> => m.role === 'you');
    if (last?.spoken && voice.supported() && !voice.listening) { voice.startVoice(draft); return; }
    focusInput();
  }, [voice, draft, focusInput]);

  const close = useCallback(() => {
    if (voice.listening) {
      const words = [heard?.text, heard?.interim].filter(Boolean).join(' ').trim();
      voice.stopVoice();
      setHeard(null);
      if (words) setDraft(words);
    }
    setOpen(false);
    setPast(null);
  }, [voice, heard, setDraft]);

  /** ⌘K: open the chat and put the cursor in the box. */
  const focus = useCallback(() => { setOpen(true); focusInput(); }, [focusInput]);
  const showHistory = useCallback(() => { setOpen(true); setView('history'); }, []);

  const updatePlan = useCallback((fn: (c: Change) => Change) => {
    setMsgs(m => {
      const plan = lastPlan(m);
      return plan ? m.map(x => (x === plan ? { ...plan, changes: plan.changes.map(fn) } : x)) : m;
    });
  }, [setMsgs]);
  /** Change a proposed change; `repeat` (when given) is how a new task repeats, or null for not at all. */
  const edit = useCallback((id: string, patch: Partial<Task>, repeat?: Rule | null) => updatePlan(c => (
    c.id === id ? { ...c, after: { ...c.after, ...patch }, ...(repeat !== undefined ? { repeat } : {}) } : c
  )), [updatePlan]);
  const toggle = useCallback((id: string) => updatePlan(c => (c.id === id ? { ...c, skip: !c.skip } : c)), [updatePlan]);

  const loadHistory = useCallback(() => {
    repo.getSetting(HISTORY).then(v => setHistory(readHistory(v))).catch(() => setHistory(h => h ?? []));
  }, [repo]);

  const plan = lastPlan(msgs);
  /** Tasks as the open plan would leave them, for the calendar to show. */
  const preview = useMemo(() => {
    const m = new Map<string, Task>();
    if (plan) for (const c of plan.changes) if (!c.skip) m.set(c.id, c.after);
    return m;
  }, [plan]);

  return {
    open, show: () => { setOpen(true); setView('thread'); }, close, focus, msgs, busy, plan, preview,
    draft, setDraft, input, heard, listening: voice.listening, onDevice: voice.onDevice,
    send, mic, cancelVoice, accept, discard, modify, edit, toggle, history, loadHistory,
    view, setView, showHistory, past, openPast, newChat, undoPast, canUndo,
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
          if (m.role === 'you') return <div key={m.id} className="you">{m.spoken && <MicIcon size={13} />}<p>{m.text}</p></div>;
          if (m.kind === 'thinking') return <div key={m.id} className="ai"><p className="think" aria-label="Working it out"><i /><i /><i /></p></div>;
          if (m.kind === 'error') return <div key={m.id} className="ai"><p>{m.text}</p></div>;
          return <PlanCard key={m.id} m={m} live={m === plan} phone={phone} />;
        })}
        {heard && (
          <div className="you live" aria-live="off">
            <MicIcon size={13} />
            <p>{heard.text}{heard.interim && <span> {heard.interim}</span>}{!heard.text && !heard.interim && <span>Listening…</span>}</p>
          </div>
        )}
      </div>
    </div>
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

/**
 * The chat bar: one box to dump into, a mic, and the way back to past chats. It floats at the bottom of the
 * laptop; when there's a conversation it grows upward into a panel in the same card. On a phone it rises into a sheet.
 */
export function ChatDock({ phone, inert }: { phone?: boolean; inert?: boolean }) {
  const { chat, toastState, dismissToast, split, drag } = usePlanner();
  const [tall, setTall] = useState(false);
  const { input } = chat;
  const open = chat.open;
  const history = open && chat.view === 'history';

  // Grow with what you type, up to five lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
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
  const placeholder = open && chat.plan ? (phone ? 'Change the plan, or add more' : 'Change something in the plan, or add more') : phone ? 'Dump a task, or ask…' : 'Dump a task, or ask for a change';

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
          <form className={'chat-bar' + (tall ? ' tall' : '') + (open ? ' ruled' : '')} autoComplete="off" onSubmit={e => { e.preventDefault(); submit(); }}>
            {chat.listening ? (
              <div className="listen" role="status">
                <span className="bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <span className="ell">Listening{chat.onDevice ? ' · on this device' : '…'}</span>
                <button type="button" className="btn text sm" onClick={chat.cancelVoice}>Cancel</button>
              </div>
            ) : (
              <>
                <ChatIcon size={phone ? 18 : 17} />
                <label className="sr" htmlFor={phone ? 'chat-ph' : 'chat-lp'}>{chat.plan && open ? 'Change the plan' : 'Dump a task, or ask for a change'}</label>
                <textarea id={phone ? 'chat-ph' : 'chat-lp'} ref={input} rows={1} enterKeyHint="send" placeholder={placeholder} value={chat.draft}
                  onChange={e => { chat.setDraft(e.target.value); if (!open && e.target.value) chat.show(); }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
                {!phone && <span className="kbd">{open ? 'esc' : '⌘K'}</span>}
              </>
            )}
            <button type="button" className={'mic' + (chat.listening ? ' on' : '')} aria-pressed={chat.listening}
              aria-label={chat.listening ? 'Stop and send' : 'Speak'} title={chat.listening ? 'Stop and send' : 'Speak'} onClick={chat.mic}>
              {chat.listening ? <StopIcon size={phone ? 16 : 14} /> : <MicIcon size={phone ? 18 : 15} />}
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
