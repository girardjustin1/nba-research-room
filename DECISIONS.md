# Decisions

Assumptions and deviations from `docs/BUILD_PROMPT.md`, newest last. Read this and the build
prompt at the start of every session.

## Setup — 2026-10-04

- **Lockfile.** `uv pip install` does not write `uv.lock`; only `uv lock` does, from
  `pyproject.toml`. So `pyproject.toml` is the source of truth: direct dependencies are pinned
  with `==` there, `uv lock` writes `uv.lock`, and `requirements.txt` is generated from the lock
  with `uv export --format requirements-txt --no-hashes --no-emit-project --all-groups`, which
  pins every transitive dependency too. The venv is built with `uv venv` +
  `uv pip install -r requirements.txt`, as the prompt asks. To change a dependency: edit
  `pyproject.toml`, re-lock, re-export, re-install.
- **LLM SDK.** `LLM_API_KEY` is an Anthropic key, so `anthropic` is installed and `openai` is
  not. The key is read from `.env` and passed to the client explicitly; `ANTHROPIC_API_KEY` is
  never set globally.
- **OpenMP.** `lightgbm` and `xgboost` wheels on macOS need `libomp`, installed with
  `brew install libomp`.
- **CBC solver.** PuLP 4.0.0 no longer bundles CBC. Its `pulp[cbc]` extra installs `cbcbox`, but
  macOS kills that binary on launch (exit 137, signature rejected). CBC is therefore the Homebrew
  build (`brew install cbc`, 2.10.13), which PuLP finds on `PATH` as `COIN_CMD`. Verified with a
  two-variable MILP smoke test (Optimal, objective 18 as expected).
- **PuLP 4.0 API.** It differs from the 2.x examples most docs show: variables are created with
  `problem.add_variable(name, low, up, cat=...)` / `add_variable_dict(...)`, not
  `LpVariable(...)`; `problem.solve()` returns an `LpSolveStats` object whose `.status` is an
  `LpSolveStatus` enum; there is no `pulp.LpStatus` dict. `optimizer.py` will use this API.
- **pandas 3.0.** The resolver picked pandas 3.0.6 (copy-on-write by default, string dtype by
  default). Code is written for 3.x.
- **Git identity.** This repo's local git config commits as `girardjustin1`; pushes authenticate
  as the `girardjustin1` GitHub account per command, leaving the machine's active `gh` account
  unchanged.

## Phase 0 — 2026-10-04

**Decided with the owner**
- Backfill seasons are `[2023, 2024, 2025]` (2023-24, 2024-25, 2025-26). The prompt's
  `[2024, 2025, 2026]` uses BallDontLie's start-year numbering, where 2026 is the unplayed
  2026-27 season. This also closes the open item about including 2023-24. The 2026-27
  schedule is pulled as well.
- BallDontLie is on the paid GOAT plan (600 req/min). The client uses 540/min for headroom.

**BallDontLie (checked against the live API and the OpenAPI spec, which beats the docs page)**
- Plain `requests` client, not the `balldontlie` SDK: the SDK's pydantic models drop
  `games.datetime` (tip time, needed for leakage checks) and the v2 advanced fields.
- Paths: `/v1/teams`, `/v1/players/active`, `/v1/games`, `/v1/stats`, `/v1/player_injuries`,
  `/nba/v2/stats/advanced` (with `period=0` = full game), `/nba/v2/odds`, `/nba/v2/odds/opening`.
  The docs page shows `/v2/player_props`; the real path is `/nba/v2/odds/player_props` and it
  takes one `game_id` per call.
- **Odds history is not retained.** Every past date returns zero rows even though the docs say
  "2025 season onwards"; upcoming games return lines from ~11 books (including Kalshi
  moneylines). So odds are archived nightly from now on, and spread/total features are
  missing (lower confidence) for all history.
- Player props return nothing yet (preseason). Their parser waits until real rows exist rather
  than being written against a guessed format.
- `min` is a whole-minute string; `"00"`/`"0"`/`""` means did not play. ~35 rows per game,
  ~15 of them DNP. DNP rows are kept (`did_play = false`): they matter for the minutes model.
