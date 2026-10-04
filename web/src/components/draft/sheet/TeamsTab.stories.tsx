import type { Meta, StoryObj } from '@storybook/react-vite';
import { CATEGORIES, makeInsights, makeSession, makeTeams } from '../../../mocks/draft/fixtures';
import { notFound } from '../../../mocks/draft/room';
import { TeamsTab } from './TeamsTab';

const session = makeSession({ mySlot: 5, currentPick: 30 });

const meta = {
  title: 'Draft/Sheet/Teams Tab',
  component: TeamsTab,
  decorators: [(Story) => <div style={{ paddingTop: 'var(--sim-safe-top)' }}><Story /></div>],
  args: {
    teams: makeTeams(session),
    categories: CATEGORIES,
    teamsCount: 14,
    currentPick: 30,
    myNextPick: 33,
    insights: makeInsights(session),
  },
} satisfies Meta<typeof TeamsTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Teams picking before my next pick are listed first and highlighted. */
export const Strategize: Story = {};
/** Opened from the latest-pick card: that team's details (notes + head-to-head chart) open. */
export const FocusedTeam: Story = { args: { focusTeamId: 2 } };
export const WithoutInsights: Story = { args: { insights: null } };
export const EndpointMissing: Story = { args: { teams: null, error: notFound } };
