import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, ApiUnreachableError, type DraftApi } from './client';
import type { Board, DraftTeam, PickIn, PickInsight, PoolPlayer, PositionalValue, Session, StrengthResponse, TeamWeeksResponse } from './types';

export type Connection = 'connecting' | 'up' | 'down';

/** An optional endpoint: its data, or the error it returned (404 = the API lacks it yet). */
export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
}

export function emptyResource<T>(): Resource<T> {
  return { data: null, error: null };
}

export interface DraftRoomState {
  connection: Connection;
  /** null until loaded, or when the API has no session yet. */
  session: Session | null;
  /** True when the API is up but no session was started (409 on GET /draft/session). */
  noSession: boolean;
  board: Board | null;
  boardError: ApiError | null;
  /** True while a refetch is in flight; the previous data stays on screen. */
  boardLoading: boolean;
  /** Available players (not drafted). */
  players: PoolPlayer[];
  /** Every player, drafted or not, keyed by id: the grid needs drafted players' positions. */
  pool: Map<number, PoolPlayer>;
  teams: Resource<DraftTeam[]>;
  positional: Resource<PositionalValue[]>;
  /** Me vs the league per category (GET /draft/strength). */
  strength: Resource<StrengthResponse>;
  /** The engine's note on the positional values, when it sends one. */
  positionalNote?: string | null;
  /** The live read after recent picks, newest last (GET /draft/insights). */
  insights: Resource<PickInsight[]>;
  /** Games per fantasy week for every NBA team (GET /schedule/team_weeks), fetched once. */
  schedule: Resource<TeamWeeksResponse>;
  lastUpdated: number | null;
  /** When this app last saw the current pick change (the listener posting a pick). */
  lastPickSeenAt: number | null;
}

export interface DraftRoomActions {
  start(mySlot: number, punts: string[]): Promise<void>;
  setSlot(mySlot: number): Promise<void>;
  setPunts(punts: string[]): Promise<void>;
  pick(body: PickIn): Promise<void>;
  /** Remove one pick (DELETE /draft/pick/{pick_no}). */
  removePick(pickNo: number): Promise<void>;
  /** Replace the player at an already-made pick: remove, then record again. */
  changePick(pickNo: number, teamId: number, playerId: number): Promise<void>;
  undo(): Promise<void>;
  setTeamNames(names: Record<string, string>): Promise<void>;
  /** POST /draft/export: writes data/inbox/draft_results.csv; resolves to the path written. */
  exportResults(): Promise<string>;
  refresh(): void;
}

export const POLL_MS = 1500;

/** What must change for the board to be stale: a pick (or undo), punts, my slot, or team names. */
export function boardKey(s: Session | null): string | null {
  if (!s) return null;
  const picks = s.picks.map((p) => `${p.pick_no}:${p.player_id ?? ''}`).join(',');
  const names = s.team_names ? Object.values(s.team_names).join('|') : '';
  return [s.draft_id, s.current_pick ?? 'done', picks, s.my_slot ?? '-', [...s.punts].sort().join(','), names].join('#');
}

function asApiError(reason: unknown): ApiError | null {
  return reason instanceof ApiError ? reason : null;
}

