import type { Meta, StoryObj } from '@storybook/react-vite';
import { SEASON_CATEGORIES } from '../../mocks/foundations/seasonCommon';
import { leagueTeamMe, leagueTeamOpponent, leagueTeamPastOpponent, leagueTeamStale } from '../../mocks/team-profiles/teams';
import { LeagueTeamProfileView } from './LeagueTeamProfileView';

/** A fantasy team in my league. Invented teams and players. */
const meta = {
  title: 'Team Profiles/League team',
  component: LeagueTeamProfileView,
  args: { team: leagueTeamOpponent, categories: SEASON_CATEGORIES, onBack: () => {}, onOpenPlayer: () => {} },
} satisfies Meta<typeof LeagueTeamProfileView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** This week's opponent: their strengths are red for you. */
export const ThisWeeksOpponent: Story = {};
export const MyTeam: Story = { args: { team: leagueTeamMe } };
export const PastOpponent: Story = { args: { team: leagueTeamPastOpponent } };
export const StaleData: Story = { args: { team: leagueTeamStale } };
export const Loading: Story = { args: { team: null, loading: true } };
export const ApiError: Story = { args: { team: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
