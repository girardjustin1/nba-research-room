import type { NotificationKind, SeasonNotification } from '../../api/season';

/** Inbox filtering and ordering (display only). */

export type InboxFilter = 'all' | 'unread' | 'waiver' | 'injury' | 'lineup_lock' | 'game_day';

export const FILTERS: { key: InboxFilter; label: string; kinds?: NotificationKind[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'waiver', label: 'Waivers', kinds: ['waiver'] },
  { key: 'injury', label: 'Injuries & news', kinds: ['injury', 'news'] },
  { key: 'lineup_lock', label: 'Lineup locks', kinds: ['lineup_lock'] },
  { key: 'game_day', label: 'Game day', kinds: ['game_day', 'model'] },
];

const RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

export function filterInbox(items: SeasonNotification[], filter: InboxFilter): SeasonNotification[] {
  const f = FILTERS.find((x) => x.key === filter);
  return items
    .filter((n) => (filter === 'unread' ? !n.read : f?.kinds ? f.kinds.includes(n.kind) : true))
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || Date.parse(b.created_at) - Date.parse(a.created_at));
}

