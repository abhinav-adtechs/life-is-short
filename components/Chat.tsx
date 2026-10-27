'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI, newId } from '@/lib/model';
import type { TaskRepo } from '@/lib/repo/types';
import { applyCapture, promptContext, type Via } from '@/lib/capture';
import { changesOf, changedFields, commitChanges, draftOf, kindOf, type Change, type ChangeKind } from '@/lib/plan';
import { buildPrompt } from '@/lib/prompt';
import { sortDump } from '@/lib/api';
import { findSlot, type WorkHours } from '@/lib/place';
import { dueLabel, fmtDur, fmtWhen } from '@/lib/format';
import { atMinutes, fromYmd, pad, startOfDay, ymd } from '@/lib/time';
import { prefersReducedMotion, useVoice, type Heard } from './hooks';
import { usePlanner } from './Planner';
import type { Store } from './store';
import { LENGTHS, lenLabel } from './Editor';
import { ArrowUpIcon, BackIcon, CalendarIcon, CheckIcon, HistoryIcon, MicIcon, StopIcon, XIcon } from './icons';

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
export function useChat({ store, repo, liveTasks, hours, toast }: {
  store: Store; repo: TaskRepo; liveTasks: () => Task[]; hours: WorkHours; toast: (msg: string, undo?: () => void) => void;
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
      const { refs, ctx } = promptContext(tasks);
      const live = plan ? plan.changes.filter(c => !c.skip) : [];
      const refOf = new Map([...refs].map(([ref, id]) => [id, ref]));
      const convo = plan ? { earlier, draft: draftOf(live, refOf) } : undefined;
      const { result, via } = await sortDump(buildPrompt(text, Date.now(), ctx, hours, convo));
      if (thread.current !== t0) return;
      let changes: Change[];
      let how: Via = via;
      if (plan && via !== 'ai') {
        // No model to revise the plan: keep it, and add whatever the keywords find in what you just said.
        const view = new Map(tasks.map(x => [x.id, x]));
        for (const c of live) view.set(c.id, c.after);
        changes = [...live, ...changesOf(applyCapture({ text, tasks: [...view.values()], refs: new Map(), result: null, via, hours }))];
      } else {
        const out = applyCapture({ text: [...earlier, text].join('\n'), tasks, refs, result, via, hours, revise: !!plan });
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
  }, [liveTasks, hours, setDraft, setMsgs]);

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
    voice.startVoice(draft);
  }, [voice, draft]);

  /** Drop the recording, with Undo putting the words in the box. */
  const cancelVoice = useCallback(() => {
    const words = [heard?.text, heard?.interim].filter(Boolean).join(' ').trim();
    voice.stopVoice();
    setHeard(null);
    if (words) toast('Recording discarded', () => setDraft(words));
  }, [voice, heard, toast, setDraft]);

  const remember = useCallback((list: string[], did: string) => {
    if (!list.length) return;
    const entry: Past = { at: Date.now(), said: list.map(s => s.slice(0, 1000)), did };
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
    const { puts, summary } = commitChanges(plan.changes, store.get);
    if (!puts.length) { toast('Nothing left to change. Edit the plan or discard it.'); return; }
    const before = store.write(puts);
    toast(summary, () => store.restore(before));
    remember(said(msgsRef.current), summary);
    reset();
    setOpen(false);
  }, [store, toast, remember, reset]);

  const discard = useCallback(() => {
    remember(said(msgsRef.current), 'Discarded');
    reset();
    setOpen(false);
  }, [remember, reset]);

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
  }, [voice, heard, setDraft]);

  const updatePlan = useCallback((fn: (c: Change) => Change) => {
    setMsgs(m => {
      const plan = lastPlan(m);
      return plan ? m.map(x => (x === plan ? { ...plan, changes: plan.changes.map(fn) } : x)) : m;
    });
  }, [setMsgs]);
  const edit = useCallback((id: string, patch: Partial<Task>) => updatePlan(c => (c.id === id ? { ...c, after: { ...c.after, ...patch } } : c)), [updatePlan]);
  const toggle = useCallback((id: string) => updatePlan(c => (c.id === id ? { ...c, skip: !c.skip } : c)), [updatePlan]);

  const loadHistory = useCallback(() => {
    repo.getSetting(HISTORY).then(v => setHistory(readHistory(v))).catch(() => setHistory(h => h ?? []));
  }, [repo]);

  const plan = lastPlan(msgs);
  /** Tasks as the open plan would leave them, for the calendar to show. */
  const preview = useMemo(() => {
    const m = new Map<string, Task>();
    if (open && plan) for (const c of plan.changes) if (!c.skip) m.set(c.id, c.after);
    return m;
  }, [open, plan]);

  return {
    open, show: () => setOpen(true), close, msgs, busy, plan, preview,
    draft, setDraft, input, heard, listening: voice.listening, onDevice: voice.onDevice,
    send, mic, cancelVoice, accept, discard, modify, edit, toggle, history, loadHistory,
  };
}

