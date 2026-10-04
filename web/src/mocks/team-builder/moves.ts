import type { Move, MovesResponse } from '../../api/season';
import { MISSING_INPUTS, WEEK_DATES, band, conf, playableWeek, est, prov, toPlayoffWeek } from '../foundations/seasonCommon';
import { AS_OF, FREE_AGENTS, HALVORSEN_OUT, MINE } from '../foundations/seasonPlayers';

import { ACQ_FULL, ACQ_NORMAL, STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';

/** Invented recommended moves for the Moves planner. */

/* ------------------------------------------------------------------ moves */

const movesProv = [prov('optimizer', 'MILP, horizon Wed–Sun'), prov('simulate', 'Monte Carlo, 5,000 draws')];

export const MOVE_ADD_BRAMWELL: Move = {
  move_id: 'm-add-bramwell',
  rank: 1,
  kind: 'add_drop',
  player: FREE_AGENTS.bramwell,
  counterpart: MINE.venhaus,
  slot: 'C',
  dates: ['2026-11-19', '2026-11-21', '2026-11-22'],
  delta_p_win: est(0.046, 0.016, 0.019, 0.072),
  p_win_after: 0.566,
  delta_expected_cats: 0.21,
  cat_deltas: [
    { key: 'blk', delta_p: 0.11, p_after: 0.6 },
    { key: 'reb', delta_p: 0.06, p_after: 0.63 },
    { key: 'fg_pct', delta_p: 0.02, p_after: 0.64 },
    { key: 'fg3m', delta_p: -0.04, p_after: 0.6 },
  ],
  reason:
    'BLK is a coin flip (49%) and Bramwell has 3 games left to Venhaus’s 1: about +4.4 blocks and +20 rebounds over Thu–Sun.',
  details: [
    'Bramwell projects 1.6 BLK and 8.1 REB per game in 29.5 minutes (Thu, Sat, Sun).',
    'Venhaus plays tonight and Sunday only; drop him after tonight’s game.',
    'Uses acquisition 3 of 4. Bramwell is a free agent, so he can play Thursday.',
  ],
  confidence: conf('medium', 0.68, [MISSING_INPUTS.kalshiBlk]),
  deadline: { kind: 'add_before_game', at: '2026-11-19T20:00:00-05:00' },
  uses_acquisition: true,
  playable: playableWeek(2, [[3, '@MEM', true], [5, 'SAC', true], [6, '@DAL', true]], [0, 0, 0, 2, 1, 1, 2], [[2, 'MIL', true], [6, '@ATL', true]], [0, 0, 1, 3, 2, 2, 3], 2, 2, 3),
  depends_on: [],
  provenance: movesProv,
};

export const MOVE_START_PELLHAM: Move = {
  move_id: 'm-start-pellham',
  rank: 2,
  kind: 'start',
  player: MINE.pellham,
  counterpart: MINE.ferrante,
  slot: 'Util',
  dates: ['2026-11-18'],
  delta_p_win: est(0.021, 0.009, 0.006, 0.035),
  p_win_after: 0.541,
  delta_expected_cats: 0.08,
  cat_deltas: [
    { key: 'reb', delta_p: 0.04, p_after: 0.61 },
    { key: 'blk', delta_p: 0.03, p_after: 0.52 },
    { key: 'fg3m', delta_p: -0.02, p_after: 0.62 },
  ],
  reason:
    'Both play tonight. Pellham’s rebounds and blocks move two close categories; Ferrante’s threes go to one you already lead (64%).',
  details: ['Pellham: 9.4 REB, 1.3 BLK projected tonight vs a bottom-five rebounding team.', 'Ferrante: 2.8 3PTM projected.'],
  confidence: conf('high', 0.82),
  deadline: { kind: 'lineup_lock', at: '2026-11-18T20:00:00-05:00' },
  uses_acquisition: false,
  playable: null,
  depends_on: [],
  provenance: movesProv,
};

export const MOVE_ADD_NORTHCOTT: Move = {
  move_id: 'm-add-northcott',
  rank: 3,
  kind: 'add_drop',
  player: FREE_AGENTS.northcott,
  counterpart: MINE.talbridge,
  slot: 'PG',
  dates: ['2026-11-20', '2026-11-21', '2026-11-22'],
  delta_p_win: est(0.018, 0.017, -0.004, 0.04),
  p_win_after: 0.538,
  delta_expected_cats: 0.11,
  cat_deltas: [
    { key: 'ast', delta_p: 0.08, p_after: 0.47 },
    { key: 'stl', delta_p: 0.02, p_after: 0.66 },
    { key: 'reb', delta_p: -0.03, p_after: 0.54 },
  ],
  reason: 'AST is your weakest close category (39%). Northcott adds 6.8 assists a game over 3 games once he clears waivers Friday.',
  details: ['Talbridge has 2 games left and projects 1.9 AST per game.', 'Claim today; Yahoo waivers take 2 days.'],
  confidence: conf('medium', 0.6, [MISSING_INPUTS.waiverPriority]),
  deadline: { kind: 'waiver_clears', at: '2026-11-20T03:00:00-05:00' },
  uses_acquisition: true,
  playable: playableWeek(2, [[2, 'CHI', false], [4, '@NYK', true], [5, 'ORL', true], [6, 'PHI', true]], [0, 0, 0, 3, 2, 3, 4], [[4, 'MIN', true], [5, '@DET', true]], [0, 0, 0, 3, 2, 3, 4], 1, 1),
  depends_on: [],
  provenance: movesProv,
};

export const MOVE_BENCH_ROSSWELL: Move = {
  move_id: 'm-bench-rosswell',
  rank: 4,
  kind: 'bench',
  player: MINE.rosswell,
  counterpart: null,
  slot: 'PG',
  dates: ['2026-11-20'],
  delta_p_win: est(0.007, 0.011, -0.008, 0.021),
  p_win_after: 0.527,
  delta_expected_cats: 0.03,
  cat_deltas: [
    { key: 'tov', delta_p: 0.03, p_after: 0.42 },
    { key: 'fg_pct', delta_p: 0.01, p_after: 0.63 },
    { key: 'ast', delta_p: -0.02, p_after: 0.37 },
  ],
  reason: 'If he plays Friday it is under a 24-minute cap: 2.1 turnovers and 39% shooting for 4.4 assists. TO and FG% are worth more than the assists.',
  details: ['Questionable (hamstring), from a beat report; no official status yet.', 'Every other player with a Friday game still starts.'],
  confidence: conf('low', 0.41, [MISSING_INPUTS.statusUnconfirmed]),
  deadline: { kind: 'lineup_lock', at: '2026-11-20T19:30:00-05:00' },
  uses_acquisition: false,
  playable: null,
  depends_on: [],
  provenance: movesProv,
};

const OPTIMAL = {
  status: 'optimal' as const,
  message: null,
  solved_at: '2026-11-18T17:40:00-05:00',
  solve_ms: 1840,
  horizon: WEEK_DATES.slice(2),
  objective: 'p_win_week' as const,
};

export const movesNormal: MovesResponse = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: movesProv,
  baseline: { p_win_week: band(0.52, 0.45, 0.59), expected_cats: 4.57 },
  with_all: { p_win_week: band(0.63, 0.55, 0.7), expected_cats: 5.02, delta_vs_baseline: 0.11 },
  moves: [MOVE_ADD_BRAMWELL, MOVE_START_PELLHAM, MOVE_ADD_NORTHCOTT, MOVE_BENCH_ROSSWELL],
  acquisitions: ACQ_NORMAL,
  optimizer: OPTIMAL,
};

