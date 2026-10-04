import type { Meta, StoryObj } from '@storybook/react-vite';
import { completeSession, makeSession, onTheClockSession, waitingSession } from '../mocks/fixtures';
import { DraftHeader } from './DraftHeader';

/** A clock source whose first reading is `secondsAgo` in the past, so the clock mounts part-way through. */
function startedAgo(secondsAgo: number) {
  const t0 = Date.now() - secondsAgo * 1000;
  let first = true;
  return () => {
    if (first) {
      first = false;
      return t0;
    }
    return Date.now();
  };
}

const meta = {
  title: 'Draft/DraftHeader',
  component: DraftHeader,
  args: { session: onTheClockSession },
} satisfies Meta<typeof DraftHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Solid primary bar, alarm icon and the words "You're on the clock". */
export const OnTheClock: Story = {};
export const Waiting: Story = { args: { session: waitingSession, decisionPick: 33 } };
/** Under 10 seconds: the clock gets the error status color plus a timer icon and "hurry". */
export const LowTimeWaiting: Story = { args: { session: waitingSession, decisionPick: 33, now: startedAgo(53) } };
export const LowTimeOnTheClock: Story = { args: { now: startedAgo(54) } };
export const NoSlot: Story = { args: { session: makeSession({ mySlot: null, currentPick: 12 }) } };
export const LastRound: Story = { args: { session: makeSession({ mySlot: 5, currentPick: 178 }) } };
export const Complete: Story = { args: { session: completeSession } };
