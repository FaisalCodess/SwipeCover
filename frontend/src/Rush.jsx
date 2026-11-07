import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { EmberField } from './MainMenu.jsx';
import { formatRushClock, RUSH_CRITICAL_MS, RUSH_MS, rushHeat } from './rush.js';

// ---------- The cave below the menu ----------
// Swipe Rush is played underground: the camera falls from the menu, through the earth, into a
// cave lit by crystals and lava. It sits below the menu the way the night sky sits above it.

// The ceiling of the cave: a ragged edge with stalactites hanging from it, built from a fixed
// seed so it is the same every time. `base` is how low the ceiling sits and `drops` how long
// the stalactites are, so a second, farther ceiling can be drawn hazier behind the near one.
function ceilingEdge(seed, base, drops) {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const points = [[0, base + 8]];
  let x = 0;
  while (x < 1600) {
    const width = 46 + random() * 96;
    const level = base + random() * 26;
    // Most are short bumps; a few are long stalactites.
    const drop = (random() < 0.3 ? 96 + random() * 150 : 18 + random() * 58) * drops;
    points.push([x + width * 0.3, level + drop * 0.28]);
    points.push([x + width * 0.5, level + drop]);
    points.push([x + width * 0.64, level + drop * 0.24]);
    points.push([x + width, level]);
    x += width;
  }
  return points.map(([px, py]) => [Math.round(px), Math.round(py)]);
}

const lineThrough = (points) => points.map(([px, py], index) => `${index ? 'L' : 'M'}${px} ${py}`).join('');
// Everything above an edge, as a closed shape.
const ceilingShape = (points) => `M0 0H1600V${points.at(-1)[1]}${[...points].reverse().map(([px, py]) => `L${px} ${py}`).join('')}Z`;

const EDGE = ceilingEdge(11, 206, 1);
const EDGE_LINE = lineThrough(EDGE);
const EARTH_SHAPE = ceilingShape(EDGE);
// The same ceiling farther back: lower, with shorter stalactites, drawn pale so it sits in the haze.
const FAR_SHAPE = ceilingShape(ceilingEdge(29, 262, 0.7));

// Layers of rock in the earth the camera falls through, and the veins of mineral running through it.
const STRATA = [
  'M0 38C260 22 520 52 800 36S1360 24 1600 44',
  'M0 74C220 92 470 62 760 80S1330 96 1600 70',
  'M0 112C300 98 560 128 840 110S1380 94 1600 118',
  'M0 150C240 168 500 140 820 156S1330 172 1600 148',
];
const VEINS = [
  { d: 'M-20 96C180 70 330 118 520 92S820 60 1010 98', tone: 'teal' },
  { d: 'M700 150C900 118 1080 164 1260 128S1500 100 1640 126', tone: 'amber' },
  { d: 'M120 20C210 46 260 84 244 140', tone: 'amber' },
  { d: 'M1320 14C1360 52 1330 96 1372 150', tone: 'teal' },
];

// The big rock walls that close the cave in from either side.
const WALL_LEFT = 'M0 190C70 210 130 262 150 340C172 430 120 520 150 610C176 690 130 780 90 900H0Z';
const WALL_RIGHT = 'M1600 170C1530 200 1470 250 1452 330C1430 420 1486 510 1450 606C1426 690 1470 790 1520 900H1600Z';
// The ground, with lava glowing between the rocks.
const FLOOR = 'M0 900V812L70 800L120 830L220 786L300 826L420 800L520 840L660 814L800 846L940 812L1060 838L1180 800L1290 832L1400 790L1500 822L1600 800V900Z';
// Cracks in the ground where the lava shows through.
const CRACKS = [
  'M150 900L168 860L148 836L176 812',
  'M360 900L384 868L366 846',
  'M560 900L548 872L578 850L566 830',
  'M740 900L762 874L746 852L770 832',
  'M930 900L912 868L940 846',
  'M1110 900L1130 866L1112 842L1138 820',
  'M1330 900L1316 870L1346 846',
  'M1500 900L1522 866L1504 838',
];

// One crystal: two lit faces and a bright edge, tipped like a gem.
function Prism({ x, y, height, width, tilt, light, dark }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <polygon points={`${-width},0 ${-width},${-height * 0.72} 0,${-height} 0,0`} fill={light} />
      <polygon points={`0,0 0,${-height} ${width},${-height * 0.72} ${width},0`} fill={dark} />
      <polyline points={`0,0 0,${-height}`} fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="1.2" />
    </g>
  );
}

