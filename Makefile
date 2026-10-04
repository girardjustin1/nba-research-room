PY := .venv/bin/python
SEASONS ?= 2023 2024 2025

.PHONY: setup backfill nightly pregame draft-api app test lint

setup:  ## create .venv and install the locked dependencies (needs: brew install libomp cbc)
	uv venv --python 3.12 .venv
	uv pip install --python $(PY) -r requirements.txt
	uv pip install --python $(PY) -e . --no-deps

backfill:  ## pull historical seasons from BallDontLie into the store (resumable)
	$(PY) jobs/backfill.py --seasons $(SEASONS)

nightly:  ## ingest -> features -> projections -> optimize (Phase 1+)
	@echo "nightly job arrives in Phase 1" && exit 1

pregame:  ## pre-tip injuries / status refresh (Phase 3)
	@echo "pregame job arrives in Phase 3" && exit 1

draft-api:  ## FastAPI endpoint the Tampermonkey listener posts picks to (Phase D)
	@echo "draft API arrives in Phase D" && exit 1

app:  ## run the Streamlit app (reads the store only)
	$(PY) -m streamlit run app/Home.py

test:
	$(PY) -m pytest -q

lint:
	.venv/bin/ruff check src tests jobs app
