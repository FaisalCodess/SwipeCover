import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Sun,
  Trophy,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import MainMenu from './MainMenu.jsx';
import './main-menu.css';
import { countDots, DIRECTION_STEPS, slide } from './game.js';
import { sounds, startMusic, vibrate } from './audio.js';
import { KEY_ACTIONS, KEY_BINDINGS } from './controls.js';
import { getAmmanDayKey, getAmmanNextMidnight } from './dailyReset.js';
import { generateDailyBoard } from './generator.js';
import { usePresence } from './usePresence.js';
import {
  cleanName,
  createPlayerId,
  fetchDailyBoard,
  flushPendingScores,
  ScoreRejectedError,
  submitScore,
} from './api.js';

const STORAGE_KEY = 'swipe-cover-save-v2';
const LEVELS = 3;
const KEEP_SCORE_DAYS = 14;
const MAX_QUEUED_MOVES = 8;
const MAX_HISTORY = 400;
const CELEBRATION_MS = 700;
// Matches the `pop-out` animation in index.css.
const POPUP_EXIT_MS = 200;
const DIRECTIONS = [
  { id: 'up', label: 'Up', icon: ArrowUp },
  { id: 'left', label: 'Left', icon: ArrowLeft },
  { id: 'down', label: 'Down', icon: ArrowDown },
  { id: 'right', label: 'Right', icon: ArrowRight },
];
const DEFAULT_SETTINGS = {
  theme: 'dark',
  music: true,
  sfx: true,
  volume: 65,
};

function pruneLeaderboard(leaderboard, today) {
  const cutoff = new Date(Date.parse(today) - KEEP_SCORE_DAYS * 86400000).toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(leaderboard).filter(([day]) => day >= cutoff));
}

function readSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof saved.settings?.[key] === typeof DEFAULT_SETTINGS[key]) settings[key] = saved.settings[key];
    }
    const leaderboard = saved.leaderboard && typeof saved.leaderboard === 'object' ? saved.leaderboard : {};
    // The id ties a device's global leaderboard entries together; the name is chosen on the first win.
    const player = {
      id: typeof saved.player?.id === 'string' ? saved.player.id : createPlayerId(),
      name: typeof saved.player?.name === 'string' ? cleanName(saved.player.name) : null,
    };
    return { settings, leaderboard: pruneLeaderboard(leaderboard, getAmmanDayKey()), player };
  } catch (error) {
    console.error('Could not read saved game data.', error);
    return { settings: DEFAULT_SETTINGS, leaderboard: {}, player: { id: createPlayerId(), name: null } };
  }
}

