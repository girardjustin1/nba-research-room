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

**Add/drop optimizer (2026-10-05).** `optimizer.py`, `moves_api.py`, `GET /season/moves`,
`POST /season/scenario`, and the With moves line in `/season/week/probability`.
- Weekly MILP, linearized at the matchup. Each category's weight is dP(win week)/d(my total) =
  P(the category is pivotal) × the slope of its win chance. The plan is then scored exactly by
  the matchup engine, re-weighted at the plan and re-solved, up to 3 times. The best exact
  P(win week) is kept, and it must beat doing nothing.
- Rules: 12 non-IL roster spots, 10 active slots, eligibility, 4 acquisitions a week, adds count
  from the next day, and each add must be worth at least 0.2 points of P(win week). Free agents
  can be streamed (added, then dropped for another add).
- Free agents come from players.csv (no owner, matched, not ruled out). The 40 most valuable this
  week are considered. Acquisitions used come from an optional `acquisitions_used` column in
  matchup.csv. Without it, 0 is assumed and every move lists that in `confidence.missing`.
- A single move's effect has no uncertainty band yet (lo = hi = the expected change). That's
  labeled too.
- On a full-size synthetic week (12 v 12, 60 free agents), it solves in about 2 s. The plan is
  cached so the Matchup and Moves screens share one solve.
- Not yet validated on real past weeks (did the plans win more often?). That's the backtest
  harness.

**Backtest harness (2026-10-05).** `backtest.py`, `make backtest` (about 4 min), results in
`backtest_results`. It replays 2025-26 from the second Monday, 20 weeks × 4 sampled head-to-heads,
in a simulated 14-team league (snake draft on first-week value, 12 per team, everyone else a
free agent). Model and calibration are fitted on earlier seasons. Projections are made the live
way: each player's Monday state onto every game his team plays that week.
- **A leak, found and fixed.** The first version projected only games a player later appeared in,
  so the optimizer "knew" injuries in advance. It reported predicted 80–100% winning 95% of the
  time and plans winning 99%. Fixed and tested (`test_week_projections_..._ignore_the_future`).
- **Results (80 team-weeks).** Do-nothing predictions have a Brier score of 0.200. The middle is
  honest (predicted 50% → 44%), but the top end is overconfident: predicted 93% won 76% (21
  weeks). Likely cause: the variance calibration is fitted on game rows that exist only when a
  player was available, so unexpected absences aren't in it. Next: fit it the live way.
- **Following the plan.** Win rate 48% → 90% (+43 pts, 80% bootstrap range +35 to +50), +1.9
  categories a week. The predicted lift (+41 pts) matches. This is against an opponent who never
  streams, so it's a ceiling, not the expected gain against active managers.
- Also approximate: BallDontLie positions (G/F/C) mapped to Yahoo eligibility; one plan per week
  (Monday); plans don't carry between weeks.

**Calibration fitted the live way (2026-10-05).** `calibration.live_player_weeks`: each player's
Monday state (vectorized `monday_states`, tested equal to the dummy-row method) projected onto
every game his team plays that week, with missed games counting 0. The old fit used only games
players appeared in, so surprise absences were left out of the spread.
- New multipliers (train 2023-24 + 2024-25): PTS 2.00 (was 1.25), REB 1.90, AST 1.69, TO 1.51,
  3PTM 1.49, FT% 1.45, STL 1.30, BLK 1.26, FG% 1.19. Calibrated team-week coverage on 2025-26 is
  78–82% in every category. Still about 12 s nightly.
- Do-nothing check on all 140 matchups of the 20 replayed weeks: Brier 0.180, honest up to 90%
  (predicted 85% → 88%, 75% → 71%). Only the extreme top still runs hot (95% → 81%, 21 weeks).
- What remains is a bias in the means, not the spread: 4.75 expected categories against 4.51 won,
  with favorites slightly overrated. Rosters drafted on projections pick the players whose noisy
  projections ran high (the winner's curse), and the real draft board does the same. The fix is to
  shrink noisy per-minute rates toward the league average by reliability. That's a Phase 3 model
  change, judged on this same backtest.
- Backtest with the new calibration (80 sampled team-weeks): plans 48% → 91% weekly win rate
  (+44 pts, 80% range +36 to +51) against a non-streaming opponent; the predicted lift is +39.

**Shrinking noisy projections: tested, not adopted (2026-10-05).** All judged on 2025-26 out of
sample. Every variant was fitted on 2023-24 and 2024-25, then checked on next-game error and on all
140 head-to-heads of the 20 replayed weeks, with weeks scored by Yahoo's rule (more categories wins;
ties counted).

| Variant | Finding | Week Brier |
|---|---|---|
| Current engine | — | **0.1795** |
| Per-minute rate shrinkage toward the league mean (empirical Bayes, strength fitted per stat) | fitted strengths are small (about 60 minutes, two games); next-game RMSE −0.05%, MAE +0.4% | no change |
| Minutes recalibration (actual = 1.29 + 0.89 × projected, fitted the live way) | removes the stars' minutes bias (top 30: 0.93× → 1.00×) but the middle of the week odds got worse | 0.1876 |
| Edge tempering (actual vs projected team difference, slope 0.64–0.89 per category) | tested in a scratch script only | 0.1799 |

- Where the bias really is: per-minute rates are unbiased (actual/projected 1.00–1.03 at every
  rank). Minutes are where it sits: the top 30 projected players get 7% fewer than projected,
  fringe players 16% more.
- None of these improve the weekly odds, so no prediction changes. Rate shrinkage
  (`baseline.shrinkage`) and minutes recalibration (`baseline.minutes_recalibration`) stay as
  switches, off, with tests. Phase 3 models are compared against them on this same check.
- Still open: the most lopsided weeks (93–95% predicted won about 81%, about 20 weeks). Part of it
  may be the backtest itself. It sets lineups on Monday and never swaps in a bench player for a
  starter who sits, which a real manager does.
- Refactor: Monday states and live-way projection rows now live in `features.py`
  (`monday_states`, `live_rows`), and the season schedule loader in `schedule.py`.

**Backtest realism (2026-10-05).** Two changes to how the backtest scores what happened:
- **Yahoo's one-win rule:** the team with more categories wins the week, and tied weeks count as
  ties (0.5). The earlier runs required 5+ categories.
- **Daily lineups react:** each day's lineup is set from the players who actually suited up, the
  way a manager uses the injury report before lock. Before, Monday's lineups were kept, and a
  starter who sat left his slot empty. Predictions are still made Monday, as before.

All 7 matchups a week, 20 weeks (140 team-weeks, about 8 min):
- Do-nothing Brier **0.168** (was 0.180). Honest through the 80s: predicted 31% → 33% won,
  *(Superseded in part by "Codex audit, part 2" below: re-run after the timing fixes.)*
  50% → 52%, 71% → 69%, 91% → 85% (37 weeks). Only the most lopsided weeks still run hot: 95%
  predicted won 83% (21 weeks).
- Plans: 54% → 94% weekly win rate (+40 pts, 80% range +34 to +45), predicted +37, still against an
  opponent who never streams.
- So part of the top-end overconfidence was the backtest's fixed Monday lineups, not the engine.

**Betting-market ingest (2026-10-05).** `ingest/kalshi.py`, `ingest/rundown.py`,
`ingest/market_common.py`, `make markets`, plus a nightly step. Checked against both live APIs
first:
- **Kalshi** (public, no key). Prices are dollar strings (`yes_bid_dollars`, `yes_ask_dollars`),
  volume is `volume_fp`. A prop rung is "Player: 30+ points" with `floor_strike` 29.5. Event
  tickers are SERIES-YYMONDD + away + home. Settled markets move to `/historical/markets`, and
  hourly prices of past markets are kept at `/historical/markets/{ticker}/candlesticks`, so past
  pre-tip ladders can be recovered later for Phase 3. No props are listed in preseason; game
  markets are.
- **TheRundown** (key in .env). The free tier is 500M data points a month at 10 requests/s. NBA
  props are already listed for opening night: points, rebounds, assists, threes, blocks (steals
  and turnovers as books post them). About 25 books, including Pinnacle, DraftKings and FanDuel.
