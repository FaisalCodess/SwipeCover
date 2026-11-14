import { useEffect, useRef } from 'react';
import { getAudioContext } from './audio.js';

// Put your music file at frontend/public/music/background.mp3 (any format the browser can
// play works; change the name here if you use .ogg, .m4a, etc.). If the file is missing or
// cannot play, the game falls back to the built-in synth melody.
export const MUSIC_URL = `${import.meta.env.BASE_URL}music/background.mp3`;

// The track is played straight through Web Audio (decoded once, then played as a buffer) instead
// of through an <audio> element. Phones are bad at the element: they ignore its volume, they
// glitch when its speed changes, they stutter when it seeks back to the start, and pausing one
// that is routed through Web Audio can leave the last sliver of sound repeating on a loop. A
// buffer has none of these problems: volume and speed are smooth, sample-accurate ramps.

// The track fades out over its last FADE_OUT_SECONDS, then starts again from the top
// and fades in over FADE_IN_SECONDS.
const FADE_OUT_SECONDS = 4;
const FADE_IN_SECONDS = 4;
const TICK_MS = 50;

// The slider's 0-70 range keeps the original quiet scale (70 is the level the game always shipped
// with); from 70 up to 100 the music climbs smoothly to full volume, where the phone's own volume
// buttons are the only limit.
const KNEE = 70;
const QUIET_MAX = 0.15;
const VOLUME_CURVE = 1.5;
const KNEE_LEVEL = QUIET_MAX * (KNEE / 100) ** VOLUME_CURVE;

// Swipe Rush turns the track up. `intensity` is 0 as recorded, 1 in Swipe Rush, 2 for its last
// minute. The track plays faster and its pitch rises with the speed, like a tape being rushed.
// The speed glides there over RATE_GLIDE_SECONDS, so entering the cave sounds like a riser, and
// leaving it eases back to the original. To tune the feel, change these numbers (1 = original).
const RATE_BY_INTENSITY = [1, 1.1, 1.17];
const RATE_GLIDE_SECONDS = 1.8;
const RUSH_VOLUME_BOOST = 1.25;
// How quickly the volume follows the slider, the fades and the on/off switch (seconds).
const VOLUME_SMOOTHING = 0.05;
// Switching the music off fades it out for this long before the sound is stopped.
const STOP_AFTER_SECONDS = 0.25;

// Slider (0-100) -> loudness (0-1).
export function musicVolume(slider) {
  const value = Math.min(Math.max(slider, 0), 100);
  if (value <= KNEE) return QUIET_MAX * (value / 100) ** VOLUME_CURVE;
  return KNEE_LEVEL * (1 / KNEE_LEVEL) ** ((value - KNEE) / (100 - KNEE));
}

// 'playing' = full level, 'out' = fading out at the end, 'in' = fading in from the start.
function fadeGain(phase, progress) {
  if (phase === 'out') return Math.cos(progress * Math.PI / 2);
  if (phase === 'in') return Math.sin(progress * Math.PI / 2);
  return 1;
}

const rateFor = (intensity) => RATE_BY_INTENSITY[Math.min(intensity, RATE_BY_INTENSITY.length - 1)];

