'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizeImport } from '@/lib/importer';
import { hasSupabase, supabase } from '@/lib/supabase';
import { ACCENTS, DEFAULT_PREFS, FONTS, HOUR_HEIGHTS, SURFACES, TEXT_SIZES, accentPair, fontHref, palettes, type Prefs } from '@/lib/prefs';
import { isHex } from '@/lib/color';
import { fmtHour, fmtRange, fmtTime } from '@/lib/format';
import { ACCOUNT_COLORS } from '@/lib/google-client';
import { atMinutes, startOfDay } from '@/lib/time';
import { usePlanner } from './Planner';
import { useMedia, prefersReducedMotion } from './hooks';
import { BackIcon, CheckIcon, MicIcon } from './icons';
import { Choice, Opt, radio, radioKeys } from './Controls';
import { GoogleSection } from './GoogleSection';

const SECTIONS = [
  { id: 'appearance', name: 'Appearance' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'google', name: 'Google accounts' },
  { id: 'tasks', name: 'Your tasks' },
  { id: 'account', name: 'Account', needsSupabase: true },
];

const APPEARANCE_KEYS = ['mode', 'surface', 'accent', 'font', 'textSize', 'corners', 'density', 'contrast', 'trueBlack', 'motion', 'clock'] as const;

/** Settings as a full page over the planner. Every change applies straight away; there's nothing to save. */
export function Settings({ section, onClose }: { section: string; onClose: () => void }) {
  const page = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(section);
  const sections = SECTIONS.filter(s => !s.needsSupabase || hasSupabase());

  useEffect(() => {
    page.current?.focus({ preventScroll: true });
    if (section !== 'appearance') document.getElementById(`set-${section}`)?.scrollIntoView({ block: 'start' });
    setCurrent(section);
  }, [section]);

  // Highlight the section being read.
  useEffect(() => {
    const root = page.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setCurrent(hit.target.id.replace('set-', ''));
    }, { root, rootMargin: '-30% 0px -60% 0px' });
    root.querySelectorAll('.sp-sec').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const go = (id: string) => {
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#settings/${id}`);
    setCurrent(id);
  };

  return (
    <div ref={page} className="setpage" role="dialog" aria-modal="true" aria-labelledby="set-h" tabIndex={-1}>
      <header className="sp-top">
        <button type="button" className="ib" aria-label="Back to the planner" onClick={onClose}><BackIcon /></button>
        <h1 id="set-h">Settings</h1>
        <span className="sp-saved">Changes apply as you make them</span>
      </header>
      <div className="sp-body">
        <nav className="sp-nav" aria-label="Settings sections">
          {sections.map(s => (
            <button key={s.id} type="button" aria-current={current === s.id ? 'true' : undefined} onClick={() => go(s.id)}>{s.name}</button>
          ))}
        </nav>
        <div className="sp-main">
          <Appearance />
          <CalendarPrefs />
          <GoogleSection />
          <TasksSection />
          {hasSupabase() && <AccountSection />}
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`set-${id}`} className="sp-sec" aria-labelledby={`set-${id}-h`}>
      <h2 id={`set-${id}-h`}>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </section>
  );
}

/* ---------- appearance ---------- */

/** Load every font option once while Settings is open, so each card shows its own face. */
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

/** A small Now block and calendar column drawn with the current settings. */
function Preview() {
  const { accounts, prefs } = usePlanner();
  const today = startOfDay(Date.now());
  const colors = accounts.length ? accounts.map(a => a.color) : ACCOUNT_COLORS;
  const tinted = prefs.colorBy === 'account' || prefs.colorBy === 'calendar';
  const hour = Math.min(prefs.hourHeight, 56);
  const blocks = [
    { title: 'Design review', start: 9.5, len: 60, color: tinted ? colors[0] : prefs.colorBy === 'priority' ? 'var(--muted)' : null },
    { title: 'Call the bank', start: 11, len: 30, color: prefs.colorBy === 'priority' ? 'var(--accent)' : null },
    { title: 'Team sync', start: 11.75, len: 45, color: tinted ? colors[1 % colors.length] : null },
  ];
  return (
    <div className="preview" aria-hidden="true">
      <div className="pv-now">
        <div className="nl"><i />Now</div>
        <div className="pv-t">Call the bank about the card</div>
        <div className="nm">Urgent · 30 min · until {fmtTime(atMinutes(today, 11 * 60 + 30))}</div>
        <div className="acts"><span className="btn pri">Done</span><span className="btn sec">Schedule</span></div>
        <div className="pv-cap"><span className="field"><span>Dump a task…</span></span><span className="mic"><MicIcon size={20} /></span></div>
      </div>
      <div className="pv-cal" style={{ height: hour * 4 }}>
        {[9, 10, 11, 12].map((h, i) => <span key={h} className="pv-h" style={{ top: i * hour }}>{fmtHour(h)}</span>)}
        <div className="pv-col">
          {blocks.map(b => {
            const h = Math.max(20, (b.len / 60) * hour - 4);
            return (
              <div key={b.title} className={'block' + (b.len <= 30 || h < 30 ? ' small' : h < 52 ? ' mid' : '') + (b.color ? ' tint' : '')}
                style={{ top: (b.start - 9) * hour + 2, height: h, left: 4, right: 4, ...(b.color ? { '--c': b.color } as React.CSSProperties : {}) }}>
                <div className="bt">{b.title}</div>
                <div className="bm">{fmtRange(atMinutes(today, b.start * 60), b.len)}</div>
              </div>
            );
          })}
          <div className="nowline" style={{ top: 1.6 * hour }}><i /></div>
        </div>
      </div>
    </div>
  );
}