- **Storage.** Props go into the existing `props_ladder` (new columns: bid, ask, open_interest,
  market_ref). Game lines go into `odds` next to BallDontLie's (vendor `kalshi` / `rundown:<book>`).
  Each row is tied to a BallDontLie game by league date and teams. Player names go through the
  shared resolver: an unmatched name is quarantined and its row skipped.
- **Liquidity.** A Kalshi rung thinner than 100 contracts or wider than 10¢ keeps its quotes but
  gets no probability (missing, not guessed). Sportsbook sides are de-vigged within their pair; a
  side without its pair keeps its price but gets no probability.
- `implied_ladder(player, stat, game)` returns the latest liquid ladder as P(stat > threshold),
  forced never to rise with the threshold. Feeding it into the simulator is Phase 3 work, as the
  build prompt says (Kalshi distributions where liquid, normal otherwise).
- A market outage is recorded in `ingest_runs` and shown by the Jobs and Markets health checks,
  but never stops the nightly run.

## Phase 3 — started 2026-10-05 (early, owner's call)

**First challenger: LightGBM corrections (`projections/lgbm.py`). Not adopted.** Same structure
as the baseline (P(plays) × minutes × per-minute rate, same variance and overrides), with
gradient-boosted corrections to minutes when playing and to each per-minute rate. Its features
are the player's own history plus home/away (`features.STATE_COLUMNS`, the same columns in live,
calibration and backtest). Its variance is fitted on out-of-fold predictions, one season held out
at a time. Fitted on 2023-24 and 2024-25, scored on 2025-26:
- Games played: average error 0.4–2.4% worse than the baseline in 10 of 11 stats; squared error
  about even (−0.1% to +0.5%).
- Every scheduled game (missed = 0): the same picture, minutes +0.6% average error.
- Ablation: minutes correction alone, rates alone, or heavier regularization all land within
  ±0.7% of the baseline.
- Conclusion: projections built only from a player's own history are at their limit; the
  baseline's tuned moving averages already extract it. Gains will need information the baseline
  doesn't have: opponent pace and defense, rest and back-to-backs, teammates out (injury
  report), and betting lines (archived nightly from now on, `ingest/kalshi.py`,
  `ingest/rundown.py`). That's the next experiment.
- `settings.models.driver` chooses the nightly model (`baseline` stays); a challenger is switched
  on only after it wins on the scoreboard and the 140-matchup backtest.
- Plumbing: the state columns are defined once (`features.STATE_COLUMNS`), and the schedules carry
  home/away.

**Game-context model (2026-10-05). Not adopted.** `features.game_context` adds the next game's
context to projection rows: rest days and back-to-back from the schedule, and the opponent's pace
and defense over its previous 10 games. Only games tipped before the cutoff count (the projection
time: Monday in the backtests, tonight in the nightly run). It's tested against its definition and
its cutoff, and it matches the feature table (opponent pace 100%, rest 99.2%: team versus player
rest).
- `LgbmContextModel` (the LightGBM corrections plus these four features), every scheduled game of
  2025-26: average error 0.6–2.9% worse than the baseline, squared error within ±0.6%. The same as
  without context.
- A transparent check: scale the baseline by (opponent pace / league)^a × (opponent defense /
  league)^b, with a and b fitted on 2024-25. The fitted strengths point the expected way (0.5–1
  for points, rebounds, assists), but the 2025-26 change is −0.03% to +0.01%.
- Conclusion: opponent and rest effects are real in direction but too small against single-game
  noise to measure here. The baseline keeps driving. Two information sources remain untested:
  same-day teammates out (from the injury report) and betting lines. Kalshi keeps hourly
  candlesticks of past prop markets (`/historical/markets/{ticker}/candlesticks`), so last
  season's pre-tip ladders can be backfilled to test whether props beat the baseline before this
  season's archive builds up.

**Do betting markets beat the baseline? Yes, clearly, where a liquid prop exists (2026-10-05).**
*(Caveat from the Codex audit, F17: see "Codex audit, part 2" below.)*
Last season's pre-tip Kalshi prices were backfilled for 40 randomly sampled regular-season games:
points, rebounds, assists and threes; 2,448 rungs. Each rung's price is the last hourly
candlestick before tip, from `/historical/markets/{ticker}/candlesticks`, kept only when liquid
(the live rule: both quotes, spread ≤ 10¢). Each rung is a yes/no question ("did he score 25+?"):
the market's mid against the baseline's P(plays) × P(stat > line | plays), from its pre-game mean
and over-dispersed spread, fitted on 2023-24 and 2024-25.
- 1,265 rungs scored (24 games: 68% of rungs liquid pre-tip, 68% of Kalshi names matched).
- Brier: market 0.164, baseline 0.179, 50/50 blend 0.169. Log loss: 0.498, 0.538, 0.511. Market
  minus baseline, 80% range over games by bootstrap: −0.021 to −0.010.
- By stat (Brier, market vs baseline): points 0.169 vs 0.197, rebounds 0.157 vs 0.170, assists
  0.175 vs 0.190, threes 0.155 vs 0.153 (even).
- Calibration: the market is close to honest (80% priced → 83% happened). The baseline is too
  timid at the top (69% where 83% happened), consistent with it not seeing same-day injury and
  lineup news.
- Decision: where a liquid ladder exists for a player-game, the market should lead that game's
  projection; the blend is worse than the market alone. Props post mostly on game day, so this
  sharpens today's lineup and the current matchup day, not the rest of the week. To do before
  relying on it: work out why only 68% of Kalshi names matched (TheRundown matched 100%), then
  build market-informed projections and judge them on the same test.
- The scripts were scratch research; the method is above.

**Market-informed projections, switched on (2026-10-05).** `projections/market.py`, applied in
the nightly run after the markets step.
- Kalshi name fix first: prop titles come in two formats ("Name: 30+ points" and "Name records 25+
  points"). The parser read only the first, so the live archive would have silently skipped every
  older-format market. `kalshi.player_from_title` reads both; two nickname aliases (Nic Claxton,
  Alex Sarr) were added. Kalshi names now match 106 of 106, and the props test re-run on all 40
  games (1,665 rungs) holds: Brier market 0.164 vs baseline 0.179 (80% range of the difference
  −0.019 to −0.010).
- Market means against actual stats (same 40 games, 462 player-game-stats with a liquid ladder,
  median 4 rungs): RMSE points 7.75 vs 8.84, rebounds 2.96 vs 3.12, assists 2.48 vs 2.65, threes
  1.37 vs 1.38 (tie). The baseline under-projects points for these players by 3.0 a game (the
  market by 0.9). The game-resampled range of the squared-error difference is clear of zero.
- Method: each source's latest snapshot, at most 30 h old; the median across sources and books
  per threshold; a probit-line normal fit (sd kept within 0.5–2× the baseline's; one line keeps
  the baseline's sd; a ladder that doesn't get harder is ignored). Only points, rebounds and
  assists are overlaid (`markets.overlay.stats`): threes tied, and steals, blocks and turnovers
  are untested. Makes and attempts (FG%/FT%) stay the baseline's.
- Props post mostly on game day, so this sharpens today's lineup and the current matchup day. The
  rest of the week stays on the baseline.

**X news feed and the pre-game job (2026-10-05).** `ingest/x_feed.py`, `pipeline.run_pregame`,
`make pregame` / `make pregame-schedule`.
- Handles verified with X's users-by-username lookup (2 requests): 122 of 131 exist and now carry
  their stable X `user_id`. 9 failed (8 not found, including `Underdog__NBA`, which settles that
  duplicate for `UnderdogNBA`; 1 restricted). They stay in the file, as the owner asked, but are
  skipped.
- Reading: game days only. League, insider and aggregator accounts always; official and beat
  accounts only for teams playing today. The app-only token can't create the private X list the
  account file planned (that would be an action on the owner's account), so handles are batched
  into `from:` recent-search queries within X's 512-character limit. Each query reads only posts
  newer than its last read. The 300 posts/day budget is hard: no search once fewer than 10 reads
  remain, because X returns at least 10.
- Parsing: posts with availability words go to Claude Haiku 4.5 in one forced-tool call per batch,
  into the overrides' own vocabulary (Out … Available) plus minutes cap, starting and confidence.
  Raw text is never stored. Authority: official 1, insider 2, beat 3, aggregator 4; unmatched
  names are quarantined. The live check (one invented post, one 10-post search of @NBA) passed.
- `run_pregame`: X news → BallDontLie injuries → markets → today's projections (the nightly
  projection step, now shared as `refresh_projections`) → a matchup snapshot marked as news. Each
  feed failing is recorded and the refresh goes on. `make pregame-schedule` polls every 15 minutes
  in the 3 hours before each game day's first tip.
- Robustness: read-only connections don't create tables added since the last write, so the health
  screen's table counts now treat a missing new table as empty instead of failing.

**Explanations (2026-10-05).** `projections/explain.py`, `GET /season/players/{id}`.
- The build prompt planned SHAP waterfalls for tree models, but no tree model won (the challengers
  lost to the baseline), so SHAP would explain a model that isn't used. The driving projection is
  multiplicative, so it is explained exactly instead: his season average per game → chance of
  playing → minutes when playing → per-minute production → betting market (when it set the
  number). Each step is the change it makes, and the steps add up to the stored projection
  (tested).
- To make that possible the nightly run now stores, next to each projection, P(plays), expected
  minutes, the model's mean before the market overlay, and whether the market set it.
- Factors shown are only the ones the engine uses: projection (next game and the rest of the
  week), minutes, news (X posts and the injury report, with source and authority), market (lines,
  implied mean vs ours, agreement), drivers (the waterfall) and, once the week's inputs exist,
  schedule (games, open slots, would start). Opponent, Vegas and teammate factors are left out
  (tested and not used), not invented.
- Recommendation: from the week's plan when it exists (start days for a roster player, add or drop
  with the move id, else not in the plan). Before the season it says there's no advice yet and
  why, with low confidence. An unknown player is a 404.
