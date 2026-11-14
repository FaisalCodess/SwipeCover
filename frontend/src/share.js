// Sharing a result, and the challenge links that come back from it.
//
// A shared result carries a link like /?ch=level&n=2&v=9440&d=2026-11-14&by=Sam. Whoever opens it
// sees "Sam's challenge" on the menu, and the result screen after their own run says how they did
// against it. A challenge only lasts for the day it was set, because the puzzles change at midnight.

const KEY = 'swipe-cover-challenge-v1';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Reads and checks a challenge; anything odd is dropped rather than trusted.
function parseChallenge(source) {
  const kind = source.get('ch');
  const value = Number(source.get('v'));
  const level = Number(source.get('n'));
  const day = source.get('d') || '';
  if (kind !== 'level' && kind !== 'rush') return null;
  if (!DAY.test(day) || !Number.isInteger(value) || value < 1 || value > 3_600_000) return null;
  if (kind === 'level' && !(level >= 1 && level <= 3 && Number.isInteger(level))) return null;
  const by = (source.get('by') || '').replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, 24);
  return { kind, level: kind === 'level' ? level : null, value, day, by };
}

// Taken from the address bar once at load (and out of it, so a refresh or a copy of the address
// does not repeat it), then kept for the tab in sessionStorage until it is dismissed.
export function readChallenge() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('ch')) {
      const found = parseChallenge(params);
      for (const name of ['ch', 'n', 'v', 'd', 'by']) params.delete(name);
      const rest = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
      if (found) sessionStorage.setItem(KEY, JSON.stringify(found));
    }
    const stored = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return stored ? parseChallenge(new URLSearchParams({ ch: stored.kind, n: stored.level ?? '', v: stored.value, d: stored.day, by: stored.by })) : null;
  } catch {
    return null;
  }
}

export function clearChallenge() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

// The link that goes with a shared result.
export function challengeUrl({ kind, level, value, day, by }) {
  const params = new URLSearchParams({ ch: kind, v: String(value), d: day });
  if (kind === 'level') params.set('n', String(level));
  if (by) params.set('by', by);
  return `${window.location.origin}/?${params}`;
}

// Opens the phone's share sheet when there is one (touch screens), and otherwise copies the text
// to the clipboard. Resolves to 'shared', 'copied', 'cancelled' or 'failed'.
export async function shareResult(text, url, { sheet }) {
  if (sheet && navigator.share) {
    try {
      await navigator.share({ title: 'Swipe Cover', text, url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  const full = `${text}\n${url}`;
  try {
    await navigator.clipboard.writeText(full);
    return 'copied';
  } catch {
    // Older browsers: copy through a hidden text box.
    try {
      const box = document.createElement('textarea');
      box.value = full;
      box.setAttribute('readonly', '');
      box.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      return ok ? 'copied' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
