import { useCallback } from 'react';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { gcMidweekClose } from '../../../mocks/matchup-analysis/gamecenter';
import { probNormal } from '../../../mocks/matchup-analysis/probability';
import { GameCenter } from '../../screens';
import { PrototypeDataChip } from '../PrototypeDataChip';

/**
 * Matchup: season-ui's Game Center (GET /season/week/gamecenter) with the win-probability
 * history and scenarios (GET /season/week/probability). It shows the engine's recommended
 * plan; the browser never computes a probability. Endpoints that 404 fall back to the same
 * sample data as the Game Center story, marked "Prototype data".
 */
export function LeagueMatchupScreen({ mode, apis, navigate }: RouteScreenProps) {
  const gc = useLiveOrMock(useCallback(() => apis.season.gameCenter(), [apis]), gcMidweekClose, mode);
  const prob = useLiveOrMock(useCallback(() => apis.season.weekProbability(), [apis]), probNormal, mode);
  return (
    <>
      <GameCenter
        gc={gc.data}
        probability={prob.loading ? null : prob.data}
        probabilityNotReady={prob.notReady}
        loading={gc.loading}
        error={firstError([gc])}
        onRetry={() => {
          gc.refresh();
          prob.refresh();
        }}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip
        endpoints={mockEndpoints([
          [gc, 'GET /season/week/gamecenter'],
          [prob, 'GET /season/week/probability'],
        ])}
        bottomOffset={LEAGUE_NAV_HEIGHT}
      />
    </>
  );
}
