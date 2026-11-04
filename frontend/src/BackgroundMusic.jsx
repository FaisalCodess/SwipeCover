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
export default function BackgroundMusic({ unlocked, playing, volume, onError }) {
  const [fade, setFade] = useState({ phase: 'playing', progress: 0 });
  const fadeRef = useRef(fade);
  const audioRef = useRef(null);

  const level = Math.min(1, musicVolume(volume) * fadeGain(fade));

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = level;
  }, [level, unlocked]);

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
