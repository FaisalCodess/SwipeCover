import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, Crown, Flame, Gamepad2, LoaderCircle, LockKeyhole, LogIn, LogOut, Pencil, Settings, Swords, Trash2, Trophy, User, X, Zap } from 'lucide-react';
import { fetchLeaderboard, fetchRushLeaderboard, fetchVersusLeaderboard } from './api.js';
import { getTimeUntilAmmanReset } from './dailyReset.js';
import { sounds, vibrate } from './audio.js';
import { KEY_BINDINGS } from './controls.js';
import { formatRushClock } from './rush.js';

const LEVEL_NUMBERS = [1, 2, 3];

const MENU_ITEMS = [
  { id: 'play', label: 'PLAY', icon: Gamepad2 },
  { id: 'rush', label: 'SWIPE RUSH', icon: Zap },
  { id: 'versus', label: '1 V 1 RUSH', icon: Swords },
  { id: 'settings', label: 'SETTINGS', icon: Settings },
  { id: 'leaderboard', label: 'LEADERBOARD', icon: Trophy },
];

function formatCountdown(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((unit) => String(unit).padStart(2, '0')).join(':');
}

function moteCount(width, height) {
  return Math.min(100, Math.max(38, Math.round(width * height / 15000)));
}

function createMote(width, height, hues) {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.random() * 1.6 + 0.45,
    speed: Math.random() * 0.26 + 0.08,
    phase: Math.random() * Math.PI * 2,
    hue: Math.random() > 0.56 ? hues[0] : hues[1],
    alpha: Math.random() * 0.48 + 0.2,
    length: Math.random() * 16 + 8,
  };
}

