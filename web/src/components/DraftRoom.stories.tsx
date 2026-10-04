import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiError } from '../api/client';
import {
  completeBoard,
  completeSession,
  driftBoard,
  driftSession,
  makeSession,
  onTheClockBoard,
  onTheClockSession,
  puntBoard,
  puntSession,
  waitingBoard,
  waitingSession,
} from '../mocks/fixtures';
import { alreadyDrafted, mockActions, mockRoomState } from '../mocks/room';
import { DraftRoomView } from './DraftRoom';

const meta = {
  title: 'Draft/DraftRoom',
  component: DraftRoomView,
  args: { state: mockRoomState(onTheClockSession, onTheClockBoard), actions: mockActions() },
} satisfies Meta<typeof DraftRoomView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTheClock: Story = {};
export const Waiting: Story = { args: { state: mockRoomState(waitingSession, waitingBoard) } };
export const PuntDrift: Story = { args: { state: mockRoomState(driftSession, driftBoard) } };
export const MyTeamTab: Story = { args: { state: mockRoomState(driftSession, driftBoard), initialTab: 'team' } };
export const MyTeamPunting: Story = { args: { state: mockRoomState(puntSession, puntBoard), initialTab: 'team' } };
export const PickTab: Story = { args: { state: mockRoomState(waitingSession, waitingBoard), initialTab: 'pick' } };
export const PickTabConflict: Story = {
  args: { state: mockRoomState(waitingSession, waitingBoard), initialTab: 'pick', actions: mockActions(alreadyDrafted) },
};
export const TiersTab: Story = { args: { state: mockRoomState(waitingSession, waitingBoard), initialTab: 'tiers' } };
export const LogTab: Story = { args: { state: mockRoomState(driftSession, driftBoard), initialTab: 'log' } };
export const FirstLoad: Story = { args: { state: mockRoomState(onTheClockSession, null, { boardLoading: true }) } };
export const BoardError: Story = {
  args: { state: mockRoomState(onTheClockSession, null, { boardError: new ApiError(500, 'Request failed (HTTP 500)') }) },
};
/** The API went away mid-draft: last data stays, with a banner. */
export const ApiDownMidDraft: Story = { args: { state: mockRoomState(waitingSession, waitingBoard, { connection: 'down' }) } };
export const ApiUnreachable: Story = { args: { state: mockRoomState(null, null, { connection: 'down' }) } };
export const Connecting: Story = { args: { state: mockRoomState(null, null, { connection: 'connecting' }) } };
export const NoSession: Story = { args: { state: mockRoomState(null, null, { noSession: true }) } };
export const NoSlot: Story = {
  args: {
    state: mockRoomState(makeSession({ mySlot: null, currentPick: 9 }), null, {
      boardError: new ApiError(409, 'set your draft slot first (PUT /draft/slot)'),
    }),
  },
};
export const Complete: Story = { args: { state: mockRoomState(completeSession, completeBoard) } };
/** Landscape is handled (scrolls), not optimized. */
export const Landscape: Story = {
  args: { state: mockRoomState(waitingSession, waitingBoard) },
  globals: { viewport: { value: 'iphone17landscape', isRotated: false } },
};
