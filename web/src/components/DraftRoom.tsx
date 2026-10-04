import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import FormatListNumberedOutlinedIcon from '@mui/icons-material/FormatListNumberedOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import { errorMessage, type DraftApi } from '../api/client';
import type { Recommendation } from '../api/types';
import { useDraftRoom, type DraftRoomActions, type DraftRoomState } from '../api/useDraftRoom';
import { SAFE_BOTTOM, SAFE_TOP } from '../lib/layout';
import { DEFAULT_CATEGORIES } from '../lib/session';
import { ApiStatus } from './ApiStatus';
import { DraftHeader } from './DraftHeader';
import { DraftLog } from './DraftLog';
import { DriftAlert } from './DriftAlert';
import { MyTeamPanel } from './MyTeamPanel';
import { PickEntry } from './PickEntry';
import { RecommendationsList } from './RecommendationsList';
import { SessionSetup } from './SessionSetup';
import { TierBoard } from './TierBoard';

export type DraftTab = 'board' | 'pick' | 'team' | 'tiers' | 'log';


export interface DraftRoomViewProps {
  state: DraftRoomState;
  actions: DraftRoomActions;
  initialTab?: DraftTab;
  /** Clock source for stories/tests. */
  now?: () => number;
}

/** The live draft room: sticky header, one section at a time, bottom navigation. */
export function DraftRoomView({ state, actions, initialTab = 'board', now }: DraftRoomViewProps) {
  const [tab, setTab] = useState<DraftTab>(initialTab);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [puntsBusy, setPuntsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session, board, connection } = state;

  const lastPick = useMemo(() => {
    const live = (session?.picks ?? []).filter((p) => !p.is_keeper);
    return live.length ? (live.reduce((a, b) => (b.pick_no > a.pick_no ? b : a)) ?? null) : null;
  }, [session]);

  if (!session) {
    if (state.noSession) {
      return <SessionSetup session={null} categories={DEFAULT_CATEGORIES} onStart={actions.start} />;
    }
    return (
      <Box sx={{ minHeight: '100dvh', pt: SAFE_TOP, bgcolor: 'background.default' }}>
        <ApiStatus connection={connection} onRetry={actions.refresh} />
      </Box>
    );
  }

  if (session.my_slot == null || state.boardError?.isNoSlot) {
    return (
      <SessionSetup session={session} categories={session.categories} onStart={actions.start} onResume={actions.setSlot} />
    );
  }

  const live = board && !board.complete ? board : null;
  const complete = session.current_pick == null || board?.complete === true;
  const mine = !complete && session.on_the_clock === session.my_slot;
  const top = live?.recommendations[0];

  async function draft(rec: Recommendation) {
    setPendingId(rec.player_id);
    try {
      await actions.pick({ player_id: rec.player_id });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPendingId(null);
    }
  }

  async function changePunts(punts: string[]) {
    setPuntsBusy(true);
    try {
      await actions.setPunts(punts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPuntsBusy(false);
    }
  }

  return (
    <Box
      sx={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        overflow: 'hidden',
        maxWidth: 640,
        mx: 'auto',
      }}
    >
      <DraftHeader session={session} decisionPick={live?.decision_pick} now={now} />

      {connection === 'down' && (
        <Alert severity="error" icon={<CloudOffOutlinedIcon />} sx={{ borderRadius: 0 }} role="alert">
          Draft API unreachable. Showing the last data; run <code>make draft-api</code>.
        </Alert>
      )}

      <Box component="main" sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', px: 2, pt: 1.5, pb: 2, WebkitOverflowScrolling: 'touch' }}>
        {tab === 'board' && (
          <Stack spacing={1.5}>
            {live && <DriftAlert drift={live.drift} categories={session.categories} />}
            {complete ? (
              <Alert severity="success">The draft is complete. Your roster is on the My team tab.</Alert>
            ) : (
              <RecommendationsList
                recommendations={live?.recommendations ?? []}
                mode={mine ? 'onTheClock' : 'waiting'}
                decisionPick={live?.decision_pick ?? null}
                followingPick={live?.following_pick ?? null}
                onTheClock={session.on_the_clock}
                loading={state.boardLoading && !live}
                refreshing={state.boardLoading && !!live}
                error={state.boardError && !state.boardError.isNoSlot ? state.boardError.message : null}
                onRetry={actions.refresh}
                onDraft={draft}
                pendingId={pendingId}
              />
            )}
          </Stack>
        )}
        {tab === 'pick' && (
          <PickEntry
            players={state.players}
            teams={session.teams}
            onTheClock={session.on_the_clock}
            mySlot={session.my_slot}
            currentPick={session.current_pick}
            lastPick={lastPick}
            onSubmit={(playerId, teamId) => actions.pick({ player_id: playerId, team_id: teamId })}
            onUndo={actions.undo}
          />
        )}
        {tab === 'team' &&
          (live ? (
            <MyTeamPanel
              myTeam={live.my_team}
              categories={session.categories}
              punts={session.punts}
              rounds={session.rounds}
              onPuntsChange={changePunts}
              puntsBusy={puntsBusy}
            />
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {complete ? 'The draft is complete; the board no longer computes team odds.' : 'Loading your team…'}
            </Typography>
          ))}
        {tab === 'tiers' && <TierBoard players={state.players} />}
        {tab === 'log' && <DraftLog picks={session.picks} mySlot={session.my_slot} />}
      </Box>

      {tab === 'board' && mine && top && (
        <Box sx={{ px: 2, py: 1, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
          <Button
            size="large"
            variant="contained"
            fullWidth
            disabled={pendingId != null}
            onClick={() => draft(top)}
            sx={{ minHeight: 52, fontSize: 17 }}
          >
            {pendingId === top.player_id ? 'Sending…' : `Draft ${top.name}`}
          </Button>
        </Box>
      )}

      <Paper square sx={{ borderTop: 1, borderColor: 'divider', pb: SAFE_BOTTOM }}>
        <BottomNavigation value={tab} onChange={(_, v: DraftTab) => setTab(v)} showLabels sx={{ height: 60, bgcolor: 'transparent' }}>
          <BottomNavigationAction value="board" label="Board" icon={<FormatListNumberedOutlinedIcon />} />
          <BottomNavigationAction value="pick" label="Pick" icon={<EditNoteOutlinedIcon />} />
          <BottomNavigationAction value="team" label="My team" icon={<GroupsOutlinedIcon />} />
          <BottomNavigationAction value="tiers" label="Tiers" icon={<LayersOutlinedIcon />} />
          <BottomNavigationAction value="log" label="Log" icon={<HistoryOutlinedIcon />} />
        </BottomNavigation>
      </Paper>

      <Snackbar
        open={error != null}
        autoHideDuration={6000}
        onClose={(_, reason) => reason !== 'clickaway' && setError(null)}
        sx={{ top: `calc(${SAFE_TOP} + 8px) !important` }}
      >
        <Alert severity="error" variant="filled" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}

/** Container: wires the live API (polling) into the view. */
export function DraftRoom({ api }: { api: DraftApi }) {
  const [state, actions] = useDraftRoom(api);
  return <DraftRoomView state={state} actions={actions} />;
}
