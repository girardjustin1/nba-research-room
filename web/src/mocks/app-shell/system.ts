import type {
  HealthResponse,
  LiveBlock,
  LiveScoreboardResponse,
  ModelsResponse,
  NotesResponse,
  ReadinessResponse,
} from '../../api/system';

/** Invented System data for stories and the app's "Prototype data" fallback. */
const AS_OF = '2026-11-18T18:42:00-05:00';

export const healthOk: HealthResponse = {
  as_of: AS_OF,
  overall: 'ok',
  checks: [
    { key: 'bdl_sync', label: 'Game logs (BallDontLie)', status: 'ok', detail: 'Synced through last night; 0 incomplete box scores this week.', last_ok_at: '2026-11-18T06:31:00-05:00', freshness_budget_h: 26, action: null },
    { key: 'injuries', label: 'Injury reports', status: 'ok', detail: '42 players with a status today.', last_ok_at: '2026-11-18T17:15:00-05:00', freshness_budget_h: 6, action: null },
    { key: 'yahoo_roster', label: 'Yahoo roster and matchup CSVs', status: 'ok', detail: 'roster.csv and matchup.csv from this morning.', last_ok_at: '2026-11-18T08:02:00-05:00', freshness_budget_h: 24, action: null },
    { key: 'projections', label: 'Projections', status: 'ok', detail: 'Ensemble refreshed for 118 players.', last_ok_at: '2026-11-18T06:40:00-05:00', freshness_budget_h: 26, action: null },
    { key: 'names', label: 'Name matching', status: 'ok', detail: 'Every rostered player matches an id; quarantine is empty.', last_ok_at: AS_OF, freshness_budget_h: null, action: null },
  ],
  store: {
    db_bytes: 1_073_741_824,
    tables: [
      { table: 'game_logs', rows: 142_118 },
      { table: 'advanced_stats', rows: 108_902 },
      { table: 'projections', rows: 61_440 },
      { table: 'injuries', rows: 9_812 },
      { table: 'draft_picks', rows: 182 },
      { table: 'unresolved_names', rows: 0 },
    ],
  },
  jobs: [
    { source: 'nightly', job: 'ingest → features → projections → optimize', status: 'ok', finished_at: '2026-11-18T06:41:00-05:00', rows: 3_211, detail: 'Finished in 7 min 12 s.' },
    { source: 'inbox', job: 'Yahoo CSVs', status: 'ok', finished_at: '2026-11-18T08:02:00-05:00', rows: 31, detail: null },
    { source: 'pregame', job: 'Injuries and status', status: 'ok', finished_at: '2026-11-18T17:15:00-05:00', rows: 42, detail: null },
  ],
};

export const healthWarn: HealthResponse = {
  ...healthOk,
  overall: 'warn',
  checks: healthOk.checks.map((c) =>
    c.key === 'yahoo_roster'
      ? { ...c, status: 'warn', detail: 'matchup.csv is 31 h old (budget 24 h); lineup advice uses yesterday’s opponent roster.', last_ok_at: '2026-11-17T11:20:00-05:00', action: 'Save matchup.csv to data/inbox, then run make inbox' }
      : c.key === 'names'
        ? { ...c, status: 'warn', detail: '2 rostered names are quarantined (ambiguous matches).', action: 'Review the Data page quarantine' }
        : c,
  ),
};

export const healthError: HealthResponse = {
  ...healthOk,
  overall: 'error',
  checks: healthOk.checks.map((c) =>
    c.key === 'bdl_sync'
      ? { ...c, status: 'error', detail: 'Last night’s sync failed: HTTP 401 from BallDontLie (key rejected).', last_ok_at: '2026-11-16T06:30:00-05:00', action: 'Check BDL_API_KEY in .env, then run make nightly' }
      : c.key === 'projections'
        ? { ...c, status: 'warn', detail: 'Projections are 60 h old because the sync failed.', last_ok_at: '2026-11-16T06:40:00-05:00', action: 'run make nightly' }
        : c,
  ),
  jobs: [
    { source: 'nightly', job: 'ingest → features → projections → optimize', status: 'error', finished_at: '2026-11-18T06:33:00-05:00', rows: 0, detail: 'Stopped at ingest: HTTP 401.' },
    ...healthOk.jobs.slice(1),
  ],
};

