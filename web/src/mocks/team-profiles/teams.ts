import type { LeagueTeamProfile, NbaTeamProfile } from '../../api/season';
import { band, conf, prov } from '../foundations/seasonCommon';
import { AS_OF, FREE_AGENTS, MINE, ROSTER, THEIRS, status } from '../foundations/seasonPlayers';
import { ME, OPPONENT, STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';
import { teamDaysNOP, teamWeeks } from './schedule';

/** Invented league-team and NBA-team profiles. */

const OPP_ROSTER = [
  THEIRS.wexford,
  THEIRS.marlowe,
  THEIRS.stroud,
  ...[
    ['Desmond Ravenel', 'BOS', 'SG'],
    ['Pieter Vos', 'MIL', 'C'],
    ['Arlo Fenwick', 'CLE', 'PF'],
    ['Julian Okonkwo-Hale', 'SAS', 'SF'],
    ['Reid Castellanos', 'ATL', 'PG'],
    ['Tomas Lindgren', 'MIN', 'C'],
    ['Cyrus Bellweather', 'PHX', 'SG'],
  ].map(([name, team, pos], i) => ({ ...THEIRS.stroud, player_id: 210 + i, name: name!, team_abbr: team!, eligible: [pos as 'PG', 'Util' as const], status: status() })),
];

export const leagueTeamOpponent: LeagueTeamProfile = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('yahoo', 'rosters and standings'), prov('projections', 'season-to-date per-game z')],
  team: OPPONENT,
  is_me: false,
  rank: 1,
  roster: OPP_ROSTER,
  strengths: [
    { key: 'ast', z: 1.4, rank: 2 },
    { key: 'ft_pct', z: 1.1, rank: 3 },
    { key: 'pts', z: 0.6, rank: 4 },
    { key: 'tov', z: 0.3, rank: 6 },
    { key: 'reb', z: 0.1, rank: 7 },
    { key: 'stl', z: -0.2, rank: 9 },
    { key: 'fg3m', z: -0.4, rank: 10 },
    { key: 'fg_pct', z: -0.5, rank: 11 },
    { key: 'blk', z: -0.9, rank: 13 },
  ],
  notes: ['Guard-heavy: strong AST and FT%, weak BLK (13th).', 'Plays 27 games the rest of this week to your 36.'],
  head_to_head: { played: [], next: { week: 4, p_win_week: band(0.52, 0.45, 0.59) } },
  week_games_left: 27,
};

export const leagueTeamMe: LeagueTeamProfile = {
  ...leagueTeamOpponent,
  team: ME,
  is_me: true,
  rank: 3,
  roster: ROSTER,
  strengths: [
    { key: 'blk', z: 1.2, rank: 2 },
    { key: 'reb', z: 0.9, rank: 3 },
    { key: 'fg_pct', z: 0.7, rank: 4 },
    { key: 'stl', z: 0.4, rank: 5 },
    { key: 'fg3m', z: 0.3, rank: 6 },
    { key: 'pts', z: 0.0, rank: 7 },
    { key: 'tov', z: -0.3, rank: 9 },
    { key: 'ast', z: -0.8, rank: 12 },
    { key: 'ft_pct', z: -1.1, rank: 13 },
  ],
  notes: ['Big-man build: BLK and REB lead; FT% and AST trail.', 'FT% is 13th: punting it costs little.'],
  head_to_head: { played: [], next: null },
  week_games_left: 36,
};

export const leagueTeamPastOpponent: LeagueTeamProfile = {
  ...leagueTeamOpponent,
  team: { team_id: 4, name: 'Zone Defense Fund', manager: null, record: '2-1', logo_url: null },
  rank: 4,
  notes: ['Beat you 6–3 in week 2.'],
  head_to_head: { played: [{ week: 2, outcome: 'loss', cats_won: 3, cats_lost: 6 }], next: { week: 11, p_win_week: null } },
  week_games_left: null,
};

export const leagueTeamStale: LeagueTeamProfile = { ...leagueTeamOpponent, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };

export const nbaTeamNOP: NbaTeamProfile = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('schedule', '/schedule/team_weeks and team_days'), prov('features', 'pace and defensive rating, season to date')],
  team: 'NOP',
  name: 'New Orleans',
  pace: 100.4,
  pace_rank: 8,
  def_rating: 117.2,
  def_rank: 24,
  weeks: teamWeeks.teams.find((t) => t.team === 'NOP')!,
  days: teamDaysNOP.days,
  my_players: [],
  opponent_players: [],
};

export const nbaTeamWithMyPlayer: NbaTeamProfile = { ...nbaTeamNOP, my_players: [{ ...FREE_AGENTS.bramwell, owner: 'mine' }] };
export const nbaTeamNoContext: NbaTeamProfile = {
  ...nbaTeamNOP,
  pace: null,
  pace_rank: null,
  def_rating: null,
  def_rank: null,
  provenance: [prov('schedule')],
};
export const nbaTeamOppPlayer: NbaTeamProfile = { ...nbaTeamNOP, opponent_players: [{ ...MINE.halvorsen, owner: 'opponent' }] };

export const SCHEDULE_CONFIDENCE = conf('high', 0.95);
