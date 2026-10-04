import type {
  CategoryKey,
  GameCenterMoment,
  GameCenterResponse,
  InjuryRow,
  LinescoreRow,
  MilestoneKind,
  StrengthRow,
  WeekResponse,
  WinProbabilityResponse,
} from '../../api/season';
import { band, prov } from '../foundations/seasonCommon';
import { HALVORSEN_OUT, MINE, ROSTER, THEIRS, status } from '../foundations/seasonPlayers';
import { waiversNormal } from '../team-builder/waivers';
import { leagueTeamOpponent } from '../team-profiles/teams';
import {
  probCollapse,
  probComfortable,
  probDeficit,
  probFinal,
  probFinalLoss,
  probLastDay,
  probMonday,
  probNormal,
} from './probability';
import { weekInjury, weekLastDay, weekNormal } from './week';

/** Invented Game Center weeks (shape of GET /season/week/gamecenter). */

const OPP_ROSTER = leagueTeamOpponent.roster;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function linescore(week: WeekResponse, flips: Partial<Record<CategoryKey, 'me' | 'opp' | 'tied'>> = {}): LinescoreRow[] {
  return week.categories.map((c) => {
    const leader = flips[c.key] ?? (c.status_now === 'winning' ? 'me' : c.status_now === 'losing' ? 'opp' : 'tied');
    const p = c.p_win ?? 0.5;
    return {
      key: c.key,
      me: { total: c.mine_to_date, projected: c.mine_final },
      opp: { total: c.theirs_to_date, projected: c.theirs_final },
      p_win: c.p_win == null ? null : band(p, r3(Math.max(0, p - 0.08)), r3(Math.min(1, p + 0.08))),
      leader,
      punted: c.punted,
    };
  });
}

function scoreOf(rows: LinescoreRow[]) {
  return { me: rows.filter((r) => r.leader === 'me').length, opp: rows.filter((r) => r.leader === 'opp').length, ties: rows.filter((r) => r.leader === 'tied').length };
}

const KIND: Record<string, MilestoneKind> = { transaction: 'my_pickup', news: 'injury', lineup: 'lineup_lock' };

/** Fixture: moments from the probability snapshots (the engine sends these directly). */
function momentsFrom(prob: WinProbabilityResponse, extra: GameCenterMoment[] = []): GameCenterMoment[] {
  const out: GameCenterMoment[] = prob.history
    .filter((h) => h.event && h.event.kind !== 'nightly')
    .map((h, i) => {
      const e = h.event!;
      const kind: MilestoneKind =
        e.kind === 'games_final'
          ? h.p_win_week >= 0.999
            ? 'clinched'
            : h.p_win_week <= 0.001
              ? 'out_of_reach'
              : Math.abs(e.delta_p) >= 0.06
                ? 'big_night'
                : e.delta_p >= 0
                  ? 'flip_mine'
                  : 'flip_theirs'
          : (KIND[e.kind] ?? 'lineup_lock');
      return {
        id: `mo-${i}`,
        ts: h.ts,
        kind,
        headline: e.label,
        detail: null,
        delta_p_win: e.delta_p,
        category: e.label.includes('BLK') ? 'blk' : e.label.includes('REB') ? 'reb' : e.label.includes('AST') ? 'ast' : e.label.includes('PTS') ? 'pts' : null,
        score_after: h.cats_lead,
        key: kind !== 'lineup_lock',
        player: null,
      };
    });
  return [...out, ...extra].sort((a, b) => a.ts.localeCompare(b.ts));
}

const EXTRA_NORMAL: GameCenterMoment[] = [
  {
    id: 'mo-opp-pickup',
    ts: '2026-11-17T10:20:00-05:00',
    kind: 'opp_pickup',
    headline: 'Pick & Roll Call added Desmond Ravenel (SG)',
    detail: '3 games left; adds about 2 threes a game.',
    delta_p_win: -0.012,
    category: 'fg3m',
    score_after: { me: 4, opp: 5 },
    key: true,
    player: OPP_ROSTER[3] ?? null,
  },
  {
    id: 'mo-missed-lock',
    ts: '2026-11-16T19:00:00-05:00',
    kind: 'missed_lock',
    headline: 'Missed lock: Lindqvist sat on your bench with a game',
    detail: 'The lineup locked at 7:00 pm before the change.',
    delta_p_win: -0.009,
    category: 'reb',
    score_after: { me: 0, opp: 0 },
    key: false,
    player: MINE.lindqvist,
  },
];

