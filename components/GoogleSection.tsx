'use client';

import { useEffect, useRef, useState } from 'react';
import { calendarOf } from '@/lib/google';
import { ACCOUNT_COLORS, MAX_ACCOUNTS, ownCalendars, type GoogleAccount } from '@/lib/google-client';
import { usePlanner } from './Planner';
import { CaretIcon, CheckIcon } from './icons';
import { Opt, radio, radioKeys } from './Controls';

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

const ROLE: Record<string, string> = { owner: 'Yours', writer: 'Can edit', reader: 'Read-only' };

/** The colour input fires on every move while dragging: show it at once, save once it settles. */
function CustomColour({ value, onSave }: { value: string; onSave: (c: string) => void }) {
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

function AccountCard({ a }: { a: GoogleAccount }) {
  const { accounts, tasks, changeAccount, changeCalendar, removeGoogle, pullGoogle, connectGoogle, pulling } = usePlanner();
  const [calsOpen, setCalsOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const who = a.email || 'Google account';
  const own = ownCalendars(accounts, a.id);
  const events = tasks.filter(t => own.has(calendarOf(t.externalId) || '')).length;
  const on = a.calendars.filter(c => c.pull).length;
  const status = a.error
    ? 'Google ended access. Reconnect to keep pulling.'
    : (a.pulledAt ? `Pulled ${ago(a.pulledAt)}` : 'Not pulled yet') + (a.calendars.length ? ` · ${on} of ${a.calendars.length} calendars` : '');
  const palette = ACCOUNT_COLORS.includes(a.color) ? ACCOUNT_COLORS : [...ACCOUNT_COLORS, a.color];

  return (
    <div className={'acct' + (a.error ? ' err' : '')} style={{ '--c': a.color } as React.CSSProperties}>
      <div className="acct-h">
        <button type="button" className="adot" aria-label={`Colour for ${who}`} aria-expanded={colorsOpen} onClick={() => setColorsOpen(o => !o)} />
        <div className="who"><b>{who}</b><span>{status}</span></div>
        {a.error
          ? <button type="button" className="btn pri" onClick={() => connectGoogle(a.email)}>Reconnect</button>
          : <button type="button" className="btn sec" disabled={pulling} onClick={() => pullGoogle(false, a.id)}>Pull</button>}
      </div>

      {colorsOpen && (
        <div className="swatches small" role="radiogroup" aria-label={`Colour for ${who}`} onKeyDown={radioKeys}>
          {palette.map(c => (
            <button key={c} type="button" className="swatch" {...radio(a.color === c)} aria-label={c} style={{ '--c': c } as React.CSSProperties}
              onClick={() => changeAccount(a.id, { color: c })}><CheckIcon size={12} /></button>
          ))}
          <CustomColour value={a.color} onSave={color => changeAccount(a.id, { color })} />
        </div>
      )}

      <Opt label="Show on the calendar" note="Hidden accounts still pull; their events just stay off the calendar."
        toggle={{ checked: a.show, onChange: show => changeAccount(a.id, { show }) }} />
      <Opt label="Google Tasks" note="Pull this account’s Google Tasks into the backlog."
        toggle={{ checked: a.tasks, onChange: t => changeAccount(a.id, { tasks: t }) }} />

      <div className="gh cals-h">
        <button type="button" aria-expanded={calsOpen} onClick={() => setCalsOpen(o => !o)}><CaretIcon /> Calendars</button>
        <span>{a.calendars.length ? `${on} on` : ''}</span>
      </div>
      {calsOpen && (a.calendars.length ? (
        <ul className="cals">
          {a.calendars.map(c => (
            <li key={c.id}>
              <label>
                <input type="checkbox" checked={c.pull} onChange={e => changeCalendar(a.id, c.id, { pull: e.target.checked })} />
                <i aria-hidden="true" style={{ background: c.color || a.color }} />
                <span>{c.name}{c.primary ? ' (main)' : ''}</span>
                <em>{ROLE[c.role] || c.role}</em>
              </label>
            </li>
          ))}
          <li className="note">Off hides that calendar’s events and stops pulling it. Read-only calendars, like holidays, come in as tasks too.</li>
        </ul>
      ) : <p className="note">Your calendars show up here after the first pull.</p>)}

      <div className="acct-f">
        {confirm ? (
          <>
            <span>Disconnect {who}?</span>
            <button type="button" className="btn sec" disabled={pulling} onClick={() => removeGoogle(a.id, false)}>Keep its events</button>
            {events > 0 && <button type="button" className="btn sec" disabled={pulling} onClick={() => removeGoogle(a.id, true)}>Remove its {events} event{events === 1 ? '' : 's'}</button>}
            {pulling && <span className="note">Waiting for the pull to finish…</span>}
            <button type="button" className="link" onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : <button type="button" className="link" onClick={() => setConfirm(true)}>Disconnect</button>}
      </div>
    </div>
  );
}

/** Connect Google accounts and pull them in. Several accounts share one calendar, each in its own colour. */
export function GoogleSection() {
  const { accounts, pullGoogle, connectGoogle, pulling } = usePlanner();
  const full = accounts.length >= MAX_ACCOUNTS;
  return (
    <section id="set-google" className="sp-sec" aria-labelledby="set-google-h">
      <h2 id="set-google-h">Google accounts</h2>
      <p className="lead">
        Connect up to {MAX_ACCOUNTS} Google accounts, say personal and work. Their events and Google Tasks come into the planner
        and share one calendar, each in its own colour. Read-only: nothing is written back to Google.
      </p>
      {accounts.map(a => <AccountCard key={a.id} a={a} />)}
      <div className="sacts">
        <button type="button" className={'btn ' + (accounts.length ? 'sec' : 'pri')} disabled={full} onClick={() => connectGoogle()}>
          {accounts.length ? 'Add another account' : 'Connect Google'}
        </button>
        {accounts.length > 1 && (
          <button type="button" className="btn sec" disabled={pulling} onClick={() => pullGoogle(false)}>{pulling ? 'Pulling…' : 'Pull all now'}</button>
        )}
      </div>
      <p className="note">
        {full ? `That’s the most accounts the planner holds. Disconnect one to add another. ` : ''}
        Pulls today through the next month, then every 30 minutes while the planner is open. Changes in Google update the title and time here;
        your priority, notes and done state stay yours. A meeting that’s on two of your accounts shows once.
      </p>
    </section>
  );
}
