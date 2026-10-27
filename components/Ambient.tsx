'use client';

import { usePlanner } from './Planner';

/**
 * The light moving through the planner. On the trains, bands of light from passing platforms sweep across the screen
 * every so often, warm then cool; at night the edges dim. Tide's water lives on the calendar instead (the wash under
 * the now line and its ripple). Settings → Ambient light halves it or holds it still; reduced motion stops it.
 */
export function Ambient() {
  const { theme } = usePlanner();
  if (theme === 'tide') return null;
  return (
    <div className="ambient" aria-hidden="true">
      {theme === 'night' ? <><i className="lamp" /><i className="tube" /><i className="vignette" /></> : <><i className="glint" /><i className="sky" /></>}
    </div>
  );
}
