import type { CategoryKey, CategoryResult, ResultsResponse, StandingRow, TeamRef, WeekResult } from '../../api/season';
import { SEASON_CATEGORIES, band, conf, est, prov } from '../foundations/seasonCommon';
import { AS_OF } from '../foundations/seasonPlayers';
import { ME, OPPONENT, PLAYOFF_OPPONENT, STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';
import { SCOREBOARD } from '../results-analysis/scoreboard';

/** Invented past weeks, standings and backtest scoreboard. */

const team = (team_id: number, name: string, record: string): TeamRef => ({ team_id, name, manager: null, record, logo_url: null });

type Cat = [CategoryKey, number, number, number];
// key, mine, theirs, predicted p
function cats(rows: Cat[]): CategoryResult[] {
  return rows.map(([key, mine, theirs, predicted]) => {
    const lowerBetter = key === 'tov';
    const margin = lowerBetter ? theirs - mine : mine - theirs;
    const result: CategoryResult['result'] = Math.abs(margin) < 1e-9 ? 'tied' : margin > 0 ? 'won' : 'lost';
    return { key, mine, theirs, result, margin: Math.round(margin * 1000) / 1000, predicted_p: predicted };
  });
}

function tally(c: CategoryResult[]) {
  return {
    cats_won: c.filter((x) => x.result === 'won').length,
    cats_lost: c.filter((x) => x.result === 'lost').length,
    cats_tied: c.filter((x) => x.result === 'tied').length,
  };
}

function week(
  n: number,
  start: string,
  end: string,
  opponent: TeamRef,
  rows: Cat[],
  pWin: [number, number, number],
  expCats: number,
  moves: WeekResult['moves'],
  summary: string,
  brier: number,
  extra: Partial<WeekResult> = {},
): WeekResult {
  const categories = cats(rows);
  const t = tally(categories);
  return {
    week: n,
    label: `Week ${n}`,
    start,
    end,
    is_playoffs: false,
    playoff_round: null,
    opponent,
    outcome: t.cats_won > t.cats_lost ? 'win' : t.cats_won < t.cats_lost ? 'loss' : 'tie',
    ...t,
    categories,
    predicted: { as_of: `${start}T12:00:00-05:00`, p_win_week: band(...pWin), expected_cats: est(expCats, 1.45) },
    brier,
    favorite_hits: categories.filter((c) => c.predicted_p != null && c.predicted_p > 0.5 === (c.result === 'won')).length,
    moves,
    summary,
    provenance: [prov('yahoo', 'final matchup'), prov('backtest', 'replay with and without each move')],
    confidence: conf('high', 0.9),
    ...extra,
  };
}

const W3 = week(
  3,
  '2026-11-09',
  '2026-11-15',
  team(9, 'Pump Fake Pros', '1-2'),
  [
    ['fg_pct', 0.481, 0.468, 0.6],
    ['ft_pct', 0.771, 0.802, 0.34],
    ['fg3m', 88, 79, 0.63],
    ['pts', 734, 712, 0.5],
    ['reb', 281, 266, 0.55],
    ['ast', 160, 171, 0.41],
    ['stl', 47, 41, 0.62],
    ['blk', 29, 33, 0.47],
    ['tov', 78, 84, 0.44],
  ],
  [0.48, 0.41, 0.55],
  4.56,
  [
    {
      move_id: 'w3-add-sefton',
      kind: 'add_drop',
      title: 'Add Jonah Sefton, drop Ezra Everly',
      recommended_at: '2026-11-10T17:40:00-05:00',
      followed: 'yes',
      predicted_delta_p_win: 0.031,
      realized_delta_cats: 1,
      flipped: 'pts',
      realized_note: 'Without him you lose PTS by 9; with him you win it by 22.',
    },
    {
      move_id: 'w3-start-lindqvist',
      kind: 'start',
      title: 'Start Anders Lindqvist over Kofi Abernethy (Thu)',
      recommended_at: '2026-11-12T16:10:00-05:00',
      followed: 'yes',
      predicted_delta_p_win: 0.012,
      realized_delta_cats: 0,
      flipped: null,
      realized_note: '+4 REB, no category changed.',
    },
    {
      move_id: 'w3-bench-mulvane',
      kind: 'bench',
      title: 'Bench Dante Mulvane (Sun)',
      recommended_at: '2026-11-15T11:00:00-05:00',
      followed: 'no',
      predicted_delta_p_win: 0.008,
      realized_delta_cats: 0,
      flipped: null,
      realized_note: 'He shot 6 of 9; benching would not have changed a category.',
    },
  ],
  'Won 6–3 as a slight underdog (48%). The Sefton pickup flipped PTS.',
  0.198,
);

const W2 = week(
  2,
  '2026-11-02',
  '2026-11-08',
  team(4, 'Zone Defense Fund', '2-1'),
  [
    ['fg_pct', 0.462, 0.474, 0.58],
    ['ft_pct', 0.788, 0.796, 0.44],
    ['fg3m', 79, 83, 0.57],
    ['pts', 688, 701, 0.55],
    ['reb', 270, 262, 0.6],
    ['ast', 151, 168, 0.36],
    ['stl', 44, 45, 0.55],
    ['blk', 31, 26, 0.58],
    ['tov', 78, 79, 0.47],
  ],
  [0.61, 0.54, 0.68],
  5.2,
  [
    {
      move_id: 'w2-add-kingsmill',
      kind: 'add_drop',
      title: 'Add Aaron Kingsmill, drop Luc Delacroix',
      recommended_at: '2026-11-03T17:40:00-05:00',
      followed: 'partial',
      predicted_delta_p_win: 0.022,
      realized_delta_cats: null,
      flipped: null,
      realized_note: 'Added Wednesday, a day late; the replay cannot separate the missed game.',
    },
  ],
  'Lost 3–6 as a 61% favorite. Three categories went the other way by less than 1.5 sd: FG%, 3PTM, ST.',
  0.247,
);

const W1 = week(
  1,
  '2026-10-19',
  '2026-11-01',
  team(2, 'Fast Break Even', '0-3'),
  [
    ['fg_pct', 0.474, 0.461, 0.62],
    ['ft_pct', 0.79, 0.822, 0.33],
    ['fg3m', 161, 150, 0.6],
    ['pts', 1402, 1391, 0.53],
    ['reb', 549, 561, 0.48],
    ['ast', 309, 322, 0.42],
    ['stl', 88, 80, 0.61],
    ['blk', 61, 55, 0.56],
    ['tov', 160, 166, 0.45],
  ],
  [0.56, 0.49, 0.63],
  4.9,
  [],
  'Won 6–3 in the two-week opener; predictions matched in 7 of 9 categories.',
  0.205,
);

const STANDINGS: StandingRow[] = [
  { rank: 1, team: OPPONENT, wins: 3, losses: 0, ties: 0, is_me: false, games_back: null },
  { rank: 2, team: team(5, 'Bank Shot Bandits', '3-0'), wins: 3, losses: 0, ties: 0, is_me: false, games_back: 0 },
  { rank: 3, team: ME, wins: 2, losses: 1, ties: 0, is_me: true, games_back: 1 },
  { rank: 4, team: team(4, 'Zone Defense Fund', '2-1'), wins: 2, losses: 1, ties: 0, is_me: false, games_back: 1 },
  { rank: 5, team: PLAYOFF_OPPONENT, wins: 2, losses: 1, ties: 0, is_me: false, games_back: 1 },
  { rank: 6, team: team(7, 'Euro Step Society', '2-1'), wins: 2, losses: 1, ties: 0, is_me: false, games_back: 1 },
  { rank: 7, team: team(8, 'And-One Club', '2-1'), wins: 2, losses: 1, ties: 0, is_me: false, games_back: 1 },
  { rank: 8, team: team(9, 'Pump Fake Pros', '1-2'), wins: 1, losses: 2, ties: 0, is_me: false, games_back: 2 },
  { rank: 9, team: team(10, 'Box Out Brigade', '1-2'), wins: 1, losses: 2, ties: 0, is_me: false, games_back: 2 },
  { rank: 10, team: team(12, 'Hack-a-Squad', '1-2'), wins: 1, losses: 2, ties: 0, is_me: false, games_back: 2 },
  { rank: 11, team: team(13, 'Moving Screens', '1-2'), wins: 1, losses: 2, ties: 0, is_me: false, games_back: 2 },
  { rank: 12, team: team(14, 'Air Ball Alliance', '1-2'), wins: 1, losses: 2, ties: 0, is_me: false, games_back: 2 },
  { rank: 13, team: team(1, 'Shot Clock Violators', '0-3'), wins: 0, losses: 3, ties: 0, is_me: false, games_back: 3 },
  { rank: 14, team: team(2, 'Fast Break Even', '0-3'), wins: 0, losses: 3, ties: 0, is_me: false, games_back: 3 },
];

const base: Omit<ResultsResponse, 'weeks'> = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('yahoo', 'standings and final matchups'), prov('backtest')],
  record: { wins: 2, losses: 1, ties: 0 },
  standings: STANDINGS,
  my_rank: 3,
  playoff_spots: 6,
  regular_weeks_left: 16,
  scoreboard: SCOREBOARD,
  punts: [],
  categories: SEASON_CATEGORIES,
};

