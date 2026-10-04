import { useMemo, useState } from 'react';
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
import type { Category } from '../../api/types';
import { pct } from '../../lib/format';
import { useVizColors } from '../../theme/viz';
import { buildRows, EVEN_BAND, standing } from './categoryOdds';

export interface CategoryOddsChartProps {
  pCat: Record<string, number | null>;
  categories: Category[];
  punts?: string[];
  /** Initial view; the user can switch between chart and table. */
  initialView?: 'chart' | 'table';
}

/**
 * "My category odds": P(win) per category against a league-average team, as horizontal
 * diverging bars from a 50% midline (blue = favored, red = behind, gray = about even or
 * punted). Value labels at the bar tips; tap a bar for a readout (touch has no hover);
 * a table view carries every value without the chart.
 */
export function CategoryOddsChart({ pCat, categories, punts = [], initialView = 'chart' }: CategoryOddsChartProps) {
  const viz = useVizColors();
  const [view, setView] = useState<'chart' | 'table'>(initialView);
  const [selected, setSelected] = useState<number | null>(null);
  const rows = useMemo(() => buildRows(pCat, categories, punts), [pCat, categories, punts]);
  const data = rows.map((r) => (r.p == null ? null : r.p - 0.5));
  const missing = rows.filter((r) => r.p == null).length;
  const sel = selected == null ? null : rows[selected];

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h3">
            My category odds
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            P(win) vs a league-average team
          </Typography>
        </Box>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_, v: 'chart' | 'table' | null) => v && setView(v)}
          aria-label="Category odds view"
        >
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
            margin={{ left: 4, right: 8, top: 4, bottom: 0 }}
            grid={{ vertical: true }}
            yAxis={[
              {
                scaleType: 'band',
                data: rows.map((r) => (r.punted ? `${r.label} (punt)` : r.label)),
                width: 74,
                categoryGapRatio: 0.38,
                disableTicks: true,
                disableLine: true,
                tickLabelStyle: { fontSize: 13, fill: 'var(--mui-palette-text-primary)' },
              },
            ]}
            xAxis={[
              {
                min: -0.62,
                max: 0.62,
                tickInterval: [-0.5, -0.25, 0, 0.25, 0.5],
                valueFormatter: (v: number | null) => (v == null ? '' : `${Math.round((v + 0.5) * 100)}%`),
                disableTicks: true,
                tickLabelStyle: { fontSize: 12, fill: viz.muted },
                height: 24,
              },
            ]}
            series={[
              {
                data,
                label: 'P(win category)',
                colorGetter: ({ dataIndex }) => {
                  const r = rows[dataIndex];
                  if (!r || r.p == null || r.punted || Math.abs(r.p - 0.5) < EVEN_BAND) return viz.neutral;
                  return r.p > 0.5 ? viz.pos : viz.neg;
                },
                color: viz.pos,
                barLabel: (item) => pct(rows[item.dataIndex]?.p ?? null),
                barLabelPlacement: 'outside',
                valueFormatter: (_v, ctx) => {
                  const r = rows[ctx.dataIndex];
                  return r ? `${pct(r.p)} (${standing(r)})` : '';
                },
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
          <Typography
            variant="body2"
            role="status"
            aria-live="polite"
            sx={{ minHeight: 22, color: sel ? 'text.primary' : 'text.secondary' }}
          >
            {sel
              ? `${sel.label}: ${pct(sel.p)} to win, ${standing(sel)}`
              : 'Tap a bar for its value. 50% is a coin flip.'}
          </Typography>
        </>
      ) : (
        <Table size="small" aria-label="My category odds">
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell align="right">P(win)</TableCell>
              <TableCell>Standing</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.label}</TableCell>
                <TableCell align="right" className="tabular">
                  {pct(r.p)}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{standing(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {missing > 0 && (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
          The engine returned no estimate for {missing} {missing === 1 ? 'category' : 'categories'}.
        </Typography>
      )}
    </Box>
  );
}
