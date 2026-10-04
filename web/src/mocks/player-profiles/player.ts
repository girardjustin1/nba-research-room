import type { CatEstimate, CategoryKey, DayPlan, Factor, FactorDetail, GameRef, PlayerAnalysisResponse } from '../../api/season';
import { MISSING_INPUTS, PUNT_CONTEXT, LAST_DAY_CONTEXT, PLAYOFF_CONTEXT, WEEK_DATES, WEEKDAYS, conf, est, prov, toPlayoffWeek, weekContext } from '../foundations/seasonCommon';
import { AS_OF, FREE_AGENTS, MINE, SOURCES } from '../foundations/seasonPlayers';
import { STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';

/** Invented player deep dives. Every number is hand-set or seeded; nothing is real. */

const g = (date: string, opp: string, home: boolean, tip = '20:00', b2b = false, id = 70000): GameRef => ({
  game_id: id + Number(date.slice(-2)),
  date,
  tip_at: `${date}T${tip}:00-05:00`,
  opp_abbr: opp,
  home,
  b2b,
});

function factor(
  kind: FactorDetail['kind'],
  title: string,
  value: number | null,
  format: Factor['format'],
  valueNote: string | null,
  reading: string,
  push: Factor['push'],
  detail: FactorDetail,
  confidence = conf('high', 0.85),
  provenance = [prov('projections')],
): Factor {
  return { id: `${kind}-${title}`, kind, title, value, format, value_note: valueNote, reading, push, confidence, provenance, detail };
}

function cats(rows: [CategoryKey, number, number][], games = 1): CatEstimate[] {
  return rows.map(([key, mean, sd]) => {
    const m = key.endsWith('_pct') ? mean : mean * games;
    const s = key.endsWith('_pct') ? sd / Math.sqrt(games) : sd * Math.sqrt(games);
    const r = (v: number) => (key.endsWith('_pct') ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10);
    return { key, ...est(r(m), r(s), r(Math.max(0, m - 1.28 * s)), r(m + 1.28 * s)) };
  });
}

function plan(actions: (DayPlan['action'] | [DayPlan['action'], DayPlan['slot']])[]): DayPlan[] {
  return actions.map((a, i) => {
    const [action, slot] = Array.isArray(a) ? a : [a, null];
    return { date: WEEK_DATES[i]!, weekday: WEEKDAYS[i]!, action, slot };
  });
}

/* --------------------------------------------------------------- Bramwell */

const BRAMWELL_GAMES = [g('2026-11-19', 'MEM', false), g('2026-11-21', 'SAC', true, '20:00'), g('2026-11-22', 'DAL', false, '19:00', true)];
const BRAMWELL_LINE: [CategoryKey, number, number][] = [
  ['fg_pct', 0.561, 0.08],
  ['ft_pct', 0.642, 0.12],
  ['fg3m', 0.3, 0.5],
  ['pts', 12.2, 4.4],
  ['reb', 8.1, 2.9],
  ['ast', 1.4, 1.1],
  ['stl', 0.7, 0.8],
  ['blk', 1.6, 1.2],
  ['tov', 1.3, 1.0],
];

const bramwellFactors: Factor[] = [
  factor(
    'category_fit',
    'Category fit vs Pick & Roll Call',
    0.046,
    'prob_delta',
    'P(win week)',
    'Moves BLK from a coin flip to 60% and REB from 57% to 63%: the two close categories he touches.',
    'for',
    {
      kind: 'category_fit',
      cats: [
        { key: 'fg_pct', p_without: 0.62, p_with: 0.64, delta_p: 0.02, close: false, punted: false },
        { key: 'ft_pct', p_without: 0.3, p_with: 0.29, delta_p: -0.01, close: false, punted: false },
        { key: 'fg3m', p_without: 0.64, p_with: 0.6, delta_p: -0.04, close: false, punted: false },
        { key: 'pts', p_without: 0.53, p_with: 0.52, delta_p: -0.01, close: true, punted: false },
        { key: 'reb', p_without: 0.57, p_with: 0.63, delta_p: 0.06, close: true, punted: false },
        { key: 'ast', p_without: 0.39, p_with: 0.38, delta_p: -0.01, close: true, punted: false },
        { key: 'stl', p_without: 0.64, p_with: 0.64, delta_p: 0.0, close: false, punted: false },
        { key: 'blk', p_without: 0.49, p_with: 0.6, delta_p: 0.11, close: true, punted: false },
        { key: 'tov', p_without: 0.39, p_with: 0.37, delta_p: -0.02, close: false, punted: false },
      ],
    },
    conf('medium', 0.68, [MISSING_INPUTS.kalshiBlk]),
    [prov('simulate', 'Monte Carlo, 5,000 draws, with vs without him')],
  ),
  factor(
    'slot_fit',
    'Slot fit',
    3,
    'count',
    'of 3 games fit an open slot',
    'C is open on all three of his game days; Util is the fallback on Sunday.',
    'for',
    {
      kind: 'slot_fit',
      days: WEEK_DATES.slice(3),
      best_slot: 'C',
      slots: [
        {
          slot: 'C',
          eligible: true,
          by_day: [
            { date: '2026-11-19', open: true, delta_p_win: 0.016 },
            { date: '2026-11-20', open: false, delta_p_win: null },
            { date: '2026-11-21', open: true, delta_p_win: 0.015 },
            { date: '2026-11-22', open: true, delta_p_win: 0.015 },
          ],
        },
        {
          slot: 'Util',
          eligible: true,
          by_day: [
            { date: '2026-11-19', open: true, delta_p_win: 0.014 },
            { date: '2026-11-20', open: true, delta_p_win: null },
            { date: '2026-11-21', open: false, delta_p_win: null },
            { date: '2026-11-22', open: true, delta_p_win: 0.013 },
          ],
        },
        { slot: 'PF', eligible: false, by_day: [] },
        { slot: 'F', eligible: false, by_day: [] },
      ],
    },
    conf('high', 0.86),
    [prov('optimizer', 'open active slots after the paired drop')],
  ),
  factor(
    'schedule',
    'Games this week',
    3,
    'count',
    'games left (Thu, Sat, Sun)',
    'Three games to Venhaus’s one; Sat–Sun is a back-to-back, already priced into minutes.',
    'for',
    {
      kind: 'schedule',
      days: WEEK_DATES.map((date, i) => {
        const game = BRAMWELL_GAMES.find((x) => x.date === date) ?? null;
        return {
          date,
          weekday: WEEKDAYS[i]!,
          game: i < 3 ? null : game,
          open_slots: [0, 0, 0, 2, 1, 1, 2][i]!,
          would_start: i >= 3 && !!game,
          light_day: [false, true, false, true, false, false, true][i]!,
        };
      }),
    },
    conf('high', 0.95),
    [prov('schedule'), prov('optimizer')],
  ),
  factor(
    'minutes',
    'Minutes trend',
    28.9,
    'minutes',
    'EWMA',
    'Climbing since he joined the starting lineup: 30.0 over the last 3 games vs 25.8 for the season.',
    'for',
    {
      kind: 'minutes',
      unit: 'min',
      games: [22, 25, 19, 27, 28, 26, 30, 29, 31, 30].map((value, i) => ({
        date: `2026-11-${String(i + 3).padStart(2, '0')}`,
        opp_abbr: ['LAC', 'SAS', 'HOU', 'PHX', 'UTA', 'OKC', 'MIA', 'CHA', 'ATL', 'MIL'][i]!,
        value,
      })),
      rolling3: 30.0,
      rolling5: 29.2,
      rolling10: 26.7,
      ewma: 28.9,
      season: 25.8,
      projected: est(29.5, 3.4, 25.2, 33.8),
    },
    conf('high', 0.83),
    [prov('features', 'rolling 3/5/10 and EWMA, as of before tip'), prov('projections', 'minutes model')],
  ),
  factor(
    'projection',
    'Projected line',
    4.8,
    'decimal',
    'BLK over 3 games',
    'Per game: 12.2 PTS, 8.1 REB, 1.6 BLK on 56% shooting. His FT% (64%) costs a little.',
    'for',
    { kind: 'projection', games: 3, per_game: cats(BRAMWELL_LINE), week: cats(BRAMWELL_LINE, 3) },
    conf('medium', 0.7),
    [prov('projections', 'ensemble: rate × projected minutes × games')],
  ),
  factor(
    'teammates',
    'Teammates out',
    0.024,
    'percent',
    'usage bump',
    'With Dorian Faraday out (knee), his usage share rises 2.4 points and he gains 4.1 minutes.',
    'for',
    { kind: 'teammates', out: [{ name: 'Dorian Faraday', status: 'out', usage_bump: 0.024, minutes_bump: 4.1, sample_games: 6 }] },
    conf('low', 0.42, [MISSING_INPUTS.usageSample]),
    [prov('features', 'teammates-out usage share')],
  ),
  factor(
    'opponents',
    'Opponents',
    2,
    'count',
    'of 3 games vs bottom-10 defenses',
    'MEM plays fast (5th) and SAC defends poorly (27th); DAL is a tougher Sunday.',
    'for',
    {
      kind: 'opponents',
      games: [
        { game: BRAMWELL_GAMES[0]!, pace: 101.2, pace_rank: 5, def_rating: 116.8, def_rank: 22 },
        { game: BRAMWELL_GAMES[1]!, pace: 99.1, pace_rank: 14, def_rating: 118.9, def_rank: 27 },
        { game: BRAMWELL_GAMES[2]!, pace: 97.8, pace_rank: 23, def_rating: 112.4, def_rank: 7 },
      ],
    },
    conf('high', 0.9),
    [prov('bdl', 'advanced stats, season to date'), prov('features')],
  ),
  factor(
    'vegas',
    'Vegas lines',
    229.5,
    'decimal',
    'Thu total',
    'Thursday and Saturday are high totals; Sunday has no line yet.',
    'neutral',
    {
      kind: 'vegas',
      games: [
        { game: BRAMWELL_GAMES[0]!, spread: 3.5, total: 229.5, implied_team_total: 113, blowout_prob: 0.09 },
        { game: BRAMWELL_GAMES[1]!, spread: -6, total: 236, implied_team_total: 121, blowout_prob: 0.17 },
        { game: BRAMWELL_GAMES[2]!, spread: null, total: null, implied_team_total: null, blowout_prob: null },
      ],
    },
    conf('medium', 0.6, [MISSING_INPUTS.oddsHistory]),
    [prov('bdl', 'odds, de-vigged across 11 books'), prov('rundown')],
  ),
  factor(
    'market',
    'Market agreement',
    0.03,
    'signed',
    'REB gap in sd (Thu)',
    'Books agree on his rebounds (8.2 vs our 8.1); points market is a bit lower than us; no liquid BLK market.',
    'neutral',
    {
      kind: 'market',
      lines: [
        { stat: 'reb', venue: 'sportsbook', book: 'SampleBook', game: BRAMWELL_GAMES[0]!, line: 8, implied_mean: 8.2, ours: est(8.1, 2.9), gap_sd: 0.03, agreement: 'agrees', liquid: true, volume: null },
        { stat: 'pts', venue: 'sportsbook', book: 'SampleBook', game: BRAMWELL_GAMES[0]!, line: 11.5, implied_mean: 11.3, ours: est(12.2, 4.4), gap_sd: -0.2, agreement: 'market_lower', liquid: true, volume: null },
        { stat: 'blk', venue: 'kalshi', book: null, game: BRAMWELL_GAMES[0]!, line: null, implied_mean: null, ours: est(1.6, 1.2), gap_sd: null, agreement: 'no_market', liquid: false, volume: 120 },
      ],
    },
    conf('medium', 0.62, [MISSING_INPUTS.kalshiBlk]),
    [prov('kalshi', 'mid-price, volume ≥ 500'), prov('rundown')],
  ),
  factor(
    'news',
    'News',
    null,
    'count',
    null,
    'Starting again Thursday with Faraday out; two sources, one official.',
    'for',
    {
      kind: 'news',
      events: [
        {
          at: '2026-11-18T14:14:00-05:00',
          status: 'healthy',
          minutes_cap: null,
          starting: true,
          summary: 'Will start Thursday at MEM with Faraday out.',
          source: SOURCES.beat('NOP'),
          parse_confidence: 0.9,
        },
        {
          at: '2026-11-17T12:02:00-05:00',
          status: null,
          minutes_cap: null,
          starting: null,
          summary: 'Teammate Dorian Faraday (knee) out at least a week.',
          source: SOURCES.teamPR('NOP'),
          parse_confidence: 0.97,
        },
      ],
    },
    conf('high', 0.88),
    [prov('x_feed', 'parsed posts; official outranks beat'), prov('overrides')],
  ),
  factor(
    'usage',
    'Usage trend',
    0.205,
    'percent',
    'EWMA usage',
    'Usage is up to 21% from a season 18.6%, consistent with the bigger role.',
    'neutral',
    {
      kind: 'usage',
      unit: 'fraction',
      games: [0.171, 0.18, 0.165, 0.19, 0.2, 0.205, 0.21, 0.208, 0.215, 0.212].map((value, i) => ({
        date: `2026-11-${String(i + 3).padStart(2, '0')}`,
        opp_abbr: ['LAC', 'SAS', 'HOU', 'PHX', 'UTA', 'OKC', 'MIA', 'CHA', 'ATL', 'MIL'][i]!,
        value,
      })),
      rolling3: 0.212,
      rolling5: 0.21,
      rolling10: 0.196,
      ewma: 0.205,
      season: 0.186,
      projected: null,
    },
    conf('high', 0.8),
    [prov('features'), prov('bdl', 'advanced stats')],
  ),
  factor(
    'models',
    'Model agreement (minutes)',
    29.5,
    'minutes',
    'ensemble',
    'The three gated-on models agree within 1.8 minutes; Ridge (gated off) is lowest at 27.1.',
    'for',
    {
      kind: 'models',
      stat: 'min',
      ensemble: est(29.5, 3.4, 25.2, 33.8),
      models: [
        { model: 'EWMA baseline', mean: 28.9, sd: 3.8, beats_baseline: false, weight: 0.07 },
        { model: 'LightGBM', mean: 30.4, sd: 3.3, beats_baseline: true, weight: 0.38 },
        { model: 'Hierarchical', mean: 28.6, sd: 3.0, beats_baseline: true, weight: 0.31 },
        { model: 'CatBoost', mean: 29.9, sd: 3.5, beats_baseline: true, weight: 0.24 },
        { model: 'Ridge', mean: 27.1, sd: 4.0, beats_baseline: false, weight: null },
      ],
    },
    conf('high', 0.84),
    [prov('projections', 'ensemble.py, inverse-error weights'), prov('backtest', 'gate: beats EWMA out of sample')],
  ),
  factor(
    'drivers',
    'What drives his minutes',
    5.1,
    'signed',
    'min above the model’s base',
    'Starting and the teammate absence add the most; the Sat–Sun back-to-back takes some back.',
    'for',
    {
      kind: 'drivers',
      model: 'LightGBM',
      target: 'min',
      base_value: 25.3,
      drivers: [
        { feature: 'started_last4', label: 'Started the last 4', value_label: 'yes', contribution: 2.9 },
        { feature: 'teammates_out_usage', label: 'Teammates out (usage share)', value_label: '24% of usage', contribution: 1.6 },
        { feature: 'min_roll5', label: 'Minutes, last 5', value_label: '29.2', contribution: 1.4 },
        { feature: 'opp_pace', label: 'Opponent pace', value_label: '99.4 avg', contribution: 0.4 },
        { feature: 'blowout_prob', label: 'Blowout risk', value_label: '13% avg', contribution: -0.3 },
        { feature: 'b2b', label: 'Back-to-back', value_label: 'Sat–Sun', contribution: -0.9 },
      ],
    },
    conf('high', 0.8),
    [prov('explain', 'SHAP, LightGBM minutes model')],
  ),
];

export const playerBramwell: PlayerAnalysisResponse = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('projections'), prov('simulate'), prov('optimizer')],
  week: weekContext(),
  player: FREE_AGENTS.bramwell,
  recommendation: {
    action: 'add',
    headline: 'Add him and start at C on Thu, Sat and Sun',
    slot: 'C',
    plan: plan(['past', 'past', 'no_game', ['start', 'C'], 'no_game', ['start', 'C'], ['start', 'C']]),
    delta_p_win: est(0.046, 0.016, 0.019, 0.072),
    versus: 'Drop Bram Venhaus (1 game left after tonight)',
    confidence: conf('medium', 0.68, [MISSING_INPUTS.kalshiBlk, MISSING_INPUTS.oddsHistory, MISSING_INPUTS.usageSample]),
    move_id: 'm-add-bramwell',
  },
  factors: bramwellFactors,
  confidence: {
    ...conf('medium', 0.68, [MISSING_INPUTS.kalshiBlk, MISSING_INPUTS.oddsHistory, MISSING_INPUTS.usageSample]),
    summary: 'Medium. The minutes models agree and the schedule is solid, but three inputs are missing or thin.',
  },
};

