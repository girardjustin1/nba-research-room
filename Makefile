PY := .venv/bin/python
SEASONS ?= 2023 2024 2025

.PHONY: backtest doctor setup backfill inbox projections nightly nightly-schedule pregame draft-api app web storybook mock-draft images test lint

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

pregame:  ## pre-tip injuries / status refresh (Phase 3)
	@echo "pregame job arrives in Phase 3" && exit 1

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

backtest:  ## replay last season week by week: are the win odds honest, do the plans win more?
	$(PY) jobs/backtest.py

test:
	$(PY) -m pytest -q

lint:
	.venv/bin/ruff check src tests jobs app
