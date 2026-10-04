import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Recommendation } from '../../../api/types';
import { signed } from '../../../lib/format';
import { TeamBadge } from '../../foundations/avatars/PlayerAvatar';
import { PositionBadge } from '../../foundations/badges/PositionBadge';

export interface SuggestedPicksProps {
  /** The board's recommendations, best first (already filtered to undrafted players). */
  recommendations: Recommendation[];
  onTheClock: boolean;
  loading?: boolean;
  pendingId?: number | null;
  onDraft: (rec: Recommendation) => void;
}

/** The board's top two, with a Draft button that only works when I am on the clock. */
export function SuggestedPicks({ recommendations, onTheClock, loading, pendingId, onDraft }: SuggestedPicksProps) {
  const top = recommendations.slice(0, 2);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" component="h2" sx={{ lineHeight: 1.2, mb: 0.75 }}>
        Suggested picks
      </Typography>
      {loading && top.length === 0 ? (
        <Stack spacing={1}>
          <Skeleton variant="rounded" height={52} />
          <Skeleton variant="rounded" height={52} />
        </Stack>
      ) : top.length === 0 ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          No suggestions right now.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {top.map((r) => (
            <Stack key={r.player_id} direction="row" sx={{ alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {r.name}
                </Typography>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: 'text.secondary', minWidth: 0 }}>
                  <PositionBadge pos={r.position} />
                  <Typography variant="caption" noWrap component="span">
                    <TeamBadge abbr={r.team_abbr} logoUrl={r.team_logo_url} size={12} /> · {signed(r.gain)}
                  </Typography>
                </Stack>
              </Box>
              <Button
                variant="contained"
                size="small"
                disabled={!onTheClock || pendingId != null}
                onClick={() => onDraft(r)}
                aria-label={onTheClock ? `Draft ${r.name}` : `Draft ${r.name} (only when you are on the clock)`}
                sx={{ minWidth: 60, minHeight: 44, px: 1 }}
              >
                {pendingId === r.player_id ? '…' : 'Draft'}
              </Button>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
