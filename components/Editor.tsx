'use client';

import { useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { PRI } from '@/lib/model';
import { findSlot } from '@/lib/place';
import { fmtDur, fmtWhen, shortDate, shortTitle } from '@/lib/format';
import { gcalUrl } from '@/lib/links';
import { addDays, fromYmd, startOfDay, ymd } from '@/lib/time';
import { describeRepeat, makeRepeating, sameRule, timeOf, type RepeatOp, type Rule } from '@/lib/repeat';
import { usePlanner } from './Planner';
import { RepeatField } from './Repeating';

export const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480];
export const lenLabel = (m: number) => (m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`);
/** The lengths offered as chips; the rest are under Other. */
const QUICK = [15, 30, 45, 60, 120, 240];

/** Due-date shortcuts: today, tomorrow, the coming Friday and next Monday. */
function dueChoices(now: number) {
  const today = startOfDay(now);
  const fri = addDays(today, ((5 - today.getDay() + 7) % 7) || 7);
  const mon = addDays(today, ((1 - today.getDay() + 7) % 7) || 7);
  return [
    { v: null as string | null, name: 'No date' },
    { v: ymd(today), name: 'Today' },
    { v: ymd(addDays(today, 1)), name: 'Tomorrow' },
    ...(fri.getTime() !== addDays(today, 1).getTime() ? [{ v: ymd(fri), name: 'Friday' }] : []),
    ...(mon.getTime() !== addDays(today, 1).getTime() ? [{ v: ymd(mon), name: 'Next Monday' }] : []),
  ];
}

/**
 * Edit one task: everything about it, where it sits on the calendar, and how it repeats. Changes save with Save;
 * nothing else waits on it. On one of a repeat's tasks, what the task is goes to the ones to come too.
 */
export function Editor({ task: t, onClose }: { task: Task; onClose: () => void }) {
  const { store, wide, now, toast, undoable, hours, sourceOf, busyTasks, prefs, labelOf, schedule, repeatOf, applyRepeats, deletedText } = usePlanner();
  const repeat = repeatOf(t);
  const [title, setTitle] = useState(t.title);
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [minutes, setMinutes] = useState(t.minutes);
  const [due, setDue] = useState<string | null>(t.due || null);
  const [notes, setNotes] = useState(t.notes || '');
  const [label, setLabel] = useState<string | null>(t.label ?? null);
  const [rule, setRule] = useState<Rule | null>(repeat?.rule ?? null);
  const [time, setTime] = useState(repeat?.time ?? (t.start != null ? timeOf(t.start) : ''));
  const [armedDelete, setArmedDelete] = useState(false);

  const values = () => ({
    title: title.replace(/\s+/g, ' ').trim().slice(0, 160) || t.title,
    priority, minutes, due, notes: notes.trim(), label,
  });

  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = values(), at = time || null, name = shortTitle(v.title, 30);
    if (rule && !repeat) {
      // Its id becomes the repeat's, so it's written anew.
      const m = makeRepeating({ ...t, ...v }, rule, at, Date.now());
      const unrepeat = applyRepeats([{ kind: 'set', repeat: m.repeat }]);
      const before = new Map([...store.remove(m.removes), ...store.write([m.task])]);
      onClose();
      undoable(`${describeRepeat(m.repeat)} · ${name}`, before, unrepeat);
      return;
    }
    const ops: RepeatOp[] = !repeat ? []
      : !rule ? [{ kind: 'stop', id: repeat.id }]
      : sameRule(rule, repeat.rule) && at === repeat.time ? []
      : [{ kind: 'set', repeat: { ...repeat, title: v.title, notes: v.notes, priority: v.priority, minutes: v.minutes, label: v.label, rule, time: at, updatedAt: Date.now() } }];
    // The repeat first, so the write below finds it as it now is.
    const unrepeat = applyRepeats(ops);
    const before = store.write([{ ...t, ...v }]);
    onClose();
    undoable(ops[0]?.kind === 'stop' ? `Stopped repeating · ${name}` : `Saved · ${name}`, before, ops.length ? unrepeat : undefined);
  };

  const nextSlot = () => {
    const v = values();
    const s = findSlot(busyTasks(), v.minutes, { exclude: t.id, hours });
    if (s == null) { toast('No free slot in the next two weeks.'); return; }
    const before = store.write([{ ...t, ...v, start: s }]);
    onClose();
    undoable(`Slotted for ${fmtWhen(s)}`, before);
  };

  const toBacklog = () => {
    const before = store.write([{ ...t, ...values(), start: null }]);
    onClose();
    undoable('Removed from the calendar', before);
  };

  const toggleDone = () => {
    const isDone = t.status !== 'done';
    const before = store.write([{ ...t, ...values(), status: isDone ? 'done' : 'open', doneAt: isDone ? Date.now() : null }]);
    onClose();
    undoable(isDone ? `Done · ${shortTitle(t.title, 34)}` : 'Back on the list', before);
  };

  const remove = () => {
    if (!armedDelete) { setArmedDelete(true); return; }
    const before = store.remove([t.id]);
    onClose();
    undoable(deletedText(t), before);
  };

  const pickTime = () => {
    store.write([{ ...t, ...values() }]);
    schedule(t.id);
  };

  const lengths = QUICK.includes(minutes) ? QUICK : [...QUICK, minutes].sort((a, b) => a - b);
  let dues = dueChoices(now);
  if (due && !dues.some(d => d.v === due)) dues = [dues[0], { v: due, name: (due < ymd(now) ? 'Was ' : '') + shortDate(fromYmd(due).getTime(), now) }, ...dues.slice(1)];
  const raw = (t.raw || '').trim();
  const src = sourceOf(t);
  // What a Google event gets from its calendar when it has no label of its own.
  const inherited = src ? labelOf({ ...t, label: null }) : null;
  const labels = [...prefs.labels.map(l => ({ id: l.id as string | null, name: l.name, color: l.color as string | null })), { id: null, name: inherited ? `From calendar: ${inherited.name}` : 'No label', color: inherited?.color ?? null }];
  const cur = prefs.labels.some(l => l.id === label) ? label : null;

  return (
    <form className="ed" onSubmit={save} autoComplete="off">
      <div className="side-b">
        <div className="ed-body">
          <div>
            <label htmlFor="ed-title" className="sr">Task</label>
            <textarea id="ed-title" className="ed-title" rows={2} value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } }} />
            {raw && raw !== t.title && <p className="note">From chat: “{raw}”</p>}
          </div>

          <div className="ed-f">
            <span className="flabel" id="ed-pri">Priority</span>
            <div className="seg fill" role="radiogroup" aria-labelledby="ed-pri">
              {([1, 2, 3] as Priority[]).map(p => (
                <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => setPriority(p)}>{PRI[p]}</button>
              ))}
            </div>
          </div>

          <div className="ed-f">
            <span className="flabel" id="ed-lab">Label</span>
            <div className="chips" role="radiogroup" aria-labelledby="ed-lab">
              {labels.map(l => (
                <button key={l.id ?? '-'} type="button" role="radio" aria-checked={cur === l.id} className="chipb" onClick={() => setLabel(l.id)}>
                  <span className={'dot' + (l.color ? '' : ' none')} style={l.color ? ({ '--c': l.color } as React.CSSProperties) : undefined} />{l.name}
                </button>
              ))}
            </div>
          </div>

          <div className="ed-f">
            <span className="flabel" id="ed-len">Length</span>
            <div className="chips" role="radiogroup" aria-labelledby="ed-len">
              {lengths.map(m => <button key={m} type="button" role="radio" aria-checked={minutes === m} className="chipb num" onClick={() => setMinutes(m)}>{fmtDur(m)}</button>)}
              <label className="chipb sel">
                <span className="sr">Other length</span>
                <select value={QUICK.includes(minutes) ? '' : minutes} onChange={e => { if (e.target.value) setMinutes(Number(e.target.value)); }}>
                  <option value="">Other…</option>
                  {LENGTHS.filter(m => !QUICK.includes(m)).map(m => <option key={m} value={m}>{lenLabel(m)}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="ed-f">
            <span className="flabel" id="ed-due">Due</span>
            <div className="chips" role="radiogroup" aria-labelledby="ed-due">
              {dues.map(d => <button key={d.v ?? '-'} type="button" role="radio" aria-checked={due === d.v} className="chipb" onClick={() => setDue(d.v)}>{d.name}</button>)}
              <label className="chipb sel" title="Pick a date">
                <span>Pick a date</span>
                <input type="date" aria-label="Due date" value={due ?? ''} onChange={e => setDue(e.target.value || null)}
                  onClick={e => { try { e.currentTarget.showPicker(); } catch { /* the browser opens its own */ } }} />
              </label>
            </div>
          </div>

          {!src && (
            <RepeatField rule={rule} time={time} day={t.start != null ? ymd(t.start) : t.due ?? ymd(now)} repeating={!!repeat}
              onRule={setRule} onTime={setTime} />
          )}

          <div className="ed-f">
            <span className="flabel">Calendar</span>
            <div className="ed-cal">
              <span className={t.start != null ? undefined : 'muted'}>{t.start != null ? `${fmtWhen(t.start, now)} · ${fmtDur(t.minutes)}` : 'Not on the calendar'}</span>
              <span className="spacer" />
              {t.start != null && <button type="button" className="btn text" onClick={toBacklog}>Remove</button>}
              <button type="button" className="btn sec" onClick={pickTime}>{t.start != null ? 'Move' : 'Pick a time'}</button>
            </div>
            {t.status === 'open' && <button type="button" className="link ed-slot" onClick={nextSlot}>Next free slot</button>}
          </div>

          <div className="ed-f">
            <label className="flabel" htmlFor="ed-notes">Notes</label>
            <textarea id="ed-notes" className="input" rows={3} placeholder="Anything you’ll want to know when you start" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="ed-foot">
            {src && (
              <p className="note"><span className="dot" style={{ '--c': src.account.color } as React.CSSProperties} /> From Google Calendar{src.calendar && !src.calendar.primary ? ` · ${src.calendar.name}` : ''}{src.account.email ? ` · ${src.account.email}` : ''}</p>
            )}
            <a className="link sm" href={gcalUrl({ ...t, ...values() })} target="_blank" rel="noopener noreferrer">Add to Google Calendar ↗</a>
          </div>
        </div>
      </div>
      <div className="side-f">
        <button type="button" className="btn text warn" onClick={remove}>{armedDelete ? `${wide ? 'Click' : 'Tap'} again to ${repeat ? 'skip' : 'delete'}` : repeat ? 'Skip this one' : 'Delete'}</button>
        <button type="button" className="btn text" onClick={toggleDone}>{t.status === 'done' ? 'Mark not done' : 'Mark done'}</button>
        <span className="spacer" />
        {wide && <button type="button" className="btn text" onClick={onClose}>Cancel</button>}
        <button type="submit" className="btn pri">Save</button>
      </div>
    </form>
  );
}
