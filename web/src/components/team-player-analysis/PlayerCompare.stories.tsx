import type { Meta, StoryObj } from '@storybook/react-vite';
import { STALE_AS_OF, STALE_REASON } from '../../mocks/matchup-analysis/week';
import { compareAddDrop, compareStartSit } from '../../mocks/team-player-analysis/compare';
import { PlayerCompare } from './PlayerCompare';

/** Start/sit and add/drop, side by side. Invented data. */
const meta = {
  title: 'Team & Player Analysis/Compare',
  component: PlayerCompare,
  args: { compare: compareStartSit, onBack: () => {} },
} satisfies Meta<typeof PlayerCompare>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StartSit: Story = {};
export const AddDrop: Story = { args: { compare: compareAddDrop } };
export const TooCloseToCall: Story = {
  args: { compare: { ...compareStartSit, verdict: { ...compareStartSit.verdict, choose: null, reason: 'The bands overlap almost entirely; either start is fine.' } } },
};
export const StaleData: Story = { args: { compare: { ...compareAddDrop, stale: true, stale_reason: STALE_REASON, as_of: STALE_AS_OF } } };
export const Loading: Story = { args: { compare: null, loading: true } };
export const ApiError: Story = { args: { compare: null, error: 'Request failed (HTTP 404): unknown player', onRetry: () => {} } };
