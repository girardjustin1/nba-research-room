import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { DemoBadge } from './DemoBadge';

/** The demo build's app-bar badge (pnpm build:demo). Tap it for what demo mode is. */
const meta = {
  title: 'App Shell/Demo Badge',
  component: DemoBadge,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', display: 'flex', gap: 1 }}><Story /></Box>],
  args: { onReset: () => {} },
} satisfies Meta<typeof DemoBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {};
/** League headers are crowded: the short form. */
export const Compact: Story = { args: { compact: true } };
