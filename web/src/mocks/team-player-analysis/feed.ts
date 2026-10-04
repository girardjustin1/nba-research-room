import type { FeedItem, FeedResponse, JobHealth, NewsEvent } from '../../api/season';
import { conf, est, prov, toPlayoffWeek } from '../foundations/seasonCommon';
import { AS_OF, FREE_AGENTS, HALVORSEN_OUT, MINE, SOURCES, THEIRS } from '../foundations/seasonPlayers';
import { ALERT_HALVORSEN, STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';

/** Invented research-feed items. Post text is never stored; summaries are engine-style. */

const t = (hhmm: string, date = '2026-11-18') => `${date}T${hhmm}:00-05:00`;

export const NEWS_HALVORSEN: NewsEvent = {
  id: 'f-news-halvorsen',
  kind: 'news',
  at: t('17:31'),
  title: 'Soren Halvorsen ruled out tonight (right ankle)',
  impact: ALERT_HALVORSEN.impact,
  affects_matchup: true,
  player: HALVORSEN_OUT,
  status: 'out',
  minutes_cap: null,
  starting: false,
  game: { game_id: 50042, date: '2026-11-18', tip_at: t('19:30'), opp_abbr: 'DEN', home: true, b2b: false },
  source: SOURCES.teamPR('OKC'),
  parse_confidence: 0.97,
  corroborated_by: [SOURCES.insider, SOURCES.beat('OKC')],
};

const jobs: JobHealth[] = [
  {
    job: 'bdl_box_scores',
    label: 'Box scores',
    module: 'bdl',
    last_run_at: t('06:31'),
    last_status: 'ok',
    next_run_at: t('18:30'),
    stale: false,
    running: false,
    progress: null,
    started_at: null,
  },
  {
    job: 'bdl_injuries',
    label: 'Injuries',
    module: 'bdl',
    last_run_at: t('17:30'),
    last_status: 'ok',
    next_run_at: t('17:45'),
    stale: false,
    running: false,
    progress: null,
    started_at: null,
  },
  {
    job: 'odds',
    label: 'Odds & props',
    module: 'kalshi',
    last_run_at: t('17:20'),
    last_status: 'partial',
    next_run_at: t('18:20'),
    stale: false,
    running: false,
    progress: null,
    started_at: null,
  },
  {
    job: 'x_feed',
    label: 'X news',
    module: 'x_feed',
    last_run_at: t('17:30'),
    last_status: 'ok',
    next_run_at: t('17:45'),
    stale: false,
    running: true,
    progress: { done: 23, total: 40, unit: 'accounts' },
    started_at: t('17:41'),
  },
  {
    job: 'projections',
    label: 'Projections',
    module: 'projections',
    last_run_at: t('17:38'),
    last_status: 'ok',
    next_run_at: t('18:45'),
    stale: false,
    running: false,
    progress: null,
    started_at: null,
  },
  {
    job: 'optimizer',
    label: 'Optimizer',
    module: 'optimizer',
    last_run_at: t('17:40'),
    last_status: 'ok',
    next_run_at: null,
    stale: false,
    running: false,
    progress: null,
    started_at: null,
  },
  {
    job: 'yahoo_inbox',
    label: 'Yahoo snapshot',
    module: 'yahoo',
    last_run_at: t('17:15'),
    last_status: 'ok',
    next_run_at: null,
    stale: false,
    running: false,
    progress: null,
    started_at: null,
  },
];

const unsorted: FeedItem[] = [
  {
    id: 'f-model-optimizer',
    kind: 'model',
    at: t('17:40'),
    title: 'Optimizer re-solved Wed–Sun',
    impact: {
      delta_p_win: null,
      cat_deltas: [],
      summary: 'Plan with all 4 moves: P(win week) 63% (do nothing: 52%).',
      suggestion: null,
      move_id: null,
      severity: 'low',
      confidence: conf('medium', 0.7),
      computed_at: t('17:40'),
    },
    affects_matchup: true,
    job: 'optimizer',
    summary: 'MILP solved to optimality in 1.8 s over 5 days, 4 acquisitions cap (2 left).',
    players_changed: null,
    scoreboard: null,
    run_ms: 1840,
  },
  {
    id: 'f-model-proj',
    kind: 'model',
    at: t('17:38'),
    title: 'Projections refreshed after the 5:30 pm injury report',
    impact: null,
    affects_matchup: false,
    job: 'projections',
    summary: '41 players changed by more than 1 minute; ensemble of 4 models plus EWMA baseline.',
    players_changed: 41,
    scoreboard: null,
    run_ms: 52_000,
  },
  {
    id: 'f-market-bramwell',
    kind: 'market',
    at: t('17:12'),
    title: 'Callum Bramwell REB line up 1.5 at SampleBook',
    impact: {
      delta_p_win: 0.004,
      cat_deltas: [{ key: 'reb', delta_p: 0.01, p_after: 0.58 }],
      summary: 'Market now agrees with our 8.1 REB; the Bramwell pickup gains +0.4 pts.',
      suggestion: 'Add Bramwell, drop Venhaus (move 1).',
      move_id: 'm-add-bramwell',
      severity: 'low',
      confidence: conf('medium', 0.66),
      computed_at: t('17:14'),
    },
    affects_matchup: true,
    player: FREE_AGENTS.bramwell,
    venue: 'sportsbook',
    book: 'SampleBook',
    stat: 'reb',
    line_before: 6.5,
    line_after: 8,
    implied_mean_after: 8.2,
    ours: est(8.1, 2.9),
    volume: null,
    liquid: true,
    game: { game_id: 51300, date: '2026-11-19', tip_at: '2026-11-19T20:00:00-05:00', opp_abbr: 'MEM', home: false, b2b: false },
  },
  {
    id: 'f-news-rosswell',
    kind: 'news',
    at: t('16:55'),
    title: 'Wes Rosswell questionable Fri, minutes limit if he plays',
    impact: {
      delta_p_win: -0.011,
      cat_deltas: [
        { key: 'ast', delta_p: -0.02, p_after: 0.37 },
        { key: 'tov', delta_p: 0.01, p_after: 0.4 },
      ],
      summary: 'P(win week) −1.1 pts: AST −2 pts.',
      suggestion: 'Bench Rosswell Friday unless he is cleared without a limit.',
      move_id: 'm-bench-rosswell',
      severity: 'medium',
      confidence: conf('low', 0.45, [
        { key: 'status_unconfirmed', label: 'Beat report only; no official status', effect: 'P(plays) 55%' },
      ]),
      computed_at: t('16:57'),
    },
    affects_matchup: true,
    player: MINE.rosswell,
    status: 'questionable',
    minutes_cap: 24,
    starting: null,
    game: { game_id: 50094, date: '2026-11-20', tip_at: '2026-11-20T19:30:00-05:00', opp_abbr: 'CLE', home: true, b2b: false },
    source: SOURCES.beat('BKN'),
    parse_confidence: 0.84,
    corroborated_by: [],
  },
  {
    id: 'f-news-wexford',
    kind: 'news',
    at: t('16:20'),
    title: 'Grant Wexford (opponent) starting tonight, no restriction',
    impact: {
      delta_p_win: -0.006,
      cat_deltas: [{ key: 'reb', delta_p: -0.01, p_after: 0.56 }],
      summary: 'Expected; P(win week) −0.6 pts as his play chance went from 85% to 99%.',
      suggestion: null,
      move_id: null,
      severity: 'low',
      confidence: conf('high', 0.88),
      computed_at: t('16:21'),
    },
    affects_matchup: true,
    player: THEIRS.wexford,
    status: 'healthy',
    minutes_cap: null,
    starting: true,
    game: null,
    source: SOURCES.beat('LAL'),
    parse_confidence: 0.91,
    corroborated_by: [SOURCES.aggregator],
  },
  {
    id: 'f-market-kalshi-pellham',
    kind: 'market',
    at: t('15:48'),
    title: 'Kalshi: Isaac Pellham 10+ REB moved 41¢ → 49¢',
    impact: {
      delta_p_win: 0.003,
      cat_deltas: [{ key: 'reb', delta_p: 0.01, p_after: 0.58 }],
      summary: 'Market leans to more rebounds than we project (9.4); start-Pellham move holds.',
      suggestion: null,
      move_id: 'm-start-pellham',
      severity: 'low',
      confidence: conf('medium', 0.6),
      computed_at: t('15:50'),
    },
    affects_matchup: true,
    player: MINE.pellham,
    venue: 'kalshi',
    book: null,
    stat: 'reb',
    line_before: 9.6,
    line_after: 10.1,
    implied_mean_after: 10.1,
    ours: est(9.4, 3.1),
    volume: 4120,
    liquid: true,
    game: { game_id: 50122, date: '2026-11-18', tip_at: t('20:00'), opp_abbr: 'BOS', home: true, b2b: false },
  },
  {
    id: 'f-data-odds',
    kind: 'data',
    at: t('17:20'),
    title: 'Odds & props: 11 games, 3 Kalshi ladders illiquid',
    impact: null,
    affects_matchup: false,
    source: 'kalshi',
    job: 'odds',
    status: 'partial',
    rows: 1864,
    message: 'Illiquid contracts (volume under 500) are treated as missing.',
    duration_ms: 14_200,
  },
  {
    id: 'f-model-backtest',
    kind: 'model',
    at: t('06:52'),
    title: 'Backtest scoreboard updated through week 3',
    impact: null,
    affects_matchup: false,
    job: 'backtest',
    summary: 'LightGBM and the hierarchical model beat EWMA on minutes; Ridge did not and stays gated off.',
    players_changed: null,
    run_ms: 188_000,
    scoreboard: [
      { model: 'EWMA baseline', stat: 'min', mae: 4.62, baseline_mae: 4.62, rel_improvement: 0.0, beats_baseline: false, weight: null, gated_on: true },
      { model: 'LightGBM', stat: 'min', mae: 4.21, baseline_mae: 4.62, rel_improvement: 0.089, beats_baseline: true, weight: 0.38, gated_on: true },
      { model: 'Hierarchical', stat: 'min', mae: 4.33, baseline_mae: 4.62, rel_improvement: 0.063, beats_baseline: true, weight: 0.31, gated_on: true },
      { model: 'CatBoost', stat: 'min', mae: 4.4, baseline_mae: 4.62, rel_improvement: 0.048, beats_baseline: true, weight: 0.24, gated_on: true },
      { model: 'Ridge', stat: 'min', mae: 4.71, baseline_mae: 4.62, rel_improvement: -0.019, beats_baseline: false, weight: null, gated_on: false },
    ],
  },
  {
    id: 'f-data-box',
    kind: 'data',
    at: t('06:31'),
    title: 'Box scores synced: 8 games, 247 player rows',
    impact: null,
    affects_matchup: false,
    source: 'bdl',
    job: 'bdl_box_scores',
    status: 'ok',
    rows: 247,
    message: null,
    duration_ms: 9_800,
  },
];

/** Server order: newest first. */
const items = [...unsorted].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

export const feedNormal: FeedResponse = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('x_feed'), prov('kalshi'), prov('bdl'), prov('simulate', 'impact = rerun with the new inputs')],
  items,
  jobs,
  x_budget: { used: 182, limit: 300 },
  next_cursor: 'c-0631',
};