export const MOVE_START_PELLHAM_C: Move = {
  ...MOVE_START_PELLHAM,
  move_id: 'm-start-pellham-c',
  rank: 1,
  slot: 'C',
  counterpart: HALVORSEN_OUT,
  delta_p_win: est(0.053, 0.012, 0.038, 0.068),
  p_win_after: 0.523,
  cat_deltas: [
    { key: 'reb', delta_p: 0.06, p_after: 0.57 },
    { key: 'blk', delta_p: 0.04, p_after: 0.49 },
  ],
  reason: 'Halvorsen was ruled out at 5:31 pm. Pellham plays at 8:00 pm and takes his C slot: it wins back most of the REB and BLK you just lost.',
  details: ['Without a change, the C slot scores nothing tonight.', 'Pellham is eligible at C and PF.'],
  confidence: conf('high', 0.86),
};

export const movesInjury: MovesResponse = {
  ...movesNormal,
  as_of: '2026-11-18T17:34:00-05:00',
  baseline: { p_win_week: band(0.47, 0.4, 0.54), expected_cats: 4.41 },
  with_all: { p_win_week: band(0.6, 0.52, 0.67), expected_cats: 4.93, delta_vs_baseline: 0.13 },
  moves: [
    MOVE_START_PELLHAM_C,
    { ...MOVE_ADD_BRAMWELL, rank: 2, delta_p_win: est(0.041, 0.016, 0.015, 0.067), p_win_after: 0.511 },
    { ...MOVE_ADD_NORTHCOTT, rank: 3 },
  ],
};

