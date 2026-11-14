import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { vibrate } from './audio.js';
import { useSwipe } from './swipe.js';
import './swipe-pad.css';

// The pad is drawn like a small room seen from the front: a flat centre with four sloping
// walls (up, left, right, down) around it. The pad is a square; coordinates are in a 240 x 240 box
// that scales to whatever size the pad has.
const WIDTH = 240;
const HEIGHT = 240;
const CENTER = { left: 84, right: 156, top: 84, bottom: 156 };

// The outer corners are cut, like the game's other frames.
const CUT = 14;
const WEDGES = {
  up: `${CUT},0 ${WIDTH - CUT},0 ${WIDTH},${CUT} ${CENTER.right},${CENTER.top} ${CENTER.left},${CENTER.top} 0,${CUT}`,
  down: `${CUT},${HEIGHT} ${WIDTH - CUT},${HEIGHT} ${WIDTH},${HEIGHT - CUT} ${CENTER.right},${CENTER.bottom} ${CENTER.left},${CENTER.bottom} 0,${HEIGHT - CUT}`,
  left: `0,${CUT} ${CENTER.left},${CENTER.top} ${CENTER.left},${CENTER.bottom} 0,${HEIGHT - CUT}`,
  right: `${WIDTH},${CUT} ${CENTER.right},${CENTER.top} ${CENTER.right},${CENTER.bottom} ${WIDTH},${HEIGHT - CUT}`,
};

const ARROWS = { up: ChevronUp, left: ChevronLeft, right: ChevronRight, down: ChevronDown };

// Which wall a touch landed on, or null for the flat middle.
function wallAt(event) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width) * WIDTH;
  const y = ((event.clientY - box.top) / box.height) * HEIGHT;
  if (x > CENTER.left && x < CENTER.right && y > CENTER.top && y < CENTER.bottom) return null;
  // The walls meet along the diagonals from the pad's corners to the middle's corners.
  const across = Math.abs(x - WIDTH / 2) / (WIDTH / 2);
  const down = Math.abs(y - HEIGHT / 2) / (HEIGHT / 2);
  if (across > down) return x < WIDTH / 2 ? 'left' : 'right';
  return y < HEIGHT / 2 ? 'up' : 'down';
}

// An on-screen pad for steering with a thumb: swipe anywhere on it (and carry on turning to chain
// moves), or tap a wall to go that way. The board itself ignores swipes while the pad is shown.
export default function SwipePad({ onMove, disabled }) {
  const [lit, setLit] = useState(null);
  const timer = useRef(0);
  const wall = useRef(null);

  const flash = useCallback((direction) => {
    setLit(direction);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLit(null), 170);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const swipe = useSwipe((direction) => {
    onMove(direction);
    flash(direction);
  });

  function handlePointerDown(event) {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    swipe.start(event);
    wall.current = wallAt(event);
    window.clearTimeout(timer.current);
    setLit(wall.current);
  }

  function handlePointerUp(event) {
    const stroke = swipe.end();
    if (!stroke || stroke.id !== event.pointerId) return;
    // A touch that never travelled far enough to be a swipe is a tap on the wall it landed on.
    if (!stroke.fired && wall.current) {
      onMove(wall.current);
      vibrate(8);
      flash(wall.current);
    } else {
      setLit(null);
    }
  }

  function handlePointerCancel() {
    swipe.end();
    setLit(null);
  }

  return (
    <div
      className={`swipe-pad ${disabled ? 'is-disabled' : ''}`}
      role="group"
      aria-label="Swipe pad: swipe or tap to move the ball"
      onPointerDown={handlePointerDown}
      onPointerMove={swipe.move}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <svg className="swipe-pad-art" viewBox={`-1 -1 ${WIDTH + 2} ${HEIGHT + 2}`} aria-hidden="true">
        {Object.entries(WEDGES).map(([direction, points]) => (
          <polygon key={direction} points={points} className={`swipe-pad-wall ${lit === direction ? 'is-lit' : ''}`} />
        ))}
        <rect
          x={CENTER.left}
          y={CENTER.top}
          width={CENTER.right - CENTER.left}
          height={CENTER.bottom - CENTER.top}
          className="swipe-pad-floor"
        />
      </svg>
      {Object.entries(ARROWS).map(([direction, Arrow]) => (
        <span key={direction} className={`swipe-pad-arrow is-${direction} ${lit === direction ? 'is-lit' : ''}`} aria-hidden="true">
          <Arrow size={20} strokeWidth={1.8} />
        </span>
      ))}
      <span className="swipe-pad-hint" aria-hidden="true">SWIPE</span>
    </div>
  );
}
