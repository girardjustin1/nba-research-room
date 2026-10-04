import { useState } from 'react';
import Box from '@mui/material/Box';
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
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { forMeSymbol, forMeWord, useForMe, useVizColors } from '../../theme/viz';

export interface SignedBarRow {
  key: string;
  label: string;
  /** Signed value on the chart's scale (already engine-computed); null = no estimate. */
  value: number | null;
  /** Bar-tip label, e.g. "+4.6 pts". */
  display: string;
  /** Force the neutral gray (punted, or within the even band). */
  neutral?: boolean;
  /** Sentence for the tap readout. */
  readout?: string;
}

export interface SignedBarChartProps {
  title: string;
  subtitle?: string;
  rows: SignedBarRow[];
  /** Symmetric domain half-width (same units as `value`). */
  domain: number;
  ticks: number[];
  tickFormat: (v: number) => string;
  /** |value| below this reads as neutral gray. */
  evenBand?: number;
  /** Table view columns: header + cell text per row. */
  table: { headers: string[]; cells: (row: SignedBarRow, index: number) => string[] };
  /** Y-axis label width in px. */
  labelWidth?: number;
  initialView?: 'chart' | 'table';
  hint?: string;
  /** Flip colors: positive = bad for me (e.g. an opponent's gain). */
  invert?: boolean;
}

/**
 * Horizontal diverging bars from a zero midline (MUI X BarChart, free), colored "for me":
 * green = helps me, red = hurts me, gray = about even / punted / missing, and every bar
 * label carries ▲ / ▼ / ● so color is never the only cue. Values are printed at the bar tips,
 * tapping a bar fills in a readout (touch has no hover), and a table view lists every
 * value. Used for category odds vs the opponent, per-category deltas, move effects,
 * SHAP drivers and model error vs the baseline.
 */
export function SignedBarChart({
  title,
  subtitle,
  rows,
  domain,
  ticks,
  tickFormat,
  evenBand = 0,
  table,
  labelWidth = 74,
  initialView = 'chart',
  hint = 'Tap a bar for its value.',
  invert = false,
}: SignedBarChartProps) {
  const viz = useVizColors();
  const forMe = useForMe();
  const [view, setView] = useState<'chart' | 'table'>(initialView);
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected == null ? null : rows[selected];
  const signOf = (r: SignedBarRow) => (r.value == null || r.neutral ? null : invert ? -r.value : r.value);
  const symbolFor = (r: SignedBarRow) => forMeSymbol(signOf(r), evenBand);
  const missing = rows.filter((r) => r.value == null).length;

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h3">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'chart' | 'table' | null) => v && setView(v)} aria-label={`${title} view`}>
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
          <BarChart
            height={rows.length * 30 + 44}
            layout="horizontal"
            hideLegend
            skipAnimation
            borderRadius={4}
            margin={{ left: 4, right: 18, top: 4, bottom: 0 }}
            grid={{ vertical: true }}
            yAxis={[
              {
                scaleType: 'band',
                data: rows.map((r) => r.label),
                width: labelWidth,
                categoryGapRatio: 0.38,
                disableTicks: true,
                disableLine: true,
                tickLabelStyle: { fontSize: 13, fill: 'var(--mui-palette-text-primary)' },
              },
            ]}
            xAxis={[
              {
                min: -domain,
                max: domain,
                tickInterval: ticks,
                valueFormatter: (v: number | null) => (v == null ? '' : tickFormat(v)),
                disableTicks: true,
                tickLabelStyle: { fontSize: 12, fill: viz.muted },
                height: 24,
              },
            ]}
            series={[
              {
                data: rows.map((r) => r.value),
                label: title,
                color: forMe.good,
                colorGetter: ({ dataIndex }) => {
                  const r = rows[dataIndex];
                  if (!r || r.value == null || r.neutral || Math.abs(r.value) < evenBand) return forMe.neutral;
                  const good = invert ? r.value < 0 : r.value > 0;
                  return good ? forMe.good : forMe.bad;
                },
                barLabel: (item) => {
                  const r = rows[item.dataIndex];
                  return r ? `${symbolFor(r)} ${r.display}` : '';
                },
                barLabelPlacement: 'outside',
                valueFormatter: (_v, ctx) => rows[ctx.dataIndex]?.display ?? '',
              },
            ]}
            onItemClick={(_e, item) => setSelected(item.dataIndex ?? null)}
            sx={{
              '& .MuiChartsGrid-line': { stroke: viz.grid, strokeWidth: 1 },
              '& .MuiChartsAxis-line': { stroke: viz.axis },
              '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 12, fontWeight: 600 },
            }}
          >
            <ChartsReferenceLine x={0} lineStyle={{ stroke: viz.axis, strokeWidth: 1.5 }} />
          </BarChart>
          <Typography variant="body2" role="status" aria-live="polite" sx={{ minHeight: 22, color: sel ? 'text.primary' : 'text.secondary' }}>
            {sel ? `${sel.readout ?? `${sel.label}: ${sel.display}`} (${sel.neutral ? 'not counted' : forMeWord(signOf(sel), evenBand)})` : hint}
          </Typography>
        </>
      ) : (
        <Table size="small" aria-label={title}>
          <TableHead>
            <TableRow>
              {table.headers.map((h, i) => (
                <TableCell key={h} align={i === 0 ? 'left' : 'right'} sx={{ px: 0.75 }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, ri) => (
              <TableRow key={r.key}>
                {table.cells(r, ri).map((c, i) => (
                  <TableCell key={i} align={i === 0 ? 'left' : 'right'} className={i === 0 ? undefined : 'tabular'} sx={{ px: 0.75 }}>
                    {c}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {missing > 0 && (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
          No estimate for {missing} {missing === 1 ? 'row' : 'rows'} (shown gray, not zero).
        </Typography>
      )}
    </Box>
  );
}
