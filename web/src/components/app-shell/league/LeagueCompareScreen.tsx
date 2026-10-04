import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { PlayerCompare } from '../../screens';
import { compareStartSit } from '../../../mocks/team-player-analysis/compare';
import { ApiError } from '../../../api/client';

/** Compare two players: GET /season/compare (?a=&b=); without ids or on 404 shows the sample pair. Invented data is marked "Prototype data". */
export function LeagueCompareScreen({ mode, apis, navigate, query }: RouteScreenProps) {
  const a = Number(query.get('a'));
  const b = Number(query.get('b'));
  const ok = a > 0 && b > 0;
  const cmp = useLiveOrMock(
    useCallback(() => (ok ? apis.season.compare(a, b, 'start_sit') : Promise.reject(new ApiError(404, 'No players selected'))), [apis, ok, a, b]),
    compareStartSit,
    mode,
  );
  return (
    <>
      <PlayerCompare
        compare={cmp.data}
        loading={cmp.loading}
        error={firstError([cmp])}
        onRetry={cmp.refresh}
        onBack={() => navigate('#/league/players')}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[cmp, 'GET /season/compare']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
