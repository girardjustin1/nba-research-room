import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { SeasonResults } from '../../screens';
import { resultsNormal } from '../../../mocks/results/results';

/** Results: GET /season/results. Invented data is marked "Prototype data". */
export function LeagueResultsScreen({ mode, apis, navigate }: RouteScreenProps) {
  const results = useLiveOrMock(useCallback(() => apis.season.results(), [apis]), resultsNormal, mode);
  return (
    <>
      <SeasonResults
        results={results.data}
        loading={results.loading}
        error={firstError([results])}
        onRetry={results.refresh}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[results, 'GET /season/results']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
