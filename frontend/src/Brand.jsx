// The game's logo: a cut-corner emblem (the board's frame) holding a tiny board. The ball slides
// right and then down, lighting the squares it covers, over and over: the whole game in one mark.
// The wordmark beside it has a streak under it that a glint sweeps along in time with the ball.
// All the motion is CSS (see brand.css), on transforms and fills only, so it never costs a frame
// while the logo glides between the menu and the game.

const PITCH = 10;
const START = 6.25;
const CELL = 7.5;
const at = (index) => START + index * PITCH;

// [row, col, seconds into the loop at which the ball covers it]
const COVERED = [
  [0, 0, 0.4],
  [0, 1, 0.95],
  [0, 2, 1.5],
  [1, 2, 2.35],
  [2, 2, 2.9],
];
const OPEN = [[1, 0], [2, 0], [2, 1]];

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <radialGradient id="brand-ball-fill" cx="0.34" cy="0.28" r="0.8">
          <stop offset="0" stopColor="#fff1f2" />
          <stop offset="0.24" stopColor="#fca5a5" />
          <stop offset="0.6" stopColor="#ef5353" />
          <stop offset="1" stopColor="#8b252a" />
        </radialGradient>
      </defs>
      <polygon className="brand-plate" points="0.5,11 11,0.5 35,0.5 39.5,5 39.5,29 29,39.5 5,39.5 0.5,35" />
      <polygon className="brand-plate-inner" points="3,12 12,3 34,3 37,6 37,28 28,37 6,37 3,34" />
      {OPEN.map(([row, col]) => (
        <rect key={`${row}-${col}`} className="brand-tile is-open" x={at(col)} y={at(row)} width={CELL} height={CELL} rx="1.6" />
      ))}
      <rect className="brand-wall" x={at(1)} y={at(1)} width={CELL} height={CELL} rx="1.6" />
      {COVERED.map(([row, col, time]) => (
        <rect
          key={`${row}-${col}`}
          className="brand-tile is-lit"
          x={at(col)}
          y={at(row)}
          width={CELL}
          height={CELL}
          rx="1.6"
          style={{ '--t': `${time}s` }}
        />
      ))}
      <g className="brand-ball">
        <circle cx={at(0) + CELL / 2} cy={at(0) + CELL / 2} r="3.4" fill="url(#brand-ball-fill)" />
        <circle cx={at(0) + CELL / 2 - 1} cy={at(0) + CELL / 2 - 1.2} r="0.9" fill="#fff" fillOpacity=".75" />
      </g>
    </svg>
  );
}

export default function Brand() {
  return (
    <>
      <BrandMark />
      <span className="menu-brand-name brand-word">
        <b>SWIPE</b>
        <i>COVER</i>
        <span className="brand-streak" />
        <small className="brand-tag">THREE NEW PUZZLES EVERY DAY</small>
      </span>
    </>
  );
}
