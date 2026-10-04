# Draft room (React, mobile)

The live draft room for the NBA research room, built for an iPhone 17 in portrait
(402 x 874 CSS px). The Python engine computes every number; this app only displays them
and sends your actions to the local draft API (`make draft-api`, 127.0.0.1:8765). The
Tampermonkey listener posts picks to that API, and the app polls it every 1.5 s, so the
board updates with no action from you.

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

## Components (`src/components`, each with a `.stories.tsx`)

| Component | What it shows |
|---|---|
| `DraftRoom` | Puts the screen together: a sticky header, one section at a time, bottom navigation (Board, Pick, My team, Tiers, Log), and a thumb-reach "Draft" bar when you are on the clock. `DraftRoomView` is the presentational part that stories use. |
| `SessionSetup` | Draft slot (1–14) and punt chips. Starts a session, or sets the slot on a session that has none. |
| `DraftHeader` | Round and pick, the team on the clock, a 60 s local pick clock that restarts when the current pick changes, picks until your turn, and your next two picks. When you are on the clock the bar turns solid and shows the words "You're on the clock". |
| `RecommendationsList` | The top 10 as cards: player, positions, team, tier, gain, P(win week), and availability at your pick and at your next pick. Each card has expandable reasons, lower-confidence chips, and a Draft button (or "Taken by team N" while you wait). |
| `PickEntry` | Manual entry: search the available players, pick a team (defaults to the team on the clock), and submit. Undo asks before it runs. API errors such as 409 show in a snackbar. |
| `MyTeamPanel` | Expected categories won, P(win week), category odds chart, open starting slots, roster, and punt toggles. |
| `DriftAlert` | Punt-drift warning: warning color, an icon, and text. |
| `TierBoard` | Available players grouped by tier, with a position filter. Drafted players are removed. |
| `DraftLog` | Recent picks, newest first. Your picks are tinted and carry a "You" chip. |
| `ApiStatus` | The "Start the draft API: `make draft-api`" state, shown when the API cannot be reached. |
| `PlayerAvatar` / `TeamBadge` | Player headshot (initials when there is none or it fails to load) and a small team logo beside the abbreviation. |
| `charts/CategoryOddsChart` | P(win) per category against a league-average team, drawn as horizontal diverging bars from a 50% midline. Bars are labelled with their values. Tapping a bar gives a readout, and a table view is available. |
| `charts/Meter`, `charts/GainBar` | Thin availability meters and the inline signed gain bar. |

Supporting code: `src/api` (typed client mirroring `src/research_room/api.py`, plus the
`useDraftRoom` polling hook), `src/lib` (display formatting, the pick clock, layout and
asset helpers), `src/theme` (MUI v9 theme with `colorSchemes` and CSS variables, light and
dark, following `prefers-color-scheme` with a toggle in the header, plus chart color tokens
checked with the dataviz palette validator).

## Rule: stories and tests use invented data only

Everything in `src/mocks/` is made up. The names are fictional ("Sample Guard A") and every
number comes from a seeded generator. Never copy player data from the running API or from
`reference/` into this folder or any story or test: the Basketball Monster projections are
paid and this repo is public. Invented players have `headshot_url: null` and
`team_logo_url: null`, so stories show initials and abbreviations, never real headshots.

## Mobile notes

- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding. Storybook simulates the
  iPhone 17 insets (62 px top, 34 px bottom) through `--sim-safe-top` / `--sim-safe-bottom`
  and draws the Dynamic Island and home indicator. Turn them off with the "Safe areas"
  toolbar item.
- Tap targets are at least 44 px. Inputs use 16 px text so iOS does not zoom.
- Nothing needs hover: chart values are printed on the bars, tapping a bar fills in a
  readout, and the table view lists every value.
- Landscape works (the page scrolls) but is not optimized for.
