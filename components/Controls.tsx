'use client';

import { useEffect, useId, useRef, useState } from 'react';

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Arrow keys move the choice inside a radiogroup, like native radios. Put on the group's onKeyDown. */
export function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  const d = STEP[e.key];
  if (!d) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = items[(i + d + items.length) % items.length];
  next.focus();
  next.click();
}

/** Props for one radio in a group: checked state and roving tab stop. */
export const radio = (checked: boolean) => ({ role: 'radio' as const, 'aria-checked': checked, tabIndex: checked ? 0 : -1 });

export interface ChoiceOption<T> { value: T; label: React.ReactNode; hint?: string }

/** One of a few, as a segmented control. */
export function Choice<T extends string | number | null>({ labelledBy, value, options, onChange }: {
  labelledBy: string; value: T; options: ChoiceOption<T>[]; onChange: (v: T) => void;
}) {
  const known = options.some(o => o.value === value);
  return (
    <div className="seg full big" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={radioKeys}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" {...radio(on)} tabIndex={on || (!known && i === 0) ? 0 : -1}
            className={on ? 'on' : ''} title={o.hint} onClick={() => onChange(o.value)}>{o.label}</button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, labelledBy, describedBy }: {
  checked: boolean; onChange: (v: boolean) => void; labelledBy: string; describedBy?: string;
}) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-describedby={describedBy}
      onClick={() => onChange(!checked)} />
  );
}

/**
 * One setting: a label and note with its control. Controls sit beside the label, or under it with `stack`.
 * Pass `toggle` for an on/off setting and the row renders its own switch.
 */
export function Opt({ label, note, stack, toggle, children }: {
  label: string; note?: React.ReactNode; stack?: boolean;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  children?: (ids: { labelId: string; noteId?: string }) => React.ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-l`, noteId = note ? `${id}-n` : undefined;
  return (
    <div className={'opt' + (stack ? ' stack' : '')}>
      <div className="otx">
        <div className="ol" id={labelId}>{label}</div>
        {note && <div className="od" id={noteId}>{note}</div>}
      </div>
      <div className="oc">
        {toggle ? <Switch checked={toggle.checked} onChange={toggle.onChange} labelledBy={labelId} describedBy={noteId} /> : children?.({ labelId, noteId })}
      </div>
    </div>
  );
}

/** The colour input fires on every move while dragging: show it at once, save once it settles. */
export function CustomColour({ value, onSave }: { value: string; onSave: (c: string) => void }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef(0);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <label className={'swatch custom' + (draft !== value ? ' on' : '')} title="Your own colour" style={{ '--c': draft } as React.CSSProperties}>
      <input type="color" aria-label="Your own colour" value={draft.toLowerCase()} onChange={e => {
        const c = e.target.value.toUpperCase();
        setDraft(c);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onSave(c), 400);
      }} />
    </label>
  );
}
