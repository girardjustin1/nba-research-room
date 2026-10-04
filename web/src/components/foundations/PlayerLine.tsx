import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LocalHospitalOutlinedIcon from '@mui/icons-material/LocalHospitalOutlined';
import type { PlayerRef } from '../../api/season';
import { pct } from '../../lib/format';
import { PlayerAvatar, TeamBadge } from './avatars/PlayerAvatar';
import { STATUS_LABEL, positionsLabel } from './seasonFormat';

/** Injury/status as icon + words + the engine's play probability and minutes cap. */
export function StatusChip({ player, showHealthy = false }: { player: PlayerRef; showHealthy?: boolean }) {
  const s = player.status;
  if (s.code === 'healthy' && !showHealthy) return null;
  const parts = [STATUS_LABEL[s.code]];
  if (s.code !== 'healthy' && s.code !== 'out') parts.push(s.play_prob == null ? 'plays: unknown' : `plays ${pct(s.play_prob)}`);
  if (s.minutes_cap != null) parts.push(`cap ${s.minutes_cap} min`);
  const bad = s.code === 'out' || s.code === 'suspended' || s.code === 'doubtful';
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<LocalHospitalOutlinedIcon />}
      label={parts.join(' · ')}
      color={bad ? 'error' : s.code === 'healthy' ? 'default' : 'warning'}
      sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
    />
  );
}

export interface PlayerLineProps {
  player: PlayerRef;
  /** Leading marker, e.g. "+" / "−" for add/drop. */
  prefix?: ReactNode;
  detail?: ReactNode;
  size?: number;
  onOpen?: (player: PlayerRef) => void;
  trailing?: ReactNode;
}

/** A player row: face, name, positions · team, optional detail; tappable when `onOpen` is set. */
export function PlayerLine({ player, prefix, detail, size = 36, onOpen, trailing }: PlayerLineProps) {
  const body = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, width: '100%', minHeight: 44, textAlign: 'left' }}>
      {prefix && (
        <Typography component="span" aria-hidden sx={{ width: 14, flexShrink: 0, fontWeight: 700, color: 'text.secondary', textAlign: 'center' }}>
          {prefix}
        </Typography>
      )}
      <PlayerAvatar name={player.name} headshotUrl={player.headshot_url} size={size} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600, color: 'text.primary' }}>
          {player.name}
        </Typography>
        <Typography variant="caption" component="p" noWrap sx={{ color: 'text.secondary' }}>
          {positionsLabel(player.eligible)} · <TeamBadge abbr={player.team_abbr} logoUrl={player.team_logo_url} />
          {detail ? <> · {detail}</> : null}
        </Typography>
      </Box>
      {trailing}
      {onOpen && <ChevronRightIcon sx={{ color: 'text.secondary', flexShrink: 0 }} aria-hidden />}
    </Box>
  );
  if (!onOpen) return body;
  return (
    <ButtonBase
      onClick={() => onOpen(player)}
      aria-label={`Open analysis for ${player.name}`}
      sx={{ display: 'flex', width: '100%', borderRadius: 1, justifyContent: 'flex-start' }}
    >
      {body}
    </ButtonBase>
  );
}
