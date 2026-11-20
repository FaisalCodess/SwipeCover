// Small helpers behind the interface's motion (see motion-system.css for the look of it):
// where a dialog grows from, how it leaves, numbers that count up, and a burst of confetti.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function reducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// ---------- Origin awareness ----------
// A dialog should grow out of the thing that was pressed to open it, and shrink back into it.
// The last press is remembered here (a tap or click, or the centre of the focused button for
// Enter and Space) so a dialog can read it when it appears.

let lastPress = null;

export function trackOrigin() {
  const remember = (x, y) => { lastPress = { x, y, at: performance.now() }; };
  const onPointer = (event) => remember(event.clientX, event.clientY);
  const onKey = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const element = document.activeElement;
    if (!element || element === document.body) return;
    const box = element.getBoundingClientRect();
    remember(box.left + box.width / 2, box.top + box.height / 2);
  };
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('keydown', onKey, true);
  };
}

// Sets --from-x and --from-y on a dialog's panel: how far, from its centre, the press that opened
// it was. With no recent press (a dialog the game opened by itself) it simply rises from below.
export function useDialogOrigin(ref) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const press = lastPress && performance.now() - lastPress.at < 1500 ? lastPress : null;
    let fromX = 0;
    let fromY = 28;
    if (press) {
      // Dialogs are centred on the screen, and measuring the panel now would include its first
      // animation frame, so the screen's own centre is the reference.
      fromX = clamp(press.x - window.innerWidth / 2, -element.offsetWidth * 0.6, element.offsetWidth * 0.6);
      fromY = clamp(press.y - window.innerHeight / 2, -element.offsetHeight * 0.6, element.offsetHeight * 0.6);
    }
    element.style.setProperty('--from-x', `${Math.round(fromX)}px`);
    element.style.setProperty('--from-y', `${Math.round(fromY)}px`);
  }, [ref]);
}

// Closing is quicker than opening (about 60%), and runs back along the way it came. Returns
// `[closing, close]`: put `is-closing` on the overlay and the panel while `closing`, and call
// `close()` where `onClose()` was called. Doing it twice is harmless.
export const DIALOG_EXIT_MS = 170;

export function useDialogExit(onClose) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(0);
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const close = useCallback(() => {
    if (timer.current) return;
    if (reducedMotion()) {
      latest.current();
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => latest.current(), DIALOG_EXIT_MS);
  }, []);
  return [closing, close];
}

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
