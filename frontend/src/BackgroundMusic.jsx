import { useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player/youtube';

export const MUSIC_VIDEO_ID = 'HUCjaaQR6cs';
const MUSIC_URL = `https://www.youtube.com/watch?v=${MUSIC_VIDEO_ID}`;

// The track fades out over its last FADE_OUT_SECONDS, then starts again from the top
// and fades in over FADE_IN_SECONDS.
const FADE_OUT_SECONDS = 4;
const FADE_IN_SECONDS = 4;
const TICK_MS = 100;
// YouTube volume (0-100) when the slider is at 100%. Lower this to make all music quieter.
const MUSIC_MAX_PERCENT = 15;
// Higher = quieter low end.
const VOLUME_CURVE = 1.5;

const PLAYER_CONFIG = {
  playerVars: { playsinline: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0 },
};

// Slider (0-100) -> YouTube volume percent (0-MUSIC_MAX_PERCENT, whole numbers only: the
// YouTube API cannot go finer than 1%). Non-zero sliders never round down to silence.
export function musicVolumePercent(slider) {
  const level = Math.min(Math.max(slider, 0), 100) / 100;
  if (level === 0) return 0;
  return Math.max(1, Math.round(MUSIC_MAX_PERCENT * level ** VOLUME_CURVE));
}

// 'playing' = full level, 'out' = fading out at the end, 'in' = fading in from the start.
function fadeGain({ phase, progress }) {
  if (phase === 'out') return Math.cos(progress * Math.PI / 2);
  if (phase === 'in') return Math.sin(progress * Math.PI / 2);
  return 1;
}

// Plays the YouTube track as audio only. Mounted only after the first user gesture
// (`unlocked`) so the browser's autoplay rules allow sound.
export default function BackgroundMusic({ unlocked, playing, volume, onError }) {
  const [fade, setFade] = useState({ phase: 'playing', progress: 0 });
  const fadeRef = useRef(fade);
  const playerRef = useRef(null);
  const percentRef = useRef(0);

  const percent = Math.round(musicVolumePercent(volume) * fadeGain(fade));
  percentRef.current = percent;

  const internal = () => playerRef.current?.getInternalPlayer?.();

  useEffect(() => {
    if (!unlocked || !playing) return undefined;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(now - last, 250) / 1000;
      last = now;
      const next = { ...fadeRef.current };
      if (next.phase === 'playing') {
        const duration = playerRef.current?.getDuration?.();
        const time = playerRef.current?.getCurrentTime?.();
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
    const player = internal();
    player?.seekTo?.(0, true);
    player?.playVideo?.();
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
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        right: 0,
        bottom: 0,
        width: 1,
        height: 1,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      <ReactPlayer
        ref={playerRef}
        url={MUSIC_URL}
        playing={playing}
        volume={percent / 100}
        width="1px"
        height="1px"
        config={{ youtube: PLAYER_CONFIG }}
        onReady={() => internal()?.setVolume?.(percentRef.current)}
        onPlay={() => internal()?.setVolume?.(percentRef.current)}
        onEnded={handleEnded}
        onError={onError}
      />
    </div>
  );
}
