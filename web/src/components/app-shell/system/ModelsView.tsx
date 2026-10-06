import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import RemoveCircleOutlinedIcon from '@mui/icons-material/RemoveCircleOutlined';
import StraightenOutlinedIcon from '@mui/icons-material/StraightenOutlined';
import { BarChart } from '@mui/x-charts/BarChart';
import type { ModelScore, ModelsResponse } from '../../../api/system';
import { fixed } from '../../../lib/format';
import { shortDateTime } from '../../../lib/time';
import { useVizColors } from '../../../theme/viz';

export interface ModelsViewProps {
  models: ModelsResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Initially selected model (defaults to the first that is not the baseline). */
  initialModel?: string;
}

const BASELINE = 'baseline';
const TARGET = 0.8;

/** Share of outcomes inside the 80% band, against the 80% target mark. */
export function Calibration({ coverage }: { coverage: number | null }) {
  const viz = useVizColors();
  const v = coverage == null ? 0 : Math.max(0, Math.min(1, coverage)) * 100;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" className="tabular" sx={{ color: 'text.secondary' }}>
        {coverage == null ? 'No coverage yet' : `${Math.round(coverage * 100)}% inside the 80% band`}
      </Typography>
      <Box sx={{ position: 'relative', mt: 0.5 }}>
        <LinearProgress
          variant="determinate"
          value={v}
          aria-label="Share of outcomes inside the 80% band"
          aria-valuetext={coverage == null ? 'none' : `${Math.round(coverage * 100)}%, target 80%`}
          sx={{ height: 6, borderRadius: 3, bgcolor: viz.meterTrack, '& .MuiLinearProgress-bar': { borderRadius: 3, bgcolor: viz.meterFill } }}
        />
        <Box aria-hidden sx={{ position: 'absolute', left: `${TARGET * 100}%`, top: -3, bottom: -3, width: 2, bgcolor: 'text.primary', borderRadius: 1 }} />
      </Box>
    </Box>
  );
}

function Verdict({ row }: { row: ModelScore }) {
  if (row.model === BASELINE) {
    return <Chip size="small" variant="outlined" icon={<StraightenOutlinedIcon />} label="Reference" />;
  }
  if (row.beats_baseline == null) return <Chip size="small" variant="outlined" label="Not compared" />;
  return row.beats_baseline ? (
    <Chip size="small" variant="outlined" icon={<CheckCircleOutlinedIcon />} label="Beats baseline" />
  ) : (
    <Chip size="small" variant="outlined" icon={<RemoveCircleOutlinedIcon />} label="Behind baseline" />
  );
}

/**
 * Model scoreboard: MAE by stat (the selected model in blue against the baseline in gray,
 * the baseline being the reference every model must beat) and calibration per stat as the
 * share of outcomes inside the model's 80% band, against the 80% target mark.
 */
