import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { driftSession, makePool, makeSession, onTheClockSession } from '../mocks/fixtures';
import { TierBoard } from './TierBoard';

const meta = {
  title: 'Draft/TierBoard',
  component: TierBoard,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default' }}><Story /></Box>],
  args: { players: makePool(onTheClockSession) },
} satisfies Meta<typeof TierBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EarlyDraft: Story = {};
/** Drafted players are gone; only the later tiers remain. */
export const LateDraft: Story = { args: { players: makePool(driftSession) } };
/** A drafted player passed in by mistake is still filtered out. */
export const IncludesDraftedFlag: Story = {
  args: { players: makePool(onTheClockSession).map((p, i) => ({ ...p, drafted: i % 2 === 0 })) },
};
export const NothingLeft: Story = { args: { players: makePool(makeSession({ currentPick: 81 })) } };
