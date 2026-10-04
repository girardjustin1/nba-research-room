import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { CATEGORIES, onTheClockBoard, waitingBoard } from '../../../mocks/draft/fixtures';
import { RecommendationsList } from './RecommendationsList';

const meta = {
  title: 'Draft/Tools/Recommendations List',
  component: RecommendationsList,
  decorators: [(Story) => <Box sx={{ p: 2, pt: 'calc(var(--sim-safe-top) + 8px)', bgcolor: 'background.default' }}><Story /></Box>],
  args: {
    recommendations: onTheClockBoard.recommendations,
    mode: 'onTheClock',
    decisionPick: onTheClockBoard.decision_pick,
    followingPick: onTheClockBoard.following_pick,
    onTheClock: 5,
    onDraft: () => {},
    categories: CATEGORIES,
  },
} satisfies Meta<typeof RecommendationsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTheClock: Story = {};
/** Waiting: availability matters most; the button marks a player taken by the team on the clock. */
export const Waiting: Story = {
  args: {
    recommendations: waitingBoard.recommendations,
    mode: 'waiting',
    decisionPick: waitingBoard.decision_pick,
    followingPick: waitingBoard.following_pick,
    onTheClock: 2,
  },
};
export const Sending: Story = { args: { pendingId: onTheClockBoard.recommendations[0]?.player_id ?? null } };
export const Loading: Story = { args: { recommendations: [], loading: true } };
/** Refetching after a pick: previous cards stay, dimmed, no skeleton flash. */
export const Refreshing: Story = { args: { refreshing: true } };
export const ApiError: Story = { args: { error: 'Request failed (HTTP 500)', onRetry: () => {} } };
export const Empty: Story = { args: { recommendations: [] } };
/** Last pick of the draft: no following pick, so "Lasts to next" shows a dash. */
export const NoFollowingPick: Story = {
  args: {
    followingPick: null,
    recommendations: onTheClockBoard.recommendations.map((r) => ({ ...r, p_available_next: null })),
  },
};
