import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { PlayerProfile } from '../../screens';
import { playerBramwell } from '../../../mocks/player-profiles/player';
import { calendarBramwell } from '../../../mocks/player-profiles/calendar';
import { teamDaysNOP, teamWeeks } from '../../../mocks/team-profiles/schedule';
import { ApiError } from '../../../api/client';

/** A player's deep dive: GET /season/players/{id} (id from ?id=); no id or 404 shows the sample player. Invented data is marked "Prototype data". */
export function LeaguePlayerProfileScreen({ mode, apis, navigate, query }: RouteScreenProps) {
  const id = Number(query.get('id'));
  const hasId = Number.isFinite(id) && id > 0;
  const analysis = useLiveOrMock(
    useCallback(() => (hasId ? apis.season.player(id) : Promise.reject(new ApiError(404, 'No player selected'))), [apis, hasId, id]),
    playerBramwell,
    mode,
  );
  const weeks = useLiveOrMock(useCallback(() => apis.season.teamWeeks(), [apis]), teamWeeks, mode);
  return (
    <>
      <PlayerProfile
        analysis={analysis.data}
        calendar={analysis.isMock ? calendarBramwell : null}
        teamDays={analysis.isMock ? teamDaysNOP : null}
        teamWeeks={weeks.data}
        loading={analysis.loading}
        error={firstError([analysis])}
        onRetry={analysis.refresh}
        onBack={() => navigate('#/league/players')}
        onCompare={() => navigate('#/league/players/compare')}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip
        endpoints={mockEndpoints([
          [analysis, hasId ? `GET /season/players/${id}` : 'GET /season/players/{id} (sample player)'],
          [weeks, 'GET /schedule/team_weeks'],
        ])}
        bottomOffset={LEAGUE_NAV_HEIGHT}
      />
    </>
  );
}
