const MUSIC_NOTES = [220, 247, 277, 330, 392, 330, 277, 247, 220, 196, 174, 196];
const MUSIC_STEP_MS = 380;

// Sound effects play this much higher than written (1.12 is about two semitones).
const SFX_PITCH = 1.12;

let context = null;

export function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  context ||= new AudioContextClass();
  if (context.state === 'suspended') {
    context.resume().catch((error) => console.error('Could not resume audio.', error));
  }
  return context;
}

export function envelope(audio, peak, start, duration) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  gain.connect(audio.destination);
  return gain;
}

// Swells up to its peak over the whole length, then cuts: for risers.
function swellEnvelope(audio, peak, start, duration) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + duration * 0.96);
  gain.gain.linearRampToValueAtTime(0.0001, start + duration);
  gain.connect(audio.destination);
  return gain;
}

export function playTone(volume, frequency, { duration = 0.1, shape = 'sine', delay = 0, level = 0.04 } = {}) {
  if (volume <= 0) return;
  try {
    const audio = getAudioContext();
    if (!audio) return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    oscillator.type = shape;
    oscillator.frequency.value = frequency * SFX_PITCH;
    oscillator.connect(envelope(audio, level * volume / 100, start, duration));
    oscillator.start(start);
    oscillator.stop(start + duration);
  } catch (error) {
    console.error('Could not play the game sound.', error);
  }
}

// A tone that glides from one pitch to another.
export function playSweep(volume, from, to, { duration = 0.3, shape = 'sawtooth', delay = 0, level = 0.04 } = {}) {
  if (volume <= 0) return;
  try {
    const audio = getAudioContext();
    if (!audio) return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(from * SFX_PITCH, start);
    oscillator.frequency.exponentialRampToValueAtTime(to * SFX_PITCH, start + duration);
    oscillator.connect(envelope(audio, level * volume / 100, start, duration));
    oscillator.start(start);
    oscillator.stop(start + duration);
  } catch (error) {
    console.error('Could not play the game sound.', error);
  }
}

let noiseBuffer = null;

function getNoise(audio) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== audio.sampleRate) {
    noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// A burst of filtered noise (hi-hats, whooshes, risers). The filter glides from `from` to `to`;
// with `swell` the burst gets louder through its length instead of dying away.
export function playNoise(volume, { duration = 0.2, delay = 0, level = 0.03, type = 'highpass', from = 6000, to = from, swell = false } = {}) {
  if (volume <= 0) return;
  try {
    const audio = getAudioContext();
    if (!audio) return;
    const start = audio.currentTime + delay;
    const source = audio.createBufferSource();
    source.buffer = getNoise(audio);
    source.loop = duration > 2;
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    source.connect(filter);
    filter.connect((swell ? swellEnvelope : envelope)(audio, level * volume / 100, start, duration));
    source.start(start);
    source.stop(start + duration);
  } catch (error) {
    console.error('Could not play the game sound.', error);
  }
}

export const sounds = {
  move: (volume, distance) => playTone(volume, 300 + Math.min(distance, 10) * 14, { duration: 0.08, shape: 'triangle' }),
  blocked: (volume) => playTone(volume, 110, { duration: 0.12, level: 0.05 }),
  // A level that is not open yet: two soft notes, stepping down.
  refused: (volume) => [196, 131].forEach((frequency, index) => (
    playTone(volume, frequency, { duration: 0.13, shape: 'triangle', delay: index * 0.11, level: 0.045 })
  )),
  undo: (volume) => playTone(volume, 260, { duration: 0.08, shape: 'triangle', level: 0.03 }),
  win: (volume) => [523, 659, 784, 1047].forEach((frequency, index) => (
    playTone(volume, frequency, { duration: 0.22, shape: 'triangle', delay: index * 0.09, level: 0.035 })
  )),

  // ---- Swipe Rush ----
  // A board cleared: two quick notes up. Each board in the run lifts them a semitone (up to an octave).
  mapClear: (volume, cleared = 0) => {
    const lift = 2 ** (Math.min(cleared, 12) / 12);
    [[659, 0], [988, 0.075]].forEach(([frequency, delay]) => (
      playTone(volume, frequency * lift, { duration: 0.11, shape: 'triangle', delay, level: 0.05 })
    ));
  },
  // The last ten seconds, once a second; the final three are higher.
  tick: (volume, secondsLeft) => playTone(volume, secondsLeft <= 3 ? 1480 : 1100, { duration: 0.05, shape: 'square', level: 0.022 }),
  // The clock starts: a rising sweep into a bright chord.
  go: (volume) => {
    playSweep(volume, 260, 980, { duration: 0.22, level: 0.035 });
    [523, 784, 1047].forEach((frequency, index) => (
      playTone(volume, frequency, { duration: 0.18, shape: 'triangle', delay: 0.22 + index * 0.04, level: 0.04 })
    ));
  },
  // Time is up: a falling growl and a low boom.
  timeUp: (volume) => {
    playSweep(volume, 330, 70, { duration: 0.7, level: 0.06 });
    playTone(volume, 62, { duration: 0.9, level: 0.08 });
    playNoise(volume, { duration: 0.5, level: 0.04, type: 'lowpass', from: 2400, to: 200 });
  },
  // Diving into the cave: a riser that builds for as long as the camera falls.
  dive: (volume) => {
    playNoise(volume, { duration: 1.6, level: 0.05, type: 'bandpass', from: 250, to: 3200, swell: true });
    playSweep(volume, 90, 420, { duration: 1.6, level: 0.03 });
  },
};

// Loops a soft background melody. Returns a function that stops it. `getIntensity` (0 calm,
// 1 and up in Swipe Rush) makes it faster and adds a brighter octave on top.
export function startMusic(getVolume, getIntensity = () => 0) {
  let index = 0;
  let timer;
  const step = () => {
    const intensity = getIntensity();
    const volume = getVolume();
    if (!document.hidden && volume > 0) {
      try {
        const audio = getAudioContext();
        if (audio) {
          const now = audio.currentTime;
          const note = MUSIC_NOTES[index++ % MUSIC_NOTES.length];
          const length = intensity ? 0.14 : 0.2;
          const gain = envelope(audio, 0.016 * volume / 100 * (intensity ? 1.3 : 1), now, length);
          const voices = [['triangle', note], ['sine', note / 2]];
          if (intensity) voices.push(['sawtooth', note * 2]);
          for (const [type, frequency] of voices) {
            const oscillator = audio.createOscillator();
            oscillator.type = type;
            oscillator.frequency.value = frequency;
            oscillator.connect(gain);
            oscillator.start(now);
            oscillator.stop(now + length);
          }
        }
      } catch (error) {
        console.error('Could not play background music.', error);
      }
    }
    timer = window.setTimeout(step, MUSIC_STEP_MS / (1 + 0.5 * Math.min(intensity, 2)));
  };
  timer = window.setTimeout(step, MUSIC_STEP_MS);
  return () => window.clearTimeout(timer);
}

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is optional; some browsers throw when it is blocked.
  }
}
