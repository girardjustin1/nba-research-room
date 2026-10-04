import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints, todayET } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { ScheduleVolume } from '../../screens';
import { teamWeeks } from '../../../mocks/team-profiles/schedule';
import { lineupNormal } from '../../../mocks/team-builder/lineup';
import { TODAY } from '../../../mocks/foundations/seasonCommon';

/** Schedule volume (GET /schedule/team_weeks is live); my teams come from the lineup. Invented data is marked "Prototype data". */
export function LeagueScheduleScreen({ mode, apis, navigate }: RouteScreenProps) {
  const weeks = useLiveOrMock(useCallback(() => apis.season.teamWeeks(), [apis]), teamWeeks, mode);
  const lineup = useLiveOrMock(useCallback(() => apis.season.lineup(), [apis]), lineupNormal, mode);
  const myTeams = [...new Set((lineup.data?.roster ?? []).map((p) => p.team_abbr).filter((t): t is string => !!t))];
  return (
    <>
      <ScheduleVolume
        data={weeks.data}
        myTeams={myTeams}
        today={weeks.isMock ? TODAY : todayET()}
        loading={weeks.loading}
        error={firstError([weeks])}
        onRetry={weeks.refresh}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip
        endpoints={mockEndpoints([
          [weeks, 'GET /schedule/team_weeks'],
          [lineup, 'GET /season/lineup (my teams)'],
        ])}
        bottomOffset={LEAGUE_NAV_HEIGHT}
      />
    </>
  );
}