export function ModelsView({ models: m, loading, error, onRetry, initialModel }: ModelsViewProps) {
  const viz = useVizColors();
  const names = [...new Set((m?.models ?? []).map((r) => r.model))];
  const contenders = names.filter((n) => n !== BASELINE);
  const [picked, setPicked] = useState<string | null>(initialModel ?? null);
  const selected = picked && names.includes(picked) ? picked : (contenders[0] ?? (names.includes(BASELINE) ? BASELINE : null));

  if (!m) {
    if (error) {
      return (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Model scores unavailable: {error}
        </Alert>
      );
    }
    return (
      <Stack spacing={1} aria-busy={loading ? 'true' : undefined} aria-label="Loading model scores">
        <Skeleton variant="rounded" height={40} />
        <Skeleton variant="rounded" height={300} />
      </Stack>
    );
  }
  if (!selected) {
    return (
      <Card sx={{ p: 2 }}>
        <Typography variant="subtitle2">No model scores yet</Typography>
        {m.note && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{m.note}</Typography>}
      </Card>
    );
  }

  const rows = m.models.filter((r) => r.model === selected);
  const base = new Map(m.models.filter((r) => r.model === BASELINE).map((r) => [r.stat, r]));
  const stats = rows.map((r) => r.stat);
  const compare = selected !== BASELINE && base.size > 0;
  const series = [
    { data: rows.map((r) => r.mae), label: selected, color: viz.pos, valueFormatter: (v: number | null) => fixed(v, 2) },
    ...(compare ? [{ data: stats.map((s) => base.get(s)?.mae ?? null), label: 'baseline (reference)', color: viz.neutral, valueFormatter: (v: number | null) => fixed(v, 2) }] : []),
  ];
  const win = rows[0];

  return (
    <Stack spacing={1.5}>
      {error && (
        <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
          Refresh failed ({error}). Showing the last result.
        </Alert>
      )}
      <Box>
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }} role="group" aria-label="Model">
          {names.map((n) => (
            <Chip
              key={n}
              label={n === BASELINE ? 'baseline (reference)' : n}
              color={n === selected ? 'primary' : 'default'}
              variant={n === selected ? 'filled' : 'outlined'}
              aria-pressed={n === selected}
              onClick={() => setPicked(n)}
              sx={{ height: 36 }}
            />
          ))}
        </Stack>
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.75 }}>
          {win ? `Scored ${win.window_start.slice(0, 10)} to ${win.window_end.slice(0, 10)} · as of ${shortDateTime(m.as_of)}` : `As of ${shortDateTime(m.as_of)}`}
        </Typography>
        {contenders.length === 0 && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Only the baseline exists so far. New models must beat it before they drive recommendations.
          </Typography>
        )}
      </Box>

      <Card sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" component="h3">
          Mean absolute error by stat
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Per player-game, lower is better{compare ? '; gray is the baseline' : ''}.
        </Typography>
        <BarChart
          height={stats.length * (compare ? 34 : 26) + 40}
          layout="horizontal"
          skipAnimation
          borderRadius={3}
          hideLegend={!compare}
          margin={{ left: 0, right: 12, top: compare ? 4 : 8, bottom: 0 }}
          grid={{ vertical: true }}
          yAxis={[{ scaleType: 'band', data: stats.map((s) => s.toUpperCase()), width: 48, categoryGapRatio: 0.3, barGapRatio: 0.15, disableTicks: true, tickLabelStyle: { fontSize: 12, fill: 'var(--mui-palette-text-primary)' } }]}
          xAxis={[{ min: 0, disableTicks: true, tickNumber: 4, tickLabelStyle: { fontSize: 11, fill: viz.muted }, height: 22 }]}
          series={series.map((s) => ({ ...s, barLabel: (item) => fixed(item.value, 2), barLabelPlacement: 'outside' as const }))}
          slotProps={{ legend: { position: { vertical: 'top', horizontal: 'start' } } }}
          sx={{
            '& .MuiChartsGrid-line': { stroke: viz.grid },
            '& .MuiChartsAxis-line': { stroke: viz.axis },
            '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 11, fontWeight: 600 },
          }}
        />
      </Card>

      <Card sx={{ px: 1.5, pt: 1 }}>
        <Typography variant="subtitle2" component="h3">
          Per stat
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          The tall mark is the 80% target: a calibrated model puts 80% of outcomes inside its band.
        </Typography>
        <Box component="ul" sx={{ m: 0, p: 0, mt: 0.5 }}>
          {rows.map((r) => (
            <Box component="li" key={r.stat} sx={{ listStyle: 'none', py: 1, borderTop: 1, borderColor: 'divider' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, width: 48 }}>
                  {r.stat.toUpperCase()}
                </Typography>
                <Typography variant="caption" className="tabular" sx={{ flex: 1, color: 'text.secondary' }}>
                  MAE {fixed(r.mae, 2)} · RMSE {fixed(r.rmse, 2)} · n {r.n.toLocaleString('en-US')}
                </Typography>
                <Verdict row={r} />
              </Stack>
              <Calibration coverage={r.coverage_80} />
            </Box>
          ))}
        </Box>
      </Card>
      {m.note && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {m.note}
        </Typography>
      )}
    </Stack>
  );
}
