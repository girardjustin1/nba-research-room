import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import AlarmOutlinedIcon from '@mui/icons-material/AlarmOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SportsBasketballOutlinedIcon from '@mui/icons-material/SportsBasketballOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { useColorScheme } from '@mui/material/styles';
import type { Session } from '../api/types';
import { clock } from '../lib/format';
import { SAFE_TOP } from '../lib/layout';
import { usePickClock } from '../lib/pickClock';
import { upcomingPicks } from '../lib/session';
import { useResolvedMode } from '../theme/viz';

export interface DraftHeaderProps {
  session: Session;
  /** From the board when available (my decision pick); falls back to my_picks. */
  decisionPick?: number | null;
  /** Injected for stories/tests; defaults to Date.now. */
  now?: () => number;
}


function ColorModeToggle() {
  const { setMode } = useColorScheme();
  const resolved = useResolvedMode();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip title={`Switch to ${next} mode`}>
      <IconButton aria-label={`Switch to ${next} mode`} onClick={() => setMode(next)} sx={{ color: 'inherit', mr: -1 }}>
        {resolved === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  );
}

/**
 * Compact sticky top bar: round / pick, who is on the clock, a 60-second local pick clock
 * that restarts when the current pick changes, picks until my turn, and my next two picks.
 * When I am on the clock the whole bar turns solid primary with an icon and the words
 * "You're on the clock", so it never relies on color alone.
 */
export function DraftHeader({ session, decisionPick, now }: DraftHeaderProps) {
  const total = session.pick_clock_seconds;
  const left = usePickClock(total, session.current_pick, now);
  const complete = session.current_pick == null;
  const mine = !complete && session.on_the_clock != null && session.on_the_clock === session.my_slot;
  const upcoming = upcomingPicks(session);
  const next = decisionPick ?? upcoming[0] ?? null;
  const until = !complete && next != null && session.current_pick != null ? next - session.current_pick : null;
  const round = complete ? null : Math.ceil((session.current_pick ?? 1) / session.teams);
  const low = !complete && left <= 10;
  const frac = total > 0 ? left / total : 0;

  return (
    <Box
      component="header"
      sx={[
        {
          position: 'sticky',
          top: 0,
          zIndex: 'appBar',
          pt: SAFE_TOP,
          px: 2,
          pb: 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottom: 1,
          borderColor: 'divider',
        },
        mine && { bgcolor: 'primary.main', color: 'primary.contrastText', borderColor: 'primary.main' },
      ]}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minHeight: 44 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {complete ? (
            <Typography variant="subtitle1" component="p">
              Draft complete
            </Typography>
          ) : (
            <Typography variant="overline" component="p" sx={{ lineHeight: 1.4, opacity: mine ? 0.9 : 0.75 }}>
              Round {round} · Pick {session.current_pick} of {session.total_picks}
            </Typography>
          )}
          {!complete && (
            <Typography
              variant={mine ? 'h6' : 'subtitle1'}
              component="p"
              role="status"
              aria-live="assertive"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 700, lineHeight: 1.25 }}
            >
              {mine ? <AlarmOutlinedIcon fontSize="small" aria-hidden /> : <SportsBasketballOutlinedIcon fontSize="small" aria-hidden sx={{ opacity: 0.7 }} />}
              {mine ? "You're on the clock" : `Team ${session.on_the_clock ?? '—'} on the clock`}
            </Typography>
          )}
        </Box>
        {!complete && (
          <Box
            sx={{ textAlign: 'right', minWidth: 64 }}
            role="timer"
            aria-label={`Pick clock ${clock(left)} left${low ? ', under 10 seconds' : ''}`}
          >
            <Typography
              component="p"
              className="tabular"
              sx={[
                { fontSize: mine ? 26 : 20, fontWeight: 700, lineHeight: 1.1, display: 'inline-flex', alignItems: 'center', gap: 0.5 },
                low && !mine && { color: 'error.main' },
              ]}
            >
              {low && <TimerOutlinedIcon fontSize="small" aria-hidden />}
              {clock(left)}
            </Typography>
            <Typography variant="caption" component="p" sx={{ opacity: 0.8, lineHeight: 1.2 }}>
              {low ? 'hurry' : 'local clock'}
            </Typography>
          </Box>
        )}
        <ColorModeToggle />
      </Stack>
      {!complete && (
        <>
          <Box aria-hidden sx={{ mt: 0.75, height: 3, borderRadius: 2, bgcolor: mine ? 'rgba(255,255,255,0.3)' : 'divider', overflow: 'hidden' }}>
            <Box
              sx={[
                { height: '100%', width: `${frac * 100}%`, bgcolor: mine ? 'primary.contrastText' : 'text.secondary', transition: 'width 250ms linear' },
                low && !mine && { bgcolor: 'error.main' },
              ]}
            />
          </Box>
          <Typography variant="caption" component="p" className="tabular" sx={{ mt: 0.5, opacity: mine ? 0.95 : 0.85 }}>
            {session.my_slot == null
              ? 'No draft slot set'
              : mine
                ? `Your next picks: ${upcoming.join(', ') || '—'}`
                : until != null
                  ? `${until} pick${until === 1 ? '' : 's'} until your turn · your next: ${upcoming.join(', ') || '—'}`
                  : 'No picks left for you'}
          </Typography>
        </>
      )}
    </Box>
  );
}