export const feedInjury: FeedResponse = {
  ...feedNormal,
  items: [NEWS_HALVORSEN, ...items],
};

const failedJobs: JobHealth[] = jobs.map((j) =>
  j.job === 'bdl_box_scores' || j.job === 'bdl_injuries'
    ? { ...j, last_status: 'failed', stale: true, last_run_at: t('16:30'), next_run_at: t('17:50') }
    : j.job === 'projections'
      ? { ...j, stale: true, last_run_at: STALE_AS_OF }
      : { ...j, running: false, progress: null },
);

export const feedStale: FeedResponse = {
  ...feedNormal,
  as_of: STALE_AS_OF,
  stale: true,
  stale_reason: STALE_REASON,
  jobs: failedJobs,
  items: [
    {
      id: 'f-data-bdl-fail',
      kind: 'data',
      at: t('16:30'),
      title: 'BallDontLie sync failed (HTTP 503), retrying at 5:50 pm',
      impact: {
        delta_p_win: null,
        cat_deltas: [],
        summary: 'Injuries after 6:31 am are missing, so tonight’s statuses may be out of date.',
        suggestion: 'Check statuses in Yahoo before 7:00 pm lock.',
        move_id: null,
        severity: 'medium',
        confidence: conf('low', null),
        computed_at: t('16:31'),
      },
      affects_matchup: true,
      source: 'bdl',
      job: 'bdl_injuries',
      status: 'failed',
      rows: null,
      message: 'Service Unavailable after 5 retries with backoff.',
      duration_ms: 61_000,
    },
    ...items.filter((i) => i.kind !== 'model' || i.id === 'f-model-backtest'),
  ],
};

