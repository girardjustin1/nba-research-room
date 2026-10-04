import Box from '@mui/material/Box';
import { GROUP_COLORS, positionGroup } from '../../../lib/positions';
import { useResolvedMode } from '../../../theme/viz';

export interface PositionBadgeProps {
  /** Primary position, e.g. "PG". Printed as text, so color is never the only cue. */
  pos: string | null | undefined;
  size?: 'small' | 'medium';
}

/** Position tag: a group-colored square key plus the position in ink. */
export function PositionBadge({ pos, size = 'small' }: PositionBadgeProps) {
  const mode = useResolvedMode();
  const g = positionGroup(pos);
  const color = g ? GROUP_COLORS[mode][g] : 'transparent';
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        height: size === 'small' ? 20 : 24,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        fontSize: size === 'small' ? 12 : 13,
        fontWeight: 700,
        lineHeight: 1,
        color: 'text.primary',
        bgcolor: 'background.paper',
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: color }} />
      {pos ?? '—'}
    </Box>
  );
}
