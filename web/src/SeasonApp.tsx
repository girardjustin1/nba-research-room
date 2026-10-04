import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { SeasonShell, ScreenHeader, type SeasonTab } from './components/foundations/ScreenFrame';
import { EmptyState } from './components/foundations/ScreenStates';
import type { BuilderView } from './components/team-builder/BuilderTabs';
import { LineupLive } from './components/team-builder/LineupLive';
import { parseSeasonHash } from './seasonRoutes';

/**
 * In-season app, routed by the URL hash (no router dependency): #/season/<tab>[/<view>].
 * Live today: Team → Lineup (GET /season/lineup). Every other screen is designed in
 * Storybook with invented data and waits for its endpoint.
 */
const PENDING: Record<string, { title: string; endpoint: string }> = {
  matchup: { title: 'This week', endpoint: 'GET /season/week' },
  'builder/moves': { title: 'Moves', endpoint: 'GET /season/moves' },
  'builder/pickups': { title: 'Pickups', endpoint: 'GET /season/waivers' },
  research: { title: 'Research', endpoint: 'GET /season/feed' },
  results: { title: 'Results', endpoint: 'GET /season/results' },
  alerts: { title: 'Alerts', endpoint: 'GET /season/notifications' },
};

function go(tab: SeasonTab, view?: BuilderView) {
  window.location.hash = `#/season/${tab}${view ? `/${view}` : ''}`;
}

export function SeasonApp({ hash }: { hash: string }) {
  const { tab, view } = parseSeasonHash(hash);
  const onTab = (t: SeasonTab) => go(t, t === 'builder' ? 'lineup' : undefined);
  if (tab === 'builder' && view === 'lineup') return <LineupLive onTabChange={onTab} onBuilderView={(v) => go('builder', v)} />;
  const key = tab === 'builder' ? `builder/${view}` : tab;
  const p = PENDING[key] ?? { title: 'Season', endpoint: 'the season API' };
  return (
    <SeasonShell tab={tab} onTabChange={onTab} header={<ScreenHeader title={p.title} subtitle="Not live yet" />}>
      <Stack spacing={1.5}>
        <EmptyState title={`${p.title} is not live yet`}>
          This screen is designed in Storybook with invented data. It goes live when the engine serves {p.endpoint}. The Lineup (Team tab) is live now.
        </EmptyState>
        {tab === 'builder' && (
          <Button variant="contained" onClick={() => go('builder', 'lineup')}>
            Open the live lineup
          </Button>
        )}
        <Button variant="outlined" onClick={() => (window.location.hash = '#/')}>
          Back to the draft room
        </Button>
      </Stack>
    </SeasonShell>
  );
}
