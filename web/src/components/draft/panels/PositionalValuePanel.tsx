import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { ApiError } from '../../../api/client';
import type { PositionalValue } from '../../../api/types';
import { fixed } from '../../../lib/format';
import { GROUP_COLORS, POSITIONS, positionGroup } from '../../../lib/positions';
import { useResolvedMode, useVizColors } from '../../../theme/viz';
import { BarChart } from '@mui/x-charts/BarChart';
import { EndpointNotice } from '../../app-shell/EndpointNotice';

export interface PositionalValuePanelProps {
  positions: PositionalValue[] | null;
  error?: ApiError | null;
  loading?: boolean;
  /** The engine's own note on these numbers. */
  note?: string | null;
}

/**
 * "Positional Value Over Replacement": one bar per position on the engine's Low→High scale
 * (scale_0_1), from available players and my open slots. Bars are colored by position group
 * and labelled with the position; the info dialog has the explanation and a table of every value.
 */
export function PositionalValuePanel({ positions, error, loading, note }: PositionalValuePanelProps) {
  const [open, setOpen] = useState(false);
  const mode = useResolvedMode();
  const viz = useVizColors();
  const byPos = new Map((positions ?? []).map((p) => [p.pos, p]));
  const hasDrop = (positions ?? []).some((p) => p.drop_if_wait != null);

  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography variant="subtitle2" component="h2" sx={{ lineHeight: 1.2 }}>
          Positional value
          <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            over replacement
          </Typography>
        </Typography>
        <IconButton aria-label="About positional value, with every value" onClick={() => setOpen(true)} sx={{ mr: -1.25 }}>
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
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
          sx={{ '& .MuiChartsAxis-line': { stroke: viz.axis } }}
        />
      )}

      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="vor-title" fullWidth>
        <DialogTitle id="vor-title">Positional value over replacement</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            For each position, how much better the best available player is than the replacement-level
            player you could still get later, from the players left on the board and the starting slots
            your team still has open. A long bar means waiting at that position costs you the most. The
            engine computes these numbers; the bars only show its 0–1 scale. Tap
            a bar for the best player still available there.
          </Typography>
          {positions && (
            <Table size="small" aria-label="Value over replacement by position">
              <TableHead>
                <TableRow>
                  <TableCell>Pos</TableCell>
                  <TableCell>Best available</TableCell>
                  <TableCell align="right">VOR</TableCell>
                  {hasDrop && <TableCell align="right">If wait</TableCell>}
                  <TableCell align="right">Open</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {POSITIONS.map((pos) => {
                  const v = byPos.get(pos);
                  return (
                    <TableRow key={pos}>
                      <TableCell>{pos}</TableCell>
                      <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v?.best_available?.name ?? '—'}
                      </TableCell>
                      <TableCell align="right" className="tabular">{fixed(v?.value_over_replacement, 2)}</TableCell>
                      {hasDrop && <TableCell align="right" className="tabular">{v?.drop_if_wait == null ? '—' : `−${fixed(Math.abs(v.drop_if_wait), 2)}`}</TableCell>}
                      <TableCell align="right" className="tabular">{v?.my_open_slots ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {note && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {note}
            </Typography>
          )}
          {hasDrop && (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
              If wait: value the engine expects you to lose at that position by waiting until your following pick.
            </Typography>
          )}
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
            Bar colors group positions (guards, forwards, centers); the label names the position.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