const CLUSTER = [
  [0, 0, 160, 18, -6], [34, 8, 116, 14, 15], [-36, 10, 98, 13, -22], [64, 16, 74, 11, 31], [-64, 18, 66, 10, -35], [16, 2, 70, 9, 5],
];

// A cluster of crystals growing out of the rock. `tone` picks teal (like the menu's ice) or ember.
// The gradients it paints with are defined once, in the rock SVG below.
function CrystalCluster({ className, tone, size }) {
  const palette = tone === 'teal'
    ? { light: 'url(#crystal-teal-light)', dark: 'url(#crystal-teal-dark)' }
    : { light: 'url(#crystal-ember-light)', dark: 'url(#crystal-ember-dark)' };
  return (
    <svg className={`cave-crystals ${className}`} style={{ '--size': size }} viewBox="-120 -190 240 220" aria-hidden="true">
      {CLUSTER.map(([x, y, height, width, tilt]) => (
        <Prism key={`${x}-${tilt}`} x={x} y={y} height={height} width={width} tilt={tilt} light={palette.light} dark={palette.dark} />
      ))}
    </svg>
  );
}

// `heat` (0, 1, 2) is how little time is left: the lava brightens and the sparks climb faster.
const SPARK_RISE = [2.2, 3.4, 5];

export function CaveBelow({ heat = 0 }) {
  return (
    <div className="cave-below" data-heat={heat}>
      <div className="cave-base" />
      <svg className="cave-rock" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          {/* The earth is the darkest thing in the cave, so its stalactites read as silhouettes against the lit wall behind. */}
          <linearGradient id="cave-earth" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#080d14" />
            <stop offset=".5" stopColor="#07080d" />
            <stop offset="1" stopColor="#0a070b" />
          </linearGradient>
          <linearGradient id="cave-far" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1b1330" />
            <stop offset="1" stopColor="#2a1630" />
          </linearGradient>
          <linearGradient id="cave-rim" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#4ef3d0" stopOpacity=".7" />
            <stop offset=".5" stopColor="#ff9a52" stopOpacity=".8" />
            <stop offset="1" stopColor="#4ef3d0" stopOpacity=".7" />
          </linearGradient>
          <linearGradient id="cave-wall" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#05070b" />
            <stop offset="1" stopColor="#0d0d16" />
          </linearGradient>
          <linearGradient id="cave-wall-right" x1="1" x2="0" y1="0" y2="0">
            <stop offset="0" stopColor="#05070b" />
            <stop offset="1" stopColor="#0d0d16" />
          </linearGradient>
          <linearGradient id="crystal-teal-light" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#c8fff2" />
            <stop offset=".5" stopColor="#3fd9c8" />
            <stop offset="1" stopColor="#0d6670" />
          </linearGradient>
          <linearGradient id="crystal-teal-dark" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#2bb0ad" />
            <stop offset="1" stopColor="#082f3c" />
          </linearGradient>
          <linearGradient id="crystal-ember-light" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ffe0c2" />
            <stop offset=".5" stopColor="#ff7a4a" />
            <stop offset="1" stopColor="#8f1f2e" />
          </linearGradient>
          <linearGradient id="crystal-ember-dark" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#d6453d" />
            <stop offset="1" stopColor="#3a0d1c" />
          </linearGradient>
        </defs>
        <path d={FAR_SHAPE} fill="url(#cave-far)" />
        <path d={WALL_LEFT} fill="url(#cave-wall)" />
        <path d={WALL_RIGHT} fill="url(#cave-wall-right)" />
        <path d={WALL_LEFT} className="cave-wall-rim is-teal" />
        <path d={WALL_RIGHT} className="cave-wall-rim is-ember" />
        <path d={EARTH_SHAPE} fill="url(#cave-earth)" />
        {STRATA.map((d) => <path key={d} d={d} className="cave-strata" />)}
        {VEINS.map(({ d, tone }) => <path key={d} d={d} className={`cave-vein is-${tone}`} />)}
        <path d={EDGE_LINE} className="cave-edge" fill="none" stroke="url(#cave-rim)" />
      </svg>
      <div className="cave-shafts" />
      <div className="cave-glow" />
      <CrystalCluster className="is-left" tone="teal" size="clamp(150px, 27vh, 310px)" />
      <CrystalCluster className="is-right" tone="ember" size="clamp(130px, 23vh, 260px)" />
      <CrystalCluster className="is-left-high" tone="ember" size="clamp(80px, 13vh, 150px)" />
      <CrystalCluster className="is-right-high" tone="teal" size="clamp(86px, 14vh, 160px)" />
      <div className="cave-lava" />
      {/* The ground is drawn over the lava, so the lava seems to glow from between the rocks. */}
      <svg className="cave-front" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d={FLOOR} />
        {CRACKS.map((d) => <path key={d} d={d} className="cave-crack" />)}
      </svg>
      <div className="cave-mist" />
      <EmberField hues={[24, 6]} rise={SPARK_RISE[heat]} />
      <div className="cave-vignette" />
    </div>
  );
}

