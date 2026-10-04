import type { RouteScreenProps } from '../../../app/types';
import { DraftRoom } from './DraftRoom';

/** Route screen for #/draft: the live draft room on the app's draft API (a mock API in stories). */
export function DraftScreen({ apis }: RouteScreenProps) {
  return <DraftRoom api={apis.draft} />;
}