export const healthEmpty: HealthResponse = {
  as_of: AS_OF,
  overall: 'warn',
  checks: [],
  store: { db_bytes: 0, tables: [] },
  jobs: [],
};

const STATS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'tov'];
const w = { window_start: '2026-10-20', window_end: '2026-11-16' };
const row = (model: string, stat: string, i: number, mae: number, cov: number, beats: boolean | null) => ({
  model,
  stat,
  ...w,
  mae: Math.round(mae * 100) / 100,
  rmse: Math.round(mae * 1.28 * 100) / 100,
  coverage_80: cov,
  n: 1_840 - i * 7,
  beats_baseline: beats,
});

export const modelsNormal: ModelsResponse = {
  as_of: AS_OF,
  models: [
    ...STATS.map((s, i) => row('baseline', s, i, [4.1, 4.6, 2.1, 1.5, 0.62, 0.48, 0.9, 0.95][i] ?? 1, [0.78, 0.76, 0.8, 0.79, 0.83, 0.81, 0.77, 0.8][i] ?? 0.8, null)),
    ...STATS.map((s, i) => row('ridge', s, i, [3.8, 4.4, 2.0, 1.45, 0.63, 0.47, 0.88, 0.93][i] ?? 1, [0.8, 0.79, 0.81, 0.8, 0.84, 0.8, 0.78, 0.79][i] ?? 0.8, [true, true, true, true, false, true, true, true][i] ?? null)),
    ...STATS.map((s, i) => row('lgbm', s, i, [3.6, 4.5, 2.05, 1.52, 0.6, 0.5, 0.86, 0.97][i] ?? 1, [0.74, 0.72, 0.75, 0.73, 0.8, 0.77, 0.71, 0.74][i] ?? 0.8, [true, true, true, false, true, false, true, false][i] ?? null)),
  ],
  note: 'Held-out games from the last four weeks. MAE is per player-game; coverage is the share of outcomes inside each model’s 80% band.',
};

export const modelsEmpty: ModelsResponse = { as_of: AS_OF, models: [], note: 'No completed weeks yet: the scoreboard starts after week 1.' };

export const notesNormal: NotesResponse = {
  notes: [
    {
      id: 'n-2026-11-18-1',
      date: '2026-11-18',
      kind: 'warning',
      title: 'Matchup CSV is stale',
      body: 'The **matchup.csv** in the inbox is 31 hours old, so lineup advice uses yesterday’s opponent roster.\n\n- Save a fresh export to `data/inbox/`\n- Run `make inbox`',
      refs: ['jobs/ingest_inbox.py'],
    },
    {
      id: 'n-2026-11-17-1',
      date: '2026-11-17',
      kind: 'finding',
      title: 'Ridge beats baseline on 7 of 8 stats',
      body: 'Over the last four weeks the ridge model has a lower MAE than the EWMA baseline on everything except steals. LightGBM is sharper on minutes but its 80% band covers only 74% of outcomes, so it is **overconfident**.',
      refs: ['DECISIONS.md#phase-3', 'model_scores'],
    },
    {
      id: 'n-2026-11-16-1',
      date: '2026-11-16',
      kind: 'recommendation',
      title: 'Gate the ensemble on calibration',
      body: 'Keep LightGBM out of the ensemble until its coverage is within 3 points of 80%. Details: [model notes](https://example.invalid/model-notes).',
      refs: ['src/research_room/projections/ensemble.py'],
    },
    {
      id: 'n-2026-11-15-1',
      date: '2026-11-15',
      kind: 'update',
      title: 'Nightly job now archives odds',
      body: 'BallDontLie does not keep odds history, so the nightly job stores upcoming lines each day. Spread and total features fill in from this week on.\n\n<script>alert(1)</script> is shown as text, never run.',
      refs: ['jobs/nightly.py'],
    },
  ],
};

