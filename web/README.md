# NBA research room app (React, mobile)

The app for the NBA research room, built for an iPhone 17 in portrait (402 x 874 CSS px).
The Python engine computes every number; this app only displays them and sends your actions
to the local API (`make draft-api`, 127.0.0.1:8765).

A left drawer (☰, or swipe from the left edge) separates three experiences:

- **Draft** (`#/draft`): the live draft room. The Tampermonkey listener posts picks to the
  API, and the app polls it every 1.5 s, so the board updates with no action from you.
- **League** (`#/league/...`): the season. Bottom tabs are Matchup · Team · Players · Teams ·
  Results, and the header bell opens Notifications. Screens whose endpoint is not implemented
  yet show the shared sample data with a persistent **Prototype data** chip; tap it for the
  endpoints. Invented numbers are never shown as real.
- **System** (`#/system/health`, `/models`, `/notes`): health checks, model performance, and
  updates from Claude.

The app remembers the last screen in this browser. Old `#/season/...` links still work.

Local only: both dev servers bind to 127.0.0.1. Nothing is deployed, and telemetry is off
everywhere (Storybook included).

## Run

```bash
cd web
pnpm install          # exact versions, pnpm-lock.yaml committed
make -C .. draft-api  # in another terminal: the API on 127.0.0.1:8765
pnpm dev              # app on http://127.0.0.1:5173 (proxies /api -> 127.0.0.1:8765)
pnpm storybook        # component workshop on http://127.0.0.1:6006
```

The app calls relative `/api/...`. The Vite dev server strips the `/api` prefix and forwards
to the API, and that includes the image paths the API returns (`/images/...` becomes
`/api/images/...`).

To use it on the phone, open the dev URL in a mobile viewport (Chrome devtools, iPhone 17
402 x 874), or view Storybook, which opens at that size by default.

## Checks

```bash
pnpm typecheck        # tsc -b --noEmit (strict)
pnpm lint             # eslint
pnpm test             # vitest + testing-library (formatting, pick clock, API client, polling, components)
pnpm build            # production bundle in dist/
pnpm build-storybook  # static Storybook in storybook-static/
```

## Storybook layout

The sidebar reads top-down in a fixed order (set in `.storybook/preview.tsx`):
Prototype, Draft, Team & Player Analysis, Team Builder, Matchup Analysis, Results, Results Analysis,
Notifications, Player Profiles, Team Profiles, App Shell, Foundations. Inside each category
stories sort alphabetically. Each category lives in its own folder under `src/components/`
(`draft/`, `app-shell/`, `foundations/`, ...), and its invented data in `src/mocks/<folder>/`.

## Draft (`src/components/draft/`)

The live room for the league's real 14-team Yahoo draft. It records who took whom and
where, so the board can plan around it. The Tampermonkey listener posts picks; any grid
cell can be tapped to record or fix one by hand.

