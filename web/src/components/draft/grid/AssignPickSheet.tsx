import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { errorMessage } from '../../../api/client';
import type { PoolPlayer, Session } from '../../../api/types';
import { SAFE_BOTTOM } from '../../../lib/layout';
import { roundPickLong, teamName } from '../../../lib/picks';
import { TeamBadge } from '../../foundations/avatars/PlayerAvatar';
import type { GridCell } from './DraftBoardGrid';
import { PositionBadge } from '../../foundations/badges/PositionBadge';

export interface AssignPickSheetProps {
  cell: GridCell | null;
  session: Session;
  /** Available players. */
  players: PoolPlayer[];
  pool: Map<number, PoolPlayer>;
  onClose: () => void;
  /** Record a player at an empty pick. */
  onAssign: (pickNo: number, teamId: number, playerId: number) => Promise<void>;
  /** Replace the player at a made pick. */
  onChange: (pickNo: number, teamId: number, playerId: number) => Promise<void>;
  onRemove: (pickNo: number) => Promise<void>;
}

/**
 * Bottom sheet for one grid cell. Empty cell: search the available players and assign one
 * to that pick (team from the cell; the API checks it). Made pick: change the player or
 * remove the pick. Picks can be entered out of order to catch up.
 */
export function AssignPickSheet({ cell, session, players, pool, onClose, onAssign, onChange, onRemove }: AssignPickSheetProps) {
  return (
    <Drawer
      anchor="bottom"
      open={cell != null}
      onClose={onClose}
      slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '88dvh', pb: SAFE_BOTTOM } } }}
    >
      {cell && <Body key={cell.pickNo} cell={cell} session={session} players={players} pool={pool} onClose={onClose} onAssign={onAssign} onChange={onChange} onRemove={onRemove} />}
    </Drawer>
  );
}

function Body({ cell, session, players, pool, onClose, onAssign, onChange, onRemove }: AssignPickSheetProps & { cell: GridCell }) {
  const made = cell.made;
  const [mode, setMode] = useState<'menu' | 'search' | 'confirmRemove'>(made ? 'menu' : 'search');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teamId = made?.team_id ?? cell.slot;
  const current = made?.player_id != null ? pool.get(made.player_id) : undefined;

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return players
      .filter((p) => !n || p.name.toLowerCase().includes(n))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
      .slice(0, 40);
  }, [players, q]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: mode === 'search' ? '80dvh' : 'auto' }}>
      <Box sx={{ width: 40, height: 5, borderRadius: 3, bgcolor: 'text.disabled', mx: 'auto', mt: 1 }} aria-hidden />
      <Box sx={{ px: 2, pt: 1, pb: 1 }}>
        <Typography variant="subtitle1" component="h2">
          Pick {roundPickLong(cell.pickNo, session.teams)} · {teamName(session, teamId)}
        </Typography>
        {made && (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mt: 0.5 }}>
            <PositionBadge pos={current?.position} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{made.player_name}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{current?.team_abbr ?? ''}</Typography>
          </Stack>
        )}
        {!made && cell.pickNo !== session.current_pick && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Not the current pick ({session.current_pick ?? '—'}). Fine for catching up out of order.
          </Typography>
        )}
      </Box>
      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 1 }} role="alert">
          {error}
        </Alert>
      )}

      {mode === 'menu' && made && (
        <Stack spacing={1} sx={{ px: 2, pb: 2 }}>
          <Button size="large" variant="contained" onClick={() => setMode('search')} disabled={busy}>
            Change player
          </Button>
          <Button size="large" variant="outlined" color="error" onClick={() => setMode('confirmRemove')} disabled={busy}>
            Remove pick
          </Button>
          <Button size="large" color="inherit" onClick={onClose}>
            Cancel
          </Button>
        </Stack>
      )}

      {mode === 'confirmRemove' && made && (
        <Stack spacing={1} sx={{ px: 2, pb: 2 }}>
          <Typography variant="body2">
            Remove {made.player_name} from pick {cell.pickNo}? He goes back into the pool and the cell is empty again.
          </Typography>
          <Button size="large" variant="contained" color="error" disabled={busy} onClick={() => run(() => onRemove(cell.pickNo))}>
            {busy ? 'Removing…' : 'Remove pick'}
          </Button>
          <Button size="large" color="inherit" onClick={() => setMode('menu')} disabled={busy}>
            Keep it
          </Button>
        </Stack>
      )}

      {mode === 'search' && (
        <>
          <Box sx={{ px: 2, pb: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search available players"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              slotProps={{
                input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
                htmlInput: { 'aria-label': 'Search available players', autoCorrect: 'off', autoCapitalize: 'words', enterKeyHint: 'search' },
              }}
            />
          </Box>
          <List dense sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 0 }} aria-label="Available players">
            {matches.map((p) => (
              <ListItemButton
                key={p.player_id}
                disabled={busy}
                onClick={() => run(() => (made ? onChange(cell.pickNo, teamId, p.player_id) : onAssign(cell.pickNo, teamId, p.player_id)))}
                sx={{ gap: 1, minHeight: 52, borderBottom: 1, borderColor: 'divider' }}
              >
                <Typography variant="caption" className="tabular" sx={{ width: 28, color: 'text.secondary' }}>
                  {p.rank ?? '—'}
                </Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{p.name}</Typography>
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                    <PositionBadge pos={p.position} />
                    <Typography variant="caption" component="span">
                      <TeamBadge abbr={p.team_abbr} logoUrl={p.team_logo_url} size={12} />
                    </Typography>
                  </Stack>
                </Box>
                <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 700 }}>
                  {made ? 'Swap' : 'Assign'}
                </Typography>
              </ListItemButton>
            ))}
            {matches.length === 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>No available player matches.</Typography>
            )}
          </List>
          {made && (
            <Box sx={{ px: 2, py: 1 }}>
              <Button fullWidth color="inherit" onClick={() => setMode('menu')}>Back</Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
