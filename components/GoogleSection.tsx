'use client';

import { usePlanner } from './Planner';

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Connect Google Calendar and Google Tasks, and pull them in. */
export function GoogleSection() {
  const { google, pullGoogle, connectGoogle, removeGoogle, pulling } = usePlanner();
  return (
    <>
      <h3>Google Calendar and Tasks</h3>
      {google ? (
        <>
          <p>{google.email ? `Connected as ${google.email}` : 'Connected'}</p>
          <p className="muted">
            {pulling ? 'Pulling…' : google.pulledAt ? `Last pulled ${ago(google.pulledAt)}. ` : ''}
            Pulls events from today through the next month, and your Google Tasks. Changes in Google update the title and time here.
          </p>
          <div className="sacts">
            <button type="button" className="btn sec" disabled={pulling} onClick={() => pullGoogle(false)}>Pull now</button>
            <button type="button" className="btn sec" onClick={removeGoogle}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Pull your calendar events and Google Tasks into the planner. Read-only: nothing is written back to Google.</p>
          <div className="sacts"><button type="button" className="btn sec" onClick={connectGoogle}>Connect Google</button></div>
        </>
      )}
    </>
  );
}
