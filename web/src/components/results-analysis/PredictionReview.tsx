import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import RemoveIcon from '@mui/icons-material/Remove';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import type { FollowedMove, ResultsResponse, WeekResult } from '../../api/season';
import { fixed, pct } from '../../lib/format';
import { forMeSymbol, useVizColors } from '../../theme/viz';
import { ConfidenceChip, ProvenanceLine } from '../foundations/Confidence';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { catLabel, dateRange, pctRange, ptsDelta, signedNum } from '../foundations/seasonFormat';

export interface PredictionReviewProps {
  results: ResultsResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onTabChange?: (tab: SeasonTab) => void;
}

const OUTCOME = { win: '▲ Won', loss: '▼ Lost', tie: '● Tied' } as const;

function FollowedChip({ f }: { f: FollowedMove['followed'] }) {
  const m = {
    yes: { icon: <CheckIcon />, label: 'Followed' },
    no: { icon: <CloseIcon />, label: 'Not followed' },
    partial: { icon: <RemoveIcon />, label: 'Partly' },
  }[f];
  return <Chip size="small" variant="outlined" icon={m.icon} label={m.label} />;
}

function WeekReview({ w, r }: { w: WeekResult; r: ResultsResponse }) {
  const cats = r.categories;
  return (
    <Card component="li" sx={{ listStyle: 'none', p: 1.5 }} aria-label={`${w.label} review`}>
      <Typography variant="subtitle2" component="h3">
        {w.label} · {dateRange(w.start, w.end)} · vs {w.opponent.name}
      </Typography>
      <Typography variant="body2" className="tabular" sx={{ mt: 0.5 }}>
        Predicted <strong>{pct(w.predicted.p_win_week.p)}</strong> ({pctRange(w.predicted.p_win_week.lo, w.predicted.p_win_week.hi)}) and{' '}
        {fixed(w.predicted.expected_cats.mean, 1)} cats → <strong>{OUTCOME[w.outcome]}</strong> {w.cats_won}–{w.cats_lost}
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
        Favorite called {w.favorite_hits ?? '—'} of {w.categories.length} categories · Brier {w.brier == null ? '—' : w.brier.toFixed(3)} (lower is better)
      </Typography>
      <Table size="small" aria-label={`${w.label}: predicted vs actual`} sx={{ mt: 0.5 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ px: 0.5 }}>Cat</TableCell>
            <TableCell align="right" sx={{ px: 0.5 }}>
              Pre-week
            </TableCell>
            <TableCell align="right" sx={{ px: 0.5 }}>
              Result
            </TableCell>
            <TableCell align="right" sx={{ px: 0.5 }}>
              Call
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {w.categories.map((c) => {
            const right = c.predicted_p != null && (c.predicted_p > 0.5) === (c.result === 'won');
            return (
              <TableRow key={c.key}>
                <TableCell sx={{ px: 0.5 }}>{catLabel(c.key, cats)}</TableCell>
                <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                  {pct(c.predicted_p)}
                </TableCell>
                <TableCell align="right" sx={{ px: 0.5 }}>
                  {c.result === 'won' ? '▲ Won' : c.result === 'lost' ? '▼ Lost' : '● Tied'}
                </TableCell>
                <TableCell align="right" sx={{ px: 0.5, color: 'text.secondary' }}>
                  {c.predicted_p == null ? '—' : right ? 'right' : 'missed'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Typography variant="overline" component="h4" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
        Recommended moves
      </Typography>
      {w.moves.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The engine recommended no moves this week.
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {w.moves.map((m) => (
            <Box component="li" key={m.move_id} sx={{ py: 0.75, borderTop: 1, borderColor: 'divider' }}>
              <Stack direction="row" sx={{ gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }}>
                  {m.title}
                </Typography>
                <FollowedChip f={m.followed} />
              </Stack>
              <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary' }}>
                Predicted {ptsDelta(m.predicted_delta_p_win)} P(win week) · realized{' '}
                {m.realized_delta_cats == null ? 'not measurable' : `${forMeSymbol(m.realized_delta_cats)} ${signedNum(m.realized_delta_cats, 0)} cat${Math.abs(m.realized_delta_cats) === 1 ? '' : 's'}`}
                {m.flipped ? ` (flipped ${catLabel(m.flipped, cats)})` : ''}
              </Typography>
              {m.realized_note && (
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                  {m.realized_note}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{ mt: 0.75 }}>
        <ConfidenceChip confidence={w.confidence} compact />
      </Box>
      <ProvenanceLine provenance={w.provenance} />
    </Card>
  );
}

/**
 * Prediction review: what the engine said before each week (P(win week) with its band,
 * expected categories, per-category odds) against what happened, plus the moves it
 * recommended, whether I made them, and their realized effect from the backtest replay.
 */
export function PredictionReview({ results: r, loading, error, onRetry, onTabChange }: PredictionReviewProps) {
  const viz = useVizColors();
  const header = <ScreenHeader title="Prediction review" subtitle="What the engine said vs what happened" asOf={r?.as_of} stale={r?.stale} />;
  let body;
  if (error && !r) body = <ErrorState message={error} onRetry={onRetry} what="the review" />;
  else if (!r) body = <LoadingState blocks={[220, 420, 420]} label={loading ? 'Loading the review' : 'Loading'} />;
  else if (r.weeks.length === 0) body = <EmptyState title="Nothing to review yet">The first review appears after week 1 ends.</EmptyState>;
  else {
    const weeks = [...r.weeks].reverse();
    body = (
      <Stack spacing={1.5}>
        {r.stale && <StaleBanner reason={r.stale_reason} asOf={r.as_of} />}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            Pre-week P(win week) and the result
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Bar = the engine’s number before the first tip; label = what happened
          </Typography>
          <BarChart
            height={weeks.length * 36 + 44}
            layout="horizontal"
            hideLegend
            skipAnimation
            borderRadius={4}
            margin={{ left: 4, right: 18, top: 6, bottom: 0 }}
            grid={{ vertical: true }}
            yAxis={[{ scaleType: 'band', data: weeks.map((w) => w.label), width: 64, categoryGapRatio: 0.4, disableTicks: true, disableLine: true, tickLabelStyle: { fontSize: 13, fill: 'var(--mui-palette-text-primary)' } }]}
            xAxis={[{ min: 0, max: 1, tickInterval: [0, 0.25, 0.5, 0.75, 1], valueFormatter: (v: number | null) => (v == null ? '' : `${Math.round(v * 100)}%`), disableTicks: true, tickLabelStyle: { fontSize: 12, fill: viz.muted }, height: 24 }]}
            series={[
              {
                data: weeks.map((w) => w.predicted.p_win_week.p),
                label: 'Pre-week P(win week)',
                color: viz.meterFill,
                barLabel: (i) => {
                  const w = weeks[i.dataIndex];
                  return w ? `${pct(w.predicted.p_win_week.p)} · ${OUTCOME[w.outcome]}` : '';
                },
                barLabelPlacement: 'outside',
              },
            ]}
            sx={{ '& .MuiChartsGrid-line': { stroke: viz.grid, strokeWidth: 1 }, '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 12, fontWeight: 600 } }}
          >
            <ChartsReferenceLine x={0.5} lineStyle={{ stroke: viz.axis, strokeWidth: 1.5 }} />
          </BarChart>
        </Card>
        <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0 }}>
          {r.weeks.map((w) => (
            <WeekReview key={w.week} w={w} r={r} />
          ))}
        </Stack>
      </Stack>
    );
  }
  return (
    <SeasonShell tab="results" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
