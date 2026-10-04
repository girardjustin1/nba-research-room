import type { CalendarDay, CalendarMetric, CalendarMetricOption, CategoryKey, IsoDate, PlayerCalendarResponse } from '../../api/season';
import { conf, prov, seeded } from '../foundations/seasonCommon';
import { AS_OF } from '../foundations/seasonPlayers';

import { weekOfDate } from '../team-profiles/schedule';

/**
 * Invented game logs, projections and schedules for the heat calendar and the schedule
 * views. Seeded, deterministic. The schedule *shapes* mirror the implemented
 * /schedule/team_weeks and /schedule/team_days endpoints, but every count here is made up.
 */

const r1 = (v: number) => Math.round(v * 10) / 10;

export const CALENDAR_METRICS: CalendarMetricOption[] = [
  { key: 'value', label: 'Value', signed: true, field: 'value', higher_is_better: true, domain: { min: -4, max: 4 } },
  { key: 'pts', label: 'PTS', signed: false, field: 'stat', higher_is_better: true, domain: { min: 0, max: 25 } },
  { key: 'reb', label: 'REB', signed: false, field: 'stat', higher_is_better: true, domain: { min: 0, max: 15 } },
  { key: 'ast', label: 'AST', signed: false, field: 'stat', higher_is_better: true, domain: { min: 0, max: 8 } },
  { key: 'stl', label: 'ST', signed: false, field: 'stat', higher_is_better: true, domain: { min: 0, max: 3 } },
  { key: 'blk', label: 'BLK', signed: false, field: 'stat', higher_is_better: true, domain: { min: 0, max: 4 } },
  { key: 'fg3m', label: '3PTM', signed: false, field: 'stat', higher_is_better: true, domain: { min: 0, max: 4 } },
  { key: 'tov', label: 'TO', signed: false, field: 'stat', higher_is_better: false, domain: { min: 0, max: 5 } },
  { key: 'fg_pct', label: 'FG% impact', signed: true, field: 'z', higher_is_better: true, domain: { min: -2, max: 2 } },
  { key: 'ft_pct', label: 'FT% impact', signed: true, field: 'z', higher_is_better: true, domain: { min: -2, max: 2 } },
];

interface Profile {
  seed: number;
  /** Per-game means: pts, reb, ast, stl, blk, fg3m, tov, fga, fg%, fta, ft%, minutes. */
  base: { pts: number; reb: number; ast: number; stl: number; blk: number; fg3m: number; tov: number; fga: number; fgp: number; fta: number; ftp: number; min: number };
  sd: Partial<Record<CalendarMetric, number>>;
  team: string;
}

const LEAGUE = { pts: [14, 6], reb: [5.5, 3], ast: [3.2, 2.2], stl: [1, 0.7], blk: [0.6, 0.6], fg3m: [1.6, 1.2], tov: [1.7, 1.1] } as const;
const OPPS = ['MEM', 'SAC', 'DAL', 'LAC', 'SAS', 'HOU', 'PHX', 'UTA', 'OKC', 'MIA', 'CHA', 'ATL', 'MIL', 'BOS', 'DEN', 'POR', 'MIN'];

interface DaySpec {
  games: number[];
  out?: number[];
  dnp?: number[];
  light?: number[];
  cup?: number[];
  playoffsFrom?: IsoDate | null;
  notes?: Record<number, string>;
  playProb?: Record<number, number>;
}

