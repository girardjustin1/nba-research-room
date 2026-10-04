import type { Acquisitions, BreakingAlert, CategoryKey, CategoryLine, DayGames, TeamRef, WeekResponse, WinOutlook } from '../../api/season';
import { LAST_DAY_CONTEXT, MISSING_INPUTS, PLAYOFF_CONTEXT, PUNT_CONTEXT, SEASON_CATEGORIES, WEEK_DATES, WEEKDAYS, band, conf, est, prov, toPlayoffWeek, weekContext } from '../foundations/seasonCommon';
import { AS_OF, HALVORSEN_OUT, SOURCES } from '../foundations/seasonPlayers';

/** Invented matchup week. Every number is hand-set to realistic magnitudes. */

export const ME: TeamRef = { team_id: 11, name: 'Glass Cleaners', manager: 'You', record: '2-1', logo_url: null };
export const OPPONENT: TeamRef = { team_id: 6, name: 'Pick & Roll Call', manager: 'Sample Manager', record: '3-0', logo_url: null };
export const PLAYOFF_OPPONENT: TeamRef = { team_id: 3, name: 'Backdoor Cutters', manager: 'Sample Manager C', record: '13-6', logo_url: null };

const STALE_AS_OF = '2026-11-18T06:31:00-05:00';
const STALE_REASON = 'BallDontLie sync failed at 4:30 pm (HTTP 503). Projections and game counts are from Wed 6:31 am.';

type CatRow = [CategoryKey, number, number, [number, number], [number, number], number, boolean];
// key, mine to date, theirs to date, [mine final mean, sd], [theirs final mean, sd], p_win, swing
const NORMAL_CATS: CatRow[] = [
  ['fg_pct', 0.471, 0.462, [0.474, 0.011], [0.469, 0.012], 0.62, false],
  ['ft_pct', 0.768, 0.815, [0.786, 0.019], [0.8, 0.018], 0.3, false],
  ['fg3m', 24, 21, [83, 8], [79, 8], 0.64, false],
  ['pts', 158, 201, [701, 38], [697, 36], 0.53, true],
  ['reb', 61, 70, [276, 17], [272, 16], 0.57, true],
  ['ast', 34, 48, [162, 12], [167, 13], 0.39, true],
  ['stl', 10, 12, [45, 6], [42, 6], 0.64, false],
  ['blk', 6, 9, [32.8, 5], [33.1, 5], 0.49, true],
  ['tov', 19, 24, [79, 8], [76, 8], 0.39, false],
];

function catLines(rows: CatRow[], punts: CategoryKey[] = [], pOverride: Partial<Record<CategoryKey, number>> = {}): CategoryLine[] {
  return rows.map(([key, mt, tt, [mm, ms], [tm, ts], p, swing]) => ({
    key,
    mine_to_date: mt,
    theirs_to_date: tt,
    mine_final: est(mm, ms),
    theirs_final: est(tm, ts),
    p_win: pOverride[key] ?? p,
    punted: punts.includes(key),
    swing: swing && !punts.includes(key),
    // Fixture: who leads week-to-date (the engine sends this; TO = fewer leads).
    status_now: mt === tt ? 'tied' : (key === 'tov' ? mt < tt : mt > tt) ? 'winning' : 'losing',
    confidence: conf('medium', 0.71),
  }));
}

/** [league games, mine, theirs, mine usable, theirs usable, mine b2b, theirs b2b] per day. */
const DAYS: [number, number, number, number, number, number, number][] = [
  [8, 7, 8, 7, 8, 0, 1],
  [5, 3, 4, 3, 4, 0, 0],
  [11, 11, 7, 10, 7, 2, 1],
  [4, 4, 3, 4, 3, 1, 0],
  [9, 8, 8, 8, 8, 0, 2],
  [7, 7, 5, 7, 5, 3, 1],
  [5, 6, 4, 6, 4, 2, 1],
];

function dayGames(todayIndex: number): DayGames[] {
  return DAYS.map(([league, mine, theirs, mu, tu, mb, tb], i) => ({
    date: WEEK_DATES[i]!,
    weekday: WEEKDAYS[i]!,
    is_today: i === todayIndex,
    is_past: i < todayIndex,
    league_games: league,
    light_day: league <= 5,
    mine,
    theirs,
    mine_usable: mu,
    theirs_usable: tu,
    usable_edge: mu - tu,
    mine_b2b: mb,
    theirs_b2b: tb,
  }));
}

function sumFrom(days: DayGames[], key: 'mine' | 'theirs' | 'mine_usable' | 'theirs_usable', past: boolean) {
  return days.filter((d) => d.is_past === past).reduce((s, d) => s + d[key], 0);
}

function games(todayIndex: number) {
  const days = dayGames(todayIndex);
  return {
    mine_played: sumFrom(days, 'mine', true),
    theirs_played: sumFrom(days, 'theirs', true),
    mine_remaining: sumFrom(days, 'mine', false),
    theirs_remaining: sumFrom(days, 'theirs', false),
    mine_usable_remaining: sumFrom(days, 'mine_usable', false),
    theirs_usable_remaining: sumFrom(days, 'theirs_usable', false),
    days,
    provenance: prov('schedule', 'optimizer fills active slots by day'),
  };
}

