import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListSubheader from '@mui/material/ListSubheader';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { PoolPlayer } from '../api/types';
import { eligibleLabel, fixed } from '../lib/format';
import { PlayerAvatar } from './PlayerAvatar';

export interface TierBoardProps {
  /** GET /draft/players (available only). Drafted players are removed here as well. */
  players: PoolPlayer[];
  /** Cap the number of tiers shown, to keep the list short during the draft. */
  maxTiers?: number;
}

const POSITIONS = ['All', 'G', 'F', 'C'] as const;
type PosFilter = (typeof POSITIONS)[number];

function matches(p: PoolPlayer, f: PosFilter): boolean {
  if (f === 'All') return true;
  const e = p.eligible ?? [];
  if (f === 'G') return e.some((s) => s === 'PG' || s === 'SG' || s === 'G');
  if (f === 'F') return e.some((s) => s === 'SF' || s === 'PF' || s === 'F');
  return e.includes('C');
}

/** Available players grouped by the engine's tiers (value cliffs), compact and scrollable. */
export function TierBoard({ players, maxTiers = 12 }: TierBoardProps) {
  const [pos, setPos] = useState<PosFilter>('All');
  const groups = useMemo(() => {
    const byTier = new Map<number | null, PoolPlayer[]>();
    for (const p of players) {
      if (p.drafted || !matches(p, pos)) continue;
      const list = byTier.get(p.tier) ?? [];
      list.push(p);
      byTier.set(p.tier, list);
    }
    return [...byTier.entries()]
      .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
      .slice(0, maxTiers)
      .map(([tier, list]) => ({ tier, list: list.sort((x, y) => (x.rank ?? Infinity) - (y.rank ?? Infinity)) }));
  }, [players, pos, maxTiers]);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
        <Typography variant="subtitle1" component="h2">
          Tiers
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={pos} onChange={(_, v: PosFilter | null) => v && setPos(v)} aria-label="Position filter">
          {POSITIONS.map((p) => (
            <ToggleButton key={p} value={p} sx={{ px: 1.5, minWidth: 44 }}>
              {p}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      {groups.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No available players{pos !== 'All' ? ` at ${pos}` : ''}.
        </Typography>
      ) : (
        <List dense disablePadding sx={{ bgcolor: 'background.paper', borderRadius: 2, border: 1, borderColor: 'divider' }}>
          {groups.map(({ tier, list }) => (
            <li key={String(tier)}>
              <Box component="ul" sx={{ p: 0 }}>
                <ListSubheader
                  sx={{
                    top: 0,
                    lineHeight: '36px',
                    bgcolor: 'background.default',
                    color: 'text.secondary',
                    fontWeight: 600,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  {tier == null ? 'No tier' : `Tier ${tier}`} · {list.length} left
                </ListSubheader>
                {list.map((p) => (
                  <ListItem key={p.player_id} sx={{ minHeight: 44, gap: 1 }}>
                    <Typography variant="caption" className="tabular" sx={{ width: 28, color: 'text.secondary', flexShrink: 0 }}>
                      {p.rank ?? '—'}
                    </Typography>
                    <PlayerAvatar name={p.name} headshotUrl={p.headshot_url} size={28} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                        {p.name}
                      </Typography>
                    </Box>
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary', flexShrink: 0, maxWidth: 96 }}>
                      {eligibleLabel(p.eligible, p.position)} · {p.team_abbr ?? '—'}
                    </Typography>
                    <Typography variant="caption" className="tabular" sx={{ width: 36, textAlign: 'right', flexShrink: 0 }}>
                      {fixed(p.value, 1)}
                    </Typography>
                  </ListItem>
                ))}
              </Box>
            </li>
          ))}
        </List>
      )}
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
        Rank, name, positions, team, season value (engine z-score sum).
      </Typography>
    </Box>
  );
}
