import type {
  Acquisitions,
  CategoryDelta,
  CategoryKey,
  Move,
  Scenario,
  ScenarioPoint,
  ScenarioResponse,
  WeekContext,
  WinProbEventKind,
  WinProbPoint,
  WinProbabilityResponse,
} from '../../api/season';
import { LAST_DAY_CONTEXT, WEEK_DATES, prov, weekContext } from '../foundations/seasonCommon';
import { AS_OF } from '../foundations/seasonPlayers';
import { movesInjury, movesLastDay, movesNormal } from '../team-builder/moves';
import { ACQ_NORMAL, OPPONENT } from './week';

/**
 * Invented win-probability history and projected scenarios (shape of GET
 * /season/week/probability). The scenario paths and the POST /season/scenario stand-in
 * below are FIXTURE arithmetic only, so stories can toggle moves; the real numbers come
 * from optimizer.py + simulate.py and the UI never computes them.
 */

type H = [day: number, hhmm: string, p: number, kind: WinProbEventKind | null, label: string | null, me: number, opp: number];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Fixture per-category P(win), shifted with the week probability (the engine simulates these). */
const CAT_BASE: Record<CategoryKey, number> = { fg_pct: 0.62, ft_pct: 0.3, fg3m: 0.64, pts: 0.53, reb: 0.57, ast: 0.39, stl: 0.64, blk: 0.49, tov: 0.39 };
function catsAt(p: number, deltas: CategoryDelta[] = []): Partial<Record<CategoryKey, number>> {
  const out: Partial<Record<CategoryKey, number>> = {};
  for (const [k, b] of Object.entries(CAT_BASE) as [CategoryKey, number][]) {
    const d = deltas.find((x) => x.key === k)?.delta_p ?? 0;
    out[k] = r3(Math.min(0.99, Math.max(0.01, b + (p - 0.52) * 0.9 + d)));
  }
  return out;
}
const ts = (day: number, hhmm: string) => `${WEEK_DATES[day]}T${hhmm}:00-05:00`;

function history(rows: H[]): WinProbPoint[] {
  let prev: number | null = null;
  return rows.map(([day, hhmm, p, kind, label, me, opp]) => {
    const s = Math.max(0.01, 0.075 - day * 0.008);
    const pt: WinProbPoint = {
      ts: ts(day, hhmm),
      p_win_week: p,
      lo: r3(Math.max(0, p - s)),
      hi: r3(Math.min(1, p + s)),
      cats_lead: { me, opp },
      event: kind && label ? { kind, label, delta_p: r3(p - (prev ?? p)) } : null,
      p_cats: catsAt(p),
    };
    prev = p;
    return pt;
  });
}

const dayOf = (iso: string) => WEEK_DATES.indexOf(iso.slice(0, 10));

/** Fixture path: each move's gain arrives on its first date; a small interaction bonus scales the total. */
function scenario(id: string, label: string, kind: Scenario['kind'], base: number, grid: string[], moves: Move[], doNothingFinal: number | null): Scenario {
  const f = 1 + 0.08 * Math.max(0, moves.length - 1);
  const points: ScenarioPoint[] = grid.map((t, i) => {
    const applied = moves.filter((m) => dayOf(m.dates[0] ?? t) <= dayOf(t) && i > 0);
    const gain = applied.reduce((a, m) => a + m.delta_p_win.mean, 0) * f;
    const p = r3(Math.min(0.99, Math.max(0.01, base + gain)));
    const spread = r3(0.02 + (0.1 * i) / Math.max(1, grid.length - 1));
    const cat = new Map<CategoryKey, CategoryDelta>();
    for (const m of applied)
      for (const d of m.cat_deltas) {
        const c = cat.get(d.key);
        cat.set(d.key, { key: d.key, delta_p: r3((c?.delta_p ?? 0) + d.delta_p * f), p_after: d.p_after });
      }
    const catDeltas = [...cat.values()].sort((a, b) => Math.abs(b.delta_p) - Math.abs(a.delta_p));
    return {
      ts: t,
      p_win_week: p,
      p_cats: catsAt(base, catDeltas),
      lo: r3(Math.max(0, p - spread)),
      hi: r3(Math.min(1, p + spread)),
      expected_cats: r3(4.5 + (p - 0.5) * 3.2),
      moves_applied: applied.map((m) => m.move_id),
      cat_deltas: catDeltas,
    };
  });
  const last = points[points.length - 1]!;
  return {
    scenario_id: id,
    label,
    kind,
    move_ids: moves.map((m) => m.move_id),
    points,
    final: { p_win_week: last.p_win_week, lo: last.lo, hi: last.hi, expected_cats: last.expected_cats },
    delta_vs_do_nothing: doNothingFinal == null ? null : r3(last.p_win_week - doNothingFinal),
  };
}