function outlook(
  p: number,
  lo: number,
  hi: number,
  cats: number,
  catsSd: number,
  level: 'high' | 'medium' | 'low' = 'medium',
  delta: number | null = null,
): WinOutlook {
  return {
    p_win_week: band(p, lo, hi),
    delta_vs_baseline: delta,
    expected_cats: est(cats, catsSd),
    method: 'monte_carlo',
    draws: 5000,
    provenance: prov('simulate', 'Monte Carlo, 5,000 draws; Kalshi CDFs where liquid'),
    confidence: conf(level, level === 'high' ? 0.84 : 0.7, level === 'low' ? [MISSING_INPUTS.statusUnconfirmed] : []),
  };
}

export const ACQ_NORMAL: Acquisitions = { used: 2, max: 4, pending: 0, resets_on: '2026-11-23' };
export const ACQ_FULL: Acquisitions = { used: 4, max: 4, pending: 0, resets_on: '2026-11-23' };

/* ------------------------------------------------------------------- week */

export const ALERT_HALVORSEN: BreakingAlert = {
  id: 'alert-halvorsen',
  at: '2026-11-18T17:31:00-05:00',
  player: HALVORSEN_OUT,
  headline: 'Soren Halvorsen ruled out tonight (right ankle)',
  source: SOURCES.teamPR('OKC'),
  feed_item_id: 'f-news-halvorsen',
  impact: {
    delta_p_win: -0.052,
    cat_deltas: [
      { key: 'reb', delta_p: -0.06, p_after: 0.51 },
      { key: 'blk', delta_p: -0.04, p_after: 0.45 },
    ],
    summary: 'P(win week) −5.2 pts: REB −6 pts, BLK −4 pts.',
    suggestion: 'Start Isaac Pellham at C tonight (8:00 pm tip).',
    move_id: 'm-start-pellham-c',
    severity: 'high',
    confidence: conf('high', 0.9),
    computed_at: '2026-11-18T17:33:00-05:00',
  },
};

export const weekNormal: WeekResponse = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('simulate'), prov('yahoo', 'matchup snapshot 5:15 pm'), prov('schedule')],
  week: weekContext(),
  me: ME,
  opponent: OPPONENT,
  baseline: outlook(0.52, 0.45, 0.59, 4.57, 1.47),
  with_moves: outlook(0.63, 0.55, 0.7, 5.02, 1.42, 'medium', 0.11),
  categories: catLines(NORMAL_CATS),
  games: games(2),
  acquisitions: ACQ_NORMAL,
  alerts: [],
};

export const weekInjury: WeekResponse = {
  ...weekNormal,
  as_of: '2026-11-18T17:34:00-05:00',
  baseline: outlook(0.47, 0.4, 0.54, 4.41, 1.48),
  with_moves: outlook(0.6, 0.52, 0.67, 4.93, 1.44, 'medium', 0.13),
  categories: catLines(NORMAL_CATS, [], { reb: 0.51, blk: 0.45 }),
  alerts: [ALERT_HALVORSEN],
};

const LAST_DAY_CATS: CatRow[] = [
  ['fg_pct', 0.477, 0.471, [0.476, 0.004], [0.471, 0.004], 0.71, true],
  ['ft_pct', 0.774, 0.812, [0.776, 0.006], [0.811, 0.006], 0.12, false],
  ['fg3m', 74, 61, [83, 3], [70, 3], 0.93, false],
  ['pts', 602, 586, [706, 18], [688, 17], 0.58, true],
  ['reb', 238, 241, [276, 8], [279, 8], 0.47, true],
  ['ast', 131, 152, [149, 5], [171, 5], 0.08, false],
  ['stl', 39, 33, [45, 3], [39, 3], 0.81, false],
  ['blk', 27, 27, [31, 2.4], [31, 2.3], 0.52, true],
  ['tov', 69, 63, [79, 4], [75, 3.5], 0.35, true],
];

export const weekLastDay: WeekResponse = {
  ...weekNormal,
  as_of: '2026-11-22T11:05:00-05:00',
  week: LAST_DAY_CONTEXT,
  baseline: outlook(0.55, 0.47, 0.62, 4.88, 1.2, 'high'),
  with_moves: outlook(0.64, 0.57, 0.71, 5.09, 1.15, 'high', 0.09),
  categories: catLines(LAST_DAY_CATS),
  games: games(6),
};

export const weekPunt: WeekResponse = {
  ...weekNormal,
  week: PUNT_CONTEXT,
  baseline: outlook(0.55, 0.48, 0.62, 4.57, 1.47),
  with_moves: outlook(0.66, 0.58, 0.73, 5.06, 1.4, 'medium', 0.11),
  categories: catLines(NORMAL_CATS, ['ft_pct']),
};

export const weekPlayoff: WeekResponse = toPlayoffWeek({
  ...weekNormal,
  week: PLAYOFF_CONTEXT,
  me: { ...ME, record: '12-7' },
  opponent: PLAYOFF_OPPONENT,
});
export const weekPlayoffContext = PLAYOFF_CONTEXT;

export const weekStale: WeekResponse = { ...weekNormal, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };

export const weekNoAcquisitions: WeekResponse = { ...weekNormal, acquisitions: ACQ_FULL };

export { SEASON_CATEGORIES, STALE_AS_OF, STALE_REASON };
