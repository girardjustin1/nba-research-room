import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ApiUnreachableError } from '../api/client';
import { createSeasonApi } from '../api/season';
import { renderWithTheme } from '../test/render';
import { calendarBramwell, calendarRosswellInjury } from '../mocks/player-profiles/calendar';
import { teamWeeks } from '../mocks/team-profiles/schedule';
import { notificationsNormal } from '../mocks/notifications/notifications';
import { lineupNormal } from '../mocks/team-builder/lineup';
import { calendarToHeatDays, metricValue } from './player-profiles/calendarAdapter';
import { PlayerHeatCalendar } from './player-profiles/PlayerHeatCalendar';
import { filterInbox } from './notifications/inboxFilter';
import { LineupScreen } from './team-builder/LineupScreen';
import { median, scheduleWindows, sortTeamsByGames } from './team-player-analysis/scheduleWindows';
import { parseSeasonHash } from '../seasonRoutes';

describe('calendar adapter', () => {
  it('reads the metric from the right field and projections for future days', () => {
    const pts = calendarBramwell.metric_options.find((o) => o.key === 'pts')!;
    const value = calendarBramwell.metric_options.find((o) => o.key === 'value')!;
    const played = calendarBramwell.days.find((d) => d.state === 'played')!;
    const future = calendarBramwell.days.find((d) => d.state === 'scheduled')!;
    expect(metricValue(played, pts)).toBe(played.stats?.pts);
    expect(metricValue(played, value)).toBe(played.value);
    expect(metricValue(future, pts)).toBe(future.projected?.pts?.mean);
    expect(metricValue(calendarBramwell.days.find((d) => d.state === 'no_game')!, pts)).toBeNull();
  });
  it('colors missed games from my side: red for mine, green for an opponent’s', () => {
    const mine = calendarToHeatDays(calendarRosswellInjury, 'value', 4, 'mine').find((d) => d.state === 'out')!;
    const theirs = calendarToHeatDays(calendarRosswellInjury, 'value', 4, 'opponent').find((d) => d.state === 'out')!;
    expect(mine.effect).toBe(-1);
    expect(theirs.effect).toBe(1);
    expect(mine.sheet.sections[0]!.heading).toBe('Out');
  });
});

