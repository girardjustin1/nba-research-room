import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { LeagueTeamProfile, PlayerRef, SeasonCategory } from '../../api/season';
import { ordinal, pct } from '../../lib/format';
import { ProvenanceLine } from '../foundations/Confidence';
import { PlayerLine, StatusChip } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { SignedBarChart } from '../foundations/SignedBarChart';
import { catLabel, pctRange, signedNum } from '../foundations/seasonFormat';

export interface LeagueTeamProfileViewProps {
  team: LeagueTeamProfile | null;
  categories: SeasonCategory[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
}

/**
 * A fantasy team in my league: record and rank, category strengths and weaknesses vs the
 * league (colored for ME: an opponent's strength is red), head-to-head with me, the engine's
 * notes, and the roster.
 */
export function LeagueTeamProfileView({ team: t, categories, loading, error, onRetry, onBack, onOpenPlayer, onTabChange }: LeagueTeamProfileViewProps) {
  const header = <ScreenHeader title={t?.team.name ?? 'Team'} subtitle={t ? `${t.team.record ?? '—'} · ${ordinal(t.rank)} in the league${t.is_me ? ' · you' : ''}` : undefined} asOf={t?.as_of} stale={t?.stale} onBack={onBack} />;
  let body;
  if (error && !t) body = <ErrorState message={error} onRetry={onRetry} what="this team" />;
  else if (!t) body = <LoadingState blocks={[100, 320, 160, 400]} label={loading ? 'Loading the team' : 'Loading'} />;
  else {
    const h = t.head_to_head;
    body = (
      <Stack spacing={1.5}>
        {t.stale && <StaleBanner reason={t.stale_reason} asOf={t.as_of} />}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            {t.is_me ? 'Your team' : `Manager: ${t.team.manager ?? '—'}`}
          </Typography>
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {t.notes.map((n) => (
              <Typography component="li" variant="body2" key={n}>
                {n}
              </Typography>
            ))}
          </Box>
          {t.week_games_left != null && (
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {t.week_games_left} games left this week
            </Typography>
          )}
        </Card>
        <Card sx={{ p: 1.5 }}>
          <SignedBarChart
            title="Category strength vs the league"
            subtitle={t.is_me ? 'z of per-game totals · green = your strength' : 'z of per-game totals · their strength is red for you'}
            rows={t.strengths.map((s) => ({
              key: s.key,
              label: catLabel(s.key, categories),
              value: s.z,
              display: `${signedNum(s.z)} · ${ordinal(s.rank)}`,
              readout: `${catLabel(s.key, categories)}: z ${signedNum(s.z)}, ${ordinal(s.rank)} of 14${t.is_me ? '' : ' (their number)'}`,
            }))}
            domain={2.6}
            ticks={[-2, -1, 0, 1, 2]}
            tickFormat={(v) => `${v > 0 ? '+' : ''}${v}`}
            evenBand={0.15}
            invert={!t.is_me}
            table={{
              headers: ['Cat', 'z', 'Rank'],
              cells: (_r, i) => {
                const s = t.strengths[i]!;
                return [catLabel(s.key, categories), signedNum(s.z), ordinal(s.rank)];
              },
            }}
          />
        </Card>
        {!t.is_me && (
          <Card sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" component="h2">
              Head to head
            </Typography>
            {h.played.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                No meetings yet this season.
              </Typography>
            ) : (
              h.played.map((g) => (
                <Typography key={g.week} variant="body2" sx={{ mt: 0.25 }}>
                  Week {g.week}: {g.outcome === 'win' ? '▲ you won' : g.outcome === 'loss' ? '▼ you lost' : '● tied'} {g.cats_won}–{g.cats_lost}
                </Typography>
              ))
            )}
            {h.next && (
              <Typography variant="body2" className="tabular" sx={{ mt: 0.5 }}>
                Next: week {h.next.week}
                {h.next.p_win_week ? ` · your P(win week) ${pct(h.next.p_win_week.p)} (${pctRange(h.next.p_win_week.lo, h.next.p_win_week.hi)})` : ' · not projected yet'}
              </Typography>
            )}
          </Card>
        )}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            Roster · {t.roster.length}
          </Typography>
          {t.roster.map((p) => (
            <PlayerLine key={p.player_id} player={p} onOpen={onOpenPlayer} trailing={<StatusChip player={p} />} />
          ))}
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
