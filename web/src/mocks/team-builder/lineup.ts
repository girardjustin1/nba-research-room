import type {
  GameRef,
  LineupAssignment,
  LineupDay,
  LineupResponse,
  PlayerRef,
  ReasonTag,
  RosterSlot,
  SlotDiff,
} from '../../api/season';
import { LAST_DAY_CONTEXT, PLAYOFF_CONTEXT, PUNT_CONTEXT, WEEK_DATES, WEEKDAYS, prov, toPlayoffWeek, weekContext } from '../foundations/seasonCommon';
import { AS_OF, HALVORSEN_OUT, MINE, ROSTER } from '../foundations/seasonPlayers';
import { STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';

/**
 * Invented lineup fixtures. The optimal lineups here come from a tiny slot matcher that
 * only exists to build plausible fixtures; the real ones come from optimizer.py.
 */

const ACTIVE: RosterSlot[] = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'Util', 'Util'];

/** Games by player (Mon..Sun). 1 = has a game. */
const SCHEDULE: Record<number, number[]> = {
  100: [1, 0, 1, 0, 1, 1, 0],
  101: [1, 0, 1, 0, 1, 0, 1],
  102: [1, 0, 1, 1, 0, 1, 0],
  103: [0, 1, 1, 0, 1, 0, 1],
  104: [1, 0, 1, 0, 1, 1, 0],
  105: [0, 1, 1, 0, 1, 0, 1],
  106: [1, 0, 1, 0, 0, 1, 0],
  107: [1, 0, 0, 1, 0, 1, 1],
  108: [0, 1, 1, 0, 1, 0, 0],
  109: [1, 0, 0, 1, 1, 0, 1],
  110: [0, 0, 1, 0, 1, 1, 0],
  111: [0, 0, 1, 0, 0, 0, 1],
  112: [0, 0, 1, 1, 0, 1, 0],
};

/** Value order the fixture matcher uses (engine stand-in): earlier starts first. */
const PRIORITY = [104, 100, 101, 102, 105, 103, 112, 108, 110, 111, 107, 106, 109];

const OPPS = ['BOS', 'LAL', 'NYK', 'MIL', 'DAL', 'PHX', 'GSW', 'DEN', 'MIA', 'ATL', 'CHI', 'SAS', 'LAC', 'CLE', 'MIN'];
const TIPS = ['19:00', '19:30', '20:00', '22:00'];
const TIP_OVERRIDE: Record<string, string> = { '112-2': '20:00', '109-4': '19:30', '111-6': '18:00', '103-6': '15:30' };

/** The do-nothing lineup Yahoo carries forward. */
const CURRENT: Record<string, number> = {
  'PG#0': 109,
  'SG#0': 102,
  'G#0': 100,
  'SF#0': 101,
  'PF#0': 110,
  'F#0': 103,
  'C#0': 104,
  'C#1': 105,
  'Util#0': 106,
  'Util#1': 111,
};

const byId = new Map(ROSTER.map((p) => [p.player_id, p]));

function gameFor(player: PlayerRef, day: number): GameRef | null {
  if (!SCHEDULE[player.player_id]?.[day]) return null;
  const i = player.player_id - 100;
  let opp = OPPS[(i * 3 + day * 5) % OPPS.length]!;
  if (opp === player.team_abbr) opp = OPPS[(i * 3 + day * 5 + 1) % OPPS.length]!;
  const tip = TIP_OVERRIDE[`${player.player_id}-${day}`] ?? TIPS[(i + day) % TIPS.length]!;
  return {
    game_id: 50000 + i * 10 + day,
    date: WEEK_DATES[day]!,
    tip_at: `${WEEK_DATES[day]}T${tip}:00-05:00`,
    opp_abbr: opp,
    home: (i + day) % 2 === 0,
    b2b: day > 0 && SCHEDULE[player.player_id]?.[day - 1] === 1,
  };
}

