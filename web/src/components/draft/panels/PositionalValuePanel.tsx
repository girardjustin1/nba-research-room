import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { ApiError } from '../../../api/client';
import type { PositionalValue } from '../../../api/types';
import { fixed } from '../../../lib/format';
import { GROUP_COLORS, POSITIONS, positionGroup } from '../../../lib/positions';
import { useResolvedMode, useVizColors } from '../../../theme/viz';
import { BarChart } from '@mui/x-charts/BarChart';
import { EndpointNotice } from '../../app-shell/EndpointNotice';
import { DetailSheet } from '../../foundations/DetailSheet';

export interface PositionalValuePanelProps {
  positions: PositionalValue[] | null;
  error?: ApiError | null;
  loading?: boolean;
  /** The engine's own note on these numbers. */
  note?: string | null;
  /** Stories: open the explanation sheet on first render. */
  initialOpen?: boolean;
}

/**
 * "Positional Value Over Replacement": one bar per position on the engine's Low→High scale
 * (scale_0_1), from available players and my open slots. Bars are colored by position group
 * and labelled with the position. The bars have no hover tooltips: tapping anywhere on the
 * panel slides up one card that explains every position (score, best available, value over
 * replacement, open slots, what waiting costs).
 */
export function PositionalValuePanel({ positions, error, loading, note, initialOpen = false }: PositionalValuePanelProps) {
  const [open, setOpen] = useState(initialOpen);
  const mode = useResolvedMode();
  const viz = useVizColors();
  const byPos = new Map((positions ?? []).map((p) => [p.pos, p]));

  const canOpen = positions != null && positions.length > 0;
  return (
    <Box sx={{ minWidth: 0 }}>
      <ButtonBase
        onClick={() => canOpen && setOpen(true)}
        disabled={!canOpen}
        aria-label="Positional value over replacement: tap for what each bar means"
        aria-haspopup="dialog"
        sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 1, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
      >
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography variant="subtitle2" component="h2" sx={{ lineHeight: 1.2 }}>
          Positional value
          <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            over replacement
          </Typography>
        </Typography>
        <InfoOutlinedIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
      </Stack>

      {error && !positions ? (
        <EndpointNotice error={error} endpoint="GET /draft/positional_value" what="Positional value" />
      ) : loading && !positions ? (
        <Stack spacing={0.75}>{POSITIONS.map((p) => <Skeleton key={p} height={18} />)}</Stack>
      ) : (
        <BarChart
          height={POSITIONS.length * 22 + 32}
          layout="horizontal"
          hideLegend
          skipAnimation
          borderRadius={4}
          margin={{ left: 0, right: 6, top: 2, bottom: 0 }}
          yAxis={[{ scaleType: 'band', data: POSITIONS, width: 26, categoryGapRatio: 0.35, disableTicks: true, disableLine: true, tickLabelStyle: { fontSize: 12, fontWeight: 700, fill: 'var(--mui-palette-text-primary)' } }]}
          xAxis={[{ min: 0, max: 1, // MUI drops tick labels that overflow the plot edge, so the Low/High marks sit just inside it.
            tickInterval: [0.1, 0.9], valueFormatter: (v: number) => (v < 0.5 ? 'Low' : 'High'), disableTicks: true, tickLabelStyle: { fontSize: 11, fill: viz.muted }, height: 24 }]}
          series={[
            {
              data: POSITIONS.map((pos) => {
                const v = byPos.get(pos)?.scale_0_1;
                return v == null ? null : Math.max(0, Math.min(1, v));
              }),
              label: 'Value over replacement (0 = low, 1 = high)',
              color: viz.neutral,
              colorGetter: ({ dataIndex }) => {
                const g = positionGroup(POSITIONS[dataIndex]);
                return g ? GROUP_COLORS[mode][g] : viz.neutral;
              },
              valueFormatter: (v, ctx) => {
                const p = byPos.get(POSITIONS[ctx.dataIndex] ?? 'PG');
                return v == null ? 'no estimate' : `${Math.round(v * 100)}/100 · best ${p?.best_available?.name ?? '—'}`;
              },
            },
          ]}
          grid={{ vertical: false }}
          slotProps={{ tooltip: { trigger: 'none' } }}
          sx={{ pointerEvents: 'none', '& .MuiChartsAxis-line': { stroke: viz.axis } }}
        />
      )}
      </ButtonBase>

      <DetailSheet
        open={open}
        onClose={() => setOpen(false)}
        content={{
          title: 'Positional value over replacement',
          subtitle: 'How much you lose by waiting at each position',
          sections: [],
        }}
      >
        <Box sx={{ px: 2, pb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            For each position: how much better the best player still available is than the replacement-level
            player you could still get later, given the players left and the starting slots you still have open.
            A longer bar means waiting at that position costs you more.
          </Typography>
          <Stack component="ul" spacing={1.25} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-label="Every position">
            {POSITIONS.map((pos) => {
              const v = byPos.get(pos);
              const g = positionGroup(pos);
              const color = g ? GROUP_COLORS[mode][g] : viz.neutral;
              const s = v?.scale_0_1 == null ? null : Math.max(0, Math.min(1, v.scale_0_1));
              return (
                <Box component="li" key={pos} sx={{ pb: 1.25, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0, pb: 0 } }}>
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800, width: 28 }}>
                      {pos}
                    </Typography>
                    <Box sx={{ flex: 1, height: 10, borderRadius: 1, bgcolor: 'action.hover', overflow: 'hidden' }} aria-hidden>
                      <Box sx={{ width: `${(s ?? 0) * 100}%`, height: '100%', bgcolor: color, borderRadius: 1 }} />
                    </Box>
                    <Typography variant="body2" className="tabular" sx={{ fontWeight: 700, width: 56, textAlign: 'right' }}>
                      {s == null ? '—' : `${Math.round(s * 100)}/100`}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    Best available: <b>{v?.best_available?.name ?? 'none'}</b>
                  </Typography>
                  <Typography variant="caption" component="p" className="tabular" sx={{ color: 'text.secondary' }}>
                    Value over replacement {fixed(v?.value_over_replacement, 2)}
                    {' · '}your open {pos} slots: {v?.my_open_slots ?? '—'}
                    {v?.drop_if_wait != null ? ` · waiting until your following pick costs about ${fixed(Math.abs(v.drop_if_wait), 2)}` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
          {note && (
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              {note}
            </Typography>
          )}
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1.5 }}>
            /100 is relative to this pick: the position with the most value over replacement scores 100.
            Colors group positions: blue guards, orange forwards, green centers. Every number here comes
            from the engine.
          </Typography>
        </Box>
      </DetailSheet>
    </Box>
  );
}