function Appearance() {
  const { prefs, setPrefs, toast } = usePlanner();
  const sysDark = useMedia('(prefers-color-scheme: dark)');
  const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && sysDark);
  useFontPreviews();
  const pal = palettes(prefs);
  const custom = isHex(prefs.accent);
  const shown = accentPair(prefs.accent, pal.light, pal.dark);
  const nudged = custom && (dark ? shown.adjusted.dark : shown.adjusted.light);

  const reset = () => {
    const before = Object.fromEntries(APPEARANCE_KEYS.map(k => [k, prefs[k]])) as Partial<Prefs>;
    setPrefs(Object.fromEntries(APPEARANCE_KEYS.map(k => [k, DEFAULT_PREFS[k]])) as Partial<Prefs>);
    toast('Appearance back to the defaults', () => setPrefs(before));
  };

  return (
    <Section id="appearance" title="Appearance" lead="Light or dark is set per device. Everything else follows you to your other devices.">
      <Preview />

      <Opt label="Mode" note="This device only. System follows your phone or computer." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.mode} onChange={mode => setPrefs({ mode })}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        )}
      </Opt>

      <Opt label="Theme" note="The colour of the page, cards and lines. Each has a light and a dark side." stack>
        {({ labelId }) => (
          <div className="themes" role="radiogroup" aria-labelledby={labelId} onKeyDown={radioKeys}>
            {SURFACES.map(s => (
              <button key={s.id} type="button" className="theme" {...radio(prefs.surface === s.id)} onClick={() => setPrefs({ surface: s.id })}>
                <span className="tp" aria-hidden="true">
                  {[s.light, s.dark].map((p, i) => (
                    <span key={i} style={{ background: p.bg }}>
                      <i style={{ background: p.ink, width: '70%' }} /><i style={{ background: p.muted, width: '45%' }} /><i style={{ background: p.block, height: 14 }} />
                    </span>
                  ))}
                </span>
                <b>{s.name}</b>
              </button>
            ))}
          </div>
        )}
      </Opt>

      <Opt label="Accent colour" note={<>The mic, the current-time line, today’s date and drop targets.{nudged ? ' Your colour is adjusted slightly here so it stays readable.' : ''}</>} stack>
        {({ labelId }) => (
          <div className="swatches" role="radiogroup" aria-labelledby={labelId} onKeyDown={radioKeys}>
            {ACCENTS.map(a => (
              <button key={a.id} type="button" className="swatch" {...radio(prefs.accent === a.id)} aria-label={a.name} title={a.name}
                style={{ '--c': dark ? a.dark : a.light } as React.CSSProperties} onClick={() => setPrefs({ accent: a.id })}>
                <CheckIcon size={14} />
              </button>
            ))}
            <label className={'swatch custom' + (custom ? ' on' : '')} title="Your own colour"
              style={custom ? ({ '--c': dark ? shown.dark : shown.light } as React.CSSProperties) : undefined}>
              <input type="color" aria-label="Your own colour" value={custom ? prefs.accent.toLowerCase() : '#f04a0c'}
                onChange={e => setPrefs({ accent: e.target.value })} />
              {custom && <CheckIcon size={14} />}
            </label>
          </div>
        )}
      </Opt>

      <Opt label="Font" stack>
        {({ labelId }) => (
          <div className="fonts" role="radiogroup" aria-labelledby={labelId} onKeyDown={radioKeys}>
            {FONTS.map(f => (
              <button key={f.id} type="button" className="fontc" {...radio(prefs.font === f.id)} onClick={() => setPrefs({ font: f.id })}
                style={{ fontFamily: f.stack }}>
                <span className="fa" aria-hidden="true">Aa</span>
                <span className="fn">{f.name}</span>
                <span className="fd">{f.note}</span>
              </button>
            ))}
          </div>
        )}
      </Opt>

      <Opt label="Text size" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.textSize} onChange={textSize => setPrefs({ textSize })}
            options={TEXT_SIZES.map(t => ({ value: t.value, label: <span style={{ fontSize: `${t.value * 14}px` }}>{t.label}</span> }))} />
        )}
      </Opt>

      <Opt label="Corners" note="How round buttons, cards and calendar blocks are." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.corners} onChange={corners => setPrefs({ corners })}
            options={[{ value: 'round', label: 'Round' }, { value: 'soft', label: 'Soft' }, { value: 'square', label: 'Square' }]} />
        )}
      </Opt>

      <Opt label="List density" note="Space between rows in the backlog." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.density} onChange={density => setPrefs({ density })}
            options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }, { value: 'roomy', label: 'Roomy' }]} />
        )}
      </Opt>

      <Opt label="Increase contrast" note="Darker secondary text, stronger lines and outlined calendar blocks."
        toggle={{ checked: prefs.contrast, onChange: contrast => setPrefs({ contrast }) }} />
      <Opt label="Pure black in dark mode" note="A true black background for OLED screens."
        toggle={{ checked: prefs.trueBlack, onChange: trueBlack => setPrefs({ trueBlack }) }} />

      <Opt label="Motion" note="Reduced turns off animations, the mic’s ripple included. System follows your device." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.motion} onChange={motion => setPrefs({ motion })}
            options={[{ value: 'system', label: 'System' }, { value: 'full', label: 'On' }, { value: 'reduce', label: 'Reduced' }]} />
        )}
      </Opt>

      <Opt label="Clock" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.clock} onChange={clock => setPrefs({ clock })}
            options={[{ value: '12', label: '12-hour · 2:30 PM' }, { value: '24', label: '24-hour · 14:30' }]} />
        )}
      </Opt>

      <div className="sacts"><button type="button" className="btn sec" onClick={reset}>Reset appearance</button></div>
    </Section>
  );
}

