/**
 * The breathing sky behind every screen: sky, drifting clouds, open fields, a few birds and a little dust.
 * Static markup animated by globals.css (the .sc-* rules), so it costs no script. Dark mode turns it to dusk,
 * reduced motion holds it still, and Settings → Background → Plain hides it.
 */

const BIRD = 'M1 5C4 2 8 2.4 12 8 16 2.4 20 2 23 5';

/** Each flock: where it flies, how big each bird is, and where in its loop it starts. */
const FLOCKS = [
  { cls: 'f1', birds: [[0, 8, 24, 0], [28, 0, 18, -0.9], [48, 14, 15, -1.7]] },
  { cls: 'f2', birds: [[0, 0, 13, -0.4], [17, 7, 11, -1.2]] },
  { cls: 'f3', birds: [[0, 6, 16, -0.2], [20, 0, 12, -1.4], [34, 10, 10, -2.1], [50, 4, 9, -0.8]] },
];

/** Dust in the sunlight by day, fireflies at dusk: [left %, bottom %, size px, delay s, duration s]. */
const MOTES = [
  [12, 18, 3, -3, 40], [22, 30, 2, -14, 46], [35, 12, 2, -25, 40], [48, 24, 3, -8, 52], [61, 16, 2, -31, 40],
  [72, 34, 2, -19, 44], [84, 20, 3, -11, 40], [92, 10, 2, -36, 50], [6, 8, 2, -22, 48], [55, 6, 2, -5, 42],
];

/** Stars at dusk: [x, y, r, twinkles]. */
const STARS = [
  [120, 70, 1.2, 0], [270, 170, 1, 0], [410, 48, 1.5, 0], [580, 120, 1.2, 1], [730, 32, 1.3, 0], [860, 144, 1, 1],
  [930, 64, 1.2, 0], [50, 208, 1, 1], [340, 264, 1.3, 0], [660, 232, 1, 0], [480, 196, 1.1, 1], [190, 18, 1, 0], [800, 90, 1.2, 1],
];

/** Puffs of each cloud as [cx, cy, r]; the first is the flat base, drawn as an ellipse [cx, cy, rx, ry]. */
const CLOUDS = [
  [[380, 292, 236, 40], [270, 254, 60], [350, 220, 86], [452, 242, 70], [530, 276, 42]],
  [[1228, 170, 136, 22], [1160, 146, 44], [1226, 122, 60], [1300, 146, 42]],
  [[866, 376, 84, 12], [828, 362, 25], [866, 348, 33], [906, 362, 23]],
  [[1486, 347, 120, 17], [1430, 330, 37], [1488, 310, 49], [1548, 332, 35]],
];

function Cloud({ puffs, grow = 0, dy = 0 }: { puffs: number[][]; grow?: number; dy?: number }) {
  const [[cx, cy, rx, ry], ...rest] = puffs;
  return (
    <>
      <ellipse cx={cx} cy={cy + dy} rx={rx + grow * 2} ry={ry + grow} />
      {rest.map(([x, y, r], i) => <circle key={i} cx={x} cy={y + dy} r={r + grow} />)}
    </>
  );
}

export default function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <div className="sc-sky" />
      <svg className="sc-stars" viewBox="0 0 1000 400" preserveAspectRatio="none">
        {STARS.map(([x, y, r, tw], i) => <circle key={i} cx={x} cy={y} r={r} className={tw ? 'tw' : undefined} />)}
      </svg>
      <div className="sc-glow" />
      <div className="sc-clouds">
        <svg viewBox="0 0 1600 600" preserveAspectRatio="xMidYMin slice">
          <defs>
            <filter id="sc-fluff" x="-30%" y="-60%" width="160%" height="220%">
              <feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves={3} seed={4} />
              <feDisplacementMap in="SourceGraphic" scale={46} xChannelSelector="R" yChannelSelector="G" />
              <feGaussianBlur stdDeviation={4} />
            </filter>
          </defs>
          <g className="sc-cloud" filter="url(#sc-fluff)" transform="translate(160 40) scale(.8)">
            <g className="sc-shade">{CLOUDS.map((c, i) => <Cloud key={i} puffs={c} grow={2} dy={10} />)}</g>
            <g>{CLOUDS.map((c, i) => <Cloud key={i} puffs={c} />)}</g>
          </g>
        </svg>
      </div>
      <div className="sc-birds">
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
      <div className="sc-land">
        <svg viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="sc-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="sc-mid0" /><stop offset="1" className="sc-mid1" /></linearGradient>
            <linearGradient id="sc-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="sc-near0" /><stop offset="1" className="sc-near1" /></linearGradient>
          </defs>
          <path className="sc-far" d="M0 236C170 214 330 222 520 232 720 242 880 198 1090 206 1290 214 1450 236 1600 226V420H0Z" />
          <path className="sc-tree" d="M1121 276v-16h3v16zM1122.5 262a15 13 0 1 1 .1 0zM1108 268a9 8 0 1 1 .1 0zM1137 268a9 8 0 1 1 .1 0z" />
          <path fill="url(#sc-mid)" d="M0 296C170 270 350 258 560 280 770 302 960 262 1170 270 1380 278 1500 300 1600 290V420H0Z" />
          <path fill="url(#sc-near)" d="M0 352C240 322 520 330 770 346 1010 361 1270 324 1600 340V420H0Z" />
        </svg>
      </div>
      <div className="sc-haze" />
      <div className="sc-breath" />
      <div className="sc-motes">
        {MOTES.map(([x, y, s, d, t], i) => (
          <i key={i} style={{ left: `${x}%`, bottom: `${y}%`, width: s, height: s, animationDelay: `${d}s`, animationDuration: `${t}s` }} />
        ))}
      </div>
      <div className="sc-grain" />
    </div>
  );
}
