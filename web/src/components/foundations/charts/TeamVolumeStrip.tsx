import { useEffect, useState } from 'react';
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
import type { ApiError } from '../../../api/client';
import type { TeamDay, TeamWeeksResponse } from '../../../api/types';
import { monthTotals, scheduleTeam, teamWeeksFor, weekLabel } from '../../../lib/schedule';
import { useVizColors } from '../../../theme/viz';
import { EndpointNotice } from '../../app-shell/EndpointNotice';

export interface TeamVolumeStripProps {
  /** Player's NBA team as the player record has it (BBM codes are mapped for the join). */
  teamAbbr: string | null | undefined;
  schedule: TeamWeeksResponse | null;
  scheduleError?: ApiError | null;
  /** GET /schedule/team_days for month totals (optional). */
  loadDays?: (team: string, start: string, end: string) => Promise<TeamDay[]>;
  /** Hide the title line (e.g. when a parent already names the player). */
  dense?: boolean;
}

const short = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/**
 * Games per fantasy week for one NBA team across the season (MUI X BarChart), with the
 * fantasy playoff weeks (20-22) emphasized, plus games per calendar month. Counts are the
 * API's real schedule; weeks marked * are two-week periods (14 days), so they carry about
 * twice the games and are labelled rather than rescaled.
 */
