import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { liveScoreboardEarly, liveScoreboardEmpty, liveScoreboardNormal } from '../../../mocks/app-shell/system';
import { LiveView } from './LiveView';

const meta = {
  title: 'App Shell/System/Live Scoreboard',
  component: LiveView,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default', minHeight: '100dvh' }}><Story /></Box>],
  args: { scoreboard: liveScoreboardNormal, onRetry: () => {} },
} satisfies Meta<typeof LiveView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mid-season: every section filled, the season so far. */
export const Season: Story = {};
/** The same, last 7 days. */
export const LastSevenDays: Story = { args: { initialWindow: 'last_7_days' } };
/** Opening week: a few days graded, no market games or finished weeks yet. */
export const OpeningWeek: Story = { args: { scoreboard: liveScoreboardEarly } };
/** Before opening night: nothing to grade. */
export const BeforeTheSeason: Story = { args: { scoreboard: liveScoreboardEmpty } };
export const Loading: Story = { args: { scoreboard: null, loading: true } };
export const ApiDown: Story = { args: { scoreboard: null, error: 'The draft API is not reachable' } };
/** A refresh failed: the last result stays, with a retry. */
export const RefreshFailed: Story = { args: { error: 'HTTP 500' } };