export const notesEmpty: NotesResponse = { notes: [] };

/** Draft readiness two days out: the usual gaps, each with its fix (invented, no league data). */
const DRAFT_AT = '2026-10-18T19:00:00-04:00';
export const readinessWarn: ReadinessResponse = {
  as_of: '2026-10-16T20:15:00-04:00',
  draft_starts_at: DRAFT_AT,
  hours_to_draft: 46.8,
  overall: 'warn',
  checks: [
    { key: 'projections', label: 'Basketball Monster projections', status: 'ok', detail: 'snapshot 2026-10-15, 3 days before the draft', action: null },
    { key: 'eligibility', label: 'Yahoo position eligibility', status: 'warn', detail: "62% of the top 200 have Yahoo eligibility; the rest use Basketball Monster's primary position", action: 'save players.csv (all players, with eligible_positions) to data/inbox, run make inbox' },
    { key: 'names', label: 'Yahoo names', status: 'ok', detail: 'all matched', action: null },
    { key: 'slot', label: 'My draft slot', status: 'ok', detail: 'slot 6 of 14', action: null },
    { key: 'rounds', label: 'Draft rounds', status: 'ok', detail: '12 rounds', action: null },
    { key: 'keepers', label: 'Keepers', status: 'ok', detail: '0 configured', action: null },
    { key: 'weeks', label: 'Fantasy week boundaries', status: 'warn', detail: 'weeks 1-19 assumed (affects games-per-week on the board)', action: 'compare with the Yahoo league schedule, then set season.week_boundaries_verified' },
    { key: 'listener', label: 'Pick listener', status: 'warn', detail: 'only tested against the local mock room', action: 'run a Yahoo mock draft with a throwaway draft id (README), then set draft.confirmed.listener: true; manual entry always works' },
    { key: 'schedule', label: 'NBA schedule', status: 'ok', detail: '1200 games for 2026-27', action: null },
    { key: 'board', label: 'Board refresh', status: 'ok', detail: '74 ms for 516 players (budget 500)', action: null },
    { key: 'images', label: 'Headshots', status: 'ok', detail: '489 cached', action: null },
  ],
};

export const readinessReady: ReadinessResponse = {
  ...readinessWarn,
  as_of: '2026-10-18T18:20:00-04:00',
  hours_to_draft: 0.7,
  overall: 'ok',
  checks: readinessWarn.checks.map((c) =>
    c.status === 'ok' ? c : { ...c, status: 'ok', action: null, detail: c.key === 'eligibility' ? '99% of the top 200 have Yahoo eligibility' : c.key === 'weeks' ? 'verified' : 'checked in a Yahoo mock draft' },
  ),
};

export const readinessError: ReadinessResponse = {
  ...readinessWarn,
  overall: 'error',
  checks: [
    { key: 'keepers', label: 'Keepers', status: 'error', detail: "keeper 'Sample Player' not matched (ambiguous); add player_id", action: 'fix draft.keepers in config/settings.yaml' },
    ...readinessWarn.checks.filter((c) => c.key !== 'keepers'),
  ],
};

// ---- live scoreboard (GET /system/scoreboard): illustrative numbers, sized like the backtests
const liveStat = (stat: string, n: number, mae: number, bias: number, coverage: number, played: number) => ({
  stat, n, mae, bias, coverage_80: coverage, played_mae: played,
});

