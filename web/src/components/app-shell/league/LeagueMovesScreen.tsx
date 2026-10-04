import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints, todayET } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { MovesScreen } from '../../screens';
import { movesNormal } from '../../../mocks/team-builder/moves';
import { SEASON_CATEGORIES, TODAY } from '../../../mocks/foundations/seasonCommon';

/** Team → Moves: GET /season/moves. Invented data is marked "Prototype data". */
export function LeagueMovesScreen({ mode, apis, navigate }: RouteScreenProps) {
  const moves = useLiveOrMock(useCallback(() => apis.season.moves(), [apis]), movesNormal, mode);
  return (
    <>
      <MovesScreen
        moves={moves.data}
        today={moves.isMock ? TODAY : todayET()}
        categories={SEASON_CATEGORIES}
        loading={moves.loading}
        error={firstError([moves])}
        onRetry={moves.refresh}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onCompare={() => navigate('#/league/players/compare')}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
        onBuilderView={(v) => navigate(v === 'lineup' ? '#/league/team' : `#/league/team/${v}`)}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[moves, 'GET /season/moves']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
