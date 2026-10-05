import { useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import NewReleasesOutlinedIcon from '@mui/icons-material/NewReleasesOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import type { BreakingAlert, MovesResponse, WeekResponse, WinProbabilityResponse } from '../../api/season';
import type { PlanState } from '../../api/useScenarioPlan';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { TIER_LABEL, catDeltaLine, dateRange, etClock, moveTitle, ptsDelta } from '../foundations/seasonFormat';
import { DayStrip } from './DayStrip';
import { DecisionsCard, ProgressCard, UpdatesCard } from './MatchupSections';
import { MatchupOddsChart } from './MatchupOddsChart';
import { WinProbabilityChart } from './WinProbabilityChart';

export interface ThisWeekProps {
  week: WeekResponse | null;
  moves: MovesResponse | null;
  /** undefined = endpoint not available yet; null = loading. */
  probability?: WinProbabilityResponse | null;
  /** The selected plan and the engine's answer; defaults to the recommended plan. */
  plan?: PlanState;
  onToggleMove?: (moveId: string) => void;
  onRetryPlan?: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenMove?: (moveId: string) => void;
  onSeeAllMoves?: () => void;
  onTabChange?: (tab: SeasonTab) => void;
  initialChartView?: 'chart' | 'compare';
}

const PLAYOFF_LABEL = { quarterfinal: 'Playoffs · quarterfinal', semifinal: 'Playoffs · semifinal', final: 'Playoffs · final' } as const;

function BreakingCard({ alert, categories, onOpenMove }: { alert: BreakingAlert; categories: WeekResponse['week']['categories']; onOpenMove?: (id: string) => void }) {
  return (
    <Alert severity="warning" icon={<NewReleasesOutlinedIcon />} role="alert" sx={{ '& .MuiAlert-message': { minWidth: 0, width: '100%' } }}>
      <AlertTitle sx={{ mb: 0.25 }}>Breaking · {etClock(alert.at)}</AlertTitle>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {alert.headline}
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
        {alert.source.display_name}
        {alert.source.tier ? ` · ${TIER_LABEL[alert.source.tier]}` : ''}
      </Typography>
      <Typography variant="body2" className="tabular" sx={{ mt: 0.75 }}>
        Your week: <strong>{ptsDelta(alert.impact.delta_p_win)}</strong> · {catDeltaLine(alert.impact.cat_deltas, categories)}
      </Typography>
      {alert.impact.suggestion && (
        <Typography variant="body2" sx={{ mt: 0.25 }}>
          Suggested: {alert.impact.suggestion}
        </Typography>
      )}
      {alert.impact.move_id && onOpenMove && (
        <Button variant="contained" color="warning" fullWidth sx={{ mt: 1 }} onClick={() => onOpenMove(alert.impact.move_id!)}>
          See the move
        </Button>
      )}
    </Alert>
  );
}

/**
 * Matchup (This Week): tracks the week. Win probability so far and projected (do nothing
 * vs the selected moves), then Progress (live score, categories, games, acquisitions),
 * Decisions (toggle moves; the engine redraws the plan line), Updates & news, and the
 * category odds and games-by-day details. Every number is the engine's.
 */
export function ThisWeek(props: ThisWeekProps) {
  const { week, moves, probability, loading, error, onRetry, onOpenMove, onSeeAllMoves, onTabChange, onToggleMove, onRetryPlan, initialChartView } = props;
  const [openTs, setOpenTs] = useState<string | null>(null);
  const ctx = week?.week;
  const title = ctx ? `${ctx.label} · ${dateRange(ctx.start, ctx.end)}` : 'This week';
  const subtitle = week
    ? `${ctx?.is_playoffs && ctx.playoff_round ? `${PLAYOFF_LABEL[ctx.playoff_round]} · ` : ''}${week.me.name} vs ${week.opponent.name}${week.opponent.record ? ` (${week.opponent.record})` : ''}`
    : undefined;
  const header = <ScreenHeader title={title} subtitle={subtitle} asOf={week?.as_of} stale={week?.stale} />;

  let body;
  if (error && !week) body = <ErrorState message={error} onRetry={onRetry} what="this week" />;
  else if (!week) body = <LoadingState blocks={[300, 200, 300, 200]} label={loading ? 'Loading this week' : 'Loading'} />;
  else {
    const c = week.week;
    const rec = probability?.scenarios.find((s) => s.kind === 'recommended') ?? null;
    const plan: PlanState = props.plan ?? {
      selected: probability?.recommended_move_ids ?? moves?.moves.map((m) => m.move_id) ?? [],
      scenario: rec,
      recomputing: false,
      error: null,
      infeasible: null,
      incompatible: {},
    };
    const titles = Object.fromEntries((moves?.moves ?? []).map((m) => [m.move_id, moveTitle(m)]));
    const now = probability?.history[probability.history.length - 1] ?? null;
    body = (
      <Stack spacing={1.5}>
        {week.stale && <StaleBanner reason={week.stale_reason} asOf={week.as_of} />}
        {error && (
          <Alert severity="error" icon={<ReportProblemOutlinedIcon />}>
            Refresh failed: {error}. Showing the last good data.
          </Alert>
        )}
        {week.alerts.map((a) => (
          <BreakingCard key={a.id} alert={a} categories={c.categories} onOpenMove={onOpenMove} />
        ))}
        {c.is_last_day && <Alert severity="info">Last day of the week. Only today’s games are left.</Alert>}
        {c.is_playoffs && <Alert severity="info">Playoff week: one loss ends the season. The optimizer adds a secondary term for game volume.</Alert>}
        {c.punts.length > 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Punting {c.punts.map((k) => c.categories.find((x) => x.key === k)?.label ?? k).join(', ')}: you need {c.cats_to_win} of the other{' '}
            {c.categories.length - c.punts.length}.
          </Typography>
        )}

        <Card sx={{ p: 1.5 }}>
          {probability === undefined ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Win probability over the week arrives with GET /season/week/probability (Phase 2).
            </Typography>
          ) : probability === null ? (
            <LoadingState blocks={[240]} label="Loading win probability" />
          ) : (
            <WinProbabilityChart
              data={probability}
              withMoves={plan.scenario}
              recomputing={plan.recomputing}
              moveTitles={titles}
              categories={c.categories}
              openTs={openTs}
              onOpenTs={setOpenTs}
              initialView={initialChartView}
            />
          )}
        </Card>

        <ProgressCard week={week} now={now} />

        {moves == null ? (
          <LoadingState blocks={[200]} label="Loading moves" />
        ) : (
          <DecisionsCard
            moves={moves.moves}
            plan={plan}
            today={c.today}
            categories={c.categories}
            onToggle={onToggleMove}
            onRetry={onRetryPlan}
            onOpenMove={onOpenMove}
            onSeeAllMoves={onSeeAllMoves}
          />
        )}

        {probability && <UpdatesCard history={probability.history} onOpen={setOpenTs} />}

        <Card sx={{ p: 1.5 }}>
          <MatchupOddsChart lines={week.categories} categories={c.categories} opponentName={week.opponent.name} />
        </Card>
        <Card sx={{ p: 1.5 }}>
          <DayStrip games={week.games} opponentName={week.opponent.name} />
        </Card>
      </Stack>
    );
  }

  return (
    <SeasonShell tab="matchup" onTabChange={onTabChange} header={header}>
      {body}
    </SeasonShell>
  );
}
