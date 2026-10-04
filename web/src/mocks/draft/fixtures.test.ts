import { describe, expect, it } from 'vitest';
import { makeSession, makeStrength } from './fixtures';

describe('makeStrength (sample data)', () => {
  it('keeps probabilities in 0..1 and ranks consistent with the values', () => {
    const s = makeStrength(makeSession({ mySlot: 5, currentPick: 30 }));
    expect(s.categories).toHaveLength(9);
    for (const c of s.categories) {
      for (const v of [c.me, c.league_avg, c.best]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(c.best).toBeGreaterThanOrEqual(c.me ?? 0);
      expect(c.rank).toBeGreaterThanOrEqual(1);
      expect(c.rank).toBeLessThanOrEqual(s.teams);
      if (c.rank === 1) expect(c.best_team_id).toBe(5);
    }
    expect(s.expected_cats.best).toBeLessThanOrEqual(9);
  });
});
