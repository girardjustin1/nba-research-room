import { useCallback, useState } from 'react';
import type { FreeAgents, FreeAgentsRequest } from '../../../api/season';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { FreeAgentsEditor } from '../../team-profiles/FreeAgentsEditor';
import { freeAgentsFilled, sampleSaveFree } from '../../../mocks/team-profiles/freeAgents';

/**
 * Team → Free agents: GET/POST /season/free_agents. With sample data, saving works in memory.
 * Invented data is marked "Prototype data".
 */
export function LeagueFreeAgentsScreen({ mode, apis, navigate }: RouteScreenProps) {
  const list = useLiveOrMock(useCallback(() => apis.season.freeAgents(), [apis]), freeAgentsFilled, mode);
  const [sample, setSample] = useState<FreeAgents | null>(null);
  const data = list.isMock ? (sample ?? list.data) : list.data;
  const onSave = async (body: FreeAgentsRequest) => {
    if (list.isMock) {
      const r = sampleSaveFree(body);
      setSample(r);
      return r;
    }
    return apis.season.saveFreeAgents(body);
  };
  return (
    <>
      <FreeAgentsEditor
        data={data}
        loading={list.loading}
        error={firstError([list])}
        onRetry={list.refresh}
        onSave={onSave}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[list, 'GET /season/free_agents']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
