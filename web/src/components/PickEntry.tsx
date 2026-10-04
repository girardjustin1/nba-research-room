import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import UndoIcon from '@mui/icons-material/Undo';
import type { PickRecord, PoolPlayer } from '../api/types';
import { errorMessage } from '../api/client';
import { eligibleLabel } from '../lib/format';
import { SAFE_TOP } from '../lib/layout';
import { PlayerAvatar, TeamBadge } from './PlayerAvatar';

export interface PickEntryProps {
  /** Available players from GET /draft/players (drafted ones are filtered out here too). */
  players: PoolPlayer[];
  teams: number;
  /** Team on the clock; the team field defaults to it and follows it as picks come in. */
  onTheClock: number | null;
  mySlot: number | null;
  currentPick: number | null;
  /** The last recorded pick, for the undo confirmation. */
  lastPick: PickRecord | null;
  onSubmit: (playerId: number, teamId: number) => Promise<void>;
  onUndo: () => Promise<void>;
}

type Notice = { severity: 'success' | 'error'; text: string } | null;

/**
 * Manual pick entry (the fallback to the Tampermonkey listener): search the available pool,
 * confirm the team (defaults to on the clock), submit. Undo asks first. API errors such as
 * 409 "already drafted" show in a snackbar.
 */
export function PickEntry({ players, teams, onTheClock, mySlot, currentPick, lastPick, onSubmit, onUndo }: PickEntryProps) {
  const options = useMemo(() => players.filter((p) => !p.drafted), [players]);
  const [player, setPlayer] = useState<PoolPlayer | null>(null);
  // The team follows the clock unless the user chose one by hand for this pick.
  const [override, setOverride] = useState<{ pick: number | null; team: number } | null>(null);
  const team: number | '' = override && override.pick === currentPick ? override.team : (onTheClock ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const complete = currentPick == null;

  async function submit() {
    if (!player || team === '') return;
    setBusy(true);
    try {
      await onSubmit(player.player_id, team);
      setNotice({ severity: 'success', text: `Recorded ${player.name} for ${team === mySlot ? 'you' : `team ${team}`}` });
      setPlayer(null);
      setOverride(null);
    } catch (err) {
      setNotice({ severity: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setConfirmUndo(false);
    setBusy(true);
    try {
      await onUndo();
      setNotice({ severity: 'success', text: lastPick ? `Undid pick ${lastPick.pick_no}` : 'Undid the last pick' });
    } catch (err) {
      setNotice({ severity: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box>
      <Typography variant="subtitle1" component="h2" sx={{ mb: 0.5 }}>
        Enter a pick
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {complete
          ? 'The draft is complete.'
          : `Pick ${currentPick}. The browser listener usually records picks for you; use this if it misses one.`}
      </Typography>

      <Stack spacing={2}>
        <Autocomplete
          options={options}
          value={player}
          onChange={(_, v) => setPlayer(v)}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.player_id === b.player_id}
          getOptionKey={(o) => o.player_id}
          disabled={complete || busy}
          autoHighlight
          renderOption={(props, o) => {
            const { key, ...rest } = props as typeof props & { key: string };
            return (
              <li key={key} {...rest}>
                <Box sx={{ mr: 1.5, flexShrink: 0 }}>
                  <PlayerAvatar name={o.name} headshotUrl={o.headshot_url} size={32} />
                </Box>
                <Box sx={{ minWidth: 0, py: 0.5 }}>
                  <Typography variant="body1" noWrap>
                    {o.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {eligibleLabel(o.eligible, o.position)} · <TeamBadge abbr={o.team_abbr} logoUrl={o.team_logo_url} size={14} /> · rank{' '}
                    {o.rank ?? '—'} · tier {o.tier ?? '—'}
                  </Typography>
                </Box>
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Player"
              placeholder="Search available players"
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, autoCapitalize: 'words', autoCorrect: 'off', enterKeyHint: 'done' },
              }}
            />
          )}
          noOptionsText="No available player matches"
        />

        <FormControl fullWidth disabled={complete || busy}>
          <InputLabel id="pick-team-label">Team (draft slot)</InputLabel>
          <Select
            labelId="pick-team-label"
            label="Team (draft slot)"
            value={team}
            onChange={(e) => {
              setOverride({ pick: currentPick, team: Number(e.target.value) });
            }}
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360 } } } }}
          >
            {Array.from({ length: teams }, (_, i) => i + 1).map((t) => (
              <MenuItem key={t} value={t} sx={{ minHeight: 44 }}>
                Team {t}
                {t === mySlot ? ' (you)' : ''}
                {t === onTheClock ? ' · on the clock' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {team !== '' && onTheClock != null && team !== onTheClock && (
          <Alert severity="info" variant="outlined">
            Team {team} is not on the clock (team {onTheClock} is). The API records it at the current pick.
          </Alert>
        )}

        <Button size="large" variant="contained" disabled={!player || team === '' || busy || complete} onClick={submit}>
          {busy ? 'Sending…' : player ? `Record ${player.name}` : 'Record pick'}
        </Button>

        <Button
          size="large"
          variant="outlined"
          color="inherit"
          startIcon={<UndoIcon />}
          disabled={!lastPick || busy}
          onClick={() => setConfirmUndo(true)}
        >
          Undo last pick
        </Button>
      </Stack>

      <Dialog open={confirmUndo} onClose={() => setConfirmUndo(false)} aria-labelledby="undo-title">
        <DialogTitle id="undo-title">Undo the last pick?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {lastPick
              ? `Pick ${lastPick.pick_no}: ${lastPick.player_name} (team ${lastPick.team_id}) goes back into the pool.`
              : 'The most recent pick goes back into the pool.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmUndo(false)} color="inherit">
            Keep it
          </Button>
          <Button onClick={undo} variant="contained" color="error">
            Undo pick
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={notice != null}
        autoHideDuration={notice?.severity === 'error' ? 6000 : 2500}
        onClose={(_, reason) => reason !== 'clickaway' && setNotice(null)}
        sx={{ top: `calc(${SAFE_TOP} + 8px) !important` }}
      >
        <Alert severity={notice?.severity ?? 'info'} variant="filled" onClose={() => setNotice(null)} sx={{ width: '100%' }}>
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  );
}
