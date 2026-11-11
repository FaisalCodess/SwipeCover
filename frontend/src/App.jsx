import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  Clock3,
  Keyboard,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Sun,
  Swords,
  Trophy,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import MainMenu, { BoardFrame, CutFrame, keyShape, SkyAbove } from './MainMenu.jsx';
import BackgroundMusic from './BackgroundMusic.jsx';
import { CaveBelow, RushBanner, RushHud, useRushPressure } from './Rush.jsx';
import BoardBall from './BoardBall.jsx';
import Brand from './Brand.jsx';
import './brand.css';
import ResultDialog,{ PracticeStrip, ResultButton, ResultStanding } from './ResultDialog.jsx';
import { paintDelay, slideDuration } from './motion.js';
import './main-menu.css';
import './game-view.css';
import './rush.css';
import { countDots, DIRECTION_STEPS, replayRoute, slide } from './game.js';
import { beginAttempt, clearAttempt, getAttempt, saveRoute } from './attempts.js';
import { sounds, startMusic, vibrate } from './audio.js';
import { KEY_ACTIONS, KEY_BINDINGS } from './controls.js';
import { getAmmanDayKey, getAmmanNextMidnight } from './dailyReset.js';
import { generateDailyBoard, generateMatchBoard, generateRushBoard } from './generator.js';
import {
  beginRush,
  finishRush,
  getRush,
  markRushSent,
  recordRushMap,
  RUSH_ADVANCE_MS,
  RUSH_MS,
  RUSH_READY_MS,
  RUSH_TIMEUP_MS,
  rushSnapshot,
  saveRushRoute,
  settleRush,
  unsentRushRuns,
} from './rush.js';
import { startRushPulse } from './rushAudio.js';
import { usePresence } from './usePresence.js';
import {
  checkSession,
  fetchDailyBoard,
  flushPendingScores,
  getSession,
  getToken,
  logOut,
  LoginRequiredError,
  ScoreRejectedError,
  submitScore,
} from './api.js';
import AuthDialog from './AuthDialog.jsx';
import AccountDialog from './AccountDialog.jsx';
import VersusLobby from './VersusLobby.jsx';
import { VersusClient } from './versusClient.js';
import './versus.css';

const STORAGE_KEY = 'swipe-cover-save-v2';
// Keep in sync with the .camera animations in game-view.css.
const TRAVEL_MS = 1700;
const TRAVEL_DOWN_DELAY_MS = 350;
const UI_LEAD_MS = 650;
const LEVELS = 3;
const KEEP_SCORE_DAYS = 14;
const MAX_QUEUED_MOVES = 8;
const MAX_HISTORY = 400;
const CELEBRATION_MS = 700;
// Matches the `pop-out` animation in index.css.
const POPUP_EXIT_MS = 200;
const DEFAULT_SETTINGS = {
  theme: 'dark',
  music: true,
  sfx: true,
  musicVolume: 70,
  sfxVolume: 65,
};

function pruneLeaderboard(leaderboard, today) {
  const cutoff = new Date(Date.parse(today) - KEEP_SCORE_DAYS * 86400000).toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(leaderboard).filter(([day]) => day >= cutoff));
}

// Only a level's first run counts, so that is the only one kept. Older saves kept the five
// fastest times of each level; those are reduced to the earliest.
function keepFirstRuns(leaderboard) {
  const result = {};
  for (const [day, entry] of Object.entries(leaderboard)) {
    const levels = {};
    for (const [level, runs] of Object.entries(entry?.levels || {})) {
      const valid = Array.isArray(runs) ? runs.filter((run) => run && typeof run === 'object') : [];
      if (valid.length) levels[level] = [valid.reduce((first, run) => ((run.at ?? Infinity) < (first.at ?? Infinity) ? run : first))];
    }
    result[day] = { levels };
  }
  return result;
}

function readSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof saved.settings?.[key] === typeof DEFAULT_SETTINGS[key]) settings[key] = saved.settings[key];
    }
    // Older saves had one shared "volume"; keep it for whichever new slider has no saved value.
    const oldVolume = saved.settings?.volume;
    if (typeof oldVolume === 'number') {
      if (typeof saved.settings?.musicVolume !== 'number') settings.musicVolume = oldVolume;
      if (typeof saved.settings?.sfxVolume !== 'number') settings.sfxVolume = oldVolume;
    }
    const leaderboard = saved.leaderboard && typeof saved.leaderboard === 'object' ? saved.leaderboard : {};
    return { settings, leaderboard: keepFirstRuns(pruneLeaderboard(leaderboard, getAmmanDayKey())) };
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

