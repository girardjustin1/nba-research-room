import { useEffect, useRef, useState } from 'react';

/**
 * Seconds left on a pick clock that started at `startedAt` (ms) and lasts `total` seconds.
 * Pure, so it is unit-tested directly.
 */
export function remainingSeconds(startedAt: number, now: number, total: number): number {
  return Math.max(0, total - (now - startedAt) / 1000);
}

/**
 * A countdown that restarts whenever `resetKey` changes (the current pick number).
 * This is the local display clock only: Yahoo's clock is authoritative, and the API
 * does not report when a pick started, so the restart happens when this app first sees
 * the new current pick.
 */
export function usePickClock(total: number, resetKey: unknown, now: () => number = Date.now): number {
  const startedAt = useRef<number>(now());
  const lastKey = useRef<unknown>(resetKey);
  const [left, setLeft] = useState<number>(total);

  useEffect(() => {
    if (lastKey.current !== resetKey) {
      lastKey.current = resetKey;
      startedAt.current = now();
    }
    const tick = () => setLeft(remainingSeconds(startedAt.current, now(), total));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [resetKey, total, now]);

  return left;
}