/** Everything idle: no job running. */
export const feedIdle: FeedResponse = { ...feedNormal, jobs: jobs.map((j) => ({ ...j, running: false, progress: null })) };

/** Several jobs running at once (the nightly). */
export const feedNightlyRunning: FeedResponse = {
  ...feedNormal,
  jobs: jobs.map((j) =>
    j.job === 'bdl_box_scores'
      ? { ...j, running: true, progress: { done: 6, total: 8, unit: 'games' }, started_at: t('18:30') }
      : j.job === 'projections'
        ? { ...j, running: true, progress: { done: 2, total: 5, unit: 'models' }, started_at: t('18:31') }
        : j,
  ),
};

export const feedEmpty: FeedResponse = { ...feedNormal, items: [], next_cursor: null };

export const feedLastDay: FeedResponse = {
  ...feedNormal,
  as_of: '2026-11-22T11:05:00-05:00',
  items: [
    {
      id: 'f-news-hargreave',
      kind: 'news',
      at: '2026-11-22T10:48:00-05:00',
      title: 'Ravi Hargreave (free agent) starting today; teammate out',
      impact: {
        delta_p_win: 0.061,
        cat_deltas: [{ key: 'reb', delta_p: 0.14, p_after: 0.61 }],
        summary: 'If you add him: P(win week) +6.1 pts, REB +14 pts. REB is the last swing category.',
        suggestion: 'Add Hargreave, drop Talbridge before 3:30 pm.',
        move_id: 'm-add-hargreave-sun',
        severity: 'high',
        confidence: conf('medium', 0.7),
        computed_at: '2026-11-22T10:50:00-05:00',
      },
      affects_matchup: true,
      player: FREE_AGENTS.hargreave,
      status: 'healthy',
      minutes_cap: null,
      starting: true,
      game: { game_id: 59000, date: '2026-11-22', tip_at: '2026-11-22T15:30:00-05:00', opp_abbr: 'POR', home: true, b2b: false },
      source: SOURCES.beat('MIN'),
      parse_confidence: 0.9,
      corroborated_by: [SOURCES.aggregator],
    },
    ...items.slice(0, 3).map((i) => ({ ...i, at: i.at.replace('2026-11-18', '2026-11-22') })),
  ],
};

export const feedPlayoff: FeedResponse = toPlayoffWeek(feedNormal);

export const feedPunt: FeedResponse = {
  ...feedNormal,
  items: [
    {
      id: 'f-news-hargreave-punt',
      kind: 'news',
      at: t('17:05'),
      title: 'Ravi Hargreave (free agent) moves into the starting lineup',
      impact: {
        delta_p_win: 0.029,
        cat_deltas: [{ key: 'reb', delta_p: 0.07, p_after: 0.64 }],
        summary: 'If you add him: P(win week) +2.9 pts. His FT% is ignored because you punt it.',
        suggestion: 'Add Hargreave, drop Talbridge (move 2).',
        move_id: 'm-add-hargreave',
        severity: 'medium',
        confidence: conf('medium', 0.66),
        computed_at: t('17:07'),
      },
      affects_matchup: true,
      player: FREE_AGENTS.hargreave,
      status: 'healthy',
      minutes_cap: null,
      starting: true,
      game: null,
      source: SOURCES.beat('MIN'),
      parse_confidence: 0.88,
      corroborated_by: [],
    },
    ...items,
  ],
};
