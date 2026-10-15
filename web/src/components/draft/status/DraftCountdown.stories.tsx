import type { Meta, StoryObj } from '@storybook/react-vite';
import { DraftCountdown } from './DraftCountdown';

/** The league's draft: Sun Oct 18, 7:00 pm ET. Each story fixes the clock before it. */
const STARTS = '2026-10-18T19:00:00-04:00';
const before = (ms: number) => () => new Date(STARTS).getTime() - ms;
const MIN = 60_000;

const meta = {
  title: 'Draft/Status/Draft Countdown',
  component: DraftCountdown,
  args: { startsAt: STARTS, now: before(((2 * 24 + 21) * 60 + 14) * MIN) },
} satisfies Meta<typeof DraftCountdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Days away: days, hours, minutes. */
export const DaysAway: Story = {};
/** Under a day: hours, minutes, seconds. */
export const HoursAway: Story = { args: { now: before((5 * 60 + 12) * MIN + 30_000) } };
/** The last 15 minutes: amber. */
export const StartingSoon: Story = { args: { now: before(9 * MIN + 41_000) } };
/** Started (or no start time from the API): nothing shows. */
export const Started: Story = { args: { now: () => new Date(STARTS).getTime() + MIN } };
