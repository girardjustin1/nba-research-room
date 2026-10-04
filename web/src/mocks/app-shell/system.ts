import type { HealthResponse, ModelsResponse, NotesResponse } from '../../api/system';

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