/* --------------------------------------------------------------- Pellham */

const PELLHAM_TONIGHT = g('2026-11-18', 'BOS', true, '20:00');
const PELLHAM_LINE: [CategoryKey, number, number][] = [
  ['fg_pct', 0.58, 0.09],
  ['ft_pct', 0.66, 0.15],
  ['fg3m', 0.2, 0.4],
  ['pts', 13.1, 4.6],
  ['reb', 9.4, 3.1],
  ['ast', 1.6, 1.2],
  ['stl', 0.6, 0.7],
  ['blk', 1.3, 1.1],
  ['tov', 1.4, 1.1],
];

export const playerPellham: PlayerAnalysisResponse = {
  ...playerBramwell,
  player: MINE.pellham,
  recommendation: {
    action: 'start',
    headline: 'Start at Util tonight, PF Thursday and F Saturday',
    slot: 'Util',
    plan: plan(['past', 'past', ['start', 'Util'], ['start', 'PF'], 'no_game', ['start', 'F'], 'no_game']),
    delta_p_win: est(0.021, 0.009, 0.006, 0.035),
    versus: 'Over Jalen Ferrante tonight',
    confidence: conf('high', 0.82),
    move_id: 'm-start-pellham',
  },
  factors: [
    factor(
      'category_fit',
      'Category fit vs Pick & Roll Call',
      0.021,
      'prob_delta',
      'P(win week), tonight',
      'Starting him over Ferrante moves REB +4 and BLK +3 pts, and costs 2 pts in 3PTM, which you lead.',
      'for',
      {
        kind: 'category_fit',
        cats: [
          { key: 'fg_pct', p_without: 0.62, p_with: 0.63, delta_p: 0.01, close: false, punted: false },
          { key: 'ft_pct', p_without: 0.3, p_with: 0.29, delta_p: -0.01, close: false, punted: false },
          { key: 'fg3m', p_without: 0.64, p_with: 0.62, delta_p: -0.02, close: false, punted: false },
          { key: 'pts', p_without: 0.53, p_with: 0.53, delta_p: 0.0, close: true, punted: false },
          { key: 'reb', p_without: 0.57, p_with: 0.61, delta_p: 0.04, close: true, punted: false },
          { key: 'ast', p_without: 0.39, p_with: 0.38, delta_p: -0.01, close: true, punted: false },
          { key: 'stl', p_without: 0.64, p_with: 0.63, delta_p: -0.01, close: false, punted: false },
          { key: 'blk', p_without: 0.49, p_with: 0.52, delta_p: 0.03, close: true, punted: false },
          { key: 'tov', p_without: 0.39, p_with: 0.39, delta_p: 0.0, close: false, punted: false },
        ],
      },
      conf('high', 0.82),
      [prov('simulate')],
    ),
    factor(
      'slot_fit',
      'Slot fit',
      3,
      'count',
      'of 3 games start',
      'Util tonight (Ferrante sits), PF Thursday, F Saturday: every one of his games fits.',
      'for',
      {
        kind: 'slot_fit',
        days: WEEK_DATES.slice(2),
        best_slot: 'Util',
        slots: [
          { slot: 'C', eligible: true, by_day: WEEK_DATES.slice(2).map((date, i) => ({ date, open: i === 1, delta_p_win: i === 1 ? 0.011 : null })) },
          { slot: 'PF', eligible: true, by_day: WEEK_DATES.slice(2).map((date, i) => ({ date, open: i === 1, delta_p_win: i === 1 ? 0.012 : null })) },
          { slot: 'F', eligible: true, by_day: WEEK_DATES.slice(2).map((date, i) => ({ date, open: i === 3, delta_p_win: i === 3 ? 0.01 : null })) },
          { slot: 'Util', eligible: true, by_day: WEEK_DATES.slice(2).map((date, i) => ({ date, open: i === 0 || i === 3, delta_p_win: i === 0 ? 0.021 : i === 3 ? 0.009 : null })) },
        ],
      },
      conf('high', 0.86),
      [prov('optimizer')],
    ),
    factor(
      'projection',
      'Projected line tonight',
      9.4,
      'decimal',
      'REB tonight',
      'Tonight: 13.1 PTS, 9.4 REB, 1.3 BLK vs a bottom-five rebounding team.',
      'for',
      { kind: 'projection', games: 1, per_game: cats(PELLHAM_LINE), week: cats(PELLHAM_LINE, 3) },
      conf('high', 0.8),
    ),
    factor(
      'market',
      'Market agreement',
      0.23,
      'signed',
      'REB gap in sd',
      'Kalshi leans higher than us on rebounds (10.1 vs 9.4); points line matches.',
      'for',
      {
        kind: 'market',
        lines: [
          { stat: 'reb', venue: 'kalshi', book: null, game: PELLHAM_TONIGHT, line: 9.5, implied_mean: 10.1, ours: est(9.4, 3.1), gap_sd: 0.23, agreement: 'market_higher', liquid: true, volume: 4120 },
          { stat: 'pts', venue: 'sportsbook', book: 'SampleBook', game: PELLHAM_TONIGHT, line: 12.5, implied_mean: 13.0, ours: est(13.1, 4.6), gap_sd: -0.02, agreement: 'agrees', liquid: true, volume: null },
        ],
      },
      conf('high', 0.8),
      [prov('kalshi'), prov('rundown')],
    ),
    factor(
      'opponents',
      'Opponent tonight',
      29,
      'rank',
      'in rebound rate allowed',
      'BOS gives up the 2nd-most offensive rebounds; pace is average.',
      'for',
      { kind: 'opponents', games: [{ game: PELLHAM_TONIGHT, pace: 98.6, pace_rank: 16, def_rating: 113.1, def_rank: 9 }] },
      conf('high', 0.9),
      [prov('bdl'), prov('features')],
    ),
    bramwellFactors.find((f) => f.kind === 'minutes')!,
  ],
  confidence: { ...conf('high', 0.82), summary: 'High. Every input is present and the models agree.' },
};

