/** Pure display helpers for the draft room (ordering, formatting). No engine math. */
import type { Category, ComparePlayer, DraftTeam, PickInsight, PoolPlayer } from '../api/types';
import { fixed, MISSING, pct, signed } from './format';

/** Signed percentage points: 0.031 -> "+3.1", -0.004 -> "−0.4". */
export function pp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = Math.abs(v * 100).toFixed(1);
  if (Number(s) === 0) return '±0.0';
  return v > 0 ? `+${s}` : `−${s}`;
}

/** Most players the Compare view shows side by side at 402px. */
export const MAX_COMPARE = 3;

/** Index in a list sorted by ADP where my next pick falls (first player expected after it). */
export function projPickIndex(sorted: PoolPlayer[], nextPick: number | null): number | null {
  if (nextPick == null) return null;
  const i = sorted.findIndex((p) => (p.expected_pick ?? Infinity) > nextPick);
  return i === -1 ? sorted.length : i;
}

export type SheetSnap = 'collapsed' | 'half' | 'full';
export const SNAP_ORDER: SheetSnap[] = ['collapsed', 'half', 'full'];

/** Pure: the snap point nearest a dragged height. */
export function nearestSnap(height: number, heights: Record<SheetSnap, number>): SheetSnap {
  return SNAP_ORDER.reduce((best, s) => (Math.abs(heights[s] - height) < Math.abs(heights[best] - height) ? s : best), 'collapsed' as SheetSnap);
}

export type Row = { label: string; get: (p: ComparePlayer) => string; section?: string };

const n1 = (v: number | null | undefined) => fixed(v, 1);
const pct1 = (v: number | null | undefined) => (v == null ? MISSING : `${(v * 100).toFixed(1)}%`);
const z = (v: number | null | undefined) => (v == null ? MISSING : signed(v, 2));
/** The engine's percentage when it sends one; otherwise its makes / attempts per game as-is. */
const shooting = (p: number | null | undefined, made: number | null | undefined, att: number | null | undefined) =>
  p != null ? `${pct1(p)} on ${n1(att)}` : made != null || att != null ? `${n1(made)} / ${n1(att)}` : MISSING;

export function compareRows(categories: Category[]): Row[] {
  const perGame: Row[] = [
    { label: 'PTS', get: (p) => n1(p.pts_mean), section: 'Per game' },
    { label: 'REB', get: (p) => n1(p.reb_mean) },
    { label: 'AST', get: (p) => n1(p.ast_mean) },
    { label: 'ST', get: (p) => n1(p.stl_mean) },
    { label: 'BLK', get: (p) => n1(p.blk_mean) },
    { label: '3PTM', get: (p) => n1(p.fg3m_mean) },
    { label: 'FG%', get: (p) => shooting(p.fg_pct_mean, p.fgm_mean, p.fga_mean) },
    { label: 'FT%', get: (p) => shooting(p.ft_pct_mean, p.ftm_mean, p.fta_mean) },
    { label: 'TO', get: (p) => n1(p.tov_mean) },
  ];
  const zs: Row[] = categories.map((c, i) => ({ label: `${c.label} z`, get: (p) => z(p[`z_${c.key}`]), section: i === 0 ? 'Category z-scores' : undefined }));
  const draft: Row[] = [
    { label: 'Gain', get: (p) => signed(p.gain), section: 'Draft' },
    { label: 'Lasts to next pick', get: (p) => pct(p.p_available_next) },
    { label: 'ADP', get: (p) => n1(p.expected_pick) },
    { label: 'Tier', get: (p) => (p.tier == null ? MISSING : String(p.tier)) },
    { label: 'Injury risk', get: (p) => p.injury_risk ?? MISSING },
  ];
  return [...perGame, ...zs, ...draft];
}

/** Strongest and weakest categories by the engine's z_balance (display ordering only). */
export function strengths(z: Record<string, number | null>, n = 2): { strong: string[]; weak: string[] } {
  const entries = Object.entries(z).filter((e): e is [string, number] => typeof e[1] === 'number');
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  return {
    strong: sorted.filter(([, v]) => v > 0).slice(0, n).map(([k]) => k),
    weak: sorted.filter(([, v]) => v < 0).reverse().slice(0, n).map(([k]) => k),
  };
}

/** True when this team picks after the current pick and before my next one. */
export function picksBeforeMe(t: DraftTeam, currentPick: number | null, myNext: number | null): boolean {
  return !t.is_me && t.next_pick != null && currentPick != null && myNext != null && t.next_pick >= currentPick && t.next_pick < myNext;
}

/** The newest insight for each team. */
export function latestInsightByTeam(insights: PickInsight[] | null | undefined): Map<number, PickInsight> {
  const out = new Map<number, PickInsight>();
  for (const i of insights ?? []) {
    const prev = out.get(i.team_id);
    if (!prev || i.pick_no > prev.pick_no) out.set(i.team_id, i);
  }
  return out;
}
