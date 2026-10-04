import type { CategoryKey, CategoryNeed, PlayableWeek, PlayerRef, WaiverCandidate, WaiversResponse } from '../../api/season';
import { LAST_DAY_CONTEXT, MISSING_INPUTS, PLAYOFF_CONTEXT, PUNT_CONTEXT, WEEK_DATES, band, conf, est, playableWeek, prov, toPlayoffWeek, weekContext } from '../foundations/seasonCommon';
import { AS_OF, FREE_AGENTS, MINE } from '../foundations/seasonPlayers';
import { ACQ_FULL, ACQ_NORMAL, STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';

/** Invented pickups for the Waivers screen. */

function cand(
  rank: number,
  player: PlayerRef,
  drop: PlayerRef | null,
  dropGames: number | null,
  gameIdx: number[],
  usableIdx: number[],
  playable: PlayableWeek,
  delta: [number, number, number, number],
  pAfter: number,
  catDeltas: [CategoryKey, number, number][],
  reason: string,
  confidence = conf('medium', 0.66),
  waivers = false,
): WaiverCandidate {
  return {
    rank,
    player,
    availability: waivers ? 'waivers' : 'free_agent',
    clears_at: waivers ? '2026-11-20T03:00:00-05:00' : null,
    first_usable: WEEK_DATES[usableIdx[0] ?? 6] ?? null,
    games_left: gameIdx.length,
    games_usable: usableIdx.length,
    playable,
    drop,
    drop_games_left: dropGames,
    delta_p_win: est(delta[0], delta[1], delta[2], delta[3]),
    p_win_after: pAfter,
    cat_deltas: catDeltas.map(([key, d, p]) => ({ key, delta_p: d, p_after: p })),
    cats_helped: catDeltas.filter(([, d]) => d > 0.015).map(([k]) => k),
    reason,
    confidence,
    deadline: waivers
      ? { kind: 'waiver_clears', at: '2026-11-20T03:00:00-05:00' }
      : { kind: 'add_before_game', at: `${WEEK_DATES[usableIdx[0] ?? 3]}T19:00:00-05:00` },
  };
}

const VEN: [number, string, boolean][] = [[2, 'MIL', true], [6, '@ATL', true]];
const TAL: [number, string, boolean][] = [[4, 'MIN', true], [5, '@DET', true]];
const PW: PlayableWeek[] = [
  playableWeek(2, [[3, '@MEM', true], [5, 'SAC', true], [6, '@DAL', true]], [0, 0, 0, 2, 1, 1, 2], VEN, [0, 0, 1, 3, 2, 2, 3], 2, 2, 3),
  playableWeek(2, [[2, 'CHI', false], [4, '@NYK', true], [5, 'ORL', true], [6, 'PHI', true]], [0, 0, 0, 3, 2, 3, 4], TAL, [0, 0, 0, 3, 2, 3, 4], 1, 1),
  playableWeek(2, [[3, 'UTA', true], [4, '@LAC', false], [6, 'POR', true]], [0, 0, 0, 3, 0, 1, 2], TAL, [0, 0, 0, 3, 0, 1, 2], 1, 0),
  playableWeek(2, [[3, '@HOU', true], [4, 'DEN', true], [6, '@SAC', true]], [0, 0, 0, 4, 1, 2, 3], VEN, [0, 0, 1, 4, 1, 2, 3], 2, 2, 3),
  playableWeek(2, [[4, '@BOS', false], [5, 'LAL', true], [6, 'MEM', true]], [0, 0, 0, 2, 0, 1, 2], VEN, [0, 0, 1, 2, 0, 1, 2], 2, 1, 3),
  playableWeek(2, [[3, '@SAS', true], [5, 'OKC', true]], [0, 0, 0, 4, 2, 2, 3], TAL, [0, 0, 0, 4, 2, 2, 3], 0, 0),
  playableWeek(2, [[4, 'GSW', true]], [0, 0, 0, 4, 1, 2, 3], VEN, [0, 0, 1, 4, 1, 2, 3], 0, 0, 3),
];
const PW_LAST: PlayableWeek[] = [
  playableWeek(6, [[6, 'POR', true]], [0, 0, 0, 0, 0, 0, 4], [], [0, 0, 0, 0, 0, 0, 4], 1, 1),
  playableWeek(6, [[6, '@SAC', true]], [0, 0, 0, 0, 0, 0, 4], [], [0, 0, 0, 0, 0, 0, 4], 1, 1),
];

const CANDIDATES: WaiverCandidate[] = [
  cand(1, FREE_AGENTS.bramwell, MINE.venhaus, 1, [3, 5, 6], [3, 5, 6], PW[0]!, [0.046, 0.016, 0.019, 0.072], 0.566,
    [['blk', 0.11, 0.6], ['reb', 0.06, 0.63], ['fg_pct', 0.02, 0.64], ['fg3m', -0.04, 0.6]],
    '3 games, all into an open C slot. BLK goes from a coin flip to 60%.',
    conf('medium', 0.68, [MISSING_INPUTS.kalshiBlk])),
  cand(2, FREE_AGENTS.northcott, MINE.talbridge, 2, [4, 5, 6], [4, 5, 6], PW[1]!, [0.018, 0.017, -0.004, 0.04], 0.538,
    [['ast', 0.08, 0.47], ['stl', 0.02, 0.66], ['reb', -0.03, 0.54]],
    'AST is your weakest close category; 6.8 assists a game once he clears Friday.',
    conf('medium', 0.6, [MISSING_INPUTS.waiverPriority]), true),
  cand(3, FREE_AGENTS.hargreave, MINE.talbridge, 2, [3, 4, 6], [3, 6], PW[2]!, [0.014, 0.013, -0.003, 0.031], 0.534,
    [['reb', 0.05, 0.62], ['blk', 0.02, 0.51], ['ft_pct', -0.04, 0.26]],
    '9.2 rebounds a game, but Friday has no open slot and his 58% free throws cost FT%.'),
  cand(4, FREE_AGENTS.sefton, MINE.venhaus, 1, [3, 4, 6], [3, 4, 6], PW[3]!, [0.009, 0.012, -0.006, 0.024], 0.529,
    [['fg3m', 0.05, 0.69], ['pts', 0.02, 0.55], ['fg_pct', -0.02, 0.6]],
    'Threes help a category you already lead (64%), so the gain is small.'),
  cand(5, FREE_AGENTS.quillan, MINE.venhaus, 1, [4, 5, 6], [5, 6], PW[4]!, [0.008, 0.015, -0.011, 0.027], 0.528,
    [['blk', 0.04, 0.53], ['reb', 0.02, 0.59]],
    'Clears Friday but Friday has no open C slot; 2 usable games.',
    conf('low', 0.45, [{ key: 'illness', label: 'Probable (illness); status not final', effect: 'P(plays) 88%' }, MISSING_INPUTS.waiverPriority]),
    true),
  cand(6, FREE_AGENTS.kingsmill, MINE.talbridge, 2, [3, 5], [3, 5], PW[5]!, [0.004, 0.014, -0.014, 0.022], 0.524,
    [['ast', 0.02, 0.41], ['stl', 0.01, 0.65]],
    'Returning under a 20-minute cap; the band crosses zero.',
    conf('low', 0.38, [{ key: 'minutes_cap', label: 'Minutes cap from one report', effect: 'Projection capped at 20 minutes' }])),
  cand(7, FREE_AGENTS.delacroix, MINE.venhaus, 1, [4], [4], PW[6]!, [-0.002, 0.008, -0.012, 0.008], 0.518,
    [['ft_pct', 0.02, 0.32], ['pts', 0.01, 0.54], ['blk', -0.02, 0.47]],
    'One game; his FT% helps a category you are likely to lose anyway. Worse than doing nothing.'),
];

const NEEDS: CategoryNeed[] = [
  { key: 'blk', p_win: 0.49, need: 'high' },
  { key: 'ast', p_win: 0.39, need: 'high' },
  { key: 'reb', p_win: 0.57, need: 'medium' },
  { key: 'pts', p_win: 0.53, need: 'medium' },
  { key: 'tov', p_win: 0.39, need: 'medium' },
  { key: 'fg_pct', p_win: 0.62, need: 'low' },
  { key: 'stl', p_win: 0.64, need: 'low' },
  { key: 'fg3m', p_win: 0.64, need: 'safe' },
  { key: 'ft_pct', p_win: 0.3, need: 'low' },
];

export const waiversNormal: WaiversResponse = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('yahoo', 'free agents snapshot 5:15 pm'), prov('optimizer'), prov('simulate')],
  week: weekContext(),
  acquisitions: ACQ_NORMAL,
  baseline_p_win: band(0.52, 0.45, 0.59),
  needs: NEEDS,
  candidates: CANDIDATES,
  pool_size: 212,
};

