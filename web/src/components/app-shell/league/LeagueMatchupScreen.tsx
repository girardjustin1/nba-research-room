import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '../../../api/client';
import type { Move, MovesResponse, ScenarioResponse, WinProbabilityResponse } from '../../../api/season';
import { useScenarioPlan } from '../../../api/useScenarioPlan';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { mockScenarioEngine, probNormal } from '../../../mocks/matchup-analysis/probability';
import { weekNormal } from '../../../mocks/matchup-analysis/week';
import { movesNormal } from '../../../mocks/team-builder/moves';
import { ThisWeek } from '../../screens';
import type { ThisWeekProps } from '../../matchup-analysis/ThisWeek';
import { PrototypeDataChip } from '../PrototypeDataChip';

/**
 * Matchup: This Week plus the win-probability chart (GET /season/week, /season/moves,
 * /season/week/probability). Toggling a move asks the engine (POST /season/scenario). When
 * the week is sample data, or that endpoint 404s, the sample engine answers instead and the
 * screen says "Prototype data". The browser never computes a probability itself.
 */
export function LeagueMatchupScreen({ mode, apis, navigate }: RouteScreenProps) {
  const week = useLiveOrMock(useCallback(() => apis.season.week(), [apis]), weekNormal, mode);
  const moves = useLiveOrMock(useCallback(() => apis.season.moves(), [apis]), movesNormal, mode);
  const prob = useLiveOrMock(useCallback(() => apis.season.weekProbability(), [apis]), probNormal, mode);
  const [scenarioMock, setScenarioMock] = useState(false);
  const common: Omit<ThisWeekProps, 'plan' | 'onToggleMove' | 'onRetryPlan' | 'probability'> = {
    week: week.data,
    moves: moves.data,
    loading: week.loading,
    error: firstError([week, moves]),
    onRetry: () => {
      week.refresh();
      moves.refresh();
      prob.refresh();
    },
    onOpenMove: () => navigate('#/league/team/moves'),
    onSeeAllMoves: () => navigate('#/league/team/moves'),
    onTabChange: (t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup'),
  };
  const ready = prob.data != null && moves.data != null;
  return (
    <>
      {ready ? (
        <Planned
          key={`${prob.isMock}-${moves.isMock}`}
          common={common}
          probability={prob.data as WinProbabilityResponse}
          moveList={(moves.data as MovesResponse).moves}
          sample={prob.isMock || moves.isMock}
          live={(ids) => apis.season.scenario({ move_ids: ids })}
          onScenarioMock={() => setScenarioMock(true)}
        />
      ) : (
        <ThisWeek {...common} probability={prob.loading ? null : undefined} />
      )}
      <PrototypeDataChip
        endpoints={[
          ...mockEndpoints([
            [week, 'GET /season/week'],
            [moves, 'GET /season/moves'],
            [prob, 'GET /season/week/probability'],
          ]),
          ...(scenarioMock || (ready && (prob.isMock || moves.isMock)) ? ['POST /season/scenario'] : []),
        ]}
        bottomOffset={LEAGUE_NAV_HEIGHT}
      />
    </>
  );
}

/** Mounted once the week's probability and moves are loaded, so the plan starts from the engine's recommendation. */
function Planned({
  common,
  probability,
  moveList,
  sample,
  live,
  onScenarioMock,
}: {
  common: Omit<ThisWeekProps, 'plan' | 'onToggleMove' | 'onRetryPlan' | 'probability'>;
  probability: WinProbabilityResponse;
  moveList: Move[];
  sample: boolean;
  live: (ids: string[]) => Promise<ScenarioResponse>;
  onScenarioMock: () => void;
}) {
  const send = useCallback(
    async (ids: string[]): Promise<ScenarioResponse> => {
      if (sample) return mockScenarioEngine(probability, moveList, ids);
      try {
        return await live(ids);
      } catch (err) {
        if (err instanceof ApiError && err.isNotFound) {
          onScenarioMock();
          return mockScenarioEngine(probability, moveList, ids);
        }
        throw err;
      }
    },
    [sample, live, probability, moveList, onScenarioMock],
  );
  const first = useMemo(() => (sample ? mockScenarioEngine(probability, moveList, probability.recommended_move_ids) : null), [sample, probability, moveList]);
  const { state, toggle, retry } = useScenarioPlan(
    send,
    probability.recommended_move_ids,
    first?.scenario ?? probability.scenarios.find((s) => s.kind === 'recommended') ?? null,
    first ? Object.fromEntries(first.incompatible.map((x) => [x.move_id, x.reason])) : {},
  );
  return <ThisWeek {...common} probability={probability} plan={state} onToggleMove={toggle} onRetryPlan={retry} />;
}