- `turnover` is stored as `tov`. Odds `prob` is de-vigged within each two-way market pair.
- The 2026-27 schedule has 1,200 games, not 1,230: the NBA sets the last 30 after the Cup group
  stage. December team-week counts will rise when those are published.
- **Incomplete box scores.** 21 team-games (19 games, Feb-Mar 2024) are missing player rows at
  the source: summed points miss the final score or minutes fall under 235. 2024-25 and 2025-26
  reconcile exactly (5,286 team-games). `quality.py` flags them; features exclude them.
- BDL leaves `season_type` empty and tags NBA Cup stages only from 2025-26; play-in games come
  back as non-postseason. Fantasy weeks end Apr 4, so neither touches the season tool.
- `/v1/teams` returns 89 rows including defunct franchises; the 30 current teams have a division.
- `players.team_id` is the player's current team (from `/players/active`);
  `game_logs.team_id` is the team at game time.

**Schema additions beyond the prompt**
- `player_xref` (resolved cross-source ids) and `unresolved_names` (the quarantine).
- `api_responses`: raw page cache keyed on (source, endpoint, params hash). It makes backfills
  resumable and re-parsable. X posts will be excluded so raw text is never stored.
- `ingest_runs`: per-job status, row counts and errors for the Data page.
- `injuries` keyed on (player_id, fetched_at): snapshots, never overwritten, so features can be
  rebuilt as of any past tip time.
- `projections.run_at`, so the backtest knows which projection existed when. `mean` and `sd`
  are NOT NULL in the schema.
- `odds` has `side` and `is_opening`; `props_ladder` has `side`, `vendor`, `price`.

**Layout additions**
- `src/research_room/config.py` (typed settings + secrets) and `src/research_room/ui.py`
  (read-only store helpers for the pages; inside the package so pages import it whether
  Streamlit is launched from `Home.py` or a page directly).
- `jobs/ingest_inbox.py` / `make inbox`: loads the Yahoo CSVs, first moving newer copies in from
  `~/Downloads` (Chrome cannot save straight into the repo).
- Later-phase modules are created in their phase, not stubbed now.
- `RESEARCH_ROOM_DB` env var overrides the store path (tests only).

**Assumptions to confirm**
- **Fantasy week boundaries (weeks 1-19).** Playoff weeks 20-22 (Mar 15 - Apr 4) follow from
  the league settings, which forces two extended weeks before them. Assumed: week 1 runs two
  calendar weeks (Oct 19 - Nov 1) and week 17 is the merged All-Star week (Feb 15 - 28).
  `season.week_boundaries_verified: false` until checked against the Yahoo league schedule;
  the Data page says so.
- All-Star break dates (Feb 12-17, 2027) are assumed.

**Operational notes**
- DuckDB allows one writer. The app opens the store read-only and says so if a job is writing.
- The raw response cache makes the store ~1 GB after the backfill. Parquet exports skip it.
  Follow-up if size matters: compress cached bodies, or prune pages for completed seasons.
- A local `.git/hooks/pre-commit` blocks any commit containing a value from `.env` or
  `oauth2.json`, or any file under `data/`. It is not versioned, so a fresh clone lacks it.
- `tests/test_leakage.py` arrives with `features.py` in Phase 1; Phase 0 builds no features.
- Ruff line length is 110.

**Phase 0 result.** The backfill pulled 2023-24 through 2025-26 plus the 2026-27 schedule in
632 s and 2,497 requests: 5,162 games, 138,296 game-log rows (85,000 player-games played), 104,756
advanced-stat rows (100% coverage of played games), 937 players. Box scores reconcile with final
scores in every 2024-25 and 2025-26 game; 21 earlier team-games are flagged. The Data page renders
the 2026-27 schedule matrix from the store. Open for later: verify week 1-19 boundaries against
Yahoo, Basketball Monster projections CSV (Phase D), keepers (unknown; supported with an empty
list), draft slot.

## Phase D inputs — 2026-10-04

**Basketball Monster projections (subscription; files live in `reference/`, which is gitignored
because the data is paid and the repo is public).**
- Two exports are needed and are joined on BBM's player ID (601/601 match, projected games agree
  for all): **Export to CSV** = raw season totals with makes and attempts (FGM/FGA, FTM/FTA,
  3PM/3PA, games, minutes, every counting stat), identical whatever columns are selected;
  **Export to Excel** = the on-screen table (legacy `.xls`, read with `xlrd`) with Yahoo ADP,
  Advanced ADP, team, primary position, age, injury risk, role, tiers, NBA ID.