export const movesLastDay: MovesResponse = {
  ...movesNormal,
  as_of: '2026-11-22T11:05:00-05:00',
  baseline: { p_win_week: band(0.55, 0.47, 0.62), expected_cats: 4.88 },
  with_all: { p_win_week: band(0.64, 0.57, 0.71), expected_cats: 5.09, delta_vs_baseline: 0.09 },
  optimizer: { ...OPTIMAL, horizon: ['2026-11-22'], solved_at: '2026-11-22T11:03:00-05:00', solve_ms: 310 },
  moves: [
    {
      ...MOVE_ADD_BRAMWELL,
      move_id: 'm-add-hargreave-sun',
      rank: 1,
      player: FREE_AGENTS.hargreave,
      counterpart: MINE.talbridge,
      slot: 'PF',
      dates: ['2026-11-22'],
      delta_p_win: est(0.061, 0.019, 0.037, 0.085),
      p_win_after: 0.611,
      cat_deltas: [
        { key: 'reb', delta_p: 0.14, p_after: 0.61 },
        { key: 'blk', delta_p: 0.03, p_after: 0.55 },
        { key: 'ft_pct', delta_p: -0.02, p_after: 0.1 },
      ],
      reason: 'REB is the swing category (47%, down 3). Hargreave plays at 3:30 pm and projects 9.2 rebounds; Talbridge has no game today.',
      playable: playableWeek(6, [[6, 'POR', true]], [0, 0, 0, 0, 0, 0, 4], [], [0, 0, 0, 0, 0, 0, 4], 1, 1),
      details: ['Free agent: adding him today lets him play today.', 'Uses acquisition 3 of 4; the count resets Monday.'],
      deadline: { kind: 'add_before_game', at: '2026-11-22T15:30:00-05:00' },
      confidence: conf('medium', 0.7),
    },
    {
      ...MOVE_BENCH_ROSSWELL,
      move_id: 'm-bench-venhaus-sun',
      rank: 2,
      player: MINE.venhaus,
      dates: ['2026-11-22'],
      slot: 'Util',
      delta_p_win: est(0.016, 0.008, 0.006, 0.026),
      p_win_after: 0.566,
      cat_deltas: [
        { key: 'fg_pct', delta_p: 0.05, p_after: 0.76 },
        { key: 'tov', delta_p: 0.03, p_after: 0.38 },
        { key: 'pts', delta_p: -0.02, p_after: 0.56 },
      ],
      reason: 'Protect FG%: you lead by .006 and Venhaus shoots 41% on 14 attempts. His points are worth less than the FG% edge.',
      details: ['PTS stays favored (56%) without him.'],
      deadline: { kind: 'lineup_lock', at: '2026-11-22T18:00:00-05:00' },
      confidence: conf('high', 0.8),
    },
  ],
};

export const movesPunt: MovesResponse = {
  ...movesNormal,
  baseline: { p_win_week: band(0.55, 0.48, 0.62), expected_cats: 4.57 },
  with_all: { p_win_week: band(0.66, 0.58, 0.73), expected_cats: 5.06, delta_vs_baseline: 0.11 },
  moves: [
    MOVE_ADD_BRAMWELL,
    {
      ...MOVE_ADD_NORTHCOTT,
      move_id: 'm-add-hargreave',
      rank: 2,
      player: FREE_AGENTS.hargreave,
      counterpart: MINE.talbridge,
      slot: 'PF',
      delta_p_win: est(0.029, 0.014, 0.011, 0.047),
      p_win_after: 0.579,
      cat_deltas: [
        { key: 'reb', delta_p: 0.07, p_after: 0.64 },
        { key: 'blk', delta_p: 0.03, p_after: 0.52 },
      ],
      reason: 'You punt FT%, so Hargreave’s 58% free-throw shooting costs nothing; his 9.2 rebounds a game swing REB.',
      playable: playableWeek(2, [[3, 'UTA', true], [4, '@LAC', false], [6, 'POR', true]], [0, 0, 0, 3, 0, 1, 2], [[4, 'MIN', true], [5, '@DET', true]], [0, 0, 0, 3, 0, 1, 2], 1, 0),
      details: ['Without the punt this move ranks 6th: the FT% hit is −4 pts.'],
      confidence: conf('medium', 0.66),
      deadline: { kind: 'add_before_game', at: '2026-11-19T20:00:00-05:00' },
    },
    { ...MOVE_START_PELLHAM, rank: 3 },
  ],
};

export const movesNoAcquisitions: MovesResponse = {
  ...movesNormal,
  acquisitions: ACQ_FULL,
  with_all: { p_win_week: band(0.55, 0.48, 0.62), expected_cats: 4.66, delta_vs_baseline: 0.03 },
  moves: [
    { ...MOVE_START_PELLHAM, rank: 1 },
    { ...MOVE_BENCH_ROSSWELL, rank: 2 },
  ],
};

export const movesNone: MovesResponse = {
  ...movesNormal,
  with_all: null,
  moves: [],
};

export const movesInfeasible: MovesResponse = {
  ...movesNormal,
  with_all: null,
  moves: [],
  optimizer: {
    ...OPTIMAL,
    status: 'infeasible',
    message: 'Your pending waiver claim would make 14 active-eligible players plus 1 IL over the roster limit. Drop one player before the claim clears.',
  },
};

export const movesStale: MovesResponse = { ...movesNormal, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };
export const movesPlayoff: MovesResponse = toPlayoffWeek(movesNormal);

