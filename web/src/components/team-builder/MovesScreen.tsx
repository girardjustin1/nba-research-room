import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Move, MovesResponse, PlayerRef, SeasonCategory, IsoDate } from '../../api/season';
import { pct } from '../../lib/format';
import { AcquisitionsMeter } from '../foundations/AcquisitionsMeter';
import { ProvenanceLine } from '../foundations/Confidence';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { SignedBarChart } from '../foundations/SignedBarChart';
import { MOVE_KIND_LABEL, pctRange, ptsDelta } from '../foundations/seasonFormat';
import { BuilderTabs, type BuilderView } from './BuilderTabs';
import { MoveCard } from './MoveCard';

export interface MovesScreenProps {
  moves: MovesResponse | null;
  today: IsoDate;
  categories: SeasonCategory[];
  opponentName?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenPlayer?: (player: PlayerRef) => void;
  onCompare?: (move: Move) => void;
  onTabChange?: (tab: SeasonTab) => void;
  onBuilderView?: (v: BuilderView) => void;
}

function shortName(m: Move): string {
  const last = (n: string | undefined) => n?.split(' ').slice(-1)[0] ?? '';
  return `${m.rank}. ${last(m.player.name)}`;
}

/**
 * Moves planner: the do-nothing baseline vs all moves, each move's effect on P(win week)
 * (MUI X bars, green helps / red hurts), and the ranked cards with their reasons,
 * deadlines, confidence and the add/drop week strips against my open slots.
 */
export function MovesScreen(props: MovesScreenProps) {
  const { moves, today, categories, opponentName, loading, error, onRetry, onOpenPlayer, onCompare, onTabChange, onBuilderView } = props;
  const header = (
    <ScreenHeader
      title="Moves"
      subtitle={moves ? `${opponentName ? `vs ${opponentName} · ` : ''}${moves.acquisitions.max - moves.acquisitions.used} of ${moves.acquisitions.max} acquisitions left` : undefined}
      asOf={moves?.as_of}
      stale={moves?.stale}
    />
  );
  let body;
  if (error && !moves) body = <ErrorState message={error} onRetry={onRetry} what="moves" />;
  else if (!moves) body = <LoadingState blocks={[160, 200, 320, 320]} label={loading ? 'Loading moves' : 'Loading'} />;
  else {
    // Display scale only: room for the tip labels beyond the longest bar.
    const max = Math.max(0.01, ...moves.moves.map((m) => Math.abs(m.delta_p_win.mean)));
    const domain = Math.ceil(max * 2.1 * 100) / 100;
    const step = domain > 0.06 ? 0.04 : 0.02;
    const ticks = [-step, 0, step, 2 * step].filter((t) => Math.abs(t) <= domain);
    // Display counter only: "uses acquisition 3 of 4" for each add in rank order.
    const acqIndex: number[] = [];
    moves.moves.reduce((n, m) => {
      acqIndex.push(n);
      return m.uses_acquisition ? n + 1 : n;
    }, moves.acquisitions.used);
    const infeasible = moves.optimizer.status === 'infeasible';
    const full = moves.acquisitions.used >= moves.acquisitions.max;
    body = (
      <Stack spacing={1.5}>
        {moves.stale && <StaleBanner reason={moves.stale_reason} asOf={moves.as_of} />}
        {infeasible && (
          <Alert severity="error">
            <AlertTitle>The optimizer found no legal plan</AlertTitle>
            {moves.optimizer.message}
          </Alert>
        )}
        <Card sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" component="h2">
            Do nothing vs the plan
          </Typography>
          <Typography variant="body2" className="tabular" sx={{ mt: 0.5 }}>
            Do nothing: <strong>{pct(moves.baseline.p_win_week.p)}</strong> ({pctRange(moves.baseline.p_win_week.lo, moves.baseline.p_win_week.hi)}) ·{' '}
            {moves.with_all ? (
              <>
                All moves: <strong>{pct(moves.with_all.p_win_week.p)}</strong> ({pctRange(moves.with_all.p_win_week.lo, moves.with_all.p_win_week.hi)}),{' '}
                <strong>{ptsDelta(moves.with_all.delta_vs_baseline)}</strong>
              </>
            ) : (
              'no plan beats it'
            )}
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Each move’s gain is measured alone. Together they interact, so they do not add up to the plan’s total.
          </Typography>
        </Card>
        <Card sx={{ p: 1.5 }}>
          <AcquisitionsMeter acquisitions={moves.acquisitions} />
        </Card>
        {moves.moves.length > 0 && (
          <Card sx={{ p: 1.5 }}>
            <SignedBarChart
              title="Effect on P(win week)"
              subtitle="Each move alone vs doing nothing"
              rows={moves.moves.map((m) => ({
                key: m.move_id,
                label: shortName(m),
                value: m.delta_p_win.mean,
                display: ptsDelta(m.delta_p_win.mean),
                readout: `${shortName(m)} (${MOVE_KIND_LABEL[m.kind]}): ${ptsDelta(m.delta_p_win.mean)} (80% band ${ptsDelta(m.delta_p_win.lo)} to ${ptsDelta(m.delta_p_win.hi)}), ${m.confidence.level} confidence`,
              }))}
              domain={domain}
              ticks={ticks}
              tickFormat={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`}
              labelWidth={92}
              table={{
                headers: ['Move', 'Gain', '80% band'],
                cells: (r, i) => {
                  const m = moves.moves[i]!;
                  return [r.label, ptsDelta(m.delta_p_win.mean), `${ptsDelta(m.delta_p_win.lo)} to ${ptsDelta(m.delta_p_win.hi)}`];
                },
              }}
            />
          </Card>
        )}
        {moves.moves.length === 0 && !infeasible && (
          <EmptyState title="Do nothing">
            No move raises P(win week) above {pct(moves.baseline.p_win_week.p)}. The optimizer checked every legal lineup and add/drop with{' '}
            {moves.acquisitions.max - moves.acquisitions.used} acquisitions left.
          </EmptyState>
        )}
        {full && moves.moves.length > 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            All acquisitions are used, so only start/bench moves are listed.
          </Typography>
        )}
        <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0 }}>
          {moves.moves.map((m, i) => (
            <MoveCard
              key={m.move_id}
              move={m}
              today={today}
              categories={categories}
              acquisitions={moves.acquisitions}
              acquisitionIndex={acqIndex[i]}
              onOpenPlayer={onOpenPlayer}
              onCompare={onCompare}
            />
          ))}
        </Stack>
        <ProvenanceLine provenance={moves.provenance} />
      </Stack>
    );
  }
  return (
    <SeasonShell tab="builder" onTabChange={onTabChange} header={header}>
      <BuilderTabs value="moves" onChange={onBuilderView} />
      {body}
    </SeasonShell>
  );
}
