import { useCallback } from 'react';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { firstError, LEAGUE_NAV_HEIGHT, mockEndpoints, todayET } from '../../../app/league';
import { SEASON_TAB_PATH } from '../../../app/experiences';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { NotificationsInbox } from '../../screens';
import { notificationsNormal } from '../../../mocks/notifications/notifications';
import { SEASON_CATEGORIES, TODAY } from '../../../mocks/foundations/seasonCommon';

/** Notifications (header bell): GET /season/notifications. Invented data is marked "Prototype data". */
export function LeagueNotificationsScreen({ mode, apis, navigate }: RouteScreenProps) {
  const data = useLiveOrMock(useCallback(() => apis.season.notifications(), [apis]), notificationsNormal, mode);
  return (
    <>
      <NotificationsInbox
        data={data.data}
        today={data.isMock ? TODAY : todayET()}
        categories={SEASON_CATEGORIES}
        loading={data.loading}
        error={firstError([data])}
        onRetry={data.refresh}
        onTabChange={(t) => navigate(SEASON_TAB_PATH[t] ?? '#/league/matchup')}
      />
      <PrototypeDataChip endpoints={mockEndpoints([[data, 'GET /season/notifications']])} bottomOffset={LEAGUE_NAV_HEIGHT} />
    </>
  );
}
