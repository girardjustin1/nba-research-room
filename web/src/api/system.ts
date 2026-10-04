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

export interface SystemApi {
  health(): Promise<HealthResponse>;
  models(): Promise<ModelsResponse>;
  notes(): Promise<NotesResponse>;
}

export function createSystemApi(base = '/api', fetchImpl?: FetchLike): SystemApi {
  return {
    health: () => seasonGet(base, '/system/health', fetchImpl),
    models: () => seasonGet(base, '/system/models', fetchImpl),
    notes: () => seasonGet(base, '/system/notes', fetchImpl),
  };
}
