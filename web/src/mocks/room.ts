import { ApiError } from '../api/client';
import type { Board, PoolPlayer, Session } from '../api/types';
import type { DraftRoomActions, DraftRoomState } from '../api/useDraftRoom';
import { makePool } from './fixtures';

/** A DraftRoomState built from invented fixtures, for stories. */
export function mockRoomState(session: Session | null, board: Board | null, extra: Partial<DraftRoomState> = {}): DraftRoomState {
  const players: PoolPlayer[] = session ? makePool(session) : [];
  return {
    connection: 'up',
    session,
    noSession: false,
    board,
    boardError: null,
    boardLoading: false,
    players,
    lastUpdated: 0,
    ...extra,
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Actions that resolve after a short delay (or reject with `failWith`), logging to the console. */
export function mockActions(failWith?: ApiError): DraftRoomActions {
  const act = (name: string) => async (...args: unknown[]) => {
    console.info(`[mock] ${name}`, ...args);
    await wait(400);
    if (failWith) throw failWith;
  };
  return {
    start: act('start'),
    setSlot: act('setSlot'),
    setPunts: act('setPunts'),
    pick: act('pick'),
    undo: act('undo'),
    refresh: () => console.info('[mock] refresh'),
  };
}

export const alreadyDrafted = new ApiError(409, 'pick 5 is already recorded (Sample Guard A)');