- Example (real data, top projected scorer for opening week): 33.5-point average → 28.4
  projection, mostly from an 83% chance of playing (−5.7); minutes +0.1, per-minute +0.6.

**Market vs news: props are lines if he plays (2026-10-05).** A bug in the market overlay, fixed
before game days. The overlay replaced the whole projection with the market's mean, ignoring
P(plays) and when the news arrived. A player ruled out on X after the props were priced went from
0 back to a full market projection, and a Questionable player lost his 50% discount.
- Props are conditional on playing: Kalshi's rules settle a prop at a fair price when the player
  is inactive or never takes the court (rules text read from the live API), and sportsbooks void
  it. So the ladder is fitted against the baseline's line if he plays, and the projection is
  P(plays) × the market's line, with the variance of the same mixture the baseline uses. P(plays)
  = 0 keeps the model's zero. This matches how the props test compared the two (DECISIONS above:
  the baseline as P(plays) × P(stat > line | plays)).
- News time: a source's ladder counts only if it was priced (quote time, else read time) after the
  latest news limiting the player: a minutes cap, or any status except plain Available / Out
  (those change P(plays) only, which the conditional line already handles). Older sources are
  dropped; with none left the model's number stands, flagged `market_stale` (counted in the run
  report). A manual override always counts as newer.
- The injury report's news time was the snapshot time, so every re-listing looked like fresh
  news. It is now the first snapshot of the player's unbroken run in his current status.
- Explanations compare the market and the model on the same if-he-plays basis, and say when a
  price predates the news or the player isn't expected to play.
- Not checked on live data: the store has no archived prop prices yet (`make markets` hasn't run
  against it). Covered by tests: the round trip, P(plays) scaling, Out after the price, a stale
  source dropped while a newer one counts, a minutes cap, and the injury news time.

**Teammates out: switched on (2026-10-05).** `teammates.py`, applied inside the baseline's
*(Superseded in part by "Codex audit, part 2" below.)*
`predict`, so live, calibration, backtest and scoreboard projections all get it.
- Measure, per player-game: teammates' missing minutes (rotation teammates, EWMA ≥ 12 min, × P(they
  sit)) and their missing share of each stat, minus what the player is used to (an EWMA over his
  own previous games). His moving averages already reflect a long absence, so only the change is
  news; a teammate returning gives a negative change. In history P(sit) is what happened; live it
  is 1 − P(plays) after the overrides.
- Box scores, 2025-26 against the baseline (fitted on 2023-24 and 2024-25), with who sat known:
  when 30+ more teammate minutes are missing than he's used to, bench players play +6.7 minutes,
  rotation players +3.1, starters about +0.3 (near their ceiling); returns reverse it (−3.5). The
  same in the training seasons.
- Fit: minutes when playing += change × (c0 + c1·m + c2·m²/48); per-minute rate × (1 + b × change
  in missing share), per stat (points 0.37, assists 0.35, rebounds 0.04; steals and blocks
  slightly negative). Stats follow the adjusted minutes.
- What it is worth depends on knowing who sits. RMSE change on 2025-26 played games, if he plays:

  | | no news | 5 PM injury report | report + "not listed" | who sat (hindsight) |
  |---|---|---|---|---|
  | minutes | −0.0% | −2.0% | −4.4% | −7.1% |
  | points | −0.1% | −0.6% | −1.6% | −2.4% |
  | rebounds | +0.1% | −0.3% | −1.0% | −1.8% |
  | assists | +0.1% | −0.3% | −1.1% | −1.6% |
  | FGA | −0.3% | −1.2% | −3.3% | −4.7% |

  "Not listed" treats a rotation player missing from the report as likely to play, by his recent
  play rate: fitted on 2024-25 only (98.3% above 0.95, 96.5% for 0.8-0.95, 89% for 0.6-0.8, 77%
  for 0.3-0.6, 47% at 0.3 or less) and scored on 2025-26. Earlier challengers moved points by
  ±0.5%.
- Backtest (140 team-weeks, Monday projections, so no game-day news): weekly-odds Brier 0.175 on
  vs 0.168 off, but the projections change the simulated draft, so the two runs are different
  leagues (the same do-nothing result in 55% of matchups). Paired by matchup, the difference's 80%
  range is −0.029 to +0.037: no measurable change, as expected without news. Switched on because
  it is neutral without news and clearly better with it.
- The injury reports: the NBA's official PDFs (`ak-static.cms.nba.com/referee/injury/`, named
  `..._05PM.pdf` until late December 2025 and `..._05_00PM.pdf` since), the 5 PM report for each
  2024-25 and 2025-26 game day plus the noon report for early tips, 45,643 rows, 98.8% of
  2025-26's NBA (not G League) rows matched to players (suffixes like "ButlerIII" stripped). 80%
  of rotation players who sat were listed. The research scripts were scratch; the method is here.
- Status calibration from the same reports (how often the player played), 2024-25 / 2025-26:
  Out 0.3% / 0.1%, Doubtful 2.3% of 266 / 1.4% of 366, Questionable 47% of 1,982 / 51% of 1,630,
  Probable 91% of 729 / 92% of 575. `status_play_prob` now uses the pooled rates: Doubtful 0.02
  (was an assumed 0.25), Questionable 0.49, Probable 0.91. "Available" played about 81%, mostly
  two-way and G League listings, so it stays 1.0 for X posts.
- Next: read the official report live (the X feed and BallDontLie's list give part of it), which
  is what the "report + not listed" column needs.

**The NBA's official injury report, read live (2026-10-05).** `ingest/nba_injury_report.py`, in the
pre-game and nightly runs.
- Each run reads the newest published report (trying each 15-minute slot back 3 hours, in both
  file-name formats) and stores it once: listed players with status and reason
  (`nba_report_rows`), and each team-game with whether the team has filed (`nba_report_teams`).
  The text is read with pdfplumber at a tight character gap (x_tolerance 1.5); at the default,
  names lose their spaces. New dependency: pdfplumber 0.11.10 (pure Python, plus pypdfium2).
- On two real reports the production parser matched 99–100% of NBA (not G League) names through
  the shared resolver and found every team-game, including teams not yet filed. Unmatched names
  are quarantined as usual.
- Overrides: listed statuses at the calibrated P(plays), with the news time the first report that
  showed that status. Authority: manual > team accounts > insiders > NBA report > beat writers >
  aggregators > BallDontLie, so an insider's later post (a late scratch) still wins, and the
  report beats BallDontLie's list.
- Not listed: for a team that has filed, every other player gets a "Not Listed" row. It outranks
  BallDontLie (a stale "out" for a player the league no longer lists) and, for a rotation player,
  becomes P(plays) from his recent play rate (settings.overrides.unlisted, fitted on 2024-25).
  Bench players keep the model's own P(plays). It never stales a betting line (it changes
  P(plays) only), and the explanation screen leaves it out of the news list.