const liveSeason: LiveBlock = {
  days: 34,
  stats: [
    liveStat('minutes', 9120, 5.9, 0.6, 0.79, 5.1),
    liveStat('pts', 9120, 4.9, 0.4, 0.81, 4.6),
    liveStat('reb', 9120, 2.1, 0.1, 0.8, 1.95),
    liveStat('ast', 9120, 1.5, -0.1, 0.82, 1.42),
    liveStat('stl', 9120, 0.71, 0.0, 0.86, 0.7),
    liveStat('blk', 9120, 0.52, 0.02, 0.88, 0.5),
    liveStat('fg3m', 9120, 0.95, 0.05, 0.83, 0.9),
    liveStat('tov', 9120, 0.9, 0.04, 0.8, 0.86),
  ],
  market: [
    { stat: 'pts', n: 1480, market_mae: 4.2, model_mae: 4.7 },
    { stat: 'reb', n: 1210, market_mae: 1.98, model_mae: 2.06 },
    { stat: 'ast', n: 1190, market_mae: 1.49, model_mae: 1.47 },
  ],
  p_play: { n: 9120, brier: 0.071, bias: 0.012 },
  ungraded: 41,
  news: [
    { source: 'nba_report', status: 'Out', listed: 812, played: 1, played_rate: 0.0012, assumed: 0 },
    { source: 'nba_report', status: 'Doubtful', listed: 31, played: 1, played_rate: 0.032, assumed: 0.02 },
    { source: 'nba_report', status: 'Questionable', listed: 143, played: 66, played_rate: 0.462, assumed: 0.49 },
    { source: 'nba_report', status: 'Probable', listed: 58, played: 54, played_rate: 0.931, assumed: 0.91 },
    { source: 'x', status: 'Out', listed: 96, played: 2, played_rate: 0.021, assumed: 0 },
    { source: 'x', status: 'Questionable', listed: 22, played: 12, played_rate: 0.545, assumed: 0.49 },
    { source: 'bdl', status: 'Out', listed: 640, played: 9, played_rate: 0.014, assumed: 0 },
    { source: 'bdl', status: 'Day-To-Day', listed: 118, played: 79, played_rate: 0.669, assumed: 0.6 },
  ],
  weekly_odds: { weeks: 5, brier_all_snapshots: 0.128, brier_first_snapshot: 0.189 },
};

export const liveScoreboardNormal: LiveScoreboardResponse = {
  as_of: AS_OF,
  season_start: '2026-10-20',
  season: liveSeason,
  last_7_days: {
    ...liveSeason,
    days: 7,
    stats: liveSeason.stats.map((r) => ({ ...r, n: Math.round(r.n / 5), mae: r.mae == null ? null : r.mae * 1.04 })),
    market: liveSeason.market.map((r) => ({ ...r, n: Math.round(r.n / 5) })),
    ungraded: 6,
    news: liveSeason.news.map((r) => ({ ...r, listed: Math.max(1, Math.round(r.listed / 5)), played: Math.round(r.played / 5) })),
    weekly_odds: { weeks: 1, brier_all_snapshots: 0.112, brier_first_snapshot: 0.17 },
  },
  note: 'Each finished game is graded against the last projection made before its tip. A game he sat counts 0, as projected.',
};

const earlyBlock: LiveBlock = {
  days: 3,
  stats: liveSeason.stats.map((r) => ({ ...r, n: 780 })),
  market: [],
  p_play: { n: 780, brier: 0.083, bias: 0.031 },
  ungraded: 4,
  news: [
    { source: 'nba_report', status: 'Out', listed: 70, played: 0, played_rate: 0, assumed: 0 },
    { source: 'nba_report', status: 'Questionable', listed: 9, played: 4, played_rate: 0.444, assumed: 0.49 },
  ],
  weekly_odds: null,
};

/** Opening week: a few days graded, no market games or finished weeks yet. */
export const liveScoreboardEarly: LiveScoreboardResponse = {
  ...liveScoreboardNormal,
  season: earlyBlock,
  last_7_days: earlyBlock,
};

const emptyBlock: LiveBlock = { days: 0, stats: [], market: [], p_play: null, ungraded: 0, news: [], weekly_odds: null };

/** Before opening night: nothing graded yet. */
export const liveScoreboardEmpty: LiveScoreboardResponse = {
  as_of: null,
  season_start: '2026-10-20',
  season: emptyBlock,
  last_7_days: emptyBlock,
  note: liveScoreboardNormal.note,
};