interface DayOptions {
  /** Players who cannot play that day (ruled out). */
  out?: number[];
  /** Players the optimizer benches despite a game (e.g. minutes-capped). */
  sit?: number[];
  /** Use the current lineup as optimal (already optimal). */
  keepCurrent?: boolean;
  overridePlayers?: Map<number, PlayerRef>;
  reasons?: Record<number, { text: string; tags: ReasonTag[]; delta?: number }>;
  dayDelta?: number | null;
}

/**
 * Fixture matcher: players who already hold a slot keep it; each new starter takes the
 * shortest chain of slot moves (BFS) to a free slot, so the diff shows few shuffles.
 */
function matchStarters(starters: number[]): Map<string, number> | null {
  const slotKeys = ACTIVE.map((s, i) => `${s}#${ACTIVE.slice(0, i).filter((x) => x === s).length}`);
  const currentSlotOf = new Map(Object.entries(CURRENT).map(([k, v]) => [v, k]));
  const eligible = (pid: number, key: string) => byId.get(pid)!.eligible.includes(key.split('#')[0] as RosterSlot);
  const owner = new Map<string, number>();
  for (const pid of starters) {
    const k = currentSlotOf.get(pid);
    if (k) owner.set(k, pid);
  }
  for (const pid of starters.filter((x) => !currentSlotOf.has(x))) {
    const prev = new Map<string, string | null>();
    const queue: string[] = [];
    for (const k of slotKeys) {
      if (eligible(pid, k)) {
        prev.set(k, null);
        queue.push(k);
      }
    }
    let found: string | null = null;
    while (queue.length) {
      const k = queue.shift()!;
      const holder = owner.get(k);
      if (holder === undefined) {
        found = k;
        break;
      }
      for (const k2 of slotKeys) {
        if (!prev.has(k2) && eligible(holder, k2)) {
          prev.set(k2, k);
          queue.push(k2);
        }
      }
    }
    if (!found) return null;
    let k: string | null = found;
    while (k) {
      const from: string | null = prev.get(k) ?? null;
      owner.set(k, from === null ? pid : owner.get(from)!);
      k = from;
    }
  }
  return owner;
}

function assignment(slot: RosterSlot, player: PlayerRef | null, day: number): LineupAssignment {
  const out = player?.status.code === 'out';
  return { slot, player, game: player && !out ? gameFor(player, day) : null, locked: false };
}

