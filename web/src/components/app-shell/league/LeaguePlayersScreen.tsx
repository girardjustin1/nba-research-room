import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { ResearchFeed } from '../../screens';
import { feedNormal } from '../../../mocks/team-player-analysis/feed';
import { SEASON_CATEGORIES } from '../../../mocks/foundations/seasonCommon';

/** Players: the research feed (GET /season/feed); rows open a player's deep dive. Invented data is marked "Prototype data". */
export function LeaguePlayersScreen({ mode, apis, navigate }: RouteScreenProps) {
  const feed = useLiveOrMock(useCallback(() => apis.season.feed(), [apis]), feedNormal, mode);
  return (
    <>
      <ResearchFeed
        feed={feed.data}
        categories={SEASON_CATEGORIES}
        loading={feed.loading}
        error={firstError([feed])}
        onRetry={feed.refresh}
        onOpenPlayer={(p) => navigate(`#/league/players/profile?id=${p.player_id}`)}
        onOpenMove={() => navigate('#/league/team/moves')}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[feed, 'GET /season/feed']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
