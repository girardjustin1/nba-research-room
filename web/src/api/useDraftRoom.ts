import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, ApiUnreachableError, type DraftApi } from './client';
import type { Board, PickIn, PoolPlayer, Session } from './types';

export type Connection = 'connecting' | 'up' | 'down';

export interface DraftRoomState {
  connection: Connection;
  /** null until loaded, or when the API has no session yet. */
  session: Session | null;
  /** True when the API is up but no session was started (409 on GET /draft/session). */
  noSession: boolean;
  board: Board | null;
  boardError: ApiError | null;
  /** True while a board refetch is in flight; the previous board stays on screen. */
  boardLoading: boolean;
  players: PoolPlayer[];
  lastUpdated: number | null;
}

export interface DraftRoomActions {
  start(mySlot: number, punts: string[]): Promise<void>;
  setSlot(mySlot: number): Promise<void>;
  setPunts(punts: string[]): Promise<void>;
  pick(body: PickIn): Promise<void>;
  undo(): Promise<void>;
  refresh(): void;
}

export const POLL_MS = 1500;

/** What must change for the board to be stale: a pick (or undo), punts, or my slot. */
export function boardKey(s: Session | null): string | null {
  if (!s) return null;
  return [s.draft_id, s.current_pick ?? 'done', s.picks.length, s.my_slot ?? '-', [...s.punts].sort().join(',')].join('|');
}

/**
 * Polls GET /draft/session every ~1.5 s (the Tampermonkey listener posts picks straight to
 * the API, so the UI must follow without user action) and refetches the board and the
 * available-player pool whenever the session's pick state changes.
 */
export function useDraftRoom(api: DraftApi, pollMs = POLL_MS): [DraftRoomState, DraftRoomActions] {
  const [state, setState] = useState<DraftRoomState>({
    connection: 'connecting',
    session: null,
    noSession: false,
    board: null,
    boardError: null,
    boardLoading: false,
    players: [],
    lastUpdated: null,
  });
  const loadedKey = useRef<string | null>(null);
  const alive = useRef(true);
  const wake = useRef<() => void>(() => {});

  const loadBoard = useCallback(
    async (session: Session) => {
      const key = boardKey(session);
      loadedKey.current = key;
      setState((s) => ({ ...s, boardLoading: true }));
      const [boardRes, playersRes] = await Promise.allSettled([api.getBoard(), api.getPlayers({ availableOnly: true })]);
      if (!alive.current || loadedKey.current !== key) return;
      setState((s) => ({
        ...s,
        boardLoading: false,
        board: boardRes.status === 'fulfilled' ? boardRes.value : s.board,
        boardError:
          boardRes.status === 'rejected' && boardRes.reason instanceof ApiError ? boardRes.reason : null,
        players: playersRes.status === 'fulfilled' ? playersRes.value.players : s.players,
      }));
      if (boardRes.status === 'rejected' && !(boardRes.reason instanceof ApiError)) {
        loadedKey.current = null; // unreachable mid-fetch: retry next poll
      }
    },
    [api],
  );

  const applySession = useCallback(
    (session: Session) => {
      setState((s) => ({ ...s, connection: 'up', session, noSession: false, lastUpdated: Date.now() }));
      if (boardKey(session) !== loadedKey.current) void loadBoard(session);
    },
    [loadBoard],
  );

  const poll = useCallback(async () => {
    try {
      const session = await api.getSession();
      if (!alive.current) return;
      applySession(session);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.isNoSession) {
        loadedKey.current = null;
        setState((s) => ({ ...s, connection: 'up', session: null, noSession: true, board: null, boardError: null }));
      } else if (err instanceof ApiUnreachableError) {
        loadedKey.current = null;
        setState((s) => ({ ...s, connection: 'down' }));
      } else {
        setState((s) => ({ ...s, connection: 'up' }));
      }
    }
  }, [api, applySession]);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await poll();
      if (alive.current) timer = setTimeout(loop, pollMs);
    };
    wake.current = () => {
      if (timer) clearTimeout(timer);
      void loop();
    };
    void loop();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [poll, pollMs]);

  const actions = useMemo<DraftRoomActions>(
    () => ({
      start: async (mySlot, punts) => applySession(await api.startSession({ my_slot: mySlot, punts })),
      setSlot: async (mySlot) => applySession(await api.setSlot(mySlot)),
      setPunts: async (punts) => {
        const session = await api.setPunts(punts);
        loadedKey.current = null; // re-valued pool: always refetch
        applySession(session);
      },
      pick: async (body) => applySession(await api.pick(body)),
      undo: async () => applySession(await api.undo()),
      refresh: () => {
        loadedKey.current = null;
        wake.current();
      },
    }),
    [api, applySession],
  );

  return [state, actions];
}
