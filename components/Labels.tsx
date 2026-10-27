'use client';

import { useEffect, useRef, useState } from 'react';
import { PALETTE } from '@/lib/color';
import { LABEL_NAME_MAX, MAX_LABELS, newLabelId, type Label } from '@/lib/labels';
import { usePlanner } from './Planner';
import { prefersReducedMotion } from './hooks';
import { CheckIcon, ChevronLeft, ChevronRight } from './icons';
import { CustomColour, radio, radioKeys } from './Controls';

const tint = (color: string) => ({ '--c': color } as React.CSSProperties);

/** One of your labels, or none, as a row of chips. */
export function LabelPicker({ value, onChange, labelledBy, none = 'No label' }: {
  value: string | null; onChange: (id: string | null) => void; labelledBy: string; none?: string;
}) {
  const { prefs } = usePlanner();
  // A label that was removed reads as none.
  const cur = prefs.labels.some(l => l.id === value) ? value : null;
  return (
    <div className="chips" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={radioKeys}>
      {prefs.labels.map(l => (
        <button key={l.id} type="button" className="chipb" {...radio(cur === l.id)} onClick={() => onChange(l.id)}>
          <span className="dot" style={tint(l.color)} />{l.name}
        </button>
      ))}
      <button type="button" className="chipb" {...radio(!cur)} onClick={() => onChange(null)}><span className="dot none" />{none}</button>
    </div>
  );
}

function LabelRow({ l, i, count, last, focus, onFocused, change, move, remove }: {
  l: Label; i: number; count: number; last: boolean; focus: boolean; onFocused: () => void;
  change: (patch: Partial<Label>) => void; move: (dir: -1 | 1) => void; remove: () => void;
}) {
  const [name, setName] = useState(l.name);
  const [colorsOpen, setColorsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setName(l.name), [l.name]);
  useEffect(() => {
    if (!focus) return;
    input.current?.focus();
    input.current?.select();
    onFocused();
  }, [focus, onFocused]);
  // Saved when you leave the field, so typing a space isn't trimmed away mid-word.
  const commit = () => {
    const n = name.replace(/\s+/g, ' ').trim().slice(0, LABEL_NAME_MAX);
    if (n && n !== l.name) change({ name: n });
    else setName(l.name);
  };
  const palette = PALETTE.includes(l.color) ? PALETTE : [...PALETTE, l.color];
  return (
    <li style={tint(l.color)}>
      <div className="lrow">
        <button type="button" className="adot" aria-label={`Colour for ${l.name}`} aria-expanded={colorsOpen} onClick={() => setColorsOpen(o => !o)} />
        <input ref={input} type="text" aria-label={`Name of label ${i + 1}`} value={name} maxLength={LABEL_NAME_MAX} enterKeyHint="done"
          onChange={e => setName(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
        <span className="lcount">{count ? `${count} open` : ''}</span>
        <button type="button" className="ib bare lmove up" aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => move(-1)}><ChevronLeft size={14} /></button>
        <button type="button" className="ib bare lmove down" aria-label={`Move ${l.name} down`} disabled={last} onClick={() => move(1)}><ChevronRight size={14} /></button>
        <button type="button" className="btn text sm" onClick={remove}>Remove</button>
      </div>
      {colorsOpen && (
        <div className="swatches small" role="radiogroup" aria-label={`Colour for ${l.name}`} onKeyDown={radioKeys}>
          {palette.map(c => (
            <button key={c} type="button" className="swatch" {...radio(l.color === c)} aria-label={c} style={tint(c)}
              onClick={() => change({ color: c })}><CheckIcon size={12} w={2.4} /></button>
          ))}
          <CustomColour value={l.color} onSave={color => change({ color })} />
        </div>
      )}
    </li>
  );
}

/** Settings → Labels: the parts of your life your tasks sort into. */
export function LabelsSection() {
  const { prefs, setPrefs, toast, tasks, labelOf } = usePlanner();
  const labels = prefs.labels;
  const [focusId, setFocusId] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const l = t.status === 'open' ? labelOf(t) : null;
    if (l) counts.set(l.id, (counts.get(l.id) || 0) + 1);
  }

  const save = (next: Label[]) => setPrefs({ labels: next });
  const change = (id: string, patch: Partial<Label>) => save(labels.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...labels];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    save(next);
  };
  const remove = (l: Label) => {
    const before = labels;
    save(labels.filter(x => x.id !== l.id));
    // Tasks keep the id, so Undo brings their label straight back.
    toast(`Removed ${l.name}. Its tasks have no label now.`, () => setPrefs({ labels: before }));
  };
  const add = () => {
    const used = new Set(labels.map(l => l.color));
    const l: Label = { id: newLabelId(), name: 'New label', color: PALETTE.find(c => !used.has(c)) ?? PALETTE[labels.length % PALETTE.length] };
    save([...labels, l]);
    setFocusId(l.id);
  };
  // Within Settings, like its own nav: scroll there without adding to the history.
  const toGoogle = () => {
    document.getElementById('set-google')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#settings/google');
  };

  return (
    <section id="set-labels" className="set-sec" aria-labelledby="set-labels-h">
      <div className="set-h"><h3 id="set-labels-h">Labels</h3><span className="muted sm">rows in the matrix</span></div>
      <p className="note">
        The parts of your life, like work, a side project, personal and helping others. The AI puts each thing you dump under one;
        you can change it on any task, or type a #tag.
      </p>
      {labels.length > 0 && (
        <ul className="labels">
          {labels.map((l, i) => (
            <LabelRow key={l.id} l={l} i={i} count={counts.get(l.id) || 0} last={i === labels.length - 1}
              focus={focusId === l.id} onFocused={() => setFocusId(null)}
              change={patch => change(l.id, patch)} move={dir => move(i, dir)} remove={() => remove(l)} />
          ))}
        </ul>
      )}
      <div className="acts">
        <button type="button" className={'btn sm ' + (labels.length ? 'sec' : 'pri')} disabled={labels.length >= MAX_LABELS} onClick={add}>Add a label</button>
      </div>
      <p className="note">
        {labels.length >= MAX_LABELS ? `That’s the most labels the planner holds. ` : ''}
        Give each Google account or calendar a label in <button type="button" className="link" onClick={toGoogle}>Calendars</button>, so
        work and personal time show in their colours. The order here is the order of the matrix.
      </p>
    </section>
  );
}
