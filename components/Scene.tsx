/**
 * The window: a painted view in layers, a few birds, dust in the light, and the frame around it.
 * The markup is the same for every view; the CSS variables from lib/prefs.ts (sceneVars) pick the art and colours,
 * and globals.css (.win) lays the layers out and moves them, transforms and opacity only.
 *   full   the sign-in screen: everything moves, the near fields pass by
 *   strip  the planner's window: calm, just clouds, light and birds
 *   thumb  a still picture for Settings
 */
import type { CSSProperties } from 'react';
import { LAYERS } from '@/lib/scenes';

const BIRD = 'M1 5C4 2 8 2.4 12 8 16 2.4 20 2 23 5';

/** Each flock: where it flies, how big each bird is, and where in its loop it starts. */
const FLOCKS = [
  { cls: 'f1', birds: [[0, 8, 22, 0], [26, 0, 16, -0.9], [44, 13, 14, -1.7]] },
  { cls: 'f2', birds: [[0, 0, 12, -0.4], [16, 6, 10, -1.2]] },
  { cls: 'f3', birds: [[0, 6, 15, -0.2], [19, 0, 11, -1.4], [32, 9, 10, -2.1], [47, 4, 9, -0.8]] },
];

/** Dust in the light, or fireflies at night: [left %, bottom %, size px, delay s, duration s]. */
const MOTES = [
  [12, 18, 3, -3, 40], [22, 30, 2, -14, 46], [35, 12, 2, -25, 40], [48, 24, 3, -8, 52], [61, 16, 2, -31, 40],
  [72, 34, 2, -19, 44], [84, 20, 3, -11, 40], [92, 10, 2, -36, 50], [6, 8, 2, -22, 48], [55, 6, 2, -5, 42],
  [30, 44, 2, -17, 46], [78, 52, 2, -27, 50],
];

/** Raindrops that run down the glass after the rain: [left %, top %, delay s, duration s]. */
const DRIPS = [[9, 6, -2, 9], [27, 22, -7, 11], [44, 4, -4, 7], [63, 30, -1, 9], [79, 12, -6, 11], [91, 34, -3, 7]];

export function View({ kind, style }: { kind: 'full' | 'strip' | 'thumb'; style?: CSSProperties }) {
  const still = kind === 'thumb';
  return (
    <div className={'win ' + kind} style={style} aria-hidden="true">
      <div className="stage">{LAYERS.map(l => <i key={l} className={'ly ' + l} />)}</div>
      {!still && (
        <>
          <div className="flocks">
            {FLOCKS.map(f => (
              <div key={f.cls} className={'flock ' + f.cls}>
                {f.birds.map(([x, y, w, d], i) => (
                  <i key={i} style={{ left: x, top: y, width: w, animationDelay: `${d}s` }}>
                    <svg viewBox="0 0 24 12"><path d={BIRD} style={{ animationDelay: `${d * 0.4}s` }} /></svg>
                  </i>
                ))}
              </div>
            ))}
          </div>
          <div className="motes">
            {MOTES.map(([x, y, s, d, t], i) => (
              <i key={i} style={{ left: `${x}%`, bottom: `${y}%`, width: s, height: s, animationDelay: `${d}s`, animationDuration: `${t}s` }} />
            ))}
          </div>
          <div className="drips">
            {DRIPS.map(([x, y, d, t], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s`, animationDuration: `${t}s` }} />)}
          </div>
        </>
      )}
      <div className="shade" />
      <div className="glass" />
    </div>
  );
}
