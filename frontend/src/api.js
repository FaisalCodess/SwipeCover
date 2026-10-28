// Talks to the Python game server. Everything here degrades gracefully: the game
// is fully playable without the server, it just cannot show global rankings.
export const API_URL = (import.meta.env.VITE_GAME_API_URL || '/api').replace(/\/$/, '');
const PENDING_KEY = 'swipe-cover-pending-scores';
const MAX_PENDING = 20;

// Same rule as clean_name in backend/scores.py.
export const NAME_PATTERN = /^[\p{L}\p{N}_ -]{3,16}$/u;

export function cleanName(name) {
  const cleaned = name.split(/\s+/).filter(Boolean).join(' ');
  return NAME_PATTERN.test(cleaned) ? cleaned : null;
}

// The server refused the run (bad route, old day...); retrying will not help.
export class ScoreRejectedError extends Error {}

export async function fetchDailyBoard(level, signal) {
  const response = await fetch(`${API_URL}/daily/${level}`, { signal });
  if (!response.ok) throw new Error(`Game server responded with ${response.status}.`);
  return response.json();
}

export async function fetchLeaderboard(level, playerId, signal) {
  const response = await fetch(`${API_URL}/leaderboard/${level}`, { signal, headers: { 'X-Player-Id': playerId } });
  if (!response.ok) throw new Error(`Leaderboard responded with ${response.status}.`);
  return response.json();
}

async function postScore(score) {
  let response;
  try {
    response = await fetch(`${API_URL}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(score),
    });
  } catch (error) {
    throw new Error(`Could not reach the leaderboard: ${error.message}`);
  }
  if (response.status >= 400 && response.status < 500) {
    const detail = await response.json().catch(() => ({}));
    throw new ScoreRejectedError(typeof detail.detail === 'string' ? detail.detail : 'The leaderboard did not accept this run.');
  }
  if (!response.ok) throw new Error(`Leaderboard responded with ${response.status}.`);
  return response.json();
}

function readPending() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(pending) ? pending : [];
  } catch {
    return [];
  }
}

function writePending(pending) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-MAX_PENDING)));
  } catch (error) {
    console.error('Could not keep the unsent score.', error);
  }
}

// Sends a finished run. If the server cannot be reached the run is kept and retried
// on the next visit; a rejection (ScoreRejectedError) is final.
export async function submitScore(score) {
  try {
    return await postScore(score);
  } catch (error) {
    if (!(error instanceof ScoreRejectedError)) writePending([...readPending(), score]);
    throw error;
  }
}

export async function flushPendingScores() {
  const pending = readPending();
  if (!pending.length) return;
  const stillPending = [];
  for (const score of pending) {
    try {
      await postScore(score);
    } catch (error) {
      if (!(error instanceof ScoreRejectedError)) stillPending.push(score);
    }
  }
  writePending(stillPending);
}

export function createPlayerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // randomUUID needs a secure context; getRandomValues works everywhere.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
