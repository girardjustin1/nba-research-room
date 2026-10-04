import { useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import type { CompareResponse, PlayerRef } from '../../api/season';
import { pct } from '../../lib/format';
import { useResolvedMode, useVizColors } from '../../theme/viz';
import { PlayerAvatar } from '../foundations/avatars/PlayerAvatar';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { StatusChip } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { catLabel, formatValue, positionsLabel, ptsDelta, weekdayOf } from '../foundations/seasonFormat';

/** Categorical slots 1 and 2 of the dataviz reference palette (validate_palette.js PASS: CVD dE 24.7 light / 26.8 dark, both >= 3:1). */
const SERIES = { light: ['#2a78d6', '#eb6834'], dark: ['#3987e5', '#d95926'] } as const;

export interface PlayerCompareProps {
  compare: CompareResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
}

function Head({ p, tag, chosen, swatch }: { p: PlayerRef; tag: string; chosen: boolean; swatch: string }) {
  return (
    <Box sx={{ minWidth: 0, textAlign: 'center', p: 1, borderRadius: 2, border: 2, borderColor: chosen ? 'primary.main' : 'divider' }}>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <PlayerAvatar name={p.name} headshotUrl={p.headshot_url} size={48} />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.5 }} noWrap>
        {p.name}
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }} noWrap>
        <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: 0.5, bgcolor: swatch, mr: 0.5, verticalAlign: 'middle' }} />
        {tag} · {positionsLabel(p.eligible)} · {p.team_abbr}
      </Typography>
      <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'center', minHeight: 24 }}>
        <StatusChip player={p} />
      </Box>
      {chosen && (
        <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, fontWeight: 700, color: 'primary.main' }}>
          <CheckIcon sx={{ fontSize: 15 }} /> Engine’s pick
        </Typography>
      )}
    </Box>
  );
}

/**
 * Two players side by side for one decision (start/sit on a date, or add/drop for the
 * rest of the week): the engine's verdict and its effect on P(win week), each row with the
 * better side marked by the engine, and P(win) per category under each choice.
 */