// A clock that starts once and only stops when the level is solved. There is deliberately no
// pause: pausing the game, leaving for the menu or restarting must never buy time back, so the
// only way to stop it is `stop()`, which the winning move calls.
function useStopwatch() {
  const state = useRef({ startedAt: null, stoppedAt: null });
  return useMemo(() => {
    const current = state.current;
    const read = () => (current.startedAt === null ? 0 : (current.stoppedAt ?? Date.now()) - current.startedAt);
    return {
      read,
      // `at` is an earlier moment, for rejoining a run whose clock has been running all along.
      start(at = Date.now()) {
        current.startedAt = at;
        current.stoppedAt = null;
      },
      reset() {
        current.startedAt = null;
        current.stoppedAt = null;
      },
      stop() {
        if (current.startedAt !== null && current.stoppedAt === null) current.stoppedAt = Date.now();
        return read();
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

function GameChip({ children, className = '', ...props }) {
  return (
    <button type="button" className={`game-chip ${className}`} {...props}>
      <CutFrame shape={keyShape} />
      <span className="game-chip-label">{children}</span>
    </button>
  );
}

function Panel({ children, className = '' }) {
  return (
    <section className={`panel rounded-3xl border border-line/[0.08] shadow-2xl shadow-black/10 ${className}`}>
      {children}
    </section>
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
                <div><p className="text-sm font-semibold">Music</p><p className="text-xs text-muted">Background music</p></div>
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
            {[
              { key: 'musicVolume', label: 'Music volume' },
              { key: 'sfxVolume', label: 'Sound effects volume' },
            ].map(({ key, label }) => (
              <label key={key} className="block">
                <span className="flex justify-between text-sm font-semibold"><span>{label}</span><span className="text-accent">{settings[key]}%</span></span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings[key]}
                  onChange={(event) => onSettingsChange({ ...settings, [key]: Number(event.target.value) })}
                  onPointerUp={() => key === 'sfxVolume' && settings.sfx && sounds.move(settings.sfxVolume, 3)}
                  className="mt-3 h-1.5 w-full cursor-pointer accent-[#7ce8b9]"
                />
              </label>
            ))}
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

// `mapKey` is set in Swipe Rush: each new board is a fresh grid that drops in.
function GameBoard({ run, anim, bump, phase, onMove, onResume, mapKey }) {
  const gesture = useRef(null);
  const { board, player } = run;
  const rows = board.length;
  const cols = board[0].length;
  const celebrating = phase === 'celebrating' || phase === 'won' || phase === 'advancing';

  function handlePointerDown(event) {
    // Only a board in play takes swipes. Capturing the pointer sends the follow-up click to the
    // board instead of the button that was pressed, which left the pause cover's Resume button dead.
    if (phase !== 'playing') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  // Fire as soon as the swipe is long enough instead of waiting for the finger to lift. The finger
  // can then carry on and turn (right, then down, ...) to chain moves in one stroke.
  function handlePointerMove(event) {
    const start = gesture.current;
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
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 22) return;
    const direction = Math.abs(deltaX) > Math.abs(deltaY)
      ? (deltaX > 0 ? 'right' : 'left')
      : (deltaY > 0 ? 'down' : 'up');
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, last: direction };
    onMove(direction);
  }

  return (
    <div
      className="board-touch game-board-frame"
      data-phase={phase}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => { gesture.current = null; }}
      onPointerCancel={() => { gesture.current = null; }}
    >
      <BoardFrame />
      {/* The ball and its sparks sit beside the grid, not in it: a new Swipe Rush board swaps the
          grid out, and the sparks from clearing the last one carry on over the next. */}
      <div className="board-layer" style={{ '--rows': rows, '--cols': cols }}>
        <div
          key={mapKey}
          className={`board-grid ${celebrating ? 'board-won' : ''} ${mapKey === undefined ? '' : 'rush-board-in'}`}
          role="img"
          aria-label={`Game board, ${run.remaining} squares left to cover`}
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
            // Squares of the same kind (painted or not yet painted) join up into one shape.
            // The square under the ball counts as painted.
            const kind = cell === '.' ? 'open' : 'covered';
            const same = (r, c) => {
              const other = board[r]?.[c];
              return other !== undefined && other !== '|' && (other === '.' ? 'open' : 'covered') === kind;
            };
            const up = same(rowIndex - 1, colIndex);
            const right = same(rowIndex, colIndex + 1);
            const down = same(rowIndex + 1, colIndex);
            const left = same(rowIndex, colIndex - 1);
            const corner = right && down && same(rowIndex + 1, colIndex + 1);
            const joins = `${up ? ' j-t' : ''}${right ? ' j-r' : ''}${down ? ' j-b' : ''}${left ? ' j-l' : ''}${corner ? ' j-d' : ''}`;
            return (
              <div key={cellKey} className="board-cell">
                <span
                  key={kind === 'open' ? 'open' : (freshDelay === undefined ? 'trail' : `fresh-${anim.id}`)}
                  className={`board-tile is-${kind}${kind === 'covered' && freshDelay !== undefined ? ' is-fresh' : ''}${joins}`}
                  style={{ animationDelay: celebrating ? undefined : `${freshDelay ?? 0}ms`, '--wave': rowIndex + colIndex }}
                />
              </div>
            );
          }))}
        </div>
        <BoardBall
          rows={rows}
          cols={cols}
          player={player}
          anim={anim}
          bump={bump}
          phase={phase}
          board={board}
          mode={mapKey === undefined ? 'level' : 'rush'}
        />
      </div>

      {phase === 'paused' && (
        <div className="board-pause-cover absolute inset-0 z-20 grid place-items-center bg-[#07121c]/80 backdrop-blur-md">
          <div className="text-center">
            <p className="font-display text-2xl font-bold text-white">Paused</p>
            <p className="mt-1 text-xs text-slate-300">The clock keeps running</p>
            <PrimaryButton className="mt-5" onClick={onResume} autoFocus><Play size={16} /> Resume</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

// A line for how a Swipe Rush went, by boards cleared.
function rushVerdict(maps) {
  if (maps === 0) return 'Not this time.';
  if (maps <= 4) return 'Warming up.';
  if (maps <= 9) return 'A solid run.';
  if (maps <= 14) return 'Fast hands.';
  if (maps <= 19) return 'On fire.';
  return 'Unreal.';
}

function WinDialog({ run, result, firstRun, globalResult, onJoin, onReplay, onNext, onHome, completedLevels }) {
  const isLast = run.level >= LEVELS;
  const practice = !run.ranked;
  const stats = [{ label: 'MOVES', value: result.moves }];
  if (practice && firstRun) stats.push({ label: 'FIRST RUN', value: formatTime(firstRun.time) });
  return (
    <ResultDialog
      tone="level"
      titleId="win-title"
      kicker={practice ? `LEVEL ${run.level} · PRACTICE RUN` : `LEVEL ${run.level} OF ${LEVELS}`}
      title={practice ? 'Nicely played' : isLast ? 'Daily run complete' : 'Level cleared'}
      pips={{ total: LEVELS, current: run.level, done: completedLevels }}
      hero={{ label: 'EVERY SQUARE COVERED IN', value: formatTime(result.time) }}
      stats={stats}
      standing={practice
        ? <PracticeStrip>ONLY YOUR FIRST RUN OF EACH LEVEL COUNTS</PracticeStrip>
        : <ResultStanding label={`Level ${run.level}`} globalResult={globalResult} onLogin={onJoin} />}
      actions={(
        <>
          <ResultButton onClick={onReplay}><RotateCcw size={14} strokeWidth={1.6} /> PLAY AGAIN</ResultButton>
          {isLast
            ? <ResultButton primary autoFocus onClick={onHome}><Trophy size={14} strokeWidth={1.6} /> MENU</ResultButton>
            : <ResultButton primary autoFocus onClick={onNext}>NEXT LEVEL <ArrowRight size={14} strokeWidth={1.6} /></ResultButton>}
        </>
      )}
      hint="PRESS ENTER TO CONTINUE"
    />
  );
}

// What the player gets when the five minutes are up: boards cleared, then either the usual
// leaderboard standing (a first run) or a note that a replay is just for fun.
function RushResults({ result, first, globalResult, onJoin, onReplay, onHome }) {
  const practice = !result.ranked;
  const stats = [{ label: 'MOVES', value: result.moves }];
  if (result.maps > 0) stats.push({ label: 'LAST CLEAR', value: formatTime(result.time) });
  if (practice && first) stats.push({ label: 'FIRST RUN', value: `${first.maps} ${first.maps === 1 ? 'MAP' : 'MAPS'}` });
  return (
    <ResultDialog
      tone="rush"
      titleId="rush-title"
      kicker={practice ? 'SWIPE RUSH · PRACTICE RUN' : "SWIPE RUSH · TIME'S UP"}
      title={rushVerdict(result.maps).replace(/\.$/, '')}
      hero={{ label: result.maps === 1 ? 'MAP CLEARED' : 'MAPS CLEARED', value: result.maps }}
      stats={stats}
      standing={practice
        ? <PracticeStrip>ONLY YOUR FIRST SWIPE RUSH OF THE DAY COUNTS</PracticeStrip>
        : <ResultStanding label="Swipe Rush" globalResult={globalResult} onLogin={onJoin} />}
      actions={(
        <>
          <ResultButton onClick={onReplay}><RotateCcw size={14} strokeWidth={1.6} /> PLAY AGAIN</ResultButton>
          <ResultButton primary autoFocus onClick={onHome}><Trophy size={14} strokeWidth={1.6} /> MENU</ResultButton>
        </>
      )}
    />
  );
}

// The run for board `index` of a day's Swipe Rush, with any moves already made on it.
// In a 1v1 the boards come from the match's seed instead of the day.
function makeRushRun({ day, seed, index, ranked, route = [] }) {
  const data = seed ? generateMatchBoard(seed, index) : generateRushBoard(day, index);
  const initialBoard = data.board.map((row) => [...row]);
  const resumed = replayRoute(initialBoard, data.player, route);
  return {
    mode: 'rush',
    day,
    index,
    ranked,
    initialBoard,
    initialPlayer: data.player,
    board: resumed.board,
    player: resumed.player,
    history: resumed.history.slice(-MAX_HISTORY),
    route: resumed.route,
    moves: resumed.route.length,
    remaining: countDots(resumed.board),
  };
}

// The end of a 1v1. The server's verdict arrives a moment after time runs out, so until then
// it shows the score as the player last saw it.
function VersusResults({ rush, outcome, onAgain, onHome }) {
  const you = outcome?.you ?? rush.you;
  const them = outcome?.them ?? rush.them;
  const verdict = outcome ? { win: 'Victory', lose: 'Defeat', draw: 'Draw' }[outcome.outcome] : 'Final score';
  const stats = [{ label: 'OPPONENT', value: rush.opponent }];
  if (outcome?.ranked && outcome.rating !== null) {
    stats.push({ label: 'RATING', value: `${outcome.rating} (${outcome.delta >= 0 ? '+' : ''}${outcome.delta})` });
  } else if (outcome) {
    stats.push({ label: 'MATCH', value: 'FRIENDLY' });
  }
  return (
    <ResultDialog
      tone="rush"
      titleId="versus-result-title"
      kicker={outcome && !outcome.ranked ? 'SWIPE RUSH · 1V1 · FRIENDLY' : 'SWIPE RUSH · 1V1'}
      title={verdict}
      hero={{ label: 'YOU · THEM', value: `${you} – ${them}` }}
      stats={stats}
      standing={outcome ? null : <p className="result-status" role="status"><LoaderCircle size={14} className="menu-spin" /> CONFIRMING THE FINAL SCORE</p>}
      actions={outcome ? (
        <>
          <ResultButton onClick={onAgain}><Swords size={14} strokeWidth={1.6} /> FIND ANOTHER</ResultButton>
          <ResultButton primary autoFocus onClick={onHome}><Trophy size={14} strokeWidth={1.6} /> MENU</ResultButton>
        </>
      ) : <ResultButton primary onClick={onHome}><Trophy size={14} strokeWidth={1.6} /> MENU</ResultButton>}
    />
  );
}

export default function App() {
  const initial = useRef(null);
  initial.current ||= readSavedState();
  const [settings, setSettings] = useState(initial.current.settings);
  const [leaderboard, setLeaderboard] = useState(initial.current.leaderboard);
  // Who is logged in (from the saved login), as { id, name }. Both are null for a guest.
  const [player, setPlayer] = useState(() => {
    const saved = getSession();
    return saved ? { id: saved.user.id, name: saved.user.username } : { id: null, name: null };
  });
  const [accountDialog, setAccountDialog] = useState(null); // 'rename' | 'delete' | null
  const [showAuth, setShowAuth] = useState(null); // null, or { reason } while the login dialog is open
  const authIntent = useRef(null); // what to do once logged in: 'versus'
  const [lobby, setLobby] = useState(null); // the 1v1 lobby: null, or { status, code?, error? }
  const [versusResult, setVersusResult] = useState(null);
  const versusClient = useRef(null);
  const reconnectTries = useRef(0);
  const reopenLobby = useRef(false);
  const openVersusRef = useRef(null);
  const [globalResult, setGlobalResult] = useState({ status: 'idle' });
  const playerRef = useRef(player);
  // Bumped on every new run, so a late leaderboard reply never lands on the wrong level.
  const submission = useRef(0);
  const [dayKey, setDayKey] = useState(() => getAmmanDayKey());
  const daily = useDailyBoards(dayKey);
  const [screen, setScreen] = useState('home');
  const [phase, setPhase] = useState('playing');
  const [run, setRun] = useState(null);
  // What the ball does next: a `move` slides it, `undo` eases it back, `restart` and `load` (a new
  // board) put it straight on its square. BoardBall plays each one once.
  const [anim, setAnim] = useState({ id: 0, kind: 'load', slideMs: 0, fresh: null });
  const [bump, setBump] = useState(null);
  const [result, setResult] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [storageError, setStorageError] = useState('');
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [musicFailed, setMusicFailed] = useState(false);
  const [travel, setTravel] = useState(null);
  const [gameLive, setGameLive] = useState(false);
  const [menuReveal, setMenuReveal] = useState(false);
  const travelRef = useRef(null);
  const stopwatch = useStopwatch();
  const settingsDialog = usePresence(showSettings, POPUP_EXIT_MS);

  // Swipe Rush. `rushInfo` is today's first (ranked) run as the menu shows it; `rush` is the run
  // being played right now (a ranked one or a replay), which `run` holds the current board of.
  const [rushInfo, setRushInfo] = useState(() => settleRush(getAmmanDayKey()));
  const [rush, setRush] = useState(null);
  const [banner, setBanner] = useState(null);
  const rushRef = useRef(null);
  const bannerTimer = useRef(null);
  const bannerCount = useRef(0);
  // 0 in the menu and levels, up to 2 in the cave: how intense the synth fallback music plays.
  const intensityRef = useRef(0);
  const dayKeyRef = useRef(dayKey);
  dayKeyRef.current = dayKey;

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
  const completedLevels = LEVEL_NUMBERS.filter((level) => todaysScores[level]?.length > 0);

  // True once a level's first run has been finished that day. Every run after that is practice.
  const hasFirstRun = useCallback((day, level) => leaderboardRef.current[day]?.levels?.[level]?.length > 0, []);

  // The server no longer accepts the saved login (it expired, or was ended elsewhere).
  const dropLogin = useCallback(() => {
    logOut();
    const guest = { id: null, name: null };
    playerRef.current = guest;
    setPlayer(guest);
  }, []);

  const changePhase = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const commitRun = useCallback((next) => {
    runRef.current = next;
    setRun(next);
    // A first run keeps its moves, so it can be picked up again after a trip to the menu or a reload.
    if (next.ranked) {
      if (next.mode === 'rush') saveRushRoute(next.day, next.route);
      else saveRoute(next.day, next.level, next.route);
    }
  }, []);

  const commitRush = useCallback((next) => {
    rushRef.current = next;
    setRush(next);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, leaderboard }));
    } catch (saveError) {
      console.error('Could not save game data.', saveError);
      setStorageError('Your browser is blocking storage, so settings and times will not be kept.');
    }
  }, [settings, leaderboard]);

  // Times finished while offline are sent the next time the game opens.
  useEffect(() => {
    flushPendingScores();
  }, []);

  // A saved login is checked with the server; if it has expired the player is a guest again.
  useEffect(() => {
    if (!getToken()) return undefined;
    const controller = new AbortController();
    checkSession(controller.signal).then((user) => {
      if (!user && !controller.signal.aborted) {
        const guest = { id: null, name: null };
        playerRef.current = guest;
        setPlayer(guest);
      }
    });
    return () => controller.abort();
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
    // The local music file is the main music; the synth melody is only a fallback if it cannot load.
    if (!settings.music || !audioUnlocked || !musicFailed) return undefined;
    return startMusic(() => settingsRef.current.musicVolume, () => intensityRef.current);
  }, [audioUnlocked, musicFailed, settings.music]);

  useEffect(() => {
    document.body.classList.remove('light-theme');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#07121c');
  }, []);

  const sfx = useCallback((name, ...args) => {
    const current = settingsRef.current;
    if (current.sfx) sounds[name](current.sfxVolume, ...args);
  }, []);

  // Records a level's first run. Nothing ever replaces it: later runs are practice.
  const saveFirstRun = useCallback((day, level, time, moves, route) => {
    const previous = leaderboardRef.current;
    if (previous[day]?.levels?.[level]?.length) return;
    // `sent` stays false until the leaderboard has seen the run; the route is kept until then.
    const first = { time, moves, at: Date.now(), route, sent: false };
    const next = { ...previous, [day]: { levels: { ...previous[day]?.levels, [level]: [first] } } };
    leaderboardRef.current = next;
    setLeaderboard(next);
  }, []);

  // The run has been handed over (accepted, refused, or queued for a retry), so drop its route.
  const markRunSent = useCallback((day, level) => {
    const previous = leaderboardRef.current;
    const first = previous[day]?.levels?.[level]?.[0];
    if (!first || first.sent) return;
    const { route, ...kept } = first;
    const next = { ...previous, [day]: { levels: { ...previous[day].levels, [level]: [{ ...kept, sent: true }] } } };
    leaderboardRef.current = next;
    setLeaderboard(next);
  }, []);

  // Sends first runs the leaderboard has not seen yet: ones finished before the player picked a
  // name, or when the page closed before the reply. The server keeps only a player's first run of
  // a level (or of Swipe Rush), so sending one twice does no harm. `skip` names a run that is
  // being sent some other way right now: { day, level }, or { day, rush: true }.
  const sendUnsentRuns = useCallback((name, skip = null) => {
    for (const [day, { levels }] of Object.entries(leaderboardRef.current)) {
      for (const [key, [first]] of Object.entries(levels || {})) {
        const level = Number(key);
        if (!first || first.sent || !first.route || (skip?.day === day && skip.level === level)) continue;
        submitScore({ day, level, time_ms: Math.round(first.time), route: first.route })
          .then(() => true, (error) => !(error instanceof LoginRequiredError))
          .then((handled) => handled && markRunSent(day, level));
      }
    }
    for (const { day, result: run } of unsentRushRuns()) {
      if (skip?.rush && skip.day === day) continue;
      submitScore({ day, time_ms: Math.round(run.time), routes: run.routes })
        .then(() => true, (error) => !(error instanceof LoginRequiredError))
        .then((handled) => {
          if (!handled) return;
          markRushSent(day);
          if (day === dayKeyRef.current) setRushInfo(rushSnapshot(day));
        });
    }
  }, [markRunSent]);

  useEffect(() => {
    if (playerRef.current.name) sendUnsentRuns(playerRef.current.name);
  }, [sendUnsentRuns]);

  // Starts the clock for the run on screen. A first run is timed from the first moment it begins, so
  // that moment is stored and every later visit rejoins it; a practice run just times itself from now.
  const startClock = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    if (current.ranked) stopwatch.start(beginAttempt(current.day, current.level, current.route).startedAt);
    else stopwatch.start();
  }, [stopwatch]);

  const startRun = useCallback((data, { deferred = false } = {}) => {
    clearPending();
    const initialBoard = data.board.map((row) => [...row]);
    // A level counts (and is timed) only the first time it is cleared each day; after that it is practice.
    const ranked = !hasFirstRun(data.day, data.level);
    const attempt = ranked ? getAttempt(data.day, data.level) : null;
    // Coming back to a first run that is already under way restores the board as it was left.
    const resumed = replayRoute(initialBoard, data.player, attempt?.route ?? []);
    commitRun({
      mode: 'daily',
      level: data.level,
      day: data.day,
      ranked,
      initialBoard,
      initialPlayer: data.player,
      board: resumed.board,
      player: resumed.player,
      history: resumed.history.slice(-MAX_HISTORY),
      route: resumed.route,
      moves: resumed.route.length,
      remaining: countDots(resumed.board),
    });
    setAnim((previous) => ({ id: previous.id + 1, kind: 'load', slideMs: 0, fresh: null }));
    setBump(null);
    setFeedback('');
    setResult(null);
    submission.current += 1;
    setGlobalResult({ status: 'idle' });
    pauseReason.current = null;
    changePhase('playing');
    if (deferred) {
      // The camera is still travelling. A run already under way keeps the clock it has had all along;
      // a new one starts its clock, and the screen switch happens, when the camera lands.
      if (attempt) startClock();
      else stopwatch.reset();
      return;
    }
    startClock();
    screenRef.current = 'game';
    setScreen('game');
    setGameLive(true);
    window.scrollTo({ top: 0 });
  }, [changePhase, clearPending, commitRun, hasFirstRun, startClock, stopwatch]);

  // Menu -> game: the camera pans up from the menu into the sky above it, then the
  // game builds itself in and the clock starts.
  const travelUp = useCallback((data) => {
    if (travelRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      startRun(data);
      return;
    }
    travelRef.current = 'up';
    setGameLive(false);
    startRun(data, { deferred: true });
    setTravel('up');
    window.setTimeout(() => setGameLive(true), TRAVEL_MS - UI_LEAD_MS);
    window.setTimeout(() => {
      startClock();
      screenRef.current = 'game';
      setScreen('game');
      setTravel(null);
      travelRef.current = null;
    }, TRAVEL_MS);
  }, [startClock, startRun]);

  // Levels open in order: the ones before it must be cleared first. A cleared level can always be replayed.
  const startLevel = useCallback((level) => {
    const data = dailyRef.current.boards[level];
    if (!data) return false;
    const open = hasFirstRun(data.day, level) || LEVEL_NUMBERS.every((earlier) => earlier >= level || hasFirstRun(data.day, earlier));
    if (!open) return false;
    // From the menu the switch is animated; "next level" inside the game stays instant.
    if (screenRef.current === 'home') travelUp(data);
    else startRun(data);
    return true;
  }, [hasFirstRun, startRun, travelUp]);

  const replayLevel = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    startRun({ level: current.level, day: current.day, board: current.initialBoard, player: current.initialPlayer });
  }, [startRun]);

  // Sends a first run to the global leaderboard; the server replays the route to verify it.
  const submitGlobal = useCallback(async (completed, time, name = playerRef.current.name) => {
    if (!name) {
      // Not logged in: the run stays saved here and goes out when they log in.
      setGlobalResult({ status: 'needs-login' });
      return;
    }
    const token = submission.current;
    setGlobalResult({ status: 'sending' });
    let keep = false;
    try {
      const standing = await submitScore({
        day: completed.day,
        level: completed.level,
        time_ms: Math.round(time),
        route: completed.route,
      });
      if (token === submission.current) setGlobalResult({ status: 'ranked', rank: standing.rank });
    } catch (error) {
      if (error instanceof LoginRequiredError) {
        keep = true;
        dropLogin();
      }
      if (token !== submission.current) return;
      if (error instanceof LoginRequiredError) setGlobalResult({ status: 'needs-login' });
      else if (error instanceof ScoreRejectedError) setGlobalResult({ status: 'rejected', message: error.message });
      else setGlobalResult({ status: 'offline' });
    } finally {
      if (!keep) markRunSent(completed.day, completed.level);
    }
  }, [dropLogin, markRunSent]);

  // ---------- Swipe Rush ----------
  // Five minutes, as many boards as you can clear. `rush` is the run being played and `run` is
  // the board it is on. A day's first run is the one that counts: its deadline is written down
  // when it begins (see rush.js) and nothing the player does moves it.

  // A big word over the board (READY, GO!, TIME'S UP). `duration` hides it again after a while.
  const showBanner = useCallback((kind, duration = 0, text) => {
    window.clearTimeout(bannerTimer.current);
    bannerCount.current += 1;
    setBanner({ kind, id: bannerCount.current, text });
    // A plain timer, not `later`, because moving to the next board cancels `later` timers.
    if (duration) bannerTimer.current = window.setTimeout(() => setBanner(null), duration);
  }, []);

  // Sends a closed Swipe Rush run to the global leaderboard, the way submitGlobal does for a level.
  const submitRushRun = useCallback(async (day, outcome, name = playerRef.current.name) => {
    if (outcome.maps === 0) {
      // No board was cleared, so there is nothing to rank.
      setGlobalResult({ status: 'idle' });
      return;
    }
    if (!name) {
      setGlobalResult({ status: 'needs-login' });
      return;
    }
    const token = submission.current;
    setGlobalResult({ status: 'sending' });
    let keep = false;
    try {
      const standing = await submitScore({
        day,
        time_ms: Math.round(outcome.time),
        routes: outcome.routes,
      });
      if (token === submission.current) setGlobalResult({ status: 'ranked', rank: standing.rank });
    } catch (error) {
      if (error instanceof LoginRequiredError) {
        keep = true;
        dropLogin();
      }
      if (token !== submission.current) return;
      if (error instanceof LoginRequiredError) setGlobalResult({ status: 'needs-login' });
      else if (error instanceof ScoreRejectedError) setGlobalResult({ status: 'rejected', message: error.message });
      else setGlobalResult({ status: 'offline' });
    } finally {
      if (!keep) {
        markRushSent(day);
        if (day === dayKeyRef.current) setRushInfo(rushSnapshot(day));
      }
    }
  }, [dropLogin]);

  // Puts a board on screen with everything about the last one reset.
  const loadRushBoard = useCallback((nextRun) => {
    clearPending();
    commitRun(nextRun);
    setAnim((previous) => ({ id: previous.id + 1, kind: 'load', slideMs: 0, fresh: null }));
    setBump(null);
    setFeedback('');
  }, [clearPending, commitRun]);

  // Time is up. A ranked run is closed in the store with the boards cleared so far, and sent.
  const endRush = useCallback(() => {
    const current = rushRef.current;
    if (!current || current.over) return;
    clearPending();
    commitRush({ ...current, over: true });
    if (current.versus) {
      // The server keeps the score and sends the result a moment later.
      changePhase('timeup');
      showBanner('time');
      sfx('timeUp');
      vibrate([30, 40, 30, 40, 90]);
      later(() => {
        setBanner(null);
        changePhase('rushDone');
      }, RUSH_TIMEUP_MS);
      return;
    }
    const counted = { maps: current.solved, time: current.lastAt, moves: current.moves, routes: [] };
    const outcome = current.ranked ? (finishRush(current.day) ?? counted) : counted;
    setResult({ mode: 'rush', ranked: current.ranked, maps: outcome.maps, time: outcome.time, moves: outcome.moves });
    if (current.day === dayKeyRef.current) setRushInfo(rushSnapshot(current.day));
    changePhase('timeup');
    showBanner('time');
    sfx('timeUp');
    vibrate([30, 40, 30, 40, 90]);
    if (current.ranked) submitRushRun(current.day, outcome);
    later(() => {
      setBanner(null);
      changePhase('rushDone');
    }, RUSH_TIMEUP_MS);
  }, [changePhase, clearPending, commitRush, later, sfx, showBanner, submitRushRun]);

  // A board was cleared: count it, then bring up the next one almost at once.
  const onRushSolved = useCallback((completed, slideMs) => {
    moveQueue.current = [];
    const current = rushRef.current;
    if (!current || current.over) return;
    const now = Date.now();
    // A board cleared after the deadline does not count.
    if (now >= current.endsAt) {
      endRush();
      return;
    }
    const at = now - current.startedAt;
    if (completed.ranked) recordRushMap(completed.day, completed.route, at);
    // In a 1v1 the server scores it, after checking the route against the same board.
    if (current.versus) versusClient.current?.send({ type: 'solved', index: completed.index, route: completed.route });
    const solved = current.solved + 1;
    commitRush({ ...current, solved, moves: current.moves + completed.route.length, lastAt: at });
    changePhase('advancing');
    sfx('mapClear', solved);
    vibrate(10);
    later(() => {
      const live = rushRef.current;
      if (!live || live.over) return;
      loadRushBoard(makeRushRun({ day: live.day, seed: live.seed, index: live.solved, ranked: live.ranked }));
      changePhase('playing');
    }, slideMs + RUSH_ADVANCE_MS);
  }, [changePhase, commitRush, endRush, later, loadRushBoard, sfx]);

  // The camera has landed in the cave (or a run is starting in place): the clock starts and the
  // board comes into focus. A run already going just carries on with the clock it has.
  const landRush = useCallback(() => {
    const current = rushRef.current;
    if (!current || current.over) return;
    const isNew = current.startedAt === null;
    let { startedAt, endsAt } = current;
    if (isNew && current.versus) {
      // A 1v1 starts when the server says, the same moment for both players.
      ({ plannedStart: startedAt, plannedEnd: endsAt } = current);
    } else if (isNew && current.ranked) {
      // The day's first run: its deadline is written down right here.
      ({ startedAt, endsAt } = beginRush(current.day));
      setRushInfo(rushSnapshot(current.day));
    } else if (isNew) {
      startedAt = Date.now();
      endsAt = startedAt + RUSH_MS;
    }
    commitRush({ ...current, startedAt, endsAt });
    // Picked a run up with less time left than the trip down took.
    if (endsAt <= Date.now()) {
      endRush();
      return;
    }
    changePhase('playing');
    if (isNew) {
      showBanner('go', 900);
      sfx('go');
    }
  }, [changePhase, commitRush, endRush, sfx, showBanner]);

  // Menu -> cave. What the button does depends on today: the first time the run counts, a run
  // left going is picked up where it was, and after that it is just for fun.
  const startRush = useCallback(() => {
    if (travelRef.current || screenRef.current !== 'home') return;
    const day = dayKeyRef.current;
    const info = settleRush(day);
    setRushInfo(info);
    const attempt = info.status === 'running' ? getRush(day) : null;
    const ranked = info.status !== 'finished';
    commitRush({
      day,
      ranked,
      startedAt: attempt?.startedAt ?? null,
      endsAt: attempt?.endsAt ?? null,
      solved: attempt?.maps.length ?? 0,
      moves: attempt?.maps.reduce((total, map) => total + map.route.length, 0) ?? 0,
      lastAt: attempt?.maps.at(-1)?.at ?? 0,
      over: false,
    });
    setResult(null);
    setBanner(null);
    submission.current += 1;
    setGlobalResult({ status: 'idle' });
    loadRushBoard(makeRushRun({ day, index: attempt?.maps.length ?? 0, ranked, route: attempt?.route ?? [] }));
    // The board is up, but nothing moves until the camera lands.
    changePhase('ready');
    sfx('dive');
    if (prefersReducedMotion()) {
      screenRef.current = 'rush';
      setScreen('rush');
      setGameLive(true);
      landRush();
      window.scrollTo({ top: 0 });
      return;
    }
    travelRef.current = 'dive';
    setGameLive(false);
    setTravel('dive');
    window.setTimeout(() => setGameLive(true), TRAVEL_MS - UI_LEAD_MS);
    window.setTimeout(() => {
      landRush();
      screenRef.current = 'rush';
      setScreen('rush');
      setTravel(null);
      travelRef.current = null;
    }, TRAVEL_MS);
  }, [changePhase, commitRush, landRush, loadRushBoard, sfx]);

  // "Play again" after a Swipe Rush: a fresh run in place (it is practice now), after a beat to get ready.
  const restartRush = useCallback(() => {
    const day = dayKeyRef.current;
    commitRush({ day, ranked: false, startedAt: null, endsAt: null, solved: 0, moves: 0, lastAt: 0, over: false });
    setResult(null);
    submission.current += 1;
    setGlobalResult({ status: 'idle' });
    loadRushBoard(makeRushRun({ day, index: 0, ranked: false }));
    changePhase('ready');
    showBanner('ready');
    later(() => landRush(), RUSH_READY_MS);
  }, [changePhase, commitRush, landRush, later, loadRushBoard, showBanner]);

  // ---------- 1v1 ----------
  // The lobby (find an opponent, or play a friend with a code) is a dialog on the menu. When the
  // server pairs two players, both fall into the cave together and the clock starts on its word.

  const closeVersusClient = useCallback(() => {
    versusClient.current?.close();
    versusClient.current = null;
  }, []);

  const startVersusMatch = useCallback((match) => {
    const live = rushRef.current;
    if (live?.versus && !live.over && live.matchId === match.match_id) {
      // Reconnected to the match already on screen: carry on, trusting the server's count.
      commitRush({ ...live, you: match.you, them: match.them });
      if (match.you < live.solved) {
        commitRush({ ...rushRef.current, solved: match.you });
        loadRushBoard(makeRushRun({ day: live.day, seed: live.seed, index: match.you, ranked: false }));
        if (phaseRef.current === 'advancing') changePhase('playing');
      }
      return;
    }
    if (travelRef.current || screenRef.current !== 'home') return;
    const day = dayKeyRef.current;
    const startsAt = Date.now() + match.starts_in_ms;
    setLobby(null);
    setResult(null);
    setVersusResult(null);
    setBanner(null);
    reconnectTries.current = 0;
    commitRush({
      day,
      versus: true,
      matchId: match.match_id,
      seed: match.seed,
      opponent: match.opponent,
      ranked: false,
      startedAt: null,
      endsAt: null,
      plannedStart: startsAt,
      plannedEnd: startsAt + match.remaining_ms,
      solved: match.you,
      you: match.you,
      them: match.them,
      moves: 0,
      lastAt: 0,
      over: false,
    });
    loadRushBoard(makeRushRun({ day, seed: match.seed, index: match.you, ranked: false }));
    changePhase('ready');
    sfx('dive');

    // The camera has landed: READY, a 3-2-1, then the clock starts at the server's start time.
    const awaitStart = () => {
      const remaining = startsAt - Date.now();
      if (remaining > 0) showBanner('ready');
      [3, 2, 1].forEach((count) => {
        if (remaining > count * 1000) later(() => showBanner('count', 900, String(count)), remaining - count * 1000);
      });
      later(() => landRush(), Math.max(0, remaining));
    };
    if (prefersReducedMotion()) {
      screenRef.current = 'rush';
      setScreen('rush');
      setGameLive(true);
      awaitStart();
      window.scrollTo({ top: 0 });
      return;
    }
    travelRef.current = 'dive';
    setGameLive(false);
    setTravel('dive');
    window.setTimeout(() => setGameLive(true), TRAVEL_MS - UI_LEAD_MS);
    window.setTimeout(() => {
      awaitStart();
      screenRef.current = 'rush';
      setScreen('rush');
      setTravel(null);
      travelRef.current = null;
    }, TRAVEL_MS);
  }, [changePhase, commitRush, landRush, later, loadRushBoard, sfx, showBanner]);

  const handleVersusMessage = useCallback((message) => {
    switch (message.type) {
      case 'hello':
        setLobby((current) => (current?.status === 'connecting' ? { status: 'menu' } : current));
        break;
      case 'searching':
        setLobby({ status: 'searching' });
        break;
      case 'room':
        setLobby({ status: 'room', code: message.code });
        break;
      case 'idle':
        setLobby((current) => (current ? { status: 'menu' } : current));
        break;
      case 'error':
        setLobby((current) => (current ? { status: 'menu', error: message.message } : current));
        break;
      case 'matched':
        startVersusMatch(message);
        break;
      case 'score': {
        const live = rushRef.current;
        if (live?.versus) commitRush({ ...live, you: message.you, them: message.them });
        break;
      }
      case 'result':
        setVersusResult(message);
        break;
      default:
        break;
    }
  }, [commitRush, startVersusMatch]);

  const handleVersusClosed = useCallback(() => {
    const live = rushRef.current;
    if (live?.versus && !live.over && reconnectTries.current < 6) {
      // A dropped connection mid-match: try again, and the server puts the player back in it.
      reconnectTries.current += 1;
      window.setTimeout(() => versusClient.current?.connect(), 800 * reconnectTries.current);
      return;
    }
    setLobby((current) => (current ? { status: 'offline' } : current));
  }, []);

  const connectVersus = useCallback(() => {
    closeVersusClient();
    setLobby({ status: 'connecting' });
    const client = new VersusClient({ onMessage: handleVersusMessage, onClose: handleVersusClosed });
    versusClient.current = client;
    client.connect();
  }, [closeVersusClient, handleVersusClosed, handleVersusMessage]);

  const openVersus = useCallback(() => {
    if (travelRef.current || screenRef.current !== 'home') return;
    if (!playerRef.current.name) {
      authIntent.current = 'versus';
      setShowAuth({ reason: 'Log in to play 1v1' });
      return;
    }
    connectVersus();
  }, [connectVersus]);
  openVersusRef.current = openVersus;

  const sendVersus = useCallback((message) => {
    if (!versusClient.current?.send(message)) setLobby({ status: 'offline' });
  }, []);

  const closeLobby = useCallback(() => {
    versusClient.current?.send({ type: 'cancel' });
    closeVersusClient();
    setLobby(null);
  }, [closeVersusClient]);

  // ---------- Logging in and out ----------

  const openAuth = useCallback((reason) => {
    authIntent.current = null;
    setShowAuth({ reason });
  }, []);

  const closeAuth = useCallback(() => {
    authIntent.current = null;
    setShowAuth(null);
  }, []);

  // Logged in (or signed up): whatever was waiting for a name goes out under the account now.
  const handleLoggedIn = useCallback((user) => {
    const name = user.username;
    playerRef.current = { id: user.id, name };
    setPlayer(playerRef.current);
    const intent = authIntent.current;
    authIntent.current = null;
    setShowAuth(null);
    flushPendingScores();
    if (intent === 'versus') {
      openVersusRef.current?.();
      return;
    }
    const current = runRef.current;
    const onResults = screenRef.current !== 'home' && current;
    if (onResults && current.mode === 'rush') {
      // The Swipe Rush results are showing: this run, and anything else unsent, joins the board.
      const showing = Boolean(current.ranked && result?.mode === 'rush');
      if (showing) {
        const closed = getRush(current.day)?.result;
        if (closed) submitRushRun(current.day, closed, name);
      }
      sendUnsentRuns(name, showing ? { day: current.day, rush: true } : null);
      return;
    }
    const showing = Boolean(onResults && current.ranked && result);
    if (showing) submitGlobal(current, result.time, name);
    // Levels cleared earlier today, before there was an account to post them under, join the board too.
    sendUnsentRuns(name, showing ? { day: current.day, level: current.level } : null);
  }, [result, sendUnsentRuns, submitGlobal, submitRushRun]);

  const handleLogout = useCallback(() => {
    logOut();
    const guest = { id: null, name: null };
    playerRef.current = guest;
    setPlayer(guest);
    closeVersusClient();
    setLobby(null);
  }, [closeVersusClient]);

  const finishRun = useCallback((completed, time, slideMs) => {
    moveQueue.current = [];
    changePhase('finishing');
    // A first run is recorded and sent the instant it is solved, not after the celebration, so
    // nothing the player does meanwhile (back to the menu, closing the tab) can lose it. Practice
    // runs leave no trace.
    if (completed.ranked) {
      saveFirstRun(completed.day, completed.level, time, completed.moves, completed.route);
      clearAttempt(completed.day, completed.level);
      submitGlobal(completed, time);
    }
    later(() => {
      changePhase('celebrating');
      sfx('win');
      vibrate([20, 40, 20]);
      setResult({ time, moves: completed.moves });
      later(() => changePhase('won'), CELEBRATION_MS);
    }, slideMs + 60);
  }, [changePhase, later, saveFirstRun, sfx, submitGlobal]);

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
          // On the ball's own timing curve, so each square lights up as the ball rolls onto it.
          fresh[`${row}-${col}`] = paintDelay(index, distance, slideMs);
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
      setAnim((previous) => ({ id: previous.id + 1, kind: 'move', direction, slideMs, fresh }));
      setFeedback('');
      sfx('move', distance);

      if (updated.remaining === 0) {
        if (updated.mode === 'rush') {
          onRushSolved(updated, slideMs);
          return;
        }
        // The one place a level's clock ever stops.
        finishRun(updated, stopwatch.stop(), slideMs);
        return;
      }

      // Accept the next queued move slightly before the slide ends so fast play stays fluid.
      sliding.current = true;
      later(() => {
        sliding.current = false;
        processQueue();
      }, slideMs * 0.8);
    }
  }, [commitRun, finishRun, later, onRushSolved, sfx, stopwatch]);

  const requestMove = useCallback((direction) => {
    if (phaseRef.current !== 'playing' || !runRef.current) return;
    // Past the deadline nothing more counts, even before the timer has caught up.
    if (runRef.current.mode === 'rush' && Date.now() >= (rushRef.current?.endsAt ?? Infinity)) return;
    if (moveQueue.current.length >= MAX_QUEUED_MOVES) return;
    moveQueue.current.push(direction);
    processQueue();
  }, [processQueue]);

  const jumpTo = useCallback((board, player, route, history, kind, slideMs) => {
    clearPending();
    commitRun({ ...runRef.current, board, player, route, moves: route.length, history, remaining: countDots(board) });
    setAnim((previous) => ({ id: previous.id + 1, kind, slideMs: prefersReducedMotion() ? 0 : slideMs, fresh: null }));
    setBump(null);
    setFeedback('');
  }, [clearPending, commitRun]);

  const undoMove = useCallback(() => {
    const current = runRef.current;
    if (phaseRef.current !== 'playing' || !current?.history.length) return;
    const previous = current.history[current.history.length - 1];
    jumpTo(previous.board, previous.player, previous.route, current.history.slice(0, -1), 'undo', 170);
    sfx('undo');
  }, [jumpTo, sfx]);

  const restartLevel = useCallback(() => {
    const current = runRef.current;
    if (phaseRef.current !== 'playing' || !current || current.moves === 0) return;
    // Restarting is undoable, and the clock keeps running.
    const history = [...current.history, { board: current.board, player: current.player, route: current.route }];
    jumpTo(current.initialBoard, current.initialPlayer, [], history, 'restart', 0);
    sfx('undo');
  }, [jumpTo, sfx]);

  // Pausing only covers the board and stops moves. The clock is never touched. (A Swipe Rush
  // cannot be paused at all: pausing a countdown would only be a way to look at a board for free.)
  const pauseGame = useCallback((reason) => {
    if (phaseRef.current !== 'playing' || runRef.current?.mode === 'rush') return;
    moveQueue.current = [];
    pauseReason.current = reason;
    changePhase('paused');
  }, [changePhase]);

  const resumeGame = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    pauseReason.current = null;
    changePhase('playing');
  }, [changePhase]);

  const openSettings = useCallback(() => {
    pauseGame('settings');
    setShowSettings(true);
  }, [pauseGame]);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    if (pauseReason.current === 'settings') resumeGame();
  }, [resumeGame]);

  // Leaving a level never stops its clock: a first run keeps counting while the player is in the
  // menu, and coming back to it picks the board and the clock up where they were.
  const returnHome = useCallback(() => {
    clearPending();
    setShowSettings(false);
    // Leaving the cave puts the Swipe Rush in play away. A ranked one keeps its place in the
    // store and its deadline keeps counting; a replay is simply dropped.
    if (screenRef.current === 'rush') {
      if (rushRef.current?.versus) {
        closeVersusClient();
        setVersusResult(null);
      }
      commitRush(null);
      setBanner(null);
      setRushInfo(rushSnapshot(dayKeyRef.current));
    }
    screenRef.current = 'home';
    setScreen('home');
    if (reopenLobby.current) {
      reopenLobby.current = false;
      window.setTimeout(() => openVersusRef.current?.(), 0);
    }
  }, [clearPending, closeVersusClient, commitRush]);

  // Game -> menu: the game fades out, then the camera pans back. From a level it pans down out
  // of the sky; from the cave it climbs up out of the ground.
  const goHome = useCallback(() => {
    if (travelRef.current) return;
    const live = rushRef.current;
    if (screenRef.current === 'rush' && live?.versus && !live.over
      && !window.confirm('Leave the match? Your opponent keeps scoring, and you will lose.')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      returnHome();
      return;
    }
    const direction = screenRef.current === 'rush' ? 'rise' : 'down';
    travelRef.current = direction;
    setGameLive(false);
    setMenuReveal(false);
    setTravel(direction);
    window.setTimeout(() => setMenuReveal(true), TRAVEL_DOWN_DELAY_MS + TRAVEL_MS * 0.55);
    window.setTimeout(() => {
      returnHome();
      setTravel(null);
      travelRef.current = null;
    }, TRAVEL_DOWN_DELAY_MS + TRAVEL_MS);
  }, [returnHome]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (showSettingsRef.current) {
        if (key === 'escape') closeSettings();
        return;
      }
      if (screenRef.current !== 'game' && screenRef.current !== 'rush') return;

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

  // ---- Swipe Rush: the deadline, the pressure and the music ----

  // A new day, a new Swipe Rush: show what today's looks like.
  useEffect(() => {
    setRushInfo(settleRush(dayKey));
  }, [dayKey]);

  // The deadline of the run being played, or of a ranked one left going while the player is in the menu.
  const rushDeadline = rush && !rush.over && rush.endsAt ? rush.endsAt : (rushInfo.status === 'running' ? rushInfo.endsAt : null);

  const onRushDeadline = useCallback(() => {
    const live = rushRef.current;
    if (live && !live.over && screenRef.current === 'rush') {
      endRush();
      return;
    }
    // Away from the cave: close the ranked run with what it had, and send it if there is a name.
    setRushInfo(settleRush(dayKeyRef.current));
    if (playerRef.current.name) sendUnsentRuns(playerRef.current.name);
  }, [endRush, sendUnsentRuns]);

  useEffect(() => {
    if (rushDeadline === null) return undefined;
    const timer = window.setTimeout(onRushDeadline, Math.max(0, rushDeadline - Date.now()) + 30);
    // A hidden tab can hold timers back; check again the moment the player returns.
    const onVisible = () => {
      if (!document.hidden && Date.now() >= rushDeadline) onRushDeadline();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [rushDeadline, onRushDeadline]);

  // How little time is left (0, 1, 2): the cave heats up, and the last ten seconds tick.
  const rushActive = Boolean(rush && !rush.over && screen === 'rush');
  const heat = useRushPressure(rush?.endsAt ?? null, rushActive, (seconds) => sfx('tick', seconds));
  const heatRef = useRef(0);
  heatRef.current = heat;

  // The music gets more intense in the cave, and more again in the last minute.
  const inCave = screen === 'rush' || travel === 'dive';
  const musicIntensity = inCave && !rush?.over ? 1 + (heat >= 1 ? 1 : 0) : 0;
  intensityRef.current = musicIntensity;

  // A pulse under the music, tightening as the clock runs down (see rushAudio.js). It is part of
  // the music, so it follows the music switch and volume.
  const pulseOn = settings.music && audioUnlocked && musicIntensity > 0;
  useEffect(() => {
    if (!pulseOn) return undefined;
    return startRushPulse(() => settingsRef.current.musicVolume, () => heatRef.current);
  }, [pulseOn]);

  function changeSettings(nextSettings) {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }

  const playing = phase === 'playing';
  // A level is played in the sky above the menu and Swipe Rush in the cave below it.
  const dailyRun = run && run.mode !== 'rush' ? run : null;
  const rushRun = run && run.mode === 'rush' ? run : null;
  const toGame = travel === 'up' || travel === 'dive' || (!travel && screen !== 'home');

  return (
    <main>
      <BackgroundMusic
        unlocked={audioUnlocked && !musicFailed}
        playing={settings.music}
        volume={settings.musicVolume}
        intensity={musicIntensity}
        onError={() => setMusicFailed(true)}
      />
      {/* One logo for every screen: it glides between the menu spot and the game spot. */}
      <button
        type="button"
        className={`shared-brand ${toGame ? 'to-game' : 'to-menu'} ${travel ? `is-${travel}` : ''}`}
        onClick={goHome}
        disabled={screen === 'home' || Boolean(travel)}
        aria-label={screen === 'home' ? 'Swipe Cover' : 'Back to menu'}
      >
        <Brand />
      </button>
      <div className={`camera ${travel ? `camera-${travel}` : ''}`}>
      {dailyRun && (screen === 'game' || travel) && (
        <section className={`duel-menu game-view ${gameLive ? 'is-live' : ''}`} aria-label="Swipe Cover game">
          <SkyAbove />
          <div className="menu-grain" aria-hidden="true" />

          <header className="game-topbar">
            <span />
            <div className="game-topbar-actions">
              <GameChip onClick={goHome}>
                <ChevronLeft size={15} strokeWidth={1.6} /> MENU
              </GameChip>
              <GameChip
                className="game-chip-icon"
                aria-label={settings.music ? 'Mute music' : 'Unmute music'}
                title={settings.music ? 'Mute music' : 'Unmute music'}
                onClick={() => changeSettings({ ...settings, music: !settings.music })}
              >
                {settings.music ? <Volume2 size={16} strokeWidth={1.6} /> : <VolumeX size={16} strokeWidth={1.6} />}
              </GameChip>
            </div>
          </header>

          <div className="game-stage" style={{ '--board-ratio': run.board[0].length / run.board.length }}>
            <div className="game-hud">
              <div className="game-level">
                <span className="game-level-label">
                  LEVEL {run.level} / {LEVELS}
                  {!run.ranked && <em className="game-practice-tag" title="Not on the leaderboard: only your first run counts">PRACTICE</em>}
                </span>
                <span className="game-pips" aria-hidden="true">
                  {Array.from({ length: LEVELS }, (_, index) => {
                    const level = index + 1;
                    const done = completedLevels.includes(level);
                    return <i key={level} className={level === run.level ? 'is-current' : done ? 'is-done' : ''} />;
                  })}
                </span>
              </div>
              <div className="game-timer">
                <Clock3 size={16} strokeWidth={1.5} />
                <TimerText read={stopwatch.read} className="game-timer-text tabular-nums" />
              </div>
            </div>

            <GameBoard
              run={run}
              anim={anim}
              bump={bump}
              phase={phase}
              onMove={requestMove}
              onResume={resumeGame}
            />

            <div className="game-statusbar">
              <span className="game-status-dots"><i /> {run.remaining} {run.remaining === 1 ? 'SQUARE' : 'SQUARES'} LEFT</span>
              <span role="status" aria-live="polite" className="game-status-feedback">{feedback}</span>
              <span className="tabular-nums">{run.moves} {run.moves === 1 ? 'MOVE' : 'MOVES'}</span>
            </div>

            <div className="game-actions">
              <GameChip onClick={undoMove} disabled={!playing || !run.history.length}>
                <Undo2 size={14} strokeWidth={1.6} /> UNDO
              </GameChip>
              <GameChip onClick={restartLevel} disabled={!playing || run.moves === 0}>
                <RotateCcw size={14} strokeWidth={1.6} /> RESTART
              </GameChip>
              <GameChip onClick={() => pauseGame('manual')} disabled={!playing}>
                <Pause size={14} strokeWidth={1.6} /> PAUSE
              </GameChip>
            </div>
          </div>
        </section>
      )}
      {(screen === 'home' || travel) && (
        <MainMenu
          onPlay={startLevel}
          onRush={startRush}
          onVersus={openVersus}
          onLogin={() => openAuth()}
          onLogout={handleLogout}
          onRename={() => setAccountDialog('rename')}
          onDelete={() => setAccountDialog('delete')}
          settings={settings}
          onSettingsChange={changeSettings}
          leaving={travel === 'up' || travel === 'dive' || ((travel === 'down' || travel === 'rise') && !menuReveal)}
          levelScores={todaysScores}
          player={player}
          completedLevels={completedLevels}
          rush={rushInfo}
          status={daily.status}
          error={storageError}
        />
      )}
      {/* Below the menu, so the camera falls to it: Swipe Rush, played in a cave. */}
      {rushRun && rush && (screen === 'rush' || travel === 'dive' || travel === 'rise') && (
        <section
          className={`duel-menu game-view rush-view ${gameLive ? 'is-live' : ''}`}
          data-heat={heat}
          aria-label="Swipe Rush"
        >
          <CaveBelow heat={heat} />
          <div className="menu-grain" aria-hidden="true" />

          <header className="game-topbar">
            <span />
            <div className="game-topbar-actions">
              <GameChip onClick={goHome}>
                <ChevronLeft size={15} strokeWidth={1.6} /> MENU
              </GameChip>
              <GameChip
                className="game-chip-icon"
                aria-label={settings.music ? 'Mute music' : 'Unmute music'}
                title={settings.music ? 'Mute music' : 'Unmute music'}
                onClick={() => changeSettings({ ...settings, music: !settings.music })}
              >
                {settings.music ? <Volume2 size={16} strokeWidth={1.6} /> : <VolumeX size={16} strokeWidth={1.6} />}
              </GameChip>
            </div>
          </header>

          <div className="game-stage" style={{ '--board-ratio': rushRun.board[0].length / rushRun.board.length }}>
            <RushHud
              solved={rush.solved}
              endsAt={rush.endsAt}
              ranked={rush.ranked}
              versus={rush.versus ? { opponent: rush.opponent, you: rush.you, them: rush.them } : null}
            />

            <GameBoard
              run={rushRun}
              anim={anim}
              bump={bump}
              phase={phase}
              onMove={requestMove}
              onResume={resumeGame}
              mapKey={rushRun.index}
            />

            <div className="game-statusbar">
              <span className="game-status-dots"><i /> {rushRun.remaining} {rushRun.remaining === 1 ? 'SQUARE' : 'SQUARES'} LEFT</span>
              <span role="status" aria-live="polite" className="game-status-feedback">{feedback}</span>
              <span className="tabular-nums">{rushRun.moves} {rushRun.moves === 1 ? 'MOVE' : 'MOVES'}</span>
            </div>

            {/* No pause: the clock cannot stop. Undo and restart cost time like everything else. */}
            <div className="game-actions">
              <GameChip onClick={undoMove} disabled={!playing || !rushRun.history.length}>
                <Undo2 size={14} strokeWidth={1.6} /> UNDO
              </GameChip>
              <GameChip onClick={restartLevel} disabled={!playing || rushRun.moves === 0}>
                <RotateCcw size={14} strokeWidth={1.6} /> RESTART
              </GameChip>
            </div>
          </div>
          <RushBanner banner={banner} />
          {banner && (
            <p className="sr-only" role="status">
              {{ ready: 'Get ready', go: 'Go', time: "Time's up" }[banner.kind]}
            </p>
          )}
        </section>
      )}
      </div>

      {screen === 'game' && !travel && run && phase === 'won' && result && (
        <WinDialog
          run={run}
          result={result}
          firstRun={leaderboard[run.day]?.levels?.[run.level]?.[0]}
          globalResult={globalResult}
          onJoin={() => openAuth('Log in to post your time')}
          onReplay={replayLevel}
          // Past midnight the next level belongs to a new day that has not been started: back to the menu.
          onNext={() => { if (!startLevel(run.level + 1)) goHome(); }}
          onHome={goHome}
          completedLevels={completedLevels}
        />
      )}

      {screen === 'rush' && !travel && rushRun && phase === 'rushDone' && rush?.versus && (
        <VersusResults
          rush={rush}
          outcome={versusResult}
          onAgain={() => { reopenLobby.current = true; goHome(); }}
          onHome={goHome}
        />
      )}

      {screen === 'rush' && !travel && rushRun && phase === 'rushDone' && !rush?.versus && result?.mode === 'rush' && (
        <RushResults
          result={result}
          first={rushInfo.status === 'finished' ? rushInfo.result : null}
          globalResult={globalResult}
          onJoin={() => openAuth('Log in to post your score')}
          onReplay={restartRush}
          onHome={goHome}
        />
      )}

      {lobby && (
        <VersusLobby
          lobby={lobby}
          onQueue={() => sendVersus({ type: 'queue' })}
          onCreate={() => sendVersus({ type: 'create' })}
          onJoin={(code) => sendVersus({ type: 'join', code })}
          onCancel={() => sendVersus({ type: 'cancel' })}
          onClose={closeLobby}
          onRetry={connectVersus}
        />
      )}

      {accountDialog && (
        <AccountDialog
          mode={accountDialog}
          player={player}
          onClose={() => setAccountDialog(null)}
          onRenamed={(user) => {
            playerRef.current = { id: user.id, name: user.username };
            setPlayer(playerRef.current);
            setAccountDialog(null);
          }}
          onDeleted={() => {
            handleLogout();
            setAccountDialog(null);
          }}
        />
      )}

      {showAuth && <AuthDialog reason={showAuth.reason} onClose={closeAuth} onSuccess={handleLoggedIn} />}

      {settingsDialog.mounted && (
        <SettingsDialog settings={settings} onSettingsChange={changeSettings} onClose={closeSettings} closing={settingsDialog.closing} />
      )}
    </main>
  );
}

