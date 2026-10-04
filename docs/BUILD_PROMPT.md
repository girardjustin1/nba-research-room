# NBA Research Room — Build Prompt

Paste this whole file as your first message in Claude Code (VS Code), with the folder /Users/girardjustin/Documents/trade/nba-research-room open.

---

## Setup you must do first, before any build work

I will not run anything in a terminal myself. You do all of it.

1. Working directory is `/Users/girardjustin/Documents/trade/nba-research-room`. If it is not yet a git clone of [https\://github.com/girardjustin1/nba-research-room](https://github.com/girardjustin1/nba-research-room), clone it there (it may contain only a README). Confirm the remote is correct.  
2. The repo is PUBLIC. Before creating any other file, write `.gitignore` containing: `.env`, `oauth2.json`, `data/`, `.venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.ruff_cache/`, `*.duckdb`, `*.pem`, `.DS_Store`. Commit it alone as "Add gitignore" and push.  
3. Create `.env` with these keys and empty values: `BDL_API_KEY`, `RUNDOWN_API_KEY`, `X_BEARER_TOKEN`, `LLM_API_KEY`, and set `YAHOO_LEAGUE_ID=79805`, `YAHOO_TEAM_ID=11`. Create `oauth2.json` with `consumer_key` and `consumer_secret` as empty strings. Then ask me to paste my keys into those two files and wait until I confirm before continuing. Never print, echo, or commit their contents, and never set `ANTHROPIC_API_KEY` as a global environment variable.  
4. Check for Python 3.12 and `uv`; install `uv` if missing (Homebrew or the official installer). Create the virtual environment with `uv venv` and install dependencies with `uv pip install`. Commit `uv.lock`.  
5. Save this entire prompt as `docs/BUILD_PROMPT.md` in the repo and commit it, so you can re-read it in later sessions. In every new session, read `docs/BUILD_PROMPT.md` and `DECISIONS.md` before doing anything.  
6. Before Phase 0's backfill, remind me to start the BallDontLie GOAT 48-hour trial and paste the key into `.env`; do not start the backfill until I confirm.  
7. Tampermonkey is a browser extension for the live draft only; you write the script in `scripts/`, I install it. Nothing else requires me to use a terminal.

After setup, run `git status` and show me that `.env` and `oauth2.json` are NOT listed, then proceed to Phase 0\.

---

**Role:** You are a senior ML engineer and Python architect specializing in quantitative sports analytics. You are building a personal NBA fantasy basketball decision tool for me for the 2026-27 season. Build it as production-quality, modular Python with docstrings, type hints, error handling, and tests. Work incrementally: scaffold the repo, then build one module at a time, running it against real data before moving on. Ask me only when a decision changes the architecture; otherwise choose sensibly and note the assumption in a `DECISIONS.md`.

## Goal and hard constraints

**Goal:** a local Streamlit app ("NBA Research Room", repo: [https\://github.com/girardjustin1/nba-research-room](https://github.com/girardjustin1/nba-research-room)) that (1) runs a live draft board during my Yahoo draft, (2) projects player stats daily with an ensemble of models, (3) recommends daily lineups and weekly streaming pickups with a MILP optimizer, and (4) reports head-to-head win probability via Monte Carlo. It recommends; I execute moves by hand in the Yahoo app.

**Constraints that shape the design:**

- Yahoo's Fantasy API is read-only and my access application is pending. `ingest/yahoo.py` must work from CSV snapshots in `data/inbox/` on day one (produced by Claude in Chrome or manual export). The OAuth path is an optional second backend writing to the same tables. Nothing may block on Yahoo approval.  
- Never automate actions inside Yahoo (no adds, drops, lineup clicks, draft picks). Read only.  
- Every projection model, including the ensemble, must beat the EWMA baseline out-of-sample in the backtest before it drives recommendations. Keep a scoreboard.  
- The first learned model predicts **minutes**, not fantasy points. Per-minute rates come from EWMA; stat \= rate × projected minutes.  
- Category leagues get per-category projections and z-scores with proper percentage weighting: FG%/FT% value \= (player% − pool%) × attempts. Punt masks zero chosen categories.  
- All API calls are cached to DuckDB/Parquet. No API call on Streamlit rerun; the app reads the store only.  
- Secrets in `.env`, never in code. `oauth2.json` and `data/` are gitignored.  
- Python 3.12, `uv` for env and lockfile, `ruff` for lint, `pytest` for tests.

**League settings** (also in `config/settings.yaml`): Yahoo league "Hoop Dreams", league ID 79805, my team ID 11\. Scoring: Head-to-Head One Win — each week is a single win or loss decided by winning the majority of 9 categories: FG%, FT%, 3PTM, PTS, REB, AST, ST, BLK, TO (TO is negative). 14 teams. Roster: PG, SG, G, SF, PF, F, C, C, Util, Util, BN, BN, BN, IL — 10 active per day, 3 bench, 1 IL; injured free agents may be added directly to IL. Lineups lock daily at each player's game time; bench players are not locked. Max 4 acquisitions per week, no season maximum; waivers 2 days, continual rolling list. Trade deadline March 4, 2027\. Playoffs: 6 teams, weeks 20–22, ending Sunday April 4, 2027; eliminated teams lock. Draft: live standard snake, Sunday Oct 18, 2026 at 7:00 pm EDT, 1-minute pick clock, my slot \[DRAFT SLOT\] of 14\. League is not publicly viewable.

## Data sources

One ingest module per source, all writing to the same DuckDB tables with a `source` and `fetched_at` column. Read each API's docs before writing the client; pin versions in `requirements.txt`.

| Source | Module | Provides | Access | Cadence |
| :---- | :---- | :---- | :---- | :---- |
| BallDontLie (GOAT tier) | `ingest/bdl.py` | Schedule, player game logs, season averages, advanced stats (usage, pace, DRTG), injuries, game odds (spread/total) | API key, 600 req/min | Nightly full; pre-tip injuries |
| Yahoo Fantasy | `ingest/yahoo.py` | League settings, rosters, matchups, free agents (pct\_rostered, status), draft results, transactions | CSV inbox first; OAuth read-only when approved | Daily |
| Kalshi (public market API) | `ingest/kalshi.py` | NBA player prop ladders (PTS, REB, AST, 3PM, STL, BLK series KXNBAPTS etc.) as implied CDFs; game markets; candlestick history | No auth for market data | Nightly \+ pre-tip |
| TheRundown (free tier) | `ingest/rundown.py` | Sportsbook pre-match lines and player props if the free tier includes them; archive lines nightly | API key | Nightly |
| X API | `ingest/x_feed.py` | Posts from \~40 curated beat/news accounts → structured status events (player, status, minutes cap, starting) | Bearer token; keep under \~300 reads/day | Game days, every 15 min for 3h pre-tip |
| Published projections | `ingest/external_proj.py` | Preseason per-game projections for the draft tool (CSV I supply) | Manual CSV | Once, preseason |

Rules: mid-price and a minimum-volume filter on Kalshi; treat illiquid contracts as missing. Normalize player names across sources with one `aliases.yaml`; unmatched names go to a quarantine table surfaced in the app. Parse X posts with a small LLM call into a fixed JSON schema and discard raw text.

## Repository structure

Create exactly this layout. Each `src` package has an `__init__.py`; each module has a module docstring stating its inputs, outputs, and the tables it reads/writes.

```
nba-research-room/
├── README.md · DECISIONS.md · requirements.txt · pyproject.toml · Makefile · .env.example · .gitignore
├── config/
│   ├── settings.yaml        # league id, scoring, slots, move cap, playoff weeks, draft slot
│   ├── overrides.yaml       # manual role/minutes/status adjustments by player
│   ├── aliases.yaml         # cross-source name mapping
│   └── x_accounts.yaml      # curated handles for the X feed
├── data/                    # gitignored
│   ├── inbox/               # Yahoo CSV snapshots (roster.csv, matchup.csv, players.csv, draft_results.csv)
│   ├── research_room.duckdb
│   └── parquet/
├── src/research_room/
│   ├── store.py             # DuckDB connection, schema, upsert helpers, Parquet export
│   ├── ingest/  bdl.py · yahoo.py · kalshi.py · rundown.py · x_feed.py · external_proj.py · names.py
│   ├── schedule.py          # games/week per team, B2Bs, light days, NBA Cup gaps, playoff-week counts
│   ├── features.py          # feature table builder
│   ├── projections/
│   │   ├── baseline.py · ridge.py · lgbm.py · catboost.py · hier.py
│   │   ├── ensemble.py      # scoreboard, inverse-error blend, confidence bands
│   │   └── explain.py       # SHAP for tree models
│   ├── overrides.py         # injuries + X events + overrides.yaml → play_prob, minutes_cap
│   ├── simulate.py          # Monte Carlo H2H; shared by draft and season
│   ├── optimizer.py         # weekly MILP (PuLP/CBC)
│   ├── backtest.py          # replay past weeks; model scoreboard
│   └── draft/  value.py · availability.py · board.py · tracker.py
├── jobs/  nightly.py · pregame.py · backfill.py
├── app/
│   ├── Home.py
│   └── pages/  1_Draft.py · 2_Lineup.py · 3_Streaming.py · 4_Projections.py · 5_Models.py · 6_Data.py
├── scripts/draft_listener.user.js   # Tampermonkey: POST picks from the Yahoo draft room to the app
└── tests/
```

## Module specifications

**store.py** — DuckDB schema with tables: `players`, `teams`, `games`, `game_logs`, `advanced_stats`, `injuries`, `odds` (source, market, line, prob, ts), `props_ladder` (player, stat, threshold, prob, volume, ts), `status_events`, `yahoo_league`, `yahoo_rosters`, `yahoo_players`, `yahoo_matchups`, `draft_picks`, `projections` (model, player, date, stat, mean, sd), `model_scores`, `decisions_log`. Idempotent upserts keyed on natural keys. Nightly Parquet export.

**ingest/bdl.py** — Typed client with retry/backoff and rate limiting. `backfill(seasons=[2024, 2025, 2026])` pulls game logs and advanced stats; `sync_daily()` pulls schedule, injuries, odds. Run backfill inside the GOAT trial window.

**ingest/yahoo.py** — `CsvBackend` reads `data/inbox/*.csv` with a strict column schema and timestamps each snapshot; `ApiBackend` (yahoo\_fantasy\_api, read-only) is added behind the same interface. Both write identical tables.

**ingest/kalshi.py** — Pull NBA series (KXNBA game markets; KXNBAPTS, KXNBAREB, KXNBAAST, KXNBA3PM, KXNBASTL, KXNBABLK props). Store the full threshold ladder per player per game with mid-price and volume. Build `implied_cdf(player, stat)` for the simulator. Archive candlesticks nightly for backtests.

**ingest/x\_feed.py** — Poll user timelines from `x_accounts.yaml`, game days only, 15-min cadence in the 3h before first tip. Parse each post via a small LLM call into `{player, team, status, minutes_cap, starting, confidence, ts}`; official team accounts outrank aggregators. Hard daily read budget in config.

**schedule.py** — Per team per fantasy week: game count, B2B flags, light days (≤5 games league-wide), NBA Cup knockout gaps (Dec 4–11), All-Star week, and game counts in playoff weeks.

**features.py** — Per player per game-date: rolling 3/5/10-game minutes, usage, FGA, per-category rates; EWMA rates; days rest; home/away; opponent pace and DRTG; Vegas spread and total; sportsbook and Kalshi prop lines; teammates-out usage share; `play_prob` and `minutes_cap` from overrides. No target leakage: features use only data available before tip.

**projections/** — Each model exposes `fit(train_df)`, `predict(df) -> DataFrame[player, date, stat, mean, sd]`. `baseline.py` \= EWMA rates × projected minutes × games. `ridge.py`, `lgbm.py`, `catboost.py` first predict minutes, then per-category rates. `hier.py` \= player random effects shrunk to position priors (use `bambi`/`pymc` or an empirical-Bayes approximation). `ensemble.py` scores every model weekly on held-out games (MAE per stat, calibration), stores a scoreboard, blends with inverse-error weights per category clamped to ≥0.05 each, and outputs a confidence band from model disagreement. `explain.py` \= SHAP summary and per-player waterfall for tree models.

**overrides.py** — Merge BDL injuries, X events, and `overrides.yaml` into `play_prob` and `minutes_cap` per player per date, most recent and most authoritative wins.

**simulate.py** — Vectorized NumPy. Analytic mode: team category totals as sums of normals, P(win cat) \= Φ. Monte Carlo mode: 5,000 draws, sampling from Kalshi implied CDFs where liquid, else normal(mean, sd). Returns P(win week), expected categories won, per-category edges. Must run a 12-team evaluation in under 2 seconds.

**optimizer.py** — PuLP MILP over a horizon of the remaining days in the week: binary x\[player, slot, day\], y\_add\[player\], y\_drop\[player\]. Constraints: position eligibility, active limits per day, roster size, weekly move cap, IL rules, no benching a healthy starter for a streamer unless the objective improves. Objective: probability of winning the week, i.e. P(win at least 5 of 9 categories) vs this week's opponent (from `simulate`), because this league is Head-to-Head One Win; expected categories won is a tiebreaker term only; secondary term for playoff-week game volume. Output: current vs optimal lineup diff and an ordered add/drop plan.

**backtest.py** — Replay each completed fantasy week: rebuild features as-of, run each model and the ensemble, score, and compare recommended lineups against actual results. Writes `model_scores`.

**app/** — Reads the store only. Home: projected totals, win probability, games vs opponent. Lineup: current vs optimal. Streaming: heat map of open slots by day with candidates. Projections: ensemble table with bands and SHAP. Models: scoreboard. Data: inbox status, quarantine, last sync times. Draft page specified below.

## Draft helper

A live draft board that re-ranks after every pick. Inputs: my draft slot, team count, snake order, keepers, ADP, preseason projections (external CSV blended with last-season rates and `overrides.yaml`), and picks entered as `{pick_no, team, player}`.

- **draft/value.py** — Per-category z-scores over the top \~200, percentage categories weighted by attempts, punt masks, value over replacement by position, tier breaks at value cliffs.  
- **draft/availability.py** — P(player available at my next pick) from ADP with uncertainty widening by round.  
- **draft/board.py** — For each candidate: marginal team value \= expected categories won after adding him (analytic Φ screen for all candidates, Monte Carlo for the top 5), value-now vs expected-best-at-next-pick, opponent roster fill via ADP plus each team's positional and category needs, punt-drift detection after round 3\.  
- **draft/tracker.py** — Pick log in DuckDB, undo, roster view per team, export to `draft_results.csv`.  
- **app/pages/1\_Draft.py** — Pick entry (team defaults to "on the clock", player search), top-10 recommendations with reasons, my roster category balance, tier view, punt toggles, next-pick countdown. Projections load into memory at draft start; state in `st.session_state`; only pick logging touches the store. Board must refresh in under 1 second per pick; recommendations in under 3 seconds.  
- **scripts/draft\_listener.user.js** — Tampermonkey script that observes the Yahoo draft room's pick list and POSTs new picks to a small FastAPI endpoint (`jobs/draft_api.py`, port 8765\) that the Streamlit page polls. It never clicks anything. Manual entry remains the fallback.

No ML here: the draft tool is projections plus simulation.

## Build order

Build in this order and stop at the end of each phase for my review. Each phase ends with passing tests and a one-paragraph note in `DECISIONS.md`.

1. **Phase 0 — Foundation (now to Oct 19).** Repo scaffold, `pyproject.toml`, Makefile, `.env.example`, `store.py` schema, `ingest/bdl.py` with `backfill.py`, `ingest/names.py` and `aliases.yaml`, `schedule.py`, `ingest/yahoo.py` CsvBackend, `app/pages/6_Data.py`. Exit: three seasons of game logs in DuckDB, schedule matrix rendering.  
2. **Phase D — Draft helper (before Sun Oct 18, 7:00 pm EDT).** `ingest/external_proj.py`, `draft/*`, `1_Draft.py`, `draft_api.py`, the Tampermonkey listener. Exit: a mock 12-team draft runs end to end with timed recommendations.  
3. **Phase 1 — Baseline season tool (Oct 20 to Nov 8).** `features.py`, `projections/baseline.py`, `overrides.py` with BDL injuries, daily slot assigner, Home and Lineup pages. Exit: daily lineup recommendation from the app.  
4. **Phase 2 — Optimization (Nov 9 to Dec 13).** `simulate.py`, `optimizer.py` weekly MILP, `ingest/kalshi.py`, `ingest/rundown.py`, `backtest.py`, Streaming page, NBA Cup schedule handling. Exit: current-vs-optimal and a weekly add/drop plan; backtest over weeks 1–6.  
5. **Phase 3 — Models (Dec 14 to Feb 11).** `ridge`, `lgbm`, `catboost`, `hier`, `ensemble.py`, `explain.py`, `ingest/x_feed.py`, `jobs/pregame.py` with alerts, Projections and Models pages. Exit: scoreboard shows which models beat baseline; ensemble gated on.  
6. **Phase 4 — Playoff prep (Feb 12 to Mar 14; trade deadline Mar 4).** Retrain post-deadline, All-Star short week, playoff-week game weighting in the optimizer, rest-risk flags.  
7. **Phase 5 — Playoffs (weeks 20–22, Mar 15 to Apr 4).** Feature freeze; daily ops; `decisions_log`.  
8. **Phase 6 — Post-season.** Full-season backtest; keep what beat baseline; draft tool v2.

Start with Phase 0\. Before writing code, print the proposed `store.py` schema and the BDL endpoints you will use, then proceed.

## Acceptance criteria and rules of engagement

- Every module has tests in `tests/` using small fixture data; `make test` passes before a phase is called done.  
- `make nightly` runs ingest → features → projections → optimize in under 10 minutes on a laptop and is idempotent.  
- The Streamlit app starts in under 5 seconds with no network calls.  
- No feature uses information from after the game's tip time; add a `tests/test_leakage.py` that checks timestamps.  
- Projections table always carries `mean` and `sd`; the simulator never receives a point estimate alone.  
- The optimizer reports infeasibility with a readable reason instead of crashing.  
- Name resolution: 100% of rostered Yahoo players must match a BDL id or appear in the quarantine view.  
- Log every recommendation shown in the app to `decisions_log` with the inputs that produced it.  
- Prefer boring choices: pandas over polars, CBC over commercial solvers, plain `requests` clients with pinned versions. Use `xgboost` only as one of the tree models in Phase 3, never as the starting point.  
- If an API's docs disagree with these instructions, follow the docs and note it in `DECISIONS.md`.  
- Do not build anything that performs actions inside Yahoo.

## Environment, secrets and setup

- Python 3.12; `uv venv` and `uv pip install -r requirements.txt`; `uv.lock` committed.  
- `requirements.txt` (pin exact versions on first install): balldontlie, yahoo\_fantasy\_api, yahoo\_oauth, tweepy, requests, pandas, numpy, duckdb, pyarrow, pyyaml, pydantic, pydantic-settings, scikit-learn, lightgbm, catboost, xgboost, shap, pulp, streamlit, plotly, fastapi, uvicorn, apscheduler, anthropic (or openai) for X parsing, pytest, ruff.  
- `.env.example` keys: `BDL_API_KEY`, `RUNDOWN_API_KEY`, `X_BEARER_TOKEN`, `LLM_API_KEY`, `YAHOO_LEAGUE_ID`, `YAHOO_TEAM_ID`.  
- `oauth2.json` (Yahoo consumer key and secret) only when API access is approved; keep the CSV backend as default until then.  
- Makefile targets: `setup`, `backfill`, `nightly`, `pregame`, `draft-api`, `app`, `test`, `lint`.  
- Scheduling: `apscheduler` inside `jobs/nightly.py` for 6:30 pm local daily and `jobs/pregame.py` on game days; document a cron alternative in the README.  
- README must include: first-run steps, the Claude in Chrome shortcut prompt that saves `roster.csv`, `matchup.csv`, `players.csv` into `data/inbox/`, the CSV column schemas, and the Tampermonkey install steps.

Monthly running cost for reference: BallDontLie GOAT \$39.99, X API as already held, Kalshi and TheRundown free, LLM parsing \~\$2–5.

## Open items (ask me for these when you need them)

- [ ] `[DRAFT SLOT]` — fill in once Yahoo assigns draft order  
- [ ] Which preseason projection CSV you will supply for the draft tool  
- [ ] Whether the Phase 0 backfill should include 2023-24 as a third season  
- [x] League settings — filled from the Yahoo settings page on Oct 4, 2026  
- [x] X API tier — pay-per-use; daily read budget 300

---

## Kickoff

Do the Setup section now. When I have confirmed my keys are pasted, start Phase 0: first print the proposed `store.py` schema and the BallDontLie endpoints you will use, then scaffold the repo and build. Commit after each module with a clear message. Stop at the end of Phase 0 for my review.
