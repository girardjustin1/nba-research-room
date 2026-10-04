"""Preseason projections for the draft tool: Basketball Monster exports, blended with each
player's own last-season rates.

Inputs: two Basketball Monster exports from the same page (see DECISIONS.md, "Phase D inputs"):
  - Export to CSV: raw season totals with makes and attempts (`field_goals_attempted`, ...);
  - Export to Excel (.xls): the on-screen table with Yahoo ADP, team, position, age, risk.
  Plus game_logs for last season and settings.draft.projection_blend.
Outputs: `external_projections` rows (per game); `blend_preseason()` returns the draft pool
with per-category per-game mean and sd.
Tables: writes external_projections, player_xref, unresolved_names; reads game_logs, games,
players, teams.

The files are paid data. They live in `reference/` (gitignored) and are never committed.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from research_room import quality, store
from research_room.config import REPO_ROOT, Settings, settings
from research_room.ingest.names import resolve_and_record

SOURCE = "bbm"
REFERENCE_DIR = REPO_ROOT / "reference"

# BBM raw CSV column -> ours (season totals; divided by games below).
_RAW = {
    "minutes": "minutes", "field_goals": "fgm", "field_goals_attempted": "fga",
    "free_throws": "ftm", "free_throws_attempted": "fta", "threes": "fg3m",
    "threes_attempted": "fg3a", "offensive_rebounds": "oreb", "defensive_rebounds": "dreb",
    "assists": "ast", "steals": "stl", "blocks": "blk", "turnovers": "tov",
}
_TABLE = {"ID": "ext_id", "NBA ID": "nba_id", "Name": "name", "Team": "team_abbr",
          "Pos": "position", "Age": "age", "Y!Adp": "yahoo_adp", "Adv ADP": "adv_adp",
          "Rank": "ext_rank", "Inj Risk": "injury_risk", "Role": "role"}
_OPTIONAL = {"NBA ID"}              # used for headshots only; older exports may lack it
_TEAM_NONE = {"FA", ""}

# The nine league categories in per-game terms, plus the components percentages need.
STATS = ("fgm", "fga", "ftm", "fta", "fg3m", "pts", "reb", "ast", "stl", "blk", "tov")


class ProjectionFileError(ValueError):
    """An export is missing, the wrong one of the two, or missing columns we need."""


def _is_raw_csv(path: Path) -> bool:
    head = path.read_text(errors="ignore").splitlines()[:1]
    return bool(head) and "field_goals_attempted" in head[0]


def find_latest(reference_dir: Path = REFERENCE_DIR) -> tuple[Path, Path]:
    """Newest raw-totals CSV and newest table .xls under `reference_dir` (any subfolder)."""
    by_mtime = lambda p: p.stat().st_mtime  # noqa: E731
    csvs = sorted((p for p in reference_dir.rglob("*.csv") if _is_raw_csv(p)), key=by_mtime)
    xlss = sorted(reference_dir.rglob("*.xls"), key=by_mtime)
    if not csvs:
        raise ProjectionFileError(f"no Basketball Monster 'Export to CSV' file under {reference_dir}")
    if not xlss:
        raise ProjectionFileError(f"no Basketball Monster 'Export to Excel' (.xls) file under "
                                  f"{reference_dir}")
    return csvs[-1], xlss[-1]


def read_bbm(csv_path: Path, xls_path: Path) -> pd.DataFrame:
    """Read both exports and combine them (see `combine`)."""
    raw = pd.read_csv(csv_path)
    table = pd.read_excel(xls_path, header=0)
    return combine(raw, table, csv_name=csv_path.name, xls_name=xls_path.name)


def combine(raw: pd.DataFrame, table: pd.DataFrame, csv_name: str = "csv",
            xls_name: str = "xls") -> pd.DataFrame:
    """Join the two exports on BBM's player ID and convert season totals to per-game rates."""
    missing = sorted((set(_RAW) | {"player_id", "games", "first_name", "last_name"}) - set(raw.columns))
    if missing:
        raise ProjectionFileError(f"{csv_name}: missing columns {missing}; use 'Export to CSV'")
    missing = sorted(set(_TABLE) - _OPTIONAL - set(table.columns))
    if missing:
        raise ProjectionFileError(f"{xls_name}: missing columns {missing}; use 'Export to Excel' "
                                  "with Yahoo! ADP checked")
    table = table.reindex(columns=list(_TABLE)).rename(columns=_TABLE)
    df = raw.rename(columns={"player_id": "ext_id"}).merge(table, on="ext_id", how="left",
                                                          validate="one_to_one")
    unjoined = int(df["name"].isna().sum())
    if unjoined:
        raise ProjectionFileError(f"{unjoined} players in the CSV are not in the .xls; export both "
                                  "from the same page at the same time")
    games = df["games"].astype(float)
    team = df["team_abbr"].astype(str)
    out = pd.DataFrame({
        "ext_id": df["ext_id"].astype(str),
        "name": (df["first_name"].fillna("") + " " + df["last_name"].fillna("")).str.strip(),
        "team_abbr": team.where(~team.isin(_TEAM_NONE) & df["team_abbr"].notna()),
        "position": df["position"], "age": pd.to_numeric(df["age"], errors="coerce"),
        "games": games, "nba_id": pd.to_numeric(df["nba_id"], errors="coerce").astype("Int64"),
    })
    per_game = games.where(games > 0)
    for theirs, ours in _RAW.items():
        out[ours] = df[theirs].astype(float) / per_game
    out["reb"] = out["oreb"] + out["dreb"]
    out["pts"] = 2 * (out["fgm"] - out["fg3m"]) + 3 * out["fg3m"] + out["ftm"]
    yahoo = pd.to_numeric(df["yahoo_adp"], errors="coerce")
    out["yahoo_adp"] = yahoo.where(yahoo > 0)                       # 0 means "no Yahoo ADP"
    out["adv_adp"] = pd.to_numeric(df["adv_adp"], errors="coerce")
    out["ext_rank"] = pd.to_numeric(df["ext_rank"], errors="coerce")
    out["injury_risk"], out["role"] = df["injury_risk"], df["role"]
    return out


