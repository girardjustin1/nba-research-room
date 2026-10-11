import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { errorMessage } from '../../../api/client';
import type { YahooPositions } from '../../../api/types';
import { FullScreenPanel } from '../../app-shell/FullScreenPanel';

export interface YahooPositionsEditorProps {
  open: boolean;
  onClose: () => void;
  /** How many players have Yahoo positions so far. */
  load: () => Promise<YahooPositions>;
  /** Add the positions found in the pasted text; resolves with the new totals. */
  onSave: (text: string) => Promise<YahooPositions>;
  /** Stories: open with this text already pasted. */
  initialText?: string;
}

/**
 * Yahoo's position eligibility for the board, pasted from Yahoo's Players page when the app can't
 * read Yahoo: the engine picks each name's "TEAM - PG,SG" tag out of the text and keeps only the
 * player ids and positions. Each paste adds to the list.
 */
export function YahooPositionsEditor({ open, onClose, load, onSave, initialText = '' }: YahooPositionsEditorProps) {
  return (
    <FullScreenPanel open={open} title="Yahoo positions" onClose={onClose}>
      {open && <Form load={load} onSave={onSave} initialText={initialText} />}
    </FullScreenPanel>
  );
}

function Form({ load, onSave, initialText }: Omit<YahooPositionsEditorProps, 'open' | 'onClose'>) {
  const [status, setStatus] = useState<YahooPositions | null>(null);
  const [text, setText] = useState(initialText ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<YahooPositions | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (s) => live && setStatus(s),
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await onSave(text);
      setResult(r);
      setStatus(r);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const n = status?.players ?? 0;
  return (
    <Stack spacing={1.5} sx={{ p: 2 }} component="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {n > 0
          ? `Yahoo positions for ${n} players so far; the rest use Basketball Monster's single position.`
          : "No Yahoo positions yet: the board uses each player's single Basketball Monster position."}
      </Typography>
      <Typography variant="body2">
        On Yahoo, open Players with Status “All Players”, sorted by preseason rank. Select the list and copy it, then
        paste it here; paste each page below the last (8 pages cover the top 200). Only names and their positions
        (“BOS - PG,SG”) are picked out.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {result && (
        <Alert severity="success">
          Positions for {result.found} {result.found === 1 ? 'player' : 'players'} added ({result.players} in all). The board
          now uses them.
        </Alert>
      )}
      {result && result.ambiguous.length > 0 && (
        <Alert severity="info">
          Skipped {result.ambiguous.length === 1 ? 'a name' : `${result.ambiguous.length} names`} shared by two NBA players (
          {result.ambiguous.join(', ')}).
        </Alert>
      )}
      <TextField
        multiline
        minRows={6}
        maxRows={14}
        fullWidth
        label="Yahoo's Players page"
        value={text}
        onChange={(e) => setText(e.target.value)}
        slotProps={{ htmlInput: { maxLength: 300_000 } }}
      />
      <Button type="submit" variant="contained" disabled={!text.trim() || busy}>
        {busy ? 'Reading…' : 'Add positions'}
      </Button>
      {status?.policy && (
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', color: 'text.secondary' }}>
          <InfoOutlinedIcon fontSize="small" sx={{ mt: 0.25 }} aria-hidden />
          <Typography variant="caption">{status.policy}</Typography>
        </Box>
      )}
    </Stack>
  );
}