function buildDays(month: string, today: IsoDate, p: Profile, spec: DaySpec, weekOf: (d: IsoDate) => number | null): CalendarDay[] {
  const rnd = seeded(p.seed);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: CalendarDay[] = [];
  for (let day = 1; day <= last; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const hasGame = spec.games.includes(day);
    const opp = OPPS[(day * 7 + p.seed) % OPPS.length]!;
    const home = (day + p.seed) % 2 === 0;
    const b2b = hasGame && spec.games.includes(day - 1);
    const future = date > today;
    const base = {
      date,
      opponent: hasGame ? opp : null,
      home: hasGame ? home : null,
      tip_at: hasGame ? `${date}T${future ? '19:30' : '20:00'}:00-05:00` : null,
      light_day: !!spec.light?.includes(day),
      back_to_back: b2b,
      cup_or_playoff_week: spec.playoffsFrom && date >= spec.playoffsFrom ? ('playoffs' as const) : spec.cup?.includes(day) ? ('nba_cup' as const) : null,
      week: weekOf(date),
      play_prob: null as number | null,
      status_note: spec.notes?.[day] ?? null,
      opp_context: hasGame ? { pace_rank: ((day * 11 + p.seed) % 30) + 1, def_rank: ((day * 7 + p.seed * 3) % 30) + 1 } : null,
      my_open_slots: hasGame && future ? [2, 1, 0, 3, 2, 1, 2][(day + p.seed) % 7]! : null,
      notes: [] as string[],
    };
    if (!hasGame) {
      out.push({ ...base, state: 'no_game', minutes: null, stats: null, value: null, z: null, projected: null, source: prov('bdl', 'schedule'), confidence: conf('high', null) });
      continue;
    }
    if (spec.out?.includes(day)) {
      out.push({
        ...base,
        state: 'out',
        minutes: null,
        stats: null,
        value: null,
        z: null,
        projected: null,
        play_prob: future ? 0 : null,
        notes: ['A missed game: he scores nothing in any category that day.'],
        source: prov('overrides', 'injury report'),
        confidence: conf('high', null),
      });
      continue;
    }
    if (spec.dnp?.includes(day) && !future) {
      out.push({ ...base, state: 'dnp', minutes: 0, stats: null, value: null, z: null, projected: null, source: prov('bdl', 'box score'), confidence: conf('high', null) });
      continue;
    }
    if (future) {
      const b = p.base;
      const pp = spec.playProb?.[day] ?? 0.97;
      out.push({
        ...base,
        state: 'scheduled',
        minutes: null,
        stats: null,
        value: null,
        z: null,
        play_prob: pp,
        projected: {
          value: { mean: r1(1.1 + (rnd() - 0.5) * 0.6), sd: 2.6 },
          pts: { mean: r1(b.pts + (rnd() - 0.5)), sd: p.sd.pts ?? 4.4 },
          reb: { mean: r1(b.reb + (rnd() - 0.5) * 0.6), sd: p.sd.reb ?? 2.9 },
          ast: { mean: r1(b.ast), sd: p.sd.ast ?? 1.1 },
          stl: { mean: r1(b.stl), sd: 0.8 },
          blk: { mean: r1(b.blk), sd: 1.2 },
          fg3m: { mean: r1(b.fg3m), sd: 0.5 },
          tov: { mean: r1(b.tov), sd: 1.0 },
          fg_pct: { mean: 0.6, sd: 0.9 },
          ft_pct: { mean: -0.2, sd: 0.5 },
        },
        notes: [
          ...(base.back_to_back ? ['Second night of a back-to-back: the minutes model trims about 1 minute.'] : []),
          ...(base.light_day ? ['Light day: fewer teams compete for streaming slots, so his game is easier to use.'] : []),
        ],
        source: prov('projections', 'ensemble, mean and sd'),
        confidence: pp < 0.8 ? conf('low', 0.42, [{ key: 'status', label: 'Status not confirmed', effect: `P(plays) ${Math.round(pp * 100)}%` }]) : conf('medium', 0.7),
      });
      continue;
    }
    const b = p.base;
    const minutes = Math.max(8, Math.round(b.min + (rnd() - 0.5) * 10));
    const scale = minutes / b.min;
    const stat = (mean: number, spread: number) => Math.max(0, Math.round(mean * scale + (rnd() - 0.5) * spread));
    const fga = stat(b.fga, 6);
    const fgm = Math.min(fga, Math.round(fga * (b.fgp + (rnd() - 0.5) * 0.25)));
    const fta = stat(b.fta, 3);
    const ftm = Math.min(fta, Math.round(fta * (b.ftp + (rnd() - 0.5) * 0.3)));
    const fg3m = stat(b.fg3m, 2);
    const s = {
      pts: 2 * fgm + fg3m + ftm,
      reb: stat(b.reb, 6),
      ast: stat(b.ast, 3),
      stl: stat(b.stl, 2),
      blk: stat(b.blk, 3),
      fg3m,
      tov: stat(b.tov, 2.5),
      fgm,
      fga,
      ftm,
      fta,
    };
    const zc = (k: keyof typeof LEAGUE, v: number) => r1((v - LEAGUE[k][0]) / LEAGUE[k][1]);
    const z: Partial<Record<CategoryKey, number>> = {
      pts: zc('pts', s.pts),
      reb: zc('reb', s.reb),
      ast: zc('ast', s.ast),
      stl: zc('stl', s.stl),
      blk: zc('blk', s.blk),
      fg3m: zc('fg3m', s.fg3m),
      tov: r1(-(s.tov - LEAGUE.tov[0]) / LEAGUE.tov[1]),
      fg_pct: r1((fgm - 0.47 * fga) / 1.5),
      ft_pct: r1((ftm - 0.78 * fta) / 1.0),
    };
    const value = r1(Object.values(z).reduce((a, v) => a + (v ?? 0), 0));
    out.push({ ...base, state: 'played', minutes, stats: s, value, z, projected: null, source: prov('bdl', 'game_logs'), confidence: conf('high', null) });
  }
  return out;
}

