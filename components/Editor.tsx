'use client';

import { useRef, useState } from 'react';
import type { Priority, Task } from '@/lib/model';
import { findSlot } from '@/lib/place';
import { fmtWhen, shortTitle } from '@/lib/format';
import { gcalUrl } from '@/lib/links';
import { atMinutes, fromYmd, pad, startOfDay, ymd } from '@/lib/time';
import { usePlanner } from './Planner';
import { useTrap } from './hooks';
import { XIcon } from './icons';
import { LabelPicker } from './Labels';

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480];
const lenLabel = (m: number) => (m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`);

export function Editor({ task: t, onClose }: { task: Task; onClose: () => void }) {
  const { store, wide, toast, undoable, setPicked, setPhoneView, hours, sourceOf, liveTasks, prefs, labelOf } = usePlanner();
  const [title, setTitle] = useState(t.title);
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [date, setDate] = useState(t.start != null ? ymd(t.start) : '');
  const [time, setTime] = useState(t.start != null ? `${pad(new Date(t.start).getHours())}:${pad(new Date(t.start).getMinutes())}` : '');
  const [minutes, setMinutes] = useState(t.minutes);
  const [due, setDue] = useState(t.due || '');
  const [notes, setNotes] = useState(t.notes || '');
  const [label, setLabel] = useState<string | null>(t.label ?? null);
  const [armedDelete, setArmedDelete] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useTrap(sheet);

  const values = () => ({
    title: title.replace(/\s+/g, ' ').trim().slice(0, 160) || t.title,
    priority, minutes, due: due || null, notes: notes.trim(), label,
  });

  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = values();
    let start: number | null = null;
    if (date || time) {
      const day = date ? fromYmd(date) : startOfDay(Date.now());
      if (time) { const [h, m] = time.split(':').map(Number); start = atMinutes(day, h * 60 + m); }
      else if (t.start != null && ymd(t.start) === ymd(day)) start = t.start;
      else start = findSlot(liveTasks(), v.minutes, { onDate: day, sameDay: true, exclude: t.id, hours }) ?? atMinutes(day, hours.start);
    }
    const before = store.write([{ ...t, ...v, start }]);
    onClose();
    undoable(start != null ? `Saved · ${fmtWhen(start)}` : 'Saved to the backlog', before);
  };

  const nextSlot = () => {
    const v = values();
    const s = findSlot(liveTasks(), v.minutes, { exclude: t.id, hours });
    if (s == null) { toast('No free slot in the next two weeks.'); return; }
    const before = store.write([{ ...t, ...v, start: s }]);
    onClose();
    undoable(`Slotted for ${fmtWhen(s)}`, before);
  };

  const toBacklog = () => {
    const before = store.write([{ ...t, ...values(), start: null }]);
    onClose();
    undoable('Moved to the backlog', before);
  };

  const toggleDone = () => {
    const isDone = t.status !== 'done';
    const before = store.write([{ ...t, ...values(), status: isDone ? 'done' : 'open', doneAt: isDone ? Date.now() : null }]);
    onClose();
    undoable(isDone ? `Done: ${shortTitle(t.title)}` : 'Back on the list', before);
  };

  const remove = () => {
    if (!armedDelete) { setArmedDelete(true); return; }
    const before = store.remove([t.id]);
    onClose();
    undoable('Deleted', before);
  };

  const pickTime = () => {
    store.write([{ ...t, ...values() }]);
    onClose();
    setPicked(t.id);
    if (!wide) setPhoneView('calendar');
  };

  const lengths = LENGTHS.includes(minutes) ? LENGTHS : [...LENGTHS, minutes].sort((a, b) => a - b);
  const draft = { ...t, ...values(), start: date && time ? atMinutes(fromYmd(date), Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) : t.start };
  const raw = (t.raw || '').trim();
  const src = sourceOf(t);
  // What a Google event gets from its calendar when it has no label of its own.
  const inherited = src ? labelOf({ ...t, label: null }) : null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={sheet} className={'sheet' + (wide ? ' dialog' : '')} role="dialog" aria-modal="true" aria-labelledby="ed-h" tabIndex={-1}>
        <form onSubmit={save} autoComplete="off">
          <div className="stop">
            <span className="eyebrow" id="ed-h">{t.status === 'done' ? 'Done' : t.start != null ? 'On the calendar' : 'In the backlog'}</span>
            <button type="button" className="ib" aria-label="Close" onClick={onClose}><XIcon size={18} /></button>
          </div>
          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="ed-title" className="sr">Task</label>
            <textarea id="ed-title" className="title" rows={2} value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } }} />
          </div>
          <div className="fld">
            <span className="flabel" id="ed-pri">Priority</span>
            <div className="seg full" role="radiogroup" aria-labelledby="ed-pri">
              {([1, 2, 3] as Priority[]).map(p => (
                <button key={p} type="button" role="radio" aria-checked={priority === p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}>
                  {p === 1 ? 'Urgent' : p === 2 ? 'Important' : 'Later'}
                </button>
              ))}
            </div>
          </div>
          {prefs.labels.length > 0 && (
            <div className="fld">
              <span className="flabel" id="ed-lab">Label</span>
              <LabelPicker labelledBy="ed-lab" value={label} onChange={setLabel} none={inherited ? `From calendar: ${inherited.name}` : 'None'} />
            </div>
          )}
          <div className="two">
            <div className="fld"><label htmlFor="ed-date">Day</label><input id="ed-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="fld"><label htmlFor="ed-time">Start</label><input id="ed-time" type="time" step={900} value={time} onChange={e => setTime(e.target.value)} /></div>
          </div>
          <div className="two">
            <div className="fld">
              <label htmlFor="ed-len">Length</label>
              <select id="ed-len" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
                {lengths.map(m => <option key={m} value={m}>{lenLabel(m)}</option>)}
              </select>
            </div>
            <div className="fld"><label htmlFor="ed-due">Due by</label><input id="ed-due" type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
          </div>
          <p className="note">Leave Day and Start empty to keep it in the backlog.</p>
          <div className="fld">
            <label htmlFor="ed-notes">Notes</label>
            <textarea id="ed-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="sacts">
            <button type="submit" className="btn pri">Save</button>
            <button type="button" className="btn sec" onClick={nextSlot}>Next free slot</button>
            <button type="button" className="btn sec" onClick={pickTime}>Pick a time</button>
            {t.start != null && <button type="button" className="btn sec" onClick={toBacklog}>Move to backlog</button>}
            <button type="button" className="btn sec" onClick={toggleDone}>{t.status === 'done' ? 'Mark not done' : 'Mark done'}</button>
          </div>
          <div className="minor">
            <a className="link" href={gcalUrl(draft)} target="_blank" rel="noopener noreferrer">Add to Google Calendar ↗</a>
            <button type="button" className={'link' + (armedDelete ? ' armed' : '')} onClick={remove}>{armedDelete ? 'Tap again to delete' : 'Delete'}</button>
          </div>
          {raw && raw !== t.title && <p className="raw">From your dump: “{raw}”</p>}
          {src && (
            <p className="raw src"><i aria-hidden="true" style={{ background: src.account.color }} />
              From Google Calendar{src.calendar && !src.calendar.primary ? ` · ${src.calendar.name}` : ''}{src.account.email ? ` · ${src.account.email}` : ''}
            </p>
          )}
        </form>
      </div>
    </>
  );
}
