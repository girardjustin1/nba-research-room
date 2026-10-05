import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Slide from '@mui/material/Slide';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';
import { ApiError, errorMessage, type DraftApi } from '../../../api/client';
import type { ComparePlayer, PickRecord, PoolPlayer, Recommendation, TeamDay } from '../../../api/types';
import { useDraftRoom, type DraftRoomActions, type DraftRoomState } from '../../../api/useDraftRoom';
import { latestInsightByTeam, MAX_COMPARE, strengths } from '../../../lib/draftHelpers';
import { useFavorites } from '../../../lib/favorites';
import { categoryLabel } from '../../../lib/format';
import { SAFE_BOTTOM, SAFE_TOP } from '../../../lib/layout';
import { myNextPick, roundOf, roundPick, snakeSlot, teamName } from '../../../lib/picks';
import { teamDaysLoader } from '../../../lib/schedule';
import { DEFAULT_CATEGORIES } from '../../../lib/session';
import { ApiStatus } from '../../app-shell/ApiStatus';
import { useAppShell } from '../../app-shell/AppShellContext';
import { DraftLog } from '../tools/DraftLog';
import { DriftAlert } from '../panels/DriftAlert';
import { MyTeamPanel } from '../sheet/MyTeamPanel';
import { PickEntry } from '../tools/PickEntry';
import { RecommendationsList } from '../tools/RecommendationsList';
import { SessionSetup } from '../tools/SessionSetup';
import { TierBoard } from '../tools/TierBoard';
import { AssignPickSheet } from '../grid/AssignPickSheet';
import { AvailableList } from '../sheet/AvailableList';
import { CompareView } from '../compare/CompareView';
import { PlayerDetailSheet } from '../compare/PlayerDetailSheet';
import { DraftBoardGrid, type GridCell, type TeamMeta } from '../grid/DraftBoardGrid';
import { DraftMenu, type MenuPanel } from '../tools/DraftMenu';
import { FullScreenPanel } from '../../app-shell/FullScreenPanel';
import { LatestPickCard } from '../status/LatestPickCard';
import { PositionalValuePanel } from '../panels/PositionalValuePanel';
import { StrengthTable } from '../panels/StrengthTable';
import { StatusBar } from '../status/StatusBar';
import { SuggestedPicks } from '../panels/SuggestedPicks';
import { TeamNamesEditor } from '../tools/TeamNamesEditor';
import { TeamsTab } from '../sheet/TeamsTab';

/** Board: where every team drafted. League: me vs the league per category. Players: the
 * market (positional value, suggested picks) and Available / Favorites. */
export type RoomTab = 'board' | 'league' | 'players';
/** Scrolled past this many px, the status bar collapses to one row. */
const COLLAPSE_AT = 24;
export type PlayersFilter = 'available' | 'favorites';
const LATEST_MS = 12_000;

export interface DraftRoomViewProps {
  state: DraftRoomState;
  actions: DraftRoomActions;
  /** GET /draft/compare. */
  loadCompare: (ids: number[]) => Promise<ComparePlayer[]>;
  /** GET /schedule/team_days (cached by the container). */
  loadTeamDays?: (team: string, start: string, end: string) => Promise<TeamDay[]>;
  initialTab?: RoomTab;
  /** Players tab: start on Available or Favorites. */
  initialPlayers?: PlayersFilter;
  initialPanel?: MenuPanel | null;
  /** Stories: show the latest-pick card on first render instead of waiting for a new pick. */
  showLatestOnLoad?: boolean;
  now?: () => number;
}

/** Friendlier text for endpoints the running API may not have yet. */
function friendly(err: unknown, endpoint: string, what: string): Error {
  if (err instanceof ApiError && err.isNotFound) return new Error(`${what} needs the updated draft API (${endpoint} is not there yet).`);
  return err instanceof Error ? err : new Error(String(err));
}

function lastLivePick(picks: PickRecord[]): PickRecord | null {
  return picks.filter((p) => !p.is_keeper).reduce<PickRecord | null>((a, b) => (!a || b.pick_no > a.pick_no ? b : a), null);
}