def ingest_bbm(con: duckdb.DuckDBPyConnection, csv_path: Path | None = None,
               xls_path: Path | None = None, snapshot: date | None = None) -> dict[str, int]:
    """Load a BBM snapshot, resolve names to BDL ids, write `external_projections`."""
    if csv_path is None or xls_path is None:
        csv_path, xls_path = find_latest()
    df = read_bbm(csv_path, xls_path)
    snapshot = snapshot or datetime.fromtimestamp(xls_path.stat().st_mtime).date()
    with store.ingest_run(con, SOURCE, "ingest_projections") as run:
        rows = pd.DataFrame({"source_key": df["ext_id"], "raw_name": df["name"],
                             "team_abbr": df["team_abbr"]})
        df["player_id"] = resolve_and_record(con, SOURCE, rows)
        df["source"], df["snapshot"], df["fetched_at"] = SOURCE, snapshot, store.utcnow()
        n = store.upsert(con, "external_projections", df)
        playing = df["games"] > 0
        counts = {"rows": n, "projected_to_play": int(playing.sum()),
                  "matched_playing": int(df.loc[playing, "player_id"].notna().sum())}
        run["rows"], run["detail"] = n, str(counts)
    return counts


def last_season_rates(con: duckdb.DuckDBPyConnection, season: int) -> pd.DataFrame:
    """Per-player regular-season per-game mean and sd for each stat (played games only,
    incomplete box scores excluded)."""
    skip = quality.incomplete_team_games(con)
    aggs = ", ".join(f"avg({s}) AS {s}_mean, stddev_samp({s}) AS {s}_sd" for s in (*STATS, "minutes"))
    con.register("_skip", skip)
    try:
        return con.execute(f"""
            SELECT l.player_id, count(*) AS games_played, {aggs}
            FROM game_logs l JOIN games g USING (game_id)
            ANTI JOIN _skip s ON s.game_id = l.game_id AND s.team_id = l.team_id
            WHERE l.season = ? AND l.did_play AND NOT g.postseason
            GROUP BY l.player_id
        """, [season]).df()
    finally:
        con.unregister("_skip")


