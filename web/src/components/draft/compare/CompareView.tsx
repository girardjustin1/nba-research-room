import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { ApiError, errorMessage } from '../../../api/client';
import type { Category, ComparePlayer, TeamDay, TeamWeeksResponse } from '../../../api/types';
import { TeamVolumeStrip } from '../../foundations/charts/TeamVolumeStrip';
import { MISSING } from '../../../lib/format';
import { compareRows } from '../../../lib/draftHelpers';
import { FullScreenPanel } from '../../app-shell/FullScreenPanel';
import { PositionBadge } from '../../foundations/badges/PositionBadge';

export interface CompareViewProps {
  open: boolean;
  ids: number[];
  categories: Category[];
  /** GET /draft/compare. */
  load: (ids: number[]) => Promise<ComparePlayer[]>;
  /** What we already know about these players (pool + board), used if compare is missing. */
  fallback: ComparePlayer[];
  onClose: () => void;
  schedule?: TeamWeeksResponse | null;
  scheduleError?: ApiError | null;
  loadDays?: (team: string, start: string, end: string) => Promise<TeamDay[]>;
}


/** Side-by-side comparison of 2-3 players, all numbers from the engine. */
export function CompareView({ open, ids, categories, load, fallback, onClose, schedule, scheduleError, loadDays }: CompareViewProps) {
  const [players, setPlayers] = useState<ComparePlayer[] | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const key = ids.join(',');

  useEffect(() => {
    if (!open || ids.length === 0) return;
    let live = true;
    load(ids).then(
      (p) => {
        if (!live) return;
        setPlayers(p);
        setError(null);
      },
      (err: unknown) => {
        if (!live) return;
        setPlayers(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      live = false;
      setPlayers(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the set of ids changes
  }, [open, key, load]);

  const shown = players ?? (error ? fallback : null);
  const rows = compareRows(categories);

  return (
    <FullScreenPanel open={open} title="Compare players" onClose={onClose}>
      {error && (
        <Alert severity={error instanceof ApiError && error.isNotFound ? 'info' : 'error'} sx={{ m: 2, mb: 0 }}>
          {error instanceof ApiError && error.isNotFound
            ? 'Per-game lines and z-scores need the updated draft API (GET /draft/compare is not there yet). Showing what the board already has.'
            : `Compare failed: ${errorMessage(error)}`}
        </Alert>
      )}
      {!shown ? (
        <Box sx={{ p: 2 }}>
          <Skeleton variant="rounded" height={420} />
        </Box>
      ) : (
        <Table size="small" stickyHeader aria-label="Player comparison" sx={{ tableLayout: 'fixed', '& td, & th': { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '28%' }} />
              {shown.map((p) => (
                <TableCell key={p.player_id} sx={{ verticalAlign: 'bottom' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{p.name}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
                    <PositionBadge pos={p.position} />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.team_abbr ?? MISSING}</Typography>
                  </Box>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => [
              r.section ? (
                <TableRow key={`s-${r.section}`}>
                  <TableCell colSpan={shown.length + 1} sx={{ bgcolor: 'background.default', py: 0.5 }}>
                    <Typography variant="overline" sx={{ color: 'text.secondary' }}>{r.section}</Typography>
                  </TableCell>
                </TableRow>
              ) : null,
              <TableRow key={r.label}>
                <TableCell component="th" scope="row" sx={{ color: 'text.secondary' }}>{r.label}</TableCell>
                {shown.map((p) => (
                  <TableCell key={p.player_id} className="tabular" sx={{ fontWeight: 600 }}>{r.get(p)}</TableCell>
                ))}
              </TableRow>,
            ])}
          </TableBody>
        </Table>
      )}
      {shown && schedule !== undefined && (
        <Box sx={{ px: 2, py: 2 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Team schedule volume</Typography>
          {shown.map((p) => (
            <Box key={p.player_id} sx={{ mt: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{p.name} · {p.team_abbr ?? MISSING}</Typography>
              <TeamVolumeStrip teamAbbr={p.team_abbr} schedule={schedule} scheduleError={scheduleError} loadDays={loadDays} dense />
            </Box>
          ))}
        </Box>
      )}
    </FullScreenPanel>
  );
}
