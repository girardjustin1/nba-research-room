import type { Meta, StoryObj } from '@storybook/react-vite';
import { SEASON_CATEGORIES } from '../../mocks/foundations/seasonCommon';
import {
  feedEmpty,
  feedIdle,
  feedInjury,
  feedLastDay,
  feedNightlyRunning,
  feedNormal,
  feedPlayoff,
  feedPunt,
  feedStale,
} from '../../mocks/team-player-analysis/feed';
import { ResearchFeed } from './ResearchFeed';

/** The engine's background work and its impact on my week. Invented items. */
const meta = {
  title: 'Team & Player Analysis/Research feed',
  component: ResearchFeed,
  args: { feed: feedNormal, categories: SEASON_CATEGORIES, onOpenMove: () => {}, onOpenPlayer: () => {} },
} satisfies Meta<typeof ResearchFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};
export const NewsOnly: Story = { args: { initialFilter: 'news' } };
export const MarketsOnly: Story = { args: { initialFilter: 'market' } };
export const ModelsOnly: Story = { args: { initialFilter: 'model' } };
export const DataOnly: Story = { args: { initialFilter: 'data' } };
export const InjuryBreakingNews: Story = { args: { feed: feedInjury } };
export const JobsExpanded: Story = { args: { initialJobsOpen: true } };
export const NightlyRunning: Story = { args: { feed: feedNightlyRunning } };
export const NothingRunning: Story = { args: { feed: feedIdle } };
export const StaleSyncFailing: Story = { args: { feed: feedStale, initialJobsOpen: true } };
export const LastDayOfWeek: Story = { args: { feed: feedLastDay } };
export const PlayoffWeek: Story = { args: { feed: feedPlayoff } };
export const PuntBuild: Story = { args: { feed: feedPunt } };
export const Empty: Story = { args: { feed: feedEmpty } };
export const Loading: Story = { args: { feed: null, loading: true } };
export const ApiError: Story = { args: { feed: null, error: 'The season API is not reachable', onRetry: () => {} } };
