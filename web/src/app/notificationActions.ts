import type { SeasonNotification } from '../api/season';

const CHANGED = 'notifications:changed';

/** Tell the frame's bell that read state changed (audit B09), so its count updates at once. */
export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** Listen for announceNotificationsChanged; returns the unsubscribe. */
export function onNotificationsChanged(cb: () => void): () => void {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

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
