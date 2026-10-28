import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  Clock3,
  Gamepad2,
  Keyboard,
  LoaderCircle,
  Moon,
  Pause,
  RotateCcw,
  Settings2,
  Sparkles,
  Sun,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import MainMenu from './MainMenu.jsx';
import './main-menu.css';
import { getAmmanDayKey, getAmmanNextMidnight } from './dailyReset.js';

const API_URL = import.meta.env.VITE_GAME_API_URL || 'http://127.0.0.1:8000/api';
const STORAGE_KEY = 'swipe-cover-save-v2';
const LEVELS = 3;
const MUSIC_NOTES = [220, 247, 277, 330, 392, 330, 277, 247, 220, 196, 174, 196];
const DIRECTIONS = [
  { id: 'up', label: 'Up', icon: ArrowUp, key: 'ArrowUp' },
  { id: 'left', label: 'Left', icon: ArrowLeft, key: 'ArrowLeft' },
  { id: 'down', label: 'Down', icon: ArrowDown, key: 'ArrowDown' },
  { id: 'right', label: 'Right', icon: ArrowRight, key: 'ArrowRight' },
];
const DEFAULT_SETTINGS = {
  theme: 'dark',
  music: true,
  sfx: true,
  volume: 65,
  keybinds: { up: 'w', left: 'a', down: 's', right: 'd', restart: ' ' },
};

function readSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(saved.settings || {}),
        keybinds: { ...DEFAULT_SETTINGS.keybinds, ...(saved.settings?.keybinds || {}) },
      },
      leaderboard: saved.leaderboard || {},
    };
  } catch (error) {
    console.error('Could not read saved game data.', error);
    return { settings: DEFAULT_SETTINGS, leaderboard: {} };
  }
}

function formatTime(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

async function requestGame(path, payload) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Game server error (${response.status}): ${detail}`);
  }
  return response.json();
}

function Panel({ children, className = '' }) {
  return (
    <section className={`panel rounded-3xl border border-white/[0.08] bg-[#11171d]/85 shadow-2xl shadow-black/10 ${className}`}>
      {children}
    </section>
  );
}

