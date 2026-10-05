# nba-research-room

A personal, single-user Python application I am building to analyze my own Fantasy Basketball league.

### ▶ [Open the prototype app](https://girardjustin1.github.io/nba-research-room/app/)

The real app in demo mode, on its own page: sample data, no engine needed, works on a phone. Use
**☰** to switch between Draft, League and System; draft picks you enter update the board in the
page (Reset demo restores it). Components and every screen state:
[Storybook](https://girardjustin1.github.io/nba-research-room/).

NBA Research Room is a local app for one Yahoo head-to-head league (React front end on a Python
engine, with a Streamlit fallback for the draft). It runs a live draft
board, projects player stats, recommends daily lineups and weekly pickups, and reports
head-to-head win probability. **It only recommends.** Every move is made by hand in the Yahoo app;
nothing here acts inside Yahoo.

Build plan: [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md). Assumptions and deviations:
[`DECISIONS.md`](DECISIONS.md).

## Status

| Phase | What | State |
|---|---|---|
| 0 | Store, BallDontLie backfill, name resolution, schedule, Yahoo CSV inbox, Data page | built |
| D | Draft helper (before Sun Oct 18, 7:00 pm EDT) | built; runbook in [`docs/draft-night.md`](docs/draft-night.md), check with `make doctor` |
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
make doctor                      # draft-night readiness: what is missing and how to fix it
make markets                     # archive Kalshi props / game markets and TheRundown lines now (nightly does it too)
make pregame-schedule            # game days: X news + NBA injury report + injuries + markets + projections every 15 min before tip
make report-backfill SEASONS="2025"  # store a past season's NBA injury reports (for the news backtest)
make backtest-news               # replay that season day by day: does game-day news make the weekly odds more honest?
```

`.env`, `oauth2.json` and `data/` are gitignored and must never be committed.

`make backfill` is resumable. Every API page is cached in the store, so a re-run replays cached
pages and requests only the missing ones. A full three-season backfill is about 2,000 requests
and takes roughly 10 minutes on the BallDontLie GOAT plan.

## Getting Yahoo data in (CSV inbox)

Yahoo API access is pending, so Yahoo data arrives as CSV files in `data/inbox/`, loaded by
`make inbox`. Chrome saves downloads to `~/Downloads`, so `make inbox` first moves any newer
`teams.csv`, `roster.csv`, `players.csv`, `matchup.csv` or `draft_results.csv` from there into the inbox. A file that doesn't match its schema is rejected with
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
| `teams.csv` | `team_id`\*, `team_name`\* | the league's 14 teams (Yahoo ids 1–14); with `draft.order` set, they name the draft board's columns |
| `roster.csv` | `team_id`\*, `player_name`\*, `selected_slot`\*, `eligible_positions`\*, `status`, `team_abbr`, `yahoo_player_key` | slot ∈ PG SG G SF PF F C Util BN IL IL+ |
| `players.csv` | `player_name`\*, `team_abbr`\*, `eligible_positions`\*, `pct_rostered`\*, `status`, `owner_team_id`, `yahoo_player_key` | `pct_rostered` 0–100; a trailing % is fine |
| `matchup.csv` | `week`\*, `team_id`\*, `opponent_team_id`\*, `fg_pct`\*, `ft_pct`\*, `fg3m`\*, `pts`\*, `reb`\*, `ast`\*, `stl`\*, `blk`\*, `tov`\*, `acquisitions_used` | percentages as decimals (0.471); `acquisitions_used` = this week's adds so far (my team), else the optimizer assumes 0 and says so |
| `draft_results.csv` | `pick_no`\*, `round`\*, `team_id`\*, `player_name`\*, `team_abbr`, `yahoo_player_key` | written by the draft tracker or exported from Yahoo |

`eligible_positions` accepts `,`, `/` or `;` separators. `team_abbr` may be Yahoo's short form
(`GS`, `NO`, `NY`, `SA`, `PHO`); `config/aliases.yaml` maps those to BallDontLie codes.

### Names that don't match

Every Yahoo name is matched to a BallDontLie player id. Matching ignores accents, case,
punctuation and Jr./III suffixes, and the team breaks ties between players who share a name.
Anything still unmatched or ambiguous goes to the **name quarantine** on the Data page and is
never guessed. To fix one, add an entry to `config/aliases.yaml`.

## Scheduling

`make nightly-schedule` keeps the nightly job (Phase 1) running and does a run at 6:30 pm local
each day (`apscheduler`). `make nightly` does one run now. As a cron alternative, add this with `crontab -e`:

```cron
30 18 * * * cd ~/Documents/trade/nba-research-room && make nightly >> data/nightly.log 2>&1
```

DuckDB allows one writer at a time. If a job is writing when you open the app, the page says so;
refresh after the job finishes.

## Live draft listener (Tampermonkey)

`scripts/draft_listener.user.js` watches the Yahoo draft room's pick list and posts each new pick
(`player_name`, NBA `team_abbr`, `pick_no`, `source: "listener"`) to the local draft API. The API
resolves the name and works out the drafting team from the snake order. The script **only reads
the page**. It never clicks, types or submits anything on Yahoo, and its status badge ignores the
mouse (`pointer-events: none`), so clicks go straight through to Yahoo's controls. Manual entry on
the Draft page is always the fallback.

> **The selectors have not been checked against the live Yahoo room.** They are educated guesses
> with fallbacks, tested only against `scripts/mock_draft_room.html`. Check them in a Yahoo mock
> draft before the real draft (Sun Oct 18, 7:00 pm EDT), as described below.

**Install (Chrome)**
1. Install the Tampermonkey extension from the Chrome Web Store. In `chrome://extensions`, open
   Tampermonkey's details and turn on **Allow user scripts** (recent Chrome needs this). Turn on
   **Allow access to file URLs** too if you want to try the local mock room.
2. Tampermonkey icon → **Create a new script**, delete the template, paste the whole contents of
   `scripts/draft_listener.user.js`, then **File → Save** (Cmd+S).
3. Start the API: `make draft-api` (127.0.0.1:8765). Start or resume a session on the Draft page
   (`make app` → Draft) or in the React app, and set your draft slot.
4. Open the Yahoo draft room. A small dark badge appears in the bottom-left corner. The first time
   the script calls 127.0.0.1, Tampermonkey asks for permission: choose **Always allow domain**.

**Reading the badge**
- `draft <id>` is the API session that picks go to. Check it before the draft starts.
- `pick list found (row:li) · seen N` means the script found the pick list and how it reads rows.
  `pick list not found` means no selector matched: enter picks manually and fix the selectors.
- `sent · dup · queued` are counts. Duplicates (picks already logged, for example ones you entered
  by hand) are ignored without fuss. If the API is down, picks stay queued and are retried with
  backoff (2 s up to 15 s) until it is back.
- `UNMATCHED: <name>` means the API could not match a name. Enter that pick manually on the Draft
  page. `CONFLICT` means a pick number changed player (a misread or a commissioner edit). It is
  never sent, so check it by hand.

**Verify in a Yahoo mock draft (do this before Oct 18)**
1. On the Draft page, start a session with a throwaway draft id (for example `yahoo-mock-1`) and
   any slot, so mock picks never reach the real draft log.
2. Join a Yahoo mock draft. Once picks start, the badge should say `pick list found` and `sent`
   should rise with every pick. The Draft page (it polls every 2 s) should show the same picks in
   *Recent picks*.
3. Compare a few rounds against Yahoo's draft results: pick numbers, names and teams.
4. Afterwards, start or resume the real draft id on the Draft page.

**Updating the selectors.** Every DOM assumption is in the `CONFIG.selectors` block at the top of
the script. In the Yahoo room, right-click a pick in the pick list → **Inspect** and find (a) an
element that wraps only the made picks (not the available-players list) and (b) the repeated
element for one pick. Put a selector for (a) first in `container` and one for (b) first in `row`.
`pickNo`, `playerName` and `teamPos` are optional: when they are missing, the row's text is parsed
(`12. Name (DEN - C)`, `Rd 2, Pick 3: Name (BOS - SF)`, `2.03 Name BOS - SF`). Save, reload the
room, and check the badge. To try the script without sending anything, add `?rr_dry_run=1` to the
URL or set `dryRun: true`. `window.__rrDraftListener` in DevTools shows its state. If Yahoo's team
codes differ from BallDontLie's, add them to `CONFIG.teamAliases`.

**Local mock room.** `scripts/mock_draft_room.html?listener=dry&interval=1000` loads the script
in dry-run mode and adds a synthetic pick every second (`layout=text|table`, `order=newest` and
`picks=N` change the markup). `pytest tests/test_listener.py` runs the node unit tests
(`tests/test_listener.mjs`) and drives the mock room in headless Chrome.

## Published prototype and Storybook

Every push that changes `web/` publishes two things to GitHub Pages (public, sample data only):
- **Prototype app** (demo mode): **https://girardjustin1.github.io/nba-research-room/app/**
- **Storybook**: **https://girardjustin1.github.io/nba-research-room/** (the Prototype section
  mirrors every app screen).

Both use invented players; no projections, keys or league data are in either build (scanned before
publishing). The live app with real data only runs on your Mac (`make web`).

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