// Pre-rendered glow, because canvas shadowBlur on every mote is too slow on phones.
function createGlowSprite(hue) {
  const sprite = document.createElement('canvas');
  sprite.width = 48;
  sprite.height = 48;
  const context = sprite.getContext('2d');
  const gradient = context.createRadialGradient(24, 24, 0, 24, 24, 24);
  gradient.addColorStop(0, `hsla(${hue}, 100%, 82%, 1)`);
  gradient.addColorStop(0.12, `hsla(${hue}, 100%, 72%, 0.9)`);
  gradient.addColorStop(0.35, `hsla(${hue}, 100%, 62%, 0.28)`);
  gradient.addColorStop(1, `hsla(${hue}, 100%, 62%, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 48, 48);
  return sprite;
}

// The fading tail behind a spark, also drawn once. It runs from the top right (the spark) to the
// bottom left, and is stretched to each spark's own length when stamped, so the angle never changes.
const DRAW_EVERY_MS = 48;
const STREAK_W = 19;
const STREAK_H = 32;
function createStreakSprite(hue) {
  const sprite = document.createElement('canvas');
  sprite.width = STREAK_W + 4;
  sprite.height = STREAK_H + 4;
  const context = sprite.getContext('2d');
  const gradient = context.createLinearGradient(STREAK_W + 2, 2, 2, STREAK_H + 2);
  gradient.addColorStop(0, `hsla(${hue}, 96%, 70%, 1)`);
  gradient.addColorStop(1, `hsla(${hue}, 96%, 60%, 0)`);
  context.strokeStyle = gradient;
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(STREAK_W + 2, 2);
  context.lineTo(2, STREAK_H + 2);
  context.stroke();
  return sprite;
}

// Drifting sparks. `hues` are the two colours (red and cyan in the sky; ember orange in the
// cave), and `rise` scales how fast they climb, so the cave can speed them up as time runs out.
// Motion is measured in seconds, not frames, so it looks the same at any frame rate, and a resize
// moves the sparks along with the screen instead of throwing them to new random places.
export function EmberField({ hues = [354, 192], rise = 1 }) {
  const canvasRef = useRef(null);
  const riseRef = useRef(rise);
  riseRef.current = rise;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const glowSprites = Object.fromEntries(hues.map((hue) => [hue, createGlowSprite(hue)]));
    const streakSprites = Object.fromEntries(hues.map((hue) => [hue, createStreakSprite(hue)]));
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let timer = 0;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let motes = [];
    let lastTime = 0;

    function render(timestamp, seconds) {
      const moving = seconds > 0;
      context.clearRect(0, 0, width, height);
      for (const mote of motes) {
        const x = mote.x + (moving ? Math.sin(timestamp * 0.00035 + mote.phase) * 0.22 : 0);
        const y = mote.y;
        const streak = streakSprites[mote.hue];
        const scale = mote.length / STREAK_H;
        context.globalAlpha = mote.alpha;
        context.drawImage(streak, x - (STREAK_W + 2) * scale, y - 2 * scale, streak.width * scale, streak.height * scale);
        const glowSize = mote.radius * 2 + 24;
        context.drawImage(glowSprites[mote.hue], x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
        if (moving) {
          mote.y -= mote.speed * 13.5 * riseRef.current * seconds;
          mote.x += Math.sin(timestamp * 0.00028 + mote.phase) * 2.7 * seconds;
          if (mote.y < -mote.length) {
            mote.y = height + mote.length;
            mote.x = Math.random() * width;
          }
          if (mote.x < -20) mote.x = width + 10;
          if (mote.x > width + 20) mote.x = -10;
        }
      }
      context.globalAlpha = 1;
    }

    // The sparks drift a few pixels a second, so about 20 draws a second look just as smooth as 60,
    // and every draw is a page update the phone has to composite. A timer wakes the loop, so the
    // page is left alone in between instead of being asked for a frame it will not use.
    function schedule() {
      timer = window.setTimeout(() => { frame = window.requestAnimationFrame(tick); }, DRAW_EVERY_MS);
    }

    function tick(timestamp) {
      // A long gap (the tab was in the background) must not make the sparks jump.
      const seconds = Math.min(0.1, (timestamp - lastTime) / 1000);
      lastTime = timestamp;
      render(timestamp, seconds);
      schedule();
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      const newWidth = bounds.width;
      const newHeight = bounds.height;
      if (!newWidth || !newHeight) return;
      if (Math.abs(newWidth - width) < 1 && Math.abs(newHeight - height) < 1) return;
      // A phone's address bar sliding in and out resizes the page all the time. The sparks keep
      // their place on the screen instead of being scattered again.
      const scaleX = width ? newWidth / width : 1;
      const scaleY = height ? newHeight / height : 1;
      width = newWidth;
      height = newHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 900 ? 1 : 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      for (const mote of motes) {
        mote.x *= scaleX;
        mote.y *= scaleY;
      }
      const wanted = moteCount(width, height);
      if (motes.length > wanted) motes.length = wanted;
      while (motes.length < wanted) motes.push(createMote(width, height, hues));
      if (motionQuery.matches) render(0, 0);
    }

    function stop() {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    }

    function onMotionPreferenceChange() {
      stop();
      if (motionQuery.matches) render(0, 0);
      else {
        lastTime = performance.now();
        schedule();
      }
    }

    resize();
    if (motionQuery.matches) render(0, 0);
    else {
      lastTime = performance.now();
      schedule();
    }
    window.addEventListener('resize', resize);
    motionQuery.addEventListener('change', onMotionPreferenceChange);
    return () => {
      stop();
      window.removeEventListener('resize', resize);
      motionQuery.removeEventListener('change', onMotionPreferenceChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="menu-embers" aria-hidden="true" />;
}

function CrystalRange() {
  return (
    <svg className="menu-range" viewBox="0 0 1600 510" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="range-front" x1="0" x2="0.8" y1="0" y2="1">
          <stop offset="0" stopColor="#28445a" />
          <stop offset="0.48" stopColor="#10232f" />
          <stop offset="1" stopColor="#080d14" />
        </linearGradient>
        <linearGradient id="range-ridge" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#e67753" stopOpacity=".72" />
          <stop offset=".35" stopColor="#9a3b36" stopOpacity=".7" />
          <stop offset="1" stopColor="#172a38" stopOpacity=".88" />
        </linearGradient>
        <linearGradient id="range-ice" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#4ac5d5" stopOpacity=".18" />
          <stop offset=".5" stopColor="#b8f4df" stopOpacity=".68" />
          <stop offset="1" stopColor="#53b7da" stopOpacity=".15" />
        </linearGradient>
      </defs>
      <path fill="#1c3445" fillOpacity=".65" d="m0 332 86-66 74 32 104-137 92 136 65-27 106 89 119-148 67 40 88-118 118 111 91-63 113 60 78-97 87 59 96-96 116 72v332H0Z" />
      <path fill="#254454" fillOpacity=".66" d="m0 374 94-45 61 33 135-65 86 52 119-63 89 48 111-43 71 47 118-84 89 55 107-42 92 51 88-47 91 35 87-51 101 27v228H0Z" />
      <path fill="url(#range-ridge)" d="m0 380 93 35 91-17 90-84 63 28 72-24 69 51 100-14 74-51 64 22 59-16 91 44 54-36 104 6 81-47 57 32 68-12 80 24 100-42 76 31 83-18 70 12v214H0Z" />
      <path fill="#172d3a" d="m0 433 78-28 71 34 62-18 58 29 84-44 81 40 53-31 94 44 75-14 55 36 76-28 81 13 67-40 95 28 64-20 68 36 86-36 72 22 95-33 74 26 71-13 94 24v75H0Z" />
      <path fill="url(#range-ice)" d="M0 371c202 27 339-8 522 23s278-21 444 5 392-23 634 3v23c-211-20-419 23-622-2s-329 31-529 2S195 452 0 405Z" />
      <path fill="#080d14" d="m0 442 69 5 39 28 65-16 62 21 61-24 78 30 72-22 63 27 64-13 66 30 87-24 61 24 55-35 80 22 70-13 72 27 76-23 65 27 83-31 61 22 79-26 74 29 78-20 91 23v60H0Z" />
      <path fill="#e7704e" fillOpacity=".84" d="m1002 398 56-34 18 20 36-48 12 40 48-26 10 27 58-35 9 28 52-19 8 25 85-28 13 38 65-19 36 29-99 20-73-11-84 27-64-14-84 12-63-26-78 10-66-28Z" />
      <path fill="#4aa4b7" fillOpacity=".52" d="m0 403 66-23 28 19 50-11 43 30-91 14-96-8Zm1250 36 87-31 40 14 68-23 51 26-74 8-53 26-84-1Z" />
    </svg>
  );
}

// The animated backdrop. `children` (the level orbs) sit at mid depth, so they drift with the
// parallax and sit behind the mountains like the rest of the scenery.
export function MenuAtmosphere({ children }) {
  const root = useRef(null);
  const animationFrame = useRef(0);

  useEffect(() => {
    const target = root.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let pendingX = 0;
    let pendingY = 0;

    function handlePointerMove(event) {
      const bounds = target.getBoundingClientRect();
      pendingX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width - 0.5)) * 2;
      pendingY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height - 0.5)) * 2;
      if (reducedMotion.matches || animationFrame.current) return;
      animationFrame.current = window.requestAnimationFrame(() => {
        target.style.setProperty('--sky-x', `${pendingX * -6}px`);
        target.style.setProperty('--sky-y', `${pendingY * -4}px`);
        target.style.setProperty('--haze-x', `${pendingX * -3}px`);
        target.style.setProperty('--haze-y', `${pendingY * -2}px`);
        target.style.setProperty('--far-x', `${pendingX * 8}px`);
        target.style.setProperty('--far-y', `${pendingY * 5}px`);
        target.style.setProperty('--mid-x', `${pendingX * -13}px`);
        target.style.setProperty('--mid-y', `${pendingY * -9}px`);
        target.style.setProperty('--range-x', `${pendingX * -5}px`);
        target.style.setProperty('--range-y', `${pendingY * -2}px`);
        animationFrame.current = 0;
      });
    }

    function resetPointer() {
      target.style.setProperty('--sky-x', '0px');
      target.style.setProperty('--sky-y', '0px');
      target.style.setProperty('--haze-x', '0px');
      target.style.setProperty('--haze-y', '0px');
      target.style.setProperty('--far-x', '0px');
      target.style.setProperty('--far-y', '0px');
      target.style.setProperty('--mid-x', '0px');
      target.style.setProperty('--mid-y', '0px');
      target.style.setProperty('--range-x', '0px');
      target.style.setProperty('--range-y', '0px');
    }

    function handlePointerOut(event) {
      if (event.relatedTarget === null) resetPointer();
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerout', handlePointerOut);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerout', handlePointerOut);
      window.cancelAnimationFrame(animationFrame.current);
    };
  }, []);

  return (
    <div ref={root} className="menu-atmosphere">
      <div className="menu-sky" />
      <div className="menu-sky-glow" />
      <div className="menu-haze" />
      <div className="menu-depth menu-depth-far">
        <div className="menu-ruin menu-ruin-left" />
        <div className="menu-ruin menu-ruin-center" />
        <div className="menu-ruin menu-ruin-right" />
      </div>
      <div className="menu-depth menu-depth-mid">{children}</div>
      <CrystalRange />
      <div className="menu-vignette" />
      <EmberField />
    </div>
  );
}

// The sky above the menu: the menu's own sky mirrored upwards, so the two meet without a
// seam, darkening into a starry night as it goes up. The game screen sits in it.
export function SkyAbove() {
  return (
    <div className="menu-atmosphere sky-above">
      <div className="sky-above-base" />
      <div className="sky-above-seam">
        <div className="sky-above-mirror">
          <div className="menu-sky" />
          <div className="menu-vignette" />
        </div>
      </div>
      <div className="sky-above-mist" />
      <div className="sky-above-stars" />
      <EmberField />
    </div>
  );
}

// Keep in sync with the closing animation timings in main-menu.css.
const PANEL_CLOSE_MS = 560;
const HALF = 0.5;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Border-box size of an element, unaffected by CSS transforms during animations.
function useBoxSize(ref) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((previous) => (previous?.width === width && previous?.height === height ? previous : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Shapes return outline points in pixels, inset half a pixel so 1px strokes stay crisp.
function panelShape(width, height) {
  const right = width - HALF;
  const bottom = height - HALF;
  const step = Math.round(width * 0.74);
  const jog = Math.round(height * 0.3);
  return [
    [HALF, 34], [40, HALF], [step, HALF], [step + 13, 13], [right - 28, 13], [right - 6, 35],
    [right - 6, jog], [right, jog + 6], [right, bottom - 26], [right - 24, bottom], [44, bottom], [HALF, bottom - 44],
  ];
}

export function keyShape(width, height) {
  const cut = 6;
  const right = width - HALF;
  const bottom = height - HALF;
  return [[cut, HALF], [right - cut, HALF], [right, cut], [right, bottom - cut], [right - cut, bottom], [cut, bottom], [HALF, bottom - cut], [HALF, cut]];
}

function closeShape(width, height) {
  const right = width - HALF;
  const bottom = height - HALF;
  return [[7, HALF], [right, HALF], [right, bottom - 7], [right - 7, bottom], [HALF, bottom], [HALF, 7]];
}

const FRAME_INSET = 5;

// Second, fainter line inside the outline gives the frame its double-lined tech edge.
function panelMarks(width, height) {
  const inner = panelShape(width - FRAME_INSET * 2, height - FRAME_INSET * 2)
    .map(([x, y]) => `${x + FRAME_INSET},${y + FRAME_INSET}`)
    .join(' ');
  return (
    <>
      <polygon className="cut-frame-inner" points={inner} />
      <polyline points={`96,${height - HALF} 103,${height - 7} 110,${height - HALF}`} />
    </>
  );
}

// The board's frame: the menu panel's double-lined, cut-corner edge around the playfield.
function boardShape(width, height) {
  const right = width - HALF;
  const bottom = height - HALF;
  return [
    [HALF, 28], [28, HALF], [right - 14, HALF], [right, 14],
    [right, bottom - 28], [right - 28, bottom], [14, bottom], [HALF, bottom - 14],
  ];
}

function boardMarks(width, height) {
  const inner = boardShape(width - FRAME_INSET * 2, height - FRAME_INSET * 2)
    .map(([x, y]) => `${x + FRAME_INSET},${y + FRAME_INSET}`)
    .join(' ');
  const middle = Math.round(width / 2);
  return (
    <>
      <polygon className="cut-frame-inner" points={inner} />
      <polyline points={`${middle - 8},${height - HALF} ${middle},${height - 7} ${middle + 8},${height - HALF}`} />
    </>
  );
}

export function BoardFrame() {
  return <CutFrame shape={boardShape} marks={boardMarks} className="menu-panel-frame" />;
}

// The glowing crystal node on the connector, in unit coordinates (scaled to its radius).
const GEM_OUTER = '-1,0 -0.3,-0.95 0.45,-0.6 1,0 0.45,0.6 -0.3,0.95';
const GEM_CORE = '-0.38,-0.48 0.62,0 -0.38,0.48';
const GEM_FACETS = 'M-1 0L-0.38 -0.48M-1 0L-0.38 0.48M-0.3 -0.95L-0.38 -0.48M0.45 -0.6L-0.38 -0.48M0.45 -0.6L0.62 0'
  + 'M1 0L0.62 0M0.45 0.6L0.62 0M0.45 0.6L-0.38 0.48M-0.3 0.95L-0.38 0.48';
const FAN_LINE_COUNT = 6;

// An angular outline drawn in SVG, because CSS borders disappear along clip-path diagonals.
export function CutFrame({ shape, className = '', marks }) {
  const ref = useRef(null);
  const size = useBoxSize(ref);
  const points = size?.width ? shape(size.width, size.height) : null;
  return (
    <span ref={ref} className={`cut-frame ${className}`} aria-hidden="true">
      {points && (
        <>
          <span className="cut-frame-fill" style={{ clipPath: `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(', ')})` }} />
          <svg className="cut-frame-line" width={size.width} height={size.height}>
            <polygon points={points.map(([x, y]) => `${x},${y}`).join(' ')} />
            {marks?.(size.width, size.height)}
          </svg>
        </>
      )}
    </span>
  );
}

function RangeBracket() {
  const ref = useRef(null);
  const size = useBoxSize(ref);
  const width = size?.width;
  const height = size?.height;
  return (
    <span ref={ref} className="menu-range-bracket" aria-hidden="true">
      {width > 0 && (
        <svg width={width} height={height}>
          <polyline points={`${HALF},${HALF} 8,${height - HALF} ${width - 8},${height - HALF} ${width - HALF},${HALF}`} />
          {[0.25, 0.75].map((fraction) => {
            const x = Math.round(width * fraction);
            return <polyline key={fraction} points={`${x - 4},${height - HALF} ${x},${height + 3.5} ${x + 4},${height - HALF}`} />;
          })}
        </svg>
      )}
    </span>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`menu-settings-toggle ${checked ? 'is-on' : ''}`}
    >
      <span aria-hidden="true" />
    </button>
  );
}

// Shared shell for the panels that unfold out of the main menu (Settings and Leaderboard),
// so both always look and animate the same way.
const MenuPanel = forwardRef(function MenuPanel({ id, title, closing, onClose, children }, ref) {
  return (
    <aside
      ref={ref}
      className={`menu-panel ${closing ? 'is-closing' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`menu-${id}-title`}
    >
      <CutFrame shape={panelShape} className="menu-panel-frame" marks={panelMarks} />
      <div className="menu-panel-body">
        <header className="menu-panel-header menu-panel-item" style={{ '--i': 0 }}>
          <h2 id={`menu-${id}-title`}>{title.toUpperCase()}</h2>
          <button type="button" className="menu-panel-close" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} autoFocus>
            <CutFrame shape={closeShape} />
            <X size={15} strokeWidth={1.5} />
          </button>
        </header>
        {children}
      </div>
    </aside>
  );
});

