const MUSIC_NOTES = [220, 247, 277, 330, 392, 330, 277, 247, 220, 196, 174, 196];
const MUSIC_STEP_MS = 380;

let context = null;

function getContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  context ||= new AudioContextClass();
  if (context.state === 'suspended') {
    context.resume().catch((error) => console.error('Could not resume audio.', error));
  }
  return context;
}

function envelope(audio, peak, start, duration) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  gain.connect(audio.destination);
  return gain;
}

export function playTone(volume, frequency, { duration = 0.1, shape = 'sine', delay = 0, level = 0.04 } = {}) {
  if (volume <= 0) return;
  try {
    const audio = getContext();
    if (!audio) return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    oscillator.type = shape;
    oscillator.frequency.value = frequency;
    oscillator.connect(envelope(audio, level * volume / 100, start, duration));
    oscillator.start(start);
    oscillator.stop(start + duration);
  } catch (error) {
    console.error('Could not play the game sound.', error);
  }
}

export const sounds = {
  move: (volume, distance) => playTone(volume, 300 + Math.min(distance, 10) * 14, { duration: 0.08, shape: 'triangle' }),
  blocked: (volume) => playTone(volume, 110, { duration: 0.12, level: 0.05 }),
  undo: (volume) => playTone(volume, 260, { duration: 0.08, shape: 'triangle', level: 0.03 }),
  win: (volume) => [523, 659, 784, 1047].forEach((frequency, index) => (
    playTone(volume, frequency, { duration: 0.22, shape: 'triangle', delay: index * 0.09, level: 0.035 })
  )),
};

// Loops a soft background melody. Returns a function that stops it.
export function startMusic(getVolume) {
  let index = 0;
  const timer = window.setInterval(() => {
    const volume = getVolume();
    if (document.hidden || volume <= 0) return;
    try {
      const audio = getContext();
      if (!audio) return;
      const now = audio.currentTime;
      const note = MUSIC_NOTES[index++ % MUSIC_NOTES.length];
      const gain = envelope(audio, 0.016 * volume / 100, now, 0.2);
      for (const [type, frequency] of [['triangle', note], ['sine', note / 2]]) {
        const oscillator = audio.createOscillator();
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(now);
        oscillator.stop(now + 0.2);
      }
    } catch (error) {
      console.error('Could not play background music.', error);
    }
  }, MUSIC_STEP_MS);
  return () => window.clearInterval(timer);
}

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is optional; some browsers throw when it is blocked.
  }
}
