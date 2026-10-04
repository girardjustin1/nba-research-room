import type { Meta, StoryObj } from '@storybook/react-vite';
import { SEASON_CATEGORIES, TODAY } from '../../mocks/foundations/seasonCommon';
import { notificationsAllRead, notificationsEmpty, notificationsNormal, notificationsStale } from '../../mocks/notifications/notifications';
import { NotificationsInbox } from './NotificationsInbox';

/** The alerts inbox. Invented notifications. */
const meta = {
  title: 'Notifications/Inbox',
  component: NotificationsInbox,
  args: { data: notificationsNormal, today: TODAY, categories: SEASON_CATEGORIES, onAction: () => {}, onMarkAllRead: () => {} },
} satisfies Meta<typeof NotificationsInbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const UnreadOnly: Story = { args: { initialFilter: 'unread' } };
export const Waivers: Story = { args: { initialFilter: 'waiver' } };
export const InjuriesAndNews: Story = { args: { initialFilter: 'injury' } };
export const AllCaughtUp: Story = { args: { data: notificationsAllRead, initialFilter: 'unread' } };
export const Empty: Story = { args: { data: notificationsEmpty } };
export const StaleData: Story = { args: { data: notificationsStale } };
export const Loading: Story = { args: { data: null, loading: true } };
export const ApiError: Story = { args: { data: null, error: 'Request failed (HTTP 500)', onRetry: () => {} } };
