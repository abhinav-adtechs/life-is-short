'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  LANGS, LIMITS, addFix, addHabit, addWords, forgetLearned, isSure, learnedCount, removeFix, removeWord, setHabit, setLang,
  setLearning, setNotes, type VoiceHabit,
} from '@/lib/voice';
import { usePlanner } from './Planner';
import { Opt } from './Controls';
import { XIcon } from './icons';

const byUse = <T extends { source: string; uses: number; at: number }>(a: T, b: T) =>
  (a.source === 'you' ? 0 : 1) - (b.source === 'you' ? 0 : 1) || b.uses - a.uses || b.at - a.at;
const chats = (n: number) => `${n} chat${n === 1 ? '' : 's'}`;

/** A text field that saves as you pause and when you leave it, so nothing typed is lost by closing Settings. */
function useSaved(value: string, save: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  const timer = useRef(0);
  const latest = useRef({ draft, value, save });
  latest.current = { draft, value, save };
  useEffect(() => setDraft(value), [value]);
  const flush = () => {
    clearTimeout(timer.current);
    timer.current = 0;
    const l = latest.current;
    if (l.draft !== l.value) l.save(l.draft);
  };
  useEffect(() => () => { if (timer.current) flush(); }, []);
  const set = (v: string) => {
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 800);
  };
  return { draft, set, flush };
}

