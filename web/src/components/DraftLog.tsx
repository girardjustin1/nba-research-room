import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined';
import type { PickRecord } from '../api/types';

export interface DraftLogProps {
  picks: PickRecord[];
  mySlot: number | null;
  /** How many recent picks to show (newest first). */
  limit?: number;
}

/** Recent picks, newest first. My picks get a tinted row and a "You" chip (not color alone). */
export function DraftLog({ picks, mySlot, limit = 40 }: DraftLogProps) {
  const recent = [...picks].sort((a, b) => b.pick_no - a.pick_no).slice(0, limit);
  return (
    <Box>
      <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
        Draft log
      </Typography>
      {recent.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No picks yet.
        </Typography>
      ) : (
        <List dense disablePadding sx={{ bgcolor: 'background.paper', borderRadius: 2, border: 1, borderColor: 'divider', overflow: 'hidden' }}>
          {recent.map((p) => {
            const mine = p.team_id === mySlot;
            return (
              <ListItem
                key={p.pick_no}
                sx={[
                  { minHeight: 44, gap: 1, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } },
                  mine && ((theme) => ({ bgcolor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.10)` })),
                ]}
              >
                <Typography variant="caption" className="tabular" sx={{ width: 34, color: 'text.secondary', flexShrink: 0 }}>
                  #{p.pick_no}
                </Typography>
                <Typography variant="caption" className="tabular" sx={{ width: 52, color: 'text.secondary', flexShrink: 0 }}>
                  R{p.round} · T{p.team_id}
                </Typography>
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: mine ? 600 : 400 }}>
                  {p.player_name}
                </Typography>
                {mine && <Chip size="small" color="primary" icon={<PersonOutlinedIcon />} label="You" />}
                {p.is_keeper && <Chip size="small" variant="outlined" label="Keeper" />}
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}