const STRENGTH_BASE: StrengthRow[] = [
  { key: 'games_left', label: 'Games left', group: 'games', me: 36, opp: 27, format: 'count', higher_is_better: true, projected: false },
  { key: 'games_played', label: 'Games played', group: 'games', me: 10, opp: 12, format: 'count', higher_is_better: true, projected: false },
  { key: 'pos_pg', label: 'Playable PG games', group: 'positions', me: 6, opp: 7, format: 'count', higher_is_better: true, projected: false },
  { key: 'pos_sg', label: 'Playable SG games', group: 'positions', me: 7, opp: 6, format: 'count', higher_is_better: true, projected: false },
  { key: 'pos_sf', label: 'Playable SF games', group: 'positions', me: 6, opp: 5, format: 'count', higher_is_better: true, projected: false },
  { key: 'pos_pf', label: 'Playable PF games', group: 'positions', me: 7, opp: 4, format: 'count', higher_is_better: true, projected: false },
  { key: 'pos_c', label: 'Playable C games', group: 'positions', me: 9, opp: 5, format: 'count', higher_is_better: true, projected: false },
  { key: 'minutes', label: 'Projected minutes left', group: 'minutes', me: 1032, opp: 801, format: 'count', higher_is_better: true, projected: true },
];

function strength(week: WeekResponse): StrengthRow[] {
  const cats = week.week.categories;
  return [
    ...STRENGTH_BASE,
    ...week.categories.map<StrengthRow>((c) => {
      const def = cats.find((x) => x.key === c.key)!;
      return {
        key: `proj_${c.key}`,
        label: `${def.label} by Sunday`,
        group: 'categories',
        me: c.mine_final?.mean ?? null,
        opp: c.theirs_final?.mean ?? null,
        format: def.is_ratio ? 'percent' : 'decimal',
        higher_is_better: def.higher_is_better,
        projected: true,
      };
    }),
  ];
}

function days(week: WeekResponse) {
  return week.games.days.map((d, i) => ({
    date: d.date,
    weekday: d.weekday,
    is_today: d.is_today,
    is_past: d.is_past,
    me_games: d.mine,
    opp_games: d.theirs,
    me_playable: d.mine_usable,
    opp_playable: d.theirs_usable,
    playable_edge: d.usable_edge,
    me_players: ROSTER.filter((_, k) => (k + i) % 13 < d.mine),
    opp_players: OPP_ROSTER.filter((_, k) => (k + i) % OPP_ROSTER.length < d.theirs),
  }));
}

const INJ_NORMAL: InjuryRow[] = [
  { player: MINE.rosswell, side: 'me', est_return: 'Game-time Fri', delta_p_win: -0.011 },
  { player: MINE.thornbury, side: 'me', est_return: '2 weeks', delta_p_win: null },
  { player: THEIRS.marlowe, side: 'opp', est_return: 'Day-to-day', delta_p_win: 0.034 },
];

const INJ_HEAVY: InjuryRow[] = [
  { player: HALVORSEN_OUT, side: 'me', est_return: 'Fri', delta_p_win: -0.052 },
  ...INJ_NORMAL,
  { player: { ...MINE.castellan, status: status('doubtful', { note: 'Illness' }) }, side: 'me', est_return: 'Sat', delta_p_win: -0.021 },
  { player: { ...THEIRS.wexford, status: status('questionable', { minutes_cap: 26, note: 'Calf' }) }, side: 'opp', est_return: 'Game-time Thu', delta_p_win: 0.018 },
];

