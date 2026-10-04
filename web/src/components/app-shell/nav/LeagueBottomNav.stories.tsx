import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { LeagueBottomNav } from './LeagueBottomNav';

const meta = {
  title: 'App Shell/Navigation/League Bottom Nav',
  component: LeagueBottomNav,
  decorators: [(Story) => <Box sx={{ position: 'fixed', bottom: 0, left: 0, right: 0 }}><Paper square sx={{ borderTop: 1, borderColor: 'divider', pb: 'var(--sim-safe-bottom)' }}><Story /></Paper></Box>],
  args: { value: 'matchup', onChange: () => {} },
} satisfies Meta<typeof LeagueBottomNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Matchup: Story = {};
export const Team: Story = { args: { value: 'team' } };
/** Notifications open: no tab selected. */
export const NoneSelected: Story = { args: { value: null } };