// ---------- The clock ----------

// The countdown, written straight to the page every frame so it never re-renders the board.
// With no `endsAt` yet (the camera is still falling) it shows the full time.
export function CountdownText({ endsAt, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    let frame;
    let shown = '';
    const tick = () => {
      const text = formatRushClock(endsAt === null ? RUSH_MS : endsAt - Date.now());
      if (text !== shown && ref.current) {
        ref.current.textContent = text;
        shown = text;
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [endsAt]);
  return <span ref={ref} role="timer" className={className} />;
}

// The bar under the HUD: full at the start, empty at the end.
function TimeBar({ endsAt }) {
  const ref = useRef(null);
  useEffect(() => {
    let frame;
    const tick = () => {
      const left = endsAt === null ? 1 : Math.min(1, Math.max(0, (endsAt - Date.now()) / RUSH_MS));
      if (ref.current) ref.current.style.transform = `scaleX(${left})`;
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [endsAt]);
  return <div className="rush-bar" aria-hidden="true"><i ref={ref} /></div>;
}

// 0, 1 or 2 (see rushHeat). Calls `onTick` with the seconds left, once a second, in the last ten.
export function useRushPressure(endsAt, active, onTick) {
  const [heat, setHeat] = useState(0);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

  useEffect(() => {
    if (!active || endsAt === null) {
      setHeat(0);
      return undefined;
    }
    let lastSecond = null;
    const check = () => {
      const left = endsAt - Date.now();
      setHeat(rushHeat(left));
      const second = Math.ceil(left / 1000);
      if (left > 0 && left <= RUSH_CRITICAL_MS && second !== lastSecond) {
        lastSecond = second;
        tickRef.current?.(second);
      }
    };
    check();
    const timer = window.setInterval(check, 100);
    return () => window.clearInterval(timer);
  }, [endsAt, active]);

  return heat;
}

// ---------- The screen's furniture ----------

export function RushHud({ solved, endsAt, ranked }) {
  return (
    <>
      <div className="game-hud rush-hud">
        <div className="rush-hud-left">
          <span className="game-level-label">
            SWIPE RUSH
            {!ranked && <em className="game-practice-tag" title="Not on the leaderboard: only your first Swipe Rush of the day counts">PRACTICE</em>}
          </span>
          <span className="rush-score" role="status" aria-label={`${solved} ${solved === 1 ? 'map' : 'maps'} cleared`}>
            <b key={solved}>{solved}</b>
            <small>{solved === 1 ? 'MAP' : 'MAPS'}</small>
          </span>
        </div>
        <div className="rush-clock">
          <Timer size={18} strokeWidth={1.5} />
          <CountdownText endsAt={endsAt} className="rush-countdown tabular-nums" />
        </div>
      </div>
      <TimeBar endsAt={endsAt} />
    </>
  );
}

const BANNER_TEXT = { ready: 'READY', go: 'GO!', time: "TIME'S UP" };

// A big word over the board: READY before a run that starts in place, GO! as the clock starts,
// TIME'S UP when it runs out.
export function RushBanner({ banner }) {
  if (!banner) return null;
  return (
    <div key={banner.id} className={`rush-banner is-${banner.kind}`} aria-hidden="true">
      <span>{BANNER_TEXT[banner.kind]}</span>
    </div>
  );
}