function gridFrom(nowIso: string, fromDay: number): string[] {
  const out = [nowIso];
  for (let d = fromDay; d <= 6; d += 1) out.push(ts(d, '23:59'));
  return out;
}

function build(
  week: WeekContext,
  rows: H[],
  current: WinProbabilityResponse['current'],
  plan: Move[],
  alts: { id: string; label: string; moves: Move[] }[] = [],
  asOf = AS_OF,
): WinProbabilityResponse {
  const hist = history(rows);
  const now = hist[hist.length - 1];
  const scenarios: Scenario[] = [];
  if (now && dayOf(now.ts) <= 6 && !(dayOf(now.ts) === 6 && now.ts.endsWith('23:59:00-05:00'))) {
    const grid = gridFrom(now.ts, dayOf(now.ts));
    const base = now.p_win_week;
    scenarios.push(scenario('s-do-nothing', 'Do nothing', 'do_nothing', base, grid, [], null));
    if (plan.length) scenarios.push(scenario('s-recommended', 'Recommended plan', 'recommended', base, grid, plan, base));
    for (const a of alts) scenarios.push(scenario(a.id, a.label, 'custom', base, grid, a.moves, base));
  }
  return {
    as_of: asOf,
    stale: false,
    stale_reason: null,
    provenance: [
      prov('simulate', 'snapshots after each nightly run, game-day refresh and material news'),
      prov('optimizer', 'recommended plan and feasibility'),
      prov('yahoo', 'live category totals'),
    ],
    week,
    opponent: OPPONENT,
    history: hist,
    scenarios,
    recommended_move_ids: plan.map((m) => m.move_id),
    current,
    cats_as_of: '2026-11-18T17:15:00-05:00',
  };
}

const NORMAL_ROWS: H[] = [
  [0, '00:00', 0.55, null, null, 0, 0],
  [0, '06:31', 0.56, 'nightly', 'Nightly projections refreshed', 0, 0],
  [0, '23:40', 0.48, 'games_final', 'Mon games final: they played 8 to your 7', 4, 5],
  [1, '06:31', 0.47, 'nightly', 'Nightly projections refreshed', 4, 5],
  [1, '15:10', 0.51, 'lineup', 'Lineup confirmed: Lindqvist into a C slot for Thu', 4, 5],
  [1, '23:50', 0.44, 'games_final', 'Tue games final: AST gap grew to 14', 3, 6],
  [2, '06:31', 0.49, 'nightly', 'Nightly projections refreshed', 3, 6],
  [2, '14:14', 0.53, 'news', 'Opponent’s Felix Marlowe day-to-day (back)', 4, 5],
  [2, '17:40', 0.52, 'nightly', 'Optimizer re-solved Wed–Sun', 4, 5],
];

const M = movesNormal.moves;
const byId = (id: string) => M.find((m) => m.move_id === id)!;

/** Lead changes through Wednesday; the plan takes it from 52% to about 63%. */
export const probNormal = build(weekContext(), NORMAL_ROWS, { p_win_week: 0.52, delta_since_yesterday: 0.08 }, M);

/** Compare three named alternatives against the recommended plan. */
export const probCompare = build(weekContext(), NORMAL_ROWS, { p_win_week: 0.52, delta_since_yesterday: 0.08 }, M, [
  { id: 's-stream-c', label: 'Stream a C', moves: [byId('m-add-bramwell')] },
  { id: 's-stream-g', label: 'Stream a G', moves: [byId('m-add-northcott')] },
  { id: 's-lineup-only', label: 'Lineup only', moves: [byId('m-start-pellham'), byId('m-bench-rosswell')] },
]);

