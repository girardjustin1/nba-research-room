import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { readinessError, readinessReady, readinessWarn } from '../../../mocks/app-shell/system';
import { ReadinessView } from './ReadinessView';

const meta = {
  title: 'App Shell/System/Draft Readiness',
  component: ReadinessView,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default', minHeight: '100dvh' }}><Story /></Box>],
  args: { readiness: readinessWarn, onRetry: () => {} },
} satisfies Meta<typeof ReadinessView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two days out: works, with open items (Yahoo eligibility, week boundaries, listener). */
export const OpenItems: Story = {};
/** Draft night with everything confirmed. */
export const Ready: Story = { args: { readiness: readinessReady } };
/** An unmatched keeper: the session would refuse to start. */
export const MustFix: Story = { args: { readiness: readinessError } };
export const Loading: Story = { args: { readiness: null, loading: true } };
export const ApiDown: Story = { args: { readiness: null, error: 'The draft API is not reachable' } };