export const waiversNoAcquisitions: WaiversResponse = { ...waiversNormal, acquisitions: ACQ_FULL };
export const waiversOneLeft: WaiversResponse = { ...waiversNormal, acquisitions: { ...ACQ_NORMAL, used: 3 } };
export const waiversEmpty: WaiversResponse = { ...waiversNormal, candidates: [] };
export const waiversStale: WaiversResponse = { ...waiversNormal, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };
export const waiversPlayoff: WaiversResponse = toPlayoffWeek({ ...waiversNormal, week: PLAYOFF_CONTEXT });

export const waiversPunt: WaiversResponse = {
  ...waiversNormal,
  week: PUNT_CONTEXT,
  needs: NEEDS.map((n) => (n.key === 'ft_pct' ? { ...n, need: 'punt' } : n)),
  candidates: [
    CANDIDATES[0]!,
    {
      ...CANDIDATES[2]!,
      rank: 2,
      delta_p_win: est(0.029, 0.014, 0.011, 0.047),
      p_win_after: 0.579,
      cat_deltas: [
        { key: 'reb', delta_p: 0.07, p_after: 0.64 },
        { key: 'blk', delta_p: 0.03, p_after: 0.52 },
      ],
      reason: '9.2 rebounds a game; his 58% free throws cost nothing because you punt FT%.',
    },
    { ...CANDIDATES[1]!, rank: 3 },
    ...CANDIDATES.slice(3, 6).map((c, i) => ({ ...c, rank: 4 + i })),
  ],
};

