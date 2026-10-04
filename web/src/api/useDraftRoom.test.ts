import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeSession } from '../mocks/fixtures';
import { ApiError, ApiUnreachableError, type DraftApi } from './client';
import type { Session } from './types';
import { boardKey, useDraftRoom } from './useDraftRoom';

function fakeApi(sessions: (Session | Error)[]): DraftApi & { getBoard: ReturnType<typeof vi.fn> } {
  let i = 0;
  const next = () => sessions[Math.min(i++, sessions.length - 1)]!;
  const getSession = vi.fn(async () => {
    const s = next();
    if (s instanceof Error) throw s;
    return s;
  });
  const getBoard = vi.fn(async () => makeBoard(makeSession()));
  const fail = async () => {
    throw new Error('not used');
  };
  return {
    health: fail,
    getSession,
    startSession: fail,
    setSlot: fail,
    setPunts: fail,
    getBoard,
    getPlayers: vi.fn(async () => ({ players: [] })),
    getRosters: fail,
    pick: fail,
    undo: fail,
    exportResults: fail,
  } as unknown as DraftApi & { getBoard: ReturnType<typeof vi.fn> };
}

describe('boardKey', () => {
  it('changes with the current pick, the pick count, punts and slot', () => {
    const a = makeSession({ currentPick: 5 });
    expect(boardKey(a)).toBe(boardKey(makeSession({ currentPick: 5 })));
    expect(boardKey(a)).not.toBe(boardKey(makeSession({ currentPick: 6 })));
    expect(boardKey(a)).not.toBe(boardKey(makeSession({ currentPick: 5, punts: ['tov'] })));
    expect(boardKey(a)).not.toBe(boardKey(makeSession({ currentPick: 5, mySlot: 6 })));
    expect(boardKey(null)).toBeNull();
  });
});

describe('useDraftRoom polling', () => {
  it('refetches the board only when the pick changes', async () => {
    const s5 = makeSession({ currentPick: 5 });
    const s6 = makeSession({ currentPick: 6 });
    const api = fakeApi([s5, s5, s6, s6]);
    const { result } = renderHook(() => useDraftRoom(api, 20));
    await waitFor(() => expect(result.current[0].session?.current_pick).toBe(6), { timeout: 2000 });
    await waitFor(() => expect(api.getBoard).toHaveBeenCalledTimes(2));
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    expect(api.getBoard).toHaveBeenCalledTimes(2);
    expect(result.current[0].connection).toBe('up');
  });

  it('reports no session on the 409 and down when unreachable', async () => {
    const api = fakeApi([new ApiError(409, 'no draft session; POST /draft/session first'), new ApiUnreachableError()]);
    const { result } = renderHook(() => useDraftRoom(api, 20));
    await waitFor(() => expect(result.current[0].noSession).toBe(true));
    await waitFor(() => expect(result.current[0].connection).toBe('down'));
    expect(api.getBoard).not.toHaveBeenCalled();
  });
});
