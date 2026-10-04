/**
 * Types mirroring `src/research_room/api.py`. The engine computes every number here;
 * the UI only formats and displays them. NaN becomes `null` on the wire (`_clean`), so
 * numeric fields that can be missing are typed `number | null`.
 */

export interface Category {
  key: string;
  label: string;
}

/** A row of `draft_picks` (tracker._read_picks). */
export interface PickRecord {
  pick_no: number;
  round: number;
  team_id: number;
  player_id: number | null;
  player_name: string;
  is_keeper: boolean;
}

/** GET/POST /draft/session, PUT /draft/slot, PUT /draft/punts, POST /draft/pick, POST /draft/undo */
export interface Session {
  draft_id: string;
  my_slot: number | null;
  teams: number;
  rounds: number;
  total_picks: number;
  /** null once every pick is made. */
  current_pick: number | null;
  /** Draft slot (1..teams) of the team on the clock; null when complete. */
  on_the_clock: number | null;
  my_picks: number[];
  punts: string[];
  pick_clock_seconds: number;
  categories: Category[];
  picks: PickRecord[];
  /** Saved team names keyed by draft slot ("1".."14"); default "Team N", "You" for my slot. Newer API only. */
  team_names?: Record<string, string>;
}

export type AdpSource = 'yahoo' | 'bbm_adp' | 'bbm_rank';
export type ProjectionSources = 'bbm+last_season' | 'bbm_only';

/** PLAYER_COLS in api.py. */
export interface Player {
  player_id: number;
  name: string;
  team_abbr: string | null;
  position: string | null;
  eligible: string[] | null;
  games: number | null;
  minutes_pg: number | null;
  value: number | null;
  value_pg: number | null;
  rank: number | null;
  tier: number | null;
  expected_pick: number | null;
  adp_source: AdpSource | string | null;
  yahoo_adp: number | null;
  injury_risk: string | null;
  sources: ProjectionSources | string | null;
  /** Relative path served by the API (e.g. /images/players/123.png), or null when not cached. */
  headshot_url?: string | null;
  /** Relative path served by the API (e.g. /images/teams/DEN.svg), or null. */
  team_logo_url?: string | null;
  /** Our rank within the primary position (newer API). */
  pos_rank?: number | null;
  /** Overall ADP rank and ADP rank within the primary position (newer API). */
  adp_rank?: number | null;
  adp_pos_rank?: number | null;
  rookie?: boolean | null;
  /** Games in fantasy playoff weeks 20-22: the NBA stand-in for an NFL bye. */
  playoff_games?: number | null;
}

/** GET /draft/players */
export interface PoolPlayer extends Player {
  drafted: boolean;
}

export interface PlayersResponse {
  players: PoolPlayer[];
}

/** One row of `recommendations` in GET /draft/board. */
export interface Recommendation extends Player {
  expected_cats: number | null;
  /** Expected categories won vs a typical pick here (signed). */
  gain: number | null;
  p_win_week: number | null;
  /** Monte Carlo P(win week), only for the top few; null elsewhere. */
  p_win_week_mc: number | null;
  p_available_at_decision: number | null;
  p_available_next: number | null;
  /** Plain-language reasons built by the engine, joined with "; ". */
  reasons: string | null;
  /** True when he fits one of my open starting slots. */
  starts?: boolean | null;
  /** Change in P(win category) if I take him, per category: dp_fg_pct, dp_tov, ... */
  [dp: `dp_${string}`]: number | null | undefined;
}

export type PositionKey = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

/** GET /draft/positional_value */
export interface PositionalValue {
  pos: PositionKey;
  best_available: { player_id: number; name: string; value: number | null } | null;
  replacement_value: number | null;
  value_over_replacement: number | null;
  /** 0..1 position of this VOR on the Low→High scale (engine-normalized). */
  scale_0_1: number | null;
  my_open_slots: number;
  /** Value lost by waiting until my following pick (newer API). */
  drop_if_wait?: number | null;
}

export interface PositionalValueResponse {
  positions: PositionalValue[];
  following_pick?: number | null;
  /** Engine's explanation of the numbers. */
  note?: string | null;
}

/** One team in GET /draft/teams */
export interface DraftTeam {
  team_id: number;
  name: string;
  is_me: boolean;
  roster: Player[];
  position_counts: Partial<Record<PositionKey, number>>;
  open_slots: string[];
  z_balance: Record<string, number | null>;
  next_pick: number | null;
  picks_until_next: number | null;
}

