import { useEffect, useState } from 'react';

// Keeps a popup mounted for `exitMs` after `open` turns false, so it can play its
// closing animation. Reopening mid-exit simply cancels the exit.
export function usePresence(open, exitMs) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setMounted(false), reducedMotion ? 0 : exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted: open || mounted, closing: !open && mounted };
}
