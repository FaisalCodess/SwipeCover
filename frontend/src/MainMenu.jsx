import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Crown, Gamepad2, LockKeyhole, Settings2, Trophy, X } from 'lucide-react';
import { getTimeUntilAmmanReset } from './dailyReset.js';

const MENU_ITEMS = [
  { id: 'play', label: 'PLAY', icon: Gamepad2 },
  { id: 'settings', label: 'SETTINGS', icon: Settings2 },
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

function EmberField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
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
        context.fillStyle = `hsla(${mote.hue}, 100%, 76%, ${mote.alpha})`;
        context.shadowBlur = 12;
        context.shadowColor = `hsla(${mote.hue}, 100%, 62%, ${mote.alpha})`;
        context.beginPath();
        context.arc(x, y, mote.radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
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

function SettingsPanel({ settings, onSettingsChange, onClose, closing }) {
  const keyControls = [
    ['up', 'W'],
    ['left', 'A'],
    ['down', 'S'],
    ['right', 'D'],
    ['restart', 'SPACE'],
  ];

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

  return (
    <aside
      className={`menu-settings-panel ${closing ? 'is-closing' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="menu-settings-title"
    >
      <div className="menu-settings-connector" aria-hidden="true" />
      <header className="menu-settings-header">
        <h2 id="menu-settings-title">SETTINGS</h2>
        <button type="button" className="menu-settings-close" onClick={onClose} aria-label="Close settings"><X size={16} /></button>
      </header>

      <div className="menu-settings-row">
        <span>MUSIC</span>
        <Toggle label="Toggle music" checked={settings.music} onChange={(music) => onSettingsChange({ ...settings, music })} />
      </div>
      <div className="menu-settings-row">
        <span>SOUND EFFECTS</span>
        <Toggle label="Toggle sound effects" checked={settings.sfx} onChange={(sfx) => onSettingsChange({ ...settings, sfx })} />
      </div>

      <label className="menu-settings-volume">
        <span><span>VOLUME</span><output>{settings.volume}%</output></span>
        <input
          type="range"
          min="0"
          max="100"
          value={settings.volume}
          style={{ '--range-progress': `${settings.volume}%` }}
          onChange={(event) => onSettingsChange({ ...settings, volume: Number(event.target.value) })}
          aria-label="Volume"
        />
      </label>

      <div className="menu-keyboard-settings">
        <span>KEYBOARD CONTROLS</span>
        <div>
          {keyControls.map(([binding, fallback]) => {
            const key = binding === 'restart' ? ' ' : settings.keybinds[binding];
            const label = key === ' ' ? fallback : String(key || fallback).toUpperCase();
            return <kbd key={binding} title={binding === 'restart' ? 'Restart' : binding}>{label}</kbd>;
          })}
        </div>
      </div>
    </aside>
  );
}

function LeaderboardDialog({ levelScores, onClose }) {
  const [activeLevel, setActiveLevel] = useState(1);
  const scores = levelScores?.[String(activeLevel)] || [];
  const sortedScores = [...scores]
    .filter((entry) => Number.isFinite(entry?.time) && entry.time >= 0)
    .sort((left, right) => left.time - right.time)
    .slice(0, 5);

  return (
    <div className="menu-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="menu-dialog" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
        <button type="button" className="menu-dialog-close" onClick={onClose} aria-label="Close leaderboard"><X size={18} /></button>
        <span className="menu-dialog-kicker">TODAY'S RUN</span>
        <h2 id="leaderboard-title">Leaderboard</h2>
        <div className="menu-leaderboard-tabs" role="tablist" aria-label="Leaderboard level">
          {[1, 2, 3].map((level) => (
            <button
              type="button"
              key={level}
              role="tab"
              aria-selected={activeLevel === level}
              aria-controls={`leaderboard-level-${level}`}
              className={activeLevel === level ? 'is-active' : ''}
              onClick={() => setActiveLevel(level)}
            >
              Level {level}
            </button>
          ))}
        </div>
        {sortedScores.length ? (
          <ol className="menu-score-list" id={`leaderboard-level-${activeLevel}`} role="tabpanel">
            {sortedScores.map((entry, index) => {
              const isLocalPlayer = entry.name === 'You';
              return (
                <li key={`${entry.name}-${entry.time}-${index}`} className={isLocalPlayer ? 'is-local-player' : ''}>
                  <span className="menu-score-rank">{String(index + 1).padStart(2, '0')}</span>
                  <span className="menu-score-name">{entry.name}{isLocalPlayer && <small>BEST RUN</small>}</span>
                  <span className="menu-score-time">{formatMenuTime(entry.time)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="menu-leaderboard-empty" id={`leaderboard-level-${activeLevel}`} role="tabpanel">
            <Crown size={25} />
            <p>No scores yet for Level {activeLevel}.</p>
            <span>Finish this level and your best time will appear here.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function formatMenuTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '--:--:--';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((unit) => String(unit).padStart(2, '0')).join(':');
}

export default function MainMenu({ onPlay, settings, onSettingsChange, levelScores = {}, completedLevels = [], serverReady, busy, error }) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const settingsCloseTimer = useRef(null);
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

  useEffect(() => {
    if (!showLeaderboard && !showSettings) return undefined;
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      if (showSettings) closeSettings();
      else setShowLeaderboard(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showLeaderboard, showSettings, settingsClosing]);

  useEffect(() => () => window.clearTimeout(settingsCloseTimer.current), []);

  function openSettings() {
    window.clearTimeout(settingsCloseTimer.current);
    setSettingsClosing(false);
    setShowSettings(true);
  }

  function closeSettings() {
    if (settingsClosing) return;
    setSettingsClosing(true);
    settingsCloseTimer.current = window.setTimeout(() => {
      setShowSettings(false);
      setSettingsClosing(false);
    }, 240);
  }

  function handleAction(action) {
    if (action === 'play') void onPlay(nextLevel);
    if (action === 'settings') openSettings();
    if (action === 'leaderboard') setShowLeaderboard(true);
  }

  return (
    <section className={`duel-menu ${showSettings ? 'has-settings-open' : ''}`} aria-label="Swipe Cover main menu">
      <MenuAtmosphere remainingLevels={remainingLevels} />
      <div className="menu-grain" aria-hidden="true" />

      <header className="menu-brand">
        <span className="menu-brand-orb" aria-hidden="true"><i /></span>
        <span className="menu-brand-name">SWIPE COVER</span>
      </header>

      <div className="menu-layout">
        <section className="menu-navigation" aria-label="Main menu">
          <div className="menu-orbit menu-orbit-one" aria-hidden="true" />
          <div className="menu-orbit menu-orbit-two" aria-hidden="true" />
          <nav>
            {MENU_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => handleAction(id)}
                className={`menu-nav-item ${id === 'play' && remainingLevels.length > 0 ? 'is-primary' : ''} ${id === 'play' && remainingLevels.length === 0 ? 'is-locked' : ''} ${id === 'settings' && showSettings ? 'is-selected' : ''}`}
                disabled={id === 'play' && (remainingLevels.length === 0 || !serverReady || busy)}
                aria-disabled={id === 'play' && (remainingLevels.length === 0 || !serverReady || busy)}
                aria-label={id === 'play' && remainingLevels.length === 0 ? 'Locked until daily games reset' : label}
              >
                <span className="menu-nav-icon">{id === 'play' && remainingLevels.length === 0 ? <LockKeyhole size={17} strokeWidth={1.35} /> : <Icon size={17} strokeWidth={1.35} />}</span>
                <span className="menu-nav-label">{id === 'play' && remainingLevels.length === 0 ? 'LOCKED' : label}</span>
                {!(id === 'play' && remainingLevels.length === 0) && <ArrowUpRight className="menu-nav-arrow" size={16} strokeWidth={1.5} />}
              </button>
            ))}
          </nav>
          {remainingLevels.length === 0 && (
            <p className="menu-countdown">
              <span>COME BACK IN</span>
              <strong>{formatCountdown(timeUntilReset)}</strong>
            </p>
          )}
          {error && <p className="menu-error" role="alert">{error}</p>}
        </section>
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onSettingsChange={onSettingsChange}
            onClose={closeSettings}
            closing={settingsClosing}
          />
        )}
      </div>

      <div className="menu-footer">
        <span><i /> {completedLevels.length} / 3 GAMES CLEARED TODAY</span>
        <span className="menu-footer-divider" />
        <span>MOVE WITH INTENTION</span>
      </div>

      {showLeaderboard && <LeaderboardDialog levelScores={levelScores} onClose={() => setShowLeaderboard(false)} />}
    </section>
  );
}
