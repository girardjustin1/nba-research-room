import type { RouteScreenProps } from '../../../app/types';
import { DraftRoom } from './DraftRoom';

/** Route screen for #/draft: the live draft room on the app's draft API (a mock API in stories).
 * `#/draft?tab=league` opens on Me vs league, `?tab=players` on Players. */
export function DraftScreen({ apis, query }: RouteScreenProps) {
  const tab = query.get('tab');
  return <DraftRoom api={apis.draft} initialTab={tab === 'league' || tab === 'players' ? tab : 'board'} />;
}
