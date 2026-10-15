import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { countdownLabel, draftStartLabel } from './countdown';
import { DraftCountdown } from './DraftCountdown';

const STARTS = '2026-10-18T19:00:00-04:00';
const at = (msBefore: number) => () => new Date(STARTS).getTime() - msBefore;
const MIN = 60_000;

describe('draft countdown', () => {
  it('formats the time left by how far away it is', () => {
    expect(countdownLabel(((2 * 24 + 21) * 60 + 14) * MIN + 59_000)).toBe('2d 21h 14m');
    expect(countdownLabel((5 * 60 + 2) * MIN + 7_000)).toBe('5:02:07');
    expect(countdownLabel(4 * MIN + 5_000)).toBe('4:05');
    expect(countdownLabel(-5)).toBe('0:00');
  });

  it('names the start in league time', () => {
    expect(draftStartLabel(STARTS)).toBe('Sun, Oct 18, 7:00 pm ET');
  });

  it('counts down until the start, then disappears', () => {
    const { rerender } = render(<DraftCountdown startsAt={STARTS} now={at(((2 * 24 + 21) * 60 + 14) * MIN)} />);
    expect(screen.getByRole('timer').textContent).toContain('Draft in 2d 21h 14m');
    rerender(<DraftCountdown startsAt={STARTS} now={() => new Date(STARTS).getTime() + MIN} />);
    expect(screen.queryByRole('timer')).toBeNull();
    rerender(<DraftCountdown startsAt={null} now={at(MIN)} />);
    expect(screen.queryByRole('timer')).toBeNull();
  });
});