/* ----------------------------------------------------------- player calendars */

const BRAMWELL: Profile = {
  seed: 31,
  team: 'NOP',
  base: { pts: 11.5, reb: 7.8, ast: 1.4, stl: 0.7, blk: 1.6, fg3m: 0.3, tov: 1.3, fga: 9, fgp: 0.56, fta: 3, ftp: 0.64, min: 27 },
  sd: { pts: 4.4, reb: 2.9 },
};

const NOV_GAMES = [1, 3, 5, 6, 8, 10, 12, 13, 15, 17, 19, 21, 22, 24, 26, 28, 29];
const NOV_LIGHT = [5, 12, 17, 19, 22, 26];
const NOV_CUP = [3, 6, 10, 13, 17, 20, 24, 27];

function envelope(days: CalendarDay[], from: IsoDate, to: IsoDate, today: IsoDate, playerId: number, gamesLeft: number): PlayerCalendarResponse {
  return {
    as_of: AS_OF,
    stale: false,
    stale_reason: null,
    provenance: [prov('bdl', 'game_logs (played days)'), prov('projections', 'future days, mean and sd'), prov('overrides', 'out / DNP states')],
    player_id: playerId,
    from,
    to,
    today,
    metric_options: CALENDAR_METRICS,
    days,
    games_left_this_week: gamesLeft,
  };
}

export const calendarBramwell = envelope(
  buildDays('2026-11', '2026-11-18', BRAMWELL, { games: NOV_GAMES, dnp: [6], light: NOV_LIGHT, cup: NOV_CUP, notes: { 6: 'Coach’s decision (rest), team played' } }, weekOfDate),
  '2026-11-01',
  '2026-11-30',
  '2026-11-18',
  300,
  3,
);

const ROSSWELL: Profile = {
  seed: 9,
  team: 'BKN',
  base: { pts: 15.5, reb: 3.4, ast: 6.1, stl: 1.2, blk: 0.2, fg3m: 2.1, tov: 2.4, fga: 13, fgp: 0.43, fta: 3.4, ftp: 0.84, min: 30 },
  sd: { pts: 5.2, ast: 2.1 },
};

/** Injury stretch: out Nov 7–14, back on a minutes limit, questionable Friday. */
export const calendarRosswellInjury = envelope(
  buildDays(
    '2026-11',
    '2026-11-18',
    ROSSWELL,
    {
      games: [2, 4, 6, 7, 9, 11, 13, 14, 16, 19, 20, 22, 24, 25, 27, 29],
      out: [7, 9, 11, 13, 14],
      light: NOV_LIGHT,
      cup: NOV_CUP,
      notes: { 7: 'Left hamstring strain (team PR)', 9: 'Out, hamstring', 11: 'Out, hamstring', 13: 'Out, hamstring', 14: 'Out, hamstring' },
      playProb: { 20: 0.55 },
    },
    weekOfDate,
  ),
  '2026-11-01',
  '2026-11-30',
  '2026-11-18',
  109,
  3,
);

/** A back-to-back-heavy week (Nov 16–22 for a different invented player). */
export const calendarB2BWeek = envelope(
  buildDays('2026-11', '2026-11-18', { ...BRAMWELL, seed: 57 }, { games: [3, 4, 9, 10, 13, 14, 16, 17, 19, 20, 22, 23, 27, 28], light: NOV_LIGHT, cup: NOV_CUP }, weekOfDate),
  '2026-11-01',
  '2026-11-30',
  '2026-11-18',
  300,
  3,
);

/** Playoff month (March 2027): weeks 20–22 start Mar 15. */
export const calendarPlayoffs = envelope(
  buildDays('2027-03', '2027-03-17', { ...BRAMWELL, seed: 77 }, { games: [1, 3, 5, 7, 8, 10, 12, 14, 16, 17, 19, 21, 23, 25, 26, 28, 30], light: [5, 16, 26], playoffsFrom: '2027-03-15' }, weekOfDate),
  '2027-03-01',
  '2027-03-31',
  '2027-03-17',
  300,
  3,
);

/** Nothing in range (e.g. a player signed today). */
export const calendarEmpty: PlayerCalendarResponse = { ...calendarBramwell, days: [], games_left_this_week: 0 };

