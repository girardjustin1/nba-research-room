import type { Meta, StoryObj } from '@storybook/react-vite';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { FullScreenPanel } from './FullScreenPanel';

const meta = {
  title: 'App Shell/Full Screen Panel',
  component: FullScreenPanel,
  args: { open: true, title: 'Panel title', onClose: () => {}, children: <Typography sx={{ p: 2 }}>Panel content scrolls here.</Typography> },
} satisfies Meta<typeof FullScreenPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithFooter: Story = { args: { footer: <Button variant="contained" size="large" fullWidth>Save</Button> } };