export type Chat = ReturnType<typeof useChat>;

/* ---------- the conversation ---------- */

/** Follow the conversation as it grows. A plan too tall to see at once shows from its top, where it starts. */
function useFollow(dep: unknown) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tail = end.current, box = tail?.parentElement;
    if (!tail || !box) return;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    const last = box.querySelector<HTMLElement>('[role="log"] > :last-child');
    // The laptop's thread scrolls by itself; the phone's scrolls the page, under the header and the dump bar.
    const room = box.scrollHeight > box.clientHeight ? box.clientHeight : window.innerHeight - 180;
    if (last && last.offsetHeight > room) last.scrollIntoView({ block: 'start', behavior });
    else tail.scrollIntoView({ block: 'end', behavior });
  }, [dep]);
  return end;
}

export function ChatPanel({ phone }: { phone?: boolean }) {
  const { chat } = usePlanner();
  const [past, setPast] = useState(false);
  const live = chat.heard ? `${chat.heard.text} ${chat.heard.interim}` : '';
  const last = chat.msgs.at(-1);
  // A new message, an answer replacing the dots, words coming in: not edits to the cards.
  const end = useFollow(`${chat.msgs.length}:${last && 'kind' in last ? last.kind : last?.role}:${live.length}:${past}`);
  return (
    <section className={'chat in' + (phone ? ' phone' : '')} aria-label="Dump">
      <header className="chd">
        {phone && <button type="button" className="ib" aria-label="Close" onClick={past ? () => setPast(false) : chat.close}><BackIcon /></button>}
        <h2>{past ? 'History' : chat.plan ? 'Review' : 'Dump'}</h2>
        <div className="tools">
          {!past && <button type="button" className="ib quiet" aria-label="History" title="Past conversations" onClick={() => setPast(true)}><HistoryIcon /></button>}
          {past && !phone && <button type="button" className="txt" onClick={() => setPast(false)}>Back</button>}
          {!phone && <button type="button" className="ib quiet" aria-label="Close" onClick={chat.close}><XIcon size={16} /></button>}
        </div>
      </header>
      <div className="thread">
        {past ? <History /> : <Thread />}
        <div className="tail" ref={end} />
      </div>
    </section>
  );
}

function Thread() {
  const { chat } = usePlanner();
  const { msgs, heard, plan } = chat;
  return (
    <div role="log" aria-label="Conversation" aria-live="polite">
      {!msgs.length && !heard && (
        <p className="intro">Say or type what’s on your mind. I’ll show you what I’ll add or change, and nothing happens until you accept.</p>
      )}
      {msgs.map(m => {
        if (m.role === 'you') {
          return <div key={m.id} className="you">{m.spoken && <MicIcon size={13} />}<p>{m.text}</p></div>;
        }
        if (m.kind === 'thinking') {
          return <div key={m.id} className="ai"><p className="think" aria-label="Working it out"><i /><i /><i /></p></div>;
        }
        if (m.kind === 'error') return <div key={m.id} className="ai"><p className="say">{m.text}</p></div>;
        return <Plan key={m.id} m={m} live={m === plan} />;
      })}
      {heard && (
        <div className="you live" aria-live="off">
          <MicIcon size={13} />
          <p>{heard.text}{heard.interim && <span> {heard.interim}</span>}{!heard.text && !heard.interim && <span>Listening…</span>}</p>
        </div>
      )}
    </div>
  );
}

function Plan({ m, live }: { m: PlanMsg; live: boolean }) {
  const { chat } = usePlanner();
  const kept = m.changes.filter(c => !c.skip).length;
  if (!live) {
    return (
      <div className="ai old">
        <p className="say">{m.reply}</p>
        {m.changes.length > 0 && <p className="aside">Earlier draft · {m.changes.length} change{m.changes.length === 1 ? '' : 's'}</p>}
      </div>
    );
  }
  return (
    <div className="ai">
      <p className="say">{m.reply}</p>
      {m.note && <p className="aside">{m.note}</p>}
      {m.changes.length > 0 && (
        <ul className="cards">{m.changes.map(c => <Card key={c.id} c={c} />)}</ul>
      )}
      <div className="plact">
        {m.changes.length > 0 && (
          <>
            <button type="button" className="btn pri" disabled={!kept || chat.busy} onClick={chat.accept}>
              {kept === m.changes.length ? 'Accept' : `Accept ${kept}`}
            </button>
            <button type="button" className="btn sec" disabled={chat.busy} onClick={chat.modify}>Modify</button>
          </>
        )}
        <button type="button" className="link" onClick={chat.discard}>{m.changes.length ? 'Discard' : 'Start over'}</button>
      </div>
    </div>
  );
}

