import type {
  BoardComplete,
  BoardLive,
  Category,
  MyTeam,
  PickRecord,
  PoolPlayer,
  Recommendation,
  Session,
} from '../api/types';
import { SAMPLE_PLAYERS, seeded } from './players';

/**
 * Invented fixtures in the exact shapes the draft API returns. All numbers are synthetic.
 * Snake pick numbers here are computed only to build plausible mock sessions; the app
 * itself takes pick numbers from the API (`my_picks`, `decision_pick`, `following_pick`).
 */

export const CATEGORIES: Category[] = [
  { key: 'fg_pct', label: 'FG%' },
  { key: 'ft_pct', label: 'FT%' },
  { key: 'fg3m', label: '3PTM' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'ST' },
  { key: 'blk', label: 'BLK' },
  { key: 'tov', label: 'TO' },
];

const TEAMS = 14;
const ROUNDS = 13;
const SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'Util', 'Util'];

function mockPickNumber(round: number, slot: number): number {
  return (round - 1) * TEAMS + (round % 2 === 1 ? slot : TEAMS + 1 - slot);
}

export function mockMyPicks(slot: number): number[] {
  return Array.from({ length: ROUNDS }, (_, r) => mockPickNumber(r + 1, slot));
}

function teamForPick(pick: number): number {
  const round = Math.ceil(pick / TEAMS);
  const idx = pick - (round - 1) * TEAMS;
  return round % 2 === 1 ? idx : TEAMS + 1 - idx;
}

/** Picks 1..(currentPick-1), taken in sample-player order. */
export function mockPicks(currentPick: number): PickRecord[] {
  return Array.from({ length: Math.max(0, currentPick - 1) }, (_, i) => {
    const pick = i + 1;
    const p = SAMPLE_PLAYERS[i];
    return {
      pick_no: pick,
      round: Math.ceil(pick / TEAMS),
      team_id: teamForPick(pick),
      player_id: p?.player_id ?? null,
      player_name: p?.name ?? `Sample Player ${pick}`,
      is_keeper: false,
    };
  });
}

export function makeSession(opts: { mySlot?: number | null; currentPick?: number | null; punts?: string[] } = {}): Session {
  const mySlot = opts.mySlot === undefined ? 5 : opts.mySlot;
  const total = TEAMS * ROUNDS;
  const current = opts.currentPick === undefined ? 5 : opts.currentPick;
  const picks = mockPicks(current ?? total + 1);
  return {
    draft_id: 'sample-league-2026',
    my_slot: mySlot,
    teams: TEAMS,
    rounds: ROUNDS,
    total_picks: total,
    current_pick: current,
    on_the_clock: current == null ? null : teamForPick(current),
    my_picks: mySlot ? mockMyPicks(mySlot) : [],
    punts: opts.punts ?? [],
    pick_clock_seconds: 60,
    categories: CATEGORIES,
    picks,
  };
}

function poolFor(session: Session): PoolPlayer[] {
  const taken = new Set(session.picks.map((p) => p.player_id));
  return SAMPLE_PLAYERS.filter((p) => !taken.has(p.player_id)).map((p) => ({ ...p, drafted: false }));
}

export function makePool(session: Session): PoolPlayer[] {
  return poolFor(session);
}

const REASON_BITS = [
  'helps REB +6%, BLK +4%',
  'helps AST +5%, ST +3%',
  'helps 3PTM +7%, FT% +2%',
  'fills an open C slot',
  'fills an open PG slot',
];

function makeRecommendations(session: Session, following: number | null, seed: number): Recommendation[] {
  const rnd = seeded(seed);
  return poolFor(session)
    .slice(0, 10)
    .map((p, i) => {
      const gain = Math.round((0.42 - i * 0.045 + (rnd() - 0.5) * 0.04) * 100) / 100;
      const pNext = Math.round(Math.min(0.98, Math.max(0.004, 0.05 + i * 0.09 + (rnd() - 0.5) * 0.1)) * 1000) / 1000;
      const pNow = Math.round(Math.min(1, 0.7 + i * 0.03 + rnd() * 0.05) * 1000) / 1000;
      const reasons = [`${gain >= 0 ? '+' : ''}${gain.toFixed(2)} expected categories vs a typical pick here`];
      reasons.push(REASON_BITS[i % REASON_BITS.length] ?? '');
      if (following) {
        if (pNext < 0.25) reasons.push(`${pNext < 0.01 ? 'under 1%' : `only ${Math.round(pNext * 100)}%`} likely to last to pick ${following}`);
        else if (pNext > 0.75) reasons.push(`${Math.round(pNext * 100)}% likely still there at pick ${following}: you could wait`);
      }
      if (p.sources === 'bbm_only') reasons.push('no 2025-26 sample: projection is BBM-only, lower confidence');
      if (p.adp_source === 'bbm_rank') reasons.push('no ADP: availability estimate is rough');
      if (p.injury_risk === 'H') reasons.push('BBM injury risk H');
      return {
        ...p,
        expected_cats: Math.round((4.6 + gain) * 100) / 100,
        gain,
        p_win_week: Math.round((0.52 + gain * 0.2) * 1000) / 1000,
        p_win_week_mc: i < 5 ? Math.round((0.51 + gain * 0.2) * 1000) / 1000 : null,
        p_available_at_decision: session.current_pick === null ? null : pNow,
        p_available_next: following ? pNext : null,
        reasons: reasons.join('; '),
      };
    });
}

