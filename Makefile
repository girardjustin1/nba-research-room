PY := .venv/bin/python
SEASONS ?= 2023 2024 2025

.PHONY: yahoo-purge dry-run bakeoff ensemble-replay shadow-report yahoo-keys yahoo-auth yahoo-check yahoo-pull scoreboard-live backtest backtest-news x-forward-test props-test report-backfill doctor markets pregame-schedule setup backfill inbox projections nightly nightly-schedule pregame draft-api app web storybook mock-draft images test lint

setup:  ## create .venv and install the locked dependencies (needs: brew install libomp cbc)
	uv venv --python 3.12 .venv
	uv pip install --python $(PY) -r requirements.txt
	uv pip install --python $(PY) -e . --no-deps

backfill:  ## pull historical seasons from BallDontLie into the store (resumable)
	$(PY) jobs/backfill.py --seasons $(SEASONS)

inbox:  ## load Yahoo CSVs from data/inbox (moving newer copies in from ~/Downloads first)
	$(PY) jobs/ingest_inbox.py --from-downloads

projections:  ## load the newest Basketball Monster exports from reference/
	$(PY) jobs/ingest_projections.py

nightly:  ## ingest -> features -> projections -> lineup, once now
	$(PY) jobs/nightly.py

nightly-schedule:  ## stay running and do the nightly run every day at 18:30 local
	$(PY) jobs/nightly.py --schedule

pregame:  ## pre-tip refresh now: X news, injuries, markets, today's projections, matchup snapshot
	$(PY) jobs/pregame.py

pregame-schedule:  ## stay running; on game days poll every 15 min in the 3 h before first tip
	$(PY) jobs/pregame.py --schedule

draft-api:  ## local draft API on 127.0.0.1:8765 (React app, Streamlit Draft page, Tampermonkey)
	$(PY) jobs/draft_api.py

app:  ## run the Streamlit app (reads the store only)
	$(PY) -m streamlit run app/Home.py --server.address 127.0.0.1 --server.port 8501 --browser.gatherUsageStats false

web:  ## React draft room on http://127.0.0.1:5173 (needs make draft-api running)
	cd web && pnpm install --frozen-lockfile && pnpm dev

storybook:  ## component workshop on http://127.0.0.1:6006 (sample data only, local only)
	cd web && pnpm install --frozen-lockfile && pnpm storybook

images:  ## cache headshots + team logos from the NBA CDN into data/images (personal use, gitignored)
	$(PY) jobs/fetch_images.py

mock-draft:  ## timed end-to-end mock draft (12 teams by default)
	$(PY) jobs/mock_draft.py --teams $${TEAMS:-12} --slot $${SLOT:-5}

doctor:  ## draft-night readiness: projections, Yahoo eligibility, slot, keepers, board speed
	$(PY) jobs/doctor.py

markets:  ## archive Kalshi props / game markets and TheRundown lines now (nightly does it too)
	$(PY) jobs/markets.py

backtest:  ## replay last season week by week: are the win odds honest, do the plans win more? (ARGS=--opponent-streams)
	$(PY) jobs/backtest.py $(ARGS)

backtest-news:  ## replay last season day by day with the NBA injury reports: does game-day news help?
	$(PY) jobs/backtest_news.py $(ARGS)

x-forward-test:  ## the X forward test: this season replayed with and without X statuses, verdict by the rule (read only)
	$(PY) jobs/x_forward_test.py $(ARGS)

props-test:  ## last season's Kalshi props vs the baseline, both if he plays; verdict by the rule (ARGS=--offline)
	$(PY) jobs/props_test.py $(ARGS)

yahoo-keys:  ## save your Yahoo app's Client ID and Secret into oauth2.json (asks in your terminal, hidden)
	$(PY) jobs/yahoo_keys.py

yahoo-auth:  ## one-time Yahoo sign-in for the read-only Fantasy API (run in your own terminal)
	$(PY) jobs/yahoo_auth.py

yahoo-purge:  ## delete every Yahoo item on this machine: stored data, analyses from it, CSV exports, sign-in (asks)
	$(PY) jobs/yahoo_purge.py $(ARGS)

yahoo-check:  ## compare the league's Yahoo settings with settings.yaml (read only)
	$(PY) jobs/yahoo_check.py

yahoo-pull:  ## read teams, rosters, free agents, matchup totals and draft picks from Yahoo (read only)
	$(PY) jobs/yahoo_pull.py

ensemble-replay:  ## the deciding test: the weekly replay driven by the baseline, then the ensemble (read only)
	$(PY) jobs/ensemble_replay.py

dry-run:  ## the nightly and pre-game jobs on a copy of the store, clock set to a game day (default: opening night)
	$(PY) jobs/dry_run.py $(ARGS)

bakeoff:  ## models vs the baseline: fit, weight the ensemble on one season, test once on the next (read only)
	$(PY) jobs/model_bakeoff.py

shadow-report:  ## the shadow models (settings.models.shadow) against the baseline, game by game, season to date
	$(PY) jobs/shadow_report.py

scoreboard-live:  ## grade what the app said before each game against what happened (season to date)
	$(PY) jobs/scoreboard_live.py $(ARGS)

report-backfill:  ## store past NBA injury reports for the news backtest (SEASONS="2025")
	$(PY) jobs/nba_report_backfill.py --seasons $(SEASONS)

test:
	$(PY) -m pytest -q

lint:
	.venv/bin/ruff check src tests jobs app
