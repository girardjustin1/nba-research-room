import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { useMemoryRoute } from '../../app/router';
import { createMockApis } from '../../mocks/app-shell/apis';
import { AppFrame } from './AppFrame';

function Frame({ path, drawerOpen }: { path: string; drawerOpen: boolean }) {
  const apis = useMemo(() => createMockApis(), []);
  const [current, navigate] = useMemoryRoute(path);
  return <AppFrame path={current} navigate={navigate} mode="mock" apis={apis} initialDrawerOpen={drawerOpen} />;
}

/** The left drawer that separates Draft, League and System (swipe from the left edge or tap ☰). */
const meta = {
  title: 'App Shell/Navigation',
  component: AppFrame,
  render: (args) => <Frame path={args.path} drawerOpen={args.initialDrawerOpen ?? false} />,
  args: { path: '#/draft', navigate: () => {}, mode: 'mock', apis: createMockApis(), initialDrawerOpen: true },
} satisfies Meta<typeof AppFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DraftDrawerOpen: Story = {};
export const DraftDrawerClosed: Story = { args: { initialDrawerOpen: false } };
export const LeagueDrawerOpen: Story = { args: { path: '#/league/matchup' } };
export const LeagueDrawerClosed: Story = { args: { path: '#/league/matchup', initialDrawerOpen: false } };
export const SystemDrawerOpen: Story = { args: { path: '#/system/health' } };
export const SystemDrawerClosed: Story = { args: { path: '#/system/health', initialDrawerOpen: false } };
/** An old #/season/... link lands on the matching League route. */
export const LegacySeasonLink: Story = { args: { path: '#/season/builder/lineup', initialDrawerOpen: false } };
