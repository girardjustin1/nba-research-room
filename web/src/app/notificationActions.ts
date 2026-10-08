import type { SeasonNotification } from '../api/season';

/** Where an alert's action goes in the app. */
export function actionPath(n: SeasonNotification): string {
  const a = n.action;
  if (!a) return n.player ? `#/league/players/profile?id=${n.player.player_id}` : '#/league/matchup';
  if (a.target === 'move') return '#/league/team/moves';
  if (a.target === 'lineup') return '#/league/team';
  if (a.target === 'pickups') return '#/league/team/pickups';
  if (a.target === 'player') return n.player ? `#/league/players/profile?id=${n.player.player_id}` : '#/league/players';
  return '#/league/matchup';
}
