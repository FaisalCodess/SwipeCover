import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Gamepad2, LoaderCircle, LockKeyhole, Settings, Trophy, User, X } from 'lucide-react';
import { fetchLeaderboard } from './api.js';
import { getTimeUntilAmmanReset } from './dailyReset.js';
import { sounds } from './audio.js';
import { KEY_BINDINGS } from './controls.js';

const MENU_ITEMS = [
  { id: 'play', label: 'PLAY', icon: Gamepad2 },
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

function createMotes(width, height) {
  const amount = Math.min(100, Math.max(38, Math.round(width * height / 15000)));
  return Array.from({ length: amount }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.random() * 1.6 + 0.45,
    speed: Math.random() * 0.26 + 0.08,
    phase: Math.random() * Math.PI * 2,
    hue: Math.random() > 0.56 ? 354 : 192,
    alpha: Math.random() * 0.48 + 0.2,
    length: Math.random() * 16 + 8,
  }));
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

function EmberField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const glowSprites = { 354: createGlowSprite(354), 192: createGlowSprite(192) };
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame;
    let width = 0;
    let height = 0;
    let motes = [];
    let lastFrame = 0;

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      motes = createMotes(width, height);
      draw(0, true);
    }

    function draw(timestamp, staticFrame = false) {
      if (!staticFrame && timestamp - lastFrame < 32) {
        frame = window.requestAnimationFrame((time) => draw(time));
        return;
      }
      lastFrame = timestamp;
      context.clearRect(0, 0, width, height);

      for (const mote of motes) {
        const drift = staticFrame ? 0 : Math.sin(timestamp * 0.00035 + mote.phase) * 0.22;
        const verticalDrift = staticFrame ? 0 : mote.speed * 0.45;
        const x = mote.x + drift;
        const y = mote.y;
        const gradient = context.createLinearGradient(x, y, x - mote.length * 0.6, y + mote.length);
        gradient.addColorStop(0, `hsla(${mote.hue}, 96%, 70%, ${mote.alpha})`);
        gradient.addColorStop(1, `hsla(${mote.hue}, 96%, 60%, 0)`);
        context.strokeStyle = gradient;
        context.lineWidth = mote.radius;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x - mote.length * 0.6, y + mote.length);
        context.stroke();
        const glowSize = mote.radius * 2 + 24;
        context.globalAlpha = mote.alpha;
        context.drawImage(glowSprites[mote.hue], x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
        context.globalAlpha = 1;
        if (!staticFrame) {
          mote.y -= verticalDrift;
          mote.x += Math.sin(timestamp * 0.00028 + mote.phase) * 0.09;
          if (mote.y < -mote.length) {
            mote.y = height + mote.length;
            mote.x = Math.random() * width;
          }
          if (mote.x < -20) mote.x = width + 10;
          if (mote.x > width + 20) mote.x = -10;
        }
      }

      if (!staticFrame && !motionQuery.matches) {
        frame = window.requestAnimationFrame((time) => draw(time));
      }
    }

    function onMotionPreferenceChange() {
      window.cancelAnimationFrame(frame);
      if (motionQuery.matches) draw(performance.now(), true);
      else frame = window.requestAnimationFrame((time) => draw(time));
    }

    resize();
    if (!motionQuery.matches) frame = window.requestAnimationFrame((time) => draw(time));
    window.addEventListener('resize', resize);
    motionQuery.addEventListener('change', onMotionPreferenceChange);
    return () => {
      window.cancelAnimationFrame(frame);
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

function MenuAtmosphere({ remainingLevels }) {
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
      <div className="menu-depth menu-depth-mid">
        {remainingLevels.length > 0 && (
          <div
            className="menu-level-orbits"
            data-orb-count={remainingLevels.length}
            aria-hidden="true"
          >
            <div className="menu-orbit-backplate" />
            {remainingLevels.map((level, index) => (
              <span
                key={level}
                data-level-orb={level}
                className="menu-orb-position"
                style={{ '--orb-angle': `${index * 360 / remainingLevels.length}deg` }}
              >
                <span className="menu-level-orb" />
              </span>
            ))}
          </div>
        )}
      </div>
      <CrystalRange />
      <div className="menu-vignette" />
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

function keyShape(width, height) {
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

// The glowing crystal node on the connector, in unit coordinates (scaled to its radius).
const GEM_OUTER = '-1,0 -0.3,-0.95 0.45,-0.6 1,0 0.45,0.6 -0.3,0.95';
const GEM_CORE = '-0.38,-0.48 0.62,0 -0.38,0.48';
const GEM_FACETS = 'M-1 0L-0.38 -0.48M-1 0L-0.38 0.48M-0.3 -0.95L-0.38 -0.48M0.45 -0.6L-0.38 -0.48M0.45 -0.6L0.62 0'
  + 'M1 0L0.62 0M0.45 0.6L0.62 0M0.45 0.6L-0.38 0.48M-0.3 0.95L-0.38 0.48';
const FAN_LINE_COUNT = 6;

// An angular outline drawn in SVG, because CSS borders disappear along clip-path diagonals.
function CutFrame({ shape, className = '', marks }) {
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
    if (next.sfx) sounds.move(next.volume, 3);
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

      <div className="menu-settings-volume menu-panel-item" style={{ '--i': 3 }}>
        <label htmlFor="menu-settings-volume">VOLUME</label>
        <output htmlFor="menu-settings-volume">{settings.volume}%</output>
        <input
          id="menu-settings-volume"
          type="range"
          min="0"
          max="100"
          value={settings.volume}
          style={{ '--range-progress': `${settings.volume}%` }}
          onChange={(event) => onSettingsChange({ ...settings, volume: Number(event.target.value) })}
          onPointerUp={() => previewSound(settings)}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') previewSound(settings);
          }}
        />
        <RangeBracket />
      </div>

      <div className="menu-panel-section menu-panel-item" style={{ '--i': 4 }}>
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

function BoardRow({ entry, best }) {
  return (
    <li className={`menu-board-row ${best ? 'is-best' : ''} ${entry.you ? 'is-you' : ''}`}>
      <span className="menu-board-rank">{String(entry.rank).padStart(2, '0')}</span>
      <span className="menu-board-avatar" aria-hidden="true"><User size={13} strokeWidth={1.8} /></span>
      <span className="menu-board-name">
        {entry.name}
        {entry.you && <small className="menu-board-you">YOU</small>}
      </span>
      <span className="menu-board-moves">
        {entry.moves} moves
        {best && <small>BEST</small>}
      </span>
      <span className="menu-board-time">{formatMenuTime(entry.time_ms)}</span>
    </li>
  );
}

// Today's global top 10 per level. Without the server it falls back to this device's times.
function LeaderboardContent({ levelScores, player }) {
  const [activeLevel, setActiveLevel] = useState(() => (
    [3, 2, 1].find((level) => levelScores?.[level]?.length) || 1
  ));
  const [boards, setBoards] = useState({});
  const board = boards[activeLevel];

  useEffect(() => {
    const controller = new AbortController();
    setBoards((previous) => ({ ...previous, [activeLevel]: { ...previous[activeLevel], status: previous[activeLevel]?.entries ? 'ready' : 'loading' } }));
    fetchLeaderboard(activeLevel, player.id, controller.signal)
      .then((data) => setBoards((previous) => ({ ...previous, [activeLevel]: { status: 'ready', entries: data.entries, you: data.you } })))
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.info('Global leaderboard unavailable; showing this device.', error.message);
          setBoards((previous) => ({ ...previous, [activeLevel]: { status: 'offline' } }));
        }
      });
    return () => controller.abort();
  }, [activeLevel, player.id]);

  let entries = board?.entries || [];
  if (board?.status === 'offline') {
    entries = (levelScores?.[activeLevel] || [])
      .filter((entry) => Number.isFinite(entry?.time))
      .sort((left, right) => left.time - right.time)
      .slice(0, 10)
      .map((entry, index) => ({ rank: index + 1, name: player.name || 'You', moves: entry.moves, time_ms: entry.time, you: true }));
  }

  let footer = player.name ? `PLAYING AS ${player.name.toUpperCase()}` : 'FINISH A LEVEL TO JOIN';
  if (board?.status === 'offline') footer = 'OFFLINE · SHOWING THIS DEVICE';

  return (
    <>
      <div className="menu-board-tabs menu-panel-item" role="tablist" aria-label="Leaderboard level" style={{ '--i': 1 }}>
        {[1, 2, 3].map((level) => (
          <button
            type="button"
            key={level}
            role="tab"
            aria-selected={activeLevel === level}
            aria-controls="menu-board-list"
            className={`menu-board-tab ${activeLevel === level ? 'is-active' : ''}`}
            onClick={() => setActiveLevel(level)}
          >
            Level {level}
          </button>
        ))}
      </div>

      {/* Always sized for ten rows, so switching levels never resizes or moves the panel. */}
      <div
        id="menu-board-list"
        className="menu-board-list menu-panel-item"
        role="tabpanel"
        aria-label={`Level ${activeLevel} top times`}
        aria-busy={board?.status === 'loading' || !board}
        style={{ '--i': 2 }}
      >
        {entries.length > 0 && (
          <ol>
            {entries.map((entry) => <BoardRow key={`${entry.rank}-${entry.name}`} entry={entry} best={entry.rank === 1} />)}
            {board?.you && (
              <>
                <li className="menu-board-gap" aria-hidden="true">···</li>
                <BoardRow entry={board.you} best={false} />
              </>
            )}
          </ol>
        )}
        {!entries.length && (
          <div className="menu-board-empty">
            {board?.status === 'ready' || board?.status === 'offline' ? (
              <>
                <span>NO TIMES YET</span>
                <p>Be the first to finish level {activeLevel} today.</p>
              </>
            ) : (
              <span className="menu-board-loading"><LoaderCircle className="menu-spin" size={15} /> LOADING</span>
            )}
          </div>
        )}
      </div>

      <div className="menu-board-footer menu-panel-item" style={{ '--i': 3 }}>
        <span>TODAY · TOP 10</span>
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

const PANEL_TITLES = { settings: 'Settings', leaderboard: 'Global Leaderboard' };

export default function MainMenu({ onPlay, settings, onSettingsChange, levelScores = {}, player, completedLevels = [], status, error }) {
  // Which panel is showing ('settings' | 'leaderboard'), and whether it is folding away.
  const [panel, setPanel] = useState(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const panelTimer = useRef(null);
  const queuedPanel = useRef(null);
  const [timeUntilReset, setTimeUntilReset] = useState(getTimeUntilAmmanReset);
  const remainingLevels = [1, 2, 3].filter((level) => !completedLevels.includes(level));
  const nextLevel = remainingLevels[0] || 1;

  useEffect(() => {
    if (remainingLevels.length) return undefined;
    const updateCountdown = () => setTimeUntilReset(getTimeUntilAmmanReset());
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [remainingLevels.length]);

  const layoutRef = useRef(null);
  const navRef = useRef(null);
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
    else togglePanel(action);
  }

  const locked = remainingLevels.length === 0;
  // Boards are generated on the device, so this only lasts a moment after the page loads.
  const connecting = status !== 'ready';

  function playLabel() {
    if (locked) return 'LOCKED';
    if (connecting) return 'LOADING';
    return completedLevels.length ? 'CONTINUE' : 'PLAY';
  }

  return (
    <section className={`duel-menu ${openPanel ? 'has-panel-open' : ''}`} aria-label="Swipe Cover main menu">
      <MenuAtmosphere remainingLevels={remainingLevels} />
      <div className="menu-grain" aria-hidden="true" />

      <header className="menu-brand">
        <span className="menu-brand-orb" aria-hidden="true"><i /></span>
        <span className="menu-brand-name">SWIPE COVER</span>
      </header>

      <div className="menu-layout" ref={layoutRef}>
        <section className="menu-navigation" aria-label="Main menu">
          <div className="menu-orbit menu-orbit-one" aria-hidden="true" />
          <div className="menu-orbit menu-orbit-two" aria-hidden="true" />
          <nav ref={navRef}>
            {MENU_ITEMS.map(({ id, label, icon: Icon }) => {
              const isPlay = id === 'play';
              let icon = <Icon size={17} strokeWidth={1.35} />;
              if (isPlay && locked) icon = <LockKeyhole size={17} strokeWidth={1.35} />;
              else if (isPlay && connecting) icon = <LoaderCircle className="menu-spin" size={17} strokeWidth={1.35} />;
              return (
                <button
                  type="button"
                  key={id}
                  ref={id === 'settings' ? settingsButtonRef : id === 'leaderboard' ? leaderboardButtonRef : undefined}
                  onClick={() => handleAction(id)}
                  className={`menu-nav-item ${isPlay && !locked && !openPanel ? 'is-primary' : ''} ${isPlay && (locked || connecting) ? 'is-locked' : ''} ${openPanel === id ? 'is-selected' : ''}`}
                  disabled={isPlay && (locked || connecting)}
                  aria-label={isPlay && locked ? 'Play is locked until the daily puzzles reset' : undefined}
                  aria-expanded={isPlay ? undefined : openPanel === id}
                >
                  <span className="menu-nav-icon">{icon}</span>
                  <span className="menu-nav-label">{isPlay ? playLabel() : label}</span>
                  {!(isPlay && (locked || connecting)) && <ArrowUpRight className="menu-nav-arrow" size={16} strokeWidth={1.5} />}
                </button>
              );
            })}
          </nav>
          {remainingLevels.length === 0 && (
            <p className="menu-countdown">
              <span>COME BACK IN</span>
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
                : <LeaderboardContent levelScores={levelScores} player={player} />}
            </MenuPanel>
          </>
        )}
      </div>

      <div className="menu-footer">
        <span><i /> {completedLevels.length} / 3 GAMES CLEARED TODAY</span>
        <span className="menu-footer-divider" />
        <span>MOVE WITH INTENTION</span>
      </div>
    </section>
  );
}
