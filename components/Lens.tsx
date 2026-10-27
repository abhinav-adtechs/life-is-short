'use client';

import { useState } from 'react';
import { LABEL_NAME_MAX, MAX_PRESETS, lensIds, newLabelId, sameLens, toggleLensLabel, usablePresets } from '@/lib/labels';
import type { Priority } from '@/lib/model';
import { usePlanner } from './Planner';
import { radio, radioKeys } from './Controls';

const PRIORITIES: { p: Priority; label: string }[] = [{ p: 1, label: 'Urgent' }, { p: 2, label: '+ Important' }, { p: 3, label: '+ Later' }];
const tint = (color: string | null) => (color ? ({ '--c': color } as React.CSSProperties) : undefined);

/**
 * What the backlog and calendar focus on: saved views in one tap, then priorities and labels to fine-tune.
 * Anything left out fades on the calendar and leaves the backlog; on a laptop in Auto, the room goes to the calendar.
 */
export function LensBar({ phone }: { phone?: boolean }) {
  const { prefs, setPrefs, lens, setLens, toast } = usePlanner();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const presets = usablePresets(prefs.presets, prefs.labels);
  const active = presets.find(p => sameLens(p, lens, prefs.labels));
  const ids = lensIds(lens, prefs.labels);
  const chips = [...prefs.labels.map(l => ({ id: l.id, name: l.name, color: l.color as string | null })), { id: '', name: 'No label', color: null }];

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\s+/g, ' ').trim().slice(0, LABEL_NAME_MAX);
    setNaming(false);
    setName('');
    if (!n) return;
    setPrefs({ presets: [...prefs.presets, { id: newLabelId(), name: n, pri: lens.pri, labels: lens.labels }].slice(-MAX_PRESETS) });
    toast(`Saved the view “${n}”`);
  };

  return (
    <div className={'lens' + (phone ? ' phone' : '')}>
      <div className="lens-v" role="radiogroup" aria-label="Views" onKeyDown={radioKeys}>
        {presets.map((p, i) => (
          <button key={p.id} type="button" {...radio(active?.id === p.id)} tabIndex={active?.id === p.id || (!active && i === 0) ? 0 : -1}
            onClick={() => setLens({ pri: p.pri, labels: p.labels })}>{p.name}</button>
        ))}
        {!active && !naming && prefs.presets.length < MAX_PRESETS && (
          <button type="button" className="lens-save" onClick={() => setNaming(true)}>+ Save view</button>
        )}
        {naming && (
          <form className="lens-name" onSubmit={save}>
            <label htmlFor="lens-name" className="sr">Name this view</label>
            <input id="lens-name" type="text" autoFocus placeholder="Name it" maxLength={LABEL_NAME_MAX} value={name}
              onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(false); } }} />
            <button type="submit">Save</button>
          </form>
        )}
      </div>
      <div className="lens-f">
        <div className="seg mini" role="radiogroup" aria-label="Show priorities" onKeyDown={radioKeys}>
          {PRIORITIES.map(({ p, label }) => (
            <button key={p} type="button" {...radio(lens.pri === p)} className={lens.pri === p ? 'on' : ''} onClick={() => setLens({ ...lens, pri: p })}>{label}</button>
          ))}
        </div>
        <div className="lens-l" role="group" aria-label="Show labels">
          {chips.map(c => (
            <button key={c.id || '-'} type="button" className={'lc' + (c.color ? '' : ' none')} aria-pressed={ids.includes(c.id)} style={tint(c.color)}
              onClick={() => setLens(toggleLensLabel(lens, c.id, prefs.labels))}>
              <i aria-hidden="true" />{c.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