/* -------------------------------------------------------------- Rosswell */

export const playerRosswell: PlayerAnalysisResponse = {
  ...playerBramwell,
  player: MINE.rosswell,
  recommendation: {
    action: 'bench',
    headline: 'Bench him Friday; start Thursday and Sunday if he is cleared',
    slot: null,
    plan: plan(['past', 'past', 'no_game', ['start', 'PG'], 'bench', 'no_game', ['start', 'PG']]),
    delta_p_win: est(0.007, 0.011, -0.008, 0.021),
    versus: null,
    confidence: conf('low', 0.41, [MISSING_INPUTS.statusUnconfirmed, MISSING_INPUTS.noProps]),
    move_id: 'm-bench-rosswell',
  },
  factors: [
    factor(
      'news',
      'Status',
      0.55,
      'prob',
      'chance he plays Fri',
      'Questionable with a hamstring issue; a beat writer reports a 24-minute limit if he plays. No official word yet.',
      'for',
      {
        kind: 'news',
        events: [
          {
            at: '2026-11-18T16:55:00-05:00',
            status: 'questionable',
            minutes_cap: 24,
            starting: null,
            summary: 'Questionable Friday (hamstring); minutes limit around 24 if he plays.',
            source: SOURCES.beat('BKN'),
            parse_confidence: 0.84,
          },
          {
            at: '2026-11-17T22:40:00-05:00',
            status: 'day_to_day',
            minutes_cap: null,
            starting: null,
            summary: 'Left Tuesday’s practice early, day-to-day.',
            source: SOURCES.aggregator,
            parse_confidence: 0.71,
          },
        ],
      },
      conf('low', 0.41, [MISSING_INPUTS.statusUnconfirmed]),
      [prov('x_feed'), prov('overrides', 'beat report; no official update')],
    ),
    factor(
      'category_fit',
      'Category fit Friday',
      0.007,
      'prob_delta',
      'P(win week) from benching',
      'Capped minutes mean 2.1 turnovers and 39% shooting for 4.4 assists: TO and FG% matter more this week.',
      'for',
      {
        kind: 'category_fit',
        cats: [
          { key: 'fg_pct', p_without: 0.63, p_with: 0.62, delta_p: -0.01, close: false, punted: false },
          { key: 'ft_pct', p_without: 0.3, p_with: 0.31, delta_p: 0.01, close: false, punted: false },
          { key: 'fg3m', p_without: 0.63, p_with: 0.64, delta_p: 0.01, close: false, punted: false },
          { key: 'pts', p_without: 0.52, p_with: 0.53, delta_p: 0.01, close: true, punted: false },
          { key: 'reb', p_without: 0.57, p_with: 0.57, delta_p: 0.0, close: true, punted: false },
          { key: 'ast', p_without: 0.37, p_with: 0.39, delta_p: 0.02, close: true, punted: false },
          { key: 'stl', p_without: 0.64, p_with: 0.64, delta_p: 0.0, close: false, punted: false },
          { key: 'blk', p_without: 0.49, p_with: 0.49, delta_p: 0.0, close: true, punted: false },
          { key: 'tov', p_without: 0.42, p_with: 0.39, delta_p: -0.03, close: false, punted: false },
        ],
      },
      conf('low', 0.41, [MISSING_INPUTS.statusUnconfirmed]),
      [prov('simulate')],
    ),
    factor(
      'minutes',
      'Minutes trend',
      26.1,
      'minutes',
      'EWMA (before the injury)',
      'Was steady near 30 before the hamstring; the projection takes the 24-minute cap.',
      'against',
      {
        kind: 'minutes',
        unit: 'min',
        games: [31, 30, 29, 32, 30, null, 28, 18, null, null].map((value, i) => ({
          date: `2026-11-${String(i + 3).padStart(2, '0')}`,
          opp_abbr: ['NYK', 'MIA', 'ORL', 'TOR', 'CHI', 'DET', 'PHI', 'BOS', 'CLE', 'WAS'][i]!,
          value,
        })),
        rolling3: 18,
        rolling5: 25.3,
        rolling10: 28.3,
        ewma: 26.1,
        season: 29.4,
        projected: est(22.8, 3.1, 18.8, 24),
      },
      conf('medium', 0.55),
      [prov('features'), prov('overrides', 'minutes cap 24')],
    ),
    factor(
      'market',
      'Market agreement',
      null,
      'signed',
      null,
      'No prop markets are listed for his games, so the market cannot check our projection.',
      'unknown',
      { kind: 'market', lines: [] },
      conf('none', null, [MISSING_INPUTS.noProps]),
      [prov('kalshi'), prov('rundown')],
    ),
    factor(
      'teammates',
      'Teammates out',
      null,
      'percent',
      null,
      'No teammates are out for Friday, so there is no usage bump to add.',
      'neutral',
      { kind: 'teammates', out: [] },
      conf('high', 0.9),
      [prov('features')],
    ),
  ],
  confidence: {
    ...conf('low', 0.41, [MISSING_INPUTS.statusUnconfirmed, MISSING_INPUTS.noProps]),
    summary: 'Low. The decision hinges on a status nobody official has confirmed; re-check about 90 minutes before tip.',
  },
};

