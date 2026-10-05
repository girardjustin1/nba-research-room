import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { CategoryKey, GameCenterMoment, GameCenterResponse, PlayerRef, WinProbabilityResponse } from '../../api/season';
import type { PlanState } from '../../api/useScenarioPlan';
import { forMeSymbol, forMeWord } from '../../theme/viz';
import { DetailSheet } from '../foundations/DetailSheet';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { dateRange, ptsDelta } from '../foundations/seasonFormat';
import { InjuryReport, LatestEvent, Linescore, MomentsFeed, PickupsCard, Scoreboard, StrengthComparison, VolumeMap } from './GameCenterSections';
import { MILESTONE_GLYPH, momentSheet } from './milestones';
import { WinProbabilityChart } from './WinProbabilityChart';

export interface GameCenterProps {
  gc: GameCenterResponse | null;
  /** History + scenarios (GET /season/week/probability); undefined = endpoint not available. */
  probability?: WinProbabilityResponse | null;
  /** Selected plan (POST /season/scenario answer); defaults to the recommended plan. */
  plan?: PlanState;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenPlayer?: (p: PlayerRef) => void;
  onTabChange?: (tab: SeasonTab) => void;
  initialChart?: 'probability' | 'moves';
  initialMetric?: CategoryKey | 'week';
  /** The engine answered 409 for the win probability: its next step, shown instead of the chart. */
  probabilityNotReady?: string | null;
}

/**
 * Game Center: the matchup as a live game page. My team left, the opponent right.
 * Scoreboard (category score, week progress, games left), what changed since yesterday,
 * the win-probability chart ([Win probability] actual + do nothing, [With moves] the plan
 * vs do nothing, per category), the latest event, the category linescore, key moments,
 * team comparison, week volume, both injury reports and pickups. Every number is the engine's.
 */
export function GameCenter({ gc, probability, plan, loading, error, onRetry, onOpenPlayer, onTabChange, initialChart = 'probability', initialMetric = 'week', probabilityNotReady = null }: GameCenterProps) {
  const [chart, setChart] = useState<'probability' | 'moves'>(initialChart);
  const [metric, setMetric] = useState<CategoryKey | 'week'>(initialMetric);
  const [moment, setMoment] = useState<GameCenterMoment | null>(null);

  const header = (
    <ScreenHeader
      title="Game Center"
      subtitle={gc ? `${gc.week.label} · ${dateRange(gc.week.start, gc.week.end)}${gc.week.is_playoffs ? ' · Playoffs' : ''}` : undefined}
      asOf={gc?.as_of}
      stale={gc?.stale}
    />
  );

  let body;
  if (error && !gc) body = <ErrorState message={error} onRetry={onRetry} what="the game center" />;
  else if (!gc) body = <LoadingState blocks={[200, 60, 300, 120, 220]} label={loading ? 'Loading the game center' : 'Loading'} />;
  else {
    const cats = gc.week.categories;
    const rec = probability?.scenarios.find((s) => s.kind === 'recommended') ?? null;
    const scenario = plan ? plan.scenario : rec;
    const milestones = gc.moments.map((m) => ({ id: m.id, ts: m.ts, kind: m.kind, label: m.headline, delta_p_win: m.delta_p_win }));
    const empty = gc.moments.length === 0 && (probability?.history.length ?? 0) === 0;
    body = (
      <Stack spacing={1.5}>
        {gc.stale && <StaleBanner reason={gc.stale_reason} asOf={gc.as_of} />}
        {error && <Alert severity="error">Refresh failed: {error}. Showing the last good data.</Alert>}
        <Scoreboard gc={gc} />
        {gc.since_yesterday && (
          <Typography variant="body2" className="tabular" sx={{ px: 0.5 }}>
            <strong>
              {forMeSymbol(gc.since_yesterday.delta_p, 0.002)} {ptsDelta(gc.since_yesterday.delta_p)}
            </strong>{' '}
            {gc.since_yesterday.label}
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {' '}
              ({forMeWord(gc.since_yesterday.delta_p, 0.002)})
            </Box>
          </Typography>
        )}

        <Card sx={{ p: 1.5 }}>
          <ToggleButtonGroup size="small" exclusive fullWidth value={chart} onChange={(_, v: 'probability' | 'moves' | null) => v && setChart(v)} aria-label="Chart" sx={{ mb: 1 }}>
            <ToggleButton value="probability">Win probability</ToggleButton>
            <ToggleButton value="moves">With moves</ToggleButton>
          </ToggleButtonGroup>
          {chart === 'moves' && (
            <Box sx={{ mb: 1 }}>
              <TextField
                select
                size="small"
                label="Show"
                value={metric}
                onChange={(e) => setMetric(e.target.value as CategoryKey | 'week')}
                fullWidth
              >
                <MenuItem value="week">Week</MenuItem>
                {cats.map((c) => (
                  <MenuItem key={c.key} value={c.key}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}
          {probabilityNotReady ? (
            <EmptyState title="Win probability isn't ready yet">{probabilityNotReady}</EmptyState>
          ) : probability === undefined ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Win probability arrives with GET /season/week/probability (Phase 2).
            </Typography>
          ) : probability === null ? (
            <LoadingState blocks={[240]} label="Loading win probability" />
          ) : (
            <WinProbabilityChart
              key={`${chart}-${metric}`}
              data={probability}
              withMoves={scenario}
              recomputing={plan?.recomputing}
              showPlan={chart === 'moves'}
              metric={chart === 'moves' ? metric : 'week'}
              milestones={milestones}
              onMilestone={(id) => setMoment(gc.moments.find((m) => m.id === id) ?? null)}
              hideTitle
            />
          )}
          {milestones.length > 0 && (
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
              Markers:{' '}
              {[...new Set(milestones.map((m) => m.kind))].map((k) => `${MILESTONE_GLYPH[k].glyph} ${MILESTONE_GLYPH[k].label.toLowerCase()}`).join(' · ')}. Green = helped you, red = hurt you. Tap a marker.
            </Typography>
          )}
        </Card>

        {empty ? (
          <EmptyState title="The week has not started">Moments, the linescore and the comparison fill in after Monday’s first games.</EmptyState>
        ) : (
          <LatestEvent gc={gc} onOpen={setMoment} />
        )}
        <Linescore gc={gc} />
        <MomentsFeed gc={gc} onOpen={setMoment} />
        <StrengthComparison gc={gc} />
        <VolumeMap gc={gc} onOpenPlayer={onOpenPlayer} />
        <InjuryReport gc={gc} onOpenPlayer={onOpenPlayer} />
        <PickupsCard gc={gc} onOpenPlayer={onOpenPlayer} />
        <DetailSheet open={moment != null} onClose={() => setMoment(null)} content={moment ? momentSheet(moment, gc) : null} />
      </Stack>
    );
  }

  return (
    <SeasonShell tab="matchup" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
