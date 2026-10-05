import type {
  ComparePlayer,
  DraftTeam,
  PickInsight,
  TeamDay,
  TeamWeeksResponse,
  PositionalValue,
  PositionKey,
  BoardComplete,
  BoardLive,
  Category,
  MyTeam,
  PickRecord,
  PoolPlayer,
  Recommendation,
  Session,
  StrengthResponse,
} from '../../api/types';
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

/** Invented league team names (slot 1..14). */
export const TEAM_NAMES: Record<string, string> = {
  '1': 'Sample Splash Bros',
  '2': 'Fictional Five',
  '3': 'Made-Up Monstars',
  '4': 'Pretend Pistons',
  '5': 'My Sample Squad',
  '6': 'Imaginary Iso Kings',
  '7': 'Placeholder Pacers',
  '8': 'Test Tube Titans',
  '9': 'Mock Turtle Dunks',
  '10': 'Dummy Data Dimes',
  '11': 'Faux Fastbreak',
  '12': 'Nominal Nets',
  '13': 'Lorem Ipsum Ballers',
  '14': 'Example Elbows',
};
const ROUNDS = 13;
const SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'Util', 'Util'];

function mockPickNumber(round: number, slot: number): number {
  return (round - 1) * TEAMS + (round % 2 === 1 ? slot : TEAMS + 1 - slot);
}

export function mockMyPicks(slot: number): number[] {
  return Array.from({ length: ROUNDS }, (_, r) => mockPickNumber(r + 1, slot));
}