/** Midweek lead. */
export const probLead = build(
  weekContext(),
  [
    [0, '00:00', 0.54, null, null, 0, 0],
    [0, '23:40', 0.59, 'games_final', 'Mon games final', 5, 4],
    [1, '06:31', 0.6, 'nightly', 'Nightly projections refreshed', 5, 4],
    [1, '23:50', 0.63, 'games_final', 'Tue games final: BLK lead grew', 6, 3],
    [2, '11:02', 0.6, 'news', 'Opponent’s Grant Wexford cleared to play', 5, 4],
    [2, '17:40', 0.61, 'nightly', 'Optimizer re-solved Wed–Sun', 5, 4],
  ],
  { p_win_week: 0.61, delta_since_yesterday: -0.02 },
  M,
);

/** Midweek deficit; the plan flips it above 50%. */
export const probDeficit = build(
  weekContext(),
  [
    [0, '00:00', 0.5, null, null, 0, 0],
    [0, '23:40', 0.45, 'games_final', 'Mon games final', 4, 5],
    [1, '23:50', 0.4, 'games_final', 'Tue games final: AST gap grew to 14', 3, 6],
    [2, '06:31', 0.43, 'nightly', 'Nightly projections refreshed', 3, 6],
    [2, '17:40', 0.44, 'nightly', 'Optimizer re-solved Wed–Sun', 3, 6],
  ],
  { p_win_week: 0.44, delta_since_yesterday: 0.04 },
  M,
);

export const probComfortable = build(
  weekContext(),
  [
    [0, '00:00', 0.62, null, null, 0, 0],
    [0, '23:40', 0.7, 'games_final', 'Mon games final: you took 6 of 9', 6, 3],
    [1, '23:50', 0.79, 'games_final', 'Tue games final', 6, 3],
    [2, '11:02', 0.84, 'transaction', 'Waiver claim cleared: Nico Northcott', 7, 2],
    [2, '17:40', 0.86, 'nightly', 'Optimizer re-solved Wed–Sun', 7, 2],
  ],
  { p_win_week: 0.86, delta_since_yesterday: 0.07 },
  [byId('m-start-pellham')],
);

export const probComeback = build(
  weekContext(),
  [
    [0, '00:00', 0.41, null, null, 0, 0],
    [0, '23:40', 0.33, 'games_final', 'Mon games final: you were down 3 games', 3, 6],
    [1, '06:31', 0.3, 'nightly', 'Nightly projections refreshed', 3, 6],
    [1, '12:20', 0.38, 'transaction', 'You added Jonah Sefton', 3, 6],
    [1, '23:50', 0.46, 'games_final', 'Tue games final: BLK flipped to you', 4, 5],
    [2, '09:44', 0.55, 'news', 'Opponent’s Grant Wexford ruled out (calf)', 5, 4],
    [2, '17:40', 0.61, 'nightly', 'Optimizer re-solved Wed–Sun', 5, 4],
  ],
  { p_win_week: 0.61, delta_since_yesterday: 0.23 },
  M,
);

/** Collapse after injury news on Wednesday evening (matches the injury week fixtures). */
export const probCollapse = build(
  weekContext(),
  [
    [0, '00:00', 0.58, null, null, 0, 0],
    [0, '23:40', 0.63, 'games_final', 'Mon games final', 5, 4],
    [1, '06:31', 0.64, 'nightly', 'Nightly projections refreshed', 5, 4],
    [1, '23:50', 0.6, 'games_final', 'Tue games final', 5, 4],
    [2, '06:31', 0.59, 'nightly', 'Nightly projections refreshed', 5, 4],
    [2, '17:31', 0.47, 'news', 'Soren Halvorsen ruled out tonight (ankle)', 4, 5],
  ],
  { p_win_week: 0.47, delta_since_yesterday: -0.13 },
  movesInjury.moves,
  [],
  '2026-11-18T17:34:00-05:00',
);

/** Monday morning: only the opening snapshot. */
export const probMonday = build(
  weekContext({ today: WEEK_DATES[0]!, days_left: 7 }),
  [[0, '06:31', 0.55, 'nightly', 'Week opens: projection from the nightly run', 0, 0]],
  { p_win_week: 0.55, delta_since_yesterday: null },
  M,
  [],
  '2026-11-16T06:40:00-05:00',
);

