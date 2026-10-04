import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import ModelTrainingOutlinedIcon from '@mui/icons-material/ModelTrainingOutlined';
import NewReleasesOutlinedIcon from '@mui/icons-material/NewReleasesOutlined';
import NewspaperOutlinedIcon from '@mui/icons-material/NewspaperOutlined';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import SportsBasketballOutlinedIcon from '@mui/icons-material/SportsBasketballOutlined';
import type { IsoDate, IsoDateTime, NotificationPriority, SeasonCategory, SeasonNotification } from '../../api/season';
import { forMeSymbol, forMeWord } from '../../theme/viz';
import { ConfidenceChip } from '../foundations/Confidence';
import { ago, catDeltaLine, deadlineLabel, etClock, ptsDelta, weekdayOf } from '../foundations/seasonFormat';

export interface AlertCardProps {
  n: SeasonNotification;
  today: IsoDate;
  now: IsoDateTime;
  categories: SeasonCategory[];
  onAction?: (n: SeasonNotification) => void;
}

/** Priority uses the reserved status colors, always with an icon and a word. */
const PRIORITY: Record<NotificationPriority, { label: string; color: 'error' | 'warning' | 'info' | 'inherit'; icon: React.ReactElement }> = {
  urgent: { label: 'Urgent', color: 'error', icon: <NewReleasesOutlinedIcon fontSize="small" /> },
  high: { label: 'High', color: 'warning', icon: <ReportProblemOutlinedIcon fontSize="small" /> },
  normal: { label: 'Normal', color: 'info', icon: <InfoOutlinedIcon fontSize="small" /> },
  low: { label: 'FYI', color: 'inherit', icon: <InfoOutlinedIcon fontSize="small" /> },
};

const KIND_ICON = {
  waiver: <PersonAddAltOutlinedIcon fontSize="small" />,
  injury: <EventBusyOutlinedIcon fontSize="small" />,
  news: <NewspaperOutlinedIcon fontSize="small" />,
  lineup_lock: <LockClockOutlinedIcon fontSize="small" />,
  game_day: <SportsBasketballOutlinedIcon fontSize="small" />,
  model: <ModelTrainingOutlinedIcon fontSize="small" />,
} as const;

const KIND_LABEL = { waiver: 'Waivers', injury: 'Injury', news: 'News', lineup_lock: 'Lineup lock', game_day: 'Game day', model: 'Models' } as const;

const CLAIM_LABEL = { pending: 'Pending', cleared: 'Cleared', lost: 'Lost', cancelled: 'Cancelled' } as const;

/**
 * One alert: priority (status color + icon + word), kind, time, the engine's body, the
 * effect on my week (▲ / ▼ + words), waiver-claim status when it is a claim, the deadline,
 * and one action into the app.
 */
export function AlertCard({ n, today, now, categories, onAction }: AlertCardProps) {
  const p = PRIORITY[n.priority];
  const paletteColor = p.color === 'inherit' ? 'text.secondary' : `${p.color}.main`;
  return (
    <Card
      component="li"
      sx={{ listStyle: 'none', p: 1.5, borderLeft: 4, borderLeftColor: paletteColor, bgcolor: n.read ? 'background.paper' : 'action.hover' }}
      aria-label={`${p.label} ${KIND_LABEL[n.kind]}: ${n.title}${n.read ? '' : ', unread'}`}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, color: 'text.secondary', flexWrap: 'wrap' }}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: p.color === 'inherit' ? 'text.secondary' : `${p.color}.dark`, fontWeight: 700, fontSize: 13 }}>
          {p.icon}
          {p.label}
        </Box>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, fontSize: 13 }}>
          · {KIND_ICON[n.kind]} {KIND_LABEL[n.kind]}
        </Box>
        <Typography variant="caption" className="tabular" sx={{ ml: 'auto' }}>
          {etClock(n.created_at)} · {ago(n.created_at, now)}
        </Typography>
      </Stack>
      <Typography variant="subtitle2" component="h3" sx={{ mt: 0.5, fontWeight: n.read ? 600 : 800 }}>
        {!n.read && (
          <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mr: 0.75, verticalAlign: 'middle' }} />
        )}
        {n.title}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25 }}>
        {n.body}
      </Typography>
      {n.impact && (
        <Box sx={{ mt: 0.75 }}>
          <Typography variant="body2" className="tabular" sx={{ fontWeight: 700 }}>
            {forMeSymbol(n.impact.delta_p_win, 0.002)} P(win week) {ptsDelta(n.impact.delta_p_win)} · {forMeWord(n.impact.delta_p_win, 0.002)}
          </Typography>
          {n.impact.cat_deltas.length > 0 && (
            <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary' }}>
              {catDeltaLine(n.impact.cat_deltas, categories, 3)}
            </Typography>
          )}
        </Box>
      )}
      {n.claim && (
        <Typography variant="body2" sx={{ mt: 0.75 }}>
          <strong>Claim: {CLAIM_LABEL[n.claim.status]}</strong>
          {n.claim.status === 'pending'
            ? ` · clears ${n.claim.clears_in_days === 0 ? 'today' : `in ${n.claim.clears_in_days} day${n.claim.clears_in_days === 1 ? '' : 's'} (${weekdayOf(n.claim.clears_at.slice(0, 10))} ${etClock(n.claim.clears_at)})`}`
            : ''}
          {n.claim.drop ? ` · drops ${n.claim.drop.name}` : ''} · {n.claim.acquisitions_left} acquisition{n.claim.acquisitions_left === 1 ? '' : 's'} left
        </Typography>
      )}
      {n.deadline && (
        <Typography variant="caption" component="p" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75, color: 'text.secondary' }}>
          <ScheduleOutlinedIcon sx={{ fontSize: 15 }} aria-hidden />
          {deadlineLabel(n.deadline, today)}
        </Typography>
      )}
      <Stack direction="row" sx={{ gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {n.action && onAction && (
          <Button variant={n.priority === 'urgent' ? 'contained' : 'outlined'} color={n.priority === 'urgent' ? 'error' : 'primary'} onClick={() => onAction(n)} sx={{ flex: 1 }}>
            {n.action.label}
          </Button>
        )}
        {n.impact && <ConfidenceChip confidence={n.impact.confidence} compact />}
      </Stack>
    </Card>
  );
}
