# In-season API contract

The phone app's in-season screens (Storybook categories 2–9) read these endpoints. The Python
engine computes every number; the UI only formats, arranges and colors what it receives. The
TypeScript shapes in [`src/api/season.ts`](../src/api/season.ts) are the contract, and this
page says where each number comes from.

| Status | Endpoints |
|---|---|
| **Implemented** | `GET /season/lineup` (`season_api.py`), `GET /schedule/team_weeks`, `GET /schedule/team_days` (`api.py`) |
| **Proposed** | everything else on this page, including `GET /season/week/probability`, `GET /season/week/gamecenter` and `POST /season/scenario` (Phase 2) |

All endpoints are served by the local API on 127.0.0.1:8765. The app calls `/api/...` and the
Vite proxy strips the `/api` prefix. The app reaches the season screens at `#/season/<tab>`,
and today only `#/season/builder/lineup` is live.

## Rules every response follows

These rules come from `docs/BUILD_PROMPT.md` and `DECISIONS.md`.

1. **Mean and sd, always.** A projected quantity is an `Estimate {mean, sd, lo, hi, level}`.
   The engine computes `lo`/`hi`, the band at coverage `level` (0.8). The UI never derives a
   band from mean and sd.
2. **Probabilities are fractions.** A change in probability is a fraction too: 0.042 is
   shown as "+4.2 pts".
