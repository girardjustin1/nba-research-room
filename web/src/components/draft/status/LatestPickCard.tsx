import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import type { PickInsight } from '../../../api/types';
import { roundPick } from '../../../lib/picks';
import { PositionBadge } from '../../foundations/badges/PositionBadge';

export interface LatestPickCardProps {
  insight: PickInsight;
  teams: number;
  /** Open that team's detail (Teams view). */
  onOpenTeam: (teamId: number) => void;
  onDismiss: () => void;
}

/** The live read after the newest pick. Every number and note is the engine's text. */
export function LatestPickCard({ insight, teams, onOpenTeam, onDismiss }: LatestPickCardProps) {
  return (
    <Paper elevation={6} sx={{ borderRadius: 3, overflow: 'hidden', border: 1, borderColor: 'divider' }} role="status" aria-live="polite">
      <Stack direction="row" sx={{ alignItems: 'stretch' }}>
        <ButtonBase
          onClick={() => onOpenTeam(insight.team_id)}
          aria-label={`Latest pick ${roundPick(insight.pick_no, teams)}: ${insight.team_name} took ${insight.player.name}. Open ${insight.team_name}.`}
          sx={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left', p: 1.5 }}
        >
          <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.4 }} className="tabular">
            Latest pick · {roundPick(insight.pick_no, teams)} · {insight.team_name}
          </Typography>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <PositionBadge pos={insight.player.position} />
            <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
              {insight.player.name}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
              {insight.player.team_abbr ?? ''}
            </Typography>
          </Stack>
          {insight.notes.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.25 }}>
              {insight.notes.slice(0, 4).map((n) => (
                <Typography component="li" variant="caption" key={n} sx={{ color: 'text.secondary', lineHeight: 1.35 }}>
                  {n}
                </Typography>
              ))}
            </Box>
          )}
        </ButtonBase>
        <IconButton aria-label="Dismiss latest pick" onClick={onDismiss} sx={{ alignSelf: 'flex-start' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  );
}