/* ---------- calendar ---------- */

const hourLabel = (h: number) => (h === 24 ? 'Midnight' : fmtHour(h));

function CalendarPrefs() {
  const { prefs, setPrefs, view, setView } = usePlanner();
  return (
    <Section id="calendar" title="Calendar">
      <Opt label="View" note="This device only. You can also switch from the calendar." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={view} onChange={setView}
            options={[{ value: 'day', label: 'Day' }, { value: 'work', label: '5 days' }, { value: 'week', label: '7 days' }, { value: 'month', label: 'Month' }]} />
        )}
      </Opt>

      <Opt label="5-day view shows" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.fiveDay} onChange={fiveDay => setPrefs({ fiveDay })}
            options={[{ value: 'workweek', label: 'Mon to Fri' }, { value: 'rolling', label: 'Next 5 days' }]} />
        )}
      </Opt>

      <Opt label="Week starts on" stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.weekStart} onChange={weekStart => setPrefs({ weekStart })}
            options={[{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }, { value: 6, label: 'Saturday' }]} />
        )}
      </Opt>

      <Opt label="Your day" note="The calendar shows these hours and stretches to fit anything outside them. Next free slot and AI sorting place tasks inside them." stack>
        {({ labelId }) => (
          <div className="two hours" role="group" aria-labelledby={labelId}>
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

      <Opt label="Hour height" note="How tall an hour is on the day and week grids." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.hourHeight} onChange={hourHeight => setPrefs({ hourHeight })}
            options={HOUR_HEIGHTS.map(h => ({ value: h.value, label: h.label }))} />
        )}
      </Opt>

      <Opt label="Colour events by" note="Account and Google calendar colours apply to pulled events; your own tasks stay plain." stack>
        {({ labelId }) => (
          <Choice labelledBy={labelId} value={prefs.colorBy} onChange={colorBy => setPrefs({ colorBy })}
            options={[{ value: 'account', label: 'Account' }, { value: 'calendar', label: 'Google calendar' }, { value: 'priority', label: 'Priority' }, { value: 'none', label: 'None' }]} />
        )}
      </Opt>

      <Opt label="Show done tasks" note="Past Google events count as done." toggle={{ checked: prefs.showDone, onChange: showDone => setPrefs({ showDone }) }} />
      <Opt label="Shade weekends" toggle={{ checked: prefs.shadeWeekends, onChange: shadeWeekends => setPrefs({ shadeWeekends }) }} />
      <Opt label="Week numbers" note="ISO weeks, in the title and down the side of the month."
        toggle={{ checked: prefs.weekNumbers, onChange: weekNumbers => setPrefs({ weekNumbers }) }} />
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
    <Section id="tasks" title="Your tasks"
      lead={repo.kind === 'supabase' ? 'Synced to your account across devices.' : 'Saved in this browser only. Add Supabase keys to sync between devices.'}>
      <div className="sacts">
        <button type="button" className="btn sec" onClick={() => file.current?.click()}>Import from a file</button>
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

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast('Use at least 8 characters.'); return; }
    const { error } = await supabase().auth.updateUser({ password: pw });
    toast(error ? error.message : 'Password updated');
    if (!error) { setPw(''); setPwOpen(false); }
  };

  return (
    <Section id="account" title="Account" lead={email ? `Signed in as ${email}` : undefined}>
      {pwOpen ? (
        <form onSubmit={changePassword} autoComplete="off" className="pwform">
          <div className="fld"><label htmlFor="new-pw">New password</label>
            <input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
          <div className="sacts"><button type="submit" className="btn pri">Save password</button>
            <button type="button" className="btn sec" onClick={() => setPwOpen(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="sacts">
          <button type="button" className="btn sec" onClick={() => setPwOpen(true)}>Change password</button>
          <button type="button" className="btn sec" onClick={() => supabase().auth.signOut()}>Sign out</button>
        </div>
      )}
    </Section>
  );
}
