import { useCallback, useState } from 'react';
import type { OpponentRoster, OpponentRosterRequest } from '../../../api/season';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { OpponentRosterEditor } from '../../team-profiles/OpponentRosterEditor';
import { opponentRosterFilled, sampleSave, sampleSearch } from '../../../mocks/team-profiles/opponentRoster';

/**
 * Teams → This week's opponent: GET/POST /season/opponent_roster, GET /season/player_search.
 * With sample data, saving and searching work in memory. Invented data is marked "Prototype data".
 */
export function LeagueOpponentScreen({ mode, apis, navigate }: RouteScreenProps) {
  const roster = useLiveOrMock(useCallback(() => apis.season.opponentRoster(), [apis]), opponentRosterFilled, mode);
  const [sample, setSample] = useState<OpponentRoster | null>(null);
  const data = roster.isMock ? (sample ?? roster.data) : roster.data;
  const onSearch = useCallback(
    async (q: string) => (roster.isMock ? sampleSearch(q) : (await apis.season.playerSearch(q)).players),
    [apis, roster.isMock],
  );
  const onSave = async (body: OpponentRosterRequest) => {
    if (roster.isMock) {
      const r = sampleSave(data ?? opponentRosterFilled, body);
      setSample(r);
      return r;
    }
    return apis.season.saveOpponentRoster(body);
  };
  return (
    <>
      <OpponentRosterEditor
        data={data}
        loading={roster.loading}
        error={firstError([roster])}
        onRetry={roster.refresh}
        onSearch={onSearch}
        onSave={onSave}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[roster, 'GET /season/opponent_roster']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
