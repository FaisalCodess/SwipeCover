import { useEffect, useRef, useState } from 'react';

// Put your music file at frontend/public/music/background.mp3 (any format the browser can
// play works; change the name here if you use .ogg, .m4a, etc.). If the file is missing or
// cannot play, the game falls back to the built-in synth melody.
export const MUSIC_URL = `${import.meta.env.BASE_URL}music/background.mp3`;

// The track fades out over its last FADE_OUT_SECONDS, then starts again from the top
// and fades in over FADE_IN_SECONDS.
const FADE_OUT_SECONDS = 4;
const FADE_IN_SECONDS = 4;
const TICK_MS = 100;
// Audio element volume (0-1) when the slider is at 100%. Lower this to make all music quieter.
const MUSIC_MAX_VOLUME = 0.15;
// Higher = quieter low end.
const VOLUME_CURVE = 1.5;

// Swipe Rush turns the track up. `intensity` is 0 as recorded, 1 in Swipe Rush, 2 for its last
// minute. The track plays faster, and its pitch rises with the speed, like a tape being rushed:
// that is what makes it feel urgent. The speed glides there over a second or two, so entering
// the cave sounds like a riser, and leaving it eases back to the original.
// To tune the feel, change these numbers (1 = original speed).
const RATE_BY_INTENSITY = [1, 1.1, 1.17];
const RATE_TICK_MS = 120;
const RATE_STEP = 0.0085; // per tick: about a second to the new speed
const BOOST_STEP = 0.02;
const RUSH_VOLUME_BOOST = 1.25;

// Slider (0-100) -> audio element volume (0-MUSIC_MAX_VOLUME).
export function musicVolume(slider) {
  const level = Math.min(Math.max(slider, 0), 100) / 100;
  return MUSIC_MAX_VOLUME * level ** VOLUME_CURVE;
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
  // The Rush volume boost glides in with the speed instead of jumping, which would click.
  const boostRef = useRef(1);
  const baseRef = useRef(baseLevel);
  baseRef.current = baseLevel;
  const applyVolume = () => {
    const audio = audioRef.current;
    if (audio) audio.volume = Math.min(1, baseRef.current * boostRef.current);
  };

  useEffect(applyVolume, [baseLevel, unlocked]);

  // The pitch follows the speed from the start and never switches mode. Flipping `preservesPitch`
  // while the track plays makes the browser rebuild its audio stretcher, and phones glitch when
  // it does. At normal speed this setting changes nothing you can hear.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;
  }, [unlocked]);

  // Glides the playback speed (and the volume boost) to where this intensity wants it, in few,
  // small steps: every change of speed costs a phone a little work, so fewer is smoother.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const target = RATE_BY_INTENSITY[Math.min(intensity, RATE_BY_INTENSITY.length - 1)];
    const boostTarget = intensity > 0 ? RUSH_VOLUME_BOOST : 1;
    const timer = window.setInterval(() => {
      const gap = target - audio.playbackRate;
      const boostGap = boostTarget - boostRef.current;
      if (Math.abs(gap) <= RATE_STEP) audio.playbackRate = target;
      else audio.playbackRate += Math.sign(gap) * RATE_STEP;
      boostRef.current = Math.abs(boostGap) <= BOOST_STEP ? boostTarget : boostRef.current + Math.sign(boostGap) * BOOST_STEP;
      applyVolume();
      if (audio.playbackRate === target && boostRef.current === boostTarget) window.clearInterval(timer);
    }, RATE_TICK_MS);
    return () => window.clearInterval(timer);
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
