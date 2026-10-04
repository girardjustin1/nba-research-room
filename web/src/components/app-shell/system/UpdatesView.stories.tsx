import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { notesEmpty, notesNormal } from '../../../mocks/app-shell/system';
import { UpdatesView } from './UpdatesView';

const meta = {
  title: 'App Shell/System/Updates',
  component: UpdatesView,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default', minHeight: '100dvh' }}><Story /></Box>],
  args: { notes: notesNormal, onRetry: () => {} },
} satisfies Meta<typeof UpdatesView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One of each kind; only the warning uses a status color. A "<script>" in a body shows as text. */
export const AllKinds: Story = {};
export const Empty: Story = { args: { notes: notesEmpty } };
export const Loading: Story = { args: { notes: null, loading: true } };
export const ApiDown: Story = { args: { notes: null, error: 'The draft API is not reachable' } };