export function TeamVolumeStrip({ teamAbbr, schedule, scheduleError, loadDays, dense }: TeamVolumeStripProps) {
  const viz = useVizColors();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [sel, setSel] = useState<number | null>(null);
  const [months, setMonths] = useState<{ month: string; key: string; games: number }[] | null>(null);
  const [monthsFailed, setMonthsFailed] = useState(false);
  const team = teamWeeksFor(teamAbbr, schedule);
  const code = scheduleTeam(teamAbbr);
  const first = schedule?.weeks[0]?.start;
  const last = schedule?.weeks[schedule.weeks.length - 1]?.end;

  useEffect(() => {
    if (!loadDays || !code || !first || !last || !team) return;
    let live = true;
    loadDays(code, first, last).then(
      (days) => live && setMonths(monthTotals(days)),
      () => live && setMonthsFailed(true),
    );
    return () => {
      live = false;
    };
  }, [loadDays, code, first, last, team]);

  if (!schedule) {
    return scheduleError ? (
      <EndpointNotice error={scheduleError} endpoint="GET /schedule/team_weeks" what="Games per week" />
    ) : (
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Loading the schedule…</Typography>
    );
  }
  if (!team) {
    return (
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        No schedule for {teamAbbr ?? 'this player (no team)'}.
      </Typography>
    );
  }

  const weeks = schedule.weeks;
  const games = weeks.map((w) => team.games_by_week[String(w.week)] ?? null);
  const s = sel == null ? null : weeks[sel];
  const playoffLabel = weeks.filter((w) => w.is_playoff).map((w) => w.week);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          {!dense && (
            <Typography variant="subtitle2" component="h3">
              {team.team} games per fantasy week
            </Typography>
          )}
          <Typography variant="body2" className="tabular">
            <Box component="span" sx={{ fontWeight: 700 }}>{team.playoff_games}</Box>{' '}
            <Box component="span" sx={{ color: 'text.secondary' }}>
              in playoff weeks {playoffLabel.length ? `${playoffLabel[0]}–${playoffLabel[playoffLabel.length - 1]}` : ''} · {team.total} total
            </Box>
          </Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'chart' | 'table' | null) => v && setView(v)} aria-label={`${team.team} schedule view`}>
          <ToggleButton value="chart" sx={{ px: 1.25 }}>Chart</ToggleButton>
          <ToggleButton value="table" sx={{ px: 1.25 }}>Table</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === 'chart' ? (
        <>
          <BarChart
            height={134}
            hideLegend
            skipAnimation
            borderRadius={3}
            margin={{ left: 0, right: 4, top: 14, bottom: 0 }}
            grid={{ horizontal: true }}
            xAxis={[
              {
                scaleType: 'band',
                data: weeks.map(weekLabel),
                categoryGapRatio: 0.3,
                disableTicks: true,
                tickLabelStyle: { fontSize: 10, fill: viz.muted },
                // Every band gets a tick; label weeks 1, 4, 7, ... and the playoff weeks only (402px).
                tickInterval: () => true,
                tickLabelInterval: () => true,
                valueFormatter: (v: string, ctx: { location: string }) => {
                  if (ctx.location !== 'tick') return v;
                  const i = weeks.findIndex((w) => weekLabel(w) === v);
                  return i % 3 === 0 || weeks[i]?.is_playoff ? v : '';
                },
                height: 24,
              },
            ]}
            yAxis={[{ min: 0, width: 22, tickNumber: 3, disableTicks: true, disableLine: true, tickLabelStyle: { fontSize: 10, fill: viz.muted } }]}
            series={[
              {
                data: games,
                label: 'Games',
                color: viz.neutral,
                colorGetter: ({ dataIndex }) => (weeks[dataIndex]?.is_playoff ? viz.pos : viz.neutral),
                barLabel: (item) => (weeks[item.dataIndex]?.is_playoff ? String(games[item.dataIndex] ?? '') : null),
                barLabelPlacement: 'outside',
                valueFormatter: (v, ctx) => {
                  const w = weeks[ctx.dataIndex];
                  return w ? `${v ?? '—'} games, week ${w.week} (${short(w.start)}–${short(w.end)}${w.n_days > 7 ? ', 2 weeks' : ''})` : String(v);
                },
              },
            ]}
            onItemClick={(_e, item) => setSel(item.dataIndex ?? null)}
            sx={{
              '& .MuiChartsGrid-line': { stroke: viz.grid },
              '& .MuiChartsAxis-line': { stroke: viz.axis },
              '& .MuiBarLabel-root': { fill: 'var(--mui-palette-text-secondary)', fontSize: 10, fontWeight: 700 },
            }}
          />
          <Typography variant="caption" component="p" role="status" aria-live="polite" sx={{ color: s ? 'text.primary' : 'text.secondary', minHeight: 18 }}>
            {s
              ? `Week ${s.week}${s.is_playoff ? ' (playoffs)' : ''}, ${short(s.start)}–${short(s.end)}: ${team.games_by_week[String(s.week)] ?? '—'} games, ${team.b2b_by_week[String(s.week)] ?? 0} back-to-back, ${team.light_day_games_by_week[String(s.week)] ?? 0} on light days`
              : 'Blue = fantasy playoff weeks. * = two-week period (14 days). Tap a bar.'}
          </Typography>
        </>
      ) : (
        <Box sx={{ maxHeight: 260, overflowY: 'auto', mt: 0.5 }}>
          <Table size="small" stickyHeader aria-label={`${team.team} games per fantasy week`}>
            <TableHead>
              <TableRow>
                <TableCell>Week</TableCell>
                <TableCell>Dates</TableCell>
                <TableCell align="right">Games</TableCell>
                <TableCell align="right">B2B</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {weeks.map((w) => (
                <TableRow key={w.week} selected={w.is_playoff}>
                  <TableCell>{w.week}{w.is_playoff ? ' (PO)' : ''}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{short(w.start)}–{short(w.end)}</TableCell>
                  <TableCell align="right" className="tabular">{team.games_by_week[String(w.week)] ?? '—'}</TableCell>
                  <TableCell align="right" className="tabular">{team.b2b_by_week[String(w.week)] ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {months && months.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Games per month</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(months.length, 7)}, minmax(0, 1fr))`, gap: 0.5, mt: 0.25 }}>
            {months.map((m) => (
              <Box key={m.key} sx={{ textAlign: 'center', border: 1, borderColor: 'divider', borderRadius: 1, py: 0.25 }}>
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>{m.month}</Typography>
                <Typography variant="body2" component="p" className="tabular" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{m.games}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {monthsFailed && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Month totals unavailable (GET /schedule/team_days failed).</Typography>
      )}
      {schedule.unscheduled_note && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Note: {schedule.unscheduled_note.replace(/\.\s*$/, '')}.
        </Typography>
      )}
    </Box>
  );
}
