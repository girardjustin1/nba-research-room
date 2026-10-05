"""Teammates out: a player's minutes and production when rotation teammates sit.

Inputs: projection rows for every player of each team-game (game_id, team_id, min_played_ewma,
<stat>_pm_ewma) and, per row, the chance each one sits; settings.baseline.teammates.
Outputs: per-row missing-teammate features, the fitted adjustment, and adjusted minutes and
per-minute rates. Tables: none (pure).

What it measures, per player-game:
- Missing minutes: the sum over rotation teammates (EWMA minutes >= rotation_minutes) of their
  usual minutes x P(they sit). In history P(sit) is what happened (1 for a DNP); live it is
  1 - P(plays) after the overrides (injury report, X, manual), so news drives it.
- Missing production, per stat: the same sum of their usual production, as a share of the
  rotation's.
- What the player is used to: an EWMA of both over his own previous games (the minutes and rate
  half-lives). His moving averages already reflect a long absence, so only the change from his
  recent games is new information: d = now - what he's used to. A returning teammate gives a
  negative d.
The adjustment, fitted on history (who actually sat):
- Minutes when playing += d_min x (c0 + c1 m + c2 m^2 / 48), m = his EWMA minutes (bench players
  absorb more, starters are near their ceiling).
- Per-minute rate x (1 + b_s x d_share_s), per stat.
Tested in DECISIONS.md (teammates out): on 2025-26 with who sat known, minutes error -7%, points
-2.4%; with no news it is neutral, so it never needs to be switched off for missing news.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from research_room.config import Settings, settings

STATS = ("pts", "reb", "ast", "stl", "blk", "fg3m", "tov", "fgm", "fga", "ftm", "fta")
PRIOR_COLUMNS = ["tmo_prior_min", *[f"tmo_prior_sh_{s}" for s in STATS]]


def team_out(df: pd.DataFrame, p_sit: np.ndarray | pd.Series, rotation_minutes: float) -> pd.DataFrame:
    """Per row: teammates' missing minutes (`out_min`) and missing share of each stat
    (`sh_<stat>`), excluding the player himself. `p_sit` is each row's chance of sitting."""
    m = pd.to_numeric(df["min_played_ewma"], errors="coerce").fillna(0.0).to_numpy(float)
    rot = (m >= rotation_minutes).astype(float)
    w = np.clip(np.nan_to_num(np.asarray(p_sit, dtype=float), nan=0.0), 0.0, 1.0) * rot
    keys = [df["game_id"].to_numpy(), df["team_id"].to_numpy()]
    out = pd.DataFrame(index=df.index)

    def team_sum(x: np.ndarray) -> np.ndarray:
        return pd.Series(x, index=df.index).groupby(keys).transform("sum").to_numpy()

    mine = m * w
    out["out_min"] = team_sum(mine) - mine
    for s in STATS:
        e = np.nan_to_num(pd.to_numeric(df[f"{s}_pm_ewma"], errors="coerce").to_numpy(float)) * m
        gone = e * w
        total = team_sum(e * rot)
        out[f"sh_{s}"] = np.where(total > 0, (team_sum(gone) - gone) / np.where(total > 0, total, 1.0), 0.0)
    return out


def prior_states(df: pd.DataFrame, played: pd.Series, cfg: Settings) -> pd.DataFrame:
    """What each player is used to before each game: EWMAs over his previous played games of the
    teammates actually missing (history). `df` sorted by player and tip, with the feature table's
    pre-game EWMAs. Columns PRIOR_COLUMNS."""
    f = cfg.features
    now = team_out(df, (~played).astype(float), cfg.baseline.teammates.rotation_minutes)
    pid = df["player_id"]

    def prior(x: pd.Series, hl: float) -> pd.Series:
        after = x.where(played).groupby(pid).transform(
            lambda s: s.dropna().ewm(halflife=hl).mean().reindex(s.index))
        return after.groupby(pid).transform(lambda s: s.ffill().shift(1))

    cols = {"tmo_prior_min": prior(now["out_min"], f.ewma_halflife_minutes)}
    for s in STATS:
        cols[f"tmo_prior_sh_{s}"] = prior(now[f"sh_{s}"], f.ewma_halflife_rates)
    return pd.DataFrame(cols, index=df.index)


class TeammatesAdjust:
    """The fitted adjustment: minutes coefficients (c0, c1, c2) and a rate slope per stat."""

    def __init__(self, cfg: Settings | None = None) -> None:
        self.cfg = cfg or settings()
        self.coef: np.ndarray | None = None
        self.b: dict[str, float] = {}

    def _x(self, d_min: np.ndarray, m: np.ndarray) -> np.ndarray:
        d = np.clip(np.nan_to_num(d_min), -self.cfg.baseline.teammates.clip_minutes,
                    self.cfg.baseline.teammates.clip_minutes)
        return np.column_stack([d, d * m, d * m ** 2 / 48.0])

    def _dsh(self, d: np.ndarray) -> np.ndarray:
        c = self.cfg.baseline.teammates.clip_share
        return np.clip(np.nan_to_num(d), -c, c)

    def deltas(self, df: pd.DataFrame, p_sit) -> pd.DataFrame:
        now = team_out(df, p_sit, self.cfg.baseline.teammates.rotation_minutes)
        out = pd.DataFrame({"d_min": now["out_min"] - df["tmo_prior_min"]}, index=df.index)
        for s in STATS:
            out[f"dsh_{s}"] = now[f"sh_{s}"] - df[f"tmo_prior_sh_{s}"]
        return out

    def fit(self, train: pd.DataFrame) -> TeammatesAdjust:
        """Fit on the feature table: who actually sat (DNPs), played games with EWMAs."""
        d = self.deltas(train, (~train["y_did_play"].astype(bool)).astype(float))
        ok = train["y_did_play"].astype(bool) & train["min_played_ewma"].notna() & d["d_min"].notna()
        t, dd = train[ok], d[ok]
        m = t["min_played_ewma"].to_numpy(float)
        self.coef, *_ = np.linalg.lstsq(self._x(dd["d_min"].to_numpy(float), m),
                                        t["y_minutes"].to_numpy(float) - m, rcond=None)
        ym = t["y_minutes"].to_numpy(float)
        for s in STATS:
            r = t[f"{s}_pm_ewma"].to_numpy(float)
            good = ~np.isnan(r)
            a = (r * self._dsh(dd[f"dsh_{s}"].to_numpy(float)) * ym)[good]
            resid = (t[f"y_{s}"].to_numpy(float) - r * ym)[good]
            self.b[s] = float(a @ resid / (a @ a)) if (a @ a) > 0 else 0.0
        return self

    def minutes_delta(self, d_min: np.ndarray, m: np.ndarray) -> np.ndarray:
        return self._x(d_min, m) @ self.coef

    def rate_factor(self, stat: str, dsh: np.ndarray) -> np.ndarray:
        return np.clip(1.0 + self.b.get(stat, 0.0) * self._dsh(dsh), 0.0, None)
