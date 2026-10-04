import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ScheduleWeek, TeamWeeksResponse } from '../../api/season';
import { FOR_ME, forMeColor, forMeSymbol, forMeWord, useResolvedMode, useVizColors } from '../../theme/viz';
import { DetailSheet } from '../foundations/DetailSheet';
import { inkOn } from '../foundations/heatScale';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState } from '../foundations/ScreenStates';
import { dateRange } from '../foundations/seasonFormat';
import { median, monthKey, scheduleWindows, sortTeamsByGames } from './scheduleWindows';

export interface ScheduleVolumeProps {
  data: TeamWeeksResponse | null;
  /** NBA teams of players on my roster (green when they play more). */
  myTeams: string[];
  /** NBA teams of my opponent's players this week (red when they play more). */
  opponentTeams?: string[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onTabChange?: (tab: SeasonTab) => void;
  initialWindow?: string;
  /** Open a cell's sheet on mount (stories). */
  initialOpen?: { team: string; week: number } | null;
  /** Today, to pick the default window. */
  today: string;
}

/**
 * Schedule volume: all 30 NBA teams × the fantasy weeks of one month (or the playoffs),
 * games per week, sorted by most games in the window. Built from layout (MUI X's heatmap is
 * Pro). Each cell is colored for me against that week's league median: green ▲ = more games
 * than usual for a team whose players help me (my roster, or free agents), red ▼ = fewer;
 * for my opponent's teams the colors flip. Weeks 1 and 17 span 14 days and are labelled.
 */
export function ScheduleVolume({ data, myTeams, opponentTeams = [], loading, error, onRetry, onTabChange, initialWindow, today, initialOpen = null }: ScheduleVolumeProps) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  const windows = useMemo(() => (data ? scheduleWindows(data.weeks) : []), [data]);
  const [win, setWin] = useState<string>(initialWindow ?? monthKey(today));
  const [sel, setSel] = useState<{ team: string; week: number } | null>(initialOpen);
  const header = <ScreenHeader title="Schedule volume" subtitle="Games per fantasy week, all 30 NBA teams" />;

