# Draft night runbook

The Hoop Dreams draft is **Sun Oct 18, 2026 at 7:00 pm EDT**: live snake, 14 teams, 60-second pick
clock. The season opens two days later, on Tue Oct 20. This page is the checklist. `make doctor`
checks most of it for you, and every warning it prints comes with the action that fixes it.

The tool only recommends. Every pick, add, drop and lineup change is made by hand in Yahoo; the
app never acts inside Yahoo.

The app runs at **http://127.0.0.1:5173**. Type that address rather than `localhost:5173`: another
project on this Mac also uses port 5173, and `localhost` can land on it.

Until Yahoo gives the app API access, you enter four things by hand: the draft picks the listener
misses, your roster, each week's opponent, and the free agents. Each takes a minute, and the steps
below say when. Once access is on, Yahoo's data is read live instead and these entries are ignored.

## Draft week (Thu Oct 15 – Sat Oct 17)

1. **Confirm the league facts.**
   - **If Yahoo access is on:** run `make yahoo-check`. It compares every league fact with
     `config/settings.yaml` (rounds, keepers, roster slots, categories and their stat ids, weekly
     adds, draft order, your slot, week dates) and prints the exact change for anything that
     differs. Ask Claude to make those changes.
   - **If not:** read them in Yahoo (League → Settings / Draft):
     - **Rounds.** Set `draft.rounds`, then `draft.confirmed.rounds: true`.
     - **Keepers.** Add any to `draft.keepers` (`{team_id, round, player}`), then set
       `draft.confirmed.keepers: true`. With no keepers, leave the list empty and still set it.
     - **Week boundaries** for weeks 1–19. Compare `season.extended_weeks` with the Yahoo league
       schedule, then set `season.week_boundaries_verified: true`.
2. **Fresh Basketball Monster projections.** Export both **Export to CSV** and **Export to Excel**
   into a new `reference/<MMDDYY>/` folder, then run `make projections`.
3. **Positions.** With Yahoo access, the board uses Yahoo's position eligibility. Without it, it uses
   each player's Basketball Monster position, and the player sheet says so. Nothing to do.
4. **Test the listener in a Yahoo mock draft.** Use a throwaway draft id such as `yahoo-mock-1` and
   follow the README section *Verify in a Yahoo mock draft*. If it reads every pick, set
   `draft.confirmed.listener: true`. If it doesn't, manual entry works and the draft is not at risk.
5. Run **`make doctor`** until nothing says FAIL. A few WARN lines are fine if you know why.

## Draft day, from 6:00 pm

1. **Don't run the nightly job during the draft.** The store has one writer, and a nightly run
   (6:30 pm) can block pick writes while it works. Run `make nightly` earlier in the day if you want
   fresh data, and start the schedules after the draft.
2. Open three terminals in the repo:
   - `make draft-api`: the engine on 127.0.0.1:8765. Leave it running.
   - `make web`: the app. Open **http://127.0.0.1:5173/#/draft**, at phone size if you like.
   - one free terminal for `make doctor`.
3. Run **`make doctor`**. "Draft API: running" should now be ok.
4. **Start the session.** On the Draft screen, choose your slot once Yahoo posts the order. Leave
   punts off unless you've decided: you can turn one on at any point, and the board re-values
   instantly. Keepers are placed automatically; an unmatched keeper name stops the session with a
   message, so fix it in settings and start again.
5. **Name the teams.** ☰ → **Edit team names**: name slots 1 to 14 as Yahoo's draft order lists
   them. The board's columns follow the draft order, so this is the order and the names in one go.
6. Open the Yahoo draft room in Chrome. The listener badge should read `draft hoopdreams-2026`.

## During the draft

- **On the clock:** take the top recommendation unless you have a reason not to. The card shows why
  each player ranks where he does and the chance he lasts to your next pick.
- **Other teams' picks** arrive from the listener. If the badge shows `UNMATCHED` or `CONFLICT`, or
  stops counting, enter that pick by hand: ☰ → **Enter pick / Undo**, type the name. A name that
  matches no player is refused with suggestions; Undo fixes a mistake.
- **Entering every pick by hand** (no listener): keep the app beside the Yahoo room and enter picks
  in batches while you're not on the clock. The board only needs to be current by your turn.
- If the API stops, restart `make draft-api` and start the session again with the same draft id.
  Every pick so far is in the store, so nothing is lost (rehearsed: a hard kill at pick 71, resumed
  with all 70 picks).
- If the app stops responding, the Streamlit Draft page (`make app` → Draft) is a second view of the
  same API session.

## After the draft (the same night)

With Yahoo access on, steps 1–3 happen by themselves; skip them.

1. **Your roster.** Team → My roster (**#/league/team/roster**) → **Use my draft picks**. It copies
   your picks from the draft room. Mark anyone who starts on the IL, then Save.
2. **This week's opponent.** Teams → This week's opponent (**#/league/teams/opponent**). Pick the
   team you play in week 1 (register its name the first time, or use **Name all teams**: these names
   go by Yahoo team, separately from the draft room's slot names). Fastest: screenshot their roster
   in Yahoo and drop it on **From a screenshot** (or press ⌘V): your Mac reads it, fills in the team
   and players, and you check them and Save. Or add players by search, or paste names one per line.
3. **Free agents.** On Yahoo's Players page, set Status to **All Available Players** and Position to
   **All**, select the list and copy it. Paste it into Team → Free agents
   (**#/league/team/free-agents**). Only player names are picked out of the paste. For more than 25
   players, paste each page below the last before saving; 75–100 is plenty.
4. **Start the schedules**, each in its own terminal: `make nightly-schedule` (every evening at
   6:30) and `make pregame-schedule` (every 15 minutes in the 3 hours before the first tip). The
   betting-line archive begins with the first run.
5. Run `make doctor` once more. The draft checks no longer matter; the System → Health screen takes
   over for the season.
6. Optional: keep a copy of the results with `curl -X POST http://127.0.0.1:8765/draft/export`
   (writes `data/inbox/draft_results.csv`) and compare it with Yahoo's.

## Every week, until Yahoo access arrives

- **Monday, as the week starts:** update This week's opponent (a screenshot of their roster is
  quickest), and paste a fresh free-agent list.
- **After you add or drop anyone in Yahoo:** update My roster (search or paste), and the IL marks.
- **For fresh add suggestions:** paste the free agents again. The screen asks for a new paste once a
  list is over 24 hours old, because other teams add and drop every day. Players on waivers paste
  in as free agents; one that's suggested can only be claimed once his waivers clear.
- **Game days:** Team → Lineup (**#/league/team**) shows who to start; set it in Yahoo before the
  first tip. Team → Moves (**#/league/team/moves**) shows the week's add/drop plan and what it does
  to your odds.