// The decoded track is kept for the life of the page, so it is only fetched and decoded once.
let trackPromise = null;
function loadTrack(context) {
  trackPromise ||= fetch(MUSIC_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Music file not found (${response.status}).`);
      return response.arrayBuffer();
    })
    // Older Safari only knows the callback form of decodeAudioData.
    .then((data) => new Promise((resolve, reject) => context.decodeAudioData(data, resolve, reject)))
    .catch((error) => {
      trackPromise = null;
      throw error;
    });
  return trackPromise;
}

// An iPhone mutes Web Audio while its ringer switch is on silent, though it still plays a media
// element. Playing a silent clip through an element (and asking Safari for the "playback" audio
// session) makes Web Audio audible too.
// A real one-second clip of silence (8 kHz, 8-bit, mono), built here so it has a proper length:
// a zero-length clip on a loop makes the browser spin.
function makeSilentClipUrl() {
  const rate = 8000;
  const bytes = new Uint8Array(44 + rate).fill(128);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + rate, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, rate, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

function unmuteIOS() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    // Not supported here.
  }
  try {
    const url = makeSilentClipUrl();
    const clip = new Audio(url);
    clip.loop = true;
    clip.setAttribute('playsinline', '');
    clip.play().catch(() => {});
    return { clip, url };
  } catch {
    return null;
  }
}

// How long the buffer player may stay silent (context not running, or the track not decoded)
// before the plain audio element takes over, so the music can never just be missing.
const GIVE_UP_MS = 3500;
const DECODE_GIVE_UP_MS = 12000;

// Plays the local music file. Mounted only after the first user gesture (`unlocked`)
// so the browser's autoplay rules allow sound. It draws nothing.
export default function BackgroundMusic({ unlocked, playing, volume, intensity = 0, onError }) {
  const props = useRef({ playing, volume, intensity, onError });
  props.current = { playing, volume, intensity, onError };

  useEffect(() => {
    if (!unlocked) return undefined;
    const context = getAudioContext();
    if (!context) {
      props.current.onError?.(new Error('No Web Audio here.'));
      return undefined;
    }

    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);

    // Everything the player remembers between ticks.
    const state = {
      buffer: null,
      source: null,
      position: 0, // seconds into the track
      lastTime: context.currentTime,
      phase: 'playing',
      progress: 0,
      rateFrom: 1,
      rateTo: 1,
      rateStart: 0,
      stopAt: 0,
    };
    let cancelled = false;
    let timer = 0;

    const rateAt = (time) => {
      const done = Math.min(1, Math.max(0, (time - state.rateStart) / RATE_GLIDE_SECONDS));
      return state.rateFrom + (state.rateTo - state.rateFrom) * done;
    };

    // Glides the running source from where its speed is now to the wanted speed.
    function scheduleRate(source, now) {
      const param = source.playbackRate;
      const current = rateAt(now);
      const endTime = state.rateStart + RATE_GLIDE_SECONDS;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
      if (state.rateTo !== current) param.linearRampToValueAtTime(state.rateTo, Math.max(endTime, now + 0.02));
    }

    function stopSource() {
      const source = state.source;
      if (!source) return;
      state.source = null;
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }

    function startSource(offset) {
      const now = context.currentTime;
      stopSource();
      const source = context.createBufferSource();
      source.buffer = state.buffer;
      source.connect(gain);
      scheduleRate(source, now);
      // Safety net: if the track reaches its very end anyway (a throttled background tab can skip
      // the fade), start over with a fade-in instead of going silent.
      source.onended = () => {
        if (state.source !== source) return;
        state.source = null;
        state.position = 0;
        state.phase = 'in';
        state.progress = 0;
      };
      source.start(0, offset % state.buffer.duration);
      state.source = source;
      state.position = offset % state.buffer.duration;
    }

    function tick() {
      if (!state.buffer) return;
      const { playing: wantPlay, volume: slider, intensity: wantIntensity } = props.current;
      const now = context.currentTime;
      const dt = Math.min(Math.max(now - state.lastTime, 0), 0.25);
      state.lastTime = now;
      if (context.state !== 'running') context.resume().catch(() => {});

      // A new intensity starts a glide of the speed.
      const wantRate = rateFor(wantIntensity);
      if (wantRate !== state.rateTo) {
        state.rateFrom = rateAt(now);
        state.rateStart = now;
        state.rateTo = wantRate;
        if (state.source) scheduleRate(state.source, now);
      }

      if (wantPlay) {
        state.stopAt = 0;
        if (!state.source) startSource(state.position);
      } else if (state.source) {
        // Fade out first, then stop: nothing is cut off mid-sound.
        if (!state.stopAt) state.stopAt = now + STOP_AFTER_SECONDS;
        else if (now >= state.stopAt) stopSource();
      }

      if (state.source && wantPlay) {
        state.position += dt * rateAt(now);
        const remaining = state.buffer.duration - state.position;
        if (state.phase === 'playing') {
          // The fade needs track time to last as long as the speed makes it run, so start early enough.
          if (remaining <= FADE_OUT_SECONDS * RATE_BY_INTENSITY[RATE_BY_INTENSITY.length - 1]) {
            state.phase = 'out';
            state.progress = 0;
          }
        } else if (state.phase === 'out') {
          state.progress = Math.min(1, state.progress + dt / FADE_OUT_SECONDS);
          if (state.progress >= 1) {
            // Silent by now: jump back to the start and begin fading in.
            startSource(0);
            state.phase = 'in';
            state.progress = 0;
          }
        } else {
          state.progress = Math.min(1, state.progress + dt / FADE_IN_SECONDS);
          if (state.progress >= 1) {
            state.phase = 'playing';
            state.progress = 0;
          }
        }
      }

      const level = wantPlay
        ? Math.min(1, musicVolume(slider) * fadeGain(state.phase, state.progress) * (wantIntensity > 0 ? RUSH_VOLUME_BOOST : 1))
        : 0;
      gain.gain.setTargetAtTime(level, now, VOLUME_SMOOTHING);
    }

    // The plain-element player: no fades or smooth speed changes, but it plays everywhere.
    let fallback = null;
    let fallbackTimer = 0;
    function useFallback(reason) {
      if (fallback || cancelled) return;
      console.info('Music: using the simple player.', reason);
      window.clearInterval(timer);
      stopSource();
      state.buffer = null;
      fallback = new Audio(MUSIC_URL);
      fallback.loop = true;
      fallback.preload = 'auto';
      fallback.preservesPitch = false;
      fallback.onerror = () => props.current.onError?.(new Error('The music file cannot play.'));
      const sync = () => {
        const { playing: wantPlay, volume: slider, intensity: wantIntensity } = props.current;
        fallback.volume = Math.min(1, musicVolume(slider) * (wantIntensity > 0 ? RUSH_VOLUME_BOOST : 1));
        const rate = rateFor(wantIntensity);
        if (Math.abs(fallback.playbackRate - rate) > 0.001) fallback.playbackRate = rate;
        if (wantPlay && fallback.paused) fallback.play().catch(() => {});
        else if (!wantPlay && !fallback.paused) fallback.pause();
      };
      sync();
      fallbackTimer = window.setInterval(sync, 120);
    }

    const silentClip = unmuteIOS();
    const watchdog = window.setTimeout(() => {
      if (!state.buffer) return;
      if (props.current.playing && context.state !== 'running') useFallback('audio context is not running');
    }, GIVE_UP_MS);
    const decodeWatchdog = window.setTimeout(() => {
      if (!state.buffer) useFallback('the track is taking too long to decode');
    }, DECODE_GIVE_UP_MS);

    function wake() {
      if (!document.hidden && context.state !== 'running') context.resume().catch(() => {});
    }

    loadTrack(context)
      .then((buffer) => {
        if (cancelled) return;
        state.buffer = buffer;
        state.lastTime = context.currentTime;
        const wanted = rateFor(props.current.intensity);
        state.rateFrom = wanted;
        state.rateTo = wanted;
        state.phase = 'playing';
        state.progress = 0;
        tick();
        timer = window.setInterval(tick, TICK_MS);
      })
      .catch((error) => useFallback(error));

    document.addEventListener('visibilitychange', wake);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.clearTimeout(watchdog);
      window.clearTimeout(decodeWatchdog);
      window.clearInterval(fallbackTimer);
      if (fallback) fallback.pause();
      if (silentClip) {
        silentClip.clip.pause();
        URL.revokeObjectURL(silentClip.url);
      }
      stopSource();
      gain.disconnect();
    };
  }, [unlocked]);

  return null;
}
