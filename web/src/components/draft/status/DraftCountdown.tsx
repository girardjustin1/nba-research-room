import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { countdownLabel, draftStartLabel, SOON_MS } from './countdown';

export interface DraftCountdownProps {
  /** When the league's draft starts (GET /health `draft_starts_at`); nothing shows without it. */
  startsAt: string | null | undefined;
  /** Stories and tests: a fixed clock. */
  now?: () => number;
}

/**
 * "Draft in 2d 21h 14m · Sun Oct 18, 7:00 pm ET": a countdown to the league's draft, ticking every
 * second, amber in the last 15 minutes, gone once the draft has started.
 */
export function DraftCountdown({ startsAt, now = Date.now }: DraftCountdownProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000); // re-render each second; the clock is read below
    return () => clearInterval(id);
  }, []);
  if (!startsAt) return null;
  const left = new Date(startsAt).getTime() - now();
  if (!Number.isFinite(left) || left <= 0) return null;
  const soon = left <= SOON_MS;
  const label = countdownLabel(left);
  return (
    <Box
      role="timer"
      aria-label={`Draft starts in ${label}, ${draftStartLabel(startsAt)}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 2,
        py: 0.75,
        bgcolor: soon ? 'warning.main' : 'action.hover',
        color: soon ? 'warning.contrastText' : 'text.primary',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <TimerOutlinedIcon fontSize="small" aria-hidden sx={{ color: soon ? 'inherit' : 'primary.main' }} />
      <Typography variant="body2" component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        Draft in {label}
      </Typography>
      <Typography variant="caption" component="span" sx={{ color: soon ? 'inherit' : 'text.secondary', ml: 'auto', textAlign: 'right' }}>
        {draftStartLabel(startsAt)}
      </Typography>
    </Box>
  );
}
