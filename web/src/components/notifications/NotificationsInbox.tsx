import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { NotificationsResponse, SeasonCategory, SeasonNotification } from '../../api/season';
import { SeasonShell, ScreenHeader, type SeasonTab } from '../foundations/ScreenFrame';
import { EmptyState, ErrorState, LoadingState, StaleBanner } from '../foundations/ScreenStates';
import { etDate } from '../foundations/seasonFormat';
import { AlertCard } from './AlertCard';
import { FILTERS, filterInbox, type InboxFilter } from './inboxFilter';

export interface NotificationsInboxProps {
  data: NotificationsResponse | null;
  today: string;
  categories: SeasonCategory[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onAction?: (n: SeasonNotification) => void;
  onMarkAllRead?: () => void;
  onTabChange?: (tab: SeasonTab) => void;
  initialFilter?: InboxFilter;
}

/**
 * Notifications inbox: waiver opportunities and claim status, injury/news alerts that change
 * my week, lineup-lock reminders and game-day notes. Sorted by priority, then newest; split
 * into Today and Earlier. Priority is a status color + icon + word on each card.
 */
export function NotificationsInbox({ data, today, categories, loading, error, onRetry, onAction, onMarkAllRead, onTabChange, initialFilter = 'all' }: NotificationsInboxProps) {
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const shown = useMemo(() => (data ? filterInbox(data.items, filter) : []), [data, filter]);
  const header = <ScreenHeader title="Alerts" subtitle={data ? `${data.unread} unread` : undefined} asOf={data?.as_of} stale={data?.stale} />;
  let body;
  if (error && !data) body = <ErrorState message={error} onRetry={onRetry} what="alerts" />;
  else if (!data) body = <LoadingState blocks={[44, 180, 180, 140]} label={loading ? 'Loading alerts' : 'Loading'} />;
  else {
    const todays = shown.filter((n) => etDate(n.created_at) === today);
    const earlier = shown.filter((n) => etDate(n.created_at) !== today);
    const group = (title: string, list: SeasonNotification[]) =>
      list.length > 0 && (
        <Box>
          <Typography variant="overline" component="h2" sx={{ color: 'text.secondary' }}>
            {title}
          </Typography>
          <Stack component="ol" spacing={1.25} sx={{ m: 0, p: 0 }}>
            {list.map((n) => (
              <AlertCard key={n.id} n={n} today={today} now={data.as_of} categories={categories} onAction={onAction} />
            ))}
          </Stack>
        </Box>
      );
    body = (
      <Stack spacing={1.5}>
        {data.stale && <StaleBanner reason={data.stale_reason} asOf={data.as_of} />}
        <Box role="group" aria-label="Filter alerts" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.key === 'unread' ? `Unread ${data.unread}` : f.label}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              color={filter === f.key ? 'primary' : 'default'}
              variant={filter === f.key ? 'filled' : 'outlined'}
              sx={{ height: 40, borderRadius: 20 }}
            />
          ))}
        </Box>
        {data.unread > 0 && onMarkAllRead && (
          <Button onClick={onMarkAllRead} sx={{ alignSelf: 'flex-start' }}>
            Mark all as read
          </Button>
        )}
        {data.items.length === 0 ? (
          <EmptyState title="No alerts">Nothing needs you right now. Injury news, waiver chances and lineup locks show up here.</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title={filter === 'unread' ? 'All caught up' : 'Nothing in this filter'} />
        ) : (
          <>
            {group('Today', todays)}
            {group('Earlier', earlier)}
          </>
        )}
      </Stack>
    );
  }
  return (
    <SeasonShell tab="alerts" onTabChange={onTabChange} header={header} alerts={data?.unread}>
      {body}
    </SeasonShell>
  );
}
