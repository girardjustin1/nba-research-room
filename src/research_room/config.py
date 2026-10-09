"""Typed settings: `config/settings.yaml` plus secrets from `.env`.

Inputs: config/settings.yaml, config/aliases.yaml, .env (via pydantic-settings).
Outputs: a validated `Settings` object and a `Secrets` object.
Tables: none.

Secrets are only ever read from `.env` (or the process environment). Nothing here sets a
global environment variable, and `Secrets.__repr__` never shows values.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"


class Category(BaseModel):
    key: str
    label: str
    kind: Literal["pct", "count"]
    higher_is_better: bool = True
    made: str | None = None
    attempts: str | None = None
    yahoo_stat_id: int | None = None      # Yahoo Fantasy API stat id (matchup totals)

    @model_validator(mode="after")
    def _pct_needs_components(self) -> Category:
        if self.kind == "pct" and not (self.made and self.attempts):
            raise ValueError(f"percentage category {self.key} needs `made` and `attempts`")
        return self


class League(BaseModel):
    name: str
    platform: str
    league_id: int
    my_team_id: int
    teams: int
    public: bool = False
    format: Literal["h2h_one_win", "h2h_each_category", "roto", "points"]


class Roster(BaseModel):
    slots: list[str]
    active_per_day: int
    bench: int
    il: int
    il_direct_add: bool = True
    lock: str = "daily_at_game_time"

    @model_validator(mode="after")
    def _counts_match_slots(self) -> Roster:
        active = [s for s in self.slots if s not in ("BN", "IL")]
        if len(active) != self.active_per_day:
            raise ValueError(f"{len(active)} active slots listed, active_per_day={self.active_per_day}")
        if self.slots.count("BN") != self.bench or self.slots.count("IL") != self.il:
            raise ValueError("bench/IL counts do not match the slot list")
        return self


class Transactions(BaseModel):
    max_acquisitions_per_week: int
    season_max_acquisitions: int | None = None
    waiver_days: int
    waiver_type: str
    trade_deadline: date


class DateRange(BaseModel):
    start: date
    end: date


class Season(BaseModel):
    nba_season: int
    first_game_date: date
    playoff_teams: int
    playoff_weeks: list[int]
    playoffs_end: date
    eliminated_teams_lock: bool = True
    week_boundaries_verified: bool = False
    extended_weeks: dict[int, int] = Field(default_factory=dict)
    nba_cup_knockout: DateRange
    all_star_break: DateRange
    light_day_max_games: int = 5


class ProjectionBlend(BaseModel):
    external: float
    last_season: float
    min_last_season_games: int

    @model_validator(mode="after")
    def _weights_sum_to_one(self) -> ProjectionBlend:
        total = self.external + self.last_season
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"draft.projection_blend weights sum to {total}, not 1.0")
        return self


class AdpConfig(BaseModel):
    sd_base_picks: float
    sd_per_round: float
    fallback_sd_multiplier: float


class BoardConfig(BaseModel):
    recommendations: int
    monte_carlo_top: int
    monte_carlo_draws: int
    need_shift_picks: float
    punt_drift_after_round: int
    punt_drift_p: float
    edge_p: float


class DraftConfirmed(BaseModel):
    """League facts I have checked in Yahoo; unconfirmed ones are flagged by make doctor."""
    rounds: bool = False
    keepers: bool = False
    listener: bool = False      # the Tampermonkey listener read a Yahoo mock draft correctly


class Readiness(BaseModel):
    yahoo_eligibility_min_share: float   # of the top pool_size players by value
    board_refresh_budget_ms: float
    api_url: str


class Draft(BaseModel):
    type: str
    starts_at: datetime
    pick_clock_seconds: int
    my_slot: int | None = None
    # Yahoo team ids in draft-slot order (slot 1 first), once Yahoo posts the order. Names each
    # board column from teams.csv and, when my_slot is empty, sets it from my team's position.
    order: list[int] = Field(default_factory=list)
    keepers: list[dict] = Field(default_factory=list)
    rounds: int
    pool_size: int
    tiers: int
    position_eligibility: dict[str, list[str]]
    projection_blend: ProjectionBlend
    sd_prior_games: float
    adp: AdpConfig
    board: BoardConfig
    confirmed: DraftConfirmed = Field(default_factory=DraftConfirmed)
    readiness: Readiness


class Paths(BaseModel):
    db: Path
    parquet_dir: Path
    inbox_dir: Path

    def resolved(self, root: Path = REPO_ROOT) -> Paths:
        """Return a copy with every relative path anchored at the repo root."""
        fix = lambda p: p if p.is_absolute() else root / p  # noqa: E731
        return Paths(db=fix(self.db), parquet_dir=fix(self.parquet_dir), inbox_dir=fix(self.inbox_dir))


class BdlConfig(BaseModel):
    base_url: str
    requests_per_minute: int
    per_page: int = 100
    backfill_seasons: list[int]
    timeout_seconds: float = 30
    max_retries: int = 5


class FeaturesConfig(BaseModel):
    ewma_halflife_minutes: float
    ewma_halflife_rates: float
    ewma_min_periods: int
    rolling_windows: list[int]
    rotation_minutes: float


class UnlistedConfig(BaseModel):
    """P(plays) for a rotation player missing from a filed NBA injury report, by recent play rate."""
    play_rate_bins: list[float] = Field(default_factory=list)   # upper edges; len(probs) - 1
    probs: list[float] = Field(default_factory=list)

    @model_validator(mode="after")
    def _shape(self) -> UnlistedConfig:
        if self.probs and len(self.probs) != len(self.play_rate_bins) + 1:
            raise ValueError("overrides.unlisted: probs needs one more entry than play_rate_bins")
        if self.play_rate_bins != sorted(self.play_rate_bins):
            raise ValueError("overrides.unlisted: play_rate_bins must be increasing")
        return self


class OverridesConfig(BaseModel):
    status_play_prob: dict[str, float]
    no_return_date_days: dict[str, int]
    authority: list[str]
    unlisted: UnlistedConfig = Field(default_factory=UnlistedConfig)
    max_carry_days: int = 60          # a stated absence is carried at most this many days


class AlertsConfig(BaseModel):
    lookback_days: int = 14            # notifications shown in the inbox
    waiver_min_gain: float = 0.02      # an add/drop alert needs at least this P(win week) gain
    lock_window_hours: float = 3.0     # lineup-lock reminders only this close to the first lock


class ScorecardConfig(BaseModel):
    """In-season checks of the live scoreboard (scorecard.py). Each pair is (watch, act)."""
    min_player_games: int = 2000
    reference_mae: dict[str, float] = Field(default_factory=dict)
    reference_coverage: dict[str, float] = Field(default_factory=dict)
    mae_ratio: tuple[float, float] = (1.05, 1.10)
    bias_share: tuple[float, float] = (0.10, 0.20)
    coverage_gap: tuple[float, float] = (0.04, 0.07)
    p_play_bias: tuple[float, float] = (0.03, 0.05)
    min_listed: int = 30
    status_gap: tuple[float, float] = (0.10, 0.15)
    min_weeks: int = 15
    weekly_brier: tuple[float, float] = (0.22, 0.25)


class XForwardTestConfig(BaseModel):
    """The X forward test (backtest_news.x_forward_test); the rule is in DECISIONS.md."""
    min_weeks: int = 3                # replayed game days must span at least this many weeks
    min_statuses: int = 150           # and hold at least this many X statuses tied to a game
    draws: int = 2000                 # resamples of whole game days for each range
    level: float = 0.95               # the range the rule reads
    seed: int = 0


class PropsTestConfig(BaseModel):
    """The props test (jobs/props_test.py); the rule is in DECISIONS.md (2026-10-09)."""
    season: int = 2025                    # BallDontLie season tested
    train_seasons: list[int] = Field(default_factory=lambda: [2023, 2024])
    judged: list[str] = Field(default_factory=lambda: ["fg3m", "stl", "blk"])
    reference: list[str] = Field(default_factory=lambda: ["pts", "reb", "ast"])
    seed: int = 20261009
    first_games: int = 60
    step_games: int = 20
    max_games: int = 200
    min_rungs: int = 150
    draws: int = 2000
    level: float = 0.80
    prob_clip: tuple[float, float] = (0.01, 0.99)
    requests_per_second: float = 3


class NbaReportConfig(BaseModel):
    base_url: str = "https://ak-static.cms.nba.com/referee/injury/"
    lookback_minutes: int = 180
    step_minutes: int = 15
    requests_per_second: float = 2.0


class ShrinkageConfig(BaseModel):
    enabled: bool = False
    k_grid_minutes: list[float] = Field(default_factory=lambda: [0.0])


class TeammatesConfig(BaseModel):
    enabled: bool = False
    rotation_minutes: float = 12.0
    clip_minutes: float = 60.0
    clip_share: float = 0.6


class BaselineConfig(BaseModel):
    preseason_prior_games: float
    min_play_prob: float
    minutes_recalibration: bool = False
    shrinkage: ShrinkageConfig = Field(default_factory=ShrinkageConfig)
    teammates: TeammatesConfig = Field(default_factory=TeammatesConfig)


class LgbmConfig(BaseModel):
    n_estimators: int
    learning_rate: float
    num_leaves: int
    min_child_samples: int
    subsample: float
    colsample_bytree: float
    min_rate_minutes: float


class RidgeConfig(BaseModel):
    alpha: float = 10.0


class CatBoostConfig(BaseModel):
    iterations: int = 400
    depth: int = 6
    learning_rate: float = 0.05
    l2_leaf_reg: float = 5.0


class HierConfig(BaseModel):
    k_grid_minutes: list[float] = Field(default_factory=lambda: [0.0, 60, 120, 250, 500, 1000, 2000])


class EnsembleConfig(BaseModel):
    members: list[str] = Field(default_factory=lambda: ["baseline", "lgbm", "ridge", "catboost", "hier"])
    min_weight: float = 0.05          # every member keeps at least this weight per stat (build prompt)


class ModelsConfig(BaseModel):
    driver: Literal["baseline", "lgbm"] = "baseline"
    shadow: list[Literal["ensemble"]] = Field(default_factory=list)
    lgbm: LgbmConfig
    ridge: RidgeConfig = Field(default_factory=RidgeConfig)
    catboost: CatBoostConfig = Field(default_factory=CatBoostConfig)
    hier: HierConfig = Field(default_factory=HierConfig)
    ensemble: EnsembleConfig = Field(default_factory=EnsembleConfig)


class BacktestConfig(BaseModel):
    teams: int
    roster_size: int
    max_weeks: int
    matchups_per_week: int
    react_to_absences: bool = True
    seed: int
    plan_hour_et: float = 12.0        # the week's plan is made the day before, at this hour (Eastern)
    decision_hour_et: float = 17.5    # the news replay decides each day at this hour (after the 5 PM report)


class OptimizerConfig(BaseModel):
    candidate_pool: int
    add_takes_effect_days: int
    min_gain_per_acquisition: float
    relinearize_iterations: int
    solver_time_limit_s: float
    saved_plan_hours: float = 2


class OpponentConfig(BaseModel):
    """The opponent's in-week pickups (streaming.py); every number in settings.yaml."""
    streaming: bool                   # off: his roster is fixed for the week
    adds_per_week: int                # adds a typical opponent makes in a week
    adds_per_day: int                 # at most this many swaps on one day


