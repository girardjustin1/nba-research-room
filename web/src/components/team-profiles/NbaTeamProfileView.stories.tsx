import type { Meta, StoryObj } from '@storybook/react-vite';
import { teamWeeks } from '../../mocks/team-profiles/schedule';
import { nbaTeamNOP, nbaTeamNoContext, nbaTeamOppPlayer, nbaTeamWithMyPlayer } from '../../mocks/team-profiles/teams';
import { NbaTeamProfileView } from './NbaTeamProfileView';

/** An NBA team's schedule volume and context. Invented counts in the shape of /schedule/*. */
const meta = {
  title: 'Team Profiles/NBA team',
  component: NbaTeamProfileView,
  args: { team: nbaTeamNOP, weeks: teamWeeks, today: '2026-11-18', onBack: () => {}, onOpenPlayer: () => {} },
} satisfies Meta<typeof NbaTeamProfileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StreamingTarget: Story = {};
export const WithMyPlayer: Story = { args: { team: nbaTeamWithMyPlayer } };
export const WithOpponentsPlayer: Story = { args: { team: nbaTeamOppPlayer } };
/** No pace/defense yet: shown missing with lowered confidence, not as a neutral default. */
export const MissingContext: Story = { args: { team: nbaTeamNoContext } };
export const Loading: Story = { args: { team: null, loading: true } };
export const ApiError: Story = { args: { team: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
