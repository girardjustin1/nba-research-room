import type { Meta, StoryObj } from '@storybook/react-vite';
import { waitingSession } from '../../../mocks/draft/fixtures';
import { feedLive, feedNeedsYou, withFeed } from '../../../mocks/draft/yahooFeed';
import { YahooFeedAlert } from './YahooFeedAlert';

const meta = {
  title: 'Draft/Status/Yahoo Feed Alert',
  component: YahooFeedAlert,
  args: { session: withFeed(waitingSession, feedNeedsYou) },
} satisfies Meta<typeof YahooFeedAlert>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A name Yahoo lists that matched no player, and a pick the log has with someone else. */
export const NeedsYou: Story = {};
export const OnlyUnmatched: Story = { args: { session: withFeed(waitingSession, { ...feedNeedsYou, conflicts: [] }) } };
/** Nothing to fix: nothing shows. */
export const AllClear: Story = { args: { session: withFeed(waitingSession, feedLive) } };
