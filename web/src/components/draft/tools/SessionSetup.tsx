import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { Category, Session } from '../../../api/types';
import { errorMessage } from '../../../api/client';
import { ordinal } from '../../../lib/format';
import { PuntChips } from '../sheet/PuntChips';
import { useAppShell } from '../../app-shell/AppShellContext';
import { SAFE_BOTTOM, SAFE_TOP } from '../../../lib/layout';

export interface SessionSetupProps {
  /** Existing session from the API (resume), or null when none was started. */
  session: Session | null;
  /** League size; from the session when there is one. */
  teams?: number;
  /** Categories for punt chips; from the session when there is one. */
  categories: Category[];
  onStart: (mySlot: number, punts: string[]) => Promise<void>;
  /** Resume an existing session that has no slot yet (PUT /draft/slot). */
  onResume?: (mySlot: number) => Promise<void>;
}

/**
 * Start or resume a draft: choose my draft slot (1..teams) and any punts. Starting
 * re-reads the pick log for this draft from the store, so it is safe after a restart.
 */
export function SessionSetup({ session, teams, categories, onStart, onResume }: SessionSetupProps) {
  const n = session?.teams ?? teams ?? 14;
  const [slot, setSlot] = useState<number | null>(session?.my_slot ?? null);
  const [punts, setPunts] = useState<string[]>(session?.punts ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resuming = session != null;
  const shell = useAppShell();

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        pt: `calc(${SAFE_TOP} + 16px)`,
        pb: `calc(${SAFE_BOTTOM} + 16px)`,
        px: 2,
        bgcolor: 'background.default',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        {shell?.menuButton}
        <Typography variant="h6" component="h1">
          {resuming ? 'Resume draft' : 'Start the draft'}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {resuming
          ? `Session ${session.draft_id} is running with ${session.picks.length} picks logged. Set your slot to continue.`
          : 'Pick your draft slot. You can change punts any time.'}
      </Typography>

      <Stack spacing={2}>
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2" id="slot-label" sx={{ mb: 1 }}>
            My draft slot
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={slot}
            onChange={(_, v: number | null) => v != null && setSlot(v)}
            aria-labelledby="slot-label"
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.75 }}
          >
            {Array.from({ length: n }, (_, i) => i + 1).map((s) => (
              <ToggleButton
                key={s}
                value={s}
                aria-label={`Slot ${s}`}
                sx={{
                  minWidth: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  // ToggleButtonGroup joins borders; give each its own in a grid.
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: '10px !important',
                  ml: '0 !important',
                }}
              >
                {s}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
            {slot ? `Slot ${slot}: you pick ${ordinal(slot)} in round 1.` : 'Not chosen yet.'}
          </Typography>
        </Card>

        {!resuming && (
          <Card sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>
              Punts (optional)
            </Typography>
            <PuntChips categories={categories} value={punts} onChange={setPunts} disabled={busy} />
          </Card>
        )}

        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}

        <Button
          size="large"
          variant="contained"
          disabled={slot == null || busy}
          onClick={() => slot != null && run(() => (resuming && onResume ? onResume(slot) : onStart(slot, punts)))}
        >
          {busy ? 'Starting…' : resuming ? 'Resume draft' : 'Start draft'}
        </Button>
      </Stack>
    </Box>
  );
}
