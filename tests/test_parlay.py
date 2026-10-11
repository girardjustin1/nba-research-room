"""ParlayAPI closing lines (ingest/parlay.py) and the props test's books pass: invented data, no network."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta

import pandas as pd
import pytest
from jobs import props_test as job

from research_room import store
from research_room.config import ParlayConfig, settings
from research_room.ingest import parlay
from research_room.ingest.market_common import GameIndex

META = {"source": "test", "fetched_at": pd.Timestamp("2026-10-11T12:00:00Z")}
TIP = pd.Timestamp("2026-11-05T00:30:00Z")          # Nov 4, 7:30 pm ET


def cfg() -> ParlayConfig:
    return settings().markets.parlay


@pytest.fixture
def seeded(con):
    store.upsert(con, "teams", pd.DataFrame([
        {"team_id": 1, "abbreviation": "NYK", "full_name": "New York Knicks", "name": "Knicks",
         "conference": "East", **META},
        {"team_id": 2, "abbreviation": "SAS", "full_name": "San Antonio Spurs", "name": "Spurs",
         "conference": "West", **META},
    ]))
    store.upsert(con, "games", pd.DataFrame([{
        "game_id": 77, "season": 2026, "game_date": date(2026, 11, 4), "home_team_id": 2,
        "visitor_team_id": 1, "postseason": False, "tip_utc": TIP, **META,
    }]))
    store.upsert(con, "players", pd.DataFrame([
        {"player_id": 501, "full_name": "Invented Guard", "team_id": 1, **META},
        {"player_id": 502, "full_name": "Made Up Center", "team_id": 2, **META},
    ]))
    return con


def row(**kw) -> dict:
    base = {"game_date": "2026-11-04", "sport_key": "basketball_nba", "commence_time": "",
            "home_team": "SAS Spurs", "away_team": "NYK Knicks", "source": "draftkings",
            "player_name": "Invented Guard",
            "market_key": "player_steals", "market_label": "Steals", "line": 1.5, "over_price": 120,
            "under_price": -150, "snapshot_time": (TIP - pd.Timedelta(hours=1)).isoformat()}
    return base | kw


# ------------------------------------------------------------------ parsing
def test_parse_keeps_two_way_book_prices_for_tracked_stats_only():
    body = {"rows": [
        row(),
        row(source="underdog"),                                  # DFS app
        row(source="pinnacle_open"),                             # an opening line
        row(under_price=None),                                   # one side only
        row(market_key="player_winning_margin"),                 # not a stat we track
        row(player_name="{optionTypeAbbr}{value} Stl"),          # template text
        row(player_name="New York Knicks @ San Antonio Spurs"),  # a game title
        row(market_key="player_turnovers", source="FanDuel"),
    ]}
    out = parlay.parse_closing(body, cfg())
    assert list(out["source"]) == ["draftkings", "fanduel"]
    assert list(out["stat"]) == ["stl", "tov"]
    assert out["game_date"].iloc[0] == date(2026, 11, 4)
    assert pd.isna(out["commence_time"].iloc[0])                 # "" is missing, not a time
    assert parlay.parse_closing({"rows": []}, cfg()).empty
    assert parlay.parse_closing({}, cfg()).empty


def test_team_code_by_full_name_or_nickname(seeded):
    codes = parlay.team_codes(seeded)
    assert parlay.team_code("New York Knicks", codes) == "NYK"
    assert parlay.team_code("NYK Knicks", codes) == "NYK"
    assert parlay.team_code("Spurs", codes) == "SAS"
    assert parlay.team_code("Boston Celtics", codes) is None
    assert parlay.team_code("", codes) is None


# ------------------------------------------------------------------ rungs
def rungs_of(con, rows: list[dict], hours: float = 12) -> pd.DataFrame:
    parsed = parlay.parse_closing({"rows": rows}, cfg())
    return parlay.rungs(parsed, GameIndex(con), parlay.team_codes(con), {77: TIP}, hours)


def test_rungs_devig_each_book_then_average_the_books(seeded):
    r = rungs_of(seeded, [row(), row(source="fanduel", over_price=100, under_price=-120)])
    assert len(r) == 1
    dk = (100 / 220) / (100 / 220 + 150 / 250)
    fd = 0.5 / (0.5 + 120 / 220)
    got = r.iloc[0]
    assert (got.game_id, got.stat, got.threshold, got.n_books) == (77, "stl", 1.5, 2)
    assert got.p_market == pytest.approx((dk + fd) / 2)
    assert (got.p_lo, got.p_hi) == (pytest.approx(min(dk, fd)), pytest.approx(max(dk, fd)))


def test_rungs_drop_in_play_and_stale_quotes(seeded):
    late = (TIP + pd.Timedelta(minutes=5)).isoformat()
    old = (TIP - pd.Timedelta(hours=13)).isoformat()
    r = rungs_of(seeded, [row(snapshot_time=late), row(source="fanduel", snapshot_time=old),
                          row(source="bet365", snapshot_time="")])
    assert r.empty
    assert len(rungs_of(seeded, [row(source="fanduel", snapshot_time=old)], hours=14)) == 1


def test_rungs_find_the_game_by_listed_date_the_next_utc_day_or_start_time(seeded):
    assert list(rungs_of(seeded, [row(game_date="2026-11-05")])["game_id"]) == [77]   # filed on the UTC day
    by_start = row(game_date="2026-11-08", commence_time=TIP.isoformat())
    assert list(rungs_of(seeded, [by_start])["game_id"]) == [77]
    assert rungs_of(seeded, [row(game_date="2026-11-07")]).empty                      # no such game


def test_rungs_count_a_quote_listed_in_two_day_files_once(seeded):
    r = rungs_of(seeded, [row(), row(game_date="2026-11-05")])
    assert r.iloc[0].n_books == 1


def test_match_players_resolves_against_either_team(seeded):
    r = rungs_of(seeded, [row(), row(player_name="Made Up Center", market_key="player_blocks"),
                          row(player_name="Nobody Here")])
    m = job.match_players(seeded, r).set_index("player_name")["player_id"]
    assert m["Invented Guard"] == 501 and m["Made Up Center"] == 502
    assert pd.isna(m["Nobody Here"])


# ------------------------------------------------------------------ client and cache
class FakeClient:
    def __init__(self):
        self.calls, self.credits = [], 0

    def closing_day(self, day):
        self.calls.append(day)
        self.credits += 1
        return {"date": day, "rows": [row()]}


def test_archive_caches_finished_days_only(tmp_path):
    fake = FakeClient()
    arch = job.ParlayArchive(fake, tmp_path)
    arch.day("2026-05-10")
    arch.day("2026-05-10")
    assert fake.calls == ["2026-05-10"]                                    # the second read is the cache
    today = datetime.now(UTC).date().isoformat()
    arch.day(today)
    arch.day(today)
    assert fake.calls.count(today) == 2                                    # a day under way is never kept
    assert not (tmp_path / f"{today}.json").exists()
    offline = job.ParlayArchive(None, tmp_path)
    assert offline.day("2026-05-10")["rows"][0]["player_name"] == "Invented Guard"
    with pytest.raises(RuntimeError, match="not cached"):
        offline.day((date.today() - timedelta(days=400)).isoformat())


class Resp:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code, self._body, self.headers = status, body or {}, headers or {}
        self.text = json.dumps(self._body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def test_client_counts_credits_stops_at_the_budget_and_hides_billing_ids(monkeypatch):
    c = parlay.Client(cfg().model_copy(update={"max_credits_per_run": 30}), key="test-key")
    assert c.http.headers == {"X-API-Key": "test-key"}
    check = {"valid": True, "tier": "enterprise", "credits_remaining": 9, "api_key": "x",
             "subscription": {"state": "active", "stripe_customer_id_prefix": "cus_x"}}
    replies = iter([Resp(body=check), Resp(body={"rows": []}, headers={"X-Export-Credits": "29"}),
                    Resp(body={"rows": []}, headers={"X-Export-Credits": "2"})])
    monkeypatch.setattr(c.http, "_send", lambda url, params=None: next(replies))
    want = {"valid": True, "tier": "enterprise", "credits_remaining": 9, "subscription": "active"}
    assert c.key_check() == want
    c.closing_day("2026-11-04")
    c.closing_day("2026-11-05")
    assert c.credits == 31
    with pytest.raises(parlay.OverBudget):
        c.closing_day("2026-11-06")


def test_client_explains_a_refusal(monkeypatch):
    c = parlay.Client(cfg(), key="test-key")
    monkeypatch.setattr(c.http, "_send", lambda url, params=None: Resp(403, {"detail": "HISTORICAL_LIMIT"}))
    with pytest.raises(PermissionError, match="HISTORICAL_LIMIT"):
        c.closing_day("2020-01-01")


def test_client_needs_the_key(monkeypatch):
    monkeypatch.setattr(parlay.Secrets, "require", lambda self, name: (_ for _ in ()).throw(
        RuntimeError("PARLAY_API_KEY is empty in .env")))
    with pytest.raises(RuntimeError, match="PARLAY_API_KEY"):
        parlay.Client(cfg())


# ------------------------------------------------------------------ the books pass
def test_book_rungs_reads_each_listed_day_and_its_next_and_drops_whole_lines(seeded, tmp_path):
    class Days(FakeClient):
        def closing_day(self, day):
            self.calls.append(day)
            rows = [row(), row(line=2.0, market_key="player_blocks")] if day == "2026-11-04" else []
            return {"date": day, "rows": rows}

    fake = Days()
    games = seeded.execute("SELECT game_id, game_date, tip_utc FROM games").df().set_index("game_id")
    r = job.book_rungs(seeded, settings(), job.ParlayArchive(fake, tmp_path), games, lambda m: None)
    assert sorted(fake.calls) == ["2026-11-04", "2026-11-05"]
    assert list(r["stat"]) == ["stl"]                       # 2.0 blocks dropped: a push is neither side
    assert list(r["player_id"]) == [501] and r["result"].isna().all()


def test_books_pass_settings():
    bp = settings().props_test.books
    assert bp.judged == ["fg3m", "stl", "blk", "tov"] and bp.reference == ["pts", "reb", "ast"]
    assert bp.season == 2026 and 2026 not in bp.train_seasons and bp.first_day == date(2026, 10, 20)
    assert settings().markets.parlay.prop_markets["player_steals"] == "stl"


# ------------------------------------------------------------------ live props
NOW = pd.Timestamp("2026-11-04T18:00:00Z")


def live(**kw) -> dict:
    base = {"event_id": "e1", "sport_key": "basketball_nba", "game_date": "2026-11-04",
            "home_team": "San Antonio Spurs", "away_team": "New York Knicks",
            "commence_time": TIP.isoformat(), "bookmaker": "draftkings", "market_key": "player_points",
            "period": "FULL", "line": 20.5, "over_price": -110, "under_price": -110,
            "is_dfs_flat_payout": False, "last_update": "2026-11-04T17:55:00Z", "player": "Invented Guard"}
    return base | kw


class LiveClient:
    def __init__(self, rows):
        self.rows, self.credits = rows, 3

    def live_props(self):
        return self.rows


def test_parse_live_keeps_book_quotes_for_upcoming_games_only(seeded):
    codes = parlay.team_codes(seeded)
    rows = [live(), live(bookmaker="prizepicks", is_dfs_flat_payout=True), live(bookmaker="underdog"),
            live(period="1Q"), live(line=20.0), live(under_price=None), live(player="Knicks @ Spurs"),
            live(commence_time=(NOW - pd.Timedelta(minutes=1)).isoformat()), live(home_team="Boston Celtics"),
            live(bookmaker="FanDuel", market_key="player_blocks", line=0.5)]
    q = parlay.parse_live(rows, cfg(), codes, NOW)
    assert list(q["book"]) == ["draftkings", "fanduel"] and list(q["stat"]) == ["pts", "blk"]
    assert q["day"].iloc[0] == date(2026, 11, 4)              # the league date of a 7:30 pm ET tip
    assert parlay.parse_live([], cfg(), codes, NOW).empty


def test_sync_archives_both_sides_de_vigged(seeded):
    rows = [live(), live(bookmaker="fanduel", over_price=-130, under_price=110), live(player="Nobody Here")]
    counts = parlay.sync(seeded, settings(), LiveClient(rows), now=NOW)
    assert counts == {"prop_lines": 4, "unmatched_props": 1}
    got = seeded.execute("""SELECT vendor, side, prob, price FROM props_ladder WHERE source = 'parlay'
                            ORDER BY vendor, side""").df()
    assert list(got["vendor"]) == ["parlay:draftkings"] * 2 + ["parlay:fanduel"] * 2
    assert got["prob"].iloc[0] == pytest.approx(0.5) and got["prob"].iloc[1] == pytest.approx(0.5)
    fd_over = (130 / 230) / (130 / 230 + 100 / 210)
    assert got.set_index(["vendor", "side"]).loc[("parlay:fanduel", "over"), "prob"] == pytest.approx(fd_over)
    assert parlay.sync(seeded, settings(), LiveClient([]), now=NOW) == {"prop_lines": 0, "unmatched_props": 0}


def test_live_props_pages_until_a_short_page(monkeypatch):
    c = parlay.Client(cfg(), key="test-key")
    pages = iter([[{"i": i} for i in range(parlay.LIVE_PAGE)], [{"i": "last"}]])
    seen = []
    monkeypatch.setattr(c, "get", lambda path, params=None: seen.append(params["offset"]) or next(pages))
    assert len(c.live_props()) == parlay.LIVE_PAGE + 1 and seen == [0, parlay.LIVE_PAGE]


def test_market_pulls_include_parlay_only_with_a_key(con, monkeypatch):
    from research_room import pipeline

    called = []
    monkeypatch.setattr(pipeline.kalshi, "sync", lambda *a, **k: {"x": 0})
    monkeypatch.setattr(pipeline.rundown, "sync", lambda *a, **k: {"x": 0})
    monkeypatch.setattr(pipeline.parlay, "sync", lambda *a, **k: called.append(1) or {"prop_lines": 0})
    assert "parlay" not in pipeline.sync_markets(con, settings())         # the conftest blanks the key
    monkeypatch.setenv("PARLAY_API_KEY", "test-key")
    assert "parlay" in pipeline.sync_markets(con, settings()) and called == [1]


# ------------------------------------------------------------------ one quote per book in the overlay
def test_book_key_names_a_book_the_same_through_either_feed():
    from research_room.projections import market

    books = settings().markets.rundown.books
    assert market.book_key("rundown", "rundown:19", books) == "draftkings"
    assert market.book_key("parlay", "parlay:draftkings", books) == "draftkings"
    assert market.book_key("kalshi", "kalshi", books) == "kalshi"
    assert market.book_key("rundown", "rundown:25", books) == "kalshi"
    assert market.book_key("rundown", "rundown:999", books) == "rundown:999"
    assert market.book_key("kalshi", None, books) == "kalshi"


def test_ladder_counts_a_book_once_across_feeds(seeded):
    from research_room.projections import market

    def lad(source, vendor, prob, ts):
        return {"source": source, "game_id": 77, "player_id": 501, "stat": "pts", "threshold": 20.5,
                "side": "over", "prob": prob, "price": -110, "vendor": vendor, "ts": pd.Timestamp(ts),
                "market_ref": "m", "fetched_at": pd.Timestamp(ts)}

    store.upsert(seeded, "props_ladder", pd.DataFrame([
        lad("rundown", "rundown:19", 0.40, "2026-11-04T16:00:00Z"),      # DraftKings, older
        lad("parlay", "parlay:draftkings", 0.60, "2026-11-04T17:00:00Z"),  # DraftKings, newer
        lad("parlay", "parlay:fanduel", 0.70, "2026-11-04T17:00:00Z"),
    ]))
    rows = market.ladder_rows(seeded, [77], ["pts"], NOW, 30)
    assert sorted(zip(rows["book"], rows["prob"], strict=True)) == [("draftkings", 0.60), ("fanduel", 0.70)]
    assert market.ladder_points(seeded, [77], ["pts"], NOW, 30)["p_over"].iloc[0] == pytest.approx(0.65)
