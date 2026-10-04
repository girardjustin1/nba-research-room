import { useEffect, useState } from 'react';

/** Current time, re-read every `ms` (for "12 s ago" labels). */
export function useNow(ms = 1000, now: () => number = Date.now): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setT(now()), ms);
    return () => clearInterval(id);
  }, [ms, now]);
  return t;
}

export function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}
