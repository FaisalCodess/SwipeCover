// Swipe Rush: five minutes, as many boards as you can clear.
//
// Like the first run of a daily level, a day's first Swipe Rush is the one that counts
// (the leaderboard keeps only that), so it cannot be re-rolled. Its clock is a deadline
// written down the moment the run begins, and nothing the player does moves it: leaving
// for the menu, pausing, reloading or closing the page all leave it counting. Boards
// cleared and the moves made on the current one are kept too, so coming back to a run
// that is still going picks it up where it was. When the deadline passes while the
// player is away, the run is closed with the boards cleared so far (see `settleRush`).

export const RUSH_MS = 5 * 60 * 1000;
// A short beat between clearing a board and the next one appearing.
export const RUSH_ADVANCE_MS = 240;
// "TIME" stays on screen this long before the results appear.
export const RUSH_TIMEUP_MS = 1500;
// "READY" before a run that starts in place (Play again), so there is a beat to get set.
export const RUSH_READY_MS = 800;
// The last minute runs hot, the last ten seconds critical: the screen and the music react.
export const RUSH_HOT_MS = 60 * 1000;
export const RUSH_CRITICAL_MS = 10 * 1000;

const STORAGE_KEY = 'swipe-cover-rush-v1';
const KEEP_DAYS = 3;
// Same caps as the server puts on a submitted run.
const MAX_MAPS = 150;
const MAX_ROUTE = 300;
const DIRECTIONS = new Set(['up', 'left', 'down', 'right']);

// Only used when the browser blocks storage, so a run still survives menu trips in that case.
let memory = null;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return memory ?? {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return memory ?? {};
  }
}

function writeAll(all) {
  const days = Object.keys(all).sort().slice(-KEEP_DAYS);
  const kept = Object.fromEntries(days.map((day) => [day, all[day]]));
  memory = kept;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch (error) {
    console.error('Could not remember the Swipe Rush run.', error);
  }
}

const validRoute = (route) => Array.isArray(route) && route.length <= MAX_ROUTE && route.every((step) => DIRECTIONS.has(step));

// Reads one day's record defensively: anything malformed is dropped, never trusted.
function clean(entry) {
  if (!entry || !Number.isFinite(entry.startedAt) || !Number.isFinite(entry.endsAt)) return null;
  const maps = (Array.isArray(entry.maps) ? entry.maps : [])
    .filter((map) => map && validRoute(map.route) && map.route.length > 0 && Number.isFinite(map.at))
    .slice(0, MAX_MAPS)
    .map((map) => ({ route: [...map.route], at: map.at }));
  const done = entry.result;
  const result = done && Number.isFinite(done.maps) && Number.isFinite(done.time) && Number.isFinite(done.moves)
    ? {
      maps: done.maps,
      time: done.time,
      moves: done.moves,
      at: Number.isFinite(done.at) ? done.at : entry.endsAt,
      sent: Boolean(done.sent),
      routes: Array.isArray(done.routes) && done.routes.every(validRoute) ? done.routes : [],
    }
    : null;
  return {
    startedAt: Math.min(entry.startedAt, Date.now()),
    endsAt: entry.endsAt,
    maps,
    route: validRoute(entry.route) ? [...entry.route] : [],
    result,
  };
}

export function getRush(day) {
  return clean(readAll()[day]);
}

function update(day, change) {
  const all = readAll();
  const entry = clean(all[day]);
  if (!entry) return null;
  const next = change(entry);
  all[day] = next;
  writeAll(all);
  return next;
}

// Starts the day's first run. If one is already on record its start stands, so asking
// again (from another tab, say) can never push the deadline later.
export function beginRush(day, now = Date.now()) {
  const existing = getRush(day);
  if (existing) return existing;
  const all = readAll();
  all[day] = { startedAt: now, endsAt: now + RUSH_MS, maps: [], route: [], result: null };
  writeAll(all);
  return getRush(day);
}

// Moves made on the board in play, so it can be picked up again after a trip to the menu.
export function saveRushRoute(day, route) {
  update(day, (entry) => (entry.result ? entry : { ...entry, route: [...route] }));
}

// A board was cleared: its route joins the list and the next board starts empty.
export function recordRushMap(day, route, at) {
  update(day, (entry) => (entry.result ? entry : { ...entry, maps: [...entry.maps, { route: [...route], at }], route: [] }));
}

// Closes the run: what counts is the boards cleared, with the time the last one was
// cleared as the tie-break. Routes are kept until the leaderboard has seen them.
export function finishRush(day) {
  const next = update(day, (entry) => {
    if (entry.result) return entry;
    const last = entry.maps.at(-1);
    const routes = entry.maps.map((map) => map.route);
    return {
      ...entry,
      maps: [],
      route: [],
      result: {
        maps: routes.length,
        time: last ? last.at : 0,
        moves: routes.reduce((total, route) => total + route.length, 0),
        at: Date.now(),
        // Nothing to send when no board was cleared.
        sent: routes.length === 0,
        routes,
      },
    };
  });
  return next?.result ?? null;
}

export function markRushSent(day) {
  update(day, (entry) => (entry.result ? { ...entry, result: { ...entry.result, sent: true, routes: [] } } : entry));
}

// Closed runs the leaderboard has not seen yet (no name was chosen, or the page closed first).
export function unsentRushRuns() {
  return Object.keys(readAll()).sort().flatMap((day) => {
    const result = getRush(day)?.result;
    return result && !result.sent && result.routes.length ? [{ day, result }] : [];
  });
}

// idle: not started today. running: its deadline is still ahead. expired: the deadline passed
// with no result written yet. finished: closed, with a result.
export function rushSnapshot(day, now = Date.now()) {
  const entry = getRush(day);
  if (!entry) return { status: 'idle' };
  if (entry.result) return { status: 'finished', result: entry.result };
  if (now < entry.endsAt) return { status: 'running', endsAt: entry.endsAt, solved: entry.maps.length };
  return { status: 'expired' };
}

// A run whose time ran out while the player was away is closed with what it had.
export function settleRush(day, now = Date.now()) {
  if (rushSnapshot(day, now).status === 'expired') finishRush(day);
  return rushSnapshot(day, now);
}

// 4:32, then tenths of a second for the last ten (9.4). Rounds up, so it reads 5:00 at the
// start and only shows 0.0 at the very end.
export function formatRushClock(milliseconds) {
  const left = Math.max(0, milliseconds);
  if (left < RUSH_CRITICAL_MS) return (Math.ceil(left / 100) / 10).toFixed(1);
  const total = Math.ceil(left / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// 0 normal, 1 hot (the last minute), 2 critical (the last ten seconds).
export function rushHeat(millisecondsLeft) {
  if (millisecondsLeft <= RUSH_CRITICAL_MS) return 2;
  return millisecondsLeft <= RUSH_HOT_MS ? 1 : 0;
}
