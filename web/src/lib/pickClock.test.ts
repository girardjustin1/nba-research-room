import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { remainingSeconds, usePickClock } from './pickClock';

describe('remainingSeconds', () => {
  it('counts down from the total and clamps at zero', () => {
    expect(remainingSeconds(1_000, 1_000, 60)).toBe(60);
    expect(remainingSeconds(1_000, 31_000, 60)).toBe(30);
    expect(remainingSeconds(1_000, 120_000, 60)).toBe(0);
  });
});

describe('usePickClock', () => {
  let t = 0;
  const now = () => t;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) =>
    act(() => {
      t += ms;
      vi.advanceTimersByTime(ms);
    });

  it('ticks down while the pick stays the same', () => {
    const { result } = renderHook(({ pick }) => usePickClock(60, pick, now), { initialProps: { pick: 5 } });
    expect(result.current).toBe(60);
    advance(20_000);
    expect(result.current).toBeCloseTo(40, 0);
  });

  it('restarts when the current pick changes', () => {
    const { result, rerender } = renderHook(({ pick }) => usePickClock(60, pick, now), { initialProps: { pick: 5 } });
    advance(45_000);
    expect(result.current).toBeCloseTo(15, 0);
    rerender({ pick: 6 });
    expect(result.current).toBe(60);
    advance(10_000);
    expect(result.current).toBeCloseTo(50, 0);
  });

  it('does not restart on a re-render with the same pick', () => {
    const { result, rerender } = renderHook(({ pick }) => usePickClock(60, pick, now), { initialProps: { pick: 5 } });
    advance(30_000);
    rerender({ pick: 5 });
    expect(result.current).toBeCloseTo(30, 0);
  });

  it('stops at zero', () => {
    const { result } = renderHook(() => usePickClock(60, 1, now));
    advance(90_000);
    expect(result.current).toBe(0);
  });
});
