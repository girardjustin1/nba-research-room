import type { DraftApi } from '../api/client';
import type { SeasonApi } from '../api/season';
import type { SystemApi } from '../api/system';
import type { DataMode } from './useLiveOrMock';

export type Experience = 'draft' | 'league' | 'system';

export interface AppApis {
  draft: DraftApi;
  season: SeasonApi;
  system: SystemApi;
}

/** Props every routed screen receives from the app frame. */
export interface RouteScreenProps {
  /** live: call the API (404 falls back to the shared mock, marked "Prototype data"); mock: stories. */
  mode: DataMode;
  apis: AppApis;
  navigate: (path: string) => void;
  /** Query parameters after "?" in the hash, e.g. #/league/players/profile?id=12. */
  query: URLSearchParams;
}