class SimulationConfig(BaseModel):
    calibration_teams: int
    team_size: int
    team_pool: int
    multiplier_bounds: tuple[float, float]
    min_players_per_week: int
    week_draws: int
    path_draws: int
    seed: int
    game_final_hours: float = 3.0     # tip to final: a day counts as played this long after its last tip


class SystemConfig(BaseModel):
    freshness_hours: dict[str, float]
    failed_job_lookback_days: int


class YahooConfig(BaseModel):
    """Live Yahoo reads (ingest/yahoo_live.py): how long a read may take before the app falls back
    to the CSV inbox / manual entries and the last saved plan, and how long it then waits before
    trying Yahoo again."""
    page_time_limit_s: float = Field(gt=0)
    job_time_limit_s: float = Field(gt=0)
    parallel_reads: int = Field(ge=1)
    pause_after_failure_s: float = Field(ge=0)


class KalshiConfig(BaseModel):
    base_url: str
    prop_series: dict[str, str]
    game_series: str
    min_volume: float
    max_spread: float
    requests_per_second: float


class RundownConfig(BaseModel):
    base_url: str
    sport_id: int
    prop_markets: dict[int, str]
    game_markets: dict[int, str]
    days_ahead: int
    pregame_days_ahead: int = 0
    requests_per_second: float


