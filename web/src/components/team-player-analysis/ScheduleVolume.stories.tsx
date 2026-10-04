import type { Meta, StoryObj } from '@storybook/react-vite';
import { teamWeeks } from '../../mocks/team-profiles/schedule';
import { ScheduleVolume } from './ScheduleVolume';

/** League-wide games per fantasy week, colored for me. Invented counts in the shape of /schedule/team_weeks. */
const meta = {
  title: 'Team & Player Analysis/Schedule volume',
  component: ScheduleVolume,
  args: {
    data: teamWeeks,
    today: '2026-11-18',
    myTeams: ['CHA', 'SAC', 'MEM', 'UTA', 'OKC', 'ORL', 'POR', 'DET', 'IND', 'BKN', 'WAS', 'TOR', 'HOU'],
    opponentTeams: ['LAL', 'MIA', 'DEN'],
  },
} satisfies Meta<typeof ScheduleVolume>;

export default meta;
type Story = StoryObj<typeof meta>;

export const November: Story = {};
/** October holds week 1 (14 days, marked *). */
export const OctoberTwoWeekOpener: Story = { args: { initialWindow: '2026-10' } };
/** February holds week 17 (All-Star, 14 days). */
export const FebruaryAllStarWeek: Story = { args: { initialWindow: '2027-02' } };
export const PlayoffWeeks: Story = { args: { initialWindow: 'playoffs' } };
export const CellSheetOpen: Story = { args: { initialOpen: { team: 'OKC', week: 4 } } };
export const NoPerspective: Story = { args: { myTeams: [], opponentTeams: [] } };
export const Loading: Story = { args: { data: null, loading: true } };
export const ApiError: Story = { args: { data: null, error: 'Start the draft API: make draft-api', onRetry: () => {} } };
