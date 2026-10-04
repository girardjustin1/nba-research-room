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


class Draft(BaseModel):
    type: str
    starts_at: datetime
    pick_clock_seconds: int
    my_slot: int | None = None
    keepers: list[dict] = Field(default_factory=list)
    rounds: int
    pool_size: int
    projection_blend: ProjectionBlend
    sd_prior_games: float
    adp: AdpConfig


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


class XFeedConfig(BaseModel):
    daily_read_budget: int


class Settings(BaseModel):
    league: League
    categories: list[Category]
    roster: Roster
    transactions: Transactions
    season: Season
    draft: Draft
    paths: Paths
    bdl: BdlConfig
    x_feed: XFeedConfig

    @model_validator(mode="after")
    def _anchor_paths(self) -> Settings:
        self.paths = self.paths.resolved()
        override = os.environ.get("RESEARCH_ROOM_DB")      # tests and scratch runs only
        if override:
            self.paths.db = Path(override)
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
