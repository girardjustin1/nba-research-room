import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import CheckIcon from '@mui/icons-material/Check';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import type { Category, Session } from '../../../api/types';
import type { Practice } from '../../../api/useDraftRoom';
import { errorMessage } from '../../../api/client';
import { ordinal } from '../../../lib/format';
import { PuntChips } from '../sheet/PuntChips';
import { useAppShell } from '../../app-shell/AppShellContext';
import { SAFE_BOTTOM, SAFE_TOP } from '../../../lib/layout';
import { DraftCountdown } from '../status/DraftCountdown';

/** Chosen = filled primary (with a check), like the slot buttons and punt chips. */
const chosenSx = (t: Theme) => ({
  position: 'relative' as const,
  color: 'text.primary',
  borderColor: t.palette.mode === 'light' ? t.palette.grey[400] : t.palette.grey[700],
  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'primary.main', borderColor: 'primary.main', color: 'primary.contrastText' },
  '&.Mui-selected:hover': { bgcolor: 'primary.dark' },
});

const Check = ({ on }: { on: boolean }) =>
  on ? <CheckIcon aria-hidden sx={{ position: 'absolute', top: 3, right: 3, fontSize: 14 }} /> : null;

export interface SessionSetupProps {
  /** Existing session from the API (resume), or null when none was started. */
  session: Session | null;
  /** League size; from the session when there is one. */
  teams?: number;
  /** Categories for punt chips; from the session when there is one. */
  categories: Category[];
  onStart: (mySlot: number, punts: string[], practice?: Practice) => Promise<void>;
  /** Resume an existing session that has no slot yet (PUT /draft/slot). */
  onResume?: (mySlot: number) => Promise<void>;
  /** When the league's draft starts: a countdown above the form until then. */
  draftStartsAt?: string | null;
  now?: () => number;
  /** Stories: open with Practice chosen. */
  initialPractice?: Practice | null;
}

/**
 * Start or resume a draft: choose my draft slot (1..teams) and any punts. Starting
 * re-reads the pick log for this draft from the store, so it is safe after a restart.
 */
export function SessionSetup({ session, teams, categories, onStart, onResume, draftStartsAt, now, initialPractice = null }: SessionSetupProps) {
  const league = session?.teams ?? teams ?? 14;
  const [practice, setPractice] = useState<Practice | null>(initialPractice);
  const n = practice?.teams ?? league;
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
        {draftStartsAt && (
          <Box sx={{ borderRadius: 1, overflow: 'hidden', '& > *': { borderBottom: 0 } }}>
            <DraftCountdown startsAt={draftStartsAt} now={now} />
          </Box>
        )}
        {!resuming && (
          <Card sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" component="h2" id="kind-label" sx={{ mb: 1 }}>
              Which draft
            </Typography>
            <Box role="group" aria-labelledby="kind-label" sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
              {[
                { key: 'real', label: 'Real draft', detail: `League · ${league} teams`, on: practice == null },
                { key: 'practice', label: 'Practice', detail: 'Yahoo mock draft', on: practice != null },
              ].map((o) => (
                <ToggleButton
                  key={o.key}
                  value={o.key}
                  selected={o.on}
                  onChange={() => {
                    setPractice(o.key === 'practice' ? (practice ?? { teams: 12, rounds: 13 }) : null);
                    setSlot(null);
                  }}
                  sx={(t) => ({ ...chosenSx(t), minHeight: 56, borderRadius: '12px', flexDirection: 'column', alignItems: 'flex-start', textTransform: 'none', px: 1.5 })}
                >
                  <Check on={o.on} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {o.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: o.on ? 'inherit' : 'text.secondary' }}>
                    {o.detail}
                  </Typography>
                </ToggleButton>
              ))}
            </Box>
            {practice && (
              <>
                <Typography variant="caption" component="p" id="teams-label" sx={{ color: 'text.secondary', mt: 1.25, mb: 0.5 }}>
                  Teams in the mock room
                </Typography>
                <Box role="group" aria-labelledby="teams-label" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {[8, 10, 12, 14, 16].map((t) => (
                    <ToggleButton
                      key={t}
                      value={t}
                      selected={practice.teams === t}
                      onChange={() => {
                        setPractice({ ...practice, teams: t });
                        setSlot(null);
                      }}
                      aria-label={`${t} teams`}
                      sx={(th) => ({ ...chosenSx(th), minWidth: 48, minHeight: 44, borderRadius: '12px', fontWeight: 600 })}
                    >
                      {t}
                      <Check on={practice.teams === t} />
                    </ToggleButton>
                  ))}
                </Box>
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
                  {practice.rounds} rounds. A practice draft gets its own fresh log: nothing reaches the real draft, and
                  Yahoo's league picks never reach it.
                </Typography>
              </>
            )}
          </Card>
        )}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2" id="slot-label" sx={{ mb: 1 }}>
            My draft slot
          </Typography>
          {/* Standalone toggles in a grid (not a ToggleButtonGroup: it joins borders, which breaks
              when the slots wrap). Chosen = filled primary with a check, like the punt chips. */}
          <Box
            role="group"
            aria-labelledby="slot-label"
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.75 }}
          >
            {Array.from({ length: n }, (_, i) => i + 1).map((s) => {
              const on = slot === s;
              return (
                <ToggleButton
                  key={s}
                  value={s}
                  selected={on}
                  onChange={() => setSlot(s)}
                  aria-label={`Slot ${s}`}
                  sx={(t) => ({
                    position: 'relative',
                    minWidth: 0,
                    minHeight: 48,
                    fontSize: 16,
                    fontWeight: 600,
                    borderRadius: '12px',
                    color: 'text.primary',
                    borderColor: t.palette.mode === 'light' ? t.palette.grey[400] : t.palette.grey[700],
                    '&.Mui-selected, &.Mui-selected:hover': {
                      bgcolor: 'primary.main',
                      borderColor: 'primary.main',
                      color: 'primary.contrastText',
                    },
                    '&.Mui-selected:hover': { bgcolor: 'primary.dark' },
                  })}
                >
                  {s}
                  {on && (
                    <CheckIcon aria-hidden sx={{ position: 'absolute', top: 3, right: 3, fontSize: 14 }} />
                  )}
                </ToggleButton>
              );
            })}
          </Box>
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
          onClick={() =>
            slot != null && run(() => (resuming && onResume ? onResume(slot) : onStart(slot, punts, practice ?? undefined)))
          }
        >
          {busy ? 'Starting…' : resuming ? 'Resume draft' : practice ? 'Start practice draft' : 'Start draft'}
        </Button>
      </Stack>
    </Box>
  );
}
