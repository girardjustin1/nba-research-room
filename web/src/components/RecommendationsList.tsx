import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import type { Recommendation } from '../api/types';
import { eligibleLabel, pct, splitReasons } from '../lib/format';
import { GainBar } from './charts/GainBar';
import { Meter } from './charts/Meter';
import { PlayerAvatar, TeamBadge } from './PlayerAvatar';

export type RecommendationsMode = 'onTheClock' | 'waiting';

export interface RecommendationsListProps {
  recommendations: Recommendation[];
  mode: RecommendationsMode;
  /** My decision pick and the one after it (from the board), for the availability labels. */
  decisionPick: number | null;
  followingPick: number | null;
  /** Team on the clock, for the "mark taken" label while waiting. */
  onTheClock: number | null;
  /** First load: show skeleton cards. */
  loading?: boolean;
  /** A refetch is in flight: hold the previous cards at reduced opacity (no flash). */
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onDraft?: (rec: Recommendation) => void;
  /** player_id of a pick being submitted. */
  pendingId?: number | null;
}

/** Engine flags that lower confidence; shown as chips so they are never hidden in a fold. */
function confidenceFlags(r: Recommendation): string[] {
  const out: string[] = [];
  if (r.sources === 'bbm_only') out.push('BBM-only projection');
  if (r.adp_source === 'bbm_rank') out.push('no ADP');
  if (r.injury_risk === 'H' || r.injury_risk === 'E') out.push(`injury risk ${r.injury_risk}`);
  return out;
}

function RecommendationCard({
  rec,
  index,
  scaleMax,
  props,
}: {
  rec: Recommendation;
  index: number;
  scaleMax: number;
  props: RecommendationsListProps;
}) {
  const [open, setOpen] = useState(false);
  const reasons = splitReasons(rec.reasons);
  const flags = confidenceFlags(rec);
  const onClock = props.mode === 'onTheClock';
  const pending = props.pendingId === rec.player_id;
  const reasonsId = `reasons-${rec.player_id}`;

  return (
    <Card component="li" sx={{ listStyle: 'none', p: 1.5 }} aria-label={`${index + 1}. ${rec.name}`}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1.25 }}>
        <Typography
          component="span"
          className="tabular"
          sx={{ width: 22, flexShrink: 0, fontWeight: 700, color: 'text.secondary', lineHeight: '24px' }}
        >
          {index + 1}
        </Typography>
        <PlayerAvatar name={rec.name} headshotUrl={rec.headshot_url} size={40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" noWrap sx={{ lineHeight: '24px' }}>
            {rec.name}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
            {eligibleLabel(rec.eligible, rec.position)} · <TeamBadge abbr={rec.team_abbr} logoUrl={rec.team_logo_url} /> · Tier{' '}
            {rec.tier ?? '—'}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
            P(win week)
          </Typography>
          <Typography component="p" className="tabular" sx={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3 }}>
            {pct(rec.p_win_week_mc ?? rec.p_win_week)}
          </Typography>
        </Box>
      </Stack>

      <Box sx={{ mt: 1.25 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Gain · expected categories vs a typical pick
        </Typography>
        <GainBar gain={rec.gain} scaleMax={scaleMax} />
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
          Chance he is still available
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 0.25 }}>
          <Meter
            value={rec.p_available_at_decision}
            label="My pick"
            detail={props.decisionPick != null ? `#${props.decisionPick}` : undefined}
          />
          <Meter
            value={rec.p_available_next}
            label="Next pick"
            detail={props.followingPick != null ? `#${props.followingPick}` : 'none'}
          />
        </Box>
        {flags.length > 0 && (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {flags.map((f) => (
              <Chip
                key={f}
                size="small"
                variant="outlined"
                icon={<ReportProblemOutlinedIcon />}
                label={`Lower confidence: ${f}`}
              />
            ))}
          </Stack>
        )}
      </Box>

      <Stack direction="row" sx={{ gap: 1, mt: 1.25 }}>
        <Button
          size="large"
          color="inherit"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={reasonsId}
          endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />}
          sx={{ flex: '0 0 auto', color: 'text.secondary' }}
          disabled={reasons.length === 0}
        >
          Why
        </Button>
        {props.onDraft && (
          <Button
            size="large"
            fullWidth
            variant={onClock ? 'contained' : 'outlined'}
            onClick={() => props.onDraft?.(rec)}
            disabled={props.pendingId != null}
            aria-label={onClock ? `Draft ${rec.name}` : `Mark ${rec.name} taken by team ${props.onTheClock ?? ''}`}
          >
            {pending ? 'Sending…' : onClock ? 'Draft' : `Taken by team ${props.onTheClock ?? '—'}`}
          </Button>
        )}
      </Stack>
      <Collapse in={open} id={reasonsId}>
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, color: 'text.secondary' }}>
          {reasons.map((r) => (
            <Typography component="li" variant="body2" key={r} sx={{ mb: 0.25 }}>
              {r}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Card>
  );
}

/**
 * Top recommendations as a card list (a grid is too wide at 402px). Every number is the
 * engine's: gain, P(win week) (Monte Carlo when the engine ran it, else analytic), and the
 * two availability probabilities. The Draft button sits at the bottom of each card.
 */
export function RecommendationsList(props: RecommendationsListProps) {
  const { recommendations, loading, refreshing, error, onRetry, mode } = props;

  if (error) {
    return (
      <Alert
        severity="error"
        action={
          onRetry && (
            <Button color="inherit" onClick={onRetry}>
              Retry
            </Button>
          )
        }
      >
        Could not load recommendations: {error}
      </Alert>
    );
  }

  if (loading && recommendations.length === 0) {
    return (
      <Stack spacing={1.25} aria-busy="true" aria-label="Loading recommendations">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={190} />
        ))}
      </Stack>
    );
  }

  if (recommendations.length === 0) {
    return <Alert severity="info">The engine returned no recommendations for this pick.</Alert>;
  }

  const scaleMax = Math.max(0.01, ...recommendations.map((r) => Math.abs(r.gain ?? 0)));

  return (
    <Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        {mode === 'onTheClock'
          ? 'Ranked for this pick. Draft records it for you.'
          : `Waiting. Ranked for your pick #${props.decisionPick ?? '—'}; watch who is likely to last.`}
      </Typography>
      <Stack
        component="ol"
        spacing={1.25}
        sx={{ m: 0, p: 0, opacity: refreshing ? 0.55 : 1, transition: 'opacity 150ms' }}
        aria-busy={refreshing ? 'true' : undefined}
      >
        {recommendations.map((rec, i) => (
          <RecommendationCard key={rec.player_id} rec={rec} index={i} scaleMax={scaleMax} props={props} />
        ))}
      </Stack>
    </Box>
  );
}
