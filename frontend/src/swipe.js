import { useRef } from 'react';
import { DIRECTION_STEPS } from './game.js';

// How far a finger has to travel before it counts as a swipe, in pixels.
export const SWIPE_DISTANCE = 22;

// One finger's stroke across the board or the swipe pad. A move fires as soon as the stroke is
// long enough instead of waiting for the finger to lift, so the finger can carry on and turn
// (right, then down, ...) to chain moves in one stroke.
export function createSwipe(fire) {
  let gesture = null;
  return {
    start(event) {
      gesture = { x: event.clientX, y: event.clientY, id: event.pointerId, last: null, fired: false };
    },
    move(event) {
      const start = gesture;
      if (!start || start.id !== event.pointerId) return;
      if (start.last) {
        // Carrying on the way the last swipe went only moves the starting point along with the
        // finger, so a turn is measured from where it begins. (Sliding the same way twice in a row
        // never does anything: the ball is already against the wall.)
        const [lastRow, lastCol] = DIRECTION_STEPS[start.last];
        const ahead = (event.clientX - start.x) * lastCol + (event.clientY - start.y) * lastRow;
        if (ahead > 0) {
          start.x += ahead * lastCol;
          start.y += ahead * lastRow;
        }
      }
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_DISTANCE) return;
      const direction = Math.abs(deltaX) > Math.abs(deltaY)
        ? (deltaX > 0 ? 'right' : 'left')
        : (deltaY > 0 ? 'down' : 'up');
      start.x = event.clientX;
      start.y = event.clientY;
      start.last = direction;
      start.fired = true;
      fire(direction);
    },
    // Ends the stroke and returns it (or null if there was none), so a caller can tell a tap
    // (`fired` still false) from a swipe.
    end() {
      const finished = gesture;
      gesture = null;
      return finished;
    },
  };
}

// A swipe tracker that always calls the latest `onMove`, however often it changes.
export function useSwipe(onMove) {
  const latest = useRef(onMove);
  latest.current = onMove;
  const swipe = useRef(null);
  if (!swipe.current) swipe.current = createSwipe((direction) => latest.current(direction));
  return swipe.current;
}
