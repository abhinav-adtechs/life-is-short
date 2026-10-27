'use client';

import { useState } from 'react';
import { calendarOf } from '@/lib/google';
import { fmtAgo } from '@/lib/format';
import { ACCOUNT_COLORS, MAX_ACCOUNTS, ownCalendars, type GoogleAccount } from '@/lib/google-client';
import { usePlanner } from './Planner';
import { CheckIcon, ChevronDown } from './icons';
import { CustomColour, Opt, radio, radioKeys } from './Controls';
import { LabelPicker } from './Labels';

const ROLE: Record<string, string> = { owner: 'Yours', writer: 'Can edit', reader: 'Read-only' };

function AccountCard({ a }: { a: GoogleAccount }) {
  const { accounts, tasks, prefs, changeAccount, changeCalendar, removeGoogle, pullGoogle, connectGoogle, pulling } = usePlanner();
  const [calsOpen, setCalsOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const who = a.email || 'Google account';
  const own = ownCalendars(accounts, a.id);
  const events = tasks.filter(t => own.has(calendarOf(t.externalId) || '')).length;
  const on = a.calendars.filter(c => c.pull).length;
  const status = a.error
    ? 'Google ended access. Reconnect to keep pulling.'
    : (a.pulledAt ? `Pulled ${fmtAgo(a.pulledAt)}` : 'Not pulled yet') + (a.calendars.length ? ` · ${on} of ${a.calendars.length} calendars` : '');
  const palette = ACCOUNT_COLORS.includes(a.color) ? ACCOUNT_COLORS : [...ACCOUNT_COLORS, a.color];
  const labels = prefs.labels;
  const acctLabel = labels.find(l => l.id === a.label);
  // Picking a label also takes its colour, so the account reads the same whichever way events are coloured.
  const setLabel = (id: string | null) => {
    const l = labels.find(x => x.id === id);
    changeAccount(a.id, l ? { label: l.id, color: l.color } : { label: null });
  };

  return (
    <div className={'acct' + (a.error ? ' err' : '')} style={{ '--c': a.color } as React.CSSProperties}>
      <div className="acct-h">
        <button type="button" className="adot" aria-label={`Colour for ${who}`} aria-expanded={colorsOpen} onClick={() => setColorsOpen(o => !o)} />
        <div className="who"><b>{who}</b><span>{status}</span></div>
        {a.error
          ? <button type="button" className="btn pri sm" onClick={() => connectGoogle(a.email)}>Reconnect</button>
          : <button type="button" className="btn sec sm" disabled={pulling} onClick={() => pullGoogle(false, a.id)}>Pull</button>}
      </div>

      {colorsOpen && (
        <div className="swatches small" role="radiogroup" aria-label={`Colour for ${who}`} onKeyDown={radioKeys}>
          {palette.map(c => (
            <button key={c} type="button" className="swatch" {...radio(a.color === c)} aria-label={c} style={{ '--c': c } as React.CSSProperties}
              onClick={() => changeAccount(a.id, { color: c })}><CheckIcon size={12} w={2.4} /></button>
          ))}
          <CustomColour value={a.color} onSave={color => changeAccount(a.id, { color })} />
        </div>
      )}

      {labels.length > 0 && (
        <Opt label="Label" stack note="Its events take this label and its colour, unless you give a calendar below, or an event itself, another one.">
          {({ labelId }) => <LabelPicker labelledBy={labelId} value={a.label} onChange={setLabel} />}
        </Opt>
      )}
      <Opt label="Show on the calendar" note="Hidden accounts still pull; their events just stay off the calendar."
        toggle={{ checked: a.show, onChange: show => changeAccount(a.id, { show }) }} />
      <Opt label="Google Tasks" note="Pull this account’s Google Tasks into the backlog."
        toggle={{ checked: a.tasks, onChange: t => changeAccount(a.id, { tasks: t }) }} />

      <div className="gh cals-h">
        <button type="button" className="gh-t" aria-expanded={calsOpen} onClick={() => setCalsOpen(o => !o)}>Calendars<span className="gh-n num">{a.calendars.length ? `${on} on` : ''}</span><ChevronDown /></button>
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
              {labels.length > 0 && (
                <select className="csel" aria-label={`Label for ${c.name}`} value={labels.some(l => l.id === c.label) ? c.label ?? '' : ''}
                  onChange={e => changeCalendar(a.id, c.id, { label: e.target.value || null })}>
                  <option value="">{acctLabel ? `Account’s: ${acctLabel.name}` : 'No label'}</option>
                  {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
            </li>
          ))}
          <li className="note">
            Off hides that calendar’s events and stops pulling it. Read-only calendars, like holidays, come in as tasks too.
            {labels.length > 0 && ' A label here wins over the account’s, say a “Gym” calendar in a work account.'}
          </li>
        </ul>
      ) : <p className="note">Your calendars show up here after the first pull.</p>)}

      <div className="acct-f">
        {confirm ? (
          <>
            <span>Disconnect {who}?</span>
            <button type="button" className="btn sec sm" disabled={pulling} onClick={() => removeGoogle(a.id, false)}>Keep its events</button>
            {events > 0 && <button type="button" className="btn sec sm" disabled={pulling} onClick={() => removeGoogle(a.id, true)}>Remove its {events} event{events === 1 ? '' : 's'}</button>}
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
    <section id="set-google" className="set-sec" aria-labelledby="set-google-h">
      <div className="set-h"><h3 id="set-google-h">Calendars</h3><span className="muted sm">events show on the timeline</span></div>
      <p className="note">
        Connect up to {MAX_ACCOUNTS} Google accounts, say personal and work. Their events and Google Tasks come into the planner
        and share one calendar. Read-only: nothing is written back to Google.
      </p>
      {accounts.map(a => <AccountCard key={a.id} a={a} />)}
      <div className="acts">
        <button type="button" className={'btn sm ' + (accounts.length ? 'sec' : 'pri')} disabled={full} onClick={() => connectGoogle()}>
          {accounts.length ? 'Add another account' : 'Connect Google'}
        </button>
        {accounts.length > 1 && (
          <button type="button" className="btn sec sm" disabled={pulling} onClick={() => pullGoogle(false)}>{pulling ? 'Pulling…' : 'Pull all now'}</button>
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
