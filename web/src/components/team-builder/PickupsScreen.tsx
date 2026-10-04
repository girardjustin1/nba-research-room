import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import type { CategoryKey, CategoryNeed, PlayerRef, WaiverCandidate, WaiversResponse } from '../../api/season';
import { pct } from '../../lib/format';
import { AcquisitionsMeter } from '../foundations/AcquisitionsMeter';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { PlayerLine, StatusChip } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { catDeltaLine, catLabel, deadlineLabel, filterWaivers, ptsDelta, type PositionFilter } from '../foundations/seasonFormat';
import { BuilderTabs, type BuilderView } from './BuilderTabs';
import { PlayableStrip } from './PlayableStrip';

export interface PickupsScreenProps {
  waivers: WaiversResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenPlayer?: (player: PlayerRef) => void;
  onCompare?: (c: WaiverCandidate) => void;
  onTabChange?: (tab: SeasonTab) => void;
  onBuilderView?: (v: BuilderView) => void;
  initialPosition?: PositionFilter;
  initialCategory?: CategoryKey | 'all';
}

const NEED_LABEL: Record<CategoryNeed['need'], string> = { high: 'need', medium: 'could use', low: 'fine', punt: 'punt', safe: 'safe' };
const POSITIONS: PositionFilter[] = ['all', 'PG', 'SG', 'SF', 'PF', 'C'];

function CandidateCard({ c, w, onOpenPlayer, onCompare }: { c: WaiverCandidate; w: WaiversResponse; onOpenPlayer?: (p: PlayerRef) => void; onCompare?: (c: WaiverCandidate) => void }) {
  const cats = w.week.categories;
  return (
    <Card component="li" sx={{ listStyle: 'none', p: 1.5 }} aria-label={`Pickup ${c.rank}: ${c.player.name}`}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography className="tabular" sx={{ fontWeight: 700, color: 'text.secondary', width: 18 }}>
          {c.rank}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <PlayerLine
            player={c.player}
            detail={c.player.pct_rostered != null ? `${pct(c.player.pct_rostered)} rostered` : undefined}
            onOpen={onOpenPlayer}
          />
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{ptsDelta(c.delta_p_win.mean)}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            → {pct(c.p_win_after)}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mt: 0.75, alignItems: 'center' }}>
        <Chip size="small" variant="outlined" label={c.availability === 'waivers' ? 'On waivers' : 'Free agent'} />
        <StatusChip player={c.player} />
        <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
          <ScheduleOutlinedIcon sx={{ fontSize: 15 }} aria-hidden />
          {deadlineLabel(c.deadline, w.week.today)}
        </Typography>
      </Stack>
      <Typography variant="body2" className="tabular" sx={{ mt: 0.75, fontWeight: 600 }}>
        {catDeltaLine(c.cat_deltas, cats, 3)}
        <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
          {' '}
          · band {ptsDelta(c.delta_p_win.lo)} to {ptsDelta(c.delta_p_win.hi)}
        </Box>
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {c.reason}
      </Typography>
      <Box sx={{ mt: 1 }}>
        <PlayableStrip playable={c.playable} addName={c.player.name} dropName={c.drop?.name ?? null} acquisitions={w.acquisitions} />
      </Box>
      {c.drop && (
        <PlayerLine player={c.drop} prefix="−" detail={`drop · ${c.drop_games_left ?? '—'} game${c.drop_games_left === 1 ? '' : 's'} left`} onOpen={onOpenPlayer} />
      )}
      <Stack direction="row" sx={{ gap: 0.75, mt: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
        <ConfidenceChip confidence={c.confidence} />
        {c.cats_helped.length > 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Helps {c.cats_helped.map((k) => catLabel(k, cats)).join(', ')}
          </Typography>
        )}
      </Stack>
      <MissingInputs confidence={c.confidence} />
      {onCompare && c.drop && (
        <Button variant="outlined" fullWidth sx={{ mt: 1 }} onClick={() => onCompare(c)}>
          Compare with {c.drop.name}
        </Button>
      )}
    </Card>
  );
}

/**
 * Pickups for THIS week given my opponent and games left: each with its paired drop, the
 * week strip against my open slots (playable games vs raw), categories helped, deadline
 * and confidence. Filters by position and by category need; engine rank order is kept.
 */
