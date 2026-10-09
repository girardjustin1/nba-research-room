import { useCallback, useState } from 'react';
import type { MyRoster, MyRosterRequest } from '../../../api/season';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { MyRosterEditor } from '../../team-profiles/MyRosterEditor';
import { myRosterFilled, sampleSaveMine, sampleSearchMine } from '../../../mocks/team-profiles/myRoster';

/**
 * Team → My roster: GET/POST /season/my_roster, GET /season/player_search. With sample data,
 * saving and searching work in memory. Invented data is marked "Prototype data".
 */
export function LeagueMyRosterScreen({ mode, apis, navigate }: RouteScreenProps) {
  const roster = useLiveOrMock(useCallback(() => apis.season.myRoster(), [apis]), myRosterFilled, mode);
  const [sample, setSample] = useState<MyRoster | null>(null);
  const data = roster.isMock ? (sample ?? roster.data) : roster.data;
  const onSearch = useCallback(
    async (q: string) => (roster.isMock ? sampleSearchMine(q) : (await apis.season.playerSearch(q)).players),
    [apis, roster.isMock],
  );
  const onSave = async (body: MyRosterRequest) => {
    if (roster.isMock) {
      const r = sampleSaveMine(data ?? myRosterFilled, body);
      setSample(r);
      return r;
    }
    return apis.season.saveMyRoster(body);
  };
  return (
    <>
      <MyRosterEditor
        data={data}
        loading={roster.loading}
        error={firstError([roster])}
        onRetry={roster.refresh}
        onSearch={onSearch}
        onSave={onSave}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[roster, 'GET /season/my_roster']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
