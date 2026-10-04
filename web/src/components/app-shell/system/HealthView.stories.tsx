import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { healthEmpty, healthError, healthOk, healthWarn } from '../../../mocks/app-shell/system';
import { HealthView } from './HealthView';

const meta = {
  title: 'App Shell/System/Health',
  component: HealthView,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default', minHeight: '100dvh' }}><Story /></Box>],
  args: { health: healthOk, onRetry: () => {} },
} satisfies Meta<typeof HealthView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllOk: Story = {};
export const Warnings: Story = { args: { health: healthWarn } };
export const Errors: Story = { args: { health: healthError } };
export const Empty: Story = { args: { health: healthEmpty } };
export const Loading: Story = { args: { health: null, loading: true } };
export const ApiDown: Story = { args: { health: null, error: 'The draft API is not reachable' } };
export const RefreshFailed: Story = { args: { health: healthWarn, error: 'The draft API is not reachable' } };
