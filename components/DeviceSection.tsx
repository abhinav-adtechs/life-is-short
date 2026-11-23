'use client';

import { useCallback, useEffect, useState } from 'react';
import { liveActivity, native, type LiveActivityChange, type LiveActivityStatus } from '@/lib/native';
import { fmtHour } from '@/lib/format';
import { usePlanner } from './Planner';
import { Choice, Opt } from './Controls';

/** Settings → On this iPhone: the Lock Screen's Now (docs/apple.md → Live Activity), only in the app that offers it. */
export function DeviceSection() {
  const { prefs } = usePlanner();
  const [status, setStatus] = useState<LiveActivityStatus | null>(null);
  const device = native()?.platform === 'ipados' ? 'iPad' : 'iPhone';

  const load = useCallback(() => { liveActivity().then(s => { if (s) setStatus(s); }); }, []);

  // Live Activities can be switched off in the iPhone's own Settings: look again on coming back.
  useEffect(() => {
    load();
    const back = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [load]);

  const change = (c: LiveActivityChange) => {
    setStatus(s => (s ? { ...s, ...c } : s));
    liveActivity(c).then(s => { if (s) setStatus(s); });
  };

  const [showing, setShowing] = useState(false);
  const show = () => {
    setShowing(true);
    liveActivity({ show: true }).then(s => { if (s) setStatus(s); }).finally(() => setShowing(false));
  };

  if (!status) return null;
  const ends = prefs.dayEnd === 24 ? 'midnight' : fmtHour(prefs.dayEnd);
  return (
    <section id="set-device" className="set-sec" aria-labelledby="set-device-h">
      <div className="set-h"><h3 id="set-device-h">On this {device}</h3><span className="muted sm">only in the app</span></div>
      <Opt label="Now on the Lock Screen"
        note={`The task for now, pinned to your Lock Screen${device === 'iPhone' ? ' and the Dynamic Island' : ''}, counting down its slot. It updates while the planner is open, and when you tap refresh on it.`}
        toggle={{ checked: status.on, onChange: on => change({ on }) }} />
      {status.on && !status.enabled && (
        <p className="note">Live Activities are off for Life is short. Turn them on in the {device}’s Settings → Life is short.</p>
      )}
      {status.enabled && (
        <Opt label="Show it now"
          note={status.showing
            ? 'Puts up a fresh one, even outside your day’s hours: use it if the Lock Screen shows nothing.'
            : 'Puts it on the Lock Screen now, even outside your day’s hours or after you swiped it away.'}>
          {({ noteId }) => (
            <button type="button" className="btn sec sm" onClick={show} disabled={showing} aria-describedby={noteId}>
              {showing ? 'Showing…' : status.showing ? 'Show again' : 'Show now'}
            </button>
          )}
        </Opt>
      )}
      {status.on && (
        <>
          <Opt label="Look" stack>
            {({ labelId }) => (
              <Choice labelledBy={labelId} value={status.style} onChange={style => change({ style })}
                options={[{ value: 'window', label: 'The window' }, { value: 'theme', label: 'Your theme' }]} />
            )}
          </Opt>
          <Opt label="Hide task names" note="Shows each task’s goal colour and times, but not its name."
            toggle={{ checked: status.hideTitles, onChange: hideTitles => change({ hideTitles }) }} />
          <p className="note">
            It ends with your day, at {ends}, or after 8 hours, whichever comes first. Open the planner or tap Show now to start it again.
            To keep it fresh without opening the app, run Show Now from a Shortcuts automation at the times you choose.
          </p>
        </>
      )}
    </section>
  );
}