export function PickupsScreen(props: PickupsScreenProps) {
  const { waivers: w, loading, error, onRetry, onOpenPlayer, onCompare, onTabChange, onBuilderView } = props;
  const [position, setPosition] = useState<PositionFilter>(props.initialPosition ?? 'all');
  const [category, setCategory] = useState<CategoryKey | 'all'>(props.initialCategory ?? 'all');
  const shown = useMemo(() => (w ? filterWaivers(w.candidates, position, category) : []), [w, position, category]);

  const header = (
    <ScreenHeader
      title="Pickups"
      subtitle={w ? `${w.pool_size} free agents scored · ${w.acquisitions.max - w.acquisitions.used} of ${w.acquisitions.max} acquisitions left` : undefined}
      asOf={w?.as_of}
      stale={w?.stale}
    />
  );
  let body;
  if (error && !w) body = <ErrorState message={error} onRetry={onRetry} what="pickups" />;
  else if (!w) body = <LoadingState blocks={[140, 120, 360, 360]} label={loading ? 'Loading pickups' : 'Loading'} />;
  else {
    const cats = w.week.categories;
    const full = w.acquisitions.used >= w.acquisitions.max;
    body = (
      <Stack spacing={1.5}>
        {w.stale && <StaleBanner reason={w.stale_reason} asOf={w.as_of} />}
        {w.week.is_last_day && <Alert severity="info">Last day: only players with a game today can help, and only if added before their tip.</Alert>}
        <Card sx={{ p: 1.5 }}>
          <AcquisitionsMeter acquisitions={w.acquisitions} />
        </Card>
        <Box>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 0.5 }}>
            Position
          </Typography>
          <Box role="group" aria-label="Position filter" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {POSITIONS.map((p) => (
              <Chip
                key={p}
                label={p === 'all' ? 'All' : p}
                onClick={() => setPosition(p)}
                aria-pressed={position === p}
                color={position === p ? 'primary' : 'default'}
                variant={position === p ? 'filled' : 'outlined'}
                sx={{ height: 40, borderRadius: 20, minWidth: 48 }}
              />
            ))}
          </Box>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1, mb: 0.5 }}>
            Category need vs this opponent
          </Typography>
          <Box role="group" aria-label="Category filter" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            <Chip
              label="All"
              onClick={() => setCategory('all')}
              aria-pressed={category === 'all'}
              color={category === 'all' ? 'primary' : 'default'}
              variant={category === 'all' ? 'filled' : 'outlined'}
              sx={{ height: 40, borderRadius: 20 }}
            />
            {w.needs.map((n) => (
              <Chip
                key={n.key}
                icon={n.need === 'high' ? <PriorityHighIcon /> : undefined}
                label={`${catLabel(n.key, cats)} · ${NEED_LABEL[n.need]}`}
                onClick={() => setCategory(n.key)}
                aria-pressed={category === n.key}
                disabled={n.need === 'punt'}
                color={category === n.key ? 'primary' : 'default'}
                variant={category === n.key ? 'filled' : 'outlined'}
                sx={{ height: 40, borderRadius: 20 }}
              />
            ))}
          </Box>
        </Box>
        {full && (
          <Alert severity="warning">
            No acquisitions left this week. These pickups are for planning; you can add them after the count resets.
          </Alert>
        )}
        {w.candidates.length === 0 ? (
          <EmptyState title="No pickup helps this week">
            The engine scored {w.pool_size} free agents; none raises P(win week) above {pct(w.baseline_p_win.p)} after the paired drop.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="No pickups match these filters">Try another position or category.</EmptyState>
        ) : (
          <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0 }}>
            {shown.map((c) => (
              <CandidateCard key={c.player.player_id} c={c} w={w} onOpenPlayer={onOpenPlayer} onCompare={onCompare} />
            ))}
          </Stack>
        )}
        <ProvenanceLine provenance={w.provenance} />
      </Stack>
    );
  }
  return (
    <SeasonShell tab="builder" onTabChange={onTabChange} header={header}>
      <BuilderTabs value="pickups" onChange={onBuilderView} />
      {body}
    </SeasonShell>
  );
}
