import type { Category, Session } from '../api/types';

/** My next picks at or after the current pick, straight from the API's my_picks list. */
export function upcomingPicks(session: Session, count = 2): number[] {
  const current = session.current_pick;
  if (current == null) return [];
  return session.my_picks.filter((p) => p >= current).slice(0, count);
}

/** Used before a session exists (no categories from the API yet); matches config/settings.yaml. */
export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'fg_pct', label: 'FG%' },
  { key: 'ft_pct', label: 'FT%' },
  { key: 'fg3m', label: '3PTM' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'ST' },
  { key: 'blk', label: 'BLK' },
  { key: 'tov', label: 'TO' },
];