- Read-only connections on a store written before this change have no report tables; the report
  then reads as absent instead of failing (`store.has_table`).
- Not yet checked live: no report has been published in the preseason (none in the 3 hours before
  12:40 ET today). The health screen's check for it starts with the regular season.

**News backtest: game-day news makes the weekly odds more honest (2026-10-05).**
*(Superseded in part by "Codex audit, part 2" below.)*
`backtest_news.py`, `make report-backfill SEASONS="2025"` then `make backtest-news`.
- 2025-26's NBA injury reports are stored with the production reader (`jobs/nba_report_backfill.py`:
  the noon report on early-tip days, then the 5 PM one; 218 reports, 21,633 player rows, every
  game day, no errors, names resolved without filling the review queue). At 5 PM, 35% of
  team-games had not filed yet, so "not listed" applies to fewer teams here than live, where the
  pre-game job polls every 15 minutes until tip. Each game uses the latest report at least 30
  minutes before its tip; "not listed" uses that season's rosters (the players table only knows
  today's teams).
- Same simulated league and matchups as the weekly backtest (140 team-weeks), five versions:
  Monday-only projections, re-projected daily without news, daily with the report and teammates
  out, the same without teammates out, and hindsight lineups. P(win week) is scored at the start
  of every day from that version's real totals so far plus its projections for the rest.
- Weekly-odds Brier, pooled over the days of the week: Monday-only 0.1108, daily 0.1084, daily
  with news 0.1063 (paired difference to Monday-only −0.0045, 80% range −0.0089 to −0.0002); at
  the start of the week 0.1548, 0.1556, 0.1513. With news it beats Monday-only on every day,
  and beats daily-without-news on every day but the last (0.0536 vs 0.0530).
  Teammates out, same news, on minus off: −0.0011 pooled (better in 90% of resamples) and
  −0.0025 at the start of the week (97%). Small but consistent; both stay on.
- Lineups barely matter in this league: every version's lineups gave the same weekly result in
  98.6% of matchups (12 players for 10 active slots leaves few start/sit choices). Both sides use
  the same version, so lineup gains would cancel anyway; the summary reports how often a
  version changed the result instead of a win rate. Game-day news pays off in the odds and in
  adds and drops, which this replay leaves out (rosters as drafted). A news-aware replay of the
  optimizer's streaming adds is the open test.

**Multi-day news, and teammates out in "Why this number" (2026-10-05).**
- The X reader now records a stated time frame, in days from the post ("2-3 weeks" → 14 and 21,
  "re-evaluated in two weeks" → 14), and never infers one; "Out For Season" is a status. Live
  check on three invented posts: 14–21, none for "out tonight", 14–14 for "re-evaluated in two
  weeks".
- Overrides carry it: P(plays) 0 through the fewest days, then rising in equal steps through the
  most days, then the model's own rate; at most `overrides.max_carry_days` (60). Out For Season
  runs to the end of the window.
- Which news wins on a date: same-day news first. Rows carried from an earlier day (an X
  time frame on later days, BallDontLie's daily list) yield to any same-day row (an X post that
  day, the NBA report, a manual entry), then authority, then recency. Newer same-day news that
  says he's likely to play (not listed on a filed report, or P(plays) ≥ 0.5) ends an older
  carried absence from that date on; a newer "out" keeps it. One existing test changed with this:
  a team's "probable" on Oct 21 now ends BallDontLie's Oct 19 "out until Oct 30" instead of
  letting it resume the next day.
- Every projection now stores the factor teammates out applied to it (`projections.teammates`),
  and "Why this number" shows it as its own step ("+2.9 min, +8% per minute; out: …", naming
  teammates the overrides rule out that day). His own minutes and rate steps exclude it, and the
  steps still add up exactly (tested).

**Add/drop replay with game-day news: re-planning each morning doesn't help (2026-10-05).**
*(Superseded in part by "Codex audit, part 2" below.)*
`backtest_news.run_moves`, `make backtest-news ARGS=--moves` (about 30 minutes). Same league and
matchups as the weekly backtest (140 team-weeks); my side streams, the opponent never does; each
day's lineups come from that version's projections that morning.
- Versions: do nothing; the Sunday plan for the week (as the weekly backtest); re-plan each
  morning with that morning's projections and the acquisitions left, making only the moves that
  must be made that day (adds counting from tomorrow); the same with the NBA report and
  teammates out.
- Win rate (a tie scores 0.5) / categories: do nothing 56% / 4.72, Sunday plan 89% / 6.17, daily
  re-plan 86% / 6.13, daily re-plan with news 86% / 6.12. The re-plans changed the week's result
  in only 3 and 4 of 140 weeks, all for the worse (sign test p = 0.25 and 0.12): no evidence of
  a gain, a slight lean against. News against no news: 1 week differs.
- Why little can change here: the Sunday plan already spends about 3.9 of the 4 acquisitions and
  wins 89% of weeks against a non-streaming opponent; most of what news would change (a rostered
  player out) is absorbed by lineups and the plan's own streaming.
- Product consequence: the Moves screen should make the week's plan early and keep it, re-planning
  only when news changes it materially (for example, a rostered player newly out several days),
  rather than reshuffling every morning. Not built yet; the threshold needs a test of its own.
- The replay's two parts (odds by day, add/drop) now share one setup (`_prepare`, `_weeks`), so
  both draw the weekly backtest's matchups.

**Live scoreboard (2026-10-05).** `live_scores.py`, run in the nightly job after the box-score
sync; `make scoreboard-live` prints it (season to date, or `ARGS="--days 7"`).
- Each finished game is graded against the latest projection run stored before its tip (a run
  after tip is never graded); a game he sat counts 0, as projected. Per day and stat: n, MAE,
  RMSE, bias and 80% band coverage for the stored projection (`all`), his line if he plays on
  games he played (`played`), and, on games the betting market set, the market's number and our
  model's own number before it (`market`, `market_model`); plus the Brier score of P(plays).
- News: how often players each source listed with a status that day played (X posts by date, the
  last NBA report before tip, the last BallDontLie list within 36 hours before tip), next to the
  P(plays) assumed for that status. This is the live check of the X reader and of the status
  calibration, with the raw post text never stored.
- Weekly odds: every stored P(win week) snapshot against the week's final result from the latest
  Yahoo matchup file saved after the week ended (Brier over all snapshots and for the first).
- Re-grades the last 3 days each night (stat corrections). A failure is recorded and never stops
  the night. Tested on an invented store; the real store has nothing to grade until opening night
  (`make scoreboard-live` reports that). Not on the System screen yet.

**Codex audit, part 1: live-app fixes (2026-10-05).** An independent review by OpenAI's Codex CLI
(model gpt-6-astra) on a fresh clone of the public repo plus a cleaned copy of the store; report in
`docs/audits/2026-10-05-codex-astra.md`. It reproduced every benchmark headline to rounding, and
found real defects. Each was re-checked against the code; these are fixed, with tests:
- F04: the add/drop planner could return a 13-player roster. A drop made on one day for an add on
  a later day was thrown away when the solution became moves. Drops are now held and paired with
  the next add; every plan is checked against the roster rules before it is scored or returned.
  Codex's real-data check: 0 of 63 solves and 0 of 21 plans invalid (was 4 and 2).
- F05: the planner could re-add a player it had dropped that week, which Yahoo's waivers forbid;
  each free agent is now added at most once a week, and the add/drop replay keeps dropped players
  off the board.
- F18: teammates out gave makes and attempts separate slopes, so free throws made could exceed
  attempts (234 of 40,919 rows, impossible percentages). Makes now move with attempts, keeping the
  shooting percentage; 0 invalid rows.
- F08: a Yahoo file read after a day's first tip counted the whole day as played. A day now counts
  once its last game is final (`simulation.game_final_hours` after the last tip); read during the
  day, only games not yet tipped are projected.
