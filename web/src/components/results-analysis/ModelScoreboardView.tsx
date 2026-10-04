import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import type { ModelScoreboard, ScoreRow } from '../../api/season';
import { pct } from '../../lib/format';
import { forMeSymbol, useVizColors } from '../../theme/viz';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState } from '../foundations/ScreenStates';
import { SignedBarChart } from '../foundations/SignedBarChart';
import { signedNum } from '../foundations/seasonFormat';

export interface ModelScoreboardViewProps {
  scoreboard: ModelScoreboard | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onTabChange?: (tab: SeasonTab) => void;
  initialStat?: ScoreRow['stat'];
}

const STAT_LABEL: Record<string, string> = { min: 'Minutes', pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PTM', stl: 'ST', blk: 'BLK', tov: 'TO', fg_pct: 'FG%', ft_pct: 'FT%', all: 'All' };

/**
 * Model scoreboard (backtest.py / model_scores): which projection models beat the EWMA
 * baseline out of sample, by stat (MAE, relative to EWMA: green ▲ better, red ▼ worse),
 * their ensemble weights and gate, and how well calibrated the P(win category) numbers
 * have been (predicted vs observed by bin, with the Brier score).
 */
export function ModelScoreboardView({ scoreboard: s, loading, error, onRetry, onTabChange, initialStat = 'min' }: ModelScoreboardViewProps) {
  const viz = useVizColors();
  const [stat, setStat] = useState<ScoreRow['stat']>(initialStat);
  const [calView, setCalView] = useState<'chart' | 'table'>('chart');
  const header = <ScreenHeader title="Model scoreboard" subtitle={s ? `${s.scope_label} · ${s.games_scored.toLocaleString('en-US')} games scored` : undefined} asOf={s?.as_of} />;
  let body;
  if (error && !s) body = <ErrorState message={error} onRetry={onRetry} what="the scoreboard" />;
  else if (!s) body = <LoadingState blocks={[60, 280, 260, 300]} label={loading ? 'Loading the scoreboard' : 'Loading'} />;
  else {
    const stats = [...new Set(s.rows.map((r) => r.stat))];
    const rows = s.rows.filter((r) => r.stat === stat);
    const models = rows.filter((r) => r.model !== 'EWMA baseline');
    const base = rows.find((r) => r.model === 'EWMA baseline');
    const max = Math.max(0.02, ...models.map((m) => Math.abs(m.rel_improvement)));
    const domain = Math.ceil(max * 2.3 * 100) / 100;
    const cal = s.calibration;
    body = (
      <Stack spacing={1.5}>
        {!s.ensemble_gated_on && (
          <Alert severity="warning">The ensemble is gated off: it has not beaten EWMA out of sample on every stat yet, so recommendations use the baseline.</Alert>
        )}
        <Box role="group" aria-label="Stat" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {stats.map((k) => (
            <Chip
              key={k}
              label={STAT_LABEL[k] ?? k}
              onClick={() => setStat(k)}
              aria-pressed={k === stat}
              color={k === stat ? 'primary' : 'default'}
              variant={k === stat ? 'filled' : 'outlined'}
              sx={{ height: 40, borderRadius: 20 }}
            />
          ))}
        </Box>
        <Card sx={{ p: 1.5 }}>
          <SignedBarChart
            title={`${STAT_LABEL[stat] ?? stat}: error vs EWMA`}
            subtitle={`EWMA MAE ${base?.mae.toFixed(2) ?? '—'} · lower error = green ▲`}
            rows={models.map((m) => ({
              key: m.model,
              label: m.model,
              value: m.rel_improvement,
              display: `${signedNum(m.rel_improvement * 100)}%`,
              readout: `${m.model}: MAE ${m.mae.toFixed(2)} vs EWMA ${m.baseline_mae.toFixed(2)} (${signedNum(m.rel_improvement * 100)}% better), ${m.beats_baseline ? 'beats' : 'does not beat'} the baseline, gate ${m.gated_on ? 'on' : 'off'}`,
            }))}
            domain={domain}
            ticks={[-domain / 2, 0, domain / 2].map((t) => Math.round(t * 100) / 100)}
            tickFormat={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`}
            labelWidth={92}
            table={{
              headers: ['Model', 'MAE', 'vs EWMA', 'Weight', 'Gate'],
              cells: (_r, i) => {
                const m = models[i]!;
                return [m.model, m.mae.toFixed(2), `${forMeSymbol(m.rel_improvement)} ${signedNum(m.rel_improvement * 100)}%`, m.weight == null ? '—' : m.weight.toFixed(2), m.gated_on ? 'on' : 'off'];
              },
            }}
          />
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
            A model drives recommendations only after it beats EWMA out of sample (the gate). Ensemble weights are inverse-error, at least 0.05 each.
          </Typography>
        </Card>
        <Card sx={{ p: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box>
              <Typography variant="subtitle2" component="h3">
                Calibration of P(win category)
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Brier {cal.brier.toFixed(3)} vs {cal.brier_baseline.toFixed(3)} for {cal.baseline_label} (lower is better)
              </Typography>
            </Box>
            <ToggleButtonGroup size="small" exclusive value={calView} onChange={(_, v: 'chart' | 'table' | null) => v && setCalView(v)} aria-label="Calibration view">
              <ToggleButton value="chart" sx={{ px: 1.5 }}>
                Chart
              </ToggleButton>
              <ToggleButton value="table" sx={{ px: 1.5 }}>
                Table
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {calView === 'chart' ? (
            <>
              <Box sx={{ display: 'flex', gap: 2, mt: 0.75 }} aria-label="Legend">
                {[
                  ['Predicted', viz.neutral],
                  ['Happened', viz.meterFill],
                ].map(([n, c]) => (
                  <Typography key={n} variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                    <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: c }} />
                    {n}
                  </Typography>
                ))}
              </Box>
              <BarChart
                height={220}
                hideLegend
                skipAnimation
                borderRadius={4}
                margin={{ left: 0, right: 8, top: 16, bottom: 0 }}
                grid={{ horizontal: true }}
                xAxis={[{ scaleType: 'band', data: cal.bins.map((b) => `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}`), categoryGapRatio: 0.3, barGapRatio: 0.12, disableTicks: true, tickLabelStyle: { fontSize: 11, fill: viz.muted }, height: 24 }]}
                yAxis={[{ min: 0, max: 1, tickInterval: [0, 0.5, 1], valueFormatter: (v: number | null) => (v == null ? '' : `${Math.round(v * 100)}%`), disableTicks: true, disableLine: true, tickLabelStyle: { fontSize: 11, fill: viz.muted }, width: 36 }]}
                series={[
                  { data: cal.bins.map((b) => b.predicted), label: 'Predicted', color: viz.neutral },
                  { data: cal.bins.map((b) => b.observed), label: 'Happened', color: viz.meterFill, barLabel: (i) => pct(cal.bins[i.dataIndex]?.observed ?? null), barLabelPlacement: 'outside' },
                ]}
                sx={{ '& .MuiChartsGrid-line': { stroke: viz.grid, strokeWidth: 1 }, '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 11, fontWeight: 600 } }}
              />
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                Bins of the engine’s P(win category); bars match when it is calibrated. Sample size is in the table.
              </Typography>
            </>
          ) : (
            <Table size="small" aria-label="Calibration">
              <TableHead>
                <TableRow>
                  <TableCell>Bin</TableCell>
                  <TableCell align="right">Predicted</TableCell>
                  <TableCell align="right">Happened</TableCell>
                  <TableCell align="right">n</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cal.bins.map((b) => (
                  <TableRow key={b.lo}>
                    <TableCell>
                      {Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%
                    </TableCell>
                    <TableCell align="right" className="tabular">
                      {pct(b.predicted)}
                    </TableCell>
                    <TableCell align="right" className="tabular">
                      {pct(b.observed)}
                    </TableCell>
                    <TableCell align="right" className="tabular">
                      {b.n}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Box sx={{ mt: 0.75 }}>
            <ConfidenceChip confidence={s.confidence} />
          </Box>
          <MissingInputs confidence={s.confidence} />
        </Card>
        <ProvenanceLine provenance={s.provenance} />
      </Stack>
    );
  }
  return (
    <SeasonShell tab="results" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