export function PlayerCompare({ compare: c, loading, error, onRetry, onBack, onTabChange }: PlayerCompareProps) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const header = (
    <ScreenHeader
      title={c ? `${c.decision === 'start_sit' ? 'Start or sit' : 'Add or drop'}` : 'Compare'}
      subtitle={c ? (c.date ? `${weekdayOf(c.date)} · ${c.a.name} vs ${c.b.name}` : `Rest of ${c.week.label} · ${c.a.name} vs ${c.b.name}`) : undefined}
      asOf={c?.as_of}
      stale={c?.stale}
      onBack={onBack}
    />
  );
  let body;
  if (error && !c) body = <ErrorState message={error} onRetry={onRetry} what="the comparison" />;
  else if (!c) body = <LoadingState blocks={[160, 140, 360]} label={loading ? 'Loading the comparison' : 'Loading'} />;
  else {
    const cats = c.week.categories;
    const [ca, cb] = SERIES[mode];
    const tagA = c.decision === 'start_sit' ? 'Start' : 'Add';
    const tagB = c.decision === 'start_sit' ? 'Start' : 'Keep';
    const chosen = c.verdict.choose;
    body = (
      <Stack spacing={1.5}>
        {c.stale && <StaleBanner reason={c.stale_reason} asOf={c.as_of} />}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <Head p={c.a} tag={tagA} chosen={chosen === c.a.player_id} swatch={ca} />
          <Head p={c.b} tag={tagB} chosen={chosen === c.b.player_id} swatch={cb} />
        </Box>
        <Card sx={{ p: 1.5 }}>
          <Typography variant="overline" component="p" sx={{ color: 'text.secondary' }}>
            Verdict
          </Typography>
          <Typography variant="subtitle1" component="h2">
            {chosen === c.a.player_id ? c.a.name : chosen === c.b.player_id ? c.b.name : 'Too close to call'}
            {chosen != null && ` · ${ptsDelta(c.verdict.delta_p_win.mean)}`}
          </Typography>
          <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary' }}>
            P(win week) choosing {c.a.name.split(' ').slice(-1)[0]} minus choosing {c.b.name.split(' ').slice(-1)[0]} · 80% band{' '}
            {ptsDelta(c.verdict.delta_p_win.lo)} to {ptsDelta(c.verdict.delta_p_win.hi)}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75 }}>
            {c.verdict.reason}
          </Typography>
          <Box sx={{ mt: 0.75 }}>
            <ConfidenceChip confidence={c.verdict.confidence} />
          </Box>
          <MissingInputs confidence={c.verdict.confidence} />
        </Card>
        <Card sx={{ p: 0 }}>
          <Table size="small" aria-label="Side by side">
            <TableHead>
              <TableRow>
                <TableCell sx={{ pl: 1.5 }}>{c.date ? 'Tonight' : 'Rest of week'}</TableCell>
                <TableCell align="right">{c.a.name.split(' ').slice(-1)[0]}</TableCell>
                <TableCell align="right" sx={{ pr: 1.5 }}>
                  {c.b.name.split(' ').slice(-1)[0]}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {c.rows.map((r) => {
                const cell = (side: 'a' | 'b') => (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, whiteSpace: 'nowrap', fontWeight: r.better === side ? 700 : 400 }}>
                    {r.better === side && <CheckIcon sx={{ fontSize: 15 }} aria-label="better" />}
                    {formatValue(r[side], r.format)}
                  </Box>
                );
                return (
                  <TableRow key={r.key}>
                    <TableCell sx={{ pl: 1.5 }}>
                      {r.label}
                      {r.note && (
                        <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
                          {r.note}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" className="tabular">
                      {cell('a')}
                    </TableCell>
                    <TableCell align="right" className="tabular" sx={{ pr: 1.5 }}>
                      {cell('b')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
        <Card sx={{ p: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box>
              <Typography variant="subtitle2" component="h3">
                P(win) per category
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                If you pick each player
              </Typography>
            </Box>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'chart' | 'table' | null) => v && setView(v)} aria-label="Category view">
              <ToggleButton value="chart" sx={{ px: 1.5 }}>
                Chart
              </ToggleButton>
              <ToggleButton value="table" sx={{ px: 1.5 }}>
                Table
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {view === 'chart' ? (
            <>
              <Box sx={{ display: 'flex', gap: 2, mt: 0.75 }} aria-label="Legend">
                {[
                  [c.a.name, ca],
                  [c.b.name, cb],
                ].map(([n, col]) => (
                  <Typography key={n} variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                    <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: col }} />
                    {n}
                  </Typography>
                ))}
              </Box>
              <BarChart
                height={c.cat_deltas.length * 40 + 40}
                layout="horizontal"
                hideLegend
                skipAnimation
                borderRadius={4}
                margin={{ left: 4, right: 30, top: 4, bottom: 0 }}
                grid={{ vertical: true }}
                yAxis={[
                  {
                    scaleType: 'band',
                    data: c.cat_deltas.map((d) => catLabel(d.key, cats)),
                    width: 48,
                    categoryGapRatio: 0.3,
                    barGapRatio: 0.15,
                    disableTicks: true,
                    disableLine: true,
                    tickLabelStyle: { fontSize: 13, fill: 'var(--mui-palette-text-primary)' },
                  },
                ]}
                xAxis={[
                  {
                    min: 0,
                    max: 1,
                    tickInterval: [0, 0.5, 1],
                    valueFormatter: (v: number | null) => (v == null ? '' : `${Math.round(v * 100)}%`),
                    disableTicks: true,
                    tickLabelStyle: { fontSize: 12, fill: viz.muted },
                    height: 24,
                  },
                ]}
                series={[
                  { data: c.cat_deltas.map((d) => d.p_a), label: c.a.name, color: ca, barLabel: (i) => pct(c.cat_deltas[i.dataIndex]?.p_a ?? null), barLabelPlacement: 'outside' },
                  { data: c.cat_deltas.map((d) => d.p_b), label: c.b.name, color: cb, barLabel: (i) => pct(c.cat_deltas[i.dataIndex]?.p_b ?? null), barLabelPlacement: 'outside' },
                ]}
                sx={{
                  '& .MuiChartsGrid-line': { stroke: viz.grid, strokeWidth: 1 },
                  '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 11, fontWeight: 600 },
                }}
              >
                <ChartsReferenceLine x={0.5} lineStyle={{ stroke: viz.axis, strokeWidth: 1.5 }} />
              </BarChart>
            </>
          ) : (
            <Table size="small" aria-label="P(win) per category">
              <TableHead>
                <TableRow>
                  <TableCell>Cat</TableCell>
                  <TableCell align="right">{c.a.name.split(' ').slice(-1)[0]}</TableCell>
                  <TableCell align="right">{c.b.name.split(' ').slice(-1)[0]}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {c.cat_deltas.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell>{catLabel(d.key, cats)}</TableCell>
                    <TableCell align="right" className="tabular">
                      {pct(d.p_a)}
                    </TableCell>
                    <TableCell align="right" className="tabular">
                      {pct(d.p_b)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <ProvenanceLine provenance={c.provenance} />
      </Stack>
    );
  }
  return (
    <SeasonShell tab="research" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
