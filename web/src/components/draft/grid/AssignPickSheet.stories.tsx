import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiError } from '../../../api/client';
import { makePool, waitingSession } from '../../../mocks/draft/fixtures';
import { mockRoomState } from '../../../mocks/draft/room';
import { AssignPickSheet } from './AssignPickSheet';

const ok = async () => {
  await new Promise((r) => setTimeout(r, 300));
};
const made = waitingSession.picks[9]!;

const meta = {
  title: 'Draft/Grid/Assign Pick Sheet',
  component: AssignPickSheet,
  args: {
    cell: { pickNo: 30, round: 3, slot: 2, made: null },
    session: waitingSession,
    players: makePool(waitingSession),
    pool: mockRoomState(waitingSession, null).pool,
    onClose: () => {},
    onAssign: ok,
    onChange: ok,
    onRemove: ok,
  },
} satisfies Meta<typeof AssignPickSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty current cell: search and assign. */
export const AssignCurrent: Story = {};
/** An earlier empty cell while catching up out of order. */
export const AssignOutOfOrder: Story = { args: { cell: { pickNo: 41, round: 3, slot: 13, made: null } } };
/** A made pick: change the player or remove the pick. */
export const MadePick: Story = { args: { cell: { pickNo: made.pick_no, round: made.round, slot: made.team_id, made } } };
/** The API refuses (e.g. wrong team for that pick): shown in the sheet. */
export const AssignRejected: Story = {
  args: {
    onAssign: async () => {
      await new Promise((r) => setTimeout(r, 200));
      throw new ApiError(409, 'pick 30 belongs to team 2, not team 3');
    },
  },
};