const TAG: Record<ChangeKind, string> = { add: 'New', done: 'Tick off', move: 'Move', edit: 'Change' };

/** "Tomorrow, 9:00 AM", or where it waits when it has no time. */
const whenText = (t: Pick<Task, 'start'>, now: number) => (t.start != null ? fmtWhen(t.start, now) : 'Backlog');

/** The line of facts under a card's title: everything about a new task, only what changes for an existing one. */
function facts(c: Change, now: number): { key: string; from?: string; to: string; hot?: boolean; cal?: boolean }[] {
  const a = c.after;
  if (!c.before) {
    return [
      { key: 'when', to: whenText(a, now), cal: true },
      { key: 'len', to: fmtDur(a.minutes) },
      { key: 'pri', to: PRI[a.priority], hot: a.priority === 1 },
      ...(a.due ? [{ key: 'due', to: dueLabel(a.due, now).text, hot: dueLabel(a.due, now).hot }] : []),
    ];
  }
  const b = c.before;
  const out: ReturnType<typeof facts> = [];
  for (const f of changedFields(b, a)) {
    if (f === 'start') out.push({ key: f, from: whenText(b, now), to: whenText(a, now), cal: true });
    if (f === 'priority') out.push({ key: f, from: PRI[b.priority], to: PRI[a.priority], hot: a.priority === 1 });
    if (f === 'minutes') out.push({ key: f, from: fmtDur(b.minutes), to: fmtDur(a.minutes) });
    if (f === 'due') out.push({ key: f, to: a.due ? dueLabel(a.due, now).text : 'No due date' });
    if (f === 'title') out.push({ key: f, to: `Was “${b.title}”` });
  }
  if (!out.length && kindOf(c) === 'done' && b.start != null) out.push({ key: 'when', to: whenText(b, now), cal: true });
  return out;
}

function Card({ c }: { c: Change }) {
  const { chat, now } = usePlanner();
  const [editing, setEditing] = useState(false);
  const kind = kindOf(c);
  const t = c.after;
  if (c.skip) {
    return (
      <li className="card skip">
        <span className="ct">{t.title}</span>
        <button type="button" className="txt" onClick={() => chat.toggle(c.id)}>Put back</button>
      </li>
    );
  }
  if (editing) return <li className="card editing"><CardEditor c={c} onDone={() => setEditing(false)} /></li>;
  const newNote = c.before ? (t.notes !== c.before.notes && t.notes.startsWith(c.before.notes) ? t.notes.slice(c.before.notes.length).trim() : t.notes !== c.before.notes ? t.notes : '') : t.notes;
  return (
    <li className={'card k-' + kind}>
      <button type="button" className="cbody" disabled={kind === 'done'} aria-label={kind === 'done' ? undefined : `${TAG[kind]}: ${t.title}. Edit`}
        onClick={() => setEditing(true)}>
        <span className="tag">{kind === 'done' && <CheckIcon size={9} />}{TAG[kind]}</span>
        <span className="ct">{t.title}</span>
        <span className="cm">
          {facts(c, now).map(f => (
            <span key={f.key} className={f.hot ? 'hot' : undefined}>
              {f.cal && <CalendarIcon size={12} />}
              {f.from != null && <><s>{f.from}</s> → </>}{f.to}
            </span>
          ))}
        </span>
        {newNote && <span className="cn">{newNote}</span>}
      </button>
      <button type="button" className="cx" aria-label={`Leave out: ${t.title}`} title="Leave out" onClick={() => chat.toggle(c.id)}><XIcon size={13} /></button>
    </li>
  );
}

