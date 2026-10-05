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


class OverridesConfig(BaseModel):
    status_play_prob: dict[str, float]
    no_return_date_days: dict[str, int]
    authority: list[str]


class ShrinkageConfig(BaseModel):
    enabled: bool = False
    k_grid_minutes: list[float] = Field(default_factory=lambda: [0.0])


class BaselineConfig(BaseModel):
    preseason_prior_games: float
    min_play_prob: float
    minutes_recalibration: bool = False
    shrinkage: ShrinkageConfig = Field(default_factory=ShrinkageConfig)


class BacktestConfig(BaseModel):
    teams: int
    roster_size: int
    max_weeks: int
    matchups_per_week: int
    react_to_absences: bool = True
    seed: int


class OptimizerConfig(BaseModel):
    candidate_pool: int
    add_takes_effect_days: int
    min_gain_per_acquisition: float
    relinearize_iterations: int
    solver_time_limit_s: float


class SimulationConfig(BaseModel):
    calibration_teams: int
    team_size: int
    team_pool: int
    multiplier_bounds: tuple[float, float]
    min_players_per_week: int
    week_draws: int
    path_draws: int
    seed: int


class SystemConfig(BaseModel):
    freshness_hours: dict[str, float]
    failed_job_lookback_days: int


class XFeedConfig(BaseModel):
    daily_read_budget: int


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
    x_feed: XFeedConfig
    optimizer: OptimizerConfig
    backtest: BacktestConfig
    simulation: SimulationConfig
    system: SystemConfig

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
