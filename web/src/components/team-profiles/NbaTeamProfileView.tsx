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
import { BarChart } from '@mui/x-charts/BarChart';
import type { NbaTeamProfile, PlayerRef, TeamWeeksResponse } from '../../api/season';
import { ordinal } from '../../lib/format';
import { useVizColors } from '../../theme/viz';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { PlayerLine } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { dateRange } from '../foundations/seasonFormat';
import { MonthAhead } from '../player-profiles/MonthAhead';

export interface NbaTeamProfileViewProps {
  team: NbaTeamProfile | null;
  /** The league's weeks (implemented /schedule/team_weeks) for labels and playoff flags. */
  weeks: TeamWeeksResponse | null;
  today: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
}

/**
 * An NBA team: pace and defense context, games per fantasy week all season (MUI X columns,
 * playoff weeks emphasized, 14-day weeks starred), its next month of game days (B2Bs,
 * light days, 4-game weeks), and which of my / my opponent's players it affects.
 */
export function NbaTeamProfileView({ team: t, weeks, today, loading, error, onRetry, onBack, onOpenPlayer, onTabChange }: NbaTeamProfileViewProps) {
  const viz = useVizColors();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const header = <ScreenHeader title={t ? `${t.name} (${t.team})` : 'NBA team'} subtitle={t ? `${t.weeks.total} games · ${t.weeks.playoff_games} in your playoff weeks` : undefined} asOf={t?.as_of} stale={t?.stale} onBack={onBack} />;
  let body;
  if (error && !t) body = <ErrorState message={error} onRetry={onRetry} what="this team" />;
  else if (!t || !weeks) body = <LoadingState blocks={[120, 240, 420]} label={loading ? 'Loading the team' : 'Loading'} />;
  else {
    const w = weeks.weeks;
    const missing = t.pace_rank == null || t.def_rank == null;
    const ctxConf = missing
      ? { level: 'low' as const, score: null, missing: [{ key: 'advanced', label: 'No pace or defensive rating yet this season', effect: 'Matchup context left out' }] }
      : { level: 'high' as const, score: null, missing: [] };
    body = (
      <Stack spacing={1.5}>
        {t.stale && <StaleBanner reason={t.stale_reason} asOf={t.as_of} />}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            Matchup context
          </Typography>
          <Typography variant="body2" className="tabular" sx={{ mt: 0.25 }}>
            Pace {t.pace ?? '—'} ({t.pace_rank ? `${ordinal(t.pace_rank)} fastest` : 'no rank'}) · Defensive rating {t.def_rating ?? '—'} (
            {t.def_rank ? `${ordinal(t.def_rank)} best` : 'no rank'})
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
            Fast teams and weak defenses raise opponents’ counting stats.
          </Typography>
          <Box sx={{ mt: 0.75 }}>
            <ConfidenceChip confidence={ctxConf} compact />
          </Box>
          <MissingInputs confidence={ctxConf} />
        </Card>
        <Card sx={{ p: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="subtitle2" component="h2">
                Games per fantasy week
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Blue = playoff weeks (20–22) · * = 14-day week
              </Typography>
            </Box>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'chart' | 'table' | null) => v && setView(v)} aria-label="Weeks view">
              <ToggleButton value="chart" sx={{ px: 1.5 }}>
                Chart
              </ToggleButton>
              <ToggleButton value="table" sx={{ px: 1.5 }}>
                Table
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {view === 'chart' ? (
            <BarChart
              height={180}
              hideLegend
              skipAnimation
              borderRadius={3}
              margin={{ left: 0, right: 4, top: 14, bottom: 0 }}
              grid={{ horizontal: true }}
              xAxis={[{ scaleType: 'band', data: w.map((x) => `${x.week}${x.n_days > 7 ? '*' : ''}`), categoryGapRatio: 0.3, disableTicks: true, tickLabelStyle: { fontSize: 9, fill: viz.muted }, height: 20 }]}
              yAxis={[{ min: 0, tickInterval: [0, 2, 4, 6, 8], width: 22, disableTicks: true, disableLine: true, tickLabelStyle: { fontSize: 10, fill: viz.muted } }]}
              series={[
                {
                  data: w.map((x) => t.weeks.games_by_week[String(x.week)] ?? 0),
                  label: 'Games',
                  color: viz.neutral,
                  colorGetter: ({ dataIndex }) => (w[dataIndex]?.is_playoff ? viz.meterFill : viz.neutral),
                  valueFormatter: (v, ctx) => `${v ?? 0} games, week ${w[ctx.dataIndex]?.week ?? ''}`,
                },
              ]}
              sx={{ '& .MuiChartsGrid-line': { stroke: viz.grid, strokeWidth: 1 } }}
            />
          ) : (
            <Table size="small" aria-label="Games per week">
              <TableHead>
                <TableRow>
                  {['Week', 'Dates', 'Games', 'B2B', 'Light'].map((h, i) => (
                    <TableCell key={h} align={i > 1 ? 'right' : 'left'} sx={{ px: 0.5 }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {w.map((x) => (
                  <TableRow key={x.week}>
                    <TableCell sx={{ px: 0.5 }}>
                      {x.week}
                      {x.n_days > 7 ? '*' : ''}
                      {x.is_playoff ? ' PO' : ''}
                    </TableCell>
                    <TableCell sx={{ px: 0.5 }}>{dateRange(x.start, x.end)}</TableCell>
                    <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                      {t.weeks.games_by_week[String(x.week)] ?? 0}
                    </TableCell>
                    <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                      {t.weeks.b2b_by_week[String(x.week)] ?? 0}
                    </TableCell>
                    <TableCell align="right" className="tabular" sx={{ px: 0.5 }}>
                      {t.weeks.light_day_games_by_week[String(x.week)] ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2" sx={{ mb: 0.5 }}>
            Next 30 days
          </Typography>
          <MonthAhead days={{ team: t.team, days: t.days }} weeks={weeks} today={today} perspective={t.opponent_players.length && !t.my_players.length ? 'opponent' : t.my_players.length ? 'mine' : 'neutral'} />
        </Card>
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            Players you care about
          </Typography>
          {t.my_players.length + t.opponent_players.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
              None of your players or your opponent’s play for {t.team}. Its game days are streaming chances.
            </Typography>
          ) : (
            <>
              {t.my_players.map((p) => (
                <PlayerLine key={p.player_id} player={p} detail="yours" onOpen={onOpenPlayer} />
              ))}
              {t.opponent_players.map((p) => (
                <PlayerLine key={p.player_id} player={p} detail="opponent’s" onOpen={onOpenPlayer} />
              ))}
            </>
          )}
        </Card>
        <ProvenanceLine provenance={t.provenance} />
      </Stack>
    );
  }
  return (
    <SeasonShell tab="research" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