function gc(
  week: WeekResponse,
  prob: WinProbabilityResponse,
  opts: { flips?: Partial<Record<CategoryKey, 'me' | 'opp' | 'tied'>>; since?: GameCenterResponse['since_yesterday']; extra?: GameCenterMoment[]; injuries?: InjuryRow[]; final?: GameCenterResponse['final']; gamesLeft?: { me: number; opp: number } } = {},
): GameCenterResponse {
  const rows = linescore(week, opts.flips);
  return {
    as_of: prob.as_of,
    stale: false,
    stale_reason: null,
    provenance: [prov('yahoo', 'live category totals'), prov('schedule'), prov('simulate'), prov('x_feed', 'injuries and news'), prov('optimizer', 'pickups')],
    week: week.week,
    me: week.me,
    opponent: week.opponent,
    score: scoreOf(rows),
    games_left: opts.gamesLeft ?? { me: week.games.mine_remaining, opp: week.games.theirs_remaining },
    days: days(week),
    since_yesterday: opts.since ?? null,
    linescore: rows,
    swing: rows
      .filter((r) => !r.punted && r.p_win)
      .sort((a, b) => Math.abs(a.p_win!.p - 0.5) - Math.abs(b.p_win!.p - 0.5))
      .slice(0, 3)
      .map((r) => r.key),
    moments: momentsFrom(prob, opts.extra),
    strength: strength(week),
    injuries: opts.injuries ?? INJ_NORMAL,
    pickups: opts.final ? [] : waiversNormal.candidates.slice(0, 3),
    acquisitions: week.acquisitions,
    final: opts.final ?? null,
  };
}

export const gcMidweekClose = gc(weekNormal, probNormal, { since: { delta_p: 0.08, label: 'since Tue: Marlowe day-to-day, your BLK lead grew' }, extra: EXTRA_NORMAL });
export const gcEarlyWeek = gc({ ...weekNormal, week: { ...weekNormal.week, today: weekNormal.week.start, days_left: 7 } }, probMonday, {
  since: null,
  flips: { fg_pct: 'tied', ft_pct: 'tied', fg3m: 'tied', pts: 'tied', reb: 'tied', ast: 'tied', stl: 'tied', blk: 'tied', tov: 'tied' },
  gamesLeft: { me: 46, opp: 39 },
});
export const gcDeficitWithPlan = gc(weekNormal, probDeficit, {
  since: { delta_p: 0.04, label: 'since Tue: nightly refresh; AST still the gap' },
  flips: { pts: 'opp', reb: 'opp' },
});
export const gcComfortable = gc(weekNormal, probComfortable, {
  since: { delta_p: 0.07, label: 'since Tue: Northcott claim cleared, you lead 7 categories' },
  flips: { ft_pct: 'me', ast: 'me', pts: 'me' },
});
export const gcInjuryHeavy = gc(weekInjury, probCollapse, {
  since: { delta_p: -0.13, label: 'since Tue: Halvorsen ruled out tonight, Castellan doubtful' },
  injuries: INJ_HEAVY,
});
export const gcLastDay = gc(weekLastDay, probLastDay, { since: { delta_p: 0.02, label: 'since Sat: you took back REB' }, gamesLeft: { me: 6, opp: 4 } });
export const gcFinalWin = gc(weekLastDay, probFinal, {
  since: { delta_p: 0.47, label: 'Final: Hargreave’s 14 rebounds flipped REB' },
  final: { outcome: 'win' },
  gamesLeft: { me: 0, opp: 0 },
  flips: { reb: 'me', blk: 'me', tov: 'opp', pts: 'me' },
});
export const gcFinalLoss = gc(weekLastDay, probFinalLoss, {
  since: { delta_p: -0.53, label: 'Final: Halvorsen out Sunday, BLK went to them' },
  final: { outcome: 'loss' },
  gamesLeft: { me: 0, opp: 0 },
  flips: { reb: 'opp', blk: 'opp', pts: 'me', tov: 'me' },
});
export const gcEmpty: GameCenterResponse = { ...gcEarlyWeek, moments: [], injuries: [], pickups: [], since_yesterday: null };