/** P(win category) vs a league-average team: invented, includes wins, losses and near-even. */
export const SAMPLE_P_CAT: Record<string, number> = {
  fg_pct: 0.61,
  ft_pct: 0.22,
  fg3m: 0.47,
  pts: 0.58,
  reb: 0.71,
  ast: 0.39,
  stl: 0.51,
  blk: 0.83,
  tov: 0.34,
};

export function makeMyTeam(session: Session, pCat: Record<string, number> = SAMPLE_P_CAT): MyTeam {
  const mine = session.picks.filter((p) => p.team_id === session.my_slot);
  const roster = SAMPLE_PLAYERS.filter((p) => mine.some((m) => m.player_id === p.player_id));
  const filled = new Set<number>();
  const open = SLOTS.filter((slot) => {
    const idx = roster.findIndex((p, i) => !filled.has(i) && (p.eligible ?? []).includes(slot));
    if (idx >= 0) {
      filled.add(idx);
      return false;
    }
    return true;
  });
  const empty = roster.length === 0;
  const p_cat = Object.fromEntries(CATEGORIES.map((c) => [c.key, empty ? 0.5 : (pCat[c.key] ?? 0.5)]));
  return {
    p_cat,
    expected_cats: empty ? 4.5 : Math.round(Object.values(p_cat).reduce((a, b) => a + b, 0) * 100) / 100,
    p_win_week: empty ? 0.5 : 0.57,
    open_slots: open,
    z_balance: Object.fromEntries(CATEGORIES.map((c) => [c.key, empty ? 0 : Math.round(((pCat[c.key] ?? 0.5) - 0.5) * 400) / 100])),
    roster,
  };
}

export function makeBoard(session: Session, opts: { drift?: string[]; seed?: number; pCat?: Record<string, number> } = {}): BoardLive {
  const current = session.current_pick ?? 1;
  const mine = session.my_picks.filter((p) => p >= current);
  const decision = mine[0] ?? current;
  const following = mine[1] ?? null;
  return {
    complete: false,
    decision_pick: decision,
    following_pick: following,
    on_the_clock: session.on_the_clock,
    recommendations: makeRecommendations(session, following, opts.seed ?? 3),
    my_team: makeMyTeam(session, opts.pCat),
    drift: opts.drift ?? [],
    timings_ms: { setup: 41.2, score: 180.4, monte_carlo: 512.9, total: 734.5 },
  };
}

export function makeCompleteBoard(session: Session): BoardComplete {
  return { complete: true, ...session, current_pick: null, on_the_clock: null };
}

// ---- named scenarios -------------------------------------------------------------
/** Slot 5, pick 5: I'm on the clock in round 1. */
export const onTheClockSession = makeSession({ mySlot: 5, currentPick: 5 });
export const onTheClockBoard = makeBoard(onTheClockSession);

/** Slot 5, pick 30 (round 3): waiting; my next pick is 33. */
export const waitingSession = makeSession({ mySlot: 5, currentPick: 30 });
export const waitingBoard = makeBoard(waitingSession);

/** Slot 5, pick 61 (round 5): four players on my roster and punt drift on FT% and TO. */
export const driftSession = makeSession({ mySlot: 5, currentPick: 61 });
export const driftBoard = makeBoard(driftSession, { drift: ['ft_pct', 'tov'] });

/** Punting FT% on purpose. */
export const puntSession = makeSession({ mySlot: 5, currentPick: 61, punts: ['ft_pct'] });
export const puntBoard = makeBoard(puntSession);

export const completeSession = makeSession({ mySlot: 5, currentPick: null });
export const completeBoard = makeCompleteBoard(completeSession);