class OverlayConfig(BaseModel):
    enabled: bool = False
    stats: list[str] = Field(default_factory=list)
    sd_bounds: tuple[float, float] = (0.5, 2.0)
    max_age_hours: float = 30


class MarketsConfig(BaseModel):
    pregame_every_minutes: float = 60
    pregame_final_minutes: float = 45
    kalshi: KalshiConfig
    rundown: RundownConfig
    overlay: OverlayConfig = Field(default_factory=OverlayConfig)


class XFeedConfig(BaseModel):
    daily_read_budget: int
    base_url: str = "https://api.x.com/2"
    max_query_chars: int = 512
    poll_minutes: int = 15
    window_hours_before_tip: float = 3
    catchup_hours: float = 20
    overlap_minutes: float = 2
    max_pages_per_query: int = 5
    llm_model: str = "claude-haiku-4-5-20251001"
    max_posts_per_llm_call: int = 10
    llm_max_tokens: int = 4000
    min_confidence: float = 0.5


class Settings(BaseModel):
    league: League
    categories: list[Category]
    roster: Roster
    transactions: Transactions
    season: Season
    draft: Draft
    features: FeaturesConfig
    overrides: OverridesConfig
    baseline: BaselineConfig
    paths: Paths
    bdl: BdlConfig
    markets: MarketsConfig
    x_feed: XFeedConfig
    nba_report: NbaReportConfig = Field(default_factory=NbaReportConfig)
    alerts: AlertsConfig = Field(default_factory=AlertsConfig)
    scorecard: ScorecardConfig = Field(default_factory=ScorecardConfig)
    x_forward_test: XForwardTestConfig = Field(default_factory=XForwardTestConfig)
    props_test: PropsTestConfig = Field(default_factory=PropsTestConfig)
    models: ModelsConfig
    optimizer: OptimizerConfig
    opponent: OpponentConfig
    backtest: BacktestConfig
    simulation: SimulationConfig
    system: SystemConfig
    yahoo: YahooConfig

    @model_validator(mode="after")
    def _anchor_paths(self) -> Settings:
        self.paths = self.paths.resolved()
        override = os.environ.get("RESEARCH_ROOM_DB")      # tests and scratch runs only
        if override:
            self.paths.db = Path(override)
        return self

    @model_validator(mode="after")
    def _draft_order_covers_every_team(self) -> Settings:
        order, n = self.draft.order, self.league.teams
        if order and sorted(order) != list(range(1, n + 1)):
            raise ValueError(f"draft.order must list each Yahoo team id 1..{n} exactly once, got {order}")
        if self.draft.my_slot is not None and not 1 <= self.draft.my_slot <= n:
            raise ValueError(f"draft.my_slot must be 1..{n}, got {self.draft.my_slot}")
        me, slot = self.league.my_team_id, self.draft.my_slot
        if slot is not None and order and order[slot - 1] != me:
            raise ValueError(f"draft.my_slot {slot} disagrees with draft.order "
                             f"(team {me} is slot {order.index(me) + 1})")
        return self