export const resultsNormal: ResultsResponse = { ...base, weeks: [W3, W2, W1] };
export const resultsStale: ResultsResponse = { ...resultsNormal, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };

export const resultsEmpty: ResultsResponse = {
  ...base,
  record: { wins: 0, losses: 0, ties: 0 },
  my_rank: 0,
  regular_weeks_left: 19,
  standings: [],
  weeks: [],
  scoreboard: {
    ...SCOREBOARD,
    scope_label: '2025-26 replay (preseason)',
    from_week: 1,
    to_week: 22,
    games_scored: 26_410,
    confidence: conf('medium', 0.6, [{ key: 'season', label: 'Last season’s replay, not this season', effect: 'Rosters and roles have changed' }]),
  },
};

export const resultsPunt: ResultsResponse = { ...resultsNormal, punts: ['ft_pct'] };

const W20: WeekResult = {
  ...W3,
  week: 20,
  label: 'Week 20',
  start: '2027-03-15',
  end: '2027-03-21',
  is_playoffs: true,
  playoff_round: 'quarterfinal',
  opponent: PLAYOFF_OPPONENT,
  predicted: { ...W3.predicted, as_of: '2027-03-15T12:00:00-04:00', p_win_week: band(0.57, 0.5, 0.64) },
  summary: 'Won the quarterfinal 6–3 as a 57% favorite. On to the semifinal.',
};

export const resultsPlayoff: ResultsResponse = {
  ...resultsNormal,
  as_of: '2027-03-22T08:00:00-04:00',
  record: { wins: 12, losses: 7, ties: 0 },
  my_rank: 3,
  regular_weeks_left: 0,
  standings: STANDINGS.map((s, i) => {
    const wins = [18, 15, 12, 12, 11, 10, 10, 9, 9, 8, 7, 6, 4, 3][i]!;
    const losses = 19 - wins;
    return { ...s, wins, losses, games_back: i === 0 ? null : 18 - wins, team: { ...s.team, record: `${wins}-${losses}` } };
  }),
  weeks: [W20, { ...W3, week: 19, label: 'Week 19', start: '2027-03-08', end: '2027-03-14' }, { ...W2, week: 18, label: 'Week 18', start: '2027-03-01', end: '2027-03-07' }],
  scoreboard: { ...SCOREBOARD, scope_label: 'Weeks 1–19, 2026-27', to_week: 19, games_scored: 24_310 },
};
