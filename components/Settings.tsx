'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizeImport } from '@/lib/importer';
import { hasSupabase, supabase } from '@/lib/supabase';
import { ACCENTS, DEFAULT_PREFS, FONTS, HOUR_HEIGHTS, TEXT_SIZES, THEMES, accentColor, fontHref, type Prefs } from '@/lib/prefs';
import { isHex } from '@/lib/color';
import { fmtHour } from '@/lib/format';
import { usePlanner } from './Planner';
import { prefersReducedMotion } from './hooks';
import { CheckIcon } from './icons';
import { Choice, Opt, radio, radioKeys } from './Controls';
import { GoogleSection } from './GoogleSection';
import { LabelsSection } from './Labels';

const SECTIONS = [
  { id: 'appearance', name: 'Appearance' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'labels', name: 'Labels' },
  { id: 'google', name: 'Calendars' },
  { id: 'tasks', name: 'Tasks' },
  { id: 'account', name: 'Account', needsSupabase: true },
];

const APPEARANCE_KEYS = ['theme', 'accent', 'ambient', 'font', 'textSize', 'density', 'contrast', 'motion', 'clock'] as const;

/** Settings, in the side panel. Every change applies straight away; there's nothing to save. */
export function Settings() {
  const { section } = usePlanner();
  const root = useRef<HTMLDivElement>(null);
  const sections = SECTIONS.filter(s => !s.needsSupabase || hasSupabase());

  // #settings/google (back from connecting Google, say) opens at that section.
  useEffect(() => {
    if (section && section !== 'appearance') document.getElementById(`set-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);

  const go = (id: string) => {
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#settings/${id}`);
  };

  return (
    <div className="set" ref={root}>
      <nav className="set-nav" aria-label="Settings sections">
        {sections.map(s => <button key={s.id} type="button" className="btn ghost sm" onClick={() => go(s.id)}>{s.name}</button>)}
      </nav>
      <Appearance />
      <CalendarPrefs />
      <LabelsSection />
      <GoogleSection />
      <TasksSection />
      {hasSupabase() && <AccountSection />}
    </div>
  );
}

export function Section({ id, title, sub, children }: { id: string; title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`set-${id}`} className="set-sec" aria-labelledby={`set-${id}-h`}>
      <div className="set-h"><h3 id={`set-${id}-h`}>{title}</h3>{sub && <span className="muted sm">{sub}</span>}</div>
      {children}
    </section>
  );
}

/* ---------- appearance ---------- */