- F07: the do-nothing path drew each category independently, so it could end far from the
  correlated headline (0.96 vs 0.78 in Codex's probe); its daily draws now use the same correlation.
- F06: an exactly tied, already-decided category counted as a loss; the week is now won on more
  categories won than lost, as Yahoo scores it, in all three simulator modes.
- F09: market quotes must have been read by the time asked about and priced within the age limit.
- F10: a filed NBA report without the player now breaks his "news since" run.
- F13, F16 (live scoreboard): the P(plays) Brier now pools as a weighted mean, and grading starts
  from what was projected, counting a projected player with no box score as ungraded.
- F11: the same-game `teammates_out_usage` column is now `y_teammates_out_usage` (an outcome, not a
  feature), with a test that who sits in a game never reaches that game's features.
- Found while setting up the audit: a market-ingest test only passed because it read the real
  TheRundown key from `.env`; the key is now only needed for the real API.
Not yet handled (part 2): the backtest and replay timing (F01-F03), separately drafted leagues
(F12), and how strongly DECISIONS.md states its results (F14, F15, F17).

**Codex audit, part 2: backtest timing, one league, and what the results support (2026-10-05).**
Fixes to how the backtests replay time, then every benchmark re-run (2025-26, 140 team-weeks).
- F03: a player's state as of a moment took his team from his next game, so a trade showed up
  early. His team now comes from his last game before the moment (strictly before). Known and
  small: a player who never plays again keeps a one-game-old state.
- F02: the weekly plan, "made Sunday noon", used states through Monday midnight (Sunday's games).
  It now uses only games before the plan (`backtest.plan_hour_et`, 12).
- F01: the news replay's "start of day" odds and noon re-plans used the 5 PM report. Each day's
  odds, lineups and re-plans are now made at `backtest.decision_hour_et` (5:30 PM Eastern) and
  use only reports published by then (and at least 30 minutes before the game's tip).
- F12: the news replays drafted their own league, not the weekly backtest's (DECISIONS said
  otherwise; that was wrong). They now use the weekly backtest's projections and draft, so all
  three run on the same league and matchups (checked: identical Monday odds).
- Weekly backtest, now (teammates out on): do-nothing Brier 0.187; the 80-100% band predicted 90%
  and won 76% (17 weeks), the 40-60% band 50% and 59%. Plans: 48% -> 88% weekly win rate (+40
  points, 80% range +35 to +45) against a non-streaming opponent. A different league from the
  earlier runs (0.168 / 54% -> 94%), so the change can't be pinned on one fix.
- News replay, same league (Brier pooled over each day's decision time; paired by matchup, with
  95% ranges by matchup and by whole week):
  - Monday-only 0.1483, re-projected daily 0.1386, daily with the NBA report 0.1323.
  - Daily vs Monday-only: -0.0097 (95% -0.016 to -0.004). The report on top of daily: -0.0063
    (95% -0.010 to -0.003). Together: -0.016 (95% -0.025 to -0.008). Clear, and larger than the
    first replay showed: re-projecting each day and reading the report both make the odds better.
  - Teammates out on minus off, same report: +0.0029 (95% -0.002 to +0.011). Not supported either
    way for the weekly odds; the earlier "small, consistent gain" does not survive the fixes. Its
    per-player gains stand (scoreboard, re-scored after F18: minutes -4.4% and points -1.6% with
    the report and "not listed"; -0.0% and -0.1% with no news). It stays on.
  - Status rates fitted on 2024-25 alone (F14) give the same results to four decimals as the
    pooled two-season rates, so that in-sample use made no difference.
- Add/drop replay, same league: do nothing 48%, Sunday plan 88.6%, daily re-plan 89.3%, re-plan
  with the report 89.3%. Re-planning changed 1 and 3 weeks of 140 (1-0 and 2-1): no measurable
  difference either way. The earlier "re-planning slightly hurts" came from the timing and
  roster-validity bugs; there is no case for or against re-planning, so the Moves screen keeps
  re-planning on fresh projections.
- How to read all of this (F14, F15): 2025-26 has been used again and again to choose settings,
  so these are development results, not an untouched test. The bootstrap ranges treat matchups as
  independent; whole-week ranges are close but the same drafted teams recur. Ranges that include
  zero mean "not shown", not "no effect". The first clean test is the 2026-27 season itself, which
  the live scoreboard (`live_scores.py`) records from opening night.
- Market test (F17): the props test scored Kalshi's prices (lines if he plays) against the
  baseline's P(plays) x P(over | plays), so part of the market's edge may come from the baseline
  carrying availability risk the props don't. The market-mean RMSE test (graded on games played)
  isn't affected. To re-test on this season's archive with both sides if-he-plays.

**Are the weekly odds overconfident? No, not measurably (2026-10-06).** After the audit re-run the
2025-26 weekly backtest's 80-100% band won 76% of 17 weeks, so the odds were checked more widely.
- The backtest now records, per matchup and category, P(win), both sides' projected final and sd,
  and the real totals (`backtest_results.cats_detail`), so spreads can be checked offline.
- Two seasons, 24 weeks each, all matchups: 2024-25 (fitted on 2023-24 only) and 2025-26, 168
  team-weeks each.
- Per category the spreads are right or slightly wide, never narrow: realized edge errors in units
  of the forecast sd have a spread of 0.79-1.04 (2024-25) and 0.93-1.00 (2025-26); 1 is exact.
- The two seasons disagree at the top: 2024-25's 80-100% band predicted 90% and won 93% (44
  weeks), 2025-26's 90% and 79% (26). Pooled (336): 11/16%, 31/30%, 50/52%, 71/73%, 90/88%
  (predicted/won). The top-band gap is noise (binomial p = 0.69); the calibration slope is 0.87
  (95% 0.68 to 1.13; 1 = honest).
- A spread correction fitted on 2024-25 (a global factor of 0.96, or per category) didn't help
  2025-26: Brier +0.0004 (95% -0.0005 to +0.0013) and +0.0018. No change made. The live
  scoreboard's weekly-odds Brier is the check to watch this season.

**Yahoo Fantasy API, read only (2026-10-06).** `ingest/yahoo_api.py`; `make yahoo-auth` (once,
in your own terminal), `make yahoo-check`, `make yahoo-pull`. Written and tested on recorded-shape
fakes; the first live `make yahoo-check` is the check against Yahoo.
- `ApiBackend` is a drop-in for the CSV inbox: teams, every team's roster, free agents (with NBA
  team codes from player details), this week's matchup totals (Yahoo's stat ids, now in
  `categories[].yahoo_stat_id`) with acquisitions used, and draft picks. They go through the same
  CSV validation and the same ingest, so nothing downstream changes. The nightly run uses the API
  once signed in and falls back to the CSV inbox if it fails (recorded in ingest_runs).
- Read only by construction: yahoo_fantasy_api can add, drop, move players and trade. Every call
  goes through `ReadOnly`, which lets a fixed list of read methods through and raises
  `YahooWriteBlocked` for anything else (tested, including that no write method is on the list).
