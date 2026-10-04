import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Category, MyTeam } from '../../../api/types';
import { eligibleLabel, fixed, pct } from '../../../lib/format';
import { CategoryOddsChart } from '../../foundations/charts/CategoryOddsChart';
import { PlayerAvatar } from '../../foundations/avatars/PlayerAvatar';
import { PuntChips } from './PuntChips';

export interface MyTeamPanelProps {
  myTeam: MyTeam;
  categories: Category[];
  punts: string[];
  rounds?: number;
  onPuntsChange?: (punts: string[]) => void;
  puntsBusy?: boolean;
}

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card sx={{ p: 1.5, flex: 1, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 600, lineHeight: 1.2 }}>{value}</Typography>
      {note && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {note}
        </Typography>
      )}
    </Card>
  );
}

/**
 * My roster with eligible positions, open starting slots, the engine's expected categories
 * won and P(win week) vs a league-average team, the category odds chart, and punt toggles.
 */
export function MyTeamPanel({ myTeam, categories, punts, rounds, onPuntsChange, puntsBusy }: MyTeamPanelProps) {
  const { roster, open_slots: openSlots } = myTeam;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.25}>
        <StatTile label="Expected categories won" value={fixed(myTeam.expected_cats, 1)} note={`of ${categories.length}`} />
        <StatTile label="P(win week)" value={pct(myTeam.p_win_week)} note="vs league average" />
      </Stack>

      <Card sx={{ p: 1.5 }}>
        <CategoryOddsChart pCat={myTeam.p_cat} categories={categories} punts={punts} />
      </Card>

      <Card sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" component="h3">
          Open starting slots
        </Typography>
        {openSlots.length ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
            {openSlots.map((s, i) => (
              <Chip key={`${s}-${i}`} label={s} size="small" variant="outlined" />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Every starting slot is filled.
          </Typography>
        )}
      </Card>

      <Card sx={{ p: 0 }}>
        <Box sx={{ px: 1.5, pt: 1.5 }}>
          <Typography variant="subtitle2" component="h3">
            Roster{rounds ? ` · ${roster.length} of ${rounds}` : ` · ${roster.length}`}
          </Typography>
        </Box>
        {roster.length ? (
          <List dense disablePadding>
            {roster.map((p, i) => (
              <Box key={p.player_id}>
                {i > 0 && <Divider component="li" />}
                <ListItem sx={{ minHeight: 52 }}>
                  <ListItemAvatar sx={{ minWidth: 48 }}>
                    <PlayerAvatar name={p.name} headshotUrl={p.headshot_url} size={36} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={p.name}
                    secondary={`${eligibleLabel(p.eligible, p.position)} · ${p.team_abbr ?? '—'}`}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                  <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1, flexShrink: 0 }}>
                    Tier {p.tier ?? '—'}
                  </Typography>
                </ListItem>
              </Box>
            ))}
          </List>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary', px: 1.5, pb: 1.5, pt: 0.5 }}>
            No players yet. Your first pick shows up here.
          </Typography>
        )}
      </Card>

      {onPuntsChange && (
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
            Punts
          </Typography>
          <PuntChips categories={categories} value={punts} onChange={onPuntsChange} disabled={puntsBusy} />
        </Card>
      )}
    </Stack>
  );
}