export interface TeamsResponse {
  teams: DraftTeam[];
}

/** One row of GET /draft/compare: player fields + per-game means + per-category z. */
export interface ComparePlayer extends Player {
  pts_mean?: number | null;
  reb_mean?: number | null;
  ast_mean?: number | null;
  stl_mean?: number | null;
  blk_mean?: number | null;
  fg3m_mean?: number | null;
  /** The live API sends makes and attempts; a percentage only if it adds *_pct_mean. */
  fg_pct_mean?: number | null;
  fgm_mean?: number | null;
  fga_mean?: number | null;
  ft_pct_mean?: number | null;
  ftm_mean?: number | null;
  fta_mean?: number | null;
  tov_mean?: number | null;
  gain?: number | null;
  p_available_next?: number | null;
  [z: `z_${string}`]: number | null | undefined;
}

export interface CompareResponse {
  players: ComparePlayer[];
}

export interface MyTeam {
  /** P(win category) vs a league-average team, keyed by category key. */
  p_cat: Record<string, number | null>;
  expected_cats: number | null;
  p_win_week: number | null;
  open_slots: string[];
  z_balance: Record<string, number | null>;
  roster: Player[];
}

export interface BoardLive {
  complete: false;
  decision_pick: number;
  following_pick: number | null;
  on_the_clock: number | null;
  recommendations: Recommendation[];
  my_team: MyTeam;
  /** Un-punted category keys my build is losing badly (after round 3). */
  drift: string[];
  timings_ms: Record<string, number>;
}

export type BoardComplete = { complete: true } & Session;

export type Board = BoardLive | BoardComplete;

/** GET /draft/rosters — keys are draft slots as strings ("1".."14"). */
export interface RostersResponse {
  teams: Record<string, PickRecord[]>;
}

export interface HealthResponse {
  ok: boolean;
  session: string | null;
}

export interface SessionIn {
  draft_id?: string;
  my_slot?: number | null;
  punts?: string[];
}

export interface PickIn {
  player_id?: number;
  player_name?: string;
  team_abbr?: string;
  /** Draft slot; the API defaults it to the team on the clock. */
  team_id?: number;
  pick_no?: number;
  source?: 'manual' | 'listener';
}

/** FastAPI error body: `detail` is a string, or {error, candidates} for an unmatched name. */
export interface ApiErrorBody {
  detail?: string | { error?: string; candidates?: unknown[] } | unknown;
}

/** Head-to-head read of one opponent vs me (absent for my own picks). */
export interface InsightVsMe {
  /** P(I win category) against this team, by category key. */
  p_cat: Record<string, number | null>;
  p_win_week: number | null;
  my_edges: string[];
  their_edges: string[];
}

/** One "live read" after a pick, from GET /draft/insights. */
export interface PickInsight {
  pick_no: number;
  round: number;
  team_id: number;
  team_name: string;
  player: { player_id: number; name: string; position: string | null; team_abbr: string | null };
  open_slots: string[];
  /** P(win category) vs a league-average team. */
  p_vs_league_avg: Record<string, number | null>;
  strengths: string[];
  weaknesses: string[];
  expected_cats_vs_avg: number | null;
  vs_me: InsightVsMe | null;
  /** Plain-language notes written by the engine. */
  notes: string[];
}

export interface InsightsResponse {
  insights: PickInsight[];
  current_pick: number | null;
  categories: Category[];
}

/** One fantasy week (GET /schedule/team_weeks). Weeks 1 and 17 span 14 days. */
export interface FantasyWeek {
  week: number;
  start: string;
  end: string;
  n_days: number;
  is_playoff: boolean;
}

export interface TeamWeeks {
  /** NBA team abbreviation in the schedule's codes (NOP, PHX, ...). */
  team: string;
  games_by_week: Record<string, number>;
  b2b_by_week: Record<string, number>;
  light_day_games_by_week: Record<string, number>;
  total: number;
  playoff_games: number;
}

export interface TeamWeeksResponse {
  weeks: FantasyWeek[];
  teams: TeamWeeks[];
  unscheduled_note: string | null;
  source: string | null;
}

export interface TeamDay {
  date: string;
  opponent: string;
  home: boolean;
  back_to_back: boolean;
  light_day: boolean;
  week: number;
}

export interface TeamDaysResponse {
  team: string;
  days: TeamDay[];
}
