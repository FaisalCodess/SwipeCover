// Timing curves and springs for the ball. The board paints each square on the same curve the
// ball moves on (see paintDelay), so a square lights up the moment the ball rolls onto it.

// A CSS-style cubic-bezier evaluated in JS, so the ball and the tile timings share one curve.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const curveX = (s) => ((ax * s + bx) * s + cx) * s;
  const curveY = (s) => ((ay * s + by) * s + cy) * s;
  // Both halves of the curve only ever rise, so a bisection always finds the one answer.
  const invert = (curve, value) => {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 22; step += 1) {
      const middle = (low + high) / 2;
      if (curve(middle) < value) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  return {
    // How far along (0-1) the ball is at a given share of the slide's time.
    progressAt: (time) => (time <= 0 ? 0 : time >= 1 ? 1 : curveY(invert(curveX, time))),
    // The share of the slide's time it takes to get a given distance along.
    timeAt: (progress) => (progress <= 0 ? 0 : progress >= 1 ? 1 : curveX(invert(curveY, progress))),
  };
}

// Launches at once (no wind-up, so a swipe feels instant) and glides softly into the wall.
export const SLIDE_EASE = cubicBezier(0.25, 0.46, 0.35, 1);
// Undo rewinds with a gentle start and stop, so it reads as going back rather than a move.
export const UNDO_EASE = cubicBezier(0.45, 0, 0.2, 1);

// Slides speed up when moves are queued, so fast players never wait on animations.
export function slideDuration(distance, queued) {
  return Math.min(260, 85 + distance * 25) / (1 + queued * 0.6);
}

// When the square `index` steps along a slide of `distance` squares gets painted: as the front
// of the ball reaches its middle, a little before the ball's centre does.
export function paintDelay(index, distance, slideMs) {
  return Math.round(slideMs * SLIDE_EASE.timeAt(Math.min(1, (index + 0.6) / distance)));
}

export function spring(value) {
  return { value, velocity: 0 };
}

// One step of a damped spring pulling `state.value` towards `target`. Small steps keep it stable.
export function stepSpring(state, target, stiffness, damping, seconds) {
  const acceleration = -stiffness * (state.value - target) - damping * state.velocity;
  state.velocity += acceleration * seconds;
  state.value += state.velocity * seconds;
}

export function springAtRest(state, target) {
  return Math.abs(state.value - target) < 0.0015 && Math.abs(state.velocity) < 0.01;
}
