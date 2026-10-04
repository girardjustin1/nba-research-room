import type {
  CategoryKey,
  Confidence,
  Estimate,
  IsoDate,
  MissingInput,
  PlayableDay,
  PlayableWeek,
  ProbBand,
  Provenance,
  SeasonCategory,
  WeekContext,
} from '../../api/season';
import { AS_OF } from './seasonPlayers';

/** Invented, deterministic helpers shared by the season mocks. */

export const SEASON_CATEGORIES: SeasonCategory[] = [
  { key: 'fg_pct', label: 'FG%', higher_is_better: true, is_ratio: true },
  { key: 'ft_pct', label: 'FT%', higher_is_better: true, is_ratio: true },
  { key: 'fg3m', label: '3PTM', higher_is_better: true, is_ratio: false },
  { key: 'pts', label: 'PTS', higher_is_better: true, is_ratio: false },
  { key: 'reb', label: 'REB', higher_is_better: true, is_ratio: false },
  { key: 'ast', label: 'AST', higher_is_better: true, is_ratio: false },
  { key: 'stl', label: 'ST', higher_is_better: true, is_ratio: false },
  { key: 'blk', label: 'BLK', higher_is_better: true, is_ratio: false },
  { key: 'tov', label: 'TO', higher_is_better: false, is_ratio: false },
];

export const WEEK_DATES: IsoDate[] = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TODAY: IsoDate = '2026-11-18';
export const LAST_DAY: IsoDate = '2026-11-22';

/** Band at 80% coverage. The engine supplies lo/hi; mocks set them by hand. */
export function est(mean: number, sd: number, lo?: number, hi?: number): Estimate {
  return { mean, sd, lo: lo ?? mean - 1.28 * sd, hi: hi ?? mean + 1.28 * sd, level: 0.8 };
}

export function band(p: number, lo: number, hi: number): ProbBand {
  return { p, lo, hi, level: 0.8 };
}

export function conf(level: Confidence['level'], score: number | null, missing: MissingInput[] = []): Confidence {
  return { level, score, missing };
}

export function prov(module: Provenance['module'], note: string | null = null, asOf = AS_OF): Provenance {
  return { module, as_of: asOf, run_id: `run-${module}-1118a`, note };
}

export const MISSING_INPUTS = {
  kalshiBlk: { key: 'kalshi_blk', label: 'No liquid Kalshi BLK market for his next game', effect: 'Used normal(mean, sd) for BLK' },
  waiverPriority: {
    key: 'waiver_priority',
    label: 'Your waiver priority is not in the Yahoo snapshot',
    effect: 'The claim may lose to a team with higher priority',
  },
  statusUnconfirmed: {
    key: 'status_unconfirmed',
    label: 'Status not confirmed; the team usually reports about 90 minutes before tip',
    effect: 'P(plays) 55% from the beat report, not an official update',
  },
  oddsHistory: {
    key: 'odds_history',
    label: 'No spread or total for his games past Friday yet',
    effect: 'Saturday and Sunday games use pace only',
  },
  usageSample: {
    key: 'usage_sample',
    label: 'Only 6 games with this teammate out',
    effect: 'Usage bump shrunk toward zero',
  },
  noProps: { key: 'no_props', label: 'No prop markets listed for his games', effect: 'Market agreement not checked' },
} satisfies Record<string, MissingInput>;

export function weekContext(overrides: Partial<WeekContext> = {}): WeekContext {
  return {
    week: 4,
    label: 'Week 4',
    start: WEEK_DATES[0]!,
    end: WEEK_DATES[6]!,
    today: TODAY,
    days_left: 5,
    is_last_day: false,
    is_playoffs: false,
    playoff_round: null,
    punts: [],
    categories: SEASON_CATEGORIES,
    cats_to_win: 5,
    ...overrides,
  };
}

export const LAST_DAY_CONTEXT = weekContext({ today: LAST_DAY, days_left: 1, is_last_day: true });
export const PUNT_CONTEXT = weekContext({ punts: ['ft_pct'] as CategoryKey[] });

/**
 * Playoff variant: the same invented week moved to week 20 (Mar 15–21, 2027). Dates are
 * rewritten and Eastern offsets switch to daylight time; clock times stay the same.
 */
const PLAYOFF_DATE_MAP: Record<string, string> = Object.fromEntries(
  WEEK_DATES.map((d, i) => [d, `2027-03-${String(15 + i).padStart(2, '0')}`]),
);

export function toPlayoffWeek<T>(value: T): T {
  let json = JSON.stringify(value);
  for (const [from, to] of Object.entries(PLAYOFF_DATE_MAP)) json = json.split(from).join(to);
  json = json.split('2026-11-23').join('2027-03-22').split('-05:00').join('-04:00');
  const out = JSON.parse(json) as T;
  return out;
}

export const PLAYOFF_CONTEXT: WeekContext = toPlayoffWeek(
  weekContext({ week: 20, label: 'Week 20', is_playoffs: true, playoff_round: 'quarterfinal' }),
);

type GameSpec = [day: number, opp: string, playable: boolean];

function playableDays(todayIdx: number, games: GameSpec[], open: number[]): PlayableDay[] {
  return WEEK_DATES.map((date, i) => {
    const g = games.find((x) => x[0] === i);
    return {
      date,
      weekday: WEEKDAYS[i]!,
      is_past: i < todayIdx,
      has_game: !!g,
      opp_abbr: g ? g[1].replace(/^[@]/, '') : null,
      home: g ? !g[1].startsWith('@') : null,
      open_slots: open[i] ?? 0,
      playable: !!g && g[2] && i >= todayIdx,
    };
  });
}

/** Fixture: a move's week vs my open slots. Counts are hand-set like the engine's would be. */
export function playableWeek(
  todayIdx: number,
  add: GameSpec[],
  addOpen: number[],
  drop: GameSpec[] | null,
  dropOpen: number[],
  raw: number,
  playable: number,
  /** Day index the drop takes effect (e.g. after tonight's game); defaults to today. */
  dropEffective = todayIdx,
): PlayableWeek {
  return {
    add: playableDays(todayIdx, add, addOpen),
    drop: drop ? playableDays(dropEffective, drop, dropOpen) : null,
    raw_games_added: raw,
    playable_games_added: playable,
    provenance: prov('optimizer', 'open active slots by day, before the move'),
  };
}

/** Deterministic PRNG (mulberry32) so season fixtures render identically every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