def dispersion(rates: pd.DataFrame, min_games: int) -> dict[str, float]:
    """Per stat, phi = median(variance / mean) among regular players: per-game counts are
    over-dispersed, with variance roughly proportional to the mean. On 2025-26 data this
    predicts players' actual sd far better than a constant CV, most of all for stars."""
    regulars = rates[rates["games_played"] >= min_games]
    phi = {}
    for s in STATS:
        mean, sd = regulars[f"{s}_mean"], regulars[f"{s}_sd"]
        ok = mean > 0
        phi[s] = float((sd[ok] ** 2 / mean[ok]).median())
    return phi


def blend_preseason(con: duckdb.DuckDBPyConnection, cfg: Settings | None = None,
                    snapshot: date | None = None) -> pd.DataFrame:
    """Draft pool: per-game mean and sd per stat, games, minutes, ADP, and provenance.

    mean = w_ext * BBM + w_last * last season, when the player played at least
    `min_last_season_games` last season; otherwise BBM alone (and `sources` says so).
    sd   = the player's own per-game sd, shrunk toward sqrt(phi x mean) by `sd_prior_games`.
    """
    cfg = cfg or settings()
    blend = cfg.draft.projection_blend
    latest = "(SELECT max(snapshot) FROM external_projections WHERE source = 'bbm')"
    ext = con.execute(f"SELECT * FROM external_projections WHERE source = 'bbm' AND snapshot = "
                      f"{'?' if snapshot else latest}", [snapshot] if snapshot else []).df()
    if ext.empty:
        raise ProjectionFileError("no projections loaded; run `make projections` first")
    ext = ext[(ext["games"] > 0) & ext["player_id"].notna()].copy()
    rates = last_season_rates(con, cfg.season.nba_season - 1)
    phi = dispersion(rates, blend.min_last_season_games)
    bad = [s for s, v in phi.items() if not np.isfinite(v) or v <= 0]
    if bad:
        raise ProjectionFileError(f"not enough {cfg.season.nba_season - 1} history to estimate the "
                                  f"game-to-game spread of {bad}; run `make backfill`")
    pool = ext.merge(rates, on="player_id", how="left")
    pool["last_season_games"] = pool["games_played"].fillna(0).astype(int)
    use_last = pool["last_season_games"] >= blend.min_last_season_games
    k, n = cfg.draft.sd_prior_games, pool["last_season_games"]
    for s in STATS:
        last = pool[f"{s}_mean"]
        mean = np.where(use_last, blend.external * pool[s] + blend.last_season * last, pool[s])
        pool[f"{s}_mean_pg"] = mean
        prior_var = phi[s] * pool[f"{s}_mean_pg"]
        own_var = pool[f"{s}_sd"].fillna(0) ** 2
        pool[f"{s}_sd_pg"] = np.sqrt((n * own_var + k * prior_var) / (n + k))
    pool["minutes_pg"] = np.where(use_last, blend.external * pool["minutes"]
                                  + blend.last_season * pool["minutes_mean"], pool["minutes"])
    pool["sources"] = np.where(use_last, "bbm+last_season", "bbm_only")
    keep = ["player_id", "nba_id", "name", "team_abbr", "position", "age", "games", "minutes_pg",
            "yahoo_adp", "adv_adp", "ext_rank", "injury_risk", "role", "last_season_games", "sources"]
    keep += [f"{s}_{kind}_pg" for s in STATS for kind in ("mean", "sd")]
    rename = {f"{s}_{kind}_pg": f"{s}_{kind}" for s in STATS for kind in ("mean", "sd")}
    out = pool[keep].rename(columns=rename)
    out["player_id"] = out["player_id"].astype(int)
    return out.reset_index(drop=True)