3. **Every response has an `Envelope`:** `as_of` (when its inputs were current, i.e. the
   oldest input that matters), `stale` and `stale_reason` (computed by the server against
   each input's freshness budget), and `provenance[]`.
4. **Every factor and recommendation carries a `Confidence {level, score, missing[]}`.**
   A missing input is listed in `missing` with what the engine did instead. **It is never
   replaced by a neutral default.** A number the engine cannot produce is `null`, and the UI
   shows "—".
5. **`Provenance {module, as_of, run_id, note}`.** `module` names the Python module
   (projections, simulate, optimizer, overrides, x_feed, kalshi, rundown, bdl, yahoo,
   schedule, features, explain, backtest). `as_of` may be `null` when the source has no
   timestamp.
6. **Times** are ISO-8601 with offset, and calendar dates are in league time (US Eastern).
   Relative times ("12m ago") are measured against the response's own `as_of`, not the
   device clock.
7. **Errors.** FastAPI `detail`. A **409** means the engine lacks an input, and `detail` says
   the next step (for example "No Yahoo roster yet: save roster.csv to data/inbox and run
   `make inbox`."). The UI shows it as an empty state with that step.

Colors on every "good or bad for me" visual come from `theme/viz.ts` `FOR_ME`: green helps
me, red hurts me, gray means no effect. They are always from my side, so an opponent's
strength is red. Each colored mark also carries ▲, ▼ or ● and a sentence in words.
Magnitude-only views (minutes, PTS counts) use the blue sequential ramp. Heatmap cells show
labels only; the numbers are in the bottom sheet and the table view.

---

## Matchup Analysis

### `GET /season/week` → `WeekResponse` (proposed)

| Field | Produced by | Notes |
|---|---|---|
| `week` (`WeekContext`) | `schedule.py`, `config/settings.yaml` | `days_left`, `is_last_day`, `is_playoffs`, `playoff_round`, `punts`, `categories`, `cats_to_win` (5 of 9) |
| `baseline.p_win_week` `{p, lo, hi, level}` | `simulate.py` (Monte Carlo, 5,000 draws; Kalshi CDFs where liquid, else normal(mean, sd)) | the do-nothing lineup carried to Sunday |
| `baseline.expected_cats` (`Estimate`) | `simulate.py` | of 9 |
| `with_moves` (`WinOutlook`) | `optimizer.py` plan, then `simulate.py` | `delta_vs_baseline` is computed by the engine; null when no move helps |
| `categories[].mine_to_date`, `theirs_to_date` | `ingest/yahoo.py` matchup snapshot | ratios for FG%/FT% |
| `categories[].mine_final`, `theirs_final` (`Estimate`) | `simulate.py` | projected end-of-week totals |
| `categories[].p_win`, `swing` | `simulate.py` | `swing` = engine flag for a close, movable category |
| `games.days[]` `mine`, `theirs`, `league_games`, `light_day`, `*_b2b` | `schedule.py` | light day = 5 or fewer NBA games |
| `games.days[].mine_usable`, `theirs_usable`, `usable_edge` | `optimizer.py` | games that fit active slots; `usable_edge = mine_usable − theirs_usable`, sent so the UI does not subtract |
| `acquisitions {used, max, pending, resets_on}` | `ingest/yahoo.py` transactions | max 4 per week |
| `alerts[]` (`BreakingAlert`) | `ingest/x_feed.py` → `overrides.py` → `simulate.py` | `impact` = the simulation rerun with the news |

### `GET /season/week/probability` → `WinProbabilityResponse` (proposed, Phase 2)

| Field | Produced by | Notes |
|---|---|---|
| `history[]` `{ts, p_win_week, lo, hi, cats_lead, event}` | `simulate.py` snapshots after each nightly run, game-day refresh and material news event, stored in a new `matchup_snapshots` table | `event.kind`: nightly, games_final, news (`x_feed` → `overrides`), lineup, transaction (`yahoo`); `event.delta_p` = change from the previous snapshot; `cats_lead` from live Yahoo totals |
| `scenarios[]` `{scenario_id, label, kind, move_ids, points[], final, delta_vs_do_nothing}` | `optimizer.py` (recommended plan, named alternatives) + `simulate.py` | kinds: `do_nothing`, `recommended`, `custom` (up to 3 alternatives). All scenarios share one `ts` grid whose first point is "now". |
| `scenarios[].points[]` `{p_win_week, lo, hi, expected_cats, moves_applied, cat_deltas}` | `simulate.py` | `p_win_week` = P(win week) if the moves due by `ts` are made and nothing after, so the line climbs as moves take effect and ends at the full plan's value |
| `recommended_move_ids` | `optimizer.py` | the default selection in the Decisions toggles |
| `current {p_win_week, delta_since_yesterday}` | `simulate.py` | `delta_since_yesterday` vs the last snapshot before today |
| `cats_as_of` | `ingest/yahoo.py` | when the live category totals were read |

### `GET /season/week/gamecenter` → `GameCenterResponse` (proposed, Phase 2)

The Game Center (the main Matchup screen) reads this endpoint together with
`/season/week/probability` (chart history and scenarios) and `POST /season/scenario` (the
"With moves" line).

| Field | Produced by | Notes |
|---|---|---|
| `score {me, opp, ties}`, `linescore[].me/opp.total`, `linescore[].leader` | `ingest/yahoo.py` live week-to-date totals | `leader` is computed by the engine (TO: fewer leads) |
| `linescore[].me/opp.projected` (`Estimate`), `linescore[].p_win` (`ProbBand`) | `projections` + `simulate.py` | shown in the cell's bottom sheet |
| `swing[]` | `simulate.py` | the 2–3 categories closest to 50/50 |
| `games_left`, `days[]` (`me_games`, `opp_games`, `me_playable`, `opp_playable`, `playable_edge`, players) | `schedule.py`, `optimizer.py` | `playable_edge` is sent so the UI does not subtract |
| `since_yesterday {delta_p, label}` | `simulate.py` + the engine's summary | |
| `moments[]` (`GameCenterMoment`: `kind`, `headline`, `delta_p_win`, `category`, `score_after`, `key`) | `matchup_snapshots`, `x_feed`/`overrides` (injuries), `yahoo` (transactions, locks), `simulate.py` (flips, clinched >95%, out of reach <5%) | drawn as milestone icon dots on the chart; `key` decides Key moments vs All updates |
| `strength[]` (`StrengthRow`: me, opp, format, higher_is_better) | `schedule.py` + `optimizer.py` (games, playable games by position), `projections` (minutes, end-of-week totals) | mirrored bars; lengths are display geometry from the two values |
| `injuries[]` (`InjuryRow`: player, side, est_return, `delta_p_win`) | `overrides.py` (status, return), `simulate.py` (effect on my week) | both rosters |
| `pickups[]` (`WaiverCandidate`), `acquisitions` | `optimizer.py` add/drop search, `ingest/yahoo.py` | same shape as `/season/waivers` |
| `final` | Yahoo final matchup | set once the week is over |

`WinProbPoint.p_cats` and `ScenarioPoint.p_cats` (P(win) per category, `simulate.py`) feed
the chart's category dropdown, e.g. "BLK 64% → 78% with moves".

### `POST /season/scenario` `{move_ids}` → `ScenarioResponse` (proposed, Phase 2)

The app sends the moves the user toggled on; the engine returns `{scenario, feasible, message,
solve_ms, incompatible[]}`. The browser never computes a probability: while the request is
in flight the "With moves" line fades and says "Recomputing". A rejected set
(`feasible: false`, e.g. "Uses 5 of 4 acquisitions") keeps the last good line and shows the
message. `incompatible[]` lists moves that cannot be added to the current selection, and the
UI disables their toggles with the reason. Feasibility comes from `optimizer.py`; the path
comes from `simulate.py`.

Compare mode draws each named alternative as its own small chart (do nothing gray, the
recommended plan blue, the alternative orange). The validator caps all-pairs line colors at
three, and a fourth fails in dark mode.

`WeekResponse.categories[].status_now` (winning / losing / tied on week-to-date totals,
TO: fewer leads) feeds the Progress tiles, so the UI does not compare totals itself.

---

## Team Builder

### `GET /season/lineup` → `LineupResponse` (**implemented**, Phase 1)

| Field | Produced by | Notes |
|---|---|---|
| `days[].slots[]` (`SlotDiff`) `current`, `optimal`, `changed`, `reason`, `reason_tags` | `lineup.py` (`assign_day`) through `season_api.py` | Phase 1 maximises category-weighted projected value per day |
| `days[].slots[].delta_p_win`, `days[].delta_p_win` | the Phase 2 weekly optimizer | **always `null` in Phase 1**; the UI shows nothing rather than a number |
| `days[].games_available`, `games_started_*`, `first_lock_at`, `bench_*`, `il` | `season_api.py` from the schedule and the Yahoo snapshot | |
| `roster[].status.play_prob` | `overrides.py` | `null` when unknown; the UI shows "unknown", never 100% |
| `optimizer {status, message, solve_ms, horizon}` | `season_api.py` | `message` explains the Phase 1 objective, and the UI shows it |
| `stale` | `season_api.py` | projections older than 30 h |

What the server sends compared with the TypeScript type: **every field is sent.** Two fields
can be `null` on the server, and the type allows it: `provenance[].as_of` (when the Yahoo
snapshot has no timestamp) and `game.tip_at` (when a game has no tip time). `is_past` is
always false, because past days are omitted. Optional `?now=` (ISO) is for replay and tests
only.

### `GET /season/moves` → `MovesResponse` (proposed)

| Field | Produced by |
|---|---|
| `baseline`, `with_all` (with `delta_vs_baseline`) | `optimizer.py` + `simulate.py`. Moves interact, so the single-move gains do not add up to the plan. |
| `moves[].delta_p_win` (`Estimate`), `p_win_after`, `delta_expected_cats`, `cat_deltas[]` | `simulate.py`, each move alone vs doing nothing |
| `moves[].reason`, `details[]` | the engine's explanation, built from the numbers |
| `moves[].deadline {kind, at}` | `schedule.py` tips (lineup lock / add before game), Yahoo waiver clock (2 days) |
| `moves[].playable` (`PlayableWeek`) | `optimizer.py`: the add's and drop's games against my open slots by day; `raw_games_added`, `playable_games_added` |
| `moves[].confidence.missing` | e.g. "No liquid Kalshi BLK market", "Waiver priority not in the Yahoo snapshot" |
| `optimizer.status` / `message` | `optimizer.py`; when infeasible it gives a readable reason instead of crashing |

### `GET /season/waivers?position=&category=` → `WaiversResponse` (proposed)

| Field | Produced by |
|---|---|
| `candidates[]` rank, `delta_p_win`, `p_win_after`, `cat_deltas`, `cats_helped` | `optimizer.py` add/drop search + `simulate.py` |
| `candidates[].playable` | `optimizer.py` (playable vs raw games, my open slots by day) |
| `candidates[].clears_at`, `availability`, `player.pct_rostered` | `ingest/yahoo.py` free agents and waivers |
| `needs[]` `{key, p_win, need}` | `simulate.py`: how much a pickup in each category would move P(win week) |
| `pool_size` | how many free agents were scored, so "none help" is not mistaken for "none were scored" |

The position and category filters are client-side and keep the engine's rank order.

---

## Team & Player Analysis

### `GET /season/feed?kind=&cursor=` → `FeedResponse` (proposed)

| Item kind | Fields | Produced by |
|---|---|---|
| `news` | player, status, `minutes_cap`, `starting`, `source {handle, tier}`, `parse_confidence`, `corroborated_by[]` | `ingest/x_feed.py` (LLM parse to fixed JSON; raw post text discarded), tier from `x_accounts.yaml` |
| `market` | `line_before → line_after`, `implied_mean_after`, `ours` (`Estimate`), `liquid`, `volume` | `ingest/kalshi.py` (mid-price, volume floor; illiquid = missing), `ingest/rundown.py` |
| `model` | summary, `players_changed`, `scoreboard[]` | `projections/ensemble.py`, `backtest.py`, `optimizer.py` |
| `data` | `status`, `rows`, `duration_ms`, `message` | `ingest/*` runs (`ingest_runs` table) |
| every item: `impact` | `delta_p_win`, `cat_deltas`, `summary`, `suggestion`, `move_id`, `confidence` | `simulate.py` rerun with the new inputs |

`jobs[]` (`JobHealth`: last run, status, next run, `stale`, `running`, `progress`) comes from
`ingest_runs` and the scheduler. `x_budget` comes from config (300 reads per day).

### `GET /season/compare?a=&b=&decision=start_sit|add_drop&date=` → `CompareResponse` (proposed)

`verdict.delta_p_win` is P(win week) choosing A minus choosing B (`simulate.py`).
`rows[].better` is the engine's call; for TO, fewer is better. `cat_deltas[]` gives P(win) per
category under each choice.

### League-wide schedule volume

This view uses the implemented `GET /schedule/team_weeks` (`TeamWeeksResponse`: `weeks[]`
with `n_days` and `is_playoff`, and `teams[]` with `games_by_week`, `b2b_by_week`,
`light_day_games_by_week` as string-keyed maps, plus `total` and `playoff_games`). Weeks 1
and 17 span 14 days (`n_days: 14`); the UI stars them. Cells are colored against that week's
league median, which is display regrouping of the schedule's counts.

---

## Player Profiles

### `GET /season/players/{id}` → `PlayerAnalysisResponse` (proposed)

`recommendation {action, headline, slot, plan[], delta_p_win, versus, confidence}` comes from
`optimizer.py` + `simulate.py`. `factors[]` are ordered by the engine, most decision-relevant
first. Each factor is `{value, format, value_note, reading, push, confidence, provenance,
detail}`:

| `detail.kind` | Numbers | Produced by |
|---|---|---|
| `projection` | per-game and week `CatEstimate` (mean, sd, band) | `projections/ensemble.py` (rate × projected minutes × games) |
| `schedule` | his games by day, my open slots, would start | `schedule.py`, `optimizer.py` |
| `minutes`, `usage` | last N games, rolling 3/5/10, EWMA, season, projected `Estimate` | `features.py` (as of before tip), minutes model |
| `opponents` | pace and rank, DRTG and rank | `ingest/bdl.py` advanced stats → `features.py` |
| `vegas` | spread, total, implied team total, blowout probability | `ingest/bdl.py` odds (de-vigged), `ingest/rundown.py` |
| `market` | line, implied mean, ours, `gap_sd`, agreement, liquidity | `ingest/kalshi.py`, `ingest/rundown.py` |
| `news` | parsed events with source tier | `ingest/x_feed.py`, `overrides.py` |
| `teammates` | usage and minutes bump, sample size | `features.py` teammates-out share |
| `slot_fit` | per slot × day: open, `delta_p_win` | `optimizer.py` |
| `category_fit` | `p_without`, `p_with`, `delta_p` (engine-computed), `close` | `simulate.py` |
| `models` | each model's mean ± sd, weight, beats baseline; ensemble `Estimate` | `projections/*`, `ensemble.py`, `backtest.py` gate |
| `drivers` | SHAP contributions to the target | `projections/explain.py` |

### `GET /season/players/{id}/calendar?from=&to=` → `PlayerCalendarResponse` (proposed)

| Field | Produced by |
|---|---|
| `days[].state` (`played`, `scheduled`, `dnp`, `out`, `no_game`), `status_note` | `game_logs` (BallDontLie) for past days; `overrides.py` / injuries for out and DNP |
| `days[].minutes`, `stats` (incl. FGM/FGA, FTM/FTA), `z`, `value` (sum of 9 z, TO negative) | `game_logs` + the z-scoring in `draft/value.py` |
| `days[].projected[metric] {mean, sd}`, `play_prob`, `confidence` | `projections/ensemble.py`, `overrides.py` |
| `days[].opp_context {pace_rank, def_rank}` | `features.py` |
| `days[].my_open_slots` | `optimizer.py` |
| `days[].notes[]` | the engine's "why it matters for my week" lines |
| `days[].light_day`, `back_to_back`, `cup_or_playoff_week`, `week` | `schedule.py` |
| `metric_options[]` `{key, label, signed, field, higher_is_better, domain}` | engine; `domain` sets the color bins (e.g. the player's 5th–95th percentile) |
| `games_left_this_week` | `schedule.py` |

`projected` is keyed by metric (`{value: {mean, sd}, pts: {mean, sd}, …}`), not a single
`{mean, sd}`, so the calendar can switch metrics without another request.

### Month ahead

The month-ahead view uses the implemented `GET /schedule/team_days?team=&start=&end=`
(`TeamDaysResponse`: `days[] {date, opponent, home, back_to_back, light_day, week}`) and
`GET /schedule/team_weeks` (to mark 4-game weeks and playoff weeks).

---

## Team Profiles

### `GET /season/league_teams/{team_id}` → `LeagueTeamProfile` (proposed)

`strengths[] {key, z, rank}` are season-to-date z-scores of per-game team totals (TO is
pre-signed so that lower is better). They come from `projections` and the store's
`yahoo_rosters` × `game_logs`. `head_to_head` comes from `yahoo_matchups`, and its `next`
uses `simulate.py`. `notes[]` are built by the engine.

### `GET /season/nba_teams/{abbr}` → `NbaTeamProfile` (proposed)

This combines the implemented `/schedule/team_weeks` (`weeks`) and `/schedule/team_days`
(`days`) with `features.py` context: `pace`, `pace_rank`, `def_rating`, `def_rank`. Those
four are null when no advanced stats exist yet; the UI then shows them as missing with low
confidence. `my_players` and `opponent_players` come from the Yahoo snapshot.

---

## Results

### `GET /season/results` → `ResultsResponse` (proposed)

| Field | Produced by |
|---|---|
| `record`, `standings[]`, `my_rank`, `playoff_spots`, `regular_weeks_left` | `ingest/yahoo.py` (standings, matchups) |
| `weeks[].categories[]` `{mine, theirs, result, margin}` | Yahoo final matchup; `margin` is signed so positive is good for me (TO: theirs − mine) |
| `weeks[].outcome`, `cats_won`, `cats_lost`, `cats_tied`, `summary` | Yahoo + engine summary |

## Results Analysis

The same `ResultsResponse`, plus the scoreboard:

| Field | Produced by |
|---|---|
| `weeks[].predicted {as_of, p_win_week, expected_cats}`, `categories[].predicted_p` | `decisions_log`: the engine's numbers frozen before the week's first tip |
| `weeks[].brier`, `favorite_hits` | `backtest.py` |
| `weeks[].moves[]` `{followed, predicted_delta_p_win, realized_delta_cats, flipped}` | `decisions_log` vs Yahoo transactions and lineups; the realized effect comes from `backtest.py` replaying the week with and without each move on actual box scores |
| `scoreboard.rows[]` (`ScoreRow`: `mae`, `baseline_mae`, `rel_improvement`, `beats_baseline`, `weight`, `gated_on`) | `backtest.py` → `model_scores`; `rel_improvement` is sent so the UI does not divide |
| `scoreboard.calibration {bins[], brier, brier_baseline}` | `backtest.py` (P(win category) predicted vs observed) |

---

## Notifications

### `GET /season/notifications` → `NotificationsResponse` (proposed)

`items[]` (`SeasonNotification`) fields:

- `kind`: waiver, injury, news, lineup_lock, game_day or model.
- `priority`: urgent, high, normal or low. The UI shows it with status colors plus an icon
  and a word.
- `title`, `body` (built by the engine) and `impact`, which is the same `Impact` shape as the
  feed and comes from `simulate.py`.
- `action`, with a `target` of move, lineup, player, pickups or feed.
- `deadline`.
- `claim` (`WaiverClaimStatus`: pending, cleared, lost or cancelled; `clears_in_days`;
  `acquisitions_left`), from Yahoo transactions and the waiver clock.

Sources: `ingest/x_feed.py`, `overrides.py`, `ingest/yahoo.py`, `optimizer.py`, and
`jobs/pregame.py` alerts.

---

## Client

`createSeasonApi(base, fetchImpl)` in `season.ts` covers every endpoint above. Its errors
follow the draft client (`ApiError` / `ApiUnreachableError`, imported from `client.ts`).
`useSeasonResource` polls one endpoint every 30 s, keeps the last good data on failure, and
reports `notReady` for 409s. `LineupLive` (Team Builder) is the first screen wired to it.
