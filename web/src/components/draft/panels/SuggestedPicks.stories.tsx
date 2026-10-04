import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { onTheClockBoard } from '../../../mocks/draft/fixtures';
import { SuggestedPicks } from './SuggestedPicks';

const meta = {
  title: 'Draft/Panels/Suggested Picks',
  component: SuggestedPicks,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', width: 190 }}><Story /></Box>],
  args: { recommendations: onTheClockBoard.recommendations, onTheClock: true, onDraft: () => {} },
} satisfies Meta<typeof SuggestedPicks>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTheClock: Story = {};
/** Draft is disabled when someone else is on the clock. */
export const NotOnTheClock: Story = { args: { onTheClock: false } };
export const Sending: Story = { args: { pendingId: onTheClockBoard.recommendations[0]?.player_id ?? null } };
export const Loading: Story = { args: { recommendations: [], loading: true } };
