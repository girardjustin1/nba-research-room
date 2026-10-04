import type { IsoDate, ScheduleWeek, TeamDaysResponse, TeamWeekCounts, TeamWeeksResponse } from '../../api/season';
import { seeded } from '../foundations/seasonCommon';

/** Invented fantasy weeks and NBA team schedules (shapes of the implemented /schedule/* endpoints; counts made up). */

const DAY = 86_400_000;
const add = (d: IsoDate, n: number): IsoDate => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const OPPS = ['MEM', 'SAC', 'DAL', 'LAC', 'SAS', 'HOU', 'PHX', 'UTA', 'OKC', 'MIA', 'CHA', 'ATL', 'MIL', 'BOS', 'DEN', 'POR', 'MIN'];

/* ---------------------------------------------------------- fantasy weeks */

export const SCHEDULE_WEEKS: ScheduleWeek[] = (() => {
  const weeks: ScheduleWeek[] = [{ week: 1, start: '2026-10-19', end: '2026-11-01', n_days: 14, is_playoff: false }];
  let start = '2026-11-02';
  for (let w = 2; w <= 22; w += 1) {
    const n = w === 17 ? 14 : 7;
    weeks.push({ week: w, start, end: add(start, n - 1), n_days: n, is_playoff: w >= 20 });
    start = add(start, n);
  }
  return weeks;
})();

export function weekOfDate(d: IsoDate): number | null {
  return SCHEDULE_WEEKS.find((w) => d >= w.start && d <= w.end)?.week ?? null;
}

/* --------------------------------------------------------------- schedules */

const TEAMS = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'];

/** NOP's next ~30 days (invented): Nov 18 – Dec 17, 2026. */
const NOP_GAMES: IsoDate[] = [
  '2026-11-19', '2026-11-21', '2026-11-22', '2026-11-24', '2026-11-26', '2026-11-28', '2026-11-29',
  '2026-12-01', '2026-12-03', '2026-12-05', '2026-12-06', '2026-12-08', '2026-12-12', '2026-12-14', '2026-12-16', '2026-12-17',
];
const LIGHT_DATES = new Set(['2026-11-19', '2026-11-22', '2026-11-26', '2026-12-03', '2026-12-08', '2026-12-14']);

export const teamDaysNOP: TeamDaysResponse = {
  team: 'NOP',
  days: NOP_GAMES.map((date, i) => ({
    date,
    opponent: OPPS[(i * 5) % OPPS.length]!,
    home: i % 2 === 0,
    back_to_back: NOP_GAMES.includes(add(date, -1)),
    light_day: LIGHT_DATES.has(date),
    week: weekOfDate(date) ?? 0,
  })),
};

function teamCounts(): TeamWeekCounts[] {
  const rnd = seeded(2027);
  return TEAMS.map((team) => {
    const games: Record<string, number> = {};
    const b2b: Record<string, number> = {};
    const light: Record<string, number> = {};
    for (const w of SCHEDULE_WEEKS) {
      let g: number;
      if (team === 'NOP' && w.week >= 4 && w.week <= 7) g = teamDaysNOP.days.filter((d) => d.week === w.week).length;
      else if (w.n_days === 14) g = 6 + Math.floor(rnd() * 3);
      else g = 2 + Math.floor(rnd() * 2.6);
      games[String(w.week)] = g;
      b2b[String(w.week)] = g >= 4 ? 1 + Math.floor(rnd() * 2) : Math.floor(rnd() * 1.4);
      light[String(w.week)] = Math.floor(rnd() * 1.6);
    }
    const total = Object.values(games).reduce((a, b) => a + b, 0);
    const playoff = SCHEDULE_WEEKS.filter((w) => w.is_playoff).reduce((a, w) => a + (games[String(w.week)] ?? 0), 0);
    return { team, games_by_week: games, b2b_by_week: b2b, light_day_games_by_week: light, total, playoff_games: playoff };
  });
}

export const teamWeeks: TeamWeeksResponse = {
  weeks: SCHEDULE_WEEKS,
  teams: teamCounts(),
  unscheduled_note: 'The NBA schedules 30 more games after the Cup group stage; December counts will rise.',
  source: 'Invented sample schedule (shape of /schedule/team_weeks)',
};