function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-11 w-11 place-items-center rounded-2xl border border-mint/20 bg-mint/[0.09]">
        <span className="h-3 w-3 rounded-full bg-mint shadow-[0_0_18px_rgba(124,232,185,0.85)]" />
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0b0f14] bg-rose-400" />
      </div>
      <div>
        <p className="font-['Space_Grotesk'] text-lg font-bold leading-tight tracking-tight">swipe cover</p>
        {!compact && <p className="muted mt-0.5 text-xs text-slate-400">A little daily brain workout</p>}
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children, className = '', disabled = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.035] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-mint px-5 py-3 text-sm font-bold text-[#102019] shadow-lg shadow-mint/10 transition hover:bg-[#96f2ca] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

function SettingsDialog({ settings, onSettingsChange, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Panel className="w-full max-w-md p-6 sm:p-7" >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-mint">Preferences</p>
            <h2 className="mt-2 font-['Space_Grotesk'] text-2xl font-bold">Your settings</h2>
          </div>
          <IconButton label="Close settings" onClick={onClose}><X size={18} /></IconButton>
        </div>
        <div className="mt-7 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {settings.theme === 'dark' ? <Moon size={18} className="text-mint" /> : <Sun size={18} className="text-amber-400" />}
              <div><p className="text-sm font-semibold">Appearance</p><p className="muted text-xs text-slate-400">Choose your board theme</p></div>
            </div>
            <div className="flex rounded-xl border border-white/10 bg-black/20 p-1">
              {['dark', 'light'].map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => onSettingsChange({ ...settings, theme })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${settings.theme === theme ? 'bg-mint text-[#102019]' : 'text-slate-400 hover:text-white'}`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {settings.music ? <Volume2 size={18} className="text-mint" /> : <VolumeX size={18} className="text-slate-500" />}
              <div><p className="text-sm font-semibold">Music</p><p className="muted text-xs text-slate-400">Ambient game sounds</p></div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.music}
              aria-label="Toggle music"
              onClick={() => onSettingsChange({ ...settings, music: !settings.music })}
              className={`relative h-7 w-12 rounded-full transition ${settings.music ? 'bg-mint' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.music ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {settings.sfx ? <Volume2 size={18} className="text-mint" /> : <VolumeX size={18} className="text-slate-500" />}
              <div><p className="text-sm font-semibold">Sound effects</p><p className="muted text-xs text-slate-400">Moves and level clears</p></div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.sfx}
              aria-label="Toggle sound effects"
              onClick={() => onSettingsChange({ ...settings, sfx: !settings.sfx })}
              className={`relative h-7 w-12 rounded-full transition ${settings.sfx ? 'bg-mint' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.sfx ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          <label className="block">
            <span className="flex justify-between text-sm font-semibold"><span>Volume</span><span className="text-mint">{settings.volume}%</span></span>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.volume}
              onChange={(event) => onSettingsChange({ ...settings, volume: Number(event.target.value) })}
              className="mt-3 h-1.5 w-full cursor-pointer accent-[#7ce8b9]"
              aria-label="Volume"
            />
          </label>
        </div>
        <div className="mt-7 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300"><Keyboard size={15} /> Keyboard controls</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {DIRECTIONS.map(({ id, label }) => (
              <span key={id} className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-slate-400">
                <kbd className="font-bold text-white">{settings.keybinds[id].toUpperCase()}</kbd><span className="ml-1.5">{label}</span>
              </span>
            ))}
            <span className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-slate-400"><kbd className="font-bold text-white">R</kbd><span className="ml-1.5">Restart</span></span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function GameBoard({ game, onMove, busy, theme }) {
  const touchStart = useRef(null);
  const player = game?.player || { x: -1, y: -1 };

  function handlePointerUp(event) {
    if (!touchStart.current) return;
    const deltaX = event.clientX - touchStart.current.x;
    const deltaY = event.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 24) return;
    onMove(Math.abs(deltaX) > Math.abs(deltaY)
      ? (deltaX > 0 ? 'right' : 'left')
      : (deltaY > 0 ? 'down' : 'up'));
  }

  return (
    <div
      className={`board-touch board-surface relative mx-auto w-full max-w-[690px] overflow-hidden rounded-[1.65rem] border p-2.5 shadow-inner sm:rounded-[2rem] sm:p-4 ${theme === 'light' ? 'border-emerald-950/10 bg-[#e8efeb]' : 'border-white/[0.07] bg-[#0b1015]'}`}
      onPointerDown={(event) => { touchStart.current = { x: event.clientX, y: event.clientY }; }}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { touchStart.current = null; }}
      aria-label="Swipe the board or use the direction buttons to cover every dot"
    >
      <div className="grid aspect-[12/9] grid-cols-12 gap-1 sm:gap-1.5" role="grid" aria-label="Game board">
        {game.board.flatMap((row, rowIndex) => row.map((cell, columnIndex) => {
          const isPlayer = player.x === rowIndex && player.y === columnIndex;
          const isWall = cell === '|';
          return (
            <div
              key={`${rowIndex}-${columnIndex}`}
              role="gridcell"
              aria-label={isWall ? `Wall at row ${rowIndex + 1}, column ${columnIndex + 1}` : undefined}
              data-cell-type={isWall ? 'wall' : cell}
              className={`relative grid min-h-0 min-w-0 place-items-center overflow-hidden rounded-[5px] transition-colors duration-300 sm:rounded-[9px] ${
                isWall
                  ? `board-wall-cell ${theme === 'light' ? 'board-wall-cell-light' : ''}`
                  : (theme === 'light' ? 'bg-emerald-950/[0.035]' : 'bg-white/[0.035]')
              }`}
            >
              {isWall && <span className="board-wall-face" aria-hidden="true" />}
              {!isWall && cell === '.' && (
                <span className={`h-[27%] w-[27%] rounded-full ${theme === 'light' ? 'bg-emerald-600/65' : 'bg-mint/70 shadow-[0_0_12px_rgba(124,232,185,0.25)]'}`} />
              )}
              {!isWall && cell === '-' && !isPlayer && (
                <span className="h-[25%] w-[25%] rounded-full bg-rose-400/80" />
              )}
              {isPlayer && (
                <span className="relative z-10 h-[64%] w-[64%] rounded-full border border-white/35 bg-[radial-gradient(circle_at_32%_25%,#fff1f2_0%,#fca5a5_20%,#ef5353_55%,#8b252a_100%)] shadow-[0_0_18px_rgba(239,83,83,0.62)] sm:shadow-[0_0_26px_rgba(239,83,83,0.68)]">
                  <span className="absolute left-[22%] top-[15%] h-[24%] w-[24%] rounded-full bg-white/60 blur-[1px]" />
                </span>
              )}
            </div>
          );
        }))}
      </div>
      {busy && (
        <div className="absolute inset-0 grid place-items-center bg-black/10">
          <LoaderCircle className="animate-spin text-mint" size={30} />
        </div>
      )}
    </div>
  );
}

function DirectionPad({ onMove, disabled }) {
  return (
    <div className="grid grid-cols-3 grid-rows-2 gap-2" aria-label="Board movement controls">
      {DIRECTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMove(id);
          }}
          aria-label={`Move ${label.toLowerCase()}`}
          className={`grid h-12 w-full place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-slate-300 transition hover:border-mint/40 hover:bg-mint/10 hover:text-mint active:scale-95 disabled:opacity-40 sm:h-14 ${
            id === 'up' ? 'col-start-2 row-start-1' :
              id === 'left' ? 'col-start-1 row-start-2' :
                id === 'down' ? 'col-start-2 row-start-2' : 'col-start-3 row-start-2'
          }`}
        >
          <Icon size={19} />
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const initial = useRef(readSavedState());
  const [settings, setSettings] = useState(initial.current.settings);
  const [leaderboard, setLeaderboard] = useState(initial.current.leaderboard);
  const [dayKey, setDayKey] = useState(() => getAmmanDayKey());
  const [screen, setScreen] = useState('home');
  const [game, setGame] = useState(null);
  const [timeMs, setTimeMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [moveFeedback, setMoveFeedback] = useState('');
  const [error, setError] = useState('');
  const [serverReady, setServerReady] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const requestLock = useRef(false);
  const gameRef = useRef(game);
  const runningRef = useRef(running);
  const screenRef = useRef(screen);
  const showSettingsRef = useRef(showSettings);
  const moveQueueRef = useRef([]);
  const moveQueueProcessingRef = useRef(false);
  const moveRequestRef = useRef(null);
  const moveInputRef = useRef(null);
  const restartLevelRef = useRef(null);
  const audioRef = useRef(null);
  const startTime = useRef(0);
  const timeRef = useRef(timeMs);
  const settingsRef = useRef(settings);
  gameRef.current = game;
  runningRef.current = running;
  screenRef.current = screen;
  showSettingsRef.current = showSettings;
  timeRef.current = timeMs;
  settingsRef.current = settings;

  const dailyLevelScores = leaderboard[dayKey]?.levels || {};
  const completedLevels = Object.entries(dailyLevelScores)
    .filter(([level, scores]) => Number(level) <= LEVELS && scores.length > 0)
    .map(([level]) => Number(level));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, leaderboard }));
    } catch (saveError) {
      console.error('Could not save game data.', saveError);
      setError('Your browser could not save game settings. Check available storage.');
    }
  }, [settings, leaderboard]);

  useEffect(() => {
    let timer;
    function scheduleDailyReset() {
      const now = new Date();
      const delay = Math.max(1, getAmmanNextMidnight(now) - now.getTime() + 25);
      timer = window.setTimeout(() => {
        setDayKey(getAmmanDayKey());
        scheduleDailyReset();
      }, delay);
    }
    scheduleDailyReset();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((response) => {
        if (!response.ok) throw new Error(`Game server returned ${response.status}.`);
        return response.json();
      })
      .then(() => { if (!cancelled) setServerReady(true); })
      .catch((connectionError) => {
        console.error('Could not connect to the Python game server.', connectionError);
        if (!cancelled) setError(`Python game server is offline. Start it at ${API_URL}.`);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startTime.current;
      timeRef.current = elapsed;
      setTimeMs(elapsed);
    }, 30);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!settings.music || !audioUnlocked || settings.volume === 0) return undefined;
    let index = 0;
    const timer = window.setInterval(() => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        audioRef.current ||= new AudioContextClass();
        const context = audioRef.current;
        if (context.state === 'suspended') void context.resume().catch((audioError) => console.error('Could not resume background music.', audioError));
        const oscillator = context.createOscillator();
        const bass = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        const note = MUSIC_NOTES[index++ % MUSIC_NOTES.length];
        oscillator.type = 'square';
        oscillator.frequency.value = note;
        bass.type = 'triangle';
        bass.frequency.value = note / 2;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.012 * settings.volume / 100, now + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
        oscillator.connect(gain);
        bass.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        bass.start(now);
        oscillator.stop(now + 0.17);
        bass.stop(now + 0.17);
      } catch (audioError) {
        console.error('Could not play background music.', audioError);
      }
    }, 360);
    return () => window.clearInterval(timer);
  }, [audioUnlocked, settings.music, settings.volume]);

  const playTone = useCallback((frequency, duration = 0.1, shape = 'sine') => {
    const current = settingsRef.current;
    if (!current.sfx || current.volume === 0) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioRef.current ||= new AudioContextClass();
      const context = audioRef.current;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = shape;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.04 * current.volume / 100, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch (audioError) {
      console.error('Could not play the game sound.', audioError);
    }
  }, []);

  const saveScore = useCallback((completedGame, elapsed) => {
    const day = getAmmanDayKey();
    setLeaderboard((previous) => {
      const levels = { ...(previous[day]?.levels || {}) };
      const levelScores = [...(levels[String(completedGame.level)] || []), { name: 'You', time: elapsed }]
        .sort((left, right) => left.time - right.time)
        .slice(0, 5);
      levels[String(completedGame.level)] = levelScores;
      const totals = Object.values(levels)
        .map((scores) => scores[0])
        .filter(Boolean)
        .sort((left, right) => left.time - right.time)
        .slice(0, 3);
      return { ...previous, [day]: { levels, totals } };
    });
  }, []);

  const startLevel = useCallback(async (level) => {
    setAudioUnlocked(true);
    if (requestLock.current) return false;
    requestLock.current = true;
    setBusy(true);
    setError('');
    try {
      const newGame = await requestGame('/game/new', { level });
      setGame(newGame);
      gameRef.current = newGame;
      setTimeMs(0);
      timeRef.current = 0;
      setMoveFeedback('');
      startTime.current = performance.now();
      setRunning(true);
      runningRef.current = true;
      moveQueueRef.current = [];
      setScreen('game');
      screenRef.current = 'game';
      return true;
    } catch (requestError) {
      console.error('Could not start a new game.', requestError);
      setError(requestError.message);
      return false;
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }, []);

  const restartLevel = useCallback(async () => {
    const activeGame = gameRef.current;
    if (!activeGame?.session_id || requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setError('');
    try {
      const restarted = await requestGame('/game/restart', { session_id: activeGame.session_id });
      const updatedGame = { ...restarted, session_id: restarted.session_id ?? activeGame.session_id };
      setGame(updatedGame);
      gameRef.current = updatedGame;
      setMoveFeedback('');
      startTime.current = performance.now() - timeRef.current;
      setRunning(true);
      runningRef.current = true;
      moveQueueRef.current = [];
      setScreen('game');
      screenRef.current = 'game';
    } catch (requestError) {
      console.error('Could not restart the level.', requestError);
      setError(requestError.message);
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }, []);

  const moveRequest = useCallback(async (direction) => {
    const activeGame = gameRef.current;
    if (!activeGame?.session_id || !runningRef.current || requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setError('');
    const completedAt = timeRef.current;
    try {
      const result = await requestGame('/game/move', { session_id: activeGame.session_id, direction });
      const updatedGame = { ...result, session_id: result.session_id ?? activeGame.session_id };
      setGame(updatedGame);
      gameRef.current = updatedGame;
      setMoveFeedback(updatedGame.moved ? '' : 'Blocked by a wall or the edge.');
      if (updatedGame.moved) playTone(340, 0.09, 'triangle');
      if (updatedGame.won) {
        setRunning(false);
        runningRef.current = false;
        setScreen('win');
        screenRef.current = 'win';
        setTimeMs(completedAt);
        timeRef.current = completedAt;
        saveScore(updatedGame, completedAt);
        playTone(660, 0.2);
      }
    } catch (requestError) {
      console.error('Could not move on the board.', requestError);
      setError(requestError.message);
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }, [playTone, saveScore]);

  moveRequestRef.current = moveRequest;

  const processMoveQueue = useCallback(async () => {
    if (moveQueueProcessingRef.current) return;
    moveQueueProcessingRef.current = true;
    try {
      while (moveQueueRef.current.length > 0 && runningRef.current) {
        const direction = moveQueueRef.current.shift();
        await moveRequestRef.current?.(direction);
      }
    } finally {
      moveQueueProcessingRef.current = false;
    }
  }, []);

  const enqueueMove = useCallback((direction) => {
    if (!gameRef.current?.session_id || !runningRef.current) return;
    moveQueueRef.current.push(direction);
    void processMoveQueue();
  }, [processMoveQueue]);
  moveInputRef.current = enqueueMove;
  restartLevelRef.current = restartLevel;

  useEffect(() => {
    function handleKeyDown(event) {
      if (showSettingsRef.current) {
        if (event.key === 'Escape') setShowSettings(false);
        return;
      }
      if (screenRef.current !== 'game' || !runningRef.current || event.repeat) return;
      const key = event.key.toLowerCase();
      const direction = Object.entries(settingsRef.current.keybinds).find(([, binding]) => binding.toLowerCase() === key);
      const arrow = DIRECTIONS.find(({ key: arrowKey }) => arrowKey.toLowerCase() === key);
      if (direction || arrow) {
        event.preventDefault();
        event.stopPropagation();
        moveInputRef.current?.(direction?.[0] || arrow.id);
      } else if (key === settingsRef.current.keybinds.restart.toLowerCase()) {
        event.preventDefault();
        event.stopPropagation();
        restartLevelRef.current?.();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function changeSettings(nextSettings) {
    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    setAudioUnlocked(true);
  }

  function returnHome() {
    setScreen('home');
    screenRef.current = 'home';
    setRunning(false);
    runningRef.current = false;
    moveQueueRef.current = [];
  }

  const light = settings.theme === 'light';

  return (
    <main className={screen === 'home' ? '' : `min-h-screen px-4 py-5 text-slate-100 transition-colors duration-300 sm:px-6 sm:py-8 ${light ? 'light-theme' : ''}`}>
      <div className={screen === 'home' ? '' : 'mx-auto w-full max-w-6xl'}>
        {screen !== 'home' && (
          <header className="flex items-center justify-between">
            <button type="button" className="rounded-xl text-left" onClick={returnHome} aria-label="Back to home">
              <Brand compact />
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={returnHome} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white">
                <ChevronLeft size={16} /><span className="hidden sm:inline">Menu</span>
              </button>
              <IconButton label="Open settings" onClick={() => setShowSettings(true)}><Settings2 size={18} /></IconButton>
            </div>
          </header>
        )}

        {error && screen !== 'home' && (
          <div role="alert" className="mt-5 flex items-start justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/[0.08] px-4 py-3 text-sm text-rose-200">
            <span>{error}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button>
          </div>
        )}

        {screen === 'home' && (
          <MainMenu
            onPlay={startLevel}
            settings={settings}
          onSettingsChange={changeSettings}
            levelScores={dailyLevelScores}
            completedLevels={completedLevels}
            serverReady={serverReady}
            busy={busy}
            error={error}
          />
        )}

        {(screen === 'game' || screen === 'win') && game && (
          <div className="mx-auto max-w-5xl py-7 sm:py-10">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-mint">Daily puzzle · {String(game.level).padStart(2, '0')} / 0{LEVELS}</p>
                <h1 className="mt-2 font-['Space_Grotesk'] text-3xl font-bold tracking-tight sm:text-4xl">Cover every dot</h1>
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-2.5">
                <Clock3 size={17} className="text-mint" />
                <span className="font-['Space_Grotesk'] text-lg font-bold tabular-nums">{formatTime(timeMs)}</span>
              </div>
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
              <Panel className="overflow-hidden p-2.5 sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-2 px-1 sm:mb-4 sm:px-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-400">
                    <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint" /> {game.remaining} dots remaining</span>
                    {moveFeedback && <span role="status" aria-live="polite" className="text-amber-300">{moveFeedback}</span>}
                  </div>
                  <div className="flex gap-1.5">
                    <span className="h-1.5 w-5 rounded-full bg-mint" />
                    {Array.from({ length: LEVELS - 1 }, (_, index) => <span key={index} className="h-1.5 w-5 rounded-full bg-white/10" />)}
                  </div>
                </div>
                <GameBoard game={game} onMove={enqueueMove} busy={busy} theme={settings.theme} />
                <div className="mt-4 flex items-center justify-between px-1 sm:px-2">
                  <p className="muted hidden items-center gap-2 text-xs text-slate-500 sm:flex"><Keyboard size={14} /> Use WASD or arrow keys</p>
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={restartLevel} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-40">
                      <RotateCcw size={14} /> Restart
                    </button>
                    <button type="button" onClick={() => setShowSettings(true)} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.05] hover:text-white">
                      <Pause size={14} /> Settings
                    </button>
                  </div>
                </div>
              </Panel>

              <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <Panel className="p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Movement</p><p className="mt-1 text-sm font-semibold">Pick a direction</p></div>
                    <Gamepad2 size={19} className="text-mint" />
                  </div>
                  <div className="mt-4 max-w-[220px]"><DirectionPad onMove={enqueueMove} disabled={!running} /></div>
                  <p className="muted mt-3 text-center text-[11px] text-slate-500">Or swipe across the board</p>
                </Panel>
                <Panel className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><Sparkles size={15} className="text-mint" /> Quick tip</div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">You slide until a wall or the edge stops you. Plan each move so your trail covers every green dot.</p>
                  <div className="mt-4 flex items-center gap-2 border-t border-white/[0.07] pt-4 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm bg-mint/70" /> Dot <span className="ml-2 h-2.5 w-2.5 rounded-sm bg-emerald-200" /> Wall</div>
                </Panel>
              </aside>
            </div>
          </div>
        )}

        {screen === 'win' && game && (
          <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
            <Panel className="w-full max-w-md p-7 text-center sm:p-9">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl border border-mint/20 bg-mint/10 text-mint shadow-glow"><Trophy size={28} /></div>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-mint">Level {game.level} complete</p>
              <h2 className="mt-2 font-['Space_Grotesk'] text-3xl font-bold">Beautifully done.</h2>
              <p className="mt-2 text-sm text-slate-400">Every dot covered in</p>
              <p className="mt-2 font-['Space_Grotesk'] text-3xl font-bold tabular-nums text-white">{formatTime(timeMs)}</p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={restartLevel} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-semibold text-slate-300 transition hover:bg-white/5"><RotateCcw size={16} /> Play again</button>
                {game.level < LEVELS ? (
                  <PrimaryButton onClick={() => startLevel(game.level + 1)} disabled={busy}><span>Next level</span><ArrowRight size={17} /></PrimaryButton>
                ) : (
                  <PrimaryButton onClick={() => setScreen('home')}><Trophy size={16} /> Daily run complete</PrimaryButton>
                )}
              </div>
            </Panel>
          </div>
        )}

        {screen !== 'home' && (
          <footer className="muted border-t border-white/[0.06] py-5 text-center text-xs text-slate-600">
            Swipe Cover <span className="mx-2">·</span> Five fresh puzzles, every day
          </footer>
        )}
      </div>

      {showSettings && (
        <SettingsDialog settings={settings} onSettingsChange={changeSettings} onClose={() => setShowSettings(false)} />
      )}
    </main>
  );
}
