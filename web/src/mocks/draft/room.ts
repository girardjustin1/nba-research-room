import { ApiError } from '../../api/client';
import type { Board, PoolPlayer, Session } from '../../api/types';
import type { DraftRoomActions, DraftRoomState } from '../../api/useDraftRoom';
import { SAMPLE_PLAYERS } from './players';
import { makeInsights, makePool, makePositional, makeTeams, makeTeamWeeks } from './fixtures';

/** A DraftRoomState built from invented fixtures, for stories. */
export function mockRoomState(session: Session | null, board: Board | null, extra: Partial<DraftRoomState> = {}): DraftRoomState {
  const players: PoolPlayer[] = session ? makePool(session) : [];
  const drafted = new Set(session?.picks.map((p) => p.player_id) ?? []);
  const pool = new Map<number, PoolPlayer>(SAMPLE_PLAYERS.map((p) => [p.player_id, { ...p, drafted: drafted.has(p.player_id) }]));
  return {
    connection: 'up',
    session,
    noSession: false,
    board,
    boardError: null,
    boardLoading: false,
    players,
    pool,
    teams: { data: session ? makeTeams(session) : null, error: null },
    positional: { data: session ? makePositional() : null, error: null },
    insights: { data: session ? makeInsights(session) : null, error: null },
    schedule: { data: makeTeamWeeks(), error: null },
    lastUpdated: 0,
    lastPickSeenAt: Date.now() - 12_000,
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
    removePick: act('removePick'),
    changePick: act('changePick'),
    undo: act('undo'),
    setTeamNames: act('setTeamNames'),
    exportResults: async () => {
      await act('exportResults')();
      return 'data/inbox/draft_results.csv';
    },
    refresh: () => console.info('[mock] refresh'),
  };
}

export const alreadyDrafted = new ApiError(409, 'pick 5 is already recorded (Sample Guard A)');
/** What the app sees until the Python API ships an endpoint. */
export const notFound = new ApiError(404, 'Not Found');
