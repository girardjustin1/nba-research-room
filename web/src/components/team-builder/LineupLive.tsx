import { useMemo } from 'react';
import { ApiError, errorMessage } from '../../api/client';
import { createSeasonApi } from '../../api/season';
import { useSeasonResource } from '../../api/useSeasonResource';
import type { SeasonTab } from '../foundations/ScreenFrame';
import type { BuilderView } from './BuilderTabs';
import { LineupScreen } from './LineupScreen';

export interface LineupLiveProps {
  base?: string;
  onTabChange?: (tab: SeasonTab) => void;
  onBuilderView?: (v: BuilderView) => void;
}

/**
 * Container: GET /api/season/lineup (implemented, via the Vite proxy) polled every 30 s
 * into the presentational LineupScreen. Stories use LineupScreen with invented data.
 */
export function LineupLive({ base = '/api', onTabChange, onBuilderView }: LineupLiveProps) {
  const api = useMemo(() => createSeasonApi(base), [base]);
  const r = useSeasonResource(() => api.lineup());
  return (
    <LineupScreen
      lineup={r.data}
      loading={r.loading}
      error={
        r.error instanceof ApiError && r.error.isNotFound
          ? 'The running API predates GET /season/lineup. Restart it with make draft-api after updating.'
          : r.error
            ? errorMessage(r.error)
            : null
      }
      notReady={r.notReady}
      connectionDown={r.connection === 'down' && r.data != null}
      onRetry={r.refresh}
      onTabChange={onTabChange}
      onBuilderView={onBuilderView}
    />
  );
}
