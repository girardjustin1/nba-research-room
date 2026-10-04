import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AlarmOutlinedIcon from '@mui/icons-material/AlarmOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import HourglassBottomOutlinedIcon from '@mui/icons-material/HourglassBottomOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined';
import type { Session } from '../../../api/types';
import type { Connection } from '../../../api/useDraftRoom';
import { clock } from '../../../lib/format';
import { SAFE_TOP } from '../../../lib/layout';
import { myNextPick, roundPickLong, teamName } from '../../../lib/picks';
import { usePickClock } from '../../../lib/pickClock';
import { agoLabel, useNow } from '../../../lib/useNow';
import { STATUS, useResolvedMode } from '../../../theme/viz';

/**
 * Bar fills, white text on both (>= 4.5:1). "On the clock" is the deep status crimson in BOTH
 * modes so it always reads as urgent red (dark mode's status error is a light rose, too soft
 * for a full-width bar); it sits dE 20.5 / 25.1 from forMe bad, so it never looks like a heat cell.
 */
const BAR = { light: { waiting: '#256abf', clock: STATUS.light.error }, dark: { waiting: '#1c5cab', clock: STATUS.light.error } };

export interface StatusBarProps {
  session: Session;
  /** My decision pick from the board (falls back to my_picks). */
  decisionPick?: number | null;
  connection: Connection;
  /** When the app last saw the current pick change. */
  lastPickSeenAt: number | null;
  onEnterPick: () => void;
  /** Opens the draft tools menu (right). */
  onMenu: () => void;
  /** The app's left ☰ (experience drawer), from the app shell; absent in plain stories. */
  leading?: React.ReactNode;
  /** Demo build: shown in place of the Yahoo listener status. */
  demoBadge?: React.ReactNode;
  now?: () => number;
}

/**
 * Sticky top bar. Red "On the clock" or blue "Up in N picks", the current pick as round.pick,
 * a local 60 s pick clock (Yahoo's is authoritative), and the listener status: picks arrive
 * from the Tampermonkey listener in the Yahoo draft room; manual entry is the fallback.
 */
export function StatusBar({ session, decisionPick, connection, lastPickSeenAt, onEnterPick, onMenu, leading, demoBadge, now }: StatusBarProps) {
  const mode = useResolvedMode();
  const left = usePickClock(session.pick_clock_seconds, session.current_pick, now);
  const t = useNow(1000, now);
  const current = session.current_pick;
  const complete = current == null;
  const mine = !complete && session.on_the_clock != null && session.on_the_clock === session.my_slot;
  const next = decisionPick ?? myNextPick(session);
  const until = current != null && next != null ? next - current : null;
  const low = !complete && left <= 10;

  return (
    <Box
      component="header"
      sx={[
        { position: 'relative', zIndex: 'appBar', pt: SAFE_TOP, px: 2, pb: 1, flexShrink: 0 },
        complete
          ? { bgcolor: 'background.paper', color: 'text.primary', borderBottom: 1, borderColor: 'divider' }
          : mine
            ? { bgcolor: BAR[mode].clock, color: '#fff' }
            : { bgcolor: BAR[mode].waiting, color: '#fff' },
      ]}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minHeight: 48 }}>
        {leading}
        <Box sx={{ flex: 1, minWidth: 0 }} role="status" aria-live="assertive">
          <Typography
            component="p"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 800, fontSize: mine ? 22 : 19, lineHeight: 1.15 }}
          >
            {complete ? null : mine ? <AlarmOutlinedIcon aria-hidden /> : <HourglassBottomOutlinedIcon aria-hidden fontSize="small" />}
            {complete
              ? 'Draft complete'
              : mine
                ? 'On the clock'
                : until != null
                  ? `Up in ${until} pick${until === 1 ? '' : 's'}`
                  : 'No picks left for you'}
          </Typography>
          {!complete && (
            <Typography variant="body2" component="p" className="tabular" sx={{ opacity: 0.92, mt: 0.25 }} noWrap>
              Pick {roundPickLong(current ?? 0, session.teams)} · {mine ? 'your pick' : `${teamName(session, session.on_the_clock ?? 0)} on the clock`}
            </Typography>
          )}
        </Box>
        {!complete && (
          <Box sx={{ textAlign: 'right' }} role="timer" aria-label={`Local pick clock ${clock(left)} left`}>
            <Typography component="p" className="tabular" sx={{ fontWeight: 800, fontSize: 22, lineHeight: 1.1 }}>
              {clock(left)}
            </Typography>
            <Typography variant="caption" component="p" sx={{ opacity: 0.85 }}>
              {low ? 'hurry' : 'local clock'}
            </Typography>
          </Box>
        )}
        <IconButton aria-label="Draft tools" onClick={onMenu} sx={{ color: 'inherit', mr: -1.5 }}>
          <MoreVertIcon />
        </IconButton>
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 0.5 }}>
        {demoBadge ? (
          <Box sx={{ flex: 1, minWidth: 0 }}>{demoBadge}</Box>
        ) : connection === 'down' ? (
          <CloudOffOutlinedIcon fontSize="small" aria-hidden />
        ) : (
          <SensorsOutlinedIcon fontSize="small" aria-hidden sx={{ opacity: 0.85 }} />
        )}
        <Typography variant="caption" component="p" sx={{ flex: 1, minWidth: 0, opacity: 0.92, display: demoBadge ? 'none' : undefined }} noWrap>
          {connection === 'down'
            ? 'Draft API unreachable: run make draft-api'
            : lastPickSeenAt == null
              ? `Live · waiting for picks from the Yahoo listener (${session.picks.length} logged)`
              : `Live · Yahoo listener · last pick ${agoLabel(t - lastPickSeenAt)}`}
        </Typography>
        <Button
          size="small"
          onClick={onEnterPick}
          startIcon={<EditNoteOutlinedIcon />}
          sx={{ color: 'inherit', minHeight: 44, px: 1.25, border: 1, borderColor: complete ? 'divider' : 'currentColor', opacity: 0.95 }}
          disabled={complete}
        >
          Enter pick
        </Button>
      </Stack>
    </Box>
  );
}