/** A habit, edited in place: it wraps to fit, and saves when you leave it. Emptied, it's removed. */
function HabitRow({ h }: { h: VoiceHabit }) {
  const { voice } = usePlanner();
  const [text, setText] = useState(h.text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(h.text), [h.text]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);
  const commit = () => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t !== h.text) voice.change(setHabit(h.text, t));
  };
  return (
    <li className={`v-${h.source}`}>
      <span className="rep-b">
        <textarea ref={box} rows={1} aria-label="Habit" value={text} maxLength={LIMITS.habit} enterKeyHint="done"
          onChange={e => setText(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
        <span className="note">{h.source === 'you' ? 'Yours' : `Learned · ${chats(h.uses)}`}</span>
      </span>
      <button type="button" className="btn text sm" onClick={() => voice.change(setHabit(h.text, ''))}>Remove</button>
    </li>
  );
}

/**
 * Settings → Voice: how the mic and the AI hear you (lib/voice.ts). The language the mic listens for, how you talk in
 * your own words, and what each applied chat taught it: names and words, what the mic mishears, and habits. Everything
 * it learned is marked, and you can change or remove any of it.
 */
export function VoiceSection() {
  const { voice, toast } = usePlanner();
  const p = voice.profile;
  const id = useId();
  const notes = useSaved(p.notes, v => voice.change(setNotes(v)));
  const [word, setWord] = useState('');
  const [heard, setHeard] = useState('');
  const [meant, setMeant] = useState('');
  const [habit, setHabitText] = useState('');
  const device = typeof navigator === 'undefined' ? '' : navigator.language;
  const deviceName = LANGS.find(l => l.id === device)?.name ?? device;
  const words = [...p.words].sort(byUse);
  const fixes = [...p.fixes].sort(byUse);
  const habits = [...p.habits].sort(byUse);
  const learned = learnedCount(p);

  const forget = () => {
    const before = p;
    voice.change(forgetLearned());
    toast('Forgot what it learned. What you added stays.', () => voice.change(() => before));
  };

  return (
    <section id="set-voice" className="set-sec" aria-labelledby="set-voice-h">
      <div className="set-h"><h3 id="set-voice-h">Voice</h3><span className="muted sm">how the mic and the AI hear you</span></div>
      <p className="note">
        Each chat you apply teaches it your names and words, what the mic mishears and how you put things. Change anything
        here; what it learned is dotted.
      </p>

      <div className="fld">
        <label htmlFor={`${id}-lang`}>Language the mic listens for</label>
        <select id={`${id}-lang`} value={p.lang ?? ''} onChange={e => voice.change(setLang(e.target.value || null))}>
          <option value="">Your device’s{deviceName ? ` · ${deviceName}` : ''}</option>
          {LANGS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          {p.lang && !LANGS.some(l => l.id === p.lang) && <option value={p.lang}>{p.lang}</option>}
        </select>
        <p className="note">If it mishears your accent, pick yours. English (India) knows Indian names, places and the way they’re said.</p>
      </div>

      <Opt label="Learn from my chats" note="From each chat you apply, never from one you discard."
        toggle={{ checked: p.learn, onChange: on => voice.change(setLearning(on)) }} />

      <div className="fld">
        <label htmlFor={`${id}-notes`}>How you talk</label>
        <textarea id={`${id}-notes`} rows={3} maxLength={LIMITS.notes} value={notes.draft} onChange={e => notes.set(e.target.value)} onBlur={notes.flush}
          placeholder="I mix in Hindi: “kal” is tomorrow, “parso” the day after. EOD means 6 PM. Standup is 10:30 on weekdays." />
        <p className="note">In your own words. The AI reads it every time you dump something.</p>
      </div>

      <div className="fld">
        <span className="flabel" id={`${id}-w`}>Names and words</span>
        {words.length > 0 && (
          <ul className="vwords" aria-labelledby={`${id}-w`}>
            {words.map(w => (
              <li key={w.text} className={`v-${w.source}`} title={w.source === 'you' ? 'Yours' : `Learned · ${chats(w.uses)}`}>
                <span>{w.text}</span>
                <button type="button" aria-label={`Remove ${w.text}`} onClick={() => voice.change(removeWord(w.text))}><XIcon size={11} /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="vadd" onSubmit={e => { e.preventDefault(); if (word.trim()) { voice.change(addWords(word)); setWord(''); } }}>
          <input className="input" type="text" aria-label="Add names and words" placeholder="Add names, places or terms, separated by commas"
            value={word} onChange={e => setWord(e.target.value)} disabled={p.words.length >= LIMITS.words} />
          <button type="submit" className="btn sec sm" disabled={!word.trim()}>Add</button>
        </form>
        <p className="note">The mic listens out for these, and the AI spells them your way. Names in your tasks and your labels count too.</p>
      </div>

      <div className="fld">
        <span className="flabel" id={`${id}-f`}>What the mic mishears</span>
        {fixes.length > 0 && (
          <ul className="vlist" aria-labelledby={`${id}-f`}>
            {fixes.map(f => (
              <li key={f.heard} className={`v-${f.source}`}>
                <span className="rep-b">
                  <span className="vfix">“{f.heard}” <span aria-label="means">→</span> <b>{f.meant}</b></span>
                  <span className="note">{f.source === 'you' ? 'Yours' : 'Learned'} · {isSure(f) ? 'fixed as you speak' : 'a hint for the AI until it comes up again'}</span>
                </span>
                <button type="button" className="btn text sm" onClick={() => voice.change(removeFix(f.heard))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <form className="vadd" onSubmit={e => {
          e.preventDefault();
          if (!heard.trim() || !meant.trim()) return;
          voice.change(addFix(heard, meant));
          setHeard(''); setMeant('');
        }}>
          <input className="input" type="text" aria-label="The mic hears" placeholder="It hears" value={heard} maxLength={LIMITS.word} onChange={e => setHeard(e.target.value)} />
          <input className="input" type="text" aria-label="You said" placeholder="You said" value={meant} maxLength={LIMITS.word} onChange={e => setMeant(e.target.value)} />
          <button type="submit" className="btn sec sm" disabled={!heard.trim() || !meant.trim()}>Add</button>
        </form>
        <p className="note">Ones you add, and ones it learned in two chats, are fixed as you speak. The rest help the AI read you.</p>
      </div>

      <div className="fld">
        <span className="flabel" id={`${id}-h`}>Habits</span>
        {habits.length > 0 && <ul className="vlist" aria-labelledby={`${id}-h`}>{habits.map(h => <HabitRow key={h.text} h={h} />)}</ul>}
        <form className="vadd" onSubmit={e => { e.preventDefault(); if (habit.trim()) { voice.change(addHabit(habit)); setHabitText(''); } }}>
          <input className="input" type="text" aria-label="Add a habit" placeholder="Add one, like “gym” means 7 AM" value={habit}
            maxLength={LIMITS.habit} onChange={e => setHabitText(e.target.value)} />
          <button type="submit" className="btn sec sm" disabled={!habit.trim()}>Add</button>
        </form>
        <p className="note">How you put things, so it reads you right next time. It notes one now and then as you go.</p>
      </div>

      <p className="note">
        {p.chats ? `Learned from ${chats(p.chats)}.` : 'Nothing learned yet.'}{' '}
        {learned > 0 && <button type="button" className="link" onClick={forget}>Forget what it learned</button>}
      </p>
    </section>
  );
}
