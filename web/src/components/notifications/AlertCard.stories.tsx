import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';
import { AS_OF } from '../../mocks/foundations/seasonPlayers';
import { SEASON_CATEGORIES, TODAY } from '../../mocks/foundations/seasonCommon';
import { N_CLAIM, N_CLAIM_CLEARED, N_CLAIM_LOST, N_GAMEDAY, N_INJURY, N_LOCK, N_MODEL, N_NEWS_ROSSWELL, N_WAIVER_OPP } from '../../mocks/notifications/notifications';
import { AlertCard } from './AlertCard';

/** Individual alerts, one per kind and priority. Invented data. */
const meta = {
  title: 'Notifications/Alert cards',
  component: AlertCard,
  decorators: [
    (Story) => (
      <Stack component="ol" sx={{ m: 0, p: 2, pt: 'calc(var(--sim-safe-top) + 8px)' }}>
        <Story />
      </Stack>
    ),
  ],
  args: { n: N_INJURY, today: TODAY, now: AS_OF, categories: SEASON_CATEGORIES, onAction: () => {} },
} satisfies Meta<typeof AlertCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UrgentInjury: Story = {};
export const LineupLockReminder: Story = { args: { n: N_LOCK } };
export const WaiverOpportunity: Story = { args: { n: N_WAIVER_OPP } };
export const ClaimPending: Story = { args: { n: N_CLAIM } };
export const ClaimCleared: Story = { args: { n: N_CLAIM_CLEARED, now: '2026-11-20T07:00:00-05:00', today: '2026-11-20' } };
export const ClaimLost: Story = { args: { n: N_CLAIM_LOST } };
export const NewsLowConfidence: Story = { args: { n: N_NEWS_ROSSWELL } };
export const GameDay: Story = { args: { n: N_GAMEDAY } };
export const ModelUpdate: Story = { args: { n: N_MODEL } };