- `make yahoo-check` reads the league's own settings and sets them beside settings.yaml: teams,
  draft rounds (non-IL roster spots), keepers, roster slots, categories, weekly acquisitions, draft
  order and my slot, fantasy week dates. Each is match, differs, new (Yahoo has it, settings
  don't yet) or unknown, with the settings.yaml line to change. It edits nothing: confirming the
  open draft facts stays a deliberate change.
- Sign-in: yahoo_oauth's out-of-band flow (the browser shows a code to paste); tokens are saved in
  oauth2.json (gitignored) and refreshed automatically. Only the Yahoo lines of .env are read; no
  secret is exported or printed.
- Found on the way: a blank NBA team code arriving as pandas' NA crashed the shared name resolver
  (`if not abbr` on NA); fixed for both backends.

**Live scoreboard on the System screen (2026-10-06).** `GET /system/scoreboard`
(`system.live_scoreboard`), a "Live" tab between Models and Updates (`#/system/live`, `LiveView`).
- The response holds two windows (the season so far, the last 7 days) of `live_scores.summary`:
  per stat the average miss, lean and 80% band coverage; on market games the market's miss
  against our model's; the P(plays) Brier and its lean; projected player-games with no box score;
  each news source's statuses against how often those players played, beside the P(plays)
  assumed; and the weekly odds' Brier once a week's Yahoo result is in.
- Before opening night it says grading starts after the first games, instead of showing empty
  cards. Sections without data (no market games yet, no finished week) are hidden or say when
  they'll fill in.
- Five System tabs no longer fit at 360 px with MUI's minimum tab width; the tabs now shrink to
  their labels (checked by screenshot at 360 and 390 px).
- Storybook: `App Shell/System/Live Scoreboard` (season, last 7 days, opening week, before the
  season, loading, API down, refresh failed), `App Shell/System/Screen/Live`, and the prototype
  route `Prototype/System Live` (the route sync test covers it). Demo mode serves the mid-season
  sample.

**In-app notifications, wired to the engine (2026-10-08).** The prototype's Notifications inbox
(League bell, `#/league/notifications`, `Notifications/*` stories) now reads real alerts:
`alerts.py`, `GET /season/notifications`, `POST /season/notifications/read`. Phone push was set
aside in favour of the app's own inbox.
- The pre-game job writes injury alerts (one of my players with a game today ruled out,
  doubtful, questionable, day-to-day or minutes-limited; urgent when he's in my lineup before his
  tip and out or doubtful), news (the same for my opponent's players), a lineup-lock reminder (in
  the 3 hours before the first lock, when today's recommended lineup differs from my Yahoo
  lineup) and a game-day note. The nightly run writes add/drop alerts (a move worth at least 2
  pts of P(win week), `alerts.waiver_min_gain`) and a projections-updated note.
- Effect on my week: the change in P(win week) and per-category odds between the matchup
  snapshot before the news refresh and after it (simulate.py), never a number computed in the
  alert. Titles and bodies restate engine values only.
- Each alert's id is a key for what it says (player, day, status), so it is written once. Read
  state is a small file next to the store; the bell shows the unread count (re-read on every
  navigation); demo mode keeps its own read state until reset. (Corrected by the round-2 audit
  fixes below.)
- Waiver claim status (pending, cleared, lost) waits for the Yahoo API's transactions.

**Notifications: round-2 audit fixes (2026-10-08).** Codex (gpt-6-astra) audited the alerts
engine and the bake-off on a clean clone (docs/audits/2026-10-08-codex-astra.md). Fixed:
- B01, B02: the effect on my week was the two latest snapshots of any week and opponent, before
  this run's own snapshot. Now it is this week and this opponent only: the news snapshot this
  refresh saved minus the last snapshot before the refresh started, evaluated after the run's
  snapshot. It is the refresh's total from all its news, and says so ("Not split by player");
  without both snapshots there is no effect shown.
- B03: one alert per status episode (player, day, status, minutes limit, report time), so a real
  change (out, then questionable, then out again) alerts each time; a repeat keeps its time and
  read state but takes the current priority and wording (benched since, say).
- B04: no alert once his game has tipped, or for a postponed or finished game; an urgent or high
  injury or lock alert reads as normal once its deadline has passed.
- B05: a report filed for a team he has since left no longer describes tonight's game. Overrides
  now carry the reporting team (X posts, the NBA report) and the alert is dropped on a mismatch.
- B06: the pre-game schedule polls from 3 hours before the first tip until the last tip, not
  only before the first.
- B07: read state is written under a file lock and replaced atomically; "mark all" never moves
  back; an unreadable file is set aside, not overwritten.
- B08: marking read while a job holds the store saves the mark and returns `unread: null`
  instead of an error.
- B09: the bell re-reads on every navigation and right after "Mark all as read" (it didn't:
  the data hook only reloads on refresh); a failed mark says so on the screen.
- B10 (fixed the same day, after the rest): an X post was dated to the day it was posted, so a
  post about tomorrow's game, or a late-night post about the next game, landed on the wrong day.
  Now each status is tied to a game (`status_events.game_id`, `game_date`, `game_basis`): the
  parser gives the game's date only when the post says it, reading "tomorrow" or "Friday" from
  the post's Eastern time; the code takes his team's game that day after the post (`stated`), or
  else his team's next game after the post (`next_game`). The overrides date the status by that
  game (a stated absence still counts its days from the post); the live scoreboard grades it
  against that game. Rows from before the change keep the post's date.

**Model bake-off: Ridge, CatBoost, hierarchical and the ensemble. None adopted (2026-10-08).**
`make bakeoff` (`jobs/model_bakeoff.py`), `projections/ridge.py`, `projections/catboost_model.py`
(named so it can't shadow the catboost package), `projections/hier.py`, `projections/ensemble.py`.
- Ridge and CatBoost use LightGBM's frame (corrections to minutes and per-minute rates from the
  player's history) with a different learner. Hierarchical pulls each player's per-minute rates
  toward his position group's (G, F, C), strength per stat chosen on the training games. The
  ensemble is the build prompt's inverse-error blend per stat (every member at least 5%), with a
  spread that widens where the members disagree; P(plays) and minutes come from the baseline.
- Nested, the test season touched once (audit F14): members fitted on 2023-24, weights from their
  2024-25 errors; members refitted on 2023-25 and scored once on 2025-26. Scored like the model
  scoreboard (every game with a pre-game state, a sat game counting 0, no game-day news); 95%
  ranges resample whole game days.
- MAE against the baseline, 2025-26 (positive is worse): points LightGBM +2.1%, Ridge +1.3%,
  CatBoost +1.9%, hierarchical +0.3%, ensemble +0.9%. Across minutes, points, rebounds, assists,
  steals, blocks, threes, turnovers, FGA, FTA the ensemble is worse on 9 of 10 (+0.3% to +1.6%,
  every 95% range above zero) and better only on turnovers (−0.26%, 95% −0.41% to −0.12%).
  Hierarchical is about even (−0.2% to +0.8%). Ensemble 80% band coverage 0.83-0.91: too wide.
- Why the blend can't help: the members' errors are so close in size that inverse-error weights
  come out near 0.20 each, diluting the baseline with four weaker, correlated models. (Superseded
  by the round-2 audit re-run below: that claim was too broad, and the challengers were handicapped.)
- Consistent with the LightGBM and context findings: projections from a player's own history are
  at their limit; the gains came from new information (teammates out, the injury report,
  markets). The baseline stays the driver; the ensemble is not gated on. The code stays as the
  experiment record and for re-running each season.

**Ensemble vs baseline on the weekly odds: the rule, written before the run (2026-10-08).**
`make ensemble-replay` (`jobs/ensemble_replay.py`) replays 2025-26 week by week twice
(backtest.py): once driven by the baseline, once by the ensemble (members fitted on 2023-25,
weights nested inside those seasons: fitted on 2023-24, weighted on 2024-25). Same simulated
league (drafted on the baseline), same sampled team-weeks, each model with a simulator calibration
fitted on its own projections. The ensemble replaces the baseline as the driver only if all hold:
1. Primary: its weekly win-odds Brier score (doing nothing; a tied week counts 0.5) is lower than
   the baseline's on the same team-weeks, and the 95% range of the difference (resampling whole
   weeks, 2,000 draws) lies entirely below zero.
2. Guard: the realized win rate following its plans is not worse: the 95% range of (ensemble
   plan win rate − baseline plan win rate) does not lie entirely below zero.
3. Guard: no predicted makes above attempts in the bake-off's test season.
Anything else, including a lower Brier whose range crosses zero, keeps the baseline. The result
is recorded below whichever way it goes.

Result (run 2026-10-08, after the rule's commit f14f7c9): **keep the baseline.** 140 team-weeks
over 20 weeks, paired. Brier doing nothing: baseline 0.1867, ensemble 0.1865, difference −0.0001
(95% −0.0042 to +0.0036): the primary condition is not met. Win rate following the plans:
baseline 0.882, ensemble 0.900, difference +0.018 (95% −0.007 to +0.043): the guard is met.
Makes within attempts: met (zero rows for every model). Reading: on the weekly odds the two are
indistinguishable at this sample size; the ensemble's plan edge is suggestive, not shown. The
replay can tell apart differences of about ±0.004 in Brier; the bake-off's 0.2-0.5% RMSE gains
are far smaller than that once they pass through a week of nine categories. Cost also counts
against it: the ensemble replay took 689 s to the baseline's 478 s, and nightly fitting goes
from seconds to about 3 minutes. Revisit with this season's own games (the scoreboard and the
live backtest) if the plan edge holds up.

**Model bake-off: round-2 audit fixes and the re-run (2026-10-08).** The audit
(docs/audits/2026-10-08-codex-astra.md) found the challengers handicapped and the conclusion
too broad. Fixed: A01, LightGBM, Ridge and CatBoost fitted teammates-out on games played only
(no teammate ever missing), so their adjustment was broken; it is now fitted on every game, as
the baseline's. A03, corrected rates kept makes within attempts (LightGBM had FTM above FTA in
712 rows). A04-A06, the ensemble's weight floor, perfect members, missing numbers and expected
minutes. Also found here: the baseline itself put threes above field goals made in 22 of 40,919
rows; capped. A07 is documented, not fixed: the hierarchical model groups players by today's
listed position for every season (no dated position history exists).
Re-run, 2025-26 test, change vs the baseline (negative is better):
- Ensemble MAE: rebounds −0.22% (95% −0.34 to −0.10), steals −0.20% (−0.34 to −0.06),
  turnovers −0.93% (−1.07 to −0.79); worse on points +0.15% (+0.03 to +0.27), blocks +0.76%,
  threes +0.60%; minutes, assists, FGA, FTA within ±0.1% with ranges across zero.