/**
 * The live draft room for the league's real Yahoo draft, in three tabs under the status bar:
 * Board (the grid of every team's picks; tap any cell to record or fix a pick), Me vs league
 * (my standing per category against the league) and Players (the market left by position,
 * suggested picks, then Available / Favorites under a pinned toolbar). Scrolling any tab
 * collapses the status bar to one row. Picks arrive from the Yahoo listener. My roster and every team's
 * roster are in the tools menu. Every number comes from the draft API.
 */
export function DraftRoomView({
  state,
  actions,
  loadCompare,
  loadTeamDays,
  initialTab = 'board',
  initialPlayers = 'available',
  initialPanel = null,
  showLatestOnLoad = false,
  now,
}: DraftRoomViewProps) {
  const { session, board, connection } = state;
  const [tab, setTab] = useState<RoomTab>(initialTab);
  const [playersFilter, setPlayersFilter] = useState<PlayersFilter>(initialPlayers);
  const [compact, setCompact] = useState(false);
  const onScrollTop = (top: number) => setCompact((c) => (c ? top > COLLAPSE_AT / 2 : top > COLLAPSE_AT));
  const [cell, setCell] = useState<GridCell | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<MenuPanel | null>(initialPanel);
  const [compare, setCompare] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [focusTeam, setFocusTeam] = useState<number | null>(null);
  const [detail, setDetail] = useState<PoolPlayer | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: boolean; error?: boolean } | null>(null);
  const [favorites, toggleFavorite] = useFavorites(session?.draft_id ?? 'none');
  const shell = useAppShell();

  // Latest-pick card: appears when an insight newer than the first one we saw arrives.
  const insights = state.insights.data;
  const latest = insights && insights.length ? (insights[insights.length - 1] ?? null) : null;
  const [baseline, setBaseline] = useState<number | undefined>(showLatestOnLoad ? 0 : undefined);
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (baseline === undefined && insights) setBaseline(latest?.pick_no ?? 0);
  const showLatest = latest != null && baseline !== undefined && latest.pick_no > baseline && dismissed !== latest.pick_no;
  const latestPickNo = latest?.pick_no ?? null;
  useEffect(() => {
    if (!showLatest || latestPickNo == null || showLatestOnLoad) return;
    const id = setTimeout(() => setDismissed(latestPickNo), LATEST_MS);
    return () => clearTimeout(id);
  }, [showLatest, latestPickNo, showLatestOnLoad]);

  const drafted = useMemo(() => new Set(session?.picks.map((p) => p.player_id) ?? []), [session]);
  const live = board && !board.complete ? board : null;
  const recs = useMemo(() => (live?.recommendations ?? []).filter((r) => !drafted.has(r.player_id)), [live, drafted]);
  const categories = session?.categories;

  const teamMeta = useMemo(() => {
    const out = new Map<number, TeamMeta>();
    const cats = categories ?? DEFAULT_CATEGORIES;
    const byTeam = latestInsightByTeam(insights);
    for (const t of state.teams.data ?? []) {
      const needs = [...new Set(t.open_slots.filter((s) => !['Util', 'BN', 'IL'].includes(s)))];
      const weakKey = byTeam.get(t.team_id)?.weaknesses[0] ?? strengths(t.z_balance).weak[0] ?? null;
      out.set(t.team_id, { needs, weakest: weakKey ? categoryLabel(weakKey, cats) : null });
    }
    return out;
  }, [state.teams.data, insights, categories]);

  if (!session) {
    if (state.noSession) return <SessionSetup session={null} categories={DEFAULT_CATEGORIES} onStart={actions.start} />;
    return (
      <Box sx={{ minHeight: '100dvh', pt: SAFE_TOP, bgcolor: 'background.default' }}>
        {shell?.menuButton && <Box sx={{ px: 2, pt: 0.5 }}>{shell.menuButton}</Box>}
        <ApiStatus connection={connection} onRetry={actions.refresh} />
      </Box>
    );
  }
  if (session.my_slot == null || state.boardError?.isNoSlot) {
    return <SessionSetup session={session} categories={session.categories} onStart={actions.start} onResume={actions.setSlot} />;
  }

  const s = session;
  const current = s.current_pick;
  const mine = current != null && s.on_the_clock === s.my_slot;
  const next = myNextPick(s);
  const clockLabel = s.on_the_clock != null ? teamName(s, s.on_the_clock) : '—';

  async function draftCurrent(player: { player_id: number; name: string }) {
    if (current == null || s.on_the_clock == null) return;
    const label = roundPick(current, s.teams);
    const forTeam = teamName(s, s.on_the_clock);
    setPendingId(player.player_id);
    try {
      await actions.pick({ player_id: player.player_id, pick_no: current, team_id: s.on_the_clock });
      setNotice({ text: `${player.name} at ${label} for ${forTeam}`, undo: true });
    } catch (err) {
      setNotice({ text: errorMessage(err), error: true });
    } finally {
      setPendingId(null);
    }
  }

  function enterCurrentPick() {
    if (current == null) return;
    setCell({ pickNo: current, round: roundOf(current, s.teams), slot: s.on_the_clock ?? snakeSlot(current, s.teams), made: null });
  }

  const comparePlayers: ComparePlayer[] = compare.map((id) => {
    const rec = recs.find((r) => r.player_id === id);
    const p = state.pool.get(id);
    const base = p ?? ({ player_id: id, name: `#${id}` } as PoolPlayer);
    return { ...base, ...(rec ? { gain: rec.gain, p_available_next: rec.p_available_next } : {}) };
  });

  return (
    <Box sx={{ position: 'relative', height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden', maxWidth: 640, mx: 'auto' }}>
      <Box>
        <StatusBar
          session={s}
          decisionPick={live?.decision_pick}
          connection={connection}
          lastPickSeenAt={state.lastPickSeenAt}
          onEnterPick={enterCurrentPick}
          onMenu={() => setMenuOpen(true)}
          leading={shell?.menuButton}
          demoBadge={shell?.demoBadge}
          now={now}
          compact={compact}
        />
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v: RoomTab) => {
          setTab(v);
          setCompact(false);
        }}
        variant="fullWidth"
        aria-label="Draft views"
        sx={{ flexShrink: 0, minHeight: 44, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 44, fontWeight: 700 } }}
      >
        <Tab value="board" label="Board" />
        <Tab value="league" label="Me vs league" />
        <Tab value="players" label="Players" />
      </Tabs>

      {state.boardError && !state.boardError.isNoSlot && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} action={<Button color="inherit" onClick={actions.refresh}>Retry</Button>}>
          Board failed: {state.boardError.message}
        </Alert>
      )}

      {tab === 'board' && (
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', pb: SAFE_BOTTOM }}>
          {live && live.drift.length > 0 && (
            <Box sx={{ px: 2, pt: 1 }}>
              <DriftAlert drift={live.drift} categories={s.categories} />
            </Box>
          )}
          <DraftBoardGrid session={s} pool={state.pool} onCellTap={setCell} onEditNames={() => setPanel('names')} teamMeta={teamMeta} onScroll={onScrollTop} />

          <Slide direction="down" in={showLatest} mountOnEnter unmountOnExit>
            <Box sx={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 4 }}>
              {latest && (
                <LatestPickCard
                  insight={latest}
                  teams={s.teams}
                  onDismiss={() => setDismissed(latest.pick_no)}
                  onOpenTeam={(teamId) => {
                    setDismissed(latest.pick_no);
                    setFocusTeam(teamId);
                    setPanel('teams');
                  }}
                />
              )}
            </Box>
          </Slide>
        </Box>
      )}

      {tab === 'league' && (
        <Box component="main" onScroll={(e) => onScrollTop(e.currentTarget.scrollTop)} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: `calc(${SAFE_BOTTOM} + 16px)` }}>
          {live && live.drift.length > 0 && (
            <Box sx={{ px: 2, pt: 1 }}>
              <DriftAlert drift={live.drift} categories={s.categories} />
            </Box>
          )}
          <Box sx={{ px: 2, pt: 1.5 }}>
            <StrengthTable strength={state.strength.data} error={state.strength.error} loading={state.boardLoading} />
          </Box>
        </Box>
      )}

      {tab === 'players' && (
        <Box component="main" onScroll={(e) => onScrollTop(e.currentTarget.scrollTop)} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: SAFE_BOTTOM }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2, px: 2, pt: 1.5, pb: 1.5 }}>
            <PositionalValuePanel positions={state.positional.data} error={state.positional.error} loading={state.boardLoading} note={state.positionalNote} />
            <SuggestedPicks
              recommendations={recs}
              onTheClock={mine}
              loading={state.boardLoading && !live}
              pendingId={pendingId}
              onDraft={(r: Recommendation) => void draftCurrent(r)}
            />
          </Box>
          <AvailableList
            stickyToolbar
            toolbarLead={
              <Tabs
                value={playersFilter}
                onChange={(_, v: PlayersFilter) => setPlayersFilter(v)}
                aria-label="Player lists"
                sx={{ px: 1, minHeight: 40, borderTop: 1, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 40, fontWeight: 700 } }}
              >
                <Tab value="available" label="Available" />
                <Tab value="favorites" label={favorites.size ? `Favorites · ${favorites.size}` : 'Favorites'} />
              </Tabs>
            }
            players={state.players}
            teams={s.teams}
            currentPick={current}
            onTheClockLabel={clockLabel}
            mineOnTheClock={mine}
            myNextPick={next}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            compare={compare}
            onToggleCompare={(id) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? c : [...c, id]))}
            onOpenCompare={() => setCompareOpen(true)}
            onDraft={(p) => void draftCurrent(p)}
            onOpenPlayer={setDetail}
            pendingId={pendingId}
            favoritesOnly={playersFilter === 'favorites'}
          />
        </Box>
      )}

      <AssignPickSheet
        cell={cell}
        session={s}
        players={state.players}
        pool={state.pool}
        onClose={() => setCell(null)}
        onAssign={(pickNo, teamId, playerId) => actions.pick({ player_id: playerId, pick_no: pickNo, team_id: teamId })}
        onChange={(pickNo, teamId, playerId) =>
          actions.changePick(pickNo, teamId, playerId).catch((err: unknown) => {
            throw friendly(err, 'DELETE /draft/pick/{pick_no}', 'Changing a recorded pick');
          })
        }
        onRemove={(pickNo) =>
          actions.removePick(pickNo).catch((err: unknown) => {
            throw friendly(err, 'DELETE /draft/pick/{pick_no}', 'Removing a single pick');
          })
        }
      />

      <CompareView
        open={compareOpen}
        ids={compare}
        categories={s.categories}
        load={loadCompare}
        fallback={comparePlayers}
        onClose={() => setCompareOpen(false)}
        schedule={state.schedule.data}
        scheduleError={state.schedule.error}
        loadDays={loadTeamDays}
      />

      <PlayerDetailSheet
        player={detail}
        rec={detail ? recs.find((r) => r.player_id === detail.player_id) : undefined}
        categories={s.categories}
        schedule={state.schedule.data}
        scheduleError={state.schedule.error}
        loadDays={loadTeamDays}
        favorite={detail ? favorites.has(detail.player_id) : false}
        inCompare={detail ? compare.includes(detail.player_id) : false}
        compareFull={compare.length >= MAX_COMPARE}
        canDraft={current != null && pendingId == null}
        draftLabel={current == null ? 'Draft complete' : mine ? 'Draft' : `Draft for ${clockLabel}`}
        onToggleFavorite={() => detail && toggleFavorite(detail.player_id)}
        onToggleCompare={() =>
          detail &&
          setCompare((c) => (c.includes(detail.player_id) ? c.filter((x) => x !== detail.player_id) : c.length >= MAX_COMPARE ? c : [...c, detail.player_id]))
        }
        onDraft={() => {
          if (detail) void draftCurrent(detail);
          setDetail(null);
        }}
        onClose={() => setDetail(null)}
      />

      <TeamNamesEditor open={panel === 'names'} session={s} onClose={() => setPanel(null)} onSave={actions.setTeamNames} />

      <FullScreenPanel open={panel === 'recommendations'} title="Top 10 with reasons" onClose={() => setPanel(null)}>
        <Box sx={{ p: 2 }}>
          <RecommendationsList
            recommendations={recs}
            mode={mine ? 'onTheClock' : 'waiting'}
            decisionPick={live?.decision_pick ?? null}
            followingPick={live?.following_pick ?? null}
            onTheClock={s.on_the_clock}
            loading={state.boardLoading && !live}
            refreshing={state.boardLoading && !!live}
            onDraft={(r) => void draftCurrent(r)}
            pendingId={pendingId}
            categories={s.categories}
          />
        </Box>
      </FullScreenPanel>
      <FullScreenPanel open={panel === 'entry'} title="Enter pick / Undo" onClose={() => setPanel(null)}>
        <Box sx={{ p: 2 }}>
          <PickEntry
            players={state.players}
            teams={s.teams}
            onTheClock={s.on_the_clock}
            mySlot={s.my_slot}
            currentPick={current}
            lastPick={lastLivePick(s.picks)}
            onSubmit={(playerId, teamId) => actions.pick({ player_id: playerId, team_id: teamId })}
            onUndo={actions.undo}
          />
        </Box>
      </FullScreenPanel>
      <FullScreenPanel open={panel === 'myteam'} title="My team" onClose={() => setPanel(null)}>
        <Box sx={{ p: 2 }}>
          {live ? (
            <MyTeamPanel
              myTeam={live.my_team}
              categories={s.categories}
              punts={s.punts}
              rounds={s.rounds}
              onPuntsChange={(p) => {
                actions.setPunts(p).catch((err: unknown) => setNotice({ text: errorMessage(err), error: true }));
              }}
            />
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {current == null ? 'The draft is complete.' : 'Loading your team…'}
            </Typography>
          )}
        </Box>
      </FullScreenPanel>
      <FullScreenPanel open={panel === 'teams'} title="Teams" onClose={() => { setPanel(null); setFocusTeam(null); }}>
        <TeamsTab
          teams={state.teams.data}
          error={state.teams.error}
          categories={s.categories}
          teamsCount={s.teams}
          currentPick={current}
          myNextPick={next}
          insights={insights}
          focusTeamId={focusTeam}
        />
      </FullScreenPanel>
      <FullScreenPanel open={panel === 'log'} title="Draft log" onClose={() => setPanel(null)}>
        <Box sx={{ p: 2 }}>
          <DraftLog picks={s.picks} mySlot={s.my_slot} />
        </Box>
      </FullScreenPanel>
      <FullScreenPanel open={panel === 'tiers'} title="Tiers" onClose={() => setPanel(null)}>
        <Box sx={{ p: 2 }}>
          <TierBoard players={state.players} />
        </Box>
      </FullScreenPanel>

      <DraftMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenPanel={setPanel}
        onExport={() =>
          actions
            .exportResults()
            .then((path) => setNotice({ text: `Exported to ${path}` }))
            .catch((err: unknown) => setNotice({ text: errorMessage(err), error: true }))
        }
      />

      <Snackbar
        open={notice != null}
        autoHideDuration={notice?.error ? 6000 : 5000}
        onClose={(_, reason) => reason !== 'clickaway' && setNotice(null)}
        sx={{ top: `calc(${SAFE_TOP} + 8px) !important` }}
      >
        <Alert
          severity={notice?.error ? 'error' : 'success'}
          variant="filled"
          onClose={() => setNotice(null)}
          action={
            notice?.undo ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setNotice(null);
                  actions.undo().catch((err: unknown) => setNotice({ text: errorMessage(err), error: true }));
                }}
              >
                UNDO
              </Button>
            ) : undefined
          }
          sx={{ width: '100%' }}
        >
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  );
}

/** Container: wires the live API (polling) into the view. */
export function DraftRoom({ api, initialTab }: { api: DraftApi; initialTab?: RoomTab }) {
  const [state, actions] = useDraftRoom(api);
  const loadCompare = useMemo(() => (ids: number[]) => api.compare(ids).then((r) => r.players), [api]);
  // One request per team for the whole season; the schedule does not change mid-draft.
  const loadTeamDays = useMemo(() => teamDaysLoader(api), [api]);
  return <DraftRoomView state={state} actions={actions} loadCompare={loadCompare} loadTeamDays={loadTeamDays} initialTab={initialTab} />;
}
