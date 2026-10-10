import type { Meta, StoryObj } from '@storybook/react-vite';
import { PrototypeApp } from './PrototypeApp';

/**
 * One full-screen story per route in src/app/routes.ts, rendering that route inside the real
 * app shell with the shared sample data. routes.sync.test.ts keeps this list and the manifest
 * identical: add a route there, add its story here.
 */
const meta = {
  title: 'Prototype',
  component: PrototypeApp,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PrototypeApp>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = (path: string): Story => ({ args: { path }, parameters: { route: path } });

export const Draft = at('#/draft');
export const LeagueMatchup = at('#/league/matchup');
export const LeagueTeamLineup = at('#/league/team');
export const LeagueTeamMoves = at('#/league/team/moves');
export const LeagueTeamRoster = at('#/league/team/roster');
export const LeagueTeamFreeAgents = at('#/league/team/free-agents');
export const LeagueTeamPickups = at('#/league/team/pickups');
export const LeaguePlayers = at('#/league/players');
export const LeaguePlayerProfile = at('#/league/players/profile');
export const LeaguePlayerCompare = at('#/league/players/compare');
export const LeagueSchedule = at('#/league/players/schedule');
export const LeagueTeams = at('#/league/teams');
export const LeagueTeamsOpponent = at('#/league/teams/opponent');
export const LeagueNbaTeam = at('#/league/teams/nba');
export const LeagueResults = at('#/league/results');
export const LeagueResultsReview = at('#/league/results/review');
export const LeagueNotifications = at('#/league/notifications');
export const SystemHealth = at('#/system/health');
export const SystemDraftReadiness = at('#/system/draft');
export const SystemModels = at('#/system/models');
export const SystemLive = at('#/system/live');
export const SystemUpdates = at('#/system/notes');