- `Y!Adp = 0` means **no Yahoo ADP**, not pick 0. 238 players have one, covering picks ~1-136
  only; the league drafts 196 (14 x 14). Fallback order: Yahoo ADP -> BBM Advanced ADP (201
  players, to ~156; corr 0.97 with Yahoo, median gap 6.4 picks) -> BBM rank with wide
  uncertainty and lower confidence.
- BBM gives one primary position. Yahoo eligibility (often multi-position) should come from a
  Yahoo `players.csv` snapshot before the draft; until then primary position plus BDL's
  G/F/C grouping is a lower-confidence stand-in.
- BBM team codes `NOR`, `PHO`, `FA` differ from BDL (`NOP`, `PHX`, none).
- Name matching: 516/516 players projected to play match a BDL id (506 exact, 10 via nickname
  aliases keyed by BDL id). 8 zero-game players stay quarantined.

## Phase D build — 2026-10-04

**Front end (decided with the owner).** The Python engine computes everything; front ends only
display it. A local FastAPI app (`research_room/api.py`, `make draft-api`, 127.0.0.1:8765) is the
single source of truth for the draft: the React draft room, the Streamlit Draft page (kept as
a draft-night fallback) and the Tampermonkey listener all read and write the same session.
- React: Vite + TypeScript + **MUI** (Material UI v9, MUI X Charts and the free Data Grid) in
  `web/`, dev server on 127.0.0.1:5173 proxying `/api` to the draft API.
- **Storybook runs locally only** (127.0.0.1:6006). Stories use invented players; Basketball
  Monster data never goes into fixtures (paid data, public repo).
- The API opens the store per write and closes it, so the Data page is never locked out.
- Every local server binds to 127.0.0.1, not all interfaces.

**Board model choices (measured on the real pool).**
- Per-game sd prior: variance proportional to the mean (`phi` per stat from 2025-26), not a
  constant CV; the CV prior overstated stars' spread (Jokic 11.3 vs actual 8.9 pts sd).
- Tiers: natural breaks (1-D optimal clustering, 16 tiers over the top 200). A global gap
  threshold put 194 players in one tier.
- Games per team per week, 3.12 regular season / 3.58 playoff weeks, come from the 2026-27
  schedule, not a constant.
- Incomplete box scores are excluded per team side, not per game.
- Rounds assumed 13 (one per non-IL slot) = 182 picks; confirm in Yahoo's draft settings.
  **Superseded 2026-10-04:** Yahoo's roster has 2 bench spots, not the build prompt's 3
  (PG, SG, G, SF, PF, F, C, C, Util, Util, BN, BN, IL). Rounds are now assumed 12 (168 picks)
  and unconfirmed until checked in Yahoo's draft settings.

**Kalshi (checked 2026-10-04, public API, no key).** `https://api.elections.kalshi.com/trade-api/v2`
answers without auth; 70 NBA game markets (`KXNBAGAME`) were open, including preseason. Player
prop series exist as `KXNBAPTS`, `KXNBAREB`, `KXNBAAST`, `KXNBASTL`, `KXNBABLK` and
**`KXNBA3PT`** (the build prompt's `KXNBA3PM` does not exist), plus `KXNBAFTM` and combos
(`KXNBAPRA`, `KXNBAPR`, `KXNBAPA`, `KXNBARA`, `KXNBASTOCK`). No prop markets were open in
preseason; Phase 2 checks when they list (likely game day) before relying on them.

**Draft readiness (2026-10-04).**
- Eligibility: Yahoo's `eligible_positions` from the latest `players.csv` snapshot is the
  authority. A player missing from it uses his Basketball Monster primary position, and the API
  marks him `eligibility_source: "bbm"`, so the player sheet says the position is an estimate. An
  older snapshot is never mixed in: only the latest one counts.
- Keepers come from `draft.keepers` and are placed when a session starts. Names resolve against
  the pool. An unmatched or ambiguous name refuses to start the session instead of guessing.
- League facts I have not checked yet (rounds, keepers, the listener) are explicit
  `draft.confirmed.*` flags, not comments. `make doctor` (`research_room/readiness.py`, also
  GET /system/readiness) warns on each one. It fails only when the board would be wrong or would
  not start: no projections, no schedule, or an unmatched keeper. Runbook: `docs/draft-night.md`.
- `make nightly --schedule` never worked (make rejects the flag). It is now `make nightly-schedule`.

**Team names and draft order (2026-10-04).** Team names arrive as `teams.csv` in the Yahoo inbox
(table `yahoo_teams`, keyed by Yahoo team id) and live only in the local store: several include
managers' first names, and the repo is public. `draft.order` (Yahoo team ids by slot, empty
until Yahoo posts it) maps them onto board columns and sets my slot from my team's position.
Names typed in the app still win. Settings refuse an order that misses or repeats a team, or that
disagrees with `draft.my_slot`.

