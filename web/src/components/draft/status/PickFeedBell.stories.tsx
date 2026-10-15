import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@mui/material/Box';
import { makeInsights, makeSession } from '../../../mocks/draft/fixtures';
import { PickFeedBell } from './PickFeedBell';

const session = makeSession({ mySlot: 5, currentPick: 30 });
const insights = makeInsights(session);
const newest = insights[insights.length - 1]?.pick_no ?? 0;

const meta = {
  title: 'Draft/Status/Pick Feed Bell',
  component: PickFeedBell,
  args: { insights, teams: session.teams, seenPick: newest - 3, onSeen: () => {}, onOpenTeam: () => {} },
  decorators: [(Story) => <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 2, bgcolor: '#256abf', color: '#fff' }}><Story /></Box>],
} satisfies Meta<typeof PickFeedBell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three picks not looked at yet. */
export const NewPicks: Story = {};
/** Everything seen. */
export const AllSeen: Story = { args: { seenPick: newest } };
/** Open: the newest picks first, each with that team's needs, strengths and my odds against them. */
export const Open: Story = { args: { defaultOpen: true } };
/** Before the first pick. */
export const NoPicksYet: Story = { args: { insights: [], seenPick: 0, defaultOpen: true } };
