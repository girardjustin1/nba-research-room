# nba-research-room

A personal, single-user Python application I am building to analyze my own Fantasy Basketball league.

NBA Research Room is a local Streamlit app for one Yahoo head-to-head league. It runs a live draft
board, projects player stats, recommends daily lineups and weekly pickups, and reports
head-to-head win probability. **It only recommends.** Every move is made by hand in the Yahoo app;
nothing here acts inside Yahoo.

Build plan: [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md). Assumptions and deviations:
[`DECISIONS.md`](DECISIONS.md).

## Status

| Phase | What | State |
|---|---|---|
| 0 | Store, BallDontLie backfill, name resolution, schedule, Yahoo CSV inbox, Data page | built |
| D | Draft helper (before Sun Oct 18, 7:00 pm EDT) | next |
| 1–6 | Projections, optimizer, models, playoffs | later |

## First run

Prerequisites (macOS): Python 3.12, [`uv`](https://docs.astral.sh/uv/), and two Homebrew
libraries: `libomp` (LightGBM/XGBoost) and `cbc` (the MILP solver).

```bash
brew install uv libomp cbc
make setup                       # .venv + locked dependencies
cp .env.example .env             # then paste your keys into .env
make backfill                    # 2023-24 .. 2025-26 history + the 2026-27 schedule
make app                         # http://localhost:8501
make test && make lint
```

`.env`, `oauth2.json` and `data/` are gitignored and must never be committed.

`make backfill` is resumable. Every API page is cached in the store, so a re-run replays cached
pages and requests only the missing ones. A full three-season backfill is about 2,000 requests
and takes roughly 10 minutes on the BallDontLie GOAT plan.

## Getting Yahoo data in (CSV inbox)

Yahoo API access is pending, so Yahoo data arrives as CSV files in `data/inbox/`, loaded by
`make inbox`. Chrome saves downloads to `~/Downloads`, so `make inbox` first moves any newer
`roster.csv`, `players.csv`, `matchup.csv` or `draft_results.csv` from there into the inbox. A file that doesn't match its schema is rejected with
the offending line numbers, and nothing from that batch is written.

### Claude in Chrome shortcut

With the Yahoo league open in Chrome, run this prompt in Claude in Chrome:

> On this Yahoo Fantasy Basketball league (Hoop Dreams, league 79805), read-only — do not click
> add, drop, trade, or lineup buttons. Download three CSV files with exactly these names and
> headers:
>
> 1. `roster.csv` — every player on every team's roster:
>    `team_id,player_name,selected_slot,eligible_positions,status,team_abbr`
> 2. `matchup.csv` — this week's category totals for every team:
>    `week,team_id,opponent_team_id,fg_pct,ft_pct,fg3m,pts,reb,ast,stl,blk,tov`
> 3. `players.csv` — the top 300 available players (Players tab, status: Available, sorted by
>    % rostered): `player_name,team_abbr,eligible_positions,pct_rostered,status,owner_team_id`
>
> Use Yahoo's numeric team ids (1–14, from each team's URL). `eligible_positions` like
> `PG,SG` in quotes. Leave `status` blank for healthy players; otherwise use Yahoo's code
> (GTD, O, INJ, DTD). `owner_team_id` blank for free agents.

### CSV column schemas

Columns marked * are required. Unknown columns are rejected.

| File | Columns | Notes |
|---|---|---|
| `roster.csv` | `team_id`\*, `player_name`\*, `selected_slot`\*, `eligible_positions`\*, `status`, `team_abbr`, `yahoo_player_key` | slot ∈ PG SG G SF PF F C Util BN IL IL+ |
| `players.csv` | `player_name`\*, `team_abbr`\*, `eligible_positions`\*, `pct_rostered`\*, `status`, `owner_team_id`, `yahoo_player_key` | `pct_rostered` 0–100; a trailing % is fine |
| `matchup.csv` | `week`\*, `team_id`\*, `opponent_team_id`\*, `fg_pct`\*, `ft_pct`\*, `fg3m`\*, `pts`\*, `reb`\*, `ast`\*, `stl`\*, `blk`\*, `tov`\* | percentages as decimals (0.471) |
| `draft_results.csv` | `pick_no`\*, `round`\*, `team_id`\*, `player_name`\*, `team_abbr`, `yahoo_player_key` | written by the draft tracker or exported from Yahoo |

`eligible_positions` accepts `,`, `/` or `;` separators. `team_abbr` may be Yahoo's short form
(`GS`, `NO`, `NY`, `SA`, `PHO`); `config/aliases.yaml` maps those to BallDontLie codes.

### Names that don't match

Every Yahoo name is matched to a BallDontLie player id. Matching ignores accents, case,
punctuation and Jr./III suffixes, and the team breaks ties between players who share a name.
Anything still unmatched or ambiguous goes to the **name quarantine** on the Data page and is
never guessed. To fix one, add an entry to `config/aliases.yaml`.

## Scheduling

The nightly job (Phase 1) runs at 6:30 pm local via `apscheduler` inside `jobs/nightly.py`
while that process is running. As a cron alternative, add this with `crontab -e`:

```cron
30 18 * * * cd ~/Documents/trade/nba-research-room && make nightly >> data/nightly.log 2>&1
```

DuckDB allows one writer at a time. If a job is writing when you open the app, the page says so;
refresh after the job finishes.

## Live draft listener (Tampermonkey)

Arrives in Phase D: a userscript in `scripts/draft_listener.user.js` that watches the Yahoo draft
room's pick list and posts each new pick to the local draft API on port 8765. It never clicks
anything, and manual pick entry stays available as a fallback. Install steps will be added here
with the script.

## Layout

```
config/          settings.yaml (league rules), aliases.yaml, overrides.yaml, x_accounts.yaml
src/research_room/
  config.py      typed settings + secrets      store.py     DuckDB schema, upserts, cache
  schedule.py    fantasy weeks, B2Bs, light days, playoff-week games
  ingest/        bdl.py (BallDontLie), yahoo.py (CSV inbox), names.py (identity)
  ui.py          read-only store helpers for the app
jobs/            backfill.py (nightly.py, pregame.py later)
app/             Home.py, pages/6_Data.py
tests/           pytest, fixture data only, no network
```
