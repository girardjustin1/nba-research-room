import { describe, expect, it, vi } from 'vitest';
import { makeTeamDays, makeTeamWeeks } from '../mocks/draft/fixtures';
import { FOR_ME, forMeColor, forMeSymbol, forMeWord } from '../theme/viz';
import { monthTotals, scheduleTeam, teamDaysLoader, teamWeeksFor, weekLabel } from './schedule';

describe('schedule join', () => {
  it('maps Basketball Monster team codes to the schedule codes', () => {
    expect(scheduleTeam('NOR')).toBe('NOP');
    expect(scheduleTeam('PHO')).toBe('PHX');
    expect(scheduleTeam('den')).toBe('DEN');
    expect(scheduleTeam(null)).toBeNull();
    expect(teamWeeksFor('NOR', makeTeamWeeks())?.team).toBe('NOP');
    expect(teamWeeksFor('FA', makeTeamWeeks())).toBeNull();
  });
  it('labels two-week periods and counts games per month from the day list', () => {
    const weeks = makeTeamWeeks().weeks;
    expect(weekLabel(weeks[0]!)).toBe('1*');
    expect(weekLabel(weeks[1]!)).toBe('2');
    const days = makeTeamDays('DEN');
    const months = monthTotals(days);
    expect(months.reduce((a, m) => a + m.games, 0)).toBe(days.length);
    expect(months[0]?.month).toBe('Oct');
    expect(months.map((m) => m.key)).toEqual([...months.map((m) => m.key)].sort());
  });
  it('caches one team_days request per team and range', async () => {
    const getTeamDays = vi.fn(async (team: string) => ({ team, days: [] }));
    const load = teamDaysLoader({ getTeamDays });
    await load('DEN', '2026-10-19', '2027-04-04');
    await load('DEN', '2026-10-19', '2027-04-04');
    await load('NOP', '2026-10-19', '2027-04-04');
    expect(getTeamDays).toHaveBeenCalledTimes(2);
  });
});

describe('for-me colors', () => {
  const scale = { min: -3, max: 3 };
  it('is gray at zero and steps to the poles', () => {
    expect(forMeColor(0, scale, 'light')).toBe(FOR_ME.light.neutral);
    expect(forMeColor(null, scale, 'light')).toBe(FOR_ME.light.neutral);
    expect(forMeColor(3, scale, 'light')).toBe(FOR_ME.light.good);
    expect(forMeColor(-3, scale, 'dark')).toBe(FOR_ME.dark.bad);
    expect(forMeColor(1, scale, 'light')).toBe(FOR_ME.light.goodRamp[0]);
    expect(forMeColor(-2, scale, 'light')).toBe(FOR_ME.light.badRamp[1]);
    expect(forMeColor(99, scale, 'light')).toBe(FOR_ME.light.good);
    expect(forMeColor(0.01, { ...scale, deadband: 0.05 }, 'light')).toBe(FOR_ME.light.neutral);
  });
  it('always pairs color with a symbol and words', () => {
    expect([forMeSymbol(2), forMeSymbol(-1), forMeSymbol(0)]).toEqual(['▲', '▼', '●']);
    expect([forMeWord(2), forMeWord(-1), forMeWord(0)]).toEqual(['helps you', 'hurts you', 'no effect']);
  });
});