/** Load every font option once while Settings is open, so each shows its own face. */
function useFontPreviews() {
  useEffect(() => {
    if (document.querySelector('link[data-font-previews]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = fontHref(FONTS.flatMap(f => (f.gf ? [f.gf] : [])).join('&family='));
    l.dataset.fontPreviews = '';
    document.head.appendChild(l);
  }, []);
}

function Appearance() {
  const { prefs, setPrefs, toast, theme } = usePlanner();
  useFontPreviews();
  const custom = isHex(prefs.accent);
  const accents = [{ id: null as string | null, name: 'Theme accent', color: accentColor(null, theme) }, ...ACCENTS.map(a => ({ id: a.id as string | null, name: a.name, color: a.color as string }))];

  const reset = () => {
    const before = Object.fromEntries(APPEARANCE_KEYS.map(k => [k, prefs[k]])) as Partial<Prefs>;
    setPrefs(Object.fromEntries(APPEARANCE_KEYS.map(k => [k, DEFAULT_PREFS[k]])) as Partial<Prefs>);
    toast('Appearance back to the defaults', () => setPrefs(before));
  };

  return (
    <Section id="appearance" title="Appearance" sub="theme, accent and light stay on this device">
      <div className="opt stack">
        <span className="flabel" id="set-theme">Theme</span>
        <div className="themes" role="radiogroup" aria-labelledby="set-theme" onKeyDown={radioKeys}>
          {THEMES.map(t => (
            <button key={t.id} type="button" className="theme" {...radio(theme === t.id)} onClick={() => setPrefs({ theme: t.id })}>
              <span className="theme-sw" style={{ background: t.bg }} aria-hidden="true"><i style={{ background: t.accent }} /></span>
              <span className="theme-t"><b>{t.name}</b><span>{t.note}</span></span>
            </button>
          ))}
        </div>
      </div>
      <Opt label="Match your device" note="Night train when your device is dark, Tide when it’s light. Picking a theme above turns this off."
        toggle={{ checked: prefs.theme == null, onChange: on => setPrefs({ theme: on ? null : theme }) }} />

      <div className="opt stack">
        <span className="flabel" id="set-accent">Accent</span>
        <div className="swatches" role="radiogroup" aria-labelledby="set-accent" onKeyDown={radioKeys}>
          {accents.map((a, i) => (
            <button key={a.id ?? 'theme'} type="button" className="swatch" {...radio(prefs.accent === a.id)} tabIndex={prefs.accent === a.id || (custom && i === 0) ? 0 : -1}
              aria-label={a.name} title={a.name} style={{ '--c': a.color } as React.CSSProperties} onClick={() => setPrefs({ accent: a.id })}>
              <CheckIcon size={12} w={2.4} />
            </button>
          ))}
          <label className="swatch custom" title="Your own colour" aria-checked={custom} style={custom ? ({ '--c': prefs.accent } as React.CSSProperties) : undefined}>
            <input type="color" aria-label="Your own colour" value={custom ? (prefs.accent as string).toLowerCase() : '#f04a0c'} onChange={e => setPrefs({ accent: e.target.value.toUpperCase() })} />
            {custom && <CheckIcon size={12} w={2.4} />}
          </label>
        </div>
        <p className="note">The now line, the dot on Next task, and anything that needs you. A picked colour wins over the theme’s.</p>
      </div>

      <Opt label="Ambient light" note="Tide’s water under the now line; the light passing through the trains. Quiet halves it, Still holds it." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.ambient} onChange={ambient => setPrefs({ ambient })}
            options={[{ value: 'present', label: 'Present' }, { value: 'quiet', label: 'Quiet' }, { value: 'still', label: 'Still' }]} />
        )}
      </Opt>

      <Opt label="Motion" note="Reduced stops every animation, the ambient light too. System follows your device." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.motion} onChange={motion => setPrefs({ motion })}
            options={[{ value: 'system', label: 'System' }, { value: 'full', label: 'Full' }, { value: 'reduce', label: 'Reduced' }]} />
        )}
      </Opt>

      <Opt label="Font" stack>
        {({ labelId }) => (
          <div className="fonts" role="radiogroup" aria-labelledby={labelId} onKeyDown={radioKeys}>
            {FONTS.map(f => (
              <button key={f.id} type="button" className="fontc" {...radio(prefs.font === f.id)} title={f.note} onClick={() => setPrefs({ font: f.id })} style={{ fontFamily: f.stack }}>
                <span className="fa" aria-hidden="true">Aa</span><span className="fn">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </Opt>

      <Opt label="Text size" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.textSize} onChange={textSize => setPrefs({ textSize })}
            options={TEXT_SIZES.map(t => ({ value: t.value, label: t.label }))} />
        )}
      </Opt>

      <Opt label="List density" note="Room between rows in the matrix." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.density} onChange={density => setPrefs({ density })}
            options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }, { value: 'roomy', label: 'Roomy' }]} />
        )}
      </Opt>

      <Opt label="Increase contrast" note="Darker secondary text and stronger lines." toggle={{ checked: prefs.contrast, onChange: contrast => setPrefs({ contrast }) }} />

      <Opt label="Clock" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.clock} onChange={clock => setPrefs({ clock })}
            options={[{ value: '12', label: '12-hour · 2:30 PM' }, { value: '24', label: '24-hour · 14:30' }]} />
        )}
      </Opt>

      <div className="acts"><button type="button" className="btn sec sm" onClick={reset}>Reset appearance</button></div>
    </Section>
  );
}

/* ---------- calendar ---------- */

const hourLabel = (h: number) => (h === 24 ? 'Midnight' : fmtHour(h));

function CalendarPrefs() {
  const { prefs, setPrefs } = usePlanner();
  return (
    <Section id="calendar" title="Calendar">
      <Opt label="Your day" note="The calendar shows these hours, stretching a little for anything just outside. Next free slot and the AI place tasks inside them." stack>
        {({ labelId }) => (
          <div className="two" role="group" aria-labelledby={labelId}>
            <div className="fld">
              <label htmlFor="day-start">Starts</label>
              <select id="day-start" value={prefs.dayStart} onChange={e => setPrefs({ dayStart: Number(e.target.value) })}>
                {Array.from({ length: prefs.dayEnd - 1 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div className="fld">
              <label htmlFor="day-end">Ends</label>
              <select id="day-end" value={prefs.dayEnd} onChange={e => setPrefs({ dayEnd: Number(e.target.value) })}>
                {Array.from({ length: 24 - (prefs.dayStart + 1) }, (_, i) => prefs.dayStart + 2 + i).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
          </div>
        )}
      </Opt>

      <Opt label="Week starts on" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.weekStart} onChange={weekStart => setPrefs({ weekStart })}
            options={[{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }, { value: 6, label: 'Saturday' }]} />
        )}
      </Opt>

      <Opt label="5 days shows" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.fiveDay} onChange={fiveDay => setPrefs({ fiveDay })}
            options={[{ value: 'rolling', label: 'The next 5 days' }, { value: 'workweek', label: 'Mon to Fri' }]} />
        )}
      </Opt>

      <Opt label="Hour height on a phone" note="A laptop fits your day to the screen." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.hourHeight} onChange={hourHeight => setPrefs({ hourHeight })}
            options={HOUR_HEIGHTS.map(h => ({ value: h.value, label: h.label }))} />
        )}
      </Opt>

      <Opt label="Colour events by" stack
        note="Label colours tasks, and Google events by their calendar’s or account’s label. Account and Calendar colour pulled events only.">
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.colorBy} onChange={colorBy => setPrefs({ colorBy })}
            options={[{ value: 'label', label: 'Label' }, { value: 'account', label: 'Account' }, { value: 'calendar', label: 'Calendar', hint: 'Google calendar' }, { value: 'priority', label: 'Priority' }, { value: 'none', label: 'None' }]} />
        )}
      </Opt>

      <Opt label="Show done tasks" note="Past Google events count as done." toggle={{ checked: prefs.showDone, onChange: showDone => setPrefs({ showDone }) }} />
      <Opt label="Shade weekends" toggle={{ checked: prefs.shadeWeekends, onChange: shadeWeekends => setPrefs({ shadeWeekends }) }} />
      <Opt label="Week numbers" note="ISO weeks, in the calendar’s title." toggle={{ checked: prefs.weekNumbers, onChange: weekNumbers => setPrefs({ weekNumbers }) }} />
    </Section>
  );
}