**Draft room in two tabs (owner's call, 2026-10-04).** The local pick clock is gone: Yahoo's room
has the real one. The draggable bottom sheet is gone too. **Board** is the grid of every team's
picks. **Me vs league** compares me with the league side by side (my value, league average, best
team, my rank per category), then the market by position, suggested picks and Available /
Favorites. My team and Teams moved to the tools menu. The comparison is GET /draft/strength. Each
team is scored on its projected final roster (picks so far plus a typical player at each remaining
pick) as P(win the category) against a league-average team, so teams with one pick more or less
still compare fairly. The ▲/▼ cut-off (1 point, 0.05 categories) is display only.

## Phase 1 — started 2026-10-04 (in parallel with Phase D UI work, owner's choice)

- **EWMA half-lives chosen from data** (2024-25 and 2025-26, next-game relative MAE, players with
  >= 10 minutes): minutes are best with a short memory (half-life 3 games: 0.184 vs 0.198 at 20);
  per-minute rates want a long one (half-life 12-20 plateau; 15 chosen). Settings: `features.*`.
- `features.py` builds one row per player-game (DNPs included) in ~3 s for three seasons. Rates
  are ratios of EWMA sums (stable for steals/blocks). Fewer than 5 prior games -> rate and minutes
  features are missing, not guessed. `features` is a derived DuckDB table, replaced on each build.
- **Leakage**: features are computed as the state after each game and shifted one game per player
  (per team for opponent context). `tests/test_leakage.py` truncates the data at three cutoffs and
  requires identical earlier features, and tampers with a future game; a deliberately planted leak
  (no shift) is caught. Teammates-out usage uses who actually sat; pre-tip that is known from injury
  reports, so it stands in for the report until overrides.py supplies it.
- Vegas and prop-line features are absent from history (no odds archive) and come in as the nightly
  archive grows.
- **Baseline projection** (`projections/baseline.py`): per game, EWMA per-minute rate x minutes
  when playing x P(plays), with over-dispersed variance (phi fitted per stat on 2023-25: pts 2.35,
  FT 1.9-2.1, most others ~1.0-1.1). Out of sample on 2025-26: bias near zero (pts +0.04,
  reb -0.03, ast +0.01) and calibrated (pts 70% within 1 sd vs 68% expected; blocks run wide at
  84%, typical for small counts).
- **Season carry-over fix**: last season's play rate leaked end-of-season rest into October (Jokic
  projected low). P(plays) now blends toward the preseason games projection (games / 82) with the
  same n / (n + 10) weight as the stat line; overrides win outright. Only current players (played
  last season or this one, or in the preseason pool) are projected.
- **Planned (Phase 2): week win-probability history.** The weekly simulator stores a
  `matchup_snapshots` row (as_of, week, P(win week) + band, expected categories, category lead,
  the event that triggered it) after each nightly run, game-day refresh and material news event.
  GET /season/week/probability serves them for the Matchup chart (You vs opponent, green above
  50% / red below), together with projected paths from now to Sunday: "do nothing" vs the
  recommended plan (and up to 3 named alternatives). POST /season/scenario {move_ids} re-simulates
  any set of moves on demand (target < 1 s) and reports feasibility (e.g. acquisitions over 4);
  the browser never computes probabilities. Contract drafted in web/src/api/season.ts.
