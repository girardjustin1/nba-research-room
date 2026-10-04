# Draft night runbook

The Hoop Dreams draft is **Sun Oct 18, 2026 at 7:00 pm EDT**: live snake, 14 teams, 60-second pick
clock. This page is the checklist. `make doctor` checks most of it for you. Every warning it prints
comes with the action that fixes it.

The tool only recommends. Every pick is made by hand in the Yahoo draft room.

## Draft week (Thu Oct 15 – Sat Oct 17)

1. **Confirm the league facts in Yahoo** (League → Settings / Draft):
   - **Rounds.** Set `draft.rounds` in `config/settings.yaml`, then `draft.confirmed.rounds: true`.
   - **Keepers.** Add any keepers to `draft.keepers` (`{team_id, round, player}`, or `player_id` when
     a name is ambiguous), then set `draft.confirmed.keepers: true`. With no keepers, leave the list
     empty and still set it to true.
   - **Draft slot**, once Yahoo assigns the order. Set `draft.my_slot`, or pick it on the Draft screen.
   - **Week boundaries** for weeks 1–19. Compare `season.extended_weeks` with the Yahoo league
     schedule, then set `season.week_boundaries_verified: true`.
2. **Fresh Basketball Monster projections.** Export both **Export to CSV** and **Export to Excel**
   into a new `reference/<MMDDYY>/` folder, then run `make projections`.
3. **Yahoo eligibility.** Save `players.csv` covering all players (not just free agents), with
   `eligible_positions`, to `data/inbox/` (or `~/Downloads`), then run `make inbox`. Until you do,
   the board uses each player's single Basketball Monster position, and the player sheet says so.
   Fix any name the quarantine lists by adding it to `config/aliases.yaml`.
4. **Test the listener in a Yahoo mock draft.** Use a throwaway draft id such as `yahoo-mock-1` and
   follow the README section *Verify in a Yahoo mock draft*. If it reads every pick, set
   `draft.confirmed.listener: true`. If it doesn't, manual entry works and the draft is not at risk.
5. Run **`make doctor`** until nothing says FAIL. A few WARN lines are fine if you know why.

## Draft day, from 6:00 pm

1. **Don't run the nightly job during the draft.** The store has one writer. A nightly run
   (scheduled for 6:30 pm) can block pick writes while it works. Run `make nightly` earlier in the
   day if you want fresh data, and start `make nightly-schedule` after the draft.
2. Open three terminals in the repo:
   - `make draft-api`: the engine on 127.0.0.1:8765. Leave it running.
   - `make web`: the draft room at http://127.0.0.1:5173. Open it at phone size, or on the phone
     if it's set up.
   - one free terminal for `make doctor`.
3. Run **`make doctor`**. "Draft API: running" should now be ok.
4. In the app, start the session with the default draft id (`hoopdreams-2026`), your slot, and any
   punts. Keepers are placed automatically. An unmatched keeper name stops the session with a
   message, so fix it in settings and start again.
5. Open the Yahoo draft room in Chrome. The listener badge should read `draft hoopdreams-2026`.

## During the draft

- **On the clock:** take the top recommendation unless you have a reason not to. The card shows why
  each player ranks where he does and the chance he lasts to your next pick.
- **Other teams' picks** arrive from the listener. If the badge shows `UNMATCHED` or `CONFLICT`, or
  stops counting, enter that pick by hand on the Draft screen. Undo fixes a mistake.
- If the API stops, restart `make draft-api` and start the session again with the same draft id.
  Every pick so far is in the store, so nothing is lost.
- If the React app stops responding, the Streamlit Draft page (`make app` → Draft) is a second view
  of the same API session.

## After the draft

1. **Export the results.** Use the Streamlit Draft page (`make app` → Draft → *Export
   draft_results.csv*) or run `curl -X POST http://127.0.0.1:8765/draft/export`. Either writes
   `data/inbox/draft_results.csv`. Compare it with Yahoo's draft results.
2. Save your Yahoo `roster.csv` to the inbox and run `make inbox`, so the League screens know your
   team.
3. Start the nightly scheduler: `make nightly-schedule` in its own terminal. The betting-line
   archive begins with its first run.
4. Run `make doctor` once more. The draft checks no longer matter. The System → Health screen
   takes over for the season.