/* ---------- tasks and account ---------- */

function TasksSection() {
  const { repo, store, toast } = usePlanner();
  const file = useRef<HTMLInputElement>(null);

  const importFile = async (f: File) => {
    try {
      const list = normalizeImport(JSON.parse(await f.text()));
      if (!list.length) { toast('No tasks found in that file.'); return; }
      const before = store.write(list);
      const added = [...before.values()].filter(v => v == null).length;
      toast(`Imported ${list.length} tasks · ${added} new, ${list.length - added} updated`, () => store.restore(before));
    } catch {
      toast('That file isn’t a tasks export.');
    }
  };

  return (
    <Section id="tasks" title="Your tasks" sub={repo.kind === 'supabase' ? 'synced to your account' : 'in this browser only'}>
      {repo.kind !== 'supabase' && <p className="note">Add Supabase keys to sync between devices.</p>}
      <div className="acts">
        <button type="button" className="btn sec sm" onClick={() => file.current?.click()}>Import from a file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
      </div>
    </Section>
  );
}

function AccountSection() {
  const { email, toast } = usePlanner();
  const [pw, setPw] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [pwRecent, setPwRecent] = useState(false);

  // A PIN can only be changed within 10 minutes of a password sign-in (the database checks this too).
  useEffect(() => {
    supabase().rpc('pin_status').then(({ data }) => setPwRecent((data?.password_age ?? Infinity) < 600));
  }, [pinOpen]);

  const changePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{6,12}$/.test(pin)) { toast('Use 6 to 12 digits.'); return; }
    if (pin !== pin2) { toast('The two PINs don’t match.'); return; }
    const { data, error } = await supabase().rpc('set_pin', { new_pin: pin });
    if (error || data !== 'ok') { toast(data === 'password-required' ? 'Sign out and sign in with your password first, then change the PIN within 10 minutes.' : 'Couldn’t change the PIN.'); return; }
    toast('PIN changed');
    setPin(''); setPin2(''); setPinOpen(false);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast('Use at least 8 characters.'); return; }
    const { error } = await supabase().auth.updateUser({ password: pw });
    toast(error ? error.message : 'Password updated');
    if (!error) { setPw(''); setPwOpen(false); }
  };

  return (
    <Section id="account" title="Account" sub={email ? `signed in as ${email}` : undefined}>
      {pwOpen ? (
        <form onSubmit={changePassword} autoComplete="off" className="set-form">
          <div className="fld"><label htmlFor="new-pw">New password</label>
            <input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
          <div className="acts"><button type="submit" className="btn pri sm">Save password</button>
            <button type="button" className="btn sec sm" onClick={() => setPwOpen(false)}>Cancel</button></div>
        </form>
      ) : pinOpen ? (
        pwRecent ? (
          <form onSubmit={changePin} autoComplete="off" className="set-form">
            <div className="fld"><label htmlFor="new-pin">New PIN (6 to 12 digits)</label>
              <input id="new-pin" type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} /></div>
            <div className="fld"><label htmlFor="new-pin2">New PIN again</label>
              <input id="new-pin2" type="password" inputMode="numeric" value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g, '').slice(0, 12))} /></div>
            <div className="acts"><button type="submit" className="btn pri sm">Save PIN</button>
              <button type="button" className="btn sec sm" onClick={() => setPinOpen(false)}>Cancel</button></div>
          </form>
        ) : (
          <>
            <p className="note">To change your PIN, sign out and sign in again with your password, then come back here within 10 minutes.</p>
            <div className="acts"><button type="button" className="btn sec sm" onClick={() => setPinOpen(false)}>OK</button></div>
          </>
        )
      ) : (
        <div className="acts">
          <button type="button" className="btn sec sm" onClick={() => setPinOpen(true)}>Change PIN</button>
          <button type="button" className="btn sec sm" onClick={() => setPwOpen(true)}>Change password</button>
          <button type="button" className="btn sec sm" onClick={() => supabase().auth.signOut()}>Sign out</button>
        </div>
      )}
    </Section>
  );
}
