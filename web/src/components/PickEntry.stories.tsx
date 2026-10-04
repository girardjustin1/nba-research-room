import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { alreadyDrafted } from '../mocks/room';
import { makePool, waitingSession } from '../mocks/fixtures';
import { PickEntry } from './PickEntry';

const ok = async () => {
  await new Promise((r) => setTimeout(r, 400));
};
const last = waitingSession.picks[waitingSession.picks.length - 1] ?? null;

const meta = {
  title: 'Draft/PickEntry',
  component: PickEntry,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}><Story /></Box>],
  args: {
    players: makePool(waitingSession),
    teams: 14,
    onTheClock: waitingSession.on_the_clock,
    mySlot: 5,
    currentPick: waitingSession.current_pick,
    lastPick: last,
    onSubmit: ok,
    onUndo: ok,
  },
} satisfies Meta<typeof PickEntry>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Submitting returns the API's 409, shown in a snackbar. Pick a player and press Record. */
export const AlreadyDrafted: Story = {
  args: {
    onSubmit: async () => {
      await new Promise((r) => setTimeout(r, 300));
      throw alreadyDrafted;
    },
  },
};
export const UndoFails: Story = {
  args: {
    onUndo: async () => {
      throw alreadyDrafted;
    },
  },
};
export const NoPicksYet: Story = { args: { lastPick: null, currentPick: 1, onTheClock: 1 } };
export const DraftComplete: Story = { args: { currentPick: null, onTheClock: null, players: [] } };