function SettingsContent({ settings, onSettingsChange }) {
  const [hoveredBinding, setHoveredBinding] = useState(null);

  // A short tick lets the player hear the new level, through the real sound-effect path.
  function previewSound(next) {
    if (next.sfx) sounds.move(next.sfxVolume, 3);
  }

  return (
    <>
      <div className="menu-settings-row menu-panel-item" style={{ '--i': 1 }}>
        <span>MUSIC</span>
        <Toggle label="Music" checked={settings.music} onChange={(music) => onSettingsChange({ ...settings, music })} />
      </div>
      <div className="menu-settings-row menu-panel-item" style={{ '--i': 2 }}>
        <span>SOUND EFFECTS</span>
        <Toggle
          label="Sound effects"
          checked={settings.sfx}
          onChange={(sfx) => {
            const next = { ...settings, sfx };
            onSettingsChange(next);
            previewSound(next);
          }}
        />
      </div>
      <div className="menu-settings-row menu-panel-item" style={{ '--i': 2 }}>
        <span>SWIPE PAD</span>
        <Toggle label="Swipe pad" checked={settings.swipePad} onChange={(swipePad) => onSettingsChange({ ...settings, swipePad })} />
      </div>

      {[
        { key: 'musicVolume', label: 'MUSIC VOLUME', id: 'menu-settings-music-volume', preview: false },
        { key: 'sfxVolume', label: 'SFX VOLUME', id: 'menu-settings-sfx-volume', preview: true },
      ].map(({ key, label, id, preview }, index) => (
        <div key={key} className="menu-settings-volume menu-panel-item" style={{ '--i': 3 + index }}>
          <label htmlFor={id}>{label}</label>
          <output htmlFor={id}>{settings[key]}%</output>
          <input
            id={id}
            type="range"
            min="0"
            max="100"
            value={settings[key]}
            style={{ '--range-progress': `${settings[key]}%` }}
            onChange={(event) => onSettingsChange({ ...settings, [key]: Number(event.target.value) })}
            onPointerUp={() => preview && previewSound(settings)}
            onKeyUp={(event) => {
              if (preview && (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End')) previewSound(settings);
            }}
          />
          <RangeBracket />
        </div>
      ))}

      <div className="menu-panel-section menu-panel-item" style={{ '--i': 5 }}>
        <div className="menu-panel-section-heading">
          <span id="menu-keyboard-title">KEYBOARD CONTROLS</span>
          <span className="menu-panel-hint" aria-hidden="true">{hoveredBinding?.name.toUpperCase()}</span>
        </div>
        <ul className="menu-keys" aria-labelledby="menu-keyboard-title">
          {KEY_BINDINGS.map((binding) => (
            <li
              key={binding.action}
              className={`menu-key ${binding.label.length > 1 ? 'is-wide' : ''}`}
              title={binding.name}
              onPointerEnter={() => setHoveredBinding(binding)}
              onPointerLeave={() => setHoveredBinding(null)}
            >
              <CutFrame shape={keyShape} />
              <kbd>{binding.label}</kbd>
              <span className="sr-only">{binding.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// The leaderboard has three sections instead of five tabs: DAILY (pick one of the three levels
// inside it), RUSH, and RANKED (the highest 1v1 ratings).
const BOARD_SECTIONS = [
  { id: 'daily', label: 'DAILY', icon: CalendarDays },
  { id: 'rush', label: 'RUSH', icon: Flame },
  { id: 'ranked', label: 'RANKED', icon: Crown },
];

const BOARD_NOTES = {
  rush: { left: 'SWIPE RUSH · 5 MIN · MOST MAPS', right: 'TODAY' },
  ranked: { left: 'RANKED 1V1 · ELO RATING', right: 'ALL TIME' },
};

const EMPTY_BOARD = {
  daily: (level) => ['NO TIMES YET', `Be the first to finish level ${level} today.`],
  rush: () => ['NO RUNS YET', 'Be the first to set a Swipe Rush score today.'],
  ranked: () => ['NO RANKED MATCHES YET', 'Win a ranked 1v1 to take the top spot.'],
};

// What one entry shows: a headline number, what it measures, and a line of detail.
function describeEntry(section, entry) {
  if (section === 'ranked') {
    return { main: String(entry.rating), unit: 'RATING', sub: `${entry.wins}W ${entry.losses}L${entry.draws ? ` ${entry.draws}D` : ''}` };
  }
  if (section === 'rush') {
    return { main: String(entry.maps), unit: entry.maps === 1 ? 'MAP' : 'MAPS', sub: formatMenuTime(entry.time_ms) };
  }
  return { main: formatMenuTime(entry.time_ms), unit: 'TIME', sub: `${entry.moves} moves` };
}

function BoardRow({ section, entry }) {
  const { main, unit, sub } = describeEntry(section, entry);
  return (
    <li className={`menu-board-row ${entry.you ? 'is-you' : ''}`}>
      <span className="menu-board-rank">{String(entry.rank).padStart(2, '0')}</span>
      <span className="menu-board-avatar" aria-hidden="true"><User size={13} strokeWidth={1.8} /></span>
      <span className="menu-board-name">
        {entry.name}
        {entry.you && <small className="menu-board-you">YOU</small>}
      </span>
      <span className="menu-board-moves">{sub}</span>
      <span className="menu-board-time">{section === 'rush' ? `${main} ${unit.toLowerCase()}` : main}</span>
    </li>
  );
}

// The top three stand on a podium (second, first, third), the rest follow as rows.
function Podium({ section, entries }) {
  return (
    <ol className="menu-podium" aria-label="Top three">
      {[2, 1, 3].map((place) => {
        const entry = entries[place - 1];
        if (!entry) {
          return (
            <li key={place} className={`menu-podium-slot is-place-${place} is-empty`} style={{ '--k': place }}>
              <span className="menu-podium-badge">{place}</span>
              <span className="menu-podium-name">OPEN</span>
            </li>
          );
        }
        const { main, unit, sub } = describeEntry(section, entry);
        return (
          <li key={place} className={`menu-podium-slot is-place-${place} ${entry.you ? 'is-you' : ''}`} style={{ '--k': place }}>
            {place === 1 && <Crown className="menu-podium-crown" size={16} strokeWidth={1.6} aria-hidden="true" />}
            <span className="menu-podium-badge">{place}</span>
            <span className="menu-podium-name">{entry.name}{entry.you && <small>YOU</small>}</span>
            <strong>{main}</strong>
            <span className="menu-podium-unit">{unit}</span>
            <small className="menu-podium-sub">{sub}</small>
          </li>
        );
      })}
    </ol>
  );
}

// Today's global top 10 per level and for Swipe Rush, and the highest 1v1 ratings of all time.
// Without the server the daily and Rush boards fall back to this device's own first run.
function LeaderboardContent({ levelScores, player, rush }) {
  const [section, setSection] = useState('daily');
  const [level, setLevel] = useState(() => (
    [3, 2, 1].find((number) => levelScores?.[number]?.length) || 1
  ));
  const [boards, setBoards] = useState({});
  const activeKey = section === 'daily' ? `level-${level}` : section;
  const board = boards[activeKey];

  useEffect(() => {
    const controller = new AbortController();
    setBoards((previous) => ({ ...previous, [activeKey]: { ...previous[activeKey], status: previous[activeKey]?.entries ? 'ready' : 'loading' } }));
    const request = section === 'rush'
      ? fetchRushLeaderboard(controller.signal)
      : section === 'ranked'
        ? fetchVersusLeaderboard(controller.signal)
        : fetchLeaderboard(level, controller.signal);
    request
      .then((data) => setBoards((previous) => ({ ...previous, [activeKey]: { status: 'ready', entries: data.entries, you: data.you } })))
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.info('Global leaderboard unavailable; showing this device.', error.message);
          setBoards((previous) => ({ ...previous, [activeKey]: { status: 'offline' } }));
        }
      });
    return () => controller.abort();
  }, [activeKey, section, level, player.id]);

  let entries = board?.entries || [];
  if (board?.status === 'offline' && section === 'ranked') {
    entries = [];
  } else if (board?.status === 'offline' && section === 'rush') {
    const result = rush?.status === 'finished' ? rush.result : null;
    entries = result?.maps > 0
      ? [{ rank: 1, name: player.name || 'You', maps: result.maps, moves: result.moves, time_ms: result.time, you: true }]
      : [];
  } else if (board?.status === 'offline') {
    entries = (levelScores?.[level] || [])
      .filter((entry) => Number.isFinite(entry?.time))
      .sort((left, right) => left.time - right.time)
      .slice(0, 10)
      .map((entry, index) => ({ rank: index + 1, name: player.name || 'You', moves: entry.moves, time_ms: entry.time, you: true }));
  }

  let footer = player.name ? `PLAYING AS ${player.name.toUpperCase()}` : 'LOG IN TO JOIN';
  if (board?.status === 'offline') footer = 'OFFLINE · SHOWING THIS DEVICE';
  const [emptyTitle, emptyText] = EMPTY_BOARD[section](level);
  const sectionIndex = BOARD_SECTIONS.findIndex((entry) => entry.id === section);

  return (
    <>
      <div className={`menu-board-tabs menu-panel-item ${section === 'rush' ? 'is-rush' : ''}`} role="tablist" aria-label="Leaderboard" style={{ '--i': 1 }}>
        <i className="menu-board-glider" style={{ transform: `translateX(${sectionIndex * 100}%)` }} aria-hidden="true" />
        {BOARD_SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={section === id}
            aria-controls="menu-board-list"
            className={`menu-board-tab ${section === id ? 'is-active' : ''}`}
            onClick={() => setSection(id)}
          >
            <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* One row, whatever the section, so the panel never changes height. */}
      <div className="menu-board-sub menu-panel-item" style={{ '--i': 2 }}>
        {section === 'daily' ? (
          <div className="menu-board-levels" role="radiogroup" aria-label="Level">
            {LEVEL_NUMBERS.map((number) => (
              <button
                type="button"
                key={number}
                role="radio"
                aria-checked={level === number}
                className={level === number ? 'is-active' : ''}
                onClick={() => setLevel(number)}
              >
                LEVEL {number}
              </button>
            ))}
          </div>
        ) : (
          <p key={section}><span>{BOARD_NOTES[section].left}</span><span>{BOARD_NOTES[section].right}</span></p>
        )}
      </div>

      {/* Always sized for ten rows, so switching never resizes or moves the panel. */}
      <div
        id="menu-board-list"
        className="menu-board-list menu-panel-item"
        role="tabpanel"
        aria-label={section === 'ranked' ? 'Highest ratings' : section === 'rush' ? 'Swipe Rush top runs' : `Level ${level} top times`}
        aria-busy={board?.status === 'loading' || !board}
        style={{ '--i': 3 }}
      >
        {entries.length > 0 && (
          <div key={activeKey} className="menu-board-view">
            <Podium section={section} entries={entries} />
            {(entries.length > 3 || board?.you) && (
              <ol className="menu-board-rows">
                {entries.slice(3).map((entry) => <BoardRow key={`${entry.rank}-${entry.name}`} section={section} entry={entry} />)}
                {board?.you && (
                  <>
                    <li className="menu-board-gap" aria-hidden="true">···</li>
                    <BoardRow section={section} entry={board.you} />
                  </>
                )}
              </ol>
            )}
          </div>
        )}
        {!entries.length && (
          <div className="menu-board-empty">
            {board?.status === 'ready' || board?.status === 'offline' ? (
              <>
                <span>{emptyTitle}</span>
                <p>{emptyText}</p>
              </>
            ) : (
              <span className="menu-board-loading"><LoaderCircle className="menu-spin" size={15} /> LOADING</span>
            )}
          </div>
        )}
      </div>

      <div className="menu-board-footer menu-panel-item" style={{ '--i': 4 }}>
        <span>{section === 'ranked' ? 'ALL TIME · RANKED MATCHES' : 'TODAY · FIRST RUNS'}</span>
        <span className={board?.status === 'offline' ? 'is-offline' : ''}>{footer}</span>
      </div>
    </>
  );
}

// Same mm:ss.cc format as the in-game clock, so times read identically everywhere.
function formatMenuTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '--:--.--';
  const total = Math.floor(milliseconds);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

// How long the "locked" message stays up after a level is turned away.
const REFUSAL_MS = 2800;

// A level opens once every level before it has been cleared. A cleared level stays open for replays.
function isOpen(level, cleared) {
  return cleared.includes(level) || LEVEL_NUMBERS.every((earlier) => earlier >= level || cleared.includes(earlier));
}

// The first level still to clear before this one: the one the player should go and play.
function blockerOf(level, cleared) {
  return LEVEL_NUMBERS.find((earlier) => earlier < level && !cleared.includes(earlier));
}

// What the readout in the middle of the ring says about the level being pointed at.
function readoutFor({ refusal, hovered, cleared, firstRuns }) {
  if (refusal) {
    return {
      key: `refused-${refusal.id}`,
      tone: 'warn',
      kicker: `LEVEL ${refusal.level} · LOCKED`,
      title: `CLEAR LEVEL ${refusal.blocker} FIRST`,
    };
  }
  if (hovered) {
    const key = `level-${hovered}`;
    if (cleared.includes(hovered)) {
      const time = firstRuns[hovered]?.[0]?.time;
      return {
        key,
        kicker: `LEVEL ${hovered} · CLEARED`,
        title: Number.isFinite(time) ? formatMenuTime(time) : 'CLEARED',
        detail: 'PRESS TO REPLAY',
      };
    }
    if (isOpen(hovered, cleared)) return { key, kicker: `LEVEL ${hovered}`, title: 'READY', detail: 'PRESS TO PLAY' };
    return { key, kicker: `LEVEL ${hovered}`, title: 'LOCKED' };
  }
  return {
    key: 'idle',
    kicker: 'DAILY LEVELS',
    title: `${cleared.length} / ${LEVEL_NUMBERS.length}`,
    detail: cleared.length === LEVEL_NUMBERS.length ? 'REPLAY ANY LEVEL' : 'PICK A LEVEL',
  };
}

// The three daily levels, as orbs circling above the mountains: red while still to clear, grey once
// cleared. Pressing one plays it; a cleared one can be replayed for fun. A level that is not open yet
// turns the player away gently: the orb recoils, a low two-note sound plays, a message appears in the
// middle of the ring and the level they should play first beckons with a pulse.
function LevelOrbs({ cleared, firstRuns, disabled, onPlay, onRefuse }) {
  const [hovered, setHovered] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const refusalTimer = useRef(null);
  const nextLevel = LEVEL_NUMBERS.find((level) => !cleared.includes(level));

  useEffect(() => () => window.clearTimeout(refusalTimer.current), []);

  function press(level) {
    if (disabled) return;
    if (isOpen(level, cleared)) {
      onPlay(level);
      return;
    }
    window.clearTimeout(refusalTimer.current);
    setRefusal((previous) => ({ level, blocker: blockerOf(level, cleared), id: (previous?.id ?? 0) + 1 }));
    refusalTimer.current = window.setTimeout(() => setRefusal(null), REFUSAL_MS);
    onRefuse();
  }

  const readout = readoutFor({ refusal, hovered, cleared, firstRuns });

  return (
    <div className="menu-level-stage" role="group" aria-label="Daily levels" data-all-cleared={nextLevel === undefined}>
      <div className="menu-level-orbits">
        <div className="menu-orbit-backplate" />
        {LEVEL_NUMBERS.map((level, index) => {
          const state = cleared.includes(level) ? 'cleared' : isOpen(level, cleared) ? 'open' : 'locked';
          const refused = refusal?.level === level;
          // Remounting on each refusal restarts the CSS animations, even on repeated presses.
          const attempt = refused ? refusal.id : 0;
          let label = `Play level ${level}`;
          if (state === 'cleared') label = `Level ${level}, cleared. Replay it for fun`;
          if (state === 'locked') label = `Level ${level}, locked. Clear level ${blockerOf(level, cleared)} first`;
          return (
            <span key={level} className="menu-orb-position" style={{ '--orb-angle': `${index * 120}deg` }}>
              <button
                type="button"
                className={`menu-level-button is-${state} ${level === nextLevel ? 'is-next' : ''} ${refusal?.blocker === level ? 'is-hinted' : ''}`}
                aria-label={label}
                aria-disabled={disabled || state === 'locked'}
                onClick={() => press(level)}
                onPointerEnter={() => setHovered(level)}
                onPointerLeave={() => setHovered(null)}
                onFocus={(event) => event.currentTarget.matches(':focus-visible') && setHovered(level)}
                onBlur={() => setHovered(null)}
              >
                <span key={`orb-${attempt}`} className={`menu-level-orb ${refused ? 'is-refused' : ''}`} />
                <span key={`ring-${attempt}`} className={`menu-orb-ring ${refused ? 'is-refused' : ''}`} />
                {/* Turns against the ring, so the number stays upright as the ring slowly spins. */}
                <span className="menu-orb-upright">
                  <span key={`face-${attempt}`} className={`menu-orb-face ${refused ? 'is-refused' : ''}`}>
                    {refused ? <LockKeyhole size={15} strokeWidth={1.8} /> : level}
                    {state === 'cleared' && !refused && (
                      <span className="menu-orb-badge"><Check size={9} strokeWidth={3.4} /></span>
                    )}
                  </span>
                </span>
              </button>
            </span>
          );
        })}
      </div>

      <div className={`menu-level-readout ${readout.tone ? `is-${readout.tone}` : ''}`} aria-hidden="true">
        <div key={readout.key} className="menu-level-readout-body">
          {readout.tone === 'warn' && <LockKeyhole className="menu-readout-lock" size={15} strokeWidth={1.6} />}
          <small>{readout.kicker}</small>
          <strong>{readout.title}</strong>
          {readout.detail && <em>{readout.detail}</em>}
        </div>
      </div>
      <p className="sr-only" role="status">
        {refusal ? `Level ${refusal.level} is locked. Clear level ${refusal.blocker} first.` : ''}
      </p>
    </div>
  );
}

// On a phone: the lowest point of the logo and the account button under it, where the orbs may begin.
const PHONE_HEADER_BOTTOM = 148;

const PANEL_TITLES = { settings: 'Settings', leaderboard: 'Global Leaderboard' };

// The line under SWIPE RUSH: what pressing it will do today.
function rushNote(rush, now) {
  if (rush.status === 'running') return `RESUME · ${formatRushClock(rush.endsAt - now)} LEFT`;
  if (rush.status === 'finished') {
    const { maps } = rush.result;
    return maps > 0 ? `FIRST RUN · ${maps} ${maps === 1 ? 'MAP' : 'MAPS'}` : 'FIRST RUN · NO MAPS';
  }
  return '5 MIN · FIRST RUN COUNTS';
}

// Top-right of the menu: LOG IN when nobody is logged in, otherwise the player's name with a small menu.
function AccountChip({ player, onLogin, onLogout, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const holder = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !holder.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!player.name) {
    return (
      <div className="menu-account">
        <button type="button" className="menu-account-btn" onClick={onLogin}>
          <CutFrame shape={keyShape} />
          <LogIn size={15} strokeWidth={1.6} /> <span>LOG IN</span>
        </button>
      </div>
    );
  }
  return (
    <div className="menu-account" ref={holder}>
      <button type="button" className="menu-account-btn is-in" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        <CutFrame shape={keyShape} />
        <User size={15} strokeWidth={1.6} /> <span className="menu-account-name">{player.name.toUpperCase()}</span>
      </button>
      {open && (
        <div className="menu-account-menu" role="menu">
          <p>SIGNED IN AS {player.name.toUpperCase()}</p>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename(); }}>
            <Pencil size={14} strokeWidth={1.6} /> CHANGE USERNAME
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut size={14} strokeWidth={1.6} /> LOG OUT
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setOpen(false); onDelete(); }}>
            <Trash2 size={14} strokeWidth={1.6} /> DELETE ACCOUNT
          </button>
        </div>
      )}
    </div>
  );
}

export default function MainMenu({ onPlay, onRush, onVersus, onLogin, onLogout, onRename, onDelete, onLegal, leaving = false, settings, onSettingsChange, levelScores = {}, player, completedLevels = [], rush = { status: 'idle' }, status, error }) {
  // Which panel is showing ('settings' | 'leaderboard'), and whether it is folding away.
  const [panel, setPanel] = useState(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const panelTimer = useRef(null);
  const queuedPanel = useRef(null);
  const [timeUntilReset, setTimeUntilReset] = useState(getTimeUntilAmmanReset);
  const remainingLevels = LEVEL_NUMBERS.filter((level) => !completedLevels.includes(level));
  const allCleared = remainingLevels.length === 0;
  // PLAY goes to the first level still to clear; once everything is cleared it starts over at level 1.
  const nextLevel = remainingLevels[0] || 1;

  // With everything cleared, the menu counts down to the next set of puzzles.
  useEffect(() => {
    if (!allCleared) return undefined;
    const updateCountdown = () => setTimeUntilReset(getTimeUntilAmmanReset());
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [allCleared]);

  // A Swipe Rush left running keeps counting while the player is in the menu, so show how long is left.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (rush.status !== 'running') return undefined;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [rush.status]);

  const layoutRef = useRef(null);
  const navRef = useRef(null);
  const sectionRef = useRef(null);
  const menuRef = useRef(null);
  const panelRef = useRef(null);
  const upperLineRef = useRef(null);
  const lowerLineRef = useRef(null);
  const gemRef = useRef(null);
  const fanLineRefs = useRef([]);
  const settingsButtonRef = useRef(null);
  const leaderboardButtonRef = useRef(null);
  const openPanel = panel && !panelClosing ? panel : null;
  const panelButtonRef = panel === 'leaderboard' ? leaderboardButtonRef : settingsButtonRef;

  useEffect(() => () => window.clearTimeout(panelTimer.current), []);

  // On a phone the menu is a column pinned to the bottom, and the level orbs fill the free space
  // between the logo and the menu. This measures that space, so the ring is sized to fit it and
  // never turns behind a menu button.
  useLayoutEffect(() => {
    const root = menuRef.current;
    const section = sectionRef.current;
    if (!root || !section) return undefined;
    const phone = window.matchMedia('(max-width: 760px)');
    function fit() {
      if (!phone.matches) {
        root.style.removeProperty('--stage-y');
        root.style.removeProperty('--orbit-fit');
        root.removeAttribute('data-tight');
        return;
      }
      const top = PHONE_HEADER_BOTTOM;
      const bottom = section.getBoundingClientRect().top - 6;
      const room = Math.max(bottom - top, 0);
      const radius = Math.min(Math.max((room - 56) / 2, 38), Math.min(96, window.innerWidth * 0.22));
      root.style.setProperty('--stage-y', `${Math.round(top + room / 2)}px`);
      root.style.setProperty('--orbit-fit', `${Math.round(radius)}px`);
      // A ring this small has no room for the words in its middle.
      root.toggleAttribute('data-tight', radius < 56);
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(section);
    window.addEventListener('resize', fit);
    phone.addEventListener('change', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      phone.removeEventListener('change', fit);
    };
  }, []);

  function closePanel({ restoreFocus = false } = {}) {
    if (!panel || panelClosing) return;
    if (restoreFocus && panelRef.current?.contains(document.activeElement)) {
      panelButtonRef.current?.focus({ preventScroll: true });
    }
    setPanelClosing(true);
    panelTimer.current = window.setTimeout(() => {
      const next = queuedPanel.current;
      queuedPanel.current = null;
      setPanelClosing(false);
      setPanel(next);
    }, prefersReducedMotion() ? 0 : PANEL_CLOSE_MS);
  }

  // Opening one panel while the other is showing folds the first away, then unfolds the second.
  function togglePanel(id) {
    if (panel === id) {
      if (!panelClosing) {
        closePanel();
        return;
      }
      window.clearTimeout(panelTimer.current);
      queuedPanel.current = null;
      setPanelClosing(false);
      return;
    }
    if (!panel) {
      setPanel(id);
      return;
    }
    queuedPanel.current = id;
    closePanel();
  }

  useEffect(() => {
    if (!openPanel) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') closePanel({ restoreFocus: true });
    }
    // Clicking the background folds the panel away; the menu buttons handle themselves.
    function onPointerDown(event) {
      if (panelRef.current?.contains(event.target) || navRef.current?.contains(event.target)) return;
      closePanel();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  });

  // Places the panel just past the navigation and draws the connector from its menu item.
  const positionPanel = useCallback(() => {
    const layout = layoutRef.current;
    const element = panelRef.current;
    const nav = navRef.current;
    const button = panelButtonRef.current;
    if (!layout || !element || !nav || !button) return;

    if (window.matchMedia('(max-width: 760px)').matches) {
      for (const property of ['left', 'top', 'max-width', '--fold-top', '--fold-bottom']) element.style.removeProperty(property);
      return;
    }

    const box = layout.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    // Room between the menu and the panel for the connector lines and the crystal node.
    const gap = Math.min(170, Math.max(120, window.innerWidth * 0.09));
    const left = Math.round(navBox.right - box.left + gap);
    element.style.left = `${left}px`;
    element.style.maxWidth = `${Math.max(320, box.width - left - 24)}px`;

    const height = element.offsetHeight;
    const centerY = buttonBox.top + buttonBox.height / 2 - box.top;
    const margin = box.height - height >= 144 ? 72 : 16;
    // The panel rides slightly above its menu row, so the connector meets its lower half.
    const top = Math.round(Math.min(Math.max(centerY - height * 0.6, margin), Math.max(margin, box.height - height - margin)));
    const foldY = Math.min(Math.max(centerY - top, 48), height - 48);
    element.style.top = `${top}px`;
    element.style.setProperty('--fold-top', `${foldY}px`);
    element.style.setProperty('--fold-bottom', `${height - foldY}px`);

    // Crystal node sits against the panel's left edge, between the menu row and the panel's middle.
    const radius = Math.min(44, Math.max(28, window.innerWidth * 0.024));
    const gemX = left - radius - 4;
    const gemY = Math.min(Math.max((centerY + top + height / 2) / 2, top + 90), top + height - 90);
    gemRef.current?.setAttribute('transform', `translate(${gemX} ${gemY}) scale(${radius})`);

    // Two lines run from the menu item into the node...
    const startX = navBox.right - box.left + 4;
    const entryX = gemX - radius - 2;
    const knee = startX + (entryX - startX) * 0.55;
    upperLineRef.current?.setAttribute('d', `M${startX - 8} ${centerY - 12} L${startX} ${centerY - 5} L${knee} ${centerY - 5} L${entryX} ${gemY - 3}`);
    lowerLineRef.current?.setAttribute('d', `M${startX - 8} ${centerY + 12} L${startX} ${centerY + 5} L${knee} ${centerY + 5} L${entryX} ${gemY + 3}`);

    // ...and a wireframe fan spreads from its points to the panel's edge.
    const edgeX = left + HALF;
    const clampY = (y) => Math.min(Math.max(y, top + 34), top + height - 44);
    const topApex = [gemX - radius * 0.3, gemY - radius * 0.95];
    const bottomApex = [gemX - radius * 0.3, gemY + radius * 0.95];
    const upperRight = [gemX + radius * 0.45, gemY - radius * 0.6];
    const lowerRight = [gemX + radius * 0.45, gemY + radius * 0.6];
    const fan = [
      [topApex, top + 34],
      [topApex, clampY(gemY - height * 0.24)],
      [upperRight, clampY(gemY - height * 0.1)],
      [lowerRight, clampY(gemY + height * 0.1)],
      [bottomApex, clampY(gemY + height * 0.24)],
      [bottomApex, top + height - 44],
    ];
    fan.forEach(([[fromX, fromY], toY], index) => {
      fanLineRefs.current[index]?.setAttribute('d', `M${fromX} ${fromY} L${edgeX} ${toY}`);
    });
  }, [panelButtonRef]);

  useLayoutEffect(() => {
    if (!panel) return undefined;
    positionPanel();
    const observer = new ResizeObserver(() => positionPanel());
    [layoutRef, navRef, panelRef].forEach((ref) => ref.current && observer.observe(ref.current));
    window.addEventListener('resize', positionPanel);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', positionPanel);
    };
  }, [panel, positionPanel]);

  function handleAction(action) {
    if (action === 'play') onPlay(nextLevel);
    else if (action === 'rush') onRush();
    else if (action === 'versus') onVersus();
    else togglePanel(action);
  }

  // Boards are generated on the device, so this only lasts a moment after the page loads.
  const connecting = status !== 'ready';

  function playLabel() {
    if (connecting) return 'LOADING';
    if (allCleared) return 'PLAY AGAIN';
    return completedLevels.length ? 'CONTINUE' : 'PLAY';
  }

  function refuseLevel() {
    if (settings.sfx) sounds.refused(settings.sfxVolume);
    vibrate([14, 50, 14]);
  }

  return (
    <section ref={menuRef} className={`duel-menu ${openPanel ? 'has-panel-open' : ''} ${leaving ? 'is-leaving' : ''}`} aria-label="Swipe Cover main menu">
      <div className="menu-grain" aria-hidden="true" />
      <AccountChip player={player} onLogin={onLogin} onLogout={onLogout} onRename={onRename} onDelete={onDelete} />

      <div className="menu-layout" ref={layoutRef}>
        <section className="menu-navigation" aria-label="Main menu" ref={sectionRef}>
          <div className="menu-orbit menu-orbit-one" aria-hidden="true" />
          <div className="menu-orbit menu-orbit-two" aria-hidden="true" />
          <nav ref={navRef}>
            {MENU_ITEMS.map(({ id, label, icon: Icon }) => {
              const isPlay = id === 'play';
              const isRush = id === 'rush' || id === 'versus';
              let icon = <Icon size={17} strokeWidth={1.35} />;
              if (isPlay && connecting) icon = <LoaderCircle className="menu-spin" size={17} strokeWidth={1.35} />;
              return (
                <button
                  type="button"
                  key={id}
                  ref={id === 'settings' ? settingsButtonRef : id === 'leaderboard' ? leaderboardButtonRef : undefined}
                  onClick={() => handleAction(id)}
                  className={`menu-nav-item ${isPlay && !connecting && !openPanel ? 'is-primary' : ''} ${isPlay && connecting ? 'is-locked' : ''} ${isRush ? 'is-rush' : ''} ${openPanel === id ? 'is-selected' : ''}`}
                  disabled={isPlay && connecting}
                  aria-expanded={isPlay || isRush ? undefined : openPanel === id}
                >
                  <span className="menu-nav-icon">{icon}</span>
                  <span className="menu-nav-text">
                    <span className="menu-nav-label">{isPlay ? playLabel() : label}</span>
                    {id === 'rush' && <small className="menu-nav-sub">{rushNote(rush, now)}</small>}
                    {id === 'versus' && <small className="menu-nav-sub">{player.name ? 'LIVE · MOST MAPS WINS' : 'LOG IN TO PLAY'}</small>}
                  </span>
                  {!(isPlay && connecting) && <ArrowUpRight className="menu-nav-arrow" size={16} strokeWidth={1.5} />}
                </button>
              );
            })}
          </nav>
          {allCleared && (
            <p className="menu-countdown">
              <span>NEW PUZZLES IN</span>
              <strong>{formatCountdown(timeUntilReset)}</strong>
            </p>
          )}
          {error && <p className="menu-error" role="alert">{error}</p>}
        </section>
        {panel && (
          <>
            <svg key={`${panel}-connector`} className={`menu-panel-connector ${panelClosing ? 'is-closing' : ''}`} aria-hidden="true">
              <defs>
                <radialGradient id="menu-gem-halo">
                  <stop offset="0" stopColor="#4ef3d0" stopOpacity=".42" />
                  <stop offset=".45" stopColor="#3fc9c4" stopOpacity=".14" />
                  <stop offset="1" stopColor="#3fc9c4" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="menu-gem-fill" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#bff8ec" stopOpacity=".55" />
                  <stop offset=".5" stopColor="#3cc7c0" stopOpacity=".38" />
                  <stop offset="1" stopColor="#0d4a55" stopOpacity=".7" />
                </linearGradient>
                <linearGradient id="menu-gem-core" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor="#e9fffa" />
                  <stop offset="1" stopColor="#4ef3d0" />
                </linearGradient>
                <filter id="menu-gem-glow" x="-1" y="-1" width="3" height="3">
                  <feGaussianBlur stdDeviation="0.16" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path ref={upperLineRef} className="menu-link-line" pathLength="1" />
              <path ref={lowerLineRef} className="menu-link-line" pathLength="1" />
              {Array.from({ length: FAN_LINE_COUNT }, (_, index) => (
                <path
                  key={index}
                  ref={(element) => { fanLineRefs.current[index] = element; }}
                  className="menu-fan-line"
                  pathLength="1"
                  style={{ '--n': index }}
                />
              ))}
              <g ref={gemRef}>
                <g className="menu-gem">
                  <circle className="menu-gem-halo" r="2.6" fill="url(#menu-gem-halo)" />
                  <g filter="url(#menu-gem-glow)">
                    <polygon points={GEM_OUTER} fill="url(#menu-gem-fill)" className="menu-gem-edge" vectorEffect="non-scaling-stroke" />
                    <polygon points={GEM_CORE} fill="url(#menu-gem-core)" className="menu-gem-core" vectorEffect="non-scaling-stroke" />
                    <path d={GEM_FACETS} className="menu-gem-facets" vectorEffect="non-scaling-stroke" />
                  </g>
                </g>
              </g>
            </svg>
            <MenuPanel
              key={panel}
              ref={panelRef}
              id={panel}
              title={PANEL_TITLES[panel]}
              closing={panelClosing}
              onClose={() => closePanel({ restoreFocus: true })}
            >
              {panel === 'settings'
                ? <SettingsContent settings={settings} onSettingsChange={onSettingsChange} />
                : <LeaderboardContent levelScores={levelScores} player={player} rush={rush} />}
            </MenuPanel>
          </>
        )}
      </div>

      {/* Behind everything (z-index) but after the menu in the DOM, so Tab reaches the menu first. */}
      <MenuAtmosphere>
        <LevelOrbs
          cleared={completedLevels}
          firstRuns={levelScores}
          disabled={connecting || leaving}
          onPlay={onPlay}
          onRefuse={refuseLevel}
        />
      </MenuAtmosphere>

      <div className="menu-footer">
        <span><i /> {completedLevels.length} / 3 GAMES CLEARED TODAY</span>
        <span className="menu-footer-divider" />
        <span>MOVE WITH INTENTION</span>
        <span className="menu-footer-divider" />
        <span className="menu-footer-links">
          <button type="button" onClick={() => onLegal?.('privacy')}>PRIVACY</button>
          <button type="button" onClick={() => onLegal?.('terms')}>TERMS</button>
        </span>
      </div>
    </section>
  );
}