function formatTime(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

// Slides speed up when moves are queued, so fast players never wait on animations.
function slideDuration(distance, queued) {
  return Math.min(240, 70 + distance * 24) / (1 + queued * 0.6);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}


const LEVEL_NUMBERS = Array.from({ length: LEVELS }, (_, index) => index + 1);

// Today's boards are built on the device straight away, so the game never waits
// on the network. The browser and server generators produce identical boards;
// when the server answers, its copy is used, so it stays the authority.
function useDailyBoards(dayKey) {
  const [daily, setDaily] = useState({ status: 'loading', boards: {}, source: null });

  useEffect(() => {
    const controller = new AbortController();
    setDaily({ status: 'loading', boards: {}, source: null });

    // Deferred one tick so the menu paints before the few milliseconds of generation.
    const localTimer = window.setTimeout(() => {
      const boards = Object.fromEntries(LEVEL_NUMBERS.map((level) => [level, generateDailyBoard(dayKey, level)]));
      setDaily((previous) => (previous.source === 'server' ? previous : { status: 'ready', boards, source: 'device' }));
    }, 0);

    Promise.all(LEVEL_NUMBERS.map((level) => fetchDailyBoard(level, controller.signal)))
      .then((boards) => {
        // A server on a different calendar day (clock skew) would hand out the wrong puzzles.
        if (boards.every((board) => board.day === dayKey)) {
          setDaily({ status: 'ready', boards: Object.fromEntries(boards.map((board) => [board.level, board])), source: 'server' });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.info('Game server unavailable; playing with on-device puzzles.', error.message);
      });

    return () => {
      controller.abort();
      window.clearTimeout(localTimer);
    };
  }, [dayKey]);

  return daily;
}

function useStopwatch() {
  const state = useRef({ accumulated: 0, startedAt: null });
  return useMemo(() => {
    const current = state.current;
    const read = () => current.accumulated + (current.startedAt === null ? 0 : performance.now() - current.startedAt);
    return {
      read,
      start() {
        current.accumulated = 0;
        current.startedAt = performance.now();
      },
      pause() {
        current.accumulated = read();
        current.startedAt = null;
        return current.accumulated;
      },
      resume() {
        if (current.startedAt === null) current.startedAt = performance.now();
      },
    };
  }, []);
}

// Writes straight to the DOM every frame so the clock never re-renders the board.
function TimerText({ read, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    let frame;
    let shown = '';
    const tick = () => {
      const text = formatTime(read());
      if (text !== shown && ref.current) {
        ref.current.textContent = text;
        shown = text;
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [read]);
  return <span ref={ref} role="timer" className={className} />;
}

function Panel({ children, className = '' }) {
  return (
    <section className={`panel rounded-3xl border border-line/[0.08] shadow-2xl shadow-black/10 ${className}`}>
      {children}
    </section>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-11 w-11 place-items-center rounded-2xl border border-mint/20 bg-mint/[0.09]">
        <span className="h-3 w-3 rounded-full bg-mint shadow-[0_0_18px_rgba(124,232,185,0.85)]" />
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0b0f14] bg-rose-400" />
      </div>
      <p className="font-display text-lg font-bold leading-tight tracking-tight">swipe cover</p>
    </div>
  );
}

function IconButton({ label, onClick, children, className = '', disabled = false, autoFocus = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      autoFocus={autoFocus}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line/[0.09] bg-line/[0.035] text-soft transition hover:border-line/20 hover:bg-line/[0.08] hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled = false, className = '', autoFocus = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-mint px-5 py-3 text-sm font-bold text-[#102019] shadow-lg shadow-mint/10 transition hover:bg-[#96f2ca] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line/10 px-4 text-sm font-semibold text-soft transition hover:bg-line/5 hover:text-fg active:scale-[0.98] ${className}`}
    >
      {children}
    </button>
  );
}

function Switch({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-mint' : 'bg-line/20'}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function SettingsDialog({ settings, onSettingsChange, onClose, closing }) {
  return (
    <div
      className={`${closing ? 'fade-out pointer-events-none' : 'fade-in'} fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Panel className={`${closing ? 'pop-out' : 'pop-in'} w-full max-w-md p-6 sm:p-7`}>
        <div role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Game paused</p>
              <h2 id="settings-title" className="mt-2 font-display text-2xl font-bold">Settings</h2>
            </div>
            <IconButton label="Close settings" onClick={onClose} autoFocus><X size={18} /></IconButton>
          </div>
          <div className="mt-7 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {settings.theme === 'dark' ? <Moon size={18} className="text-accent" /> : <Sun size={18} className="text-amber-500" />}
                <div><p className="text-sm font-semibold">Appearance</p><p className="text-xs text-muted">Board theme</p></div>
              </div>
              <div className="flex rounded-xl border border-line/10 bg-black/10 p-1" role="radiogroup" aria-label="Theme">
                {['dark', 'light'].map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    role="radio"
                    aria-checked={settings.theme === theme}
                    onClick={() => onSettingsChange({ ...settings, theme })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${settings.theme === theme ? 'bg-mint text-[#102019]' : 'text-muted hover:text-fg'}`}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {settings.music ? <Volume2 size={18} className="text-accent" /> : <VolumeX size={18} className="text-faint" />}
                <div><p className="text-sm font-semibold">Music</p><p className="text-xs text-muted">Background melody</p></div>
              </div>
              <Switch label="Music" checked={settings.music} onChange={(music) => onSettingsChange({ ...settings, music })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {settings.sfx ? <Volume2 size={18} className="text-accent" /> : <VolumeX size={18} className="text-faint" />}
                <div><p className="text-sm font-semibold">Sound effects</p><p className="text-xs text-muted">Moves and level clears</p></div>
              </div>
              <Switch label="Sound effects" checked={settings.sfx} onChange={(sfx) => onSettingsChange({ ...settings, sfx })} />
            </div>
            <label className="block">
              <span className="flex justify-between text-sm font-semibold"><span>Volume</span><span className="text-accent">{settings.volume}%</span></span>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.volume}
                onChange={(event) => onSettingsChange({ ...settings, volume: Number(event.target.value) })}
                className="mt-3 h-1.5 w-full cursor-pointer accent-[#7ce8b9]"
              />
            </label>
          </div>
          <div className="mt-7 rounded-2xl border border-line/[0.07] bg-line/[0.025] p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-soft"><Keyboard size={15} /> Keyboard controls</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {KEY_BINDINGS.map(({ action, label, name }) => (
                <span key={action} className="rounded-lg border border-line/10 bg-black/10 px-2.5 py-1.5 text-xs text-muted">
                  <kbd className="font-bold text-fg">{label}</kbd><span className="ml-1.5">{name}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-faint">Arrow keys work too. On touch screens, swipe across the board.</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function GameBoard({ run, anim, bump, phase, theme, onMove, onResume }) {
  const gesture = useRef(null);
  const { board, player } = run;
  const rows = board.length;
  const cols = board[0].length;
  const celebrating = phase === 'celebrating' || phase === 'won';

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  // Fire as soon as the swipe is long enough instead of waiting for the finger to lift.
  function handlePointerMove(event) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 22) return;
    gesture.current = null;
    onMove(Math.abs(deltaX) > Math.abs(deltaY)
      ? (deltaX > 0 ? 'right' : 'left')
      : (deltaY > 0 ? 'down' : 'up'));
  }

  const [bumpRow, bumpCol] = bump ? DIRECTION_STEPS[bump.direction] : [0, 0];

  return (
    <div
      className={`board-touch relative mx-auto w-full max-w-[690px] overflow-hidden rounded-[1.65rem] border p-2.5 shadow-inner sm:rounded-[2rem] sm:p-4 ${theme === 'light' ? 'border-emerald-950/10 bg-[#e3ebe6]' : 'border-white/[0.07] bg-[#0b1015]'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => { gesture.current = null; }}
      onPointerCancel={() => { gesture.current = null; }}
    >
      <div
        className={`board-grid ${celebrating ? 'board-won' : ''}`}
        style={{ '--rows': rows, '--cols': cols }}
        role="img"
        aria-label={`Game board, ${run.remaining} dots remaining`}
      >
        {board.flatMap((row, rowIndex) => row.map((cell, colIndex) => {
          const cellKey = `${rowIndex}-${colIndex}`;
          if (cell === '|') {
            return (
              <div key={cellKey} className="board-wall-cell relative overflow-hidden rounded-[5px] sm:rounded-[9px]">
                <span className="board-wall-face" aria-hidden="true" />
              </div>
            );
          }
          const freshDelay = anim.fresh?.[cellKey];
          return (
            <div key={cellKey} className="board-cell grid min-h-0 min-w-0 place-items-center rounded-[5px] sm:rounded-[9px]">
              {cell === '.' && <span className="board-dot" />}
              {cell === '-' && (
                <span
                  key={freshDelay === undefined ? 'trail' : `fresh-${anim.id}`}
                  className={`board-trail ${freshDelay === undefined ? '' : 'is-fresh'}`}
                  style={{ animationDelay: celebrating ? undefined : `${freshDelay ?? 0}ms`, '--wave': rowIndex + colIndex }}
                />
              )}
            </div>
          );
        }))}
        <div
          className="board-player"
          style={{ '--row': player.row, '--col': player.col, '--slide-ms': `${anim.slideMs}ms` }}
          aria-hidden="true"
        >
          <span
            key={bump?.id ?? 'ball'}
            className={`board-player-ball ${bump ? 'is-bumped' : ''}`}
            style={{ '--bump-x': bumpCol, '--bump-y': bumpRow }}
          />
        </div>
      </div>

      {phase === 'paused' && (
        <div className="board-pause-cover absolute inset-0 z-20 grid place-items-center bg-[#0b1015]/80 backdrop-blur-md">
          <div className="text-center">
            <p className="font-display text-2xl font-bold text-white">Paused</p>
            <p className="mt-1 text-xs text-slate-300">The clock is stopped</p>
            <PrimaryButton className="mt-5" onClick={onResume} autoFocus><Play size={16} /> Resume</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function DirectionPad({ onMove, disabled }) {
  return (
    <div className="grid grid-cols-3 grid-rows-2 gap-2" aria-label="Movement controls">
      {DIRECTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          // Pointer down instead of click: the move starts the moment the finger lands.
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault();
            onMove(id);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onMove(id);
            }
          }}
          aria-label={`Move ${label.toLowerCase()}`}
          className={`grid h-14 w-full place-items-center rounded-xl border border-line/10 bg-line/[0.035] text-soft transition hover:border-mint/40 hover:bg-mint/10 hover:text-accent active:scale-95 active:bg-mint/15 disabled:opacity-40 ${
            id === 'up' ? 'col-start-2 row-start-1' :
              id === 'left' ? 'col-start-1 row-start-2' :
                id === 'down' ? 'col-start-2 row-start-2' : 'col-start-3 row-start-2'
          }`}
        >
          <Icon size={20} />
        </button>
      ))}
    </div>
  );
}

function GlobalStanding({ level, globalResult, onJoin }) {
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { status } = globalResult;

  if (status === 'needs-name') {
    return (
      <form
        className="mt-5 rounded-2xl border border-line/[0.08] bg-line/[0.03] p-4 text-left"
        onSubmit={(event) => {
          event.preventDefault();
          const cleaned = cleanName(name);
          setInvalid(!cleaned);
          if (cleaned) onJoin(cleaned);
        }}
      >
        <label htmlFor="leaderboard-name" className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Join the global leaderboard</label>
        <div className="mt-2 flex gap-2">
          <input
            id="leaderboard-name"
            value={name}
            maxLength={16}
            autoComplete="nickname"
            placeholder="Your name"
            onChange={(event) => {
              setName(event.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid}
            aria-describedby="leaderboard-name-hint"
            className="min-w-0 flex-1 rounded-xl border border-line/10 bg-black/20 px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:border-mint/50"
          />
          <button type="submit" className="rounded-xl bg-mint px-4 text-sm font-bold text-[#102019] transition hover:bg-[#96f2ca]">Join</button>
        </div>
        <p id="leaderboard-name-hint" className={`mt-2 text-xs ${invalid ? 'text-warn' : 'text-faint'}`}>
          3–16 letters or numbers. Shown publicly next to your times.
        </p>
      </form>
    );
  }

  const messages = {
    sending: <span className="inline-flex items-center gap-2 text-muted"><LoaderCircle size={14} className="animate-spin" /> Sending to the global leaderboard…</span>,
    ranked: <span className="rounded-full bg-mint/15 px-3 py-1 text-xs font-bold text-accent">#{globalResult.rank} on today&apos;s global leaderboard · Level {level}</span>,
    offline: <span className="text-faint">Couldn&apos;t reach the leaderboard. Your time will be sent next time you play.</span>,
    rejected: <span className="text-warn">{globalResult.message}</span>,
  };
  return messages[status] ? <p className="mt-4 text-sm">{messages[status]}</p> : null;
}

function WinDialog({ run, result, globalResult, onJoin, onReplay, onNext, onHome }) {
  const isLast = run.level >= LEVELS;
  return (
    <div className="fade-in fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <Panel className="pop-in w-full max-w-md p-7 text-center sm:p-9">
        <div role="dialog" aria-modal="true" aria-labelledby="win-title">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl border border-mint/20 bg-mint/10 text-accent shadow-glow"><Trophy size={28} /></div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-accent">Level {run.level} of {LEVELS} complete</p>
          <h2 id="win-title" className="mt-2 font-display text-3xl font-bold">{isLast ? 'Daily run complete!' : 'Beautifully done.'}</h2>
          <p className="mt-2 text-sm text-muted">Every dot covered in</p>
          <p className="mt-2 font-display text-4xl font-bold tabular-nums text-fg">{formatTime(result.time)}</p>
          <p className="mt-2 text-sm text-muted">{result.moves} {result.moves === 1 ? 'move' : 'moves'}</p>
          <GlobalStanding level={run.level} globalResult={globalResult} onJoin={onJoin} />
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <SecondaryButton onClick={onReplay}><RotateCcw size={16} /> Play again</SecondaryButton>
            {isLast ? (
              <PrimaryButton onClick={onHome} autoFocus><Trophy size={16} /> Back to menu</PrimaryButton>
            ) : (
              <PrimaryButton onClick={onNext} autoFocus><span>Next level</span><ArrowRight size={17} /></PrimaryButton>
            )}
          </div>
          <p className="mt-4 hidden text-xs text-faint sm:block">Press Enter to continue</p>
        </div>
      </Panel>
    </div>
  );
}

export default function App() {
  const initial = useRef(null);
  initial.current ||= readSavedState();
  const [settings, setSettings] = useState(initial.current.settings);
  const [leaderboard, setLeaderboard] = useState(initial.current.leaderboard);
  const [player, setPlayer] = useState(initial.current.player);
  const [globalResult, setGlobalResult] = useState({ status: 'idle' });
  const playerRef = useRef(player);
  // Bumped on every new run, so a late leaderboard reply never lands on the wrong level.
  const submission = useRef(0);
  const [dayKey, setDayKey] = useState(() => getAmmanDayKey());
  const daily = useDailyBoards(dayKey);
  const [screen, setScreen] = useState('home');
  const [phase, setPhase] = useState('playing');
  const [run, setRun] = useState(null);
  const [anim, setAnim] = useState({ id: 0, slideMs: 0, fresh: null });
  const [bump, setBump] = useState(null);
  const [result, setResult] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [storageError, setStorageError] = useState('');
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const stopwatch = useStopwatch();
  const settingsDialog = usePresence(showSettings, POPUP_EXIT_MS);

  const runRef = useRef(run);
  const phaseRef = useRef(phase);
  const screenRef = useRef(screen);
  const settingsRef = useRef(settings);
  const dailyRef = useRef(daily);
  const showSettingsRef = useRef(showSettings);
  const leaderboardRef = useRef(leaderboard);
  const moveQueue = useRef([]);
  const sliding = useRef(false);
  const timers = useRef(new Set());
  const pauseReason = useRef(null);
  runRef.current = run;
  screenRef.current = screen;
  settingsRef.current = settings;
  dailyRef.current = daily;
  showSettingsRef.current = showSettings;
  leaderboardRef.current = leaderboard;

  const todaysScores = leaderboard[dayKey]?.levels || {};
  const completedLevels = Array.from({ length: LEVELS }, (_, index) => index + 1)
    .filter((level) => todaysScores[level]?.length > 0);

  const changePhase = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const commitRun = useCallback((next) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const later = useCallback((callback, delay) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, delay);
    timers.current.add(timer);
  }, []);

  const clearPending = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    moveQueue.current = [];
    sliding.current = false;
  }, []);

  useEffect(() => clearPending, [clearPending]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, leaderboard, player }));
    } catch (saveError) {
      console.error('Could not save game data.', saveError);
      setStorageError('Your browser is blocking storage, so settings and times will not be kept.');
    }
  }, [settings, leaderboard, player]);

  // Times finished while offline are sent the next time the game opens.
  useEffect(() => {
    flushPendingScores();
  }, []);

  useEffect(() => {
    let timer;
    function scheduleDailyReset() {
      const now = new Date();
      const delay = Math.max(1000, getAmmanNextMidnight(now) - now.getTime() + 250);
      timer = window.setTimeout(() => {
        setDayKey(getAmmanDayKey());
        scheduleDailyReset();
      }, delay);
    }
    scheduleDailyReset();
    return () => window.clearTimeout(timer);
  }, []);

  // Browsers only allow audio after a user gesture.
  useEffect(() => {
    if (audioUnlocked) return undefined;
    const unlock = () => setAudioUnlocked(true);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [audioUnlocked]);

  useEffect(() => {
    if (!settings.music || !audioUnlocked) return undefined;
    return startMusic(() => settingsRef.current.volume);
  }, [audioUnlocked, settings.music]);

  const light = settings.theme === 'light' && screen === 'game';
  useEffect(() => {
    document.body.classList.toggle('light-theme', light);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#edf3ef' : '#0b0f14');
  }, [light]);

  const sfx = useCallback((name, ...args) => {
    const current = settingsRef.current;
    if (current.sfx) sounds[name](current.volume, ...args);
  }, []);

  const saveScore = useCallback((day, level, time, moves) => {
    const previous = leaderboardRef.current;
    const levels = { ...(previous[day]?.levels || {}) };
    const earlier = levels[level] || [];
    const best = earlier.length ? Math.min(...earlier.map((entry) => entry.time)) : Infinity;
    levels[level] = [...earlier, { time, moves, at: Date.now() }]
      .sort((left, right) => left.time - right.time)
      .slice(0, 5);
    const next = { ...previous, [day]: { levels } };
    leaderboardRef.current = next;
    setLeaderboard(next);
    return { isBest: time < best, best: Math.min(best, time) };
  }, []);

  const startRun = useCallback((data) => {
    clearPending();
    const board = data.board.map((row) => [...row]);
    commitRun({
      level: data.level,
      day: data.day,
      initialBoard: board,
      initialPlayer: data.player,
      board,
      player: data.player,
      history: [],
      route: [],
      moves: 0,
      remaining: countDots(board),
    });
    setAnim((previous) => ({ id: previous.id + 1, slideMs: 0, fresh: null }));
    setBump(null);
    setFeedback('');
    setResult(null);
    submission.current += 1;
    setGlobalResult({ status: 'idle' });
    pauseReason.current = null;
    stopwatch.start();
    changePhase('playing');
    screenRef.current = 'game';
    setScreen('game');
    window.scrollTo({ top: 0 });
  }, [changePhase, clearPending, commitRun, stopwatch]);

  const startLevel = useCallback((level) => {
    const data = dailyRef.current.boards[level];
    if (!data) return false;
    startRun(data);
    return true;
  }, [startRun]);

  const replayLevel = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    startRun({ level: current.level, day: current.day, board: current.initialBoard, player: current.initialPlayer });
  }, [startRun]);

  // Sends the run to the global leaderboard; the server replays the route to verify it.
  const submitGlobal = useCallback(async (completed, time, name = playerRef.current.name) => {
    if (!name) {
      setGlobalResult({ status: 'needs-name' });
      return;
    }
    const token = submission.current;
    setGlobalResult({ status: 'sending' });
    try {
      const standing = await submitScore({
        day: completed.day,
        level: completed.level,
        player_id: playerRef.current.id,
        name,
        time_ms: Math.round(time),
        route: completed.route,
      });
      if (token === submission.current) setGlobalResult({ status: 'ranked', rank: standing.rank });
    } catch (error) {
      if (token !== submission.current) return;
      if (error instanceof ScoreRejectedError) setGlobalResult({ status: 'rejected', message: error.message });
      else setGlobalResult({ status: 'offline' });
    }
  }, []);

  const joinLeaderboard = useCallback((name) => {
    const nextPlayer = { ...playerRef.current, name };
    playerRef.current = nextPlayer;
    setPlayer(nextPlayer);
    if (runRef.current && result) submitGlobal(runRef.current, result.time, name);
  }, [result, submitGlobal]);

  const finishRun = useCallback((completed, time, slideMs) => {
    moveQueue.current = [];
    changePhase('finishing');
    later(() => {
      changePhase('celebrating');
      sfx('win');
      vibrate([20, 40, 20]);
      saveScore(completed.day, completed.level, time, completed.moves);
      setResult({ time, moves: completed.moves });
      submitGlobal(completed, time);
      later(() => changePhase('won'), CELEBRATION_MS);
    }, slideMs + 60);
  }, [changePhase, later, saveScore, sfx, submitGlobal]);

  const processQueue = useCallback(() => {
    while (!sliding.current && moveQueue.current.length && phaseRef.current === 'playing') {
      const direction = moveQueue.current.shift();
      const current = runRef.current;
      const next = slide(current.board, current.player, direction);

      if (!next) {
        setBump((previous) => ({ id: (previous?.id ?? 0) + 1, direction }));
        setFeedback('Blocked: a wall or the edge is in the way.');
        sfx('blocked');
        vibrate(12);
        continue;
      }

      const distance = next.path.length;
      const slideMs = prefersReducedMotion() ? 0 : Math.round(slideDuration(distance, moveQueue.current.length));
      const fresh = {};
      next.path.forEach(([row, col], index) => {
        if (current.board[row][col] === '.') {
          // Matches the ease-out curve of the ball so each dot flips as the ball reaches it.
          fresh[`${row}-${col}`] = Math.round(slideMs * (1 - Math.sqrt(1 - (index + 1) / distance)));
        }
      });
      const updated = {
        ...current,
        board: next.board,
        player: next.player,
        history: [...current.history, { board: current.board, player: current.player, route: current.route }].slice(-MAX_HISTORY),
        route: [...current.route, direction],
        moves: current.route.length + 1,
        remaining: countDots(next.board),
      };
      commitRun(updated);
      setAnim((previous) => ({ id: previous.id + 1, slideMs, fresh }));
      setFeedback('');
      sfx('move', distance);

      if (updated.remaining === 0) {
        finishRun(updated, stopwatch.pause(), slideMs);
        return;
      }

      // Accept the next queued move slightly before the slide ends so fast play stays fluid.
      sliding.current = true;
      later(() => {
        sliding.current = false;
        processQueue();
      }, slideMs * 0.8);
    }
  }, [commitRun, finishRun, later, sfx, stopwatch]);

  const requestMove = useCallback((direction) => {
    if (phaseRef.current !== 'playing' || !runRef.current) return;
    if (moveQueue.current.length >= MAX_QUEUED_MOVES) return;
    moveQueue.current.push(direction);
    processQueue();
  }, [processQueue]);

  const jumpTo = useCallback((board, player, route, history, slideMs) => {
    clearPending();
    commitRun({ ...runRef.current, board, player, route, moves: route.length, history, remaining: countDots(board) });
    setAnim((previous) => ({ id: previous.id + 1, slideMs: prefersReducedMotion() ? 0 : slideMs, fresh: null }));
    setBump(null);
    setFeedback('');
  }, [clearPending, commitRun]);

  const undoMove = useCallback(() => {
    const current = runRef.current;
    if (phaseRef.current !== 'playing' || !current?.history.length) return;
    const previous = current.history[current.history.length - 1];
    jumpTo(previous.board, previous.player, previous.route, current.history.slice(0, -1), 140);
    sfx('undo');
  }, [jumpTo, sfx]);

  const restartLevel = useCallback(() => {
    const current = runRef.current;
    if (phaseRef.current !== 'playing' || !current || current.moves === 0) return;
    // Restarting is undoable, and the clock keeps running.
    const history = [...current.history, { board: current.board, player: current.player, route: current.route }];
    jumpTo(current.initialBoard, current.initialPlayer, [], history, 0);
    sfx('undo');
  }, [jumpTo, sfx]);

  const pauseGame = useCallback((reason) => {
    if (phaseRef.current !== 'playing') return;
    stopwatch.pause();
    moveQueue.current = [];
    pauseReason.current = reason;
    changePhase('paused');
  }, [changePhase, stopwatch]);

  const resumeGame = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    pauseReason.current = null;
    stopwatch.resume();
    changePhase('playing');
  }, [changePhase, stopwatch]);

  const openSettings = useCallback(() => {
    pauseGame('settings');
    setShowSettings(true);
  }, [pauseGame]);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    if (pauseReason.current === 'settings') resumeGame();
  }, [resumeGame]);

  const returnHome = useCallback(() => {
    clearPending();
    stopwatch.pause();
    setShowSettings(false);
    screenRef.current = 'home';
    setScreen('home');
  }, [clearPending, stopwatch]);

  // Stop the clock whenever the player looks away.
  useEffect(() => {
    const onHide = () => {
      if (screenRef.current === 'game') pauseGame('hidden');
    };
    const onVisibility = () => {
      if (document.hidden) onHide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onHide);
    };
  }, [pauseGame]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (showSettingsRef.current) {
        if (key === 'escape') closeSettings();
        return;
      }
      if (screenRef.current !== 'game') return;

      const action = KEY_ACTIONS[key];
      const currentPhase = phaseRef.current;
      if (currentPhase === 'paused') {
        if (action === 'pause') {
          event.preventDefault();
          resumeGame();
        }
        return;
      }
      if (currentPhase !== 'playing' || !action) return;

      if (DIRECTION_STEPS[action]) {
        event.preventDefault();
        if (!event.repeat) requestMove(action);
      } else if (action === 'restart' && !event.repeat) {
        restartLevel();
      } else if (action === 'undo') {
        event.preventDefault();
        undoMove();
      } else if (action === 'pause') {
        pauseGame('manual');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSettings, pauseGame, requestMove, restartLevel, resumeGame, undoMove]);

  function changeSettings(nextSettings) {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }

  const playing = phase === 'playing';

  return (
    <main className={screen === 'home' ? '' : 'min-h-[100svh] px-4 py-5 sm:px-6 sm:py-8'}>
      {screen === 'home' && (
        <MainMenu
          onPlay={startLevel}
          settings={settings}
          onSettingsChange={changeSettings}
          levelScores={todaysScores}
          player={player}
          completedLevels={completedLevels}
          status={daily.status}
          error={storageError}
        />
      )}

      {screen === 'game' && run && (
        <div className="mx-auto w-full max-w-6xl">
          <header className="flex items-center justify-between">
            <button type="button" className="rounded-xl text-left" onClick={returnHome} aria-label="Back to menu">
              <Brand />
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={returnHome} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted transition hover:bg-line/5 hover:text-fg">
                <ChevronLeft size={16} /><span className="hidden sm:inline">Menu</span>
              </button>
              <IconButton label="Open settings" onClick={openSettings}><Settings2 size={18} /></IconButton>
            </div>
          </header>

          <div className="mx-auto max-w-5xl py-5 sm:py-9">
            <div className="mb-4 flex items-end justify-between gap-3 sm:mb-5">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent sm:text-xs sm:tracking-[0.22em]"><span className="hidden sm:inline">Daily puzzle · </span>Level {run.level} / {LEVELS}</p>
                  <div className="flex gap-1.5" aria-hidden="true">
                    {Array.from({ length: LEVELS }, (_, index) => {
                      const level = index + 1;
                      const done = completedLevels.includes(level);
                      return (
                        <span
                          key={level}
                          className={`h-1.5 w-5 rounded-full ${level === run.level ? 'bg-mint' : done ? 'bg-mint/45' : 'bg-line/10'}`}
                        />
                      );
                    })}
                  </div>
                </div>
                <h1 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-4xl">Cover every dot</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-line/[0.08] bg-line/[0.035] px-3 py-2 sm:px-4 sm:py-2.5">
                <Clock3 size={17} className="hidden text-accent sm:block" />
                <TimerText read={stopwatch.read} className="min-w-[5.2rem] font-display text-base font-bold tabular-nums sm:min-w-[5.6rem] sm:text-lg" />
              </div>
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
              <Panel className="overflow-hidden p-2.5 sm:p-5">
                <div className="mb-3 flex min-h-5 items-center justify-between gap-2 px-1 text-xs font-medium text-muted sm:mb-4 sm:px-2">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint" /> {run.remaining} {run.remaining === 1 ? 'dot' : 'dots'} left</span>
                  <span role="status" aria-live="polite" className="truncate text-warn">{feedback}</span>
                  <span className="shrink-0 tabular-nums">{run.moves} {run.moves === 1 ? 'move' : 'moves'}</span>
                </div>
                <GameBoard
                  run={run}
                  anim={anim}
                  bump={bump}
                  phase={phase}
                  theme={settings.theme}
                  onMove={requestMove}
                  onResume={resumeGame}
                />
                <div className="mt-3 flex items-center justify-between gap-2 px-1 sm:mt-4 sm:px-2">
                  <p className="hidden items-center gap-2 text-xs text-faint md:flex"><Keyboard size={14} /> WASD / arrows · Z undo · R restart</p>
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={undoMove} disabled={!playing || !run.history.length} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted transition hover:bg-line/[0.05] hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
                      <Undo2 size={14} /> Undo
                    </button>
                    <button type="button" onClick={restartLevel} disabled={!playing || run.moves === 0} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted transition hover:bg-line/[0.05] hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
                      <RotateCcw size={14} /> Restart
                    </button>
                    <button type="button" onClick={() => pauseGame('manual')} disabled={!playing} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted transition hover:bg-line/[0.05] hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
                      <Pause size={14} /> Pause
                    </button>
                  </div>
                </div>
              </Panel>

              <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <Panel className="p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold uppercase tracking-wider text-faint">Movement</p><p className="mt-1 text-sm font-semibold">Pick a direction</p></div>
                    <Gamepad2 size={19} className="text-accent" />
                  </div>
                  <div className="mx-auto mt-4 max-w-[240px]"><DirectionPad onMove={requestMove} disabled={!playing} /></div>
                  <p className="mt-3 text-center text-[11px] text-faint">Or swipe across the board</p>
                </Panel>
                <Panel className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-faint"><Sparkles size={15} className="text-accent" /> How to play</div>
                  <p className="mt-3 text-sm leading-6 text-soft">The ball slides until a wall or the edge stops it. Plan your route so the trail covers every green dot. Some moves can&apos;t be undone by sliding back, so think ahead.</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/[0.07] pt-4 text-xs text-faint">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-mint/70" /> Dot</span>
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /> Covered</span>
                    <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-[3px] border border-white/20 bg-gradient-to-br from-[#87929d] to-[#38414b]" /> Wall</span>
                  </div>
                </Panel>
              </aside>
            </div>
          </div>

          <footer className="border-t border-line/[0.06] py-5 text-center text-xs text-faint">
            Swipe Cover <span className="mx-2">·</span> Three fresh puzzles, every day
          </footer>
        </div>
      )}

      {screen === 'game' && run && phase === 'won' && result && (
        <WinDialog
          run={run}
          result={result}
          globalResult={globalResult}
          onJoin={joinLeaderboard}
          onReplay={replayLevel}
          onNext={() => startLevel(run.level + 1)}
          onHome={returnHome}
        />
      )}

      {settingsDialog.mounted && (
        <SettingsDialog settings={settings} onSettingsChange={changeSettings} onClose={closeSettings} closing={settingsDialog.closing} />
      )}
    </main>
  );
}