  let body;
  if (error && !data) body = <ErrorState message={error} onRetry={onRetry} what="the schedule" />;
  else if (!data) body = <LoadingState blocks={[60, 600]} label={loading ? 'Loading the schedule' : 'Loading'} />;
  else {
    const current = windows.find((w) => w.key === win) ?? windows[0];
    const weeks: ScheduleWeek[] = current?.weeks ?? [];
    const medians = new Map(weeks.map((w) => [w.week, median(data.teams.map((t) => t.games_by_week[String(w.week)] ?? 0))]));
    const teams = sortTeamsByGames(data.teams, weeks);
    const side = (team: string) => (opponentTeams.includes(team) && !myTeams.includes(team) ? -1 : 1);
    const selTeam = sel ? data.teams.find((t) => t.team === sel.team) : null;
    const selWeek = sel ? weeks.find((w) => w.week === sel.week) : null;
    body = (
      <Stack spacing={1.5}>
        {data.unscheduled_note && <Alert severity="info">{data.unscheduled_note}</Alert>}
        <Box role="group" aria-label="Window" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {windows.map((w) => (
            <Chip
              key={w.key}
              label={w.label}
              onClick={() => {
                setWin(w.key);
                setSel(null);
              }}
              aria-pressed={w.key === current?.key}
              color={w.key === current?.key ? 'primary' : 'default'}
              variant={w.key === current?.key ? 'filled' : 'outlined'}
              sx={{ height: 40, borderRadius: 20 }}
            />
          ))}
        </Box>
        {weeks.length === 0 ? (
          <EmptyState title="No fantasy weeks in this window" />
        ) : (
          <Card sx={{ p: 1.25 }}>
            <Box role="grid" aria-label="Games per week by team" sx={{ display: 'grid', gridTemplateColumns: `52px repeat(${weeks.length}, minmax(0, 1fr)) 40px`, gap: '3px' }}>
              <Typography variant="caption" role="columnheader" sx={{ fontWeight: 700, color: 'text.secondary', alignSelf: 'end' }}>
                Team
              </Typography>
              {weeks.map((w) => (
                <Box key={w.week} role="columnheader" sx={{ textAlign: 'center', borderRadius: 1, py: 0.25, bgcolor: w.is_playoff ? 'action.selected' : 'transparent' }}>
                  <Typography variant="caption" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    W{w.week}
                    {w.n_days > 7 ? '*' : ''}
                    {w.is_playoff ? ' PO' : ''}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ fontSize: 10, color: 'text.secondary', lineHeight: 1.2 }}>
                    {dateRange(w.start, w.end).replace(/^(\w+) /, '$1 ')}
                  </Typography>
                </Box>
              ))}
              <Typography variant="caption" role="columnheader" sx={{ fontWeight: 700, color: 'text.secondary', textAlign: 'right', alignSelf: 'end' }}>
                Sum
              </Typography>
              {teams.map(({ team, sum }) => {
                const t = data.teams.find((x) => x.team === team)!;
                const mine = myTeams.includes(team);
                const opp = opponentTeams.includes(team);
                return (
                  <Box key={team} role="row" sx={{ display: 'contents' }}>
                    <Typography role="rowheader" variant="body2" sx={{ alignSelf: 'center', fontWeight: mine || opp ? 700 : 400 }}>
                      {team}
                      <Box component="span" sx={{ fontSize: 10, fontWeight: 700, color: 'text.secondary', ml: 0.25 }}>
                        {mine ? 'you' : opp ? 'opp' : ''}
                      </Box>
                    </Typography>
                    {weeks.map((w) => {
                      const g = t.games_by_week[String(w.week)] ?? 0;
                      const diff = (g - (medians.get(w.week) ?? g)) * side(team);
                      const bg = forMeColor(diff, { min: -2, max: 2 }, mode);
                      const neutral = bg === fm.neutral;
                      const isSel = sel?.team === team && sel.week === w.week;
                      return (
                        <ButtonBase
                          key={w.week}
                          role="gridcell"
                          onClick={() => setSel({ team, week: w.week })}
                          aria-pressed={isSel}
                          aria-haspopup="dialog"
                          aria-label={`${team} week ${w.week}: ${g} games, ${forMeWord(diff)}`}
                          sx={[
                            { height: 36, borderRadius: 1, fontWeight: 700, fontSize: 13, bgcolor: neutral ? 'transparent' : bg, color: neutral ? 'text.primary' : inkOn(bg), border: `1px solid ${neutral ? viz.grid : bg}` },
                            w.is_playoff && { boxShadow: `inset 0 -3px 0 ${viz.axis}` },
                            isSel && { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 1 },
                          ]}
                        >
                          <span aria-hidden>{forMeSymbol(diff) === '●' ? '' : forMeSymbol(diff)}</span>
                        </ButtonBase>
                      );
                    })}
                    <Typography variant="body2" className="tabular" sx={{ alignSelf: 'center', textAlign: 'right', color: 'text.secondary' }}>
                      {sum}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
            <DetailSheet
              open={selTeam != null && selWeek != null}
              onClose={() => setSel(null)}
              content={
                selTeam && selWeek
                  ? (() => {
                      const g = selTeam.games_by_week[String(selWeek.week)] ?? 0;
                      const med = medians.get(selWeek.week) ?? 0;
                      const diff = (g - med) * side(selTeam.team);
                      const b2b = selTeam.b2b_by_week[String(selWeek.week)] ?? 0;
                      const light = selTeam.light_day_games_by_week[String(selWeek.week)] ?? 0;
                      const who = myTeams.includes(selTeam.team) ? 'your player’s team' : opponentTeams.includes(selTeam.team) ? 'your opponent’s player’s team' : 'a streaming target';
                      return {
                        title: `${selTeam.team} · Week ${selWeek.week}`,
                        subtitle: `${dateRange(selWeek.start, selWeek.end)}${selWeek.n_days > 7 ? ' · 14 days' : ''}${selWeek.is_playoff ? ' · playoff week' : ''}`,
                        effect: `${forMeSymbol(diff)} ${forMeWord(diff).replace(/^./, (c) => c.toUpperCase())} (${who})`,
                        sections: [
                          { heading: 'Games', lines: [`${g} games; league median that week ${med}.`, `${b2b} back-to-back${b2b === 1 ? '' : 's'}; ${light} game${light === 1 ? '' : 's'} on light days.`] },
                          { heading: 'Season', lines: [`${selTeam.total} games scheduled; ${selTeam.playoff_games} in the fantasy playoffs (weeks 20–22).`] },
                        ],
                      };
                    })()
                  : null
              }
            />
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
              Green ▲ = more games than that week’s league median (helps you), red ▼ = fewer, blank = about the median; flipped for “opp” teams. Tap a cell for
              the count, back-to-backs and light-day games. * = 14-day week (weeks 1 and 17). PO = playoff week. Sorted by games in this window (Sum).
            </Typography>
          </Card>
        )}
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Source: {data.source}
        </Typography>
      </Stack>
    );
  }
  return (
    <SeasonShell tab="research" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
