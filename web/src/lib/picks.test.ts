import { describe, expect, it } from 'vitest';
import { makeSession } from '../mocks/draft/fixtures';
import { gridMatchesApi, myNextPick, roundOf, roundPick, roundPickLong, snakePick, snakeSlot, teamName } from './picks';

describe('pick labels', () => {
  it('formats round.pick for a 14-team league', () => {
    expect(roundPick(1, 14)).toBe('1.01');
    expect(roundPick(14, 14)).toBe('1.14');
    expect(roundPick(23, 14)).toBe('2.09');
    expect(roundPick(29, 14)).toBe('3.01');
    expect(roundPickLong(29, 14)).toBe('3.01 (29th)');
    expect(roundOf(28, 14)).toBe(2);
  });
});

describe('snake layout', () => {
  it('odd rounds run left to right, even rounds right to left', () => {
    expect([1, 14, 15, 28, 29].map((p) => snakeSlot(p, 14))).toEqual([1, 14, 14, 1, 1]);
    expect(snakePick(2, 5, 14)).toBe(24);
    for (let p = 1; p <= 182; p += 1) expect(snakePick(roundOf(p, 14), snakeSlot(p, 14), 14)).toBe(p);
  });
  it('cross-checks the layout against the API my_picks', () => {
    const s = makeSession({ mySlot: 5, currentPick: 30 });
    expect(gridMatchesApi(s)).toBe(true);
    expect(gridMatchesApi({ ...s, my_picks: [5, 23] })).toBe(false);
  });
});

describe('session helpers', () => {
  it('names teams: You for mine, saved names, else Team N', () => {
    const s = makeSession({ mySlot: 5, currentPick: 30 });
    expect(teamName(s, 5)).toBe('You');
    expect(teamName(s, 2)).toBe('Fictional Five');
    expect(teamName({ ...s, team_names: {} }, 7)).toBe('Team 7');
    expect(teamName({ ...s, team_names: { '7': '  ' } }, 7)).toBe('Team 7');
  });
  it('finds my next pick from the API list', () => {
    expect(myNextPick(makeSession({ mySlot: 5, currentPick: 30 }))).toBe(33);
    expect(myNextPick(makeSession({ mySlot: 5, currentPick: 33 }))).toBe(33);
    expect(myNextPick(makeSession({ mySlot: 5, currentPick: null }))).toBeNull();
  });
});
