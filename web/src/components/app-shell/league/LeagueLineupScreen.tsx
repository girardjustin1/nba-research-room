import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { LineupScreen } from '../../screens';
import { lineupNormal } from '../../../mocks/team-builder/lineup';

/** Team → Lineup: GET /season/lineup (live), falling back to the shared mock on 404. Invented data is marked "Prototype data". */
export function LeagueLineupScreen({ mode, apis, navigate }: RouteScreenProps) {
  const lineup = useLiveOrMock(useCallback(() => apis.season.lineup(), [apis]), lineupNormal, mode);
  return (
    <>
      <LineupScreen
        lineup={lineup.data}
        loading={lineup.loading}
        error={lineup.notReady ? null : lineup.error}
        notReady={lineup.notReady}
        onRetry={lineup.refresh}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
        onBuilderView={(v) => navigate(v === 'lineup' ? '#/league/team' : `#/league/team/${v}`)}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[lineup, 'GET /season/lineup']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
