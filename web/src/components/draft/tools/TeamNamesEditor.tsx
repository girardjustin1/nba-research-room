import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ApiError, errorMessage } from '../../../api/client';
import type { Session } from '../../../api/types';
import { FullScreenPanel } from '../../app-shell/FullScreenPanel';

export interface TeamNamesEditorProps {
  open: boolean;
  session: Session;
  onClose: () => void;
  onSave: (names: Record<string, string>) => Promise<void>;
}

/** Edit the league's team names (one per draft slot), saved per draft by the API. */
export function TeamNamesEditor({ open, session, onClose, onSave }: TeamNamesEditorProps) {
  return (
    <FullScreenPanel open={open} title="Team names" onClose={onClose}>
      {open && <Form session={session} onClose={onClose} onSave={onSave} />}
    </FullScreenPanel>
  );
}

function Form({ session, onClose, onSave }: Omit<TeamNamesEditorProps, 'open'>) {
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(Array.from({ length: session.teams }, (_, i) => [String(i + 1), session.team_names?.[String(i + 1)] ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.trim()])));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={1.5} sx={{ p: 2 }} component="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Names as they appear in the Yahoo draft room, by draft slot. Leave one blank for "Team N".
      </Typography>
      {Object.keys(names).map((slot) => {
        const mine = Number(slot) === session.my_slot;
        return (
          <TextField
            key={slot}
            label={`Slot ${slot}${mine ? ' (you)' : ''}`}
            value={names[slot] ?? ''}
            onChange={(e) => setNames((n) => ({ ...n, [slot]: e.target.value }))}
            placeholder={mine ? 'You' : `Team ${slot}`}
            slotProps={{ htmlInput: { maxLength: 40, autoCapitalize: 'words', autoCorrect: 'off', enterKeyHint: 'next' } }}
            fullWidth
          />
        );
      })}
      {error != null && (
        <Alert severity="error" role="alert">
          {error instanceof ApiError && error.isNotFound
            ? 'Saving names needs the updated draft API (PUT /draft/teams/names is not there yet).'
            : errorMessage(error)}
        </Alert>
      )}
      <Button type="submit" size="large" variant="contained" disabled={busy}>
        {busy ? 'Saving…' : 'Save names'}
      </Button>
    </Stack>
  );
}