class Secrets(BaseSettings):
    """API keys from `.env`. Fields are SecretStr so they never print by accident."""

    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    bdl_api_key: SecretStr = SecretStr("")
    rundown_api_key: SecretStr = SecretStr("")
    x_bearer_token: SecretStr = SecretStr("")
    llm_api_key: SecretStr = SecretStr("")
    yahoo_league_id: int | None = None
    yahoo_team_id: int | None = None

    def require(self, name: str) -> str:
        """Return a secret's value or raise a readable error naming the missing key."""
        value: SecretStr = getattr(self, name)
        if not value.get_secret_value():
            raise RuntimeError(f"{name.upper()} is empty in .env")
        return value.get_secret_value()


def load_settings(path: Path | None = None) -> Settings:
    """Load and validate settings.yaml (default: config/settings.yaml)."""
    raw = yaml.safe_load((path or CONFIG_DIR / "settings.yaml").read_text())
    return Settings.model_validate(raw)


@lru_cache(maxsize=1)
def settings() -> Settings:
    """Process-wide cached settings."""
    return load_settings()


def load_secrets() -> Secrets:
    return Secrets()


def load_aliases(path: Path | None = None) -> list[dict]:
    """Load the alias list from aliases.yaml; an empty file means no aliases."""
    raw = yaml.safe_load((path or CONFIG_DIR / "aliases.yaml").read_text()) or {}
    return list(raw.get("aliases") or [])