/**
 * Polls GET /draft/session every ~1.5 s (the Tampermonkey listener posts picks straight to
 * the API, so the UI must follow without user action). When the pick state changes it
 * refetches the board, the player pool, the teams, the positional value and the strength together. Only
 * one refetch runs at a time; if picks land meanwhile, one more runs after it.
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
    pool: new Map(),
    teams: emptyResource(),
    positional: emptyResource(),
    strength: emptyResource(),
    insights: emptyResource(),
    schedule: emptyResource(),
    lastUpdated: null,
    lastPickSeenAt: null,
  });
  const loadedKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const latest = useRef<Session | null>(null);
  const alive = useRef(true);
  const wake = useRef<() => void>(() => {});
  const lastPick = useRef<number | null | undefined>(undefined);

  const loadAll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      while (alive.current && latest.current && boardKey(latest.current) !== loadedKey.current) {
        const key = boardKey(latest.current);
        loadedKey.current = key;
        setState((s) => ({ ...s, boardLoading: true }));
        const [board, pool, teams, positional, insights, strength] = await Promise.allSettled([
          api.getBoard(),
          api.getPlayers({ availableOnly: false, limit: 2000 }),
          api.getTeams(),
          api.getPositionalValue(),
          api.getInsights(),
          api.getStrength(),
        ]);
        if (!alive.current) return;
        const drafted = new Set((latest.current?.picks ?? []).map((p) => p.player_id));
        setState((s) => {
          const all = pool.status === 'fulfilled' ? pool.value.players : null;
          return {
            ...s,
            boardLoading: false,
            board: board.status === 'fulfilled' ? board.value : s.board,
            boardError: board.status === 'rejected' ? asApiError(board.reason) : null,
            pool: all ? new Map(all.map((p) => [p.player_id, p])) : s.pool,
            players: all ? all.filter((p) => !p.drafted && !drafted.has(p.player_id)) : s.players,
            teams:
              teams.status === 'fulfilled'
                ? { data: teams.value.teams, error: null }
                : { data: s.teams.data, error: asApiError(teams.reason) },
            positional:
              positional.status === 'fulfilled'
                ? { data: positional.value.positions, error: null }
                : { data: s.positional.data, error: asApiError(positional.reason) },
            strength:
              strength.status === 'fulfilled'
                ? { data: strength.value, error: null }
                : { data: s.strength.data, error: asApiError(strength.reason) },
            positionalNote: positional.status === 'fulfilled' ? (positional.value.note ?? null) : s.positionalNote,
            insights:
              insights.status === 'fulfilled'
                ? { data: [...insights.value.insights].sort((a, b) => a.pick_no - b.pick_no), error: null }
                : { data: s.insights.data, error: asApiError(insights.reason) },
          };
        });
        if (board.status === 'rejected' && !(board.reason instanceof ApiError)) {
          loadedKey.current = null; // unreachable mid-fetch: retry next poll
          return;
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [api]);

  const applySession = useCallback(
    (session: Session) => {
      latest.current = session;
      const changed = lastPick.current !== undefined && lastPick.current !== session.current_pick;
      lastPick.current = session.current_pick;
      const now = Date.now();
      setState((s) => ({
        ...s,
        connection: 'up',
        session,
        noSession: false,
        lastUpdated: now,
        lastPickSeenAt: changed ? now : s.lastPickSeenAt,
      }));
      if (boardKey(session) !== loadedKey.current) void loadAll();
    },
    [loadAll],
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
        latest.current = null;
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

  // The season schedule does not change during the draft: fetch it once the API answers.
  const scheduleState = useRef<'idle' | 'loading' | 'done'>('idle');
  useEffect(() => {
    if (state.connection !== 'up' || scheduleState.current !== 'idle') return;
    scheduleState.current = 'loading';
    api.getTeamWeeks().then(
      (data) => {
        scheduleState.current = 'done';
        if (alive.current) setState((s) => ({ ...s, schedule: { data, error: null } }));
      },
      (err: unknown) => {
        // A 404 is final until the API is updated; anything else retries on a later poll.
        scheduleState.current = err instanceof ApiError && err.isNotFound ? 'done' : 'idle';
        if (alive.current) setState((s) => ({ ...s, schedule: { data: s.schedule.data, error: asApiError(err) } }));
      },
    );
  }, [api, state.connection]);

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
      removePick: async (pickNo) => applySession(await api.removePick(pickNo)),
      changePick: async (pickNo, teamId, playerId) => {
        applySession(await api.removePick(pickNo));
        applySession(await api.pick({ player_id: playerId, pick_no: pickNo, team_id: teamId }));
      },
      undo: async () => applySession(await api.undo()),
      setTeamNames: async (names) => {
        await api.setTeamNames(names);
        loadedKey.current = null;
        wake.current();
      },
      exportResults: async () => (await api.exportResults()).path,
      refresh: () => {
        loadedKey.current = null;
        wake.current();
      },
    }),
    [api, applySession],
  );

  return [state, actions];
}
