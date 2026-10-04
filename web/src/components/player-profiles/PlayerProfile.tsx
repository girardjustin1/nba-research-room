import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { DayPlan, PlayerAnalysisResponse, PlayerCalendarResponse, TeamDaysResponse, TeamWeeksResponse } from '../../api/season';
import { pct } from '../../lib/format';
import { FOR_ME, useResolvedMode, useVizColors } from '../../theme/viz';
import { PlayerAvatar, TeamBadge } from '../foundations/avatars/PlayerAvatar';
import { ConfidenceChip, MissingInputs, ProvenanceLine } from '../foundations/Confidence';
import { inkOn } from '../foundations/heatScale';
import { StatusChip } from '../foundations/PlayerLine';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { positionsLabel, ptsDelta } from '../foundations/seasonFormat';
import { FactorCard } from './FactorCard';
import { MonthAhead } from './MonthAhead';
import { PlayerHeatCalendar } from './PlayerHeatCalendar';

export interface PlayerProfileProps {
  analysis: PlayerAnalysisResponse | null;
  calendar?: PlayerCalendarResponse | null;
  teamDays?: TeamDaysResponse | null;
  teamWeeks?: TeamWeeksResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
  onCompare?: () => void;
  onTabChange?: (tab: SeasonTab) => void;
}

const ACTION = { start: 'START', bench: 'BENCH', add: 'ADD', drop: 'DROP', hold: 'HOLD', stream: 'STREAM' } as const;
const OWNER = { mine: 'On your roster', opponent: 'Your opponent’s player', free_agent: 'Free agent', waivers: 'On waivers', other_team: 'On another team' } as const;

function PlanStrip({ plan }: { plan: DayPlan[] }) {
  const mode = useResolvedMode();
  const viz = useVizColors();
  const fm = FOR_ME[mode];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '3px', mt: 1 }} role="list" aria-label="Plan by day">
      {plan.map((d) => {
        const start = d.action === 'start';
        const bg = start ? fm.goodRamp[1] : null;
        const label = start ? (d.slot ?? 'Start') : d.action === 'bench' ? 'BN' : d.action === 'out' ? 'OUT' : d.action === 'past' ? '' : '–';
        return (
          <Box
            key={d.date}
            role="listitem"
            aria-label={`${d.weekday}: ${d.action.replace('_', ' ')}${d.slot ? ` at ${d.slot}` : ''}`}
            sx={[
              { textAlign: 'center', borderRadius: 1, py: 0.5, border: `1px solid ${viz.grid}`, color: 'text.secondary' },
              bg != null && { bgcolor: bg, color: inkOn(bg), borderColor: bg },
              d.action === 'past' && { opacity: 0.45 },
              d.action === 'bench' && { borderStyle: 'dashed', borderColor: viz.axis },
            ]}
          >
            <Typography component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'inherit' }}>
              {d.weekday}
            </Typography>
            <Typography component="span" sx={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'inherit', minHeight: 18 }}>
              {start ? `▲ ${label}` : label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Player profile (deep dive): who he is (team, positions, status, play probability, minutes
 * cap), the engine's recommendation for him this week and WHY as a stack of factor cards,
 * his game calendar, his team's month ahead, and what data is missing.
 */
export function PlayerProfile({ analysis: a, calendar, teamDays, teamWeeks, loading, error, onRetry, onBack, onCompare, onTabChange }: PlayerProfileProps) {
  const header = <ScreenHeader title={a?.player.name ?? 'Player'} subtitle={a ? `${a.week.label} · ${OWNER[a.player.owner]}` : undefined} asOf={a?.as_of} stale={a?.stale} onBack={onBack} />;
  let body;
  if (error && !a) body = <ErrorState message={error} onRetry={onRetry} what="this player" />;
  else if (!a) body = <LoadingState blocks={[120, 220, 300, 300]} label={loading ? 'Loading the player' : 'Loading'} />;
  else {
    const p = a.player;
    const r = a.recommendation;
    const cats = a.week.categories;
    const jump = (section: string) => document.getElementById(`factor-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    body = (
      <Stack spacing={1.5}>
        {a.stale && <StaleBanner reason={a.stale_reason} asOf={a.as_of} />}
        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center' }}>
          <PlayerAvatar name={p.name} headshotUrl={p.headshot_url} size={64} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h2" noWrap>
              {p.name}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              <TeamBadge abbr={p.team_abbr} logoUrl={p.team_logo_url} /> · {positionsLabel(p.eligible)} · slots {p.eligible.join(', ')}
            </Typography>
            <Stack direction="row" sx={{ gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
              <StatusChip player={p} showHealthy />
              {p.status.code === 'healthy' && <Chip size="small" variant="outlined" label={`Plays ${p.status.play_prob == null ? 'unknown' : pct(p.status.play_prob)}`} />}
              {p.pct_rostered != null && <Chip size="small" variant="outlined" label={`${pct(p.pct_rostered)} rostered`} />}
            </Stack>
          </Box>
        </Stack>

        <Card sx={{ p: 1.5, borderColor: 'primary.main' }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <Chip size="small" color="primary" label={ACTION[r.action]} sx={{ fontWeight: 800, letterSpacing: '0.04em' }} />
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Recommendation this week
            </Typography>
          </Stack>
          <Typography variant="subtitle1" component="h2" sx={{ mt: 0.5, lineHeight: 1.3 }}>
            {r.headline}
          </Typography>
          {r.versus && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {r.versus}
            </Typography>
          )}
          {r.delta_p_win && (
            <Typography variant="body2" className="tabular" sx={{ mt: 0.5 }}>
              <strong>{ptsDelta(r.delta_p_win.mean)}</strong> P(win week) · 80% band {ptsDelta(r.delta_p_win.lo)} to {ptsDelta(r.delta_p_win.hi)}
            </Typography>
          )}
          <PlanStrip plan={r.plan} />
          <Stack direction="row" sx={{ gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <ConfidenceChip confidence={r.confidence} />
            {onCompare && (
              <Button variant="outlined" onClick={onCompare} sx={{ ml: 'auto' }}>
                Compare
              </Button>
            )}
          </Stack>
          <MissingInputs confidence={r.confidence} />
        </Card>

        <Typography variant="overline" component="h2" sx={{ color: 'text.secondary', pt: 0.5 }}>
          Why · {a.factors.length} factors
        </Typography>
        {a.factors.map((f) => (
          <FactorCard key={f.id} factor={f} categories={cats} today={a.week.today} />
        ))}

        {calendar && (
          <Card sx={{ p: 1.5 }}>
            <PlayerHeatCalendar calendar={calendar} currentWeek={a.week.week} perspective={p.owner === 'opponent' ? 'opponent' : 'mine'} onOpenSection={jump} />
          </Card>
        )}
        {teamDays && teamWeeks && (
          <Card sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" component="h2" sx={{ mb: 0.5 }}>
              Month ahead: {teamDays.team} schedule
            </Typography>
            <MonthAhead days={teamDays} weeks={teamWeeks} today={a.week.today} perspective={p.owner === 'opponent' ? 'opponent' : 'mine'} />
          </Card>
        )}

        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            Confidence
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            {a.confidence.summary}
          </Typography>
          <Box sx={{ mt: 0.75 }}>
            <ConfidenceChip confidence={a.confidence} />
          </Box>
          <MissingInputs confidence={a.confidence} />
          <ProvenanceLine provenance={a.provenance} />
        </Card>
      </Stack>
    );
  }
  return (
    <SeasonShell tab="research" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
