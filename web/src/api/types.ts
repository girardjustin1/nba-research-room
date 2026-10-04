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
