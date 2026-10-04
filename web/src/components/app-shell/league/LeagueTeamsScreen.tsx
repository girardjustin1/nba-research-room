import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { LeagueTeamProfileView } from '../../screens';
import { leagueTeamOpponent } from '../../../mocks/team-profiles/teams';
import { SEASON_CATEGORIES } from '../../../mocks/foundations/seasonCommon';

/** Teams: a league team's profile, GET /season/league_teams/{id} (?id=, default my opponent slot 1). Invented data is marked "Prototype data". */
export function LeagueTeamsScreen({ mode, apis, navigate, query }: RouteScreenProps) {
  const id = Number(query.get('id')) || 1;
  const team = useLiveOrMock(useCallback(() => apis.season.leagueTeam(id), [apis, id]), leagueTeamOpponent, mode);
  return (
    <>
      <LeagueTeamProfileView
        team={team.data}
        categories={SEASON_CATEGORIES}
        loading={team.loading}
        error={firstError([team])}
        onRetry={team.refresh}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[team, `GET /season/league_teams/${id}`]])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
