// Days in a row the player has finished a first run. A day counts once a ranked daily level or a
// ranked Swipe Rush is done; miss a whole day and the streak starts again. Kept on this device.

const KEY = 'swipe-cover-streak-v1';

// Day keys are Amman dates (YYYY-MM-DD); this turns one into a whole number of days.
const dayNumber = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

export function readStreak() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.last === 'string' && Number.isInteger(saved.count)) return { last: saved.last, count: saved.count };
  } catch {
    // Unreadable: start again.
  }
  return { last: '', count: 0 };
}

// Records that `day` was played and returns the new state.
export function markPlayed(state, day) {
  if (state.last === day) return state;
  const continues = state.last && dayNumber(day) - dayNumber(state.last) === 1;
  const next = { last: day, count: continues ? state.count + 1 : 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The streak just will not outlive this tab.
  }
  return next;
}

// The streak as it stands today: still alive if the last day played was today or yesterday.
export function currentStreak(state, today) {
  if (!state.last) return 0;
  const gap = dayNumber(today) - dayNumber(state.last);
  return gap === 0 || gap === 1 ? state.count : 0;
}

// A streak that began before streaks were counted lives in the runs already on the device: the
// days with a first run. This works the streak out from them, and keeps the better of that and
// what was saved.
export function backfillStreak(state, days) {
  const sorted = [...new Set(days)].sort();
  if (!sorted.length) return state;
  const last = sorted[sorted.length - 1];
  let count = 1;
  for (let index = sorted.length - 1; index > 0 && dayNumber(sorted[index]) - dayNumber(sorted[index - 1]) === 1; index -= 1) count += 1;
  if (last < state.last || (last === state.last && count <= state.count)) return state;
  const next = { last, count };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The streak just will not outlive this tab.
  }
  return next;
}
