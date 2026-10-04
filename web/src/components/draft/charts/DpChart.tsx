import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import type { Category, Recommendation } from '../../../api/types';
import { CATEGORY_ORDER } from '../../foundations/charts/categoryOdds';
import { forMeColor, useResolvedMode, useVizColors } from '../../../theme/viz';
import { pp } from '../../../lib/draftHelpers';


export interface DpChartProps {
  rec: Recommendation;
  categories: Category[];
  /** Shared axis half-width (max |dp| across the list) so cards compare at a glance. */
  scaleMax: number;
}

/**
 * Per-category change in my win probability if I take this player (the board's dp_<cat>),
 * as diverging horizontal bars from 0 (MUI X BarChart). Labels print the points.
 */
export function DpChart({ rec, categories, scaleMax }: DpChartProps) {
  const viz = useVizColors();
  const mode = useResolvedMode();
  const keys = [...CATEGORY_ORDER.filter((k) => categories.some((c) => c.key === k)), ...categories.map((c) => c.key).filter((k) => !CATEGORY_ORDER.includes(k))];
  const values = keys.map((k) => {
    const v = rec[`dp_${k}`];
    return typeof v === 'number' ? v : null;
  });
  if (values.every((v) => v == null)) return null;
  // Room for the outside labels: 1.6x the larger of the shared scale and this player's own max.
  const own = Math.max(0, ...values.map((v) => Math.abs(v ?? 0)));
  const max = Math.max(scaleMax, own, 0.005) * 1.6;
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Change in my win chance per category (points)
      </Typography>
      <BarChart
        height={keys.length * 22 + 34}
        layout="horizontal"
        hideLegend
        skipAnimation
        borderRadius={3}
        margin={{ left: 0, right: 4, top: 2, bottom: 0 }}
        yAxis={[
          {
            scaleType: 'band',
            data: keys.map((k) => categories.find((c) => c.key === k)?.label ?? k),
            width: 44,
            categoryGapRatio: 0.4,
            disableTicks: true,
            disableLine: true,
            tickLabelStyle: { fontSize: 12, fill: 'var(--mui-palette-text-primary)' },
          },
        ]}
        xAxis={[{ min: -max, max, tickInterval: [0], valueFormatter: () => '0', disableTicks: true, tickLabelStyle: { fontSize: 11, fill: viz.muted }, height: 24 }]}
        series={[
          {
            data: values,
            label: 'Change in P(win category)',
            // Green helps my win chance, red hurts it, gray is no effect; labels carry the sign.
            colorGetter: ({ dataIndex }) => forMeColor(values[dataIndex], { min: -max / 1.6, max: max / 1.6, deadband: 0.0005 }, mode),
            color: viz.neutral,
            barLabel: (item) => pp(values[item.dataIndex]),
            barLabelPlacement: 'outside',
            valueFormatter: (v) => `${pp(v)} pts`,
          },
        ]}
        sx={{
          '& .MuiChartsAxis-line': { stroke: viz.axis },
          '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 11, fontWeight: 600 },
        }}
      >
        <ChartsReferenceLine x={0} lineStyle={{ stroke: viz.axis, strokeWidth: 1 }} />
      </BarChart>
    </Box>
  );
}
