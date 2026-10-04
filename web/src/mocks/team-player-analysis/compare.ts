import type { CompareResponse } from '../../api/season';
import { MISSING_INPUTS, conf, est, prov, weekContext } from '../foundations/seasonCommon';
import { AS_OF, FREE_AGENTS, MINE } from '../foundations/seasonPlayers';

/** Invented start/sit and add/drop comparisons. */

/* ---------------------------------------------------------------- compare */

export const compareStartSit: CompareResponse = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('projections'), prov('simulate')],
  week: weekContext(),
  decision: 'start_sit',
  date: '2026-11-18',
  a: MINE.pellham,
  b: MINE.ferrante,
  verdict: {
    choose: MINE.pellham.player_id,
    delta_p_win: est(0.021, 0.009, 0.006, 0.035),
    reason: 'Start Pellham: his rebounds and blocks land in two close categories; Ferrante’s threes go to one you already lead.',
    confidence: conf('high', 0.82),
  },
  rows: [
    { key: 'p_win', label: 'P(win week) if started', a: 0.541, b: 0.52, format: 'prob', better: 'a', note: null },
    { key: 'play_prob', label: 'Chance he plays', a: 0.97, b: 0.97, format: 'prob', better: 'even', note: null },
    { key: 'min', label: 'Minutes', a: 28.4, b: 31.0, format: 'minutes', better: 'b', note: null },
    { key: 'pts', label: 'PTS', a: 13.1, b: 15.8, format: 'decimal', better: 'b', note: null },
    { key: 'reb', label: 'REB', a: 9.4, b: 3.2, format: 'decimal', better: 'a', note: 'close category' },
    { key: 'ast', label: 'AST', a: 1.6, b: 2.9, format: 'decimal', better: 'b', note: null },
    { key: 'blk', label: 'BLK', a: 1.3, b: 0.3, format: 'decimal', better: 'a', note: 'close category' },
    { key: 'stl', label: 'ST', a: 0.6, b: 1.1, format: 'decimal', better: 'b', note: null },
    { key: 'fg3m', label: '3PTM', a: 0.2, b: 2.8, format: 'decimal', better: 'b', note: 'you lead 3PTM' },
    { key: 'tov', label: 'TO (fewer is better)', a: 1.4, b: 1.6, format: 'decimal', better: 'a', note: null },
    { key: 'fg_pct', label: 'FG%', a: 0.58, b: 0.44, format: 'percent', better: 'a', note: null },
    { key: 'ft_pct', label: 'FT%', a: 0.66, b: 0.86, format: 'percent', better: 'b', note: null },
  ],
  cat_deltas: [
    { key: 'fg_pct', p_a: 0.63, p_b: 0.62 },
    { key: 'ft_pct', p_a: 0.29, p_b: 0.3 },
    { key: 'fg3m', p_a: 0.62, p_b: 0.64 },
    { key: 'pts', p_a: 0.53, p_b: 0.53 },
    { key: 'reb', p_a: 0.61, p_b: 0.57 },
    { key: 'ast', p_a: 0.38, p_b: 0.39 },
    { key: 'stl', p_a: 0.63, p_b: 0.64 },
    { key: 'blk', p_a: 0.52, p_b: 0.49 },
    { key: 'tov', p_a: 0.39, p_b: 0.39 },
  ],
};

export const compareAddDrop: CompareResponse = {
  ...compareStartSit,
  decision: 'add_drop',
  date: null,
  a: FREE_AGENTS.bramwell,
  b: MINE.venhaus,
  verdict: {
    choose: FREE_AGENTS.bramwell.player_id,
    delta_p_win: est(0.046, 0.016, 0.019, 0.072),
    reason: 'Add Bramwell: 3 games to 1, and his blocks swing BLK from a coin flip to 60%.',
    confidence: conf('medium', 0.68, [MISSING_INPUTS.kalshiBlk]),
  },
  rows: [
    { key: 'p_win', label: 'P(win week) with him', a: 0.566, b: 0.52, format: 'prob', better: 'a', note: null },
    { key: 'games', label: 'Games left', a: 3, b: 1, format: 'count', better: 'a', note: null },
    { key: 'usable', label: 'Games in an open slot', a: 3, b: 1, format: 'count', better: 'a', note: null },
    { key: 'pts', label: 'PTS rest of week', a: 36.6, b: 14.2, format: 'decimal', better: 'a', note: null },
    { key: 'reb', label: 'REB rest of week', a: 24.3, b: 4.1, format: 'decimal', better: 'a', note: null },
    { key: 'blk', label: 'BLK rest of week', a: 4.8, b: 0.4, format: 'decimal', better: 'a', note: 'close category' },
    { key: 'fg3m', label: '3PTM rest of week', a: 0.9, b: 2.1, format: 'decimal', better: 'b', note: null },
    { key: 'ast', label: 'AST rest of week', a: 4.2, b: 2.2, format: 'decimal', better: 'a', note: null },
    { key: 'tov', label: 'TO rest of week (fewer is better)', a: 3.9, b: 1.4, format: 'decimal', better: 'b', note: null },
    { key: 'ft_pct', label: 'FT%', a: 0.642, b: 0.81, format: 'percent', better: 'b', note: null },
  ],
  cat_deltas: [
    { key: 'fg_pct', p_a: 0.64, p_b: 0.62 },
    { key: 'ft_pct', p_a: 0.29, p_b: 0.3 },
    { key: 'fg3m', p_a: 0.6, p_b: 0.64 },
    { key: 'pts', p_a: 0.52, p_b: 0.53 },
    { key: 'reb', p_a: 0.63, p_b: 0.57 },
    { key: 'ast', p_a: 0.38, p_b: 0.39 },
    { key: 'stl', p_a: 0.64, p_b: 0.64 },
    { key: 'blk', p_a: 0.6, p_b: 0.49 },
    { key: 'tov', p_a: 0.37, p_b: 0.39 },
  ],
};