const FULL_WEEK: H[] = [
  [0, '00:00', 0.5, null, null, 0, 0],
  [0, '23:40', 0.46, 'games_final', 'Mon games final', 4, 5],
  [1, '23:50', 0.41, 'games_final', 'Tue games final', 3, 6],
  [2, '17:31', 0.47, 'news', 'Opponent’s Felix Marlowe out Wed', 4, 5],
  [2, '23:45', 0.53, 'games_final', 'Wed games final: REB flipped to you', 5, 4],
  [3, '23:30', 0.58, 'games_final', 'Thu games final', 5, 4],
  [4, '23:55', 0.49, 'games_final', 'Fri games final: they took PTS', 4, 5],
  [5, '23:50', 0.53, 'games_final', 'Sat games final', 4, 5],
];

/** Sunday morning: one day left, two moves on the table. */
export const probLastDay = build(
  LAST_DAY_CONTEXT,
  [...FULL_WEEK, [6, '11:05', 0.55, 'nightly', 'Sunday morning refresh', 5, 4]],
  { p_win_week: 0.55, delta_since_yesterday: 0.02 },
  movesLastDay.moves,
  [],
  '2026-11-22T11:05:00-05:00',
);

/** The week is over: you won 5–4. */
export const probFinal = build(
  LAST_DAY_CONTEXT,
  [
    ...FULL_WEEK,
    [6, '15:40', 0.64, 'transaction', 'You streamed Ravi Hargreave', 5, 4],
    [6, '23:59', 1, 'games_final', 'Week final: you won 5–4', 5, 4],
  ],
  { p_win_week: 1, delta_since_yesterday: 0.47 },
  [],
  [],
  '2026-11-22T23:59:00-05:00',
);

export const probEmpty: WinProbabilityResponse = { ...probNormal, history: [], scenarios: [], recommended_move_ids: [], current: null, cats_as_of: null };

/**
 * FIXTURE stand-in for POST /season/scenario so stories can toggle moves. The real response
 * comes from optimizer.py (feasibility) and simulate.py (the path).
 */
export function mockScenarioEngine(base: WinProbabilityResponse, moves: Move[], selected: string[], acq: Acquisitions = ACQ_NORMAL): ScenarioResponse {
  const chosen = moves.filter((m) => selected.includes(m.move_id));
  const acqUsed = acq.used + chosen.filter((m) => m.uses_acquisition).length;
  const incompatible = moves
    .filter((m) => !selected.includes(m.move_id) && m.uses_acquisition && acqUsed + 1 > acq.max)
    .map((m) => ({ move_id: m.move_id, reason: `Would use ${acqUsed + 1} of ${acq.max} acquisitions` }));
  if (acqUsed > acq.max) {
    return { scenario: null, feasible: false, message: `Uses ${acqUsed} of ${acq.max} acquisitions`, solve_ms: 410, incompatible };
  }
  const now = base.history[base.history.length - 1]!;
  const grid = base.scenarios[0]?.points.map((p) => p.ts) ?? [now.ts];
  const dn = base.scenarios.find((s) => s.kind === 'do_nothing');
  const sameAsRec = chosen.length === base.recommended_move_ids.length && chosen.every((m) => base.recommended_move_ids.includes(m.move_id));
  return {
    scenario: scenario(sameAsRec ? 's-recommended' : `s-custom-${selected.join('-')}`, sameAsRec ? 'Recommended plan' : 'Your selection', sameAsRec ? 'recommended' : 'custom', now.p_win_week, grid, chosen, dn?.final.p_win_week ?? now.p_win_week),
    feasible: true,
    message: null,
    solve_ms: 1840,
    incompatible,
  };
}

/** The week is over: you lost 4–5. */
export const probFinalLoss = build(
  LAST_DAY_CONTEXT,
  [
    ...FULL_WEEK,
    [6, '14:10', 0.38, 'news', 'Soren Halvorsen ruled out Sunday', 4, 5],
    [6, '23:59', 0, 'games_final', 'Week final: you lost 4–5', 4, 5],
  ],
  { p_win_week: 0, delta_since_yesterday: -0.53 },
  [],
  [],
  '2026-11-22T23:59:00-05:00',
);
