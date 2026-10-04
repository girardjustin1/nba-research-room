import type { RouteScreenProps } from '../../../app/types';
import { DraftRoom } from './DraftRoom';

/** Route screen for #/draft: the live draft room on the app's draft API (a mock API in stories).
 * `#/draft?tab=league` opens on Me vs league. */
export function DraftScreen({ apis, query }: RouteScreenProps) {
  return <DraftRoom api={apis.draft} initialTab={query.get('tab') === 'league' ? 'league' : 'board'} />;
}