/** Snake owner of an overall pick in the 14-team mock league (mock engine only; the real API owns this). */
export function teamForPick(pick: number): number {
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
    team_names: { ...TEAM_NAMES, ...(mySlot ? { [String(mySlot)]: 'You' } : {}) },
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
      const dps = Object.fromEntries(
        CATEGORIES.map((c, k) => [`dp_${c.key}`, Math.round((((i * 3 + k * 7) % 11) - 4) * 0.006 * 1000) / 1000]),
      );
      return {
        ...p,
        ...dps,
        starts: i % 3 !== 2,
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

// ---- newer endpoints ------------------------------------------------------------

const POS_LIST: PositionKey[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** GET /draft/teams for a session: rosters from the mock picks; needs and z are invented. */
export function makeTeams(session: Session): DraftTeam[] {
  const rnd = seeded(11);
  const current = session.current_pick;
  return Array.from({ length: session.teams }, (_, i) => {
    const slot = i + 1;
    const ids = new Set(session.picks.filter((p) => p.team_id === slot).map((p) => p.player_id));
    const roster = SAMPLE_PLAYERS.filter((p) => ids.has(p.player_id));
    const counts = Object.fromEntries(POS_LIST.map((pos) => [pos, roster.filter((p) => p.position === pos).length]));
    const open = SLOTS.filter((s) => !roster.some((p) => (p.eligible ?? []).includes(s))).slice(0, Math.max(0, 10 - roster.length));
    const next = current == null ? null : (Array.from({ length: ROUNDS }, (_, r) => mockPickNumber(r + 1, slot)).find((p) => p >= current) ?? null);
    return {
      team_id: slot,
      name: slot === session.my_slot ? 'You' : (TEAM_NAMES[String(slot)] ?? `Team ${slot}`),
      is_me: slot === session.my_slot,
      roster,
      position_counts: counts,
      open_slots: open,
      z_balance: Object.fromEntries(CATEGORIES.map((c) => [c.key, roster.length ? Math.round((rnd() * 4 - 2) * 100) / 100 : 0])),
      next_pick: next,
      picks_until_next: next == null || current == null ? null : next - current,
    };
  });
}

/** GET /draft/strength: invented league comparison. My values are SAMPLE_P_CAT, so the Me vs
 * league table agrees with the board's per-category chances. */
export function makeStrength(session: Session, pCat: Record<string, number> = SAMPLE_P_CAT): StrengthResponse {
  const rnd = seeded(23);
  const me = session.my_slot;
  // scale 1: probabilities (kept inside 3%..97%); scale 6: expected categories (0..9).
  const row = (mine: number, scale: number, key: string) => {
    const hi = scale === 1 ? 0.97 : 9;
    const lo = scale === 1 ? 0.03 : 0;
    const others = Array.from({ length: session.teams - 1 }, () => Math.min(hi, Math.max(lo, mine + (rnd() - 0.5) * 0.5 * scale)));
    const all = [mine, ...others];
    const bestIdx = all.indexOf(Math.max(...all));
    const otherSlots = Array.from({ length: session.teams }, (_, i) => i + 1).filter((t) => t !== me);
    const bestTeam = bestIdx === 0 ? (me ?? 1) : otherSlots[bestIdx - 1]!;
    return {
      key,
      me: me == null ? null : mine,
      league_avg: all.reduce((a, b) => a + b, 0) / all.length,
      best: all[bestIdx]!,
      best_team_id: bestTeam,
      best_team_name: bestTeam === me ? 'You' : (TEAM_NAMES[String(bestTeam)] ?? `Team ${bestTeam}`),
      rank: me == null ? null : 1 + others.filter((v) => v > mine).length,
    };
  };
  const categories = CATEGORIES.map((c) => ({ ...row(pCat[c.key] ?? 0.5, 1, c.key), label: c.label }));
  const expected = Object.values(pCat).reduce((a, b) => a + b, 0);
  const { key: _omit, ...expected_cats } = row(expected, 6, 'expected');
  void _omit;
  return { teams: session.teams, categories, expected_cats, my_slot: me, punts: session.punts, current_pick: session.current_pick };
}

/** GET /draft/positional_value: invented VOR per position. */
export function makePositional(scale: number[] = [0.82, 0.35, 0.58, 0.2, 0.67]): PositionalValue[] {
  // Like the engine, the top position is 1 (= 100) and the rest are relative to it.
  const top = Math.max(...scale) || 1;
  return POS_LIST.map((pos, i) => {
    const best = SAMPLE_PLAYERS.find((p) => p.position === pos) ?? null;
    const s = (scale[i] ?? 0.5) / top;
    return {
      pos,
      best_available: best ? { player_id: best.player_id, name: best.name, value: best.value } : null,
      replacement_value: 1.2,
      value_over_replacement: Math.round(s * 400) / 100,
      scale_0_1: s,
      my_open_slots: i === 4 ? 2 : 1,
    };
  });
}

/** GET /draft/compare: invented per-game lines and z for the given ids. */
export function makeCompare(ids: number[]): ComparePlayer[] {
  return ids.map((id, i) => {
    const p = SAMPLE_PLAYERS.find((x) => x.player_id === id) ?? SAMPLE_PLAYERS[0]!;
    const r = seeded(id);
    const zs = Object.fromEntries(CATEGORIES.map((c) => [`z_${c.key}`, Math.round((r() * 3 - 1) * 100) / 100]));
    return {
      ...p,
      ...zs,
      pts_mean: Math.round((14 + r() * 14) * 10) / 10,
      reb_mean: Math.round((3 + r() * 8) * 10) / 10,
      ast_mean: Math.round((1.5 + r() * 7) * 10) / 10,
      stl_mean: Math.round((0.5 + r() * 1.3) * 10) / 10,
      blk_mean: Math.round((0.2 + r() * 1.8) * 10) / 10,
      fg3m_mean: Math.round((0.4 + r() * 2.8) * 10) / 10,
      fg_pct_mean: Math.round((0.43 + r() * 0.12) * 1000) / 1000,
      fga_mean: Math.round((9 + r() * 10) * 10) / 10,
      ft_pct_mean: Math.round((0.68 + r() * 0.22) * 1000) / 1000,
      fta_mean: Math.round((2 + r() * 6) * 10) / 10,
      tov_mean: Math.round((1 + r() * 2.5) * 10) / 10,
      gain: Math.round((0.35 - i * 0.08) * 100) / 100,
      p_available_next: Math.round((0.1 + i * 0.25) * 100) / 100,
    };
  });
}

/** GET /draft/insights: an invented live read for each of the last `last` picks. */
export function makeInsights(session: Session, last = 28): PickInsight[] {
  const teams = makeTeams(session);
  return session.picks.slice(-last).map((pk) => {
    const r = seeded(pk.pick_no * 13);
    const p = SAMPLE_PLAYERS.find((x) => x.player_id === pk.player_id);
    const team = teams.find((t) => t.team_id === pk.team_id);
    const pv = Object.fromEntries(CATEGORIES.map((c) => [c.key, Math.round((0.25 + r() * 0.5) * 100) / 100]));
    const order = [...CATEGORIES].sort((a, b) => (pv[b.key] ?? 0) - (pv[a.key] ?? 0));
    const strengths = order.slice(0, 2).map((c) => c.key);
    const weaknesses = order.slice(-2).reverse().map((c) => c.key);
    const mine = pk.team_id === session.my_slot;
    const vsCat = Object.fromEntries(CATEGORIES.map((c) => [c.key, Math.round((1 - (pv[c.key] ?? 0.5) + (r() - 0.5) * 0.1) * 100) / 100]));
    const pct = (k: string) => `${Math.round((pv[k] ?? 0) * 100)}%`;
    const label = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;
    const open = team?.open_slots.filter((s) => s !== 'Util').slice(0, 3) ?? [];
    const pWin = Math.round((0.4 + r() * 0.3) * 100) / 100;
    const theirEdges = CATEGORIES.filter((c) => (vsCat[c.key] ?? 0.5) < 0.45).map((c) => c.key).slice(0, 2);
    const myEdges = CATEGORIES.filter((c) => (vsCat[c.key] ?? 0.5) > 0.55).map((c) => c.key).slice(0, 2);
    return {
      pick_no: pk.pick_no,
      round: pk.round,
      team_id: pk.team_id,
      team_name: team?.name ?? `Team ${pk.team_id}`,
      player: { player_id: pk.player_id ?? 0, name: pk.player_name, position: p?.position ?? null, team_abbr: p?.team_abbr ?? null },
      open_slots: team?.open_slots ?? [],
      p_vs_league_avg: pv,
      strengths,
      weaknesses,
      expected_cats_vs_avg: Math.round(Object.values(pv).reduce((a, b) => a + b, 0) * 100) / 100,
      vs_me: mine ? null : { p_cat: vsCat, p_win_week: pWin, my_edges: myEdges, their_edges: theirEdges },
      notes: [
        open.length ? `Needs ${open.join(', ')}` : 'Starting slots filled',
        `Strong in ${strengths.map((k) => `${label(k)} (${pct(k)})`).join(', ')}; weak in ${weaknesses.map((k) => `${label(k)} (${pct(k)})`).join(', ')}`,
        ...(mine ? [] : [`You'd beat them ${Math.round(pWin * 100)}% of weeks as the rosters project now`]),
        ...(mine || !theirEdges.length ? [] : [`They out-project you in ${theirEdges.map(label).join(', ')}`]),
      ],
    };
  });
}

/** Invented season schedule (real team codes, made-up counts). Weeks 1 and 17 are two weeks long. */
export const SCHEDULE_TEAMS = ['NTH', 'STH', 'EST', 'WST', 'MID', 'CST', 'DEN', 'NOP', 'PHX'];

export function makeTeamWeeks(): TeamWeeksResponse {
  const start = new Date(Date.UTC(2026, 9, 19));
  const weeks = Array.from({ length: 22 }, (_, i) => {
    const w = i + 1;
    const offsetDays = w === 1 ? 0 : (w <= 17 ? (w - 2) * 7 + 14 : (w - 3) * 7 + 28);
    const nDays = w === 1 || w === 17 ? 14 : 7;
    const a = new Date(start.getTime() + offsetDays * 86_400_000);
    const b = new Date(a.getTime() + (nDays - 1) * 86_400_000);
    return { week: w, start: a.toISOString().slice(0, 10), end: b.toISOString().slice(0, 10), n_days: nDays, is_playoff: w >= 20 };
  });
  const teams = SCHEDULE_TEAMS.map((team, ti) => {
    const r = seeded(100 + ti);
    const games: Record<string, number> = {};
    weeks.forEach((w) => {
      games[String(w.week)] = (w.n_days > 7 ? 6 : 3) + Math.floor(r() * 2) + (w.n_days > 7 ? Math.floor(r() * 2) : 0);
    });
    const playoff = weeks.filter((w) => w.is_playoff).reduce((a, w) => a + (games[String(w.week)] ?? 0), 0);
    return {
      team,
      games_by_week: games,
      b2b_by_week: Object.fromEntries(weeks.map((w) => [String(w.week), Math.floor(r() * 2)])),
      light_day_games_by_week: Object.fromEntries(weeks.map((w) => [String(w.week), Math.floor(r() * 2)])),
      total: Object.values(games).reduce((a, b) => a + b, 0),
      playoff_games: playoff,
    };
  });
  return { weeks, teams, unscheduled_note: 'Invented schedule for stories.', source: 'mock' };
}

/** Invented game days for one team, matching makeTeamWeeks' counts week by week. */
export function makeTeamDays(team: string): TeamDay[] {
  const sched = makeTeamWeeks();
  const t = sched.teams.find((x) => x.team === team) ?? sched.teams[0]!;
  return sched.weeks.flatMap((w) => {
    const n = t.games_by_week[String(w.week)] ?? 0;
    return Array.from({ length: n }, (_, k) => {
      const d = new Date(Date.parse(w.start) + Math.floor((k * w.n_days) / Math.max(1, n)) * 86_400_000);
      return { date: d.toISOString().slice(0, 10), opponent: SCHEDULE_TEAMS[(k + w.week) % SCHEDULE_TEAMS.length]!, home: k % 2 === 0, back_to_back: false, light_day: k % 3 === 0, week: w.week };
    });
  });
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