function buildDay(day: number, today: number, opts: DayOptions = {}): LineupDay {
  const p = (id: number) => opts.overridePlayers?.get(id) ?? byId.get(id)!;
  const plays = (id: number) => SCHEDULE[id]?.[day] === 1 && !(opts.out ?? []).includes(id);
  const sit = new Set(opts.sit ?? []);
  const candidates = PRIORITY.filter((id) => plays(id) && !sit.has(id));
  let starters = candidates.slice(0, 10);
  let matched = matchStarters(starters);
  while (!matched && starters.length > 0) {
    starters = starters.slice(0, -1);
    matched = matchStarters(starters);
  }
  const optimal = new Map<string, number>(opts.keepCurrent ? Object.entries(CURRENT) : (matched ?? new Map()));
  if (!opts.keepCurrent) {
    // Leftover active slots keep their current occupant when that player is not used elsewhere.
    const used = new Set(optimal.values());
    for (const [key, pid] of Object.entries(CURRENT)) {
      if (!optimal.has(key) && !used.has(pid)) {
        optimal.set(key, pid);
        used.add(pid);
      }
    }
  }

  const counts: Record<string, number> = {};
  const slots: SlotDiff[] = ACTIVE.map((slot) => {
    const idx = counts[slot] ?? 0;
    counts[slot] = idx + 1;
    const key = `${slot}#${idx}`;
    const curId = CURRENT[key] ?? null;
    const optId = optimal.get(key) ?? null;
    const cur = assignment(slot, curId == null ? null : p(curId), day);
    const opt = assignment(slot, optId == null ? null : p(optId), day);
    const changed = curId !== optId && !(cur.game == null && opt.game == null);
    let reason: string | null = null;
    let tags: ReasonTag[] = [];
    let delta: number | null = null;
    if (changed && opt.player) {
      const custom = opts.reasons?.[opt.player.player_id] ?? (cur.player ? opts.reasons?.[-cur.player.player_id] : undefined);
      if (custom) {
        reason = custom.text;
        tags = custom.tags;
        delta = custom.delta ?? null;
      } else if (cur.player && cur.player.status.code === 'out') {
        reason = `${cur.player.name} is out; ${opt.player.name} plays ${opt.game ? `${opt.game.home ? 'vs' : '@'} ${opt.game.opp_abbr}` : ''}.`;
        tags = ['status'];
      } else if (cur.player && !cur.game && opt.game) {
        reason = `${cur.player.name} has no game ${WEEKDAYS[day]}; ${opt.player.name} plays ${opt.game.home ? 'vs' : '@'} ${opt.game.opp_abbr}.`;
        tags = ['games'];
        delta = 0.004 + ((opt.player.player_id * 7) % 5) / 1000;
      } else if (!cur.player && opt.game) {
        reason = `Open slot; ${opt.player.name} plays ${opt.game.home ? 'vs' : '@'} ${opt.game.opp_abbr}.`;
        tags = ['games'];
      } else {
        reason = `${opt.player.name} moves to ${slot} so every player with a game fits.`;
        tags = ['eligibility'];
      }
    } else if (changed && cur.player && sit.has(cur.player.player_id)) {
      const custom = opts.reasons?.[-cur.player.player_id];
      reason = custom?.text ?? `Sit ${cur.player.name}.`;
      tags = custom?.tags ?? ['status'];
      delta = custom?.delta ?? null;
    }
    return { slot, slot_index: idx, current: cur, optimal: opt, changed, reason, reason_tags: tags, delta_p_win: delta };
  });

  // A sat player keeps a game but leaves his slot empty in the optimal lineup.
  for (const s of slots) {
    if (s.optimal.player && sit.has(s.optimal.player.player_id)) {
      const custom = opts.reasons?.[-s.optimal.player.player_id];
      s.optimal = { ...s.optimal, player: null, game: null };
      s.changed = true;
      s.reason = custom?.text ?? `Sit ${s.current.player?.name ?? ''}.`;
      s.reason_tags = custom?.tags ?? ['status'];
      s.delta_p_win = custom?.delta ?? null;
    }
  }

  const inCurrent = new Set(Object.values(CURRENT));
  const inOptimal = new Set(slots.map((s) => s.optimal.player?.player_id).filter((x): x is number => x != null));
  const bench = (ids: number[]) => ids.map((id) => assignment('BN', p(id), day));
  const all = ROSTER.map((r) => r.player_id);
  const startedCur = slots.filter((s) => s.current.game).length;
  const startedOpt = slots.filter((s) => s.optimal.game).length;
  const tips = slots
    .map((s) => s.optimal.game?.tip_at ?? s.current.game?.tip_at)
    .filter((t): t is string => !!t)
    .sort();
  return {
    date: WEEK_DATES[day]!,
    weekday: WEEKDAYS[day]!,
    is_today: day === today,
    is_past: day < today,
    slots,
    bench_current: bench(all.filter((id) => !inCurrent.has(id))),
    bench_optimal: bench(all.filter((id) => !inOptimal.has(id))),
    il: [assignment('IL', MINE.thornbury, day)],
    games_available: all.filter((id) => plays(id)).length,
    games_started_current: startedCur,
    games_started_optimal: startedOpt,
    delta_p_win: opts.dayDelta === undefined ? (startedOpt > startedCur ? 0.008 * (startedOpt - startedCur) : null) : opts.dayDelta,
    first_lock_at: tips[0] ?? null,
  };
}

