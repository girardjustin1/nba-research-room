import type { ModelScoreboard, ScoreRow } from '../../api/season';
import { conf, prov } from '../foundations/seasonCommon';

/** Invented backtest scoreboard (shape of backtest.py / model_scores). */

const STATS = ['min', 'pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'tov'] as const;
const BASE_MAE: Record<(typeof STATS)[number], number> = { min: 4.62, pts: 4.91, reb: 2.14, ast: 1.52, fg3m: 0.98, stl: 0.61, blk: 0.55, tov: 0.88 };
/** Relative MAE vs baseline by model (1 = same as EWMA). */
const REL: Record<string, number[]> = {
  LightGBM: [0.911, 0.952, 0.957, 0.967, 0.99, 1.0, 0.982, 0.977],
  Hierarchical: [0.937, 0.962, 0.948, 0.961, 0.98, 0.984, 0.964, 0.989],
  CatBoost: [0.952, 0.97, 0.972, 0.974, 1.01, 0.997, 0.991, 0.995],
  Ridge: [1.019, 1.006, 0.995, 1.012, 1.02, 1.016, 1.009, 1.003],
  Ensemble: [0.903, 0.944, 0.941, 0.954, 0.975, 0.984, 0.969, 0.975],
};

function scoreRows(): ScoreRow[] {
  const rows: ScoreRow[] = STATS.map((stat) => ({
    model: 'EWMA baseline',
    stat,
    mae: BASE_MAE[stat],
    baseline_mae: BASE_MAE[stat],
    rel_improvement: 0,
    beats_baseline: false,
    weight: null,
    gated_on: true,
  }));
  for (const [model, rel] of Object.entries(REL)) {
    STATS.forEach((stat, i) => {
      const mae = Math.round(BASE_MAE[stat] * rel[i]! * 1000) / 1000;
      const beats = mae < BASE_MAE[stat] - 1e-9;
      rows.push({
        model,
        stat,
        mae,
        baseline_mae: BASE_MAE[stat],
        rel_improvement: Math.round((1 - rel[i]!) * 1000) / 1000,
        beats_baseline: beats,
        weight: model === 'Ensemble' || model === 'Ridge' ? null : beats ? Math.round((0.2 + (1 - rel[i]!) * 3) * 100) / 100 : 0.05,
        gated_on: model !== 'Ridge',
      });
    });
  }
  return rows;
}

export const SCOREBOARD: ModelScoreboard = {
  as_of: '2026-11-16T06:52:00-05:00',
  scope_label: 'Weeks 1–3, 2026-27',
  from_week: 1,
  to_week: 3,
  games_scored: 3874,
  rows: scoreRows(),
  calibration: {
    bins: [
      { lo: 0, hi: 0.2, predicted: 0.12, observed: 0.09, n: 23 },
      { lo: 0.2, hi: 0.4, predicted: 0.31, observed: 0.36, n: 41 },
      { lo: 0.4, hi: 0.6, predicted: 0.5, observed: 0.47, n: 58 },
      { lo: 0.6, hi: 0.8, predicted: 0.69, observed: 0.73, n: 44 },
      { lo: 0.8, hi: 1, predicted: 0.88, observed: 0.91, n: 23 },
    ],
    brier: 0.201,
    brier_baseline: 0.214,
    baseline_label: 'EWMA-only simulation',
  },
  ensemble_gated_on: true,
  provenance: [prov('backtest', 'replay of weeks 1–3, features as of each tip'), prov('projections')],
  confidence: conf('medium', 0.62, [
    { key: 'sample', label: 'Three weeks of games (189 category-weeks across the league)', effect: 'Calibration bins are wide; read the n' },
  ]),
};


/** Preseason: no completed week yet, so the scoreboard is last season's replay. */
export const SCOREBOARD_PRESEASON: ModelScoreboard = {
  ...SCOREBOARD,
  scope_label: '2025-26 replay (preseason)',
  from_week: 1,
  to_week: 22,
  games_scored: 26_410,
  confidence: conf('medium', 0.6, [{ key: 'season', label: 'Last season’s replay, not this season', effect: 'Rosters and roles have changed' }]),
};

/** A stat where nothing beats EWMA yet (ensemble stays gated off for it). */
export const SCOREBOARD_GATED_OFF: ModelScoreboard = {
  ...SCOREBOARD,
  rows: SCOREBOARD.rows.map((r) => (r.stat === 'stl' && r.model !== 'EWMA baseline' ? { ...r, mae: r.baseline_mae * 1.02, rel_improvement: -0.02, beats_baseline: false, gated_on: false, weight: null } : r)),
  ensemble_gated_on: false,
};
