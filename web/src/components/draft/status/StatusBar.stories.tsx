import type { Meta, StoryObj } from '@storybook/react-vite';
import { completeSession, onTheClockSession, waitingSession } from '../../../mocks/draft/fixtures';
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
