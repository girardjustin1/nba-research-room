import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from '@mui/material/Card';
import { teamDaysNOP, teamWeeks } from '../../mocks/team-profiles/schedule';
import { MonthAhead } from './MonthAhead';

/** His team's next ~30 days of game days. Invented schedule in the shape of /schedule/team_days. */
const meta = {
  title: 'Player Profiles/Month ahead',
  component: MonthAhead,
  decorators: [
    (Story) => (
      <Card sx={{ m: 2, mt: 'calc(var(--sim-safe-top) + 8px)', p: 1.5 }}>
        <Story />
      </Card>
    ),
  ],
  args: { days: teamDaysNOP, weeks: teamWeeks, today: '2026-11-18' },
} satisfies Meta<typeof MonthAhead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MyPlayer: Story = {};
/** The same schedule for an opponent's player: his game days are red. */
export const OpponentsPlayer: Story = { args: { perspective: 'opponent' } };
export const DaySheetOpen: Story = { args: { openDate: '2026-11-22' } };
export const DarkMode: Story = { globals: { colorMode: 'dark' } };