describe('schedule windows', () => {
  it('groups weeks by start month, adds the playoffs, sorts teams by games', () => {
    const w = scheduleWindows(teamWeeks.weeks);
    expect(w[0]!.label).toBe('Oct');
    expect(w[0]!.weeks[0]!.n_days).toBe(14);
    expect(w.at(-1)!.key).toBe('playoffs');
    expect(w.at(-1)!.weeks.map((x) => x.week)).toEqual([20, 21, 22]);
    const sorted = sortTeamsByGames(teamWeeks.teams, w[1]!.weeks);
    expect(sorted).toHaveLength(30);
    expect(sorted[0]!.sum).toBeGreaterThanOrEqual(sorted.at(-1)!.sum);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('inbox', () => {
  it('sorts by priority then newest, and filters unread', () => {
    const all = filterInbox(notificationsNormal.items, 'all');
    expect(all[0]!.priority).toBe('urgent');
    expect(filterInbox(notificationsNormal.items, 'unread').every((n) => !n.read)).toBe(true);
    expect(filterInbox(notificationsNormal.items, 'injury').every((n) => n.kind === 'injury' || n.kind === 'news')).toBe(true);
  });
});

describe('routes', () => {
  it('parses season hashes with a Lineup fallback', () => {
    expect(parseSeasonHash('#/season/builder/lineup')).toEqual({ tab: 'builder', view: 'lineup' });
    expect(parseSeasonHash('#/season/builder/moves')).toEqual({ tab: 'builder', view: 'moves' });
    expect(parseSeasonHash('#/season/matchup')).toEqual({ tab: 'matchup', view: null });
    expect(parseSeasonHash('#/season/nonsense')).toEqual({ tab: 'builder', view: 'lineup' });
  });
});

describe('season client', () => {
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  it('turns a 409 into an ApiError with the engine’s next step', async () => {
    const api = createSeasonApi('/api', () => json(409, { detail: 'No projections yet: run `make nightly`.' }));
    await expect(api.lineup()).rejects.toMatchObject({ status: 409, message: 'No projections yet: run `make nightly`.' });
  });
  it('treats a failed fetch as unreachable, and passes query params', async () => {
    const down = createSeasonApi('/api', () => Promise.reject(new TypeError('fetch failed')));
    await expect(down.lineup()).rejects.toBeInstanceOf(ApiUnreachableError);
    const seen: string[] = [];
    const ok = createSeasonApi('/api', (url) => {
      seen.push(url);
      return json(200, { team: 'DEN', days: [] });
    });
    await ok.teamDays('DEN', '2026-11-16', '2026-11-22');
    expect(seen[0]).toBe('/api/schedule/team_days?team=DEN&start=2026-11-16&end=2026-11-22');
    expect(new ApiError(404, 'Not Found').isNotFound).toBe(true);
  });
});

describe('LineupScreen', () => {
  it('shows the engine’s next step on a 409', () => {
    const onRetry = vi.fn();
    renderWithTheme(<LineupScreen lineup={null} notReady="No Yahoo roster yet: save roster.csv to data/inbox and run `make inbox`." onRetry={onRetry} />);
    expect(screen.getByText(/save roster.csv/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('lists today’s slots and marks changes', () => {
    renderWithTheme(<LineupScreen lineup={lineupNormal} />);
    expect(screen.getAllByText('Change').length).toBeGreaterThan(0);
    expect(screen.getByRole('grid', { name: 'Lineup by day' })).toBeInTheDocument();
  });
});

describe('PlayerHeatCalendar', () => {
  it('shows dates only in cells and opens a sheet on tap', () => {
    renderWithTheme(<PlayerHeatCalendar calendar={calendarBramwell} currentWeek={4} />);
    const grid = screen.getByRole('grid');
    const cells = within(grid).getAllByRole('gridcell');
    expect(cells).toHaveLength(7);
    expect(cells[3]!.textContent).toContain('19');
    expect(cells[3]!.textContent).not.toMatch(/[+−~]\d/);
    fireEvent.click(cells[3]!);
    expect(screen.getByRole('heading', { name: /Thu Nov 19/ })).toBeInTheDocument();
    expect(screen.getByText(/mean ± sd/)).toBeInTheDocument();
  });
  it('switches to the table view for accessibility', () => {
    renderWithTheme(<PlayerHeatCalendar calendar={calendarBramwell} currentWeek={4} initialDisplay="table" />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('league midnight and scenario plan', () => {
  it('finds 00:00 Eastern in both EST and EDT', async () => {
    const { etMidnightMs } = await import('./foundations/seasonFormat');
    expect(new Date(etMidnightMs('2026-11-16')).toISOString()).toBe('2026-11-16T05:00:00.000Z');
    expect(new Date(etMidnightMs('2027-03-15')).toISOString()).toBe('2027-03-15T04:00:00.000Z');
  });
  it('the mock engine rejects plans over the acquisition cap and flags incompatible adds', async () => {
    const { mockScenarioEngine, probNormal } = await import('../mocks/matchup-analysis/probability');
    const { movesNormal } = await import('../mocks/team-builder/moves');
    const acq = { used: 3, max: 4, pending: 0, resets_on: '2026-11-23' };
    const both = mockScenarioEngine(probNormal, movesNormal.moves, ['m-add-bramwell', 'm-add-northcott'], acq);
    expect(both.feasible).toBe(false);
    expect(both.message).toBe('Uses 5 of 4 acquisitions');
    const one = mockScenarioEngine(probNormal, movesNormal.moves, ['m-add-bramwell'], acq);
    expect(one.feasible).toBe(true);
    expect(one.incompatible.map((x) => x.move_id)).toEqual(['m-add-northcott']);
  });
});
