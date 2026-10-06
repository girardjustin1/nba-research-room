import type { FetchLike } from './client';
import { seasonGet } from './seasonClient';

/** Types for the System endpoints (diagnostics). The engine computes every value. */
export type CheckStatus = 'ok' | 'warn' | 'error';

export interface HealthCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  last_ok_at: string | null;
  freshness_budget_h: number | null;
  /** Next step, e.g. "run make nightly". */
  action: string | null;
}

export interface HealthResponse {
  as_of: string;
  overall: CheckStatus;
  checks: HealthCheck[];
  store: { db_bytes: number; tables: { table: string; rows: number }[] };
  jobs: { source: string; job: string; status: string; finished_at: string | null; rows: number | null; detail: string | null }[];
}

export interface ModelScore {
  model: string;
  stat: string;
  window_start: string;
  window_end: string;
  mae: number | null;
  rmse: number | null;
  /** Share of outcomes inside the 80% band (target 0.80). */
  coverage_80: number | null;
  n: number;
  beats_baseline: boolean | null;
}

export interface ModelsResponse {
  as_of: string;
  models: ModelScore[];
  note: string | null;
}

export type NoteKind = 'update' | 'finding' | 'recommendation' | 'warning';

export interface SystemNote {
  id: string;
  date: string;
  kind: NoteKind;
  title: string;
  /** Plain markdown (no HTML is ever rendered). */
  body: string;
  refs: string[];
}

export interface NotesResponse {
  notes: SystemNote[];
}

/** GET /system/readiness (also `make doctor`): what the draft board needs before draft night. */
export interface ReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What fixes it; null when the check passes. */
  action: string | null;
}

export interface ReadinessResponse {
  as_of: string;
  draft_starts_at: string;
  /** Negative once the draft has started. */
  hours_to_draft: number;
  overall: CheckStatus;
  checks: ReadinessCheck[];
}

/** One stat's live grade: the last projection before each tip against the box score. */
export interface LiveStat {
  stat: string;
  n: number;
  mae: number | null;
  /** Mean of projected minus actual: positive projects high. */
  bias: number | null;
  /** Share of outcomes inside the projection's 80% band (target 0.80). */
  coverage_80: number | null;
  /** Error of his line if he plays, on games he played. */
  played_mae: number | null;
}

/** Games the betting market set: the market's number against our model's own, same games. */
export interface LiveMarket {
  stat: string;
  n: number;
  market_mae: number | null;
  model_mae: number | null;
}

/** How often a player a news source listed with a status that day actually played. */
export interface LiveNews {
  /** x | nba_report | bdl */
  source: string;
  status: string;
  listed: number;
  played: number;
  played_rate: number | null;
  /** P(plays) the engine assumes for that status. */
  assumed: number | null;
}

export interface LiveBlock {
  /** Game days graded in the window. */
  days: number;
  stats: LiveStat[];
  market: LiveMarket[];
  /** Brier score of P(plays) against whether he played; bias = mean P(plays) - played rate. */
  p_play: { n: number; brier: number | null; bias: number | null } | null;
  /** Projected player-games with no box-score row (not graded). */
  ungraded: number;
  news: LiveNews[];
  /** P(win week) snapshots against the week's final Yahoo result. */
  weekly_odds: { weeks: number; brier_all_snapshots: number; brier_first_snapshot: number } | null;
}

/** GET /system/scoreboard: live_scores.py, the season so far and the last 7 days. */
export interface LiveScoreboardResponse {
  as_of: string | null;
  season_start: string;
  season: LiveBlock;
  last_7_days: LiveBlock;
  note: string | null;
}

export interface SystemApi {
  health(): Promise<HealthResponse>;
  readiness(): Promise<ReadinessResponse>;
  models(): Promise<ModelsResponse>;
  scoreboard(): Promise<LiveScoreboardResponse>;
  notes(): Promise<NotesResponse>;
}

export function createSystemApi(base = '/api', fetchImpl?: FetchLike): SystemApi {
  return {
    health: () => seasonGet(base, '/system/health', fetchImpl),
    readiness: () => seasonGet(base, '/system/readiness', fetchImpl),
    models: () => seasonGet(base, '/system/models', fetchImpl),
    scoreboard: () => seasonGet(base, '/system/scoreboard', fetchImpl),
    notes: () => seasonGet(base, '/system/notes', fetchImpl),
  };
}