const PELLHAM_REASON = {
  112: {
    text: 'Pellham over Ferrante: both play tonight; his REB and BLK swing two close categories, Ferrante’s threes go to one you lead (64%).',
    tags: ['category', 'matchup'] as ReasonTag[],
    delta: 0.021,
  },
};
const ROSSWELL_SIT = {
  [-109]: {
    text: 'Sit Rosswell: questionable with a 24-minute cap. His 2.1 TO and 39% shooting cost more than 4.4 AST add.',
    tags: ['status', 'minutes'] as ReasonTag[],
    delta: 0.007,
  },
};

const OPTIMIZER = {
  status: 'optimal' as const,
  message: null,
  solved_at: '2026-11-18T17:40:00-05:00',
  solve_ms: 1840,
  horizon: WEEK_DATES.slice(2),
  objective: 'p_win_week' as const,
};

const base = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('optimizer', 'MILP, horizon Wed–Sun'), prov('overrides', 'statuses as of 5:31 pm'), prov('yahoo', 'roster snapshot 5:15 pm')],
  roster: ROSTER,
  optimizer: OPTIMIZER,
};

function week(today: number, opts: Record<number, DayOptions> = {}): LineupDay[] {
  const days: LineupDay[] = [];
  for (let d = today; d < 7; d += 1) days.push(buildDay(d, today, opts[d]));
  return days;
}

export const lineupNormal: LineupResponse = {
  ...base,
  week: weekContext(),
  days: week(2, { 2: { reasons: PELLHAM_REASON, dayDelta: 0.021 }, 4: { sit: [109], reasons: ROSSWELL_SIT, dayDelta: 0.007 } }),
};

const injuredPlayers = new Map<number, PlayerRef>([[104, HALVORSEN_OUT]]);
export const lineupInjury: LineupResponse = {
  ...base,
  as_of: '2026-11-18T17:34:00-05:00',
  week: weekContext(),
  days: [
    buildDay(2, 2, {
      out: [104],
      overridePlayers: injuredPlayers,
      reasons: {
        112: {
          text: 'Halvorsen was ruled out at 5:31 pm (OKC PR). Pellham plays at 8:00 pm and is eligible at C.',
          tags: ['status'],
          delta: 0.053,
        },
      },
      dayDelta: 0.053,
    }),
    ...week(2, { 4: { sit: [109], reasons: ROSSWELL_SIT, dayDelta: 0.007 } }).slice(1),
  ],
};

export const lineupLastDay: LineupResponse = {
  ...base,
  as_of: '2026-11-22T11:05:00-05:00',
  week: LAST_DAY_CONTEXT,
  optimizer: { ...OPTIMIZER, horizon: ['2026-11-22'], solved_at: '2026-11-22T11:03:00-05:00', solve_ms: 310 },
  days: [
    buildDay(6, 6, {
      sit: [111],
      reasons: {
        [-111]: {
          text: 'Sit Venhaus to protect FG%: you lead by .006 and he shoots 41% on 14 attempts.',
          tags: ['category'],
          delta: 0.016,
        },
      },
      dayDelta: 0.031,
    }),
  ],
};

export const lineupPunt: LineupResponse = { ...lineupNormal, week: PUNT_CONTEXT };
export const lineupPlayoff: LineupResponse = toPlayoffWeek({ ...lineupNormal, week: PLAYOFF_CONTEXT });
export const lineupStale: LineupResponse = { ...lineupNormal, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };

export const lineupOptimal: LineupResponse = {
  ...base,
  week: weekContext(),
  days: [2, 3, 4, 5, 6].map((d) => buildDay(d, 2, { keepCurrent: true, dayDelta: null })),
};

export const lineupInfeasible: LineupResponse = {
  ...lineupOptimal,
  optimizer: {
    ...OPTIMIZER,
    status: 'infeasible',
    message: 'No legal lineup: a pending waiver claim puts the roster at 15 players (limit 14). Showing your current lineup until you drop one.',
  },
};

