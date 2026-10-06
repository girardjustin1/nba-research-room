import type { Experience } from './types';

export type LeagueTab = 'matchup' | 'team' | 'players' | 'teams' | 'results';

export const LEAGUE_TAB_PATH: Record<LeagueTab, string> = {
  matchup: '#/league/matchup',
  team: '#/league/team',
  players: '#/league/players',
  teams: '#/league/teams',
  results: '#/league/results',
};

export const EXPERIENCE_HOME: Record<Experience, string> = {
  draft: '#/draft',
  league: '#/league/matchup',
  system: '#/system/health',
};

export const EXPERIENCE_LABEL: Record<Experience, { title: string; subtitle: string }> = {
  draft: { title: 'Draft', subtitle: 'Live draft board and picks' },
  league: { title: 'League', subtitle: 'Play the season: matchup, lineup, players' },
  system: { title: 'System', subtitle: 'Health, draft readiness, model scores, live grades, updates' },
};

/** season-ui screens call onTabChange with their tab names; map them onto League routes. */
export const SEASON_TAB_PATH: Record<string, string> = {
  matchup: '#/league/matchup',
  builder: '#/league/team',
  research: '#/league/players',
  results: '#/league/results',
  alerts: '#/league/notifications',
};

const LAST_KEY = 'app:last-path';

export function rememberPath(path: string): void {
  try {
    window.localStorage.setItem(LAST_KEY, path);
    const exp = path.split('/')[1];
    if (exp) window.localStorage.setItem(`${LAST_KEY}:${exp}`, path);
  } catch {
    /* storage blocked: the app starts at the draft room */
  }
}

export function lastPath(experience?: Experience): string | null {
  try {
    return window.localStorage.getItem(experience ? `${LAST_KEY}:${experience}` : LAST_KEY);
  } catch {
    return null;
  }
}
