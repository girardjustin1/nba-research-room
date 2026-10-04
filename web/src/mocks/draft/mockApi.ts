import type { DraftApi } from '../../api/client';
import { makeBoard, makeCompare, makeInsights, makePool, makePositional, makeSession, makeTeamDays, makeTeams, makeTeamWeeks } from './fixtures';

/**
 * A DraftApi backed by the invented draft fixtures, so the real DraftRoom container runs in
 * Storybook's Prototype section with the same sample data as the component stories.
 * Writes (pick, undo, ...) resolve with the unchanged session: nothing is stored.
 */
export function createMockDraftApi(currentPick = 30): DraftApi {
  const session = makeSession({ mySlot: 5, currentPick });
  const board = makeBoard(session);
  const ok = async () => session;
  return {
    health: async () => ({ ok: true, session: session.draft_id }),
    getSession: ok,
    startSession: ok,
    setSlot: ok,
    setPunts: ok,
    getBoard: async () => board,
    getPlayers: async () => ({ players: makePool(session) }),
    getRosters: async () => ({ teams: {} }),
    pick: ok,
    undo: ok,
    removePick: ok,
    exportResults: async () => ({ path: 'data/draft_results.csv' }),
    getTeams: async () => ({ teams: makeTeams(session) }),
    setTeamNames: ok,
    getPositionalValue: async () => ({ positions: makePositional() }),
    compare: async (ids) => ({ players: makeCompare(ids) }),
    getInsights: async () => ({ insights: makeInsights(session), current_pick: session.current_pick, categories: session.categories }),
    getTeamWeeks: async () => makeTeamWeeks(),
    getTeamDays: async (team) => ({ team, days: makeTeamDays(team) }),
  };
}
