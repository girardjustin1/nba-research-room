/**
 * PROPOSED contract for the in-season screens (This Week, Lineup, Moves, Waivers, Research
 * feed, Player analysis, Results). The Python side has not implemented the /season/*
 * endpoints yet; the two /schedule/* endpoints near the end ARE implemented. See
 * `web/docs/season-api.md` for the endpoint list and which engine module produces every
 * number.
 *
 * Rules the shapes encode:
 * - The engine computes every number. The UI formats and arranges; it never estimates.
 * - Every projection carries `mean` AND `sd`, plus the band endpoints the engine computed
 *   (`lo`/`hi` at coverage `level`). The UI never derives a band from mean and sd itself.
 * - Probabilities are fractions (0..1). Changes in probability are fractions too
 *   (0.042 = "+4.2 pts"); the UI renders them as percentage points.
 * - Every response carries `as_of` and a server-computed `stale` flag. Every factor carries
 *   its provenance (module + as_of) and a confidence with the inputs that were missing.
 * - Missing data is `null` plus an entry in `confidence.missing`. Never a neutral default.
 * - Wire format is JSON from FastAPI; NaN becomes null. Times are ISO-8601 with offset.
 */

import type { FetchLike } from './client';
import { query, seasonGet, seasonPost } from './seasonClient';

/* ------------------------------------------------------------------ primitives */

/** ISO-8601 timestamp with offset, e.g. "2026-11-18T19:42:00-05:00". */
export type IsoDateTime = string;
/** Calendar date in league time (US Eastern), e.g. "2026-11-18". */
export type IsoDate = string;

export type CategoryKey = 'fg_pct' | 'ft_pct' | 'fg3m' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov';

export interface SeasonCategory {
  key: CategoryKey;
  /** Yahoo label: FG%, FT%, 3PTM, PTS, REB, AST, ST, BLK, TO. */
  label: string;
  /** False for TO: fewer wins the category. */
  higher_is_better: boolean;
  /** Percentage categories are ratios of team makes / attempts, not sums of player %. */
  is_ratio: boolean;
}

/** Yahoo roster slots for this league (10 active + 2 BN + 1 IL). */
export type RosterSlot = 'PG' | 'SG' | 'G' | 'SF' | 'PF' | 'F' | 'C' | 'Util' | 'BN' | 'IL';

/** The Python module that produced a number. Names match `src/research_room/`. */
export type EngineModule =
  | 'projections' // projections/ensemble.py (and the member models)
  | 'simulate' // simulate.py: Monte Carlo / analytic H2H
  | 'optimizer' // optimizer.py: weekly MILP
  | 'overrides' // overrides.py: injuries + X events + overrides.yaml -> play_prob, minutes_cap
  | 'x_feed' // ingest/x_feed.py: parsed posts
  | 'kalshi' // ingest/kalshi.py: prop ladders, implied CDFs
  | 'rundown' // ingest/rundown.py: sportsbook lines
  | 'bdl' // ingest/bdl.py: schedule, box scores, injuries, odds, advanced stats
  | 'yahoo' // ingest/yahoo.py: rosters, matchup, free agents, transactions
  | 'schedule' // schedule.py: games per week, B2Bs, light days
  | 'features' // features.py: rolling minutes/usage, pace, DRTG, teammates-out
  | 'explain' // projections/explain.py: SHAP
  | 'backtest'; // backtest.py: model scoreboard