/** Edit one change in place. Day and Start work like the task editor's: a day alone takes that day's first free slot. */
function CardEditor({ c, onDone }: { c: Change; onDone: () => void }) {
  const { chat, liveTasks, hours } = usePlanner();
  const t = c.after;
  const id = useId();
  const [title, setTitle] = useState(t.title);
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [date, setDate] = useState(t.start != null ? ymd(t.start) : '');
  const [time, setTime] = useState(t.start != null ? `${pad(new Date(t.start).getHours())}:${pad(new Date(t.start).getMinutes())}` : '');
  const [minutes, setMinutes] = useState(t.minutes);
  const [due, setDue] = useState(t.due || '');
  const [notes, setNotes] = useState(t.notes || '');
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
    let start: number | null = null;
    if (date || time) {
      const day = date ? fromYmd(date) : startOfDay(Date.now());
      if (time) { const [h, m] = time.split(':').map(Number); start = atMinutes(day, h * 60 + m); }
      else if (t.start != null && ymd(t.start) === ymd(day)) start = t.start;
      else {
        // Around your calendar and the rest of this plan.
        const others = [...liveTasks().filter(x => !chat.preview.has(x.id)), ...chat.preview.values()];
        start = findSlot(others, minutes, { onDate: day, sameDay: true, exclude: t.id, hours }) ?? atMinutes(day, hours.start);
      }
    }
    chat.edit(c.id, { title: title.replace(/\s+/g, ' ').trim().slice(0, 160) || t.title, priority, minutes, start, due: due || null, notes: notes.trim() });
    onDone();
  };
  const lengths = LENGTHS.includes(minutes) ? LENGTHS : [...LENGTHS, minutes].sort((a, b) => a - b);

  return (
    <form className="ced" onSubmit={save} autoComplete="off"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); } }}>
      <div className="fld" style={{ marginTop: 0 }}>
        <label htmlFor={`${id}-t`} className="sr">Task</label>
        <textarea ref={first} id={`${id}-t`} className="title" rows={2} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } }} />
      </div>
      <div className="fld">
        <span className="flabel" id={`${id}-p`}>Priority</span>
        <div className="seg full" role="radiogroup" aria-labelledby={`${id}-p`}>
          {([1, 2, 3] as Priority[]).map(p => (
            <button key={p} type="button" role="radio" aria-checked={priority === p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}>{PRI[p]}</button>
          ))}
        </div>
      </div>
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
        <div className="fld"><label htmlFor={`${id}-u`}>Due by</label><input id={`${id}-u`} type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
      </div>
      <div className="fld">
        <label htmlFor={`${id}-n`}>Notes</label>
        <textarea id={`${id}-n`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="sacts">
        <button type="submit" className="btn pri">Save</button>
        <button type="button" className="btn sec" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function History() {
  const { chat, now } = usePlanner();
  const { loadHistory, history } = chat;
  useEffect(() => { loadHistory(); }, [loadHistory]);
  if (!history) return <p className="intro">Opening your history…</p>;
  if (!history.length) return <p className="intro">Nothing here yet. Each conversation lands here once you accept or discard it.</p>;
  return (
    <ol className="hist">
      {history.map(h => (
        <li key={h.at}>
          <div className="hw">{fmtWhen(h.at, now)}</div>
          <div className={'hd' + (h.did === 'Discarded' ? ' quiet' : '')}>{h.did}</div>
          {h.said.map((s, i) => <p key={i}>{s}</p>)}
        </li>
      ))}
    </ol>
  );
}

/* ---------- the box you dump into ---------- */

/** Text box and mic. Closed, it's the dump bar; with the conversation open, it's where you answer. */
export function Composer({ phone }: { phone?: boolean }) {
  const { chat } = usePlanner();
  const [tall, setTall] = useState(false);
  const id = phone ? 'dump-ph' : 'dump-lp';
  const { input } = chat;

  // Grow with what you type, up to six lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, line * 6)}px`;
    setTall(el.scrollHeight > line * 1.5);
  }, [chat.draft, input, chat.listening]);

  const submit = () => {
    if (!chat.draft.trim()) { input.current?.focus(); return; }
    chat.send(chat.draft);
  };
  const waiting = !chat.open && (chat.busy || !!chat.plan?.changes.length);
  const count = chat.plan?.changes.filter(c => !c.skip).length ?? 0;
  const placeholder = chat.plan && chat.open ? 'Say what to change…' : 'Dump a task…';

  return (
    <>
      {waiting && (
        <button type="button" className="waiting in" onClick={chat.show}>
          <i aria-hidden="true" />{chat.busy ? 'Working on your plan…' : `Your plan is waiting · ${count} change${count === 1 ? '' : 's'}`}<b>Review</b>
        </button>
      )}
      <form className="cap" autoComplete="off" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className={'field' + (tall ? ' tall' : '') + (chat.listening ? ' live' : '')}>
          {chat.listening ? (
            <div className="listen" role="status">
              <span className="bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              <span className="lt">Listening{chat.onDevice ? ' · on this device' : '…'}</span>
              <button type="button" className="txt" onClick={chat.cancelVoice}>Cancel</button>
            </div>
          ) : (
            <>
              <label className="sr" htmlFor={id}>{chat.plan && chat.open ? 'Change the plan' : 'Dump a task'}</label>
              <textarea id={id} ref={input} rows={1} enterKeyHint="send" placeholder={placeholder} value={chat.draft}
                onChange={e => chat.setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
              {chat.draft.trim() && (
                <button type="submit" className="send" aria-label="Send" disabled={chat.busy}><ArrowUpIcon /></button>
              )}
            </>
          )}
        </div>
        <button type="button" className={'mic' + (chat.listening ? ' on' : '')} aria-pressed={chat.listening}
          aria-label={chat.listening ? 'Stop and review' : 'Speak'} onClick={chat.mic}>
          {chat.listening ? <StopIcon size={phone ? 18 : 16} /> : <MicIcon size={phone ? 22 : 20} />}
        </button>
      </form>
    </>
  );
}
