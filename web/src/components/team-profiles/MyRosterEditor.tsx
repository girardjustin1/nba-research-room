import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { MyRoster, MyRosterRequest, PlayerRef } from '../../api/season';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState } from '../foundations/ScreenStates';
import { RosterPicker, UnmatchedNames } from './RosterPicker';

export interface MyRosterEditorProps {
  data: MyRoster | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSearch: (q: string) => Promise<PlayerRef[]>;
  /** Replace my roster; resolves with the saved roster (unmatched names included). */
  onSave: (body: MyRosterRequest) => Promise<MyRoster>;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
  /** Replace my roster with my draft picks (the draft room's log); rejects asking for the slot
   * when the app doesn't know it. Without it, the "Use my draft picks" card is hidden. */
  onFromDraft?: (slot?: number) => Promise<MyRoster>;
}

const fmtSaved = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * My roster, entered by hand, for when Yahoo doesn't supply it: players from the NBA list (search
 * or pasted names) and who is on the IL. Kept on this computer only, replaced on each save.
 */
export function MyRosterEditor({ data, loading, error, onRetry, onSearch, onSave, onOpenPlayer, onTabChange, onFromDraft }: MyRosterEditorProps) {
  const [players, setPlayers] = useState<PlayerRef[]>([]);
  const [il, setIl] = useState<number[]>([]);
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<MyRoster | null>(null);

  const shown = result ?? data;
  const [seen, setSeen] = useState<MyRoster | null>(null);
  if (shown !== seen) {
    setSeen(shown);
    if (shown) {
      setPlayers(shown.players);
      setIl(shown.il_ids);
    }
  }

  const names = useMemo(() => paste.split('\n').map((s) => s.trim()).filter(Boolean), [paste]);
  const ids = players.map((p) => p.player_id);
  const ilNow = il.filter((i) => ids.includes(i));
  const changed =
    shown != null &&
    (names.length > 0 ||
      ids.join() !== shown.players.map((p) => p.player_id).join() ||
      [...ilNow].sort().join() !== [...shown.il_ids].sort().join());
  const tooMany = shown != null && players.length > shown.max_players;

  // "Use my draft picks": confirm before replacing a roster, and ask for the slot if needed.
  const [fd, setFd] = useState<{ open: boolean; askSlot: boolean; slot: number | ''; busy: boolean; error: string | null }>({
    open: false, askSlot: false, slot: '', busy: false, error: null,
  });
  const fromDraft = (slot?: number) => {
    if (!onFromDraft) return;
    setFd((f) => ({ ...f, busy: true, error: null }));
    onFromDraft(slot).then(
      (r) => {
        setResult(r);
        setFd({ open: false, askSlot: false, slot: '', busy: false, error: null });
      },
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Reading your draft picks failed';
        const askSlot = /slot/i.test(msg) && slot == null;
        setFd((f) => ({ ...f, open: true, askSlot: askSlot || f.askSlot, busy: false, error: askSlot ? null : msg }));
      },
    );
  };
  const startFromDraft = () => (players.length > 0 ? setFd((f) => ({ ...f, open: true, error: null })) : fromDraft());

  const save = () => {
    setSaving(true);
    setSaveError(null);
    onSave({ player_ids: ids, names, il_ids: ilNow }).then(
      (r) => {
        setResult(r);
        setPaste('');
        setPasting(false);
        setSaving(false);
      },
      (e: unknown) => {
        setSaveError(e instanceof Error ? e.message : 'Saving failed');
        setSaving(false);
      },
    );
  };

  const header = (
    <ScreenHeader
      title="My roster"
      subtitle={shown ? `${players.length} of ${shown.max_players} players${ilNow.length ? ` · ${ilNow.length} on IL` : ''}` : undefined}
    />
  );
  let body;
  if (error && !shown) body = <ErrorState message={error} onRetry={onRetry} what="your roster" />;
  else if (!shown) body = <LoadingState blocks={[300, 120]} label={loading ? 'Loading your roster' : 'Loading'} />;
  else {
    body = (
      <Stack spacing={1.5}>
        {onFromDraft && (
          <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" component="h2">
                Just drafted?
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Fill this in from your picks in the draft room.
              </Typography>
            </Box>
            <Button variant="outlined" onClick={startFromDraft} disabled={fd.busy}>
              {fd.busy && !fd.open ? 'Reading…' : 'Use my draft picks'}
            </Button>
          </Card>
        )}
        {fd.error && !fd.open && <Alert severity="error">{fd.error}</Alert>}
        <UnmatchedNames unmatched={shown.unmatched} />
        {saveError && <Alert severity="error">{saveError}</Alert>}
        {tooMany && <Alert severity="error">A roster holds at most {shown.max_players} players: remove {players.length - shown.max_players}.</Alert>}
        <RosterPicker
          title="Your players"
          countLabel={`${players.length} of ${shown.max_players}`}
          players={players}
          onPlayersChange={setPlayers}
          owner="mine"
          paste={paste}
          onPasteChange={setPaste}
          pasting={pasting}
          onPastingChange={setPasting}
          onSearch={onSearch}
          onOpenPlayer={onOpenPlayer}
          extra={(p) => {
            const on = il.includes(p.player_id);
            return (
              <Chip
                label="IL"
                size="small"
                color={on ? 'warning' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                aria-pressed={on}
                aria-label={`${p.name} on IL`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIl((xs) => (on ? xs.filter((x) => x !== p.player_id) : [...xs, p.player_id]));
                }}
                sx={{ mr: 0.5 }}
              />
            );
          }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', color: 'text.secondary' }}>
          <InfoOutlinedIcon fontSize="small" sx={{ mt: 0.25 }} aria-hidden />
          <Typography variant="caption">{shown.policy}</Typography>
        </Box>
      </Stack>
    );
  }
  const footer =
    shown != null ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1 }}>
        <Typography variant="caption" sx={{ flex: 1, color: 'text.secondary' }}>
          {shown.saved_at ? `Saved ${fmtSaved(shown.saved_at)}` : 'Not saved yet'}
        </Typography>
        <Button variant="contained" onClick={save} disabled={!changed || saving || tooMany}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>
    ) : undefined;
  const teams = shown?.teams ?? 14;
  return (
    <>
      <SeasonShell tab="builder" onTabChange={onTabChange} header={header} footer={footer}>
        {body}
      </SeasonShell>
      <Dialog open={fd.open} onClose={() => !fd.busy && setFd((f) => ({ ...f, open: false }))} fullWidth maxWidth="xs">
        <DialogTitle>{fd.askSlot ? 'Which draft slot was yours?' : 'Use your draft picks?'}</DialogTitle>
        <DialogContent>
          {fd.askSlot ? (
            <TextField
              select
              fullWidth
              label="My draft slot"
              value={fd.slot}
              onChange={(e) => setFd((f) => ({ ...f, slot: Number(e.target.value) }))}
              sx={{ mt: 1 }}
            >
              {Array.from({ length: teams }, (_, i) => i + 1).map((n) => (
                <MenuItem key={n} value={n}>
                  Slot {n}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2">
              This replaces the {players.length} players here with your picks from the draft room, and clears the IL marks.
            </Typography>
          )}
          {fd.error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {fd.error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFd((f) => ({ ...f, open: false }))} disabled={fd.busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={fd.busy || (fd.askSlot && fd.slot === '')}
            onClick={() => fromDraft(fd.askSlot && fd.slot !== '' ? fd.slot : undefined)}
          >
            {fd.busy ? 'Reading…' : fd.askSlot ? 'Use these picks' : 'Replace'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
