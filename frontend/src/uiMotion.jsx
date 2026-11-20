// Small helpers behind the interface's motion (see motion-system.css for the look of it):
// numbers that count up, a burst of confetti, and the length of trips between screens.

import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

export function reducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// ---------- Numbers that count up ----------
// Ends exactly on `to`, slowing as it arrives (slow out), then flares once as it lands. A screen
// reader gets the final number straight away.

export function CountUp({ to, format = String, duration = 850, delay = 380, className = '' }) {
  const ref = useRef(null);
  const final = format(to);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    element.classList.remove('is-landed');
    if (reducedMotion() || !(to > 0)) {
      element.textContent = final;
      return undefined;
    }
    let frame = 0;
    let started = 0;
    element.textContent = format(0);
    const step = (now) => {
      started ||= now;
      const progress = clamp((now - started) / duration, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      element.textContent = progress >= 1 ? final : format(to * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        element.classList.add('is-landed');
      }
    };
    const timer = window.setTimeout(() => { frame = requestAnimationFrame(step); }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
    // `format` is a new function on every render; the number is what matters.
  }, [to]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <span ref={ref} className={`count-up ${className}`} aria-hidden="true" />
      <span className="sr-only">{final}</span>
    </>
  );
}

// ---------- Confetti ----------
// Pieces fly up and out along an arc, tumble, and fall (see .result-confetti in the CSS). They
// are drawn on their own layer over the page, so they never change the dialog's size.

const CONFETTI = {
  level: ['#4ef3d0', '#8be9ff', '#ffffff', '#ff8f9a', '#ffd27a', '#7cf0c8'],
  rush: ['#ffcf6b', '#ff8a3d', '#ffffff', '#ff5a3c', '#ffe3b0'],
};

export function Confetti({ count: wanted, tone = 'level' }) {
  // A phone draws fewer pieces: the effect reads the same, and the frames are left for the page.
  const count = window.matchMedia?.('(pointer: coarse)').matches ? Math.ceil(wanted * 0.6) : wanted;
  const pieces = useMemo(() => Array.from({ length: count }, (_, index) => {
    const side = index % 2 ? 1 : -1;
    const wide = Math.random();
    return {
      color: CONFETTI[tone][index % CONFETTI[tone].length],
      dx: side * (30 + wide * 190 + Math.random() * 40),
      rise: -(110 + Math.random() * 190),
      fall: 150 + Math.random() * 230,
      spin: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 520),
      delay: Math.random() * 0.12,
      time: 1.5 + Math.random() * 0.8,
      width: 5 + Math.random() * 5,
      height: 8 + Math.random() * 7,
    };
  }), [count, tone]);

  if (reducedMotion() || count <= 0) return null;
  return createPortal(
    <div className="result-confetti" aria-hidden="true">
      {pieces.map((piece, index) => (
        <i
          key={index}
          style={{
            '--c': piece.color,
            '--dx': `${piece.dx.toFixed(0)}px`,
            '--rise': `${piece.rise.toFixed(0)}px`,
            '--fall': `${piece.fall.toFixed(0)}px`,
            '--spin': `${piece.spin.toFixed(0)}deg`,
            '--delay': `${piece.delay.toFixed(2)}s`,
            '--time': `${piece.time.toFixed(2)}s`,
            '--w': `${piece.width.toFixed(1)}px`,
            '--h': `${piece.height.toFixed(1)}px`,
          }}
        />
      ))}
    </div>,
    document.body,
  );
}

// ---------- Trips between the menu and the game ----------
// The first trip of a visit plays in full: it is the one that sets the scene. Every later one is
// quicker, because a move you make a dozen times a day should not cost a dozen full seconds.
// The lengths are written to --travel / --travel-delay so the CSS (camera, logo) stays in step.

export const TRAVEL_FULL_MS = 1700;
export const TRAVEL_QUICK_MS = 1100;
const TRAVEL_FULL_DELAY_MS = 350;
let tripsTaken = 0;

export function beginTrip() {
  const ms = reducedMotion() || tripsTaken === 0 ? TRAVEL_FULL_MS : TRAVEL_QUICK_MS;
  tripsTaken += 1;
  const scale = ms / TRAVEL_FULL_MS;
  const delay = Math.round(TRAVEL_FULL_DELAY_MS * scale);
  const root = document.documentElement;
  root.style.setProperty('--travel', `${ms}ms`);
  root.style.setProperty('--travel-delay', `${delay}ms`);
  return { ms, delay, scale };
}
