import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { PickupsScreen } from '../../screens';
import { waiversNormal } from '../../../mocks/team-builder/waivers';

/** Team → Pickups: GET /season/waivers. Invented data is marked "Prototype data". */
export function LeaguePickupsScreen({ mode, apis, navigate }: RouteScreenProps) {
  const waivers = useLiveOrMock(useCallback(() => apis.season.waivers(), [apis]), waiversNormal, mode);
  return (
    <>
      <PickupsScreen
        waivers={waivers.data}
        loading={waivers.loading}
        error={firstError([waivers])}
        onRetry={waivers.refresh}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onCompare={() => navigate('#/league/players/compare')}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
        onBuilderView={(v) => navigate(v === 'lineup' ? '#/league/team' : `#/league/team/${v}`)}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[waivers, 'GET /season/waivers']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