- Ensemble RMSE: better on all ten stats, −0.12% (assists) to −0.49% (minutes). Ridge alone is
  better on RMSE for eight of ten.
- Weights are still near 0.20 each: the inverse-error rule cannot tell the members apart.
Restated conclusion (A02): this inverse-error blend does not justify replacing the baseline
under MAE, the criterion chosen beforehand; it does lower large misses slightly on every stat,
so "blending can't help" was wrong. A blend with weights optimized on validation errors (allowed
to drop members) is the better-specified test and is not built. The deciding question, whether
it moves the weekly odds, is answered above: not measurably.

**In-season scorecard and the forward tests: the rules, written before opening night
(2026-10-08).** Written now so that what counts as working, and what each test needs to change
anything, is fixed before any 2026-27 game is played.
- `scorecard.py` grades the live scoreboard season to date every night (also at the end of
  `make scoreboard-live`). Each check reads ok, watch, act or not enough yet; an act raises one
  high alert a day in the app, linking to System → Live. An action says what to look at first.
  Nothing changes a model or a setting by itself. Thresholds are in `settings.scorecard`.
- References: the baseline on 2025-26 with no game-day news (`make bakeoff`). Live projections
  have the news, so they should do at least as well; doing worse means something broke.
  - Average miss per stat: watch at 5% above the reference, act at 10%.
  - Lean (projected minus actual) per stat, as a share of the reference miss: watch at 10%, act
    at 20%. The preseason finding that the top players were projected about 7% too many minutes
    would read watch.
  - 80% band coverage per stat against its own reference (small whole-number stats sit above
    0.80 by construction): watch at 0.04 off, act at 0.07.
  - P(plays): mean P(plays) minus the share who played, watch at 0.03, act at 0.05.
  - News: per source and status, after 30 listings, the share who played against the P(plays)
    assumed for that status: watch at 0.10 off, act at 0.15.
  - None of these is graded before 2,000 player-games per stat (about four game nights).
  - Weekly odds: my matchup gives one result a week, so nothing is graded before 15 weeks (the
    backtest's 140 team-weeks could tell apart about ±0.004 in Brier; 15 weeks of one team only
    about ±0.1). Then watch above 0.22, act at 0.25, a coin flip (the backtest's was 0.187).
- Checkpoints: Monday reviews of `make scoreboard-live`; week 3 (Nov 2-8), the first full review;
  week 6 (Nov 23-29), the Phase 2 exit: the weekly backtest replayed on this season's weeks 1-6.
  It passes when the do-nothing Brier is at most 0.22 and the plans' win-rate lift over doing
  nothing has an 80% range above zero.
- The ensemble runs in the shadow from opening night (`settings.models.shadow`, `shadow.py`): it
  projects in every nightly and pre-game run with the baseline's inputs and run time, and drives
  nothing; `make shadow-report` compares the two game by game. On Dec 14 (Phase 3's window) it
  earns a second deciding replay (this season's weeks 1-8, driven by each, under the rule above)
  only if, on live games, its RMSE is lower on at least 8 of the 10 stats and its average miss is
  not worse (95% range entirely above zero) on any of points, rebounds, assists, steals, blocks,
  threes or turnovers. Otherwise it stays in the shadow until the All-Star break.
- X forward test, mid-November, once there are 3 weeks and at least 150 X statuses tied to a
  game: replay this season's game days from the stored inputs twice, with and without X statuses
  in the overrides (the NBA report and BallDontLie only), paired by player-game. Primary: the
  P(plays) Brier on player-games where X gave a status is lower with X, 95% range (resampling
  days) below zero. Guard: the points average miss is not worse. Pass: X keeps its place. Primary
  not met: X drops below the NBA injury report in the authority order. Worse with X (range above
  zero): X is switched off until fixed. The replay is not built yet; the parser test from the
  round-3 audit (docs/audits) is read alongside it.

**X forward test: the replay is built (2026-10-09).** `make x-forward-test`
(`jobs/x_forward_test.py`, `backtest_news.x_forward_test`). The rule above is unchanged.
- What it does: the news replay's day-by-day setup (each morning's states, the baseline fitted on
  the earlier seasons with teammates out on, each game decided at 5:30 PM Eastern or 30 minutes
  before its tip) on this season's finished game days, with the overrides resolved as the live
  app resolves them (`overrides.resolve`) at each game's decision time, twice: with X, and without
  (the NBA report and BallDontLie only). Hand entries (overrides.yaml) are left out of both, since
  they carry no time they were known. Only what was known counts: X by `first_seen_at` (and post
  time), the report by its publishing time, BallDontLie by snapshot time. Unmatched and
  team_conflict statuses never count, as in the overrides.
- Scored per player-game with a box-score row (BallDontLie lists inactive players too, so a game
  he sat counts: did not play, 0 points). Primary: the P(plays) Brier, with X minus without, on
  the player-games X gave a status for by the decision time (statuses carried from an earlier
  game included, and counted apart). Guard: the points average miss on every graded player-game,
  since X moves teammates' minutes too; the same on X's player-games is shown, not judged. 95%
  ranges resample whole game days, 2,000 draws (`settings.x_forward_test`).
- Verdict, as the job reads the rule: either range entirely above zero is "worse with X" (X is
  switched off; a failed guard counts here); otherwise a Brier range entirely below zero passes;
  anything else means X drops below the NBA report. The job prints the verdict and changes
  nothing; the authority order is changed by hand.
- Not enough data (under 3 weeks of finished game days, or under 150 X statuses tied to one of
  their games): it says so and replays nothing. `ARGS=--force` replays anyway, numbers only, no
  verdict. Results go to data/x_forward_test/<date>/ (summary.json, player_games.csv).
- What it can't check yet: no X status is stored, so on the real store it ends at "not enough
  data". The X arm is tested on invented data only. A forced run on 2025-26's first three weeks
  (no X statuses) graded 4,525 player-games in 8 s with identical arms (difference 0, as it must
  be); 90% of the player-games where he played were graded and 72% of those where he sat (the
  rest had too little history to project, or a team the replay couldn't place).
- Known differences from the live app: no preseason prior (in-season EWMA only, as in the other
  replays); a player with no game yet this season is placed on his team in today's players table,
  and the report's "not listed" uses today's rosters too, so a trade inside the replayed weeks is
  placed by today's team.
- Also changed: the replays' decision time is now read on the Eastern wall clock. It was midnight
  plus 17.5 hours, an hour early on the day the clocks go back, so the news backtest moves on
  that one day a season.

**X news pipeline: round-3 audit fixes (2026-10-08).** Codex (gpt-6-astra) audited the X
pipeline on a clean clone with public tables only (docs/audits/2026-10-08-x-feed-astra.md) and
wrote 60 invented posts with their right answers, kept out of the repo. Its test could not call
the parser; run here afterwards on the production model (Claude Haiku 4.5), three times each:
- As it was: every 40-post call stopped at the 2,000-token output limit and returned nothing,
  in all three runs. A busy news window would have lost every status in it, silently (X15).
- Same posts, 10 a call: all 57 statuses found, players, teams and statuses all right; one
  weekday turned into the wrong date, two stated absences miscounted, and "out for the rest of
  tonight's game" became an Out (in two runs of three).
- After the fixes: all 57 found, no invented status in any run, 49 of 49 stated dates and 5 of 5
  time frames right; the only differences were starting-lineup flags (one or two posts), which
  nothing uses yet. The audit's own end-to-end check went from 51 to 55 of 57 (the other two
  are a nickname and initials, held for review by design).
Fixed, each with a test that fails on the old code:
- X15: 10 posts a call, 4,000-token limit; a cut-off reply is split in half and retried down to
  one post, never dropped; a post that still fails is counted.
- X01: reads are logged the moment a page arrives, so the budget is a hard cap even when
  parsing fails; nothing moves on until the posts are parsed and stored.
- X02, X03: every page is followed; each account remembers how far it was read completely and the
  next read starts there (a small overlap for late-indexed posts; at most 20 hours back), so the
  hours between polls are never skipped; post ids already read are not parsed again; the least
  recently read query goes first. Teams playing tomorrow are watched too, and the nightly run
  polls once (late news about tomorrow).
- X04: the availability-word filter is wider ("will sit", "day-to-day", "good to go", "suit up",
  "re-evaluated" ...).
- X05: a stated date with no game for him is kept as `unmatched` and never acted on (it no longer
  becomes his next game: a post after tip about tonight lands here); an absence that ends before
  his next game no longer makes an Out for it. The model is told in-game injuries are not news
  for an upcoming game, and each post carries the next week's dates by weekday.
- X07: absences are worked out from up to 60 days before the dates asked for, so a return still
  ends an absence when the dates asked for start after it.
- X08: only the same-day report that wins its day ends a carried absence.
- X13, X14: the model's events are checked before use: a name must look like a name, minutes
  limits and days must be possible, and a confidence under 0.5 is not used.
The medium findings, fixed the same day (owner's call), each with a test:
- X06: a post naming a team he isn't on is kept as `team_conflict` and never acted on (a same-day
  trade the players table hasn't caught up with waits for the nightly roster refresh).
- X09: every projection records the news that decided it (`news_source`, with X's account tier,
  `news_status`, `news_carried`); the live scoreboard grades X by those decisions, a carried
  status apart, instead of by the latest post.
- X10: each status keeps when it was first read (`first_seen_at`, kept across re-reads); a
  status read after a decision's time was not known for it.
- X11: one event per post, player and game, so a post about two of his games keeps both; "on a
  minutes restriction" with no number is kept (`limited`) and shown, never turned into a number.
  Starting lineups stay informational.
- X12: a day inside a reported absence's return window reads "could return (N% chance he plays)",
  once per absence and never urgent; days still inside the absence add no new alert.
Re-run after these: the real parser on the audit set (three runs) found every status, invented
none, kept both games of the two-game post in two runs of three and flagged the unnumbered
restriction in all three; the audit's end-to-end check (asking as of just after each read, which
the first-seen rule now requires) is 57 of 59, the two misses being the held nickname and
initials. The forward test with and without X (rules above) still decides whether X keeps its
place.

**Yahoo data policy: read live, never stored (2026-10-08).** Yahoo Fantasy data is read live for
each job and each page, held in memory, and let go when it finishes; only the app's own analyses
are kept. The owner chose this over keeping a local copy.
- `store.LIVE_ONLY`: the Yahoo tables exist only as TEMP tables of one connection (in memory,
  gone when it closes; unqualified queries find them first, so the readers didn't change). Every
  connection starts with them empty; `ingest/yahoo_live.attach` fills them for a job (nightly:
  everything; pre-game: my team, my opponent, the matchup) or a page (the parts it needs: most
  pages a few calls; moves and a player's page also read the free agents). Any stored copy from
  before is dropped on start, with the Yahoo rows of the name matches.
- Rosters are read for my team and this week's opponent only. Name matching for Yahoo records
  nothing; names that don't match are printed by `make inbox`, never logged.
- A finished week is graded once by the nightly run (the live final matchup) and kept as
  categories won and lost only (`week_outcomes`); the live scoreboard reads that.
- Reads back off when Yahoo throttles (2, 4, 8, 16 s); other errors raise.
- Nothing that reads Yahoo data fits a model or reaches an AI service (tests check the model
  code and the X reader's payload); audits run on copies without Yahoo tables.
- Attribution: "Fantasy data provided by Yahoo Fantasy" with Yahoo's logo and a link, in the
  footer of every live League and Draft page (the demo shows invented data and carries none).
- `make yahoo-purge` deletes every Yahoo item: any stored copy, every analysis made from Yahoo
  data, the CSV exports and the sign-in. `make inbox` and `make yahoo-pull` now check and report;
  they store nothing.
- Cost: pages read Yahoo on each load (slower), and a Yahoo outage means no roster until it's
  back (the CSV inbox is the fallback). The draft room reads team names and eligibility once per
  draft session and holds them in that session's memory.
- The saved plan (same day): the nightly run, and a pre-game run when the last one is over 2 hours
  old (`optimizer.saved_plan_hours`), save the add/drop plan and its "with moves" odds line
  (`saved_plans`), as the app's own analysis only: player names and positions from the NBA data,
  no rostered %, no acquisitions used, my roster as a fingerprint. The Moves page and the odds page
  read it with a few live calls (my roster, my opponent, the matchup) and solve live, reading every
  free agent, only when no saved plan fits this week and roster. The plan can be up to 2 hours old
  on game days; the page says when it was saved. Moves worth exactly the same now list in a fixed
  order.

**This week's opponent, entered by hand (2026-10-08).** Teams → This week's opponent
(`#/league/teams/opponent`, `opponent_roster.py`, `GET/POST /season/opponent_roster`,
`GET /season/player_search`): pick the team I play this week and add their players from the NBA
list (search) or paste names, one per line (names that match no player come back with
suggestions and aren't kept). The live read uses it when Yahoo didn't supply the opponent: his
roster and, with no Yahoo matchup, the week's pairing, whose totals so far are then unknown (the
whole week is projected, and the odds say so). Kept to the Yahoo data policy: one opponent at a
time in one small file (`data/inbox/opponent.json`), replaced by the next week's entry, never in
the database, never an archive of past opponents and never every team's roster (asked for, and
declined for that reason); deleted by `make yahoo-purge`. In Storybook (Team Profiles / This
week's opponent) and the prototype; with sample data, saving and search work in memory.
- Team names (same day): the league's teams can be registered by name, inline when picking this
  week's opponent or all at once ("Name all teams"); pickers then show names. Names only, in one
  small file beside the entry (`data/inbox/league_teams.json`), never in the database, deleted by
  `make yahoo-purge`. Rosters stay one opponent at a time: a registry of every team's roster was
  asked for and the owner chose this narrower version.

**Market pulls throttled in pre-game runs (2026-10-08).** Pre-game runs poll every 15 minutes on
game days, and each pulled TheRundown and Kalshi (TheRundown bills by use; a day of dry runs while
testing showed up as a usage spike). Now a pre-game run pulls the markets only when it hasn't today,
an hour after the last pull (`markets.pregame_every_minutes`), or once in the final 45 minutes before
the day's first tip (`pregame_final_minutes`), and only today's games from TheRundown
(`rundown.pregame_days_ahead`); about 6-8 pulls on a game day instead of ~28. The nightly run is
unchanged (today plus 2 days). Dry runs never call the paid market feeds (`--with-markets` to).

**My roster, entered by hand (2026-10-09).** Team → My roster (`#/league/team/roster`,
`GET/POST /season/my_roster`): my players from the NBA list (search or pasted names, misses
come back with suggestions) and who is on the IL. It closes the last gap for opening night without
the Yahoo API: the live read uses it when Yahoo didn't supply my roster (Yahoo's wins when it does),
with my current lineup unknown (every slot open but the IL). One small file
(`data/inbox/my_roster.json`), replaced on each save, never in the database, deleted by
`make yahoo-purge`. The picking parts (search, list, paste, unmatched names) are now one shared
component for this and This week's opponent. Checked end to end: a dry run with a test roster and
opponent entered produced the week's matchup odds (the test entries were removed afterwards); the
lineup step had no games to set on the simulated night. The add/drop plan still needs the free
agents (players.csv or the API). "No roster yet" messages now point to these screens.