/** An injury on my roster opens a slot: the IL-eligible case. */
export const waiversInjury: WaiversResponse = {
  ...waiversNormal,
  as_of: '2026-11-18T17:34:00-05:00',
  baseline_p_win: band(0.47, 0.4, 0.54),
  candidates: CANDIDATES.map((c, i) =>
    i === 0
      ? {
          ...c,
          delta_p_win: est(0.041, 0.016, 0.015, 0.067),
          reason: 'With Halvorsen out tonight, C depth matters more: 3 games, BLK from 45% to 57%.',
        }
      : c,
  ),
};

export const waiversLastDay: WaiversResponse = {
  ...waiversNormal,
  as_of: '2026-11-22T11:05:00-05:00',
  week: LAST_DAY_CONTEXT,
  baseline_p_win: band(0.55, 0.47, 0.62),
  candidates: [
    cand(1, FREE_AGENTS.hargreave, MINE.talbridge, 0, [6], [6], PW_LAST[0]!, [0.061, 0.019, 0.037, 0.085], 0.611,
      [['reb', 0.14, 0.61], ['blk', 0.03, 0.55], ['ft_pct', -0.02, 0.1]],
      'Plays at 3:30 pm today; REB is the last swing category.'),
    cand(2, FREE_AGENTS.sefton, MINE.talbridge, 0, [6], [6], PW_LAST[1]!, [0.004, 0.009, -0.007, 0.015], 0.554,
      [['fg3m', 0.01, 0.94], ['pts', 0.02, 0.6]],
      'Threes are already locked (93%); small PTS help.'),
  ].map((c) => ({ ...c, deadline: { kind: 'add_before_game' as const, at: '2026-11-22T15:30:00-05:00' } })),
};
