import type { Meta, StoryObj } from '@storybook/react-vite';
import { calendarBramwell, calendarRosswellInjury } from '../../mocks/player-profiles/calendar';
import {
  playerBramwell,
  playerBramwellPlayoff,
  playerBramwellPunt,
  playerBramwellStale,
  playerHargreaveLastDay,
  playerPellham,
  playerRosswell,
} from '../../mocks/player-profiles/player';
import { teamDaysNOP, teamWeeks } from '../../mocks/team-profiles/schedule';
import { PlayerProfile } from './PlayerProfile';

/** The player deep dive. Invented players and numbers. */
const meta = {
  title: 'Player Profiles/Deep dive',
  component: PlayerProfile,
  args: { analysis: playerBramwell, calendar: calendarBramwell, teamDays: teamDaysNOP, teamWeeks, onBack: () => {}, onCompare: () => {} },
} satisfies Meta<typeof PlayerProfile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A free agent the engine says to add. */
export const AddFreeAgent: Story = {};
export const StartRosteredPlayer: Story = { args: { analysis: playerPellham, teamDays: null } };
/** Questionable, minutes-capped, low confidence with missing inputs. */
export const InjuryLowConfidence: Story = { args: { analysis: playerRosswell, calendar: calendarRosswellInjury, teamDays: null } };
export const LastDayStream: Story = { args: { analysis: playerHargreaveLastDay, calendar: null, teamDays: null } };
export const PlayoffWeek: Story = { args: { analysis: playerBramwellPlayoff, calendar: null, teamDays: null } };
export const PuntBuild: Story = { args: { analysis: playerBramwellPunt } };
export const StaleData: Story = { args: { analysis: playerBramwellStale } };
export const Loading: Story = { args: { analysis: null, loading: true } };
export const ApiError: Story = { args: { analysis: null, error: 'Request failed (HTTP 404): unknown player', onRetry: () => {} } };
