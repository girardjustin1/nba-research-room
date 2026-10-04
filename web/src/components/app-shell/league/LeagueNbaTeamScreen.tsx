import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints, todayET } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { NbaTeamProfileView } from '../../screens';
import { nbaTeamNOP } from '../../../mocks/team-profiles/teams';
import { teamWeeks } from '../../../mocks/team-profiles/schedule';
import { TODAY } from '../../../mocks/foundations/seasonCommon';

/** An NBA team's profile: GET /season/nba_teams/{abbr} (?team=, default NOP). Invented data is marked "Prototype data". */
export function LeagueNbaTeamScreen({ mode, apis, navigate, query }: RouteScreenProps) {
  const abbr = (query.get('team') ?? 'NOP').toUpperCase();
  const team = useLiveOrMock(useCallback(() => apis.season.nbaTeam(abbr), [apis, abbr]), nbaTeamNOP, mode);
  const weeks = useLiveOrMock(useCallback(() => apis.season.teamWeeks(), [apis]), teamWeeks, mode);
  return (
    <>
      <NbaTeamProfileView
        team={team.data}
        weeks={weeks.data}
        today={team.isMock ? TODAY : todayET()}
        loading={team.loading}
        error={firstError([team])}
        onRetry={team.refresh}
        onBack={() => navigate('#/league/teams')}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip
        endpoints={mockEndpoints([
          [team, `GET /season/nba_teams/${abbr}`],
          [weeks, 'GET /schedule/team_weeks'],
        ])}
        bottomOffset={LEAGUE_NAV_HEIGHT}
      />
    </>
  );
}
