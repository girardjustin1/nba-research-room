import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiError } from '../../../api/client';
import {
  completeBoard,
  completeSession,
  driftBoard,
  driftSession,
  makeBoard,
  makeCompare,
  makeSession,
  onTheClockBoard,
  onTheClockSession,
  puntBoard,
  puntSession,
  waitingBoard,
  waitingSession,
} from '../../../mocks/draft/fixtures';
import { mockActions, mockRoomState, notFound } from '../../../mocks/draft/room';
import { DraftRoomView } from './DraftRoom';

const loadCompare = async (ids: number[]) => {
  await new Promise((r) => setTimeout(r, 300));
  return makeCompare(ids);
};

/** Round 3, pick 30 of the 14-team league: I'm slot 5, up in 3 picks. */
const midSession = makeSession({ mySlot: 5, currentPick: 30 });
const midBoard = makeBoard(midSession);

const meta = {
  title: 'Draft/Room',
  component: DraftRoomView,
  args: { state: mockRoomState(waitingSession, waitingBoard), actions: mockActions(), loadCompare },
} satisfies Meta<typeof DraftRoomView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Waiting: blue "Up in 3 picks"; tap any cell to record or fix a pick. */
export const UpInPicks: Story = {};
/** Red "On the clock": Suggested picks' Draft buttons are live. */
export const OnTheClock: Story = { args: { state: mockRoomState(onTheClockSession, onTheClockBoard) } };
/** The live read after the newest pick slides in (tap it for that team). */
export const LatestPick: Story = { args: { state: mockRoomState(midSession, midBoard), showLatestOnLoad: true } };
export const PuntDrift: Story = { args: { state: mockRoomState(driftSession, driftBoard) } };
/** Me vs league: my standing per category against the league, the market by position,
 * suggested picks, then the available players (ADP sort, PROJ. PICK divider at my next pick). */
export const MeVsLeague: Story = { args: { initialTab: 'league' } };
export const MeVsLeagueOnTheClock: Story = { args: { state: mockRoomState(onTheClockSession, onTheClockBoard), initialTab: 'league' } };
export const MeVsLeaguePunting: Story = { args: { state: mockRoomState(puntSession, puntBoard), initialTab: 'league' } };
export const Favorites: Story = { args: { initialTab: 'league', initialPlayers: 'favorites' } };
export const MyTeam: Story = { args: { state: mockRoomState(driftSession, driftBoard), initialPanel: 'myteam' } };
/** Strategize: teams picking before my next pick come first. */
export const Teams: Story = { args: { state: mockRoomState(midSession, midBoard), initialPanel: 'teams' } };
export const TopTenWithReasons: Story = { args: { initialPanel: 'recommendations' } };
export const EnterPickAndUndo: Story = { args: { initialPanel: 'entry' } };
export const DraftLog: Story = { args: { state: mockRoomState(driftSession, driftBoard), initialPanel: 'log' } };
export const Tiers: Story = { args: { initialPanel: 'tiers' } };
export const EditTeamNames: Story = { args: { initialPanel: 'names' } };
/** The running API predates the new endpoints: panels say so instead of showing made-up numbers. */
export const NewEndpointsMissing: Story = {
  args: {
    state: mockRoomState(waitingSession, waitingBoard, {
      teams: { data: null, error: notFound },
      positional: { data: null, error: notFound },
      insights: { data: null, error: notFound },
      strength: { data: null, error: notFound },
    }),
    initialTab: 'league',
  },
};
export const FirstLoad: Story = {
  args: {
    state: mockRoomState(onTheClockSession, null, { boardLoading: true, positional: { data: null, error: null }, teams: { data: null, error: null } }),
  },
};
export const BoardError: Story = {
  args: { state: mockRoomState(onTheClockSession, null, { boardError: new ApiError(500, 'Request failed (HTTP 500)') }) },
};
export const ApiDownMidDraft: Story = { args: { state: mockRoomState(waitingSession, waitingBoard, { connection: 'down' }) } };
export const ApiUnreachable: Story = { args: { state: mockRoomState(null, null, { connection: 'down' }) } };
export const NoSession: Story = { args: { state: mockRoomState(null, null, { noSession: true }) } };
export const NoSlot: Story = {
  args: {
    state: mockRoomState(makeSession({ mySlot: null, currentPick: 9 }), null, {
      boardError: new ApiError(409, 'set your draft slot first (PUT /draft/slot)'),
    }),
  },
};
export const Complete: Story = { args: { state: mockRoomState(completeSession, completeBoard) } };
/** Landscape is handled, not optimized. */
export const Landscape: Story = { globals: { viewport: { value: 'iphone17landscape', isRotated: false } } };
