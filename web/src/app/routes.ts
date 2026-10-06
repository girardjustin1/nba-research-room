import { createElement, type ComponentType, type ReactElement } from 'react';
import type { LeagueTab } from './experiences';
import type { Experience, RouteScreenProps } from './types';
import { DraftScreen } from '../components/draft/room/DraftScreen';
import { LeagueCompareScreen } from '../components/app-shell/league/LeagueCompareScreen';
import { LeagueLineupScreen } from '../components/app-shell/league/LeagueLineupScreen';
import { LeagueMatchupScreen } from '../components/app-shell/league/LeagueMatchupScreen';
import { LeagueMovesScreen } from '../components/app-shell/league/LeagueMovesScreen';
import { LeagueNbaTeamScreen } from '../components/app-shell/league/LeagueNbaTeamScreen';
import { LeagueNotificationsScreen } from '../components/app-shell/league/LeagueNotificationsScreen';
import { LeaguePickupsScreen } from '../components/app-shell/league/LeaguePickupsScreen';
import { LeaguePlayerProfileScreen } from '../components/app-shell/league/LeaguePlayerProfileScreen';
import { LeaguePlayersScreen } from '../components/app-shell/league/LeaguePlayersScreen';
import { LeagueResultsScreen } from '../components/app-shell/league/LeagueResultsScreen';
import { LeagueReviewScreen } from '../components/app-shell/league/LeagueReviewScreen';
import { LeagueScheduleScreen } from '../components/app-shell/league/LeagueScheduleScreen';
import { LeagueTeamsScreen } from '../components/app-shell/league/LeagueTeamsScreen';
import { SystemScreen, type SystemTab } from '../components/app-shell/system/SystemScreen';

/**
 * THE route manifest. The app router renders only from this list, and the Prototype stories
 * mirror it one-to-one (routes.sync.test.ts fails the build when they drift apart).
 */
export interface AppRoute {
  path: string;
  experience: Experience;
  title: string;
  /** The screen component (it must have its own .stories.tsx: checked by the sync test). */
  component: ComponentType<never>;
  /** Renders the screen with the frame's props (plus any fixed props such as a tab). */
  render: (props: RouteScreenProps) => ReactElement;
  /** Full-screen Storybook story for this route, under "Prototype". */
  storyId: string;
  /** Which League bottom tab is selected on this route. */
  leagueTab?: LeagueTab | null;
}

function route<P extends object>(
  r: Omit<AppRoute, 'component' | 'render'> & { component: ComponentType<RouteScreenProps & P>; props?: P },
): AppRoute {
  const { component, props, ...rest } = r;
  return {
    ...rest,
    component: component as ComponentType<never>,
    render: (rp) => createElement(component, { ...rp, ...(props as P) }),
  };
}

const sys = (tab: SystemTab, path: string, title: string, storyId: string) =>
  route<{ tab: SystemTab }>({ path, experience: 'system', title, component: SystemScreen, props: { tab }, storyId });

export const ROUTES: AppRoute[] = [
  route({ path: '#/draft', experience: 'draft', title: 'Draft room', component: DraftScreen, storyId: 'prototype--draft' }),
  route({ path: '#/league/matchup', experience: 'league', title: 'Matchup', component: LeagueMatchupScreen, storyId: 'prototype--league-matchup', leagueTab: 'matchup' }),
  route({ path: '#/league/team', experience: 'league', title: 'Team · Lineup', component: LeagueLineupScreen, storyId: 'prototype--league-team-lineup', leagueTab: 'team' }),
  route({ path: '#/league/team/moves', experience: 'league', title: 'Team · Moves', component: LeagueMovesScreen, storyId: 'prototype--league-team-moves', leagueTab: 'team' }),
  route({ path: '#/league/team/pickups', experience: 'league', title: 'Team · Pickups', component: LeaguePickupsScreen, storyId: 'prototype--league-team-pickups', leagueTab: 'team' }),
  route({ path: '#/league/players', experience: 'league', title: 'Players · Research', component: LeaguePlayersScreen, storyId: 'prototype--league-players', leagueTab: 'players' }),
  route({ path: '#/league/players/profile', experience: 'league', title: 'Players · Deep dive', component: LeaguePlayerProfileScreen, storyId: 'prototype--league-player-profile', leagueTab: 'players' }),
  route({ path: '#/league/players/compare', experience: 'league', title: 'Players · Compare', component: LeagueCompareScreen, storyId: 'prototype--league-player-compare', leagueTab: 'players' }),
  route({ path: '#/league/players/schedule', experience: 'league', title: 'Players · Schedule volume', component: LeagueScheduleScreen, storyId: 'prototype--league-schedule', leagueTab: 'players' }),
  route({ path: '#/league/teams', experience: 'league', title: 'Teams · League team', component: LeagueTeamsScreen, storyId: 'prototype--league-teams', leagueTab: 'teams' }),
  route({ path: '#/league/teams/nba', experience: 'league', title: 'Teams · NBA team', component: LeagueNbaTeamScreen, storyId: 'prototype--league-nba-team', leagueTab: 'teams' }),
  route({ path: '#/league/results', experience: 'league', title: 'Results', component: LeagueResultsScreen, storyId: 'prototype--league-results', leagueTab: 'results' }),
  route({ path: '#/league/results/review', experience: 'league', title: 'Results · Prediction review', component: LeagueReviewScreen, storyId: 'prototype--league-results-review', leagueTab: 'results' }),
  route({ path: '#/league/notifications', experience: 'league', title: 'Notifications', component: LeagueNotificationsScreen, storyId: 'prototype--league-notifications', leagueTab: null }),
  sys('health', '#/system/health', 'Health checks', 'prototype--system-health'),
  sys('draft', '#/system/draft', 'Draft readiness', 'prototype--system-draft-readiness'),
  sys('models', '#/system/models', 'Model performance', 'prototype--system-models'),
  sys('live', '#/system/live', 'Live scoreboard', 'prototype--system-live'),
  sys('notes', '#/system/notes', 'Updates from Claude', 'prototype--system-updates'),
];

export function findRoute(path: string): AppRoute | undefined {
  const base = path.split('?')[0];
  return ROUTES.find((r) => r.path === base);
}

export function routesFor(experience: Experience): AppRoute[] {
  return ROUTES.filter((r) => r.experience === experience);
}

