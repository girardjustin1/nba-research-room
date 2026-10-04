import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { driftSession, mockPicks } from '../mocks/fixtures';
import { DraftLog } from './DraftLog';

const meta = {
  title: 'Draft/DraftLog',
  component: DraftLog,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default' }}><Story /></Box>],
  args: { picks: driftSession.picks, mySlot: 5 },
} satisfies Meta<typeof DraftLog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** My picks (team 5) are tinted and carry a "You" chip. */
export const MidDraft: Story = {};
export const Empty: Story = { args: { picks: [] } };
export const WithKeeper: Story = {
  args: { picks: mockPicks(20).map((p) => (p.pick_no === 3 ? { ...p, is_keeper: true } : p)) },
};