- **Planned (Phase 2): Game Center.** The main Matchup screen mirrors an NFL game page for the
  fantasy week: category score as the scoreboard, a week-progress bar, Win probability vs
  "With moves" (per-category dropdown), milestone markers (pickups, injuries, locks, category
  flips, clinched/out of reach), a category linescore with swing categories, key moments, mirrored
  strength bars (hatched vs solid), a me-vs-opponent daily volume heat map, both rosters' injury
  reports and ranked pickups. GET /season/week/gamecenter (contract drafted by the web agent).
- **Season UI decisions (owner, 2026-10-04):** the projected "do nothing" win-probability line
  stays flat with a widening band (correct: expected future odds equal today's) and gets a one-line
  caption; compare mode shows up to 3 plans on one chart (a 4th color fails the dark-mode CVD check,
  so extra plans get small separate charts); in add/drop strips a dropped player's games before the
  move still count for the week (as in Yahoo) and show gray; invented readable names in fixtures;
  dashed gridlines kept on the win-probability chart; inside the app shell the shell's nav is used.

## Phase 2 — started 2026-10-04: calibration of weekly win probabilities

Measured out of sample (fit on 2023-24 and 2024-25, scored on 2025-26). Random 10-player teams
are drawn from the top 180 players by projected points, one Monday–Sunday week at a time.
- **The simulator was overconfident about team weekly totals.** Only 66–81% of real team weeks fell
  inside the 80% band (PTS 66%, REB 69%, AST 72%), so P(win category) was too sure. The game-level
  scoreboard hid this: its "too wide" readings for blocks and steals come from small whole numbers.
  Weekly totals are what decide a matchup.
- Cause 1: the per-game spread was fitted against actual minutes, which left out minutes
  uncertainty. The baseline now fits it against projected minutes (phi PTS 2.35 → 3.39). Team-week
  coverage alone rose about 5 points.
- Cause 2: games and players aren't independent within a week. `calibration.py` fits one variance
  multiplier per category on the training seasons (PTS 1.25, REB 1.26, AST 1.23, TO 1.15, FT% 1.19;
  FG%, STL and BLK about 1.0–1.06). It's stored in `sim_calibration` and passed to the simulator
  as `var_mult`. Calibrated team-week coverage on 2025-26 is 78–81% in all nine categories,
  reported as `baseline_team_week` on the Models screen. The nightly job refits it (about 13 s).
- The draft board doesn't use these multipliers: its spreads come from Basketball Monster's
  preseason projections, a different model.
- Still open: team-level REB runs slightly over-projected (z bias −0.22), a target for the Phase 3
  models. 908 player-weeks in 2025-26 came from players the baseline gave no chance of playing
  (returning from injury). In season, overrides set that chance.

**Weekly matchup engine (2026-10-05).** `matchup.py` and `GET /season/week/probability`.
- Counted games: each remaining day, both lineups go through the daily assigner (10 active slots).
  Only starters with a game count. The opponent is assumed to set its best lineup.
- Week total = Yahoo's week-to-date totals + the projected remaining days. matchup.csv gives
  FG%/FT% only as ratios, so attempts so far come from box scores of each roster's active
  players, and makes = Yahoo % × those attempts. That's labeled as an estimate.
- **Categories are drawn together.** A backtest on 2025-26 (5,000 random 10-v-10 weeks, fitted on
  earlier seasons) showed category win probabilities were honest (calibration error 1.2 points),
  but week win probabilities were overconfident under the independent-categories formula
  (predicted 85% → 78% actual; calibration error 3.5 points). The residual correlation between
  categories is now fitted on the training seasons (`sim_correlation`; PTS–3PTM 0.69,
  PTS–REB 0.55, TO against volume −0.41). P(win week) uses correlated draws. Calibration error
  drops to 2.1 points (predicted 85% → 82%), and the Brier score improves from 0.1982 to 0.1967.
- The do-nothing path: P(win week) at each day's end, averaged over 2,000 simulated weeks, with
  the 10th–90th percentile as the band. It stays near today's value and widens toward Sunday.
- Fixed along the way: the daily assigner only started a player in a slot named in his Yahoo
  eligibility, so a "PG" never filled G (or an "SF" never filled F). It now expands positions to
  their combo slots and Util, using `draft.position_eligibility`.
- Response time is about 320 ms on a 5-day week, mostly the 10 daily lineup solves.
