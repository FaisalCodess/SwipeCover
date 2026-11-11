// Talks to the Python game server. Everything here degrades gracefully: the game
// is fully playable without the server, it just cannot show global rankings.
export const API_URL = (import.meta.env.VITE_GAME_API_URL || '/api').replace(/\/$/, '');
const PENDING_KEY = 'swipe-cover-pending-scores';
const SESSION_KEY = 'swipe-cover-session-v1';
const MAX_PENDING = 20;

// Same rule as clean_name in backend/scores.py.
export const NAME_PATTERN = /^[\p{L}\p{N}_ -]{3,16}$/u;
export const PASSWORD_MIN_LENGTH = 8;

export function cleanName(name) {
  const cleaned = name.split(/\s+/).filter(Boolean).join(' ');
  return NAME_PATTERN.test(cleaned) ? cleaned : null;
}

// The server refused the run (bad route, old day...); retrying will not help.
export class ScoreRejectedError extends Error {}
// The run needs a logged-in player; it is kept and sent once they log in.
export class LoginRequiredError extends Error {}
// The server refused an account request; the message is meant for the player.
export class AccountError extends Error {}

// ---------- Who is logged in ----------
// The session (a token from the server, and the player's id and username for showing) is kept in
// the browser. The token is what proves who is playing: the server ignores any name in a request.

let session = null;
try {
  session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  if (!session || typeof session.token !== 'string' || typeof session.user?.id !== 'string') session = null;
} catch {
  session = null;
}

export const getSession = () => session;
export const getToken = () => session?.token ?? null;

export function saveSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.error('Could not keep the login.', error);
  }
}

function headers(extra = {}) {
  return session ? { ...extra, Authorization: `Bearer ${session.token}` } : extra;
}

async function accountRequest(path, body) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  } catch {
    throw new AccountError('Could not reach the server. Check your connection and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AccountError(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.');
  }
  return data;
}

const sessionUser = (user) => ({ id: user.id, username: user.username, hasPassword: user.has_password });

function startSession(data) {
  saveSession({ token: data.token, user: sessionUser(data.user) });
  return data.user;
}

export async function changeUsername(username) {
  const { user } = await accountRequest('/auth/username', { username });
  saveSession({ token: session.token, user: sessionUser(user) });
  return user;
}

// Deletes the account for good. `password` is only needed for accounts that have one.
export async function deleteAccount(confirmUsername, password) {
  await accountRequest('/auth/delete', { confirm_username: confirmUsername, password: password || null });
  saveSession(null);
}

export async function register(email, username, password) {
  return startSession(await accountRequest('/auth/register', { email, username, password }));
}

export async function logIn(identifier, password) {
  return startSession(await accountRequest('/auth/login', { identifier, password }));
}

// Resolves to the user, or `{ needsUsername: true, email }` for a first visit that has to pick a name.
export async function logInWithGoogle(credential, username) {
  const data = await accountRequest('/auth/google', { credential, username });
  if (data.needs_username) return { needsUsername: true, email: data.email };
  return startSession(data);
}

// Asks for a password reset email. The answer is the same whether or not the address has an account.
export const requestPasswordReset = (email) => accountRequest('/auth/forgot', { email });

// Sets a new password from the emailed link's code, and logs in.
export async function resetPassword(token, password) {
  return startSession(await accountRequest('/auth/reset', { token, password }));
}

// A /?legal=privacy or /?legal=terms link (the old privacy.html and terms.html pages send people here)
// opens that document inside the game. Read once at load, then taken out of the address bar.
export const LEGAL_LINK = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('legal');
    if (!page) return null;
    params.delete('legal');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    return page === 'terms' ? 'terms' : 'privacy';
  } catch {
    return null;
  }
})();

// The password reset link opens the game as /?reset=CODE. The code is read once at load and taken out
// of the address bar straight away so it does not linger in the history or get shared by accident.
export const RESET_TOKEN = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (!token) return null;
    params.delete('reset');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    return token;
  } catch {
    return null;
  }
})();

export async function logOut() {
  const token = getToken();
  saveSession(null);
  if (!token) return;
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // The token is already forgotten here; the server drops it when it expires.
  }
}

// Checks the saved login is still good. Resolves to the user, or null when the server says no.
// A network failure keeps the login (the player may just be offline).
export async function checkSession(signal) {
  if (!session) return null;
  try {
    const response = await fetch(`${API_URL}/auth/me`, { headers: headers(), signal });
    if (response.status === 401) {
      saveSession(null);
      return null;
    }
    if (!response.ok) return session.user;
    const { user } = await response.json();
    saveSession({ token: session.token, user: sessionUser(user) });
    return user;
  } catch {
    return session.user;
  }
}

export async function fetchConfig(signal) {
  const response = await fetch(`${API_URL}/config`, { signal });
  if (!response.ok) throw new Error(`Game server responded with ${response.status}.`);
  return response.json();
}

// ---------- Boards and leaderboards ----------

export async function fetchDailyBoard(level, signal) {
  const response = await fetch(`${API_URL}/daily/${level}`, { signal });
  if (!response.ok) throw new Error(`Game server responded with ${response.status}.`);
  return response.json();
}

async function getJson(path, signal) {
  const response = await fetch(`${API_URL}${path}`, { signal, headers: headers() });
  if (!response.ok) throw new Error(`Leaderboard responded with ${response.status}.`);
  return response.json();
}

export const fetchLeaderboard = (level, signal) => getJson(`/leaderboard/${level}`, signal);
export const fetchRushLeaderboard = (signal) => getJson('/rush/leaderboard', signal);
export const fetchVersusLeaderboard = (signal) => getJson('/versus/leaderboard', signal);

async function postScore(score) {
  let response;
  try {
    // A Swipe Rush run carries a route per board (`routes`); a daily level carries one `route`.
    response = await fetch(`${API_URL}/${score.routes ? 'rush/scores' : 'scores'}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(score),
    });
  } catch (error) {
    throw new Error(`Could not reach the leaderboard: ${error.message}`);
  }
  if (response.status === 401) throw new LoginRequiredError('Log in to post your time.');
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
// on the next visit; a rejection (ScoreRejectedError) is final. A run without a login is
// not kept here: the game holds it until the player logs in.
export async function submitScore(score) {
  try {
    return await postScore(score);
  } catch (error) {
    if (!(error instanceof ScoreRejectedError) && !(error instanceof LoginRequiredError)) writePending([...readPending(), score]);
    throw error;
  }
}

export async function flushPendingScores() {
  if (!session) return;
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