/** Where a number came from and when its inputs were current. */
export interface Provenance {
  module: EngineModule;
  /** When the inputs were current (not when the response was served); null when the source has no timestamp. */
  as_of: IsoDateTime | null;
  /** Engine run id, so a number can be traced in `decisions_log`. */
  run_id: string | null;
  /** Short qualifier, e.g. "Monte Carlo, 5,000 draws" or "ensemble of 4 models". */
  note: string | null;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

/** An input the engine wanted and did not have. Always shown; it is why confidence dropped. */
export interface MissingInput {
  key: string;
  /** Plain words, e.g. "No Kalshi prop market for this game". */
  label: string;
  /** What the engine did instead, e.g. "Used normal(mean, sd) instead of the market CDF". */
  effect: string | null;
}

export interface Confidence {
  level: ConfidenceLevel;
  /** Engine score 0..1 when it computes one; null when it only grades a level. */
  score: number | null;
  missing: MissingInput[];
}

/** A projected quantity. `lo`/`hi` are the engine's band at coverage `level` (e.g. 0.8). */
export interface Estimate {
  mean: number;
  sd: number;
  lo: number;
  hi: number;
  level: number;
}

/** A probability with the engine's uncertainty band (simulation + model disagreement). */
export interface ProbBand {
  p: number;
  lo: number;
  hi: number;
  level: number;
}

/** Fields every season response carries. */
export interface Envelope {
  /** When the response's inputs were current (oldest input that matters). */
  as_of: IsoDateTime;
  /** Server-computed: an input is older than its freshness budget. */
  stale: boolean;
  /** Plain words when stale, e.g. "BallDontLie sync failed at 6:30 pm; projections are from Tue 9:12 pm". */
  stale_reason: string | null;
  provenance: Provenance[];
}

/* --------------------------------------------------------------- shared refs */

export type InjuryStatus =
  | 'healthy'
  | 'probable'
  | 'questionable'
  | 'doubtful'
  | 'out'
  | 'day_to_day'
  | 'suspended';

export type SourceTier = 'official' | 'insider' | 'beat' | 'aggregator';

/** A source of news or a line. X sources carry the curated tier from `x_accounts.yaml`. */
export interface SourceRef {
  kind: 'x' | 'bdl' | 'nba_report' | 'yahoo' | 'kalshi' | 'sportsbook' | 'manual';
  /** "@TeamPR" for X; book name for sportsbooks; null otherwise. */
  handle: string | null;
  display_name: string;
  tier: SourceTier | null;
}

/** overrides.py output for a player on a date. */
export interface PlayerStatus {
  code: InjuryStatus;
  /** Yahoo-style label, e.g. "GTD", "O", "Q". */
  label: string;
  /** P(plays) on the next game date; null when unknown (never defaulted to 1). */
  play_prob: number | null;
  /** Minutes cap from news/overrides; null when none reported. */
  minutes_cap: number | null;
  note: string | null;
  source: SourceRef | null;
  as_of: IsoDateTime;
}

export type RosterOwner = 'mine' | 'opponent' | 'free_agent' | 'waivers' | 'other_team';

export interface PlayerRef {
  player_id: number;
  name: string;
  team_abbr: string | null;
  /** Yahoo eligibility, e.g. ["PG", "SG", "G", "Util"]. */
  eligible: RosterSlot[];
  /** Relative image path served by the API, or null (stories always use null). */
  headshot_url: string | null;
  team_logo_url: string | null;
  owner: RosterOwner;
  status: PlayerStatus;
  /** Yahoo % rostered (0..1) for free agents; null when unknown. */
  pct_rostered: number | null;
}

export interface GameRef {
  game_id: number;
  date: IsoDate;
  /** Null when the schedule has no tip time yet. */
  tip_at: IsoDateTime | null;
  opp_abbr: string;
  home: boolean;
  /** Second night of a back-to-back for this player's team. */
  b2b: boolean;
}

export interface CategoryDelta {
  key: CategoryKey;
  /** Change in P(win this category) vs the do-nothing baseline (fraction). */
  delta_p: number;
  /** P(win this category) after the change. */
  p_after: number;
}

/** One day of a pickup's (or drop's) week laid against MY open lineup slots (optimizer). */
export interface PlayableDay {
  date: IsoDate;
  weekday: string;
  /** Before the move takes effect: already played, or (for a drop) played before he is dropped. */
  is_past: boolean;
  has_game: boolean;
  opp_abbr: string | null;
  home: boolean | null;
  /** My open active slots he is eligible for that day, before the move. */
  open_slots: number;
  /** He has a game AND it fits an open slot (or displaces a worse starter). */
  playable: boolean;
}

/** Games a roster move adds, raw and playable. All counts are the optimizer's. */
export interface PlayableWeek {
  add: PlayableDay[];
  /** The paired drop's week (his games you give up); null when there is no drop. */
  drop: PlayableDay[] | null;
  raw_games_added: number;
  playable_games_added: number;
  provenance: Provenance;
}

/* ---------------------------------------------------------------- week context */

export interface WeekContext {
  week: number;
  /** e.g. "Week 4". */
  label: string;
  start: IsoDate;
  end: IsoDate;
  today: IsoDate;
  /** Days including today that still have games to set. */
  days_left: number;
  is_last_day: boolean;
  is_playoffs: boolean;
  playoff_round: 'quarterfinal' | 'semifinal' | 'final' | null;
  /** Categories the user is punting; the optimizer ignores them in the objective. */
  punts: CategoryKey[];
  categories: SeasonCategory[];
  /** Majority needed to win the week (5 of 9 here). */
  cats_to_win: number;
}

export interface TeamRef {
  team_id: number;
  name: string;
  manager: string | null;
  /** Season record, e.g. "2-1". */
  record: string | null;
  logo_url: string | null;
}

/* ---------------------------------------------------------- GET /season/week */

export interface CategoryLine {
  key: CategoryKey;
  /** Week-to-date actuals from Yahoo (ratios for FG%/FT%). */
  mine_to_date: number | null;
  theirs_to_date: number | null;
  /** Projected end-of-week totals (simulate.py), with sd and band. */
  mine_final: Estimate | null;
  theirs_final: Estimate | null;
  /** P(I win this category) under the do-nothing lineup. */
  p_win: number | null;
  punted: boolean;
  /** Engine flag: a close category that the moves can swing. */
  swing: boolean;
  /** Who leads the category on week-to-date totals right now (engine, TO: fewer leads). */
  status_now: 'winning' | 'losing' | 'tied';
  confidence: Confidence;
}

export interface DayGames {
  date: IsoDate;
  /** "Mon".."Sun" in league time. */
  weekday: string;
  is_today: boolean;
  is_past: boolean;
  /** NBA games that night (schedule.py). */
  league_games: number;
  /** schedule.py: 5 or fewer league games. */
  light_day: boolean;
  /** Games by players on each roster that day (played, if past). */
  mine: number;
  theirs: number;
  /** Games that fit into my active slots under the optimal lineup (optimizer). */
  mine_usable: number;
  theirs_usable: number;
  /** mine_usable − theirs_usable (engine): positive = more playable games for me that day. */
  usable_edge: number;
  mine_b2b: number;
  theirs_b2b: number;
}

export interface GamesSummary {
  mine_played: number;
  theirs_played: number;
  mine_remaining: number;
  theirs_remaining: number;
  mine_usable_remaining: number;
  theirs_usable_remaining: number;
  days: DayGames[];
  provenance: Provenance;
}

export interface Acquisitions {
  used: number;
  max: number;
  /** Waiver claims submitted but not yet processed. */
  pending: number;
  resets_on: IsoDate;
}

export interface WinOutlook {
  p_win_week: ProbBand;
  /** This outlook's P(win week) minus the do-nothing baseline (engine-computed); null on the baseline. */
  delta_vs_baseline: number | null;
  /** Expected categories won (of 9), with sd. */
  expected_cats: Estimate;
  method: 'monte_carlo' | 'analytic';
  draws: number | null;
  provenance: Provenance;
  confidence: Confidence;
}

/** A breaking news item already turned into its effect on my week. */
export interface BreakingAlert {
  id: string;
  at: IsoDateTime;
  player: PlayerRef;
  headline: string;
  source: SourceRef;
  impact: Impact;
  /** The feed item it came from. */
  feed_item_id: string;
}

export interface WeekResponse extends Envelope {
  week: WeekContext;
  me: TeamRef;
  opponent: TeamRef;
  /** Do nothing: the current Yahoo lineup carried to the end of the week. */
  baseline: WinOutlook;
  /** All recommended moves applied (optimizer + simulate); null when no move helps. */
  with_moves: WinOutlook | null;
  categories: CategoryLine[];
  games: GamesSummary;
  acquisitions: Acquisitions;
  alerts: BreakingAlert[];
}

/* ------------------------- GET /season/week/probability (implemented: history + do nothing) */

/** What moved P(win week) at a snapshot. */
export type WinProbEventKind = 'nightly' | 'games_final' | 'news' | 'lineup' | 'transaction';

/** A snapshot that happened (Mon → now). */
export interface WinProbPoint {
  ts: IsoDateTime;
  p_win_week: number;
  /** Engine band at 80% coverage. */
  lo: number;
  hi: number;
  /** Categories each side leads at this moment (live Yahoo totals). */
  cats_lead: { me: number; opp: number };
  /** The event that triggered this snapshot; delta_p is the change from the previous snapshot. */
  event: { kind: WinProbEventKind; label: string; delta_p: number } | null;
  /** P(win) per category at this snapshot (simulate.py); feeds the category dropdown. */
  p_cats?: Partial<Record<CategoryKey, number>>;
}

/**
 * One point of a projected path. `p_win_week` is P(win week) if the scenario's moves due by
 * `ts` are made and nothing after — so the line climbs as each move takes effect and ends at
 * the full plan's value. All scenarios share the same `ts` grid; the first point is "now".
 */
export interface ScenarioPoint {
  ts: IsoDateTime;
  p_win_week: number;
  lo: number;
  hi: number;
  expected_cats: number;
  /** Move ids in effect by this time. */
  moves_applied: string[];
  /** Change in P(win category) vs doing nothing, at this time. */
  cat_deltas: CategoryDelta[];
  /** P(win) per category on this path at this time (simulate.py). */
  p_cats?: Partial<Record<CategoryKey, number>>;
}

export interface Scenario {
  scenario_id: string;
  /** e.g. "Do nothing", "Recommended plan", "Stream a C". */
  label: string;
  kind: 'do_nothing' | 'recommended' | 'custom';
  move_ids: string[];
  points: ScenarioPoint[];
  final: { p_win_week: number; lo: number; hi: number; expected_cats: number };
  /** final.p_win_week minus the do-nothing final (engine); null on the do-nothing scenario. */
  delta_vs_do_nothing: number | null;
}

/**
 * simulate.py snapshots (after each nightly run, game-day refresh and material news event,
 * stored in `matchup_snapshots`) plus projected scenarios from optimizer.py + simulate.py.
 */
export interface WinProbabilityResponse extends Envelope {
  week: WeekContext;
  opponent: TeamRef;
  /** Oldest first; the last point is "now". */
  history: WinProbPoint[];
  /** Do nothing, the recommended plan, and up to 3 named alternatives. Empty once the week is over. */
  scenarios: Scenario[];
  recommended_move_ids: string[];
  /** Latest snapshot and its change vs the last snapshot before today. */
  current: { p_win_week: number; delta_since_yesterday: number | null } | null;
  /** When the live category totals (cats_lead) were read from Yahoo. */
  cats_as_of: IsoDateTime | null;
}

/** POST /season/scenario body. */
export interface ScenarioRequest {
  move_ids: string[];
}

/** POST /season/scenario response: the engine re-simulates the chosen set of moves. */
export interface ScenarioResponse {
  scenario: Scenario | null;
  feasible: boolean;
  /** e.g. "Uses 5 of 4 acquisitions". */
  message: string | null;
  solve_ms: number | null;
  /** Moves that cannot be added to the current selection, with the engine's reason. */
  incompatible: { move_id: string; reason: string }[];
}

/* ---------------------------- GET /season/week/gamecenter (proposed, Phase 2) */

/** Milestones drawn as icon dots on the probability charts and listed as key moments. */
export type MilestoneKind =
  | 'my_pickup'
  | 'opp_pickup'
  | 'injury'
  | 'lineup_lock'
  | 'missed_lock'
  | 'flip_mine'
  | 'flip_theirs'
  | 'big_night'
  | 'clinched'
  | 'out_of_reach';

export interface GameCenterMoment {
  id: string;
  ts: IsoDateTime;
  kind: MilestoneKind;
  /** Engine-built headline, e.g. "BLK flipped to you". */
  headline: string;
  detail: string | null;
  /** Change in P(win week) the moment caused (simulate.py rerun). */
  delta_p_win: number | null;
  category: CategoryKey | null;
  /** Category score right after the moment. */
  score_after: { me: number; opp: number };
  /** Shown under "Key moments" (lead changes, injuries, transactions, big nights); the rest only under "All updates". */
  key: boolean;
  player: PlayerRef | null;
}

export interface LinescoreRow {
  key: CategoryKey;
  /** Live week-to-date total (Yahoo) and projected final (simulate.py, mean ± sd). */
  me: { total: number | null; projected: Estimate | null };
  opp: { total: number | null; projected: Estimate | null };
  /** P(I win the category) with band. */
  p_win: ProbBand | null;
  /** Who leads on totals right now (TO: fewer leads). */
  leader: 'me' | 'opp' | 'tied';
  punted: boolean;
}

export interface StrengthRow {
  key: string;
  label: string;
  group: 'games' | 'positions' | 'minutes' | 'categories';
  me: number | null;
  opp: number | null;
  format: ValueFormat;
  /** False for TO (more is worse). */
  higher_is_better: boolean;
  /** Is the row's ratio projected (end of week) or a current count. */
  projected: boolean;
}

export interface GameCenterDay {
  date: IsoDate;
  weekday: string;
  is_today: boolean;
  is_past: boolean;
  me_games: number;
  opp_games: number;
  /** Games that fit active slots (optimizer). */
  me_playable: number;
  opp_playable: number;
  /** me_playable − opp_playable (engine). */
  playable_edge: number;
  me_players: PlayerRef[];
  opp_players: PlayerRef[];
}

export interface InjuryRow {
  player: PlayerRef;
  side: 'me' | 'opp';
  /** e.g. "Fri", "1–2 weeks", null when unknown. */
  est_return: string | null;
  /** Effect of this absence on MY P(win week) (simulate.py): negative for my players, positive for theirs. */
  delta_p_win: number | null;
}

export interface GameCenterResponse extends Envelope {
  week: WeekContext;
  me: TeamRef;
  opponent: TeamRef;
  /** Categories led right now. */
  score: { me: number; opp: number; ties: number };
  games_left: { me: number; opp: number };
  days: GameCenterDay[];
  since_yesterday: { delta_p: number | null; label: string } | null;
  linescore: LinescoreRow[];
  /** The 2–3 categories closest to 50/50 that the week can still swing. */
  swing: CategoryKey[];
  /** Newest last. */
  moments: GameCenterMoment[];
  strength: StrengthRow[];
  injuries: InjuryRow[];
  /** Pickups that raise P(win week), ranked (same shape as /season/waivers). */
  pickups: WaiverCandidate[];
  acquisitions: Acquisitions;
  /** Set once the week is over. */
  final: { outcome: 'win' | 'loss' | 'tie' } | null;
}

/* --------------------------------------------------------- GET /season/moves */

export type MoveKind = 'add_drop' | 'start' | 'bench';

export interface Deadline {
  kind: 'lineup_lock' | 'waiver_clears' | 'add_before_game' | 'week_end';
  at: IsoDateTime;
}

export interface Move {
  move_id: string;
  rank: number;
  kind: MoveKind;
  /** ADD target, START target, or BENCH target. */
  player: PlayerRef;
  /** The paired DROP for add_drop; who sits for START; who starts instead for BENCH. */
  counterpart: PlayerRef | null;
  slot: RosterSlot | null;
  /** Dates the move changes (league time). */
  dates: IsoDate[];
  /** Change in P(win week) vs do-nothing, applying this move alone (fraction, with band). */
  delta_p_win: Estimate;
  /** P(win week) with this move alone. */
  p_win_after: number;
  delta_expected_cats: number;
  /** Material category changes only, largest |delta| first. */
  cat_deltas: CategoryDelta[];
  /** Plain-language reason built by the engine from the numbers. */
  reason: string;
  /** Supporting facts, each one sentence with its numbers. */
  details: string[];
  confidence: Confidence;
  deadline: Deadline;
  uses_acquisition: boolean;
  /** add_drop only: the add's and drop's weeks against my open slots. */
  playable: PlayableWeek | null;
  /** Moves that must happen first (e.g. the add that frees a slot). */
  depends_on: string[];
  provenance: Provenance[];
}

export interface OptimizerRun {
  status: 'optimal' | 'feasible' | 'infeasible' | 'not_run';
  /** Readable reason when infeasible or not run. */
  message: string | null;
  solved_at: IsoDateTime | null;
  solve_ms: number | null;
  horizon: IsoDate[];
  objective: 'p_win_week';
}

export interface MovesResponse extends Envelope {
  baseline: { p_win_week: ProbBand; expected_cats: number };
  /** All moves together. Not the sum of the single-move deltas (they interact). */
  with_all: { p_win_week: ProbBand; expected_cats: number; delta_vs_baseline: number } | null;
  moves: Move[];
  acquisitions: Acquisitions;
  optimizer: OptimizerRun;
}

/* -------------------------------------------------------- GET /season/lineup */

export type ReasonTag = 'games' | 'matchup' | 'minutes' | 'status' | 'category' | 'eligibility' | 'lock';

export interface LineupAssignment {
  slot: RosterSlot;
  player: PlayerRef | null;
  /** That day's game, null when the player has no game. */
  game: GameRef | null;
  /** The player's game has started; Yahoo no longer lets this slot change. */
  locked: boolean;
}

export interface SlotDiff {
  slot: RosterSlot;
  /** Index among same-named slots (C #1, C #2). */
  slot_index: number;
  current: LineupAssignment;
  optimal: LineupAssignment;
  changed: boolean;
  reason: string | null;
  reason_tags: ReasonTag[];
  /** Change in P(win week) from this slot change alone, when the engine isolates it. */
  delta_p_win: number | null;
}

export interface LineupDay {
  date: IsoDate;
  weekday: string;
  is_today: boolean;
  is_past: boolean;
  slots: SlotDiff[];
  bench_current: LineupAssignment[];
  bench_optimal: LineupAssignment[];
  il: LineupAssignment[];
  games_available: number;
  games_started_current: number;
  games_started_optimal: number;
  /** Change in P(win week) from this day's changes together. */
  delta_p_win: number | null;
  /** Earliest tip among my players, for the lock warning. */
  first_lock_at: IsoDateTime | null;
}

export interface LineupResponse extends Envelope {
  week: WeekContext;
  /** Today first, then the rest of the week. Past days are omitted. */
  days: LineupDay[];
  roster: PlayerRef[];
  optimizer: OptimizerRun;
}

/* ---------------------------------------------------------- GET /season/feed */

export type FeedKind = 'news' | 'market' | 'model' | 'data';

/** What an item means for MY week (simulate.py rerun with the new inputs). */
export interface Impact {
  delta_p_win: number | null;
  cat_deltas: CategoryDelta[];
  /** e.g. "Your REB win chance −6 pts". Built by the engine from the numbers. */
  summary: string;
  /** e.g. "Start Pellham over Venhaus at Util". */
  suggestion: string | null;
  move_id: string | null;
  severity: 'high' | 'medium' | 'low' | 'none';
  confidence: Confidence;
  computed_at: IsoDateTime;
}

interface FeedBase {
  id: string;
  kind: FeedKind;
  at: IsoDateTime;
  title: string;
  impact: Impact | null;
  /** Touches my roster or my opponent's this week. */
  affects_matchup: boolean;
}

export interface NewsEvent extends FeedBase {
  kind: 'news';
  player: PlayerRef;
  status: InjuryStatus | null;
  minutes_cap: number | null;
  starting: boolean | null;
  game: GameRef | null;
  source: SourceRef;
  /** LLM parse confidence for the structured fields (0..1). Raw post text is never stored. */
  parse_confidence: number;
  /** Other accounts that reported the same thing. */
  corroborated_by: SourceRef[];
}

export interface MarketEvent extends FeedBase {
  kind: 'market';
  player: PlayerRef;
  venue: 'kalshi' | 'sportsbook';
  book: string | null;
  stat: CategoryKey | 'min';
  line_before: number | null;
  line_after: number;
  /** Market-implied mean (Kalshi ladder CDF or de-vigged book line); null when illiquid. */
  implied_mean_after: number | null;
  ours: Estimate;
  volume: number | null;
  liquid: boolean;
  game: GameRef | null;
}

export interface ScoreRow {
  model: string;
  stat: CategoryKey | 'min' | 'all';
  mae: number;
  baseline_mae: number;
  /** (baseline_mae − mae) / baseline_mae, engine-computed; positive = better than EWMA. */
  rel_improvement: number;
  beats_baseline: boolean;
  /** Ensemble weight (>= 0.05 when gated on). */
  weight: number | null;
  gated_on: boolean;
}

export interface ModelEvent extends FeedBase {
  kind: 'model';
  job: 'projections' | 'ensemble' | 'backtest' | 'optimizer' | 'simulate';
  summary: string;
  players_changed: number | null;
  scoreboard: ScoreRow[] | null;
  run_ms: number | null;
}

export interface DataEvent extends FeedBase {
  kind: 'data';
  source: 'bdl' | 'yahoo' | 'kalshi' | 'rundown' | 'x';
  job: string;
  status: 'ok' | 'partial' | 'failed';
  rows: number | null;
  message: string | null;
  duration_ms: number | null;
}

export type FeedItem = NewsEvent | MarketEvent | ModelEvent | DataEvent;

export interface JobHealth {
  job: string;
  label: string;
  module: EngineModule;
  last_run_at: IsoDateTime | null;
  last_status: 'ok' | 'partial' | 'failed' | 'never';
  next_run_at: IsoDateTime | null;
  /** Server-computed against the job's freshness budget. */
  stale: boolean;
  running: boolean;
  progress: { done: number; total: number; unit: string } | null;
  started_at: IsoDateTime | null;
}

export interface FeedResponse extends Envelope {
  items: FeedItem[];
  jobs: JobHealth[];
  /** X API read budget (config): reads used today of the daily limit. */
  x_budget: { used: number; limit: number };
  next_cursor: string | null;
}

/* ----------------------------------------------- GET /season/players/{id} */

export type PushDirection = 'for' | 'against' | 'neutral' | 'unknown';

/** How the UI should print `Factor.value`. Formatting only. */
export type ValueFormat =
  | 'prob' // 0.62 -> 62%
  | 'prob_delta' // 0.042 -> +4.2 pts
  | 'minutes' // 31.4 -> 31.4 min
  | 'percent' // 0.274 -> 27.4%
  | 'count' // 4 -> 4
  | 'decimal' // 21.36 -> 21.4
  | 'signed' // 1.2 -> +1.2
  | 'rank'; // 3 -> 3rd

export interface DayPlan {
  date: IsoDate;
  weekday: string;
  action: 'start' | 'bench' | 'no_game' | 'out' | 'not_rostered' | 'past';
  slot: RosterSlot | null;
}

export type PlayerAction = 'start' | 'bench' | 'add' | 'drop' | 'hold' | 'stream';

export interface PlayerRecommendation {
  action: PlayerAction;
  /** Engine-built, e.g. "Start at C on Thu and Sat; bench Fri". */
  headline: string;
  slot: RosterSlot | null;
  plan: DayPlan[];
  /** Effect on P(win week) of following the recommendation vs the do-nothing lineup. */
  delta_p_win: Estimate | null;
  /** e.g. "Over Bram Venhaus at Util". */
  versus: string | null;
  confidence: Confidence;
  move_id: string | null;
}

export interface CatEstimate extends Estimate {
  key: CategoryKey;
}

export type FactorDetail =
  | {
      kind: 'projection';
      games: number;
      per_game: CatEstimate[];
      week: CatEstimate[];
    }
  | {
      kind: 'schedule';
      days: {
        date: IsoDate;
        weekday: string;
        game: GameRef | null;
        /** My open active slots he is eligible for that day (optimizer, before adding him). */
        open_slots: number;
        would_start: boolean;
        light_day: boolean;
      }[];
    }
  | {
      kind: 'minutes' | 'usage';
      /** Last N games, oldest first. Null = did not play. */
      games: { date: IsoDate; opp_abbr: string; value: number | null }[];
      rolling3: number | null;
      rolling5: number | null;
      rolling10: number | null;
      ewma: number | null;
      season: number | null;
      projected: Estimate | null;
      /** 'minutes' are minutes; 'usage' is a fraction (0.274). */
      unit: 'min' | 'fraction';
    }
  | {
      kind: 'opponents';
      games: {
        game: GameRef;
        pace: number | null;
        /** 1 = fastest of 30. */
        pace_rank: number | null;
        def_rating: number | null;
        /** 1 = best defense of 30. */
        def_rank: number | null;
      }[];
    }
  | {
      kind: 'vegas';
      games: {
        game: GameRef;
        /** His team's spread (negative = favored). */
        spread: number | null;
        total: number | null;
        implied_team_total: number | null;
        /** P(final margin >= 15) from the spread; minutes risk for starters. */
        blowout_prob: number | null;
      }[];
    }
  | {
      kind: 'market';
      lines: {
        stat: CategoryKey | 'min';
        venue: 'kalshi' | 'sportsbook';
        book: string | null;
        game: GameRef | null;
        line: number | null;
        implied_mean: number | null;
        ours: Estimate;
        /** (implied_mean - ours.mean) / ours.sd; null without a liquid market. */
        gap_sd: number | null;
        agreement: 'agrees' | 'market_higher' | 'market_lower' | 'no_market';
        liquid: boolean;
        volume: number | null;
      }[];
    }
  | {
      kind: 'news';
      events: {
        at: IsoDateTime;
        status: InjuryStatus | null;
        minutes_cap: number | null;
        starting: boolean | null;
        /** Engine-written summary of the parsed post (raw text is discarded). */
        summary: string;
        source: SourceRef;
        parse_confidence: number;
      }[];
    }
  | {
      kind: 'teammates';
      out: {
        name: string;
        status: InjuryStatus;
        /** Change in his usage share with this teammate out (fraction, 0.031 = +3.1 pts). */
        usage_bump: number | null;
        minutes_bump: number | null;
        /** Games in the sample behind the bump. */
        sample_games: number;
      }[];
    }
  | {
      kind: 'slot_fit';
      days: IsoDate[];
      slots: {
        slot: RosterSlot;
        eligible: boolean;
        /** Per day: is the slot open, and the change in P(win week) of putting him there. */
        by_day: { date: IsoDate; open: boolean; delta_p_win: number | null }[];
      }[];
      best_slot: RosterSlot | null;
    }
  | {
      kind: 'category_fit';
      cats: {
        key: CategoryKey;
        p_without: number;
        p_with: number;
        /** p_with − p_without, computed by the engine. */
        delta_p: number;
        /** Engine flag: within the swing band (close) this week. */
        close: boolean;
        punted: boolean;
      }[];
    }
  | {
      kind: 'models';
      stat: CategoryKey | 'min';
      models: { model: string; mean: number; sd: number; beats_baseline: boolean; weight: number | null }[];
      ensemble: Estimate;
    }
  | {
      kind: 'drivers';
      /** Which model and target the SHAP values explain. */
      model: string;
      target: 'min' | CategoryKey;
      base_value: number;
      drivers: { feature: string; label: string; value_label: string; contribution: number }[];
    };

export type FactorKind = FactorDetail['kind'];

export interface Factor {
  id: string;
  kind: FactorKind;
  title: string;
  /** The headline number for the card; null when the engine could not compute it. */
  value: number | null;
  format: ValueFormat;
  /** Qualifier after the number, e.g. "per game", "games left". */
  value_note: string | null;
  /** One plain-language line built by the engine from the numbers. */
  reading: string;
  /** Does this factor push for or against the recommendation? */
  push: PushDirection;
  confidence: Confidence;
  provenance: Provenance[];
  detail: FactorDetail;
}

export interface PlayerAnalysisResponse extends Envelope {
  week: WeekContext;
  player: PlayerRef;
  recommendation: PlayerRecommendation;
  /** Ordered by the engine, most decision-relevant first. */
  factors: Factor[];
  confidence: Confidence & { summary: string };
}

/* -------------------------------------- GET /season/compare?a=..&b=..&decision=.. */

export interface CompareRow {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  format: ValueFormat;
  /** Engine verdict for the row (TO: fewer is better). */
  better: 'a' | 'b' | 'even' | 'unknown';
  note: string | null;
}

export interface CompareResponse extends Envelope {
  week: WeekContext;
  decision: 'start_sit' | 'add_drop';
  /** Start/sit decision date; null for add/drop (rest of week). */
  date: IsoDate | null;
  a: PlayerRef;
  b: PlayerRef;
  verdict: {
    choose: number | null;
    /** P(win week) choosing A minus choosing B (fraction, with band). */
    delta_p_win: Estimate;
    reason: string;
    confidence: Confidence;
  };
  rows: CompareRow[];
  cat_deltas: { key: CategoryKey; p_a: number; p_b: number }[];
}

/* ------------------------------------------------------ GET /season/waivers */

export interface CategoryNeed {
  key: CategoryKey;
  p_win: number | null;
  /** Engine grade: how much a pickup in this category would move P(win week). */
  need: 'high' | 'medium' | 'low' | 'punt' | 'safe';
}

export interface WaiverCandidate {
  rank: number;
  player: PlayerRef;
  availability: 'free_agent' | 'waivers';
  /** When a waiver claim would clear; null for free agents. */
  clears_at: IsoDateTime | null;
  first_usable: IsoDate | null;
  games_left: number;
  /** Games that fit my open active slots after the paired drop (optimizer). */
  games_usable: number;
  /** His week and the paired drop's against my open slots. */
  playable: PlayableWeek;
  drop: PlayerRef | null;
  drop_games_left: number | null;
  delta_p_win: Estimate;
  p_win_after: number;
  cat_deltas: CategoryDelta[];
  cats_helped: CategoryKey[];
  reason: string;
  confidence: Confidence;
  deadline: Deadline;
}

export interface WaiversResponse extends Envelope {
  week: WeekContext;
  acquisitions: Acquisitions;
  baseline_p_win: ProbBand;
  needs: CategoryNeed[];
  candidates: WaiverCandidate[];
  /** Free agents the engine scored, so "no pickups" reads as "none help", not "none scored". */
  pool_size: number;
}

/* ------------------------- GET /season/players/{id}/calendar?from=&to= (proposed) */

export type CalendarDayState = 'played' | 'scheduled' | 'dnp' | 'out' | 'no_game';
/** "value" = sum of the 9 category z-scores for that game (TO negative). */
export type CalendarMetric = 'value' | CategoryKey;

export interface CalendarMetricOption {
  key: CalendarMetric;
  label: string;
  /** Signed metrics (value, FG%/FT% impact) get the diverging scale; counts get sequential. */
  signed: boolean;
  /** Where the number comes from on each day. */
  field: 'value' | 'stat' | 'z';
  /** False for TO: more is worse. */
  higher_is_better: boolean;
  /** Engine-chosen domain for the color bins (e.g. the player's 5th–95th percentile). */
  domain: { min: number; max: number };
}

export interface CalendarDay {
  date: IsoDate;
  state: CalendarDayState;
  opponent: string | null;
  home: boolean | null;
  tip_at: IsoDateTime | null;
  /** Played days only (game_logs). */
  minutes: number | null;
  /** Box score line; FG/FT carry makes and attempts for the readout. */
  stats: (Partial<Record<CategoryKey, number>> & { fgm?: number; fga?: number; ftm?: number; fta?: number }) | null;
  /** Sum of the 9 z-scores for that game, TO negative (played days). */
  value: number | null;
  /** Per-category z (FG%/FT% are volume-weighted impact). */
  z: Partial<Record<CategoryKey, number>> | null;
  /** Future days: projection for each metric (projections.py), always mean AND sd. */
  projected: Partial<Record<CalendarMetric, { mean: number; sd: number }>> | null;
  /** P(plays) for future days, from overrides. */
  play_prob: number | null;
  /** For out / dnp: the engine's one-line reason (status source + note). */
  status_note: string | null;
  light_day: boolean;
  back_to_back: boolean;
  cup_or_playoff_week: 'nba_cup' | 'playoffs' | null;
  /** Fantasy week this date belongs to. */
  week: number | null;
  /** Opponent context for game days (features.py): ranks of 30, 1 = fastest / best defense. */
  opp_context: { pace_rank: number | null; def_rank: number | null } | null;
  /** Future days: my open active slots he is eligible for that day (optimizer). */
  my_open_slots: number | null;
  /** Engine-written "why it matters for my week" notes, built from the numbers. */
  notes: string[];
  source: Provenance;
  confidence: Confidence;
}

export interface PlayerCalendarResponse extends Envelope {
  player_id: number;
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  metric_options: CalendarMetricOption[];
  days: CalendarDay[];
  /** His remaining games in the current fantasy week. */
  games_left_this_week: number;
}

/* ------------------------------------------- IMPLEMENTED: schedule endpoints */
/*  These two already exist in src/research_room/api.py (draft API, 127.0.0.1:8765).
    Shapes below mirror the live responses; stories still use invented counts. */

/** GET /schedule/team_weeks — one row per fantasy week. Weeks 1 and 17 have n_days 14. */
export interface ScheduleWeek {
  week: number;
  start: IsoDate;
  end: IsoDate;
  n_days: number;
  is_playoff: boolean;
}

export interface TeamWeekCounts {
  team: string;
  /** Keys are week numbers as strings ("1".."22"). */
  games_by_week: Record<string, number>;
  b2b_by_week: Record<string, number>;
  light_day_games_by_week: Record<string, number>;
  total: number;
  playoff_games: number;
}

export interface TeamWeeksResponse {
  weeks: ScheduleWeek[];
  teams: TeamWeekCounts[];
  /** e.g. "the NBA schedules 30 more games after the Cup group stage; December counts will rise". */
  unscheduled_note: string | null;
  source: string;
}

/** GET /schedule/team_days?team=DEN&start=YYYY-MM-DD&end=YYYY-MM-DD */
export interface TeamDay {
  date: IsoDate;
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

/* ------------------------------------------------------ GET /season/results */

export interface CategoryResult {
  key: CategoryKey;
  /** Final week totals (ratios for FG%/FT%) from Yahoo. */
  mine: number | null;
  theirs: number | null;
  result: 'won' | 'lost' | 'tied';
  /** My advantage, signed so positive is good for me (TO: theirs − mine). */
  margin: number | null;
  /** P(win this category) the engine published before the week's first tip. */
  predicted_p: number | null;
}

export interface FollowedMove {
  move_id: string;
  kind: MoveKind;
  /** Engine-built, e.g. "Add Callum Bramwell, drop Bram Venhaus". */
  title: string;
  recommended_at: IsoDateTime;
  /** From Yahoo transactions and daily lineups: did the roster match the recommendation? */
  followed: 'yes' | 'no' | 'partial';
  /** Change in P(win week) the engine predicted when it recommended the move. */
  predicted_delta_p_win: number;
  /** backtest.py replay: categories won with the move minus without it, on actual box scores. */
  realized_delta_cats: number | null;
  /** A category whose result the move changed in the replay, if any. */
  flipped: CategoryKey | null;
  realized_note: string | null;
}

export interface WeekPrediction {
  /** When the prediction was frozen (before the week's first tip). */
  as_of: IsoDateTime;
  p_win_week: ProbBand;
  expected_cats: Estimate;
}

export interface WeekResult {
  week: number;
  label: string;
  start: IsoDate;
  end: IsoDate;
  is_playoffs: boolean;
  playoff_round: WeekContext['playoff_round'];
  opponent: TeamRef;
  outcome: 'win' | 'loss' | 'tie';
  cats_won: number;
  cats_lost: number;
  cats_tied: number;
  categories: CategoryResult[];
  predicted: WeekPrediction;
  /** Mean Brier score of that week's per-category predictions (lower is better). */
  brier: number | null;
  /** Categories where the pre-week favorite (p > 0.5) won (backtest.py). */
  favorite_hits: number | null;
  moves: FollowedMove[];
  /** Engine-built one-line recap from the numbers. */
  summary: string;
  provenance: Provenance[];
  confidence: Confidence;
}

export interface StandingRow {
  rank: number;
  team: TeamRef;
  wins: number;
  losses: number;
  ties: number;
  is_me: boolean;
  games_back: number | null;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  /** Mean predicted probability in the bin. */
  predicted: number;
  /** Share that actually happened. */
  observed: number;
  n: number;
}

export interface ModelScoreboard {
  as_of: IsoDateTime;
  /** e.g. "Weeks 1–3, 2026-27" or "2025-26 replay (preseason)". */
  scope_label: string;
  /** Completed weeks the backtest scored. */
  from_week: number;
  to_week: number;
  games_scored: number;
  /** Rows for every model x stat, including the EWMA baseline itself. */
  rows: ScoreRow[];
  /** Calibration of P(win category) predictions over the window (backtest.py). */
  calibration: { bins: CalibrationBin[]; brier: number; brier_baseline: number; baseline_label: string };
  ensemble_gated_on: boolean;
  provenance: Provenance[];
  confidence: Confidence;
}

export interface ResultsResponse extends Envelope {
  record: { wins: number; losses: number; ties: number };
  standings: StandingRow[];
  my_rank: number;
  playoff_spots: number;
  regular_weeks_left: number;
  /** Completed weeks, newest first. */
  weeks: WeekResult[];
  scoreboard: ModelScoreboard;
  punts: CategoryKey[];
  categories: SeasonCategory[];
}

/* --------------------------------------------------- GET /season/notifications */

export type NotificationKind = 'waiver' | 'injury' | 'news' | 'lineup_lock' | 'game_day' | 'model';
/** urgent = act before a lock today; high = changes my week; normal = useful; low = FYI. */
export type NotificationPriority = 'urgent' | 'high' | 'normal' | 'low';

export interface WaiverClaimStatus {
  status: 'pending' | 'cleared' | 'lost' | 'cancelled';
  player: PlayerRef;
  drop: PlayerRef | null;
  clears_at: IsoDateTime;
  /** Whole days until it clears (engine, league time); 0 = today. */
  clears_in_days: number;
  acquisitions_left: number;
}

export interface SeasonNotification {
  id: string;
  kind: NotificationKind;
  priority: NotificationPriority;
  created_at: IsoDateTime;
  title: string;
  /** Engine-built plain-language body from the numbers. */
  body: string;
  read: boolean;
  player: PlayerRef | null;
  /** Effect on my week when the engine computed one (same shape as the feed). */
  impact: Impact | null;
  /** What to do, and where in the app it goes. */
  /** 'scorecard': the System screen's Live tab (in-season checks of the model). */
  action: { label: string; target: 'move' | 'lineup' | 'player' | 'pickups' | 'feed' | 'scorecard'; ref: string | null } | null;
  deadline: Deadline | null;
  claim: WaiverClaimStatus | null;
  provenance: Provenance[];
}

export interface NotificationsResponse extends Envelope {
  items: SeasonNotification[];
  unread: number;
}

/* ------------------------------------------- GET /season/league_teams/{team_id} */

export interface LeagueTeamProfile extends Envelope {
  team: TeamRef;
  is_me: boolean;
  rank: number;
  roster: PlayerRef[];
  /** Season-to-date category strength vs the league: z of team per-game totals (TO: lower is better, pre-signed). */
  strengths: { key: CategoryKey; z: number; rank: number }[];
  /** Engine-built one-liners, e.g. "Punting FT% (14th)". */
  notes: string[];
  head_to_head: {
    /** Past meetings this season. */
    played: { week: number; outcome: 'win' | 'loss' | 'tie'; cats_won: number; cats_lost: number }[];
    /** Next scheduled meeting, with the engine's P(win week) if projected. */
    next: { week: number; p_win_week: ProbBand | null } | null;
  };
  week_games_left: number | null;
}

/* ---------------------------------------------- GET /season/nba_teams/{abbr} */

/** Composes the implemented /schedule/* data with features.py context. */
export interface NbaTeamProfile extends Envelope {
  team: string;
  name: string;
  /** features.py, season to date: ranks of 30 (1 = fastest pace / best defense). */
  pace: number | null;
  pace_rank: number | null;
  def_rating: number | null;
  def_rank: number | null;
  /** From /schedule/team_weeks for this team. */
  weeks: TeamWeekCounts;
  /** From /schedule/team_days, the next ~30 days. */
  days: TeamDay[];
  /** My rostered players on this team. */
  my_players: PlayerRef[];
  opponent_players: PlayerRef[];
}

/* ------------------------------------------------------------------ client */


/**
 * Typed client for the season endpoints (the app uses it for /season/lineup today; the
 * rest are proposed). Errors follow the draft client: ApiError / ApiUnreachableError.
 */
/* ---------------------------------------------------------------------------------------------
 *  This week's opponent, entered by hand (GET/POST /season/opponent_roster, GET /season/player_search).
 *  One opponent at a time, replaced each week, kept on this computer only; players from the NBA list.
 * ------------------------------------------------------------------------------------------- */
export interface OpponentRoster {
  /** The fantasy week the entry is for (the current one, or the first before the season). */
  week: { week: number; start: IsoDate; end: IsoDate } | null;
  /** League teams other than mine, by number. */
  teams: { team_id: number; label: string }[];
  opponent_team_id: number | null;
  players: PlayerRef[];
  /** Pasted names that matched no NBA player, with suggestions (reported, never kept). */
  unmatched: { name: string; suggestions: string[] }[];
  saved_at: IsoDateTime | null;
  /** How the entry is kept, shown on the screen. */
  policy: string;
}

export interface OpponentRosterRequest {
  team_id: number;
  player_ids: number[];
  /** Names pasted one per line; matched to NBA players on the server. */
  names: string[];
}

export interface PlayerSearchResponse {
  players: PlayerRef[];
}

export interface SeasonApi {
  week(): Promise<WeekResponse>;
  weekProbability(): Promise<WinProbabilityResponse>;
  gameCenter(): Promise<GameCenterResponse>;
  scenario(body: ScenarioRequest): Promise<ScenarioResponse>;
  moves(): Promise<MovesResponse>;
  lineup(): Promise<LineupResponse>;
  feed(params?: { kind?: FeedKind; cursor?: string }): Promise<FeedResponse>;
  player(playerId: number): Promise<PlayerAnalysisResponse>;
  compare(a: number, b: number, decision: CompareResponse['decision'], date?: IsoDate): Promise<CompareResponse>;
  waivers(params?: { position?: RosterSlot; category?: CategoryKey }): Promise<WaiversResponse>;
  results(): Promise<ResultsResponse>;
  calendar(playerId: number, from: IsoDate, to: IsoDate): Promise<PlayerCalendarResponse>;
  /** Implemented today. */
  teamWeeks(): Promise<TeamWeeksResponse>;
  /** Implemented today. */
  teamDays(team: string, start?: IsoDate, end?: IsoDate): Promise<TeamDaysResponse>;
  notifications(): Promise<NotificationsResponse>;
  /** Mark these read, or all of them when ids is omitted (local app state). */
  /** unread is null when the count couldn't be read (a job held the store); the mark was saved. */
  markNotificationsRead(ids?: string[]): Promise<{ unread: number | null }>;
  leagueTeam(teamId: number): Promise<LeagueTeamProfile>;
  opponentRoster(): Promise<OpponentRoster>;
  saveOpponentRoster(body: OpponentRosterRequest): Promise<OpponentRoster>;
  /** NBA players whose name contains `q` (the NBA list, not Yahoo's). */
  playerSearch(q: string): Promise<PlayerSearchResponse>;
  nbaTeam(abbr: string): Promise<NbaTeamProfile>;
}

export function createSeasonApi(base = '/api', fetchImpl?: FetchLike): SeasonApi {
  const get = <T,>(path: string, q: Record<string, string | number | undefined> = {}) => seasonGet<T>(base, `${path}${query(q)}`, fetchImpl);
  return {
    week: () => get('/season/week'),
    weekProbability: () => get('/season/week/probability'),
    gameCenter: () => get('/season/week/gamecenter'),
    scenario: (body) => seasonPost<ScenarioResponse>(base, '/season/scenario', body, fetchImpl),
    moves: () => get('/season/moves'),
    lineup: () => get('/season/lineup'),
    feed: (p = {}) => get('/season/feed', p),
    player: (id) => get(`/season/players/${id}`),
    compare: (a, b, decision, date) => get('/season/compare', { a, b, decision, date }),
    waivers: (p = {}) => get('/season/waivers', p),
    results: () => get('/season/results'),
    calendar: (id, from, to) => get(`/season/players/${id}/calendar`, { from, to }),
    teamWeeks: () => get('/schedule/team_weeks'),
    teamDays: (team, start, end) => get('/schedule/team_days', { team, start, end }),
    notifications: () => get('/season/notifications'),
    markNotificationsRead: (ids) =>
      seasonPost<{ unread: number | null }>(base, '/season/notifications/read', { ids: ids ?? [] }, fetchImpl),
    leagueTeam: (id) => get(`/season/league_teams/${id}`),
    opponentRoster: () => get('/season/opponent_roster'),
    saveOpponentRoster: (body) => seasonPost<OpponentRoster>(base, '/season/opponent_roster', body, fetchImpl),
    playerSearch: (q) => get('/season/player_search', { q }),
    nbaTeam: (abbr) => get(`/season/nba_teams/${abbr}`),
  };
}
