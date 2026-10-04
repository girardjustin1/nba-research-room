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
