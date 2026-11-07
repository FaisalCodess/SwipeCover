// The rhythm that sits under the music in Swipe Rush.
//
// The background track is the player's own file, so its tempo is unknown and a strict drum
// pattern laid over it would clash. Instead this is a pulse, like a heartbeat: a low thump
// on every beat that tightens as the clock runs down, with hi-hats joining in the last
// minute and a sub-bass in the last ten seconds. A heartbeat reads as tension, not as a
// competing rhythm, so it fits over whatever the track is doing.
import { getAudioContext, playNoise } from './audio.js';

// Beats per minute at each heat: normal, the last minute, the last ten seconds.
export const PULSE_BPM = [102, 128, 160];
// How loud the thump is (0 to 1, before the music volume slider). Lower it to sit deeper under the music.
export const PULSE_LEVEL = 0.055;
// How far ahead of the clock beats are scheduled (seconds), and how often the schedule is topped up.
const LOOKAHEAD = 0.22;
const REFILL_MS = 40;

// One thump: a sine that drops from a punch to a low rumble.
function kick(audio, time, peak) {
  const oscillator = audio.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(135, time);
  oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.14);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.22);
}

// A low note under the thump, for the last ten seconds.
function bass(audio, time, peak, length) {
  const oscillator = audio.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.value = 55;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(time);
  oscillator.stop(time + length + 0.02);
}

// Schedules one beat (and what goes with it at this heat) at `time`, on the audio clock.
export function scheduleBeat(audio, time, volume, heat, secondsPerBeat) {
  const peak = PULSE_LEVEL * volume / 100;
  kick(audio, time, peak);
  if (heat >= 1) {
    // Hi-hat between the beats.
    playNoise(volume, { duration: 0.04, delay: time + secondsPerBeat / 2 - audio.currentTime, level: 0.016, type: 'highpass', from: 7500 });
  }
  if (heat >= 2) bass(audio, time, peak * 0.9, secondsPerBeat * 0.8);
}

// Starts the pulse. `getVolume` is the music volume (0-100); `getHeat` is 0, 1 or 2. Returns a stop function.
export function startRushPulse(getVolume, getHeat) {
  const audio = getAudioContext();
  if (!audio) return () => {};
  let next = audio.currentTime + 0.05;

  const refill = () => {
    const volume = getVolume();
    // Nothing to play while hidden or silent; resync rather than let a backlog of beats pile up.
    if (document.hidden || volume <= 0 || next < audio.currentTime - 0.1) {
      next = audio.currentTime + 0.05;
      if (document.hidden || volume <= 0) return;
    }
    while (next < audio.currentTime + LOOKAHEAD) {
      const heat = getHeat();
      const secondsPerBeat = 60 / PULSE_BPM[heat];
      try {
        scheduleBeat(audio, next, volume, heat, secondsPerBeat);
      } catch (error) {
        console.error('Could not play the Swipe Rush pulse.', error);
        return;
      }
      next += secondsPerBeat;
    }
  };

  const timer = window.setInterval(refill, REFILL_MS);
  refill();
  return () => window.clearInterval(timer);
}
