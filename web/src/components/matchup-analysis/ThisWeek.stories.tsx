import { useCallback, useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Acquisitions, MovesResponse, ScenarioResponse, WinProbabilityResponse } from '../../api/season';
import { useScenarioPlan } from '../../api/useScenarioPlan';
import {
  mockScenarioEngine,
  probCollapse,
  probCompare,
  probDeficit,
  probFinal,
  probLastDay,
  probLead,
  probMonday,
  probNormal,
} from '../../mocks/matchup-analysis/probability';
import { ACQ_NORMAL, weekInjury, weekLastDay, weekNoAcquisitions, weekNormal, weekPlayoff, weekPunt, weekStale } from '../../mocks/matchup-analysis/week';
import { movesInjury, movesLastDay, movesNoAcquisitions, movesNone, movesNormal, movesPlayoff, movesPunt, movesStale } from '../../mocks/team-builder/moves';
import { ThisWeek, type ThisWeekProps } from './ThisWeek';

interface InteractiveProps extends ThisWeekProps {
  prob: WinProbabilityResponse;
  delayMs?: number;
  fail?: boolean;
  acq?: Acquisitions;
  initialSelected?: string[];
}

/**
 * Toggling a move calls a FIXTURE stand-in for POST /season/scenario after a short delay;
 * the real app sends the selection to the engine. Invented data.
 */
function Interactive({ prob, delayMs = 700, fail = false, acq = ACQ_NORMAL, initialSelected, ...rest }: InteractiveProps) {
  const moves = (rest.moves as MovesResponse).moves;
  const send = useCallback(
    (ids: string[]) =>
      new Promise<ScenarioResponse>((resolve, reject) =>
        setTimeout(() => (fail ? reject(new Error('Request failed (HTTP 500)')) : resolve(mockScenarioEngine(prob, moves, ids, acq))), delayMs),
      ),
    [prob, moves, acq, delayMs, fail],
  );
  const selected = initialSelected ?? prob.recommended_move_ids;
  const first = useMemo(() => mockScenarioEngine(prob, moves, selected, acq), [prob, moves, selected, acq]);
  const { state, toggle, retry } = useScenarioPlan(
    send,
    selected,
    first.scenario,
    Object.fromEntries(first.incompatible.map((x) => [x.move_id, x.reason])),
  );
  return <ThisWeek {...rest} probability={prob} plan={state} onToggleMove={toggle} onRetryPlan={retry} />;
}

const REC = probNormal.scenarios.find((s) => s.kind === 'recommended') ?? null;
const ONE_LEFT = { ...ACQ_NORMAL, used: 3 };

const meta = {
  title: 'Matchup Analysis/This Week',
  component: ThisWeek,
  args: { week: weekNormal, moves: movesNormal, probability: probNormal, onOpenMove: () => {}, onSeeAllMoves: () => {} },
} satisfies Meta<typeof ThisWeek>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Toggle moves on and off: the plan line is redrawn from the (mock) engine's answer. */
export const Normal: Story = { render: (args) => <Interactive {...args} prob={probNormal} /> };
/** Monday morning: no past yet, the whole week is projected. */
export const MondayMorning: Story = { render: (args) => <Interactive {...args} prob={probMonday} /> };
export const MidweekLead: Story = { render: (args) => <Interactive {...args} prob={probLead} /> };
/** Down at 44%: the recommended plan flips it above 50%. */
export const MidweekDeficitPlanFlips: Story = { render: (args) => <Interactive {...args} prob={probDeficit} /> };
/** Every move off: the plan line matches doing nothing. Toggle any back on. */
export const PlanTurnedOff: Story = { render: (args) => <Interactive {...args} prob={probNormal} initialSelected={[]} /> };
export const ComparePlans: Story = { args: { probability: probCompare, initialChartView: 'compare' } };
export const RecomputeLoading: Story = {
  args: { plan: { selected: ['m-add-bramwell', 'm-start-pellham'], scenario: REC, recomputing: true, error: null, infeasible: null, incompatible: {} } },
};
/** Every toggle fails: the last good line stays, with Retry. */
export const EngineError: Story = { render: (args) => <Interactive {...args} prob={probNormal} fail /> };
export const EngineErrorShown: Story = {
  args: { plan: { selected: probNormal.recommended_move_ids, scenario: REC, recomputing: false, error: 'Request failed (HTTP 500)', infeasible: null, incompatible: {} } },
};
/** One acquisition left: the engine marks the second add as not allowed. */
export const IncompatibleMoves: Story = {
  render: (args) => (
    <Interactive {...args} week={{ ...weekNormal, acquisitions: ONE_LEFT }} prob={probNormal} acq={ONE_LEFT} initialSelected={['m-add-bramwell', 'm-start-pellham', 'm-bench-rosswell']} />
  ),
};
export const InfeasibleSelection: Story = {
  args: {
    plan: { selected: probNormal.recommended_move_ids, scenario: REC, recomputing: false, error: null, infeasible: 'Uses 5 of 4 acquisitions', incompatible: {} },
  },
};
export const LastDayOfWeek: Story = { render: (args) => <Interactive {...args} week={weekLastDay} moves={movesLastDay} prob={probLastDay} /> };
export const FinalResult: Story = { args: { week: weekLastDay, moves: movesNone, probability: probFinal } };
export const InjuryBreakingNews: Story = { render: (args) => <Interactive {...args} week={weekInjury} moves={movesInjury} prob={probCollapse} /> };
export const Loading: Story = { args: { week: null, moves: null, probability: null, loading: true } };
export const ApiError: Story = { args: { week: null, moves: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
export const RefreshFailed: Story = { args: { error: 'The season API is not reachable' } };
export const StaleData: Story = { args: { week: weekStale, moves: movesStale } };
export const PlayoffWeek: Story = { args: { week: weekPlayoff, moves: movesPlayoff, probability: undefined } };
export const PuntBuild: Story = { args: { week: weekPunt, moves: movesPunt } };
export const NoAcquisitionsLeft: Story = { args: { week: weekNoAcquisitions, moves: movesNoAcquisitions, probability: undefined } };
/** Phase 1 server: the probability endpoint does not exist yet. */
export const NoProbabilityEndpoint: Story = { args: { probability: undefined } };