export const playerBramwellStale: PlayerAnalysisResponse = { ...playerBramwell, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };
export const playerBramwellPunt: PlayerAnalysisResponse = {
  ...playerBramwell,
  week: PUNT_CONTEXT,
  factors: playerBramwell.factors.map((f) =>
    f.detail.kind === 'category_fit'
      ? {
          ...f,
          reading: 'Moves BLK from a coin flip to 60% and REB to 63%. His 64% free throws cost nothing: you punt FT%.',
          detail: { ...f.detail, cats: f.detail.cats.map((c) => (c.key === 'ft_pct' ? { ...c, punted: true } : c)) },
        }
      : f,
  ),
};
export const playerBramwellPlayoff: PlayerAnalysisResponse = toPlayoffWeek({ ...playerBramwell, week: PLAYOFF_CONTEXT });

/** Last day: only today matters; the add is for one game. */
export const playerHargreaveLastDay: PlayerAnalysisResponse = {
  ...playerBramwell,
  as_of: '2026-11-22T11:05:00-05:00',
  week: LAST_DAY_CONTEXT,
  player: FREE_AGENTS.hargreave,
  recommendation: {
    action: 'stream',
    headline: 'Add him for today only and start at PF',
    slot: 'PF',
    plan: plan(['past', 'past', 'past', 'past', 'past', 'past', ['start', 'PF']]),
    delta_p_win: est(0.061, 0.019, 0.037, 0.085),
    versus: 'Drop Theo Talbridge (no game today)',
    confidence: conf('medium', 0.7),
    move_id: 'm-add-hargreave-sun',
  },
  factors: playerBramwell.factors
    .filter((f) => ['category_fit', 'projection', 'news'].includes(f.kind))
    .map((f) =>
      f.kind === 'category_fit'
        ? { ...f, value: 0.061, reading: 'REB is the last swing category (47%): his 9.2 rebounds today take it to 61%.' }
        : f,
    ),
  confidence: { ...conf('medium', 0.7), summary: 'Medium. One game, starting confirmed by a beat writer.' },
};

