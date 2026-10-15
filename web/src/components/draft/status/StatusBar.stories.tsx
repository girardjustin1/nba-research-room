import type { Meta, StoryObj } from '@storybook/react-vite';
import { completeSession, onTheClockSession, waitingSession } from '../../../mocks/draft/fixtures';
import { feedError, feedLive, feedWaiting, withFeed } from '../../../mocks/draft/yahooFeed';
import { StatusBar } from './StatusBar';

const meta = {
  title: 'Draft/Status/Status Bar',
  component: StatusBar,
  args: { session: waitingSession, decisionPick: 33, connection: 'up', lastPickSeenAt: Date.now() - 9000, onEnterPick: () => {}, onMenu: () => {} },
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpInPicks: Story = {};
export const OnTheClock: Story = { args: { session: onTheClockSession, decisionPick: 5 } };
export const WaitingForListener: Story = { args: { lastPickSeenAt: null } };
export const ApiDown: Story = { args: { connection: 'down' } };
export const Complete: Story = { args: { session: completeSession } };
/** Scrolled down in the room: one slim row. */
export const Collapsed: Story = { args: { compact: true } };
export const CollapsedOnTheClock: Story = { args: { session: onTheClockSession, decisionPick: 5, compact: true } };
/** Yahoo's own draft results backing up the listener: live, before the window, and not answering. */
export const YahooPicksLive: Story = { args: { session: withFeed(waitingSession, feedLive) } };
export const YahooPicksWaiting: Story = { args: { session: withFeed(waitingSession, feedWaiting) } };
export const YahooPicksNotAnswering: Story = { args: { session: withFeed(waitingSession, feedError) } };
/** A practice session (a Yahoo mock draft): labelled so it's never mistaken for the real draft. */
export const PracticeDraft: Story = { args: { session: { ...waitingSession, draft_id: 'practice-1015-2143' } } };