| Folder | Components |
|---|---|
| `room/` | `DraftRoom`: the screen, top to bottom. `DraftRoomView` is the presentational part stories use. |
| `status/` | `StatusBar`: red "On the clock" or blue "Up in N picks", with round.pick ("3.02 (30th)"), the local pick clock, listener status, and an "Enter pick" fallback. `LatestPickCard`: the engine's read after each new pick; tap it to open that team. |
| `panels/` | `PositionalValuePanel` (value over replacement by position, with an info and table dialog), `SuggestedPicks` (the board's top two; Draft only works on the clock), `DriftAlert`. |
| `grid/` | `DraftBoardGrid`: teams as columns, 13 rounds, snake arrows, made picks colored by position group. Column headers show each team's needs and weakest category. A target button jumps to the current pick. `AssignPickSheet`: tap a cell to assign, change or remove a pick, in any order. |
| `sheet/` | The draggable bottom sheet's tabs. `AvailableList` (position chips, search, ADP / Our Rank / Playoff games sort, the PROJ. PICK divider, favorites, Compare checkboxes). `MyTeamPanel` (TEAM tab). `TeamsTab` (strategize: the teams picking before you first, their needs, strengths, weaknesses, and a head-to-head against you). |
| `compare/` | `CompareView`: 2–3 players side by side, with per-game lines, category z-scores, gain, availability, ADP, tier, risk and schedule volume. `PlayerDetailSheet`: one player's numbers, team schedule and per-category effect. |
| `tools/` | Menu items: `RecommendationsList` (top 10 with reasons), `PickEntry` (manual entry and Undo), `DraftLog`, `TierBoard`, `TeamNamesEditor`, `DraftMenu`, `SessionSetup`. |
| `charts/` | `DpChart`: change in my win chance per category (`dp_<category>`). |

Endpoints the running API may not have yet (`/draft/teams`, `/draft/positional_value`,
`/draft/compare`, `/draft/insights`, `DELETE /draft/pick/{n}`, `PUT /draft/teams/names`)
degrade to a clear "needs the updated draft API" message instead of guessed numbers.

## App Shell (`src/components/app-shell/`)

- `AppFrame`: resolves the route from the manifest. It owns the experience drawer
  (`nav/ExperienceDrawer`) and hands each screen its shell parts through `AppShellContext`
  (the ☰, the League bell, and the League bottom tabs). Each screen renders those parts in its
  own header, so every route shows exactly one ☰ and, in League, one bottom nav.
- `league/`: thin containers that load each season endpoint and render season-ui's screens
  (imported from `components/screens.ts`, never edited). When an endpoint 404s, the container
  falls back to the same mock as that screen's story and shows `PrototypeDataChip`.
- `system/`: `SystemScreen` (top tabs Health · Models · Updates), `HealthView`, `ModelsView`
  (MAE by stat as an MUI X bar chart, with the baseline as the reference; calibration as a
  meter against the 80% target), and `UpdatesView` (cards by kind). `MarkdownText` renders
  light markdown as React text; HTML is never interpreted.
- `ApiStatus`, `BottomSheet`, `FullScreenPanel`, `EndpointNotice`.

## Keeping the prototype and Storybook in sync

The rule: every screen in the app exists in Storybook, screen for screen, on the same data.

1. **One route manifest.** `src/app/routes.ts` lists every route: path, experience, title,
   screen component, and the id of its full-screen story. The app router renders from this
   list only.
2. **Screens are built from storied components.** Every manifest screen component has its own
   `.stories.tsx`. Mocks live in `src/mocks/<category>/` and are shared by the stories and
   the app's Prototype-data fallback.
3. **A Prototype section** (top of the sidebar, `src/app/Prototype.stories.tsx`) has one
   story per route. It renders the real app frame (drawer, headers, bottom tabs) on the
   sample data at 402x874.
4. **The sync test** (`src/app/routes.sync.test.ts`, part of `pnpm test`) fails when:
   - a route has no Prototype story;
   - a Prototype story points at a route that is not in the manifest;
   - a route's screen component has no stories file.

When you add a screen: add the route to `routes.ts`, add its story to `Prototype.stories.tsx`,
and give the screen component its own stories file. `pnpm test` tells you if you missed one.

## Foundations (`src/components/foundations/`)

`avatars/PlayerAvatar` and `TeamBadge`, `badges/PositionBadge`. Charts: `CategoryOddsChart`
(P(win) around 50%, also reused for head-to-head), `Meter`, `TeamVolumeStrip` (games per
fantasy week, playoff weeks 20–22 highlighted, plus month totals). `color/` documents the
palettes:
- "For me" green / red / gray, with its ramps: green helps me, red hurts me, gray is no
  effect.
- The status colors, kept apart from "for me" (error is ΔE ≥ 15 from bad).
- The position-group colors.
- The chart tokens.

All charts are MUI X Charts (the free MIT `@mui/x-charts`). Palettes are checked with the
dataviz validator; the values and results are in `src/theme/viz.ts`.

Supporting code:
- `src/api`: the typed client for `src/research_room/api.py`, and the `useDraftRoom` polling hook.
- `src/lib`: display formatting, pick labels and grid layout, schedule joins, favorites.
- `src/theme`: the MUI v9 theme (`colorSchemes` and CSS variables, light and dark) and the color tokens.

## In-season screens (categories 2–9)

The phone app's in-season screens are designed in Storybook with invented data. Their
contract is `src/api/season.ts`, and `docs/season-api.md` lists the endpoints and says which
engine module produces every number. In the app they live under `#/season/<tab>`.
**Live today:** Team → Lineup (`#/season/builder/lineup`, `GET /season/lineup`, polled
every 30 s). The other tabs show a "not live yet" notice until their endpoints exist.

| Category (folder) | Screens |
|---|---|
| Team & Player Analysis (`team-player-analysis/`) | Research feed, Schedule volume, Compare |
| Team Builder (`team-builder/`) | Lineup, Moves planner, Pickups, Playable games strip |
| Matchup Analysis (`matchup-analysis/`) | Game Center (main), This Week, Win probability |
| Results (`results/`) | Season (weeks, category results, standings) |
| Results Analysis (`results-analysis/`) | Prediction review, Model scoreboard |
| Notifications (`notifications/`) | Inbox, Alert cards |
| Player Profiles (`player-profiles/`) | Deep dive, Heat Calendar, Month ahead |
| Team Profiles (`team-profiles/`) | League team, NBA team |

The shared season primitives are in `foundations/`: `ScreenFrame`, `ScreenStates`,
`Confidence`, `PlayerLine`, `SignedBarChart`, `HeatCalendar` + `heatScale`, `DetailSheet`,
`AcquisitionsMeter` and `seasonFormat`. Fixtures are in `src/mocks/<category>/`.

Conventions:
- "Good / bad for me" colors come from `theme/viz.ts` `FOR_ME`: green helps me, red hurts
  me, gray means no effect. Every colored mark also carries ▲, ▼ or ●, and the sheet or
  readout says the effect in words.
- Heatmap-like grids (heat calendar, add/drop strips, schedule volume, lineup grid) are built
  from MUI layout, because MUI X's heatmap is Pro. Their cells show labels only; tapping a
  cell opens a bottom sheet with the numbers, and a table view lists them too.

## Rule: stories and tests use invented data only

Everything in `src/mocks/` is made up. The names are fictional ("Sample Guard A", team names
such as "Fictional Five"), and every
number comes from a seeded generator. Never copy player data from the running API or from
`reference/` into this folder or any story or test: the Basketball Monster projections are
paid and this repo is public. Invented players have `headshot_url: null` and
`team_logo_url: null`, so stories show initials and abbreviations, never real headshots.
The schedule mock uses real NBA team codes with invented game counts.

## Mobile notes

- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding. Storybook simulates the
  iPhone 17 insets (62 px top, 34 px bottom) through `--sim-safe-top` / `--sim-safe-bottom`
  and draws the Dynamic Island and home indicator. Turn them off with the "Safe areas"
  toolbar item.
- Tap targets are at least 44 px. Inputs use 16 px text so iOS does not zoom.
- Nothing needs hover: chart values are printed on the bars, tapping a bar fills in a
  readout, and the table view lists every value.
- Landscape works (the page scrolls) but is not optimized for.
