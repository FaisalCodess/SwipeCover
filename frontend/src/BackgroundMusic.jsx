import { useEffect, useRef, useState } from 'react';
import { getAudioContext } from './audio.js';

// Put your music file at frontend/public/music/background.mp3 (any format the browser can
// play works; change the name here if you use .ogg, .m4a, etc.). If the file is missing or
// cannot play, the game falls back to the built-in synth melody.
export const MUSIC_URL = `${import.meta.env.BASE_URL}music/background.mp3`;

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
// minute. The track plays faster and its pitch rises with the speed, like a tape being rushed. The
// speed changes once, in a single jump, while the volume is ducked for a moment (see below).
const RATE_BY_INTENSITY = [1, 1.1, 1.17];
const RUSH_VOLUME_BOOST = 1.25;
const DIP_TIME_CONSTANT = 0.04; // seconds: how fast the volume drops for the change
const DIP_SWAP_MS = 220; // the speed changes here, in the quiet
const DIP_RETURN_MS = 280; // and the volume starts coming back here
const DIP_RETURN_CONSTANT = 0.16;
const VOLUME_SMOOTHING = 0.045; // seconds: ordinary volume changes glide instead of stepping

// Slider (0-100) -> loudness (0-1).
export function musicVolume(slider) {
  const value = Math.min(Math.max(slider, 0), 100);
  if (value <= KNEE) return QUIET_MAX * (value / 100) ** VOLUME_CURVE;
  return KNEE_LEVEL * (1 / KNEE_LEVEL) ** ((value - KNEE) / (100 - KNEE));
}

// 'playing' = full level, 'out' = fading out at the end, 'in' = fading in from the start.
function fadeGain({ phase, progress }) {
  if (phase === 'out') return Math.cos(progress * Math.PI / 2);
  if (phase === 'in') return Math.sin(progress * Math.PI / 2);
  return 1;
}

// Plays the local music file. Mounted only after the first user gesture (`unlocked`)
// so the browser's autoplay rules allow sound.
export default function BackgroundMusic({ unlocked, playing, volume, intensity = 0, onError }) {
  const [fade, setFade] = useState({ phase: 'playing', progress: 0 });
  const fadeRef = useRef(fade);
  const audioRef = useRef(null);

  const baseLevel = musicVolume(volume) * fadeGain(fade);
  // `dip` is a short duck in the volume that hides a speed change; `boost` is the Rush loudness.
  const dipRef = useRef(1);
  const boostRef = useRef(intensity > 0 ? RUSH_VOLUME_BOOST : 1);
  const baseRef = useRef(baseLevel);
  baseRef.current = baseLevel;
  const graphRef = useRef(null);

  // The loudness goes through a Web Audio gain node, not the audio element's own `volume`: phones
  // (iPhones above all) ignore the element's volume, so the slider and every fade did nothing
  // there. A gain node works everywhere and glides between values instead of stepping.
  function applyVolume(timeConstant = VOLUME_SMOOTHING) {
    const target = Math.min(1, baseRef.current * boostRef.current * dipRef.current);
    const graph = graphRef.current;
    if (graph) {
      graph.gain.gain.setTargetAtTime(target, graph.context.currentTime, timeConstant);
    } else if (audioRef.current) {
      audioRef.current.volume = target;
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!unlocked || !audio || graphRef.current) return;
    try {
      const context = getAudioContext();
      if (!context) return;
      const source = context.createMediaElementSource(audio);
      const gain = context.createGain();
      gain.gain.value = Math.min(1, baseRef.current * boostRef.current * dipRef.current);
      source.connect(gain);
      gain.connect(context.destination);
      audio.volume = 1;
      graphRef.current = { context, gain };
    } catch (error) {
      console.info('Music volume falls back to the player.', error);
    }
  }, [unlocked]);

  useEffect(() => { applyVolume(); }, [baseLevel, unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pitch follows the speed and never switches mode: flipping `preservesPitch` while the
  // track plays makes the browser rebuild its stretcher, and phones glitch when it does.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
  }, [unlocked]);

  // A change of playback speed makes a phone re-prepare its audio, which is a small glitch if it is
  // heard. So the speed changes once, while the volume is ducked: the glitch happens in the quiet.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const target = RATE_BY_INTENSITY[Math.min(intensity, RATE_BY_INTENSITY.length - 1)];
    const boostTarget = intensity > 0 ? RUSH_VOLUME_BOOST : 1;
    if (Math.abs(audio.playbackRate - target) < 0.001) {
      boostRef.current = boostTarget;
      applyVolume();
      return undefined;
    }
    dipRef.current = 0;
    applyVolume(DIP_TIME_CONSTANT);
    const swap = window.setTimeout(() => {
      audio.playbackRate = target;
      boostRef.current = boostTarget;
    }, DIP_SWAP_MS);
    const back = window.setTimeout(() => {
      dipRef.current = 1;
      applyVolume(DIP_RETURN_CONSTANT);
    }, DIP_RETURN_MS);
    return () => {
      window.clearTimeout(swap);
      window.clearTimeout(back);
      dipRef.current = 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intensity, unlocked]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.play().catch((error) => {
        // A blocked autoplay is retried on the next toggle; anything else means the file is unusable.
        if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') onError?.(error);
      });
    } else {
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, unlocked]);

  useEffect(() => {
    if (!unlocked || !playing) return undefined;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      const now = performance.now();
      const dt = Math.min(now - last, 250) / 1000;
      last = now;
      const next = { ...fadeRef.current };
      if (next.phase === 'playing') {
        const duration = audio?.duration;
        const time = audio?.currentTime;
        if (!(duration > FADE_OUT_SECONDS * 2 && time > 0 && duration - time <= FADE_OUT_SECONDS)) return;
        next.phase = 'out';
        next.progress = 0;
      } else if (next.phase === 'out') {
        next.progress = Math.min(1, next.progress + dt / FADE_OUT_SECONDS);
        if (next.progress >= 1) restart(next);
      } else {
        next.progress = Math.min(1, next.progress + dt / FADE_IN_SECONDS);
        if (next.progress >= 1) {
          next.phase = 'playing';
          next.progress = 0;
        }
      }
      fadeRef.current = next;
      setFade(next);
    }, TICK_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, playing]);

  // Silent by now: jump back to the start and begin fading in.
  function restart(next) {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    next.phase = 'in';
    next.progress = 0;
  }

  if (!unlocked) return null;

  // Safety net: if the track reaches its very end anyway (e.g. a throttled background
  // tab skipped the fade), start over with a fade-in instead of going silent.
  const handleEnded = () => {
    if (fadeRef.current.phase === 'in') return;
    const next = { ...fadeRef.current };
    restart(next);
    fadeRef.current = next;
    setFade(next);
  };

  return (
    <audio
      ref={audioRef}
      src={MUSIC_URL}
      preload="auto"
      onEnded={handleEnded}
      onError={onError}
    />
  );
}
