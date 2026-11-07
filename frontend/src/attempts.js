// The level being played for the first time today (the run that counts for the leaderboard),
// remembered across trips to the menu and page reloads.
//
// That run's clock starts the first time the player lands in the level and stops only when
// the level is solved. Pausing, restarting, leaving for the menu or even closing the tab
// never stops it, so the moment it began is stored rather than kept in memory, along with
// the moves made so far so the player can pick the board up where they left it.
const STORAGE_KEY = 'swipe-cover-attempts-v1';
const KEEP_DAYS = 3;
// Same cap as the server puts on a submitted route.
const MAX_ROUTE = 2000;
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
    console.error('Could not remember the level in progress.', error);
  }
}

function isValid(attempt) {
  return Boolean(attempt)
    && Number.isFinite(attempt.startedAt)
    && Array.isArray(attempt.route)
    && attempt.route.length <= MAX_ROUTE
    && attempt.route.every((step) => DIRECTIONS.has(step));
}

// The unfinished first run of a level, or null when it has not been started today.
export function getAttempt(day, level) {
  const attempt = readAll()[day]?.[level];
  if (!isValid(attempt)) return null;
  // A start time in the future (a clock that was changed) would make the timer run backwards.
  return { startedAt: Math.min(attempt.startedAt, Date.now()), route: [...attempt.route] };
}

// Starts timing a level. If it is already being timed the original start is kept, so asking
// again (from another tab, say) can never push the start later.
export function beginAttempt(day, level, route = []) {
  const existing = getAttempt(day, level);
  if (existing) return existing;
  const all = readAll();
  const attempt = { startedAt: Date.now(), route: [...route] };
  all[day] = { ...all[day], [level]: attempt };
  writeAll(all);
  return { ...attempt };
}

export function saveRoute(day, level, route) {
  const all = readAll();
  const attempt = all[day]?.[level];
  if (!isValid(attempt)) return;
  all[day] = { ...all[day], [level]: { startedAt: attempt.startedAt, route: [...route] } };
  writeAll(all);
}

// Called once the level is solved: from then on the result lives with the player's scores.
export function clearAttempt(day, level) {
  const all = readAll();
  if (!all[day]?.[level]) return;
  const { [level]: removed, ...rest } = all[day];
  all[day] = rest;
  writeAll(all);
}
