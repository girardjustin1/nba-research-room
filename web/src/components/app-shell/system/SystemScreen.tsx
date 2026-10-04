import { useCallback } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import type { RouteScreenProps } from '../../../app/types';
import { useLiveOrMock } from '../../../app/useLiveOrMock';
import { SAFE_BOTTOM, SAFE_TOP } from '../../../lib/layout';
import { shortDateTime } from '../../../lib/time';
import { healthOk, modelsNormal, notesNormal } from '../../../mocks/app-shell/system';
import { useAppShell } from '../AppShellContext';
import { PrototypeDataChip } from '../PrototypeDataChip';
import { HealthView } from './HealthView';
import { ModelsView } from './ModelsView';
import { UpdatesView } from './UpdatesView';

export type SystemTab = 'health' | 'models' | 'notes';

const TABS: { value: SystemTab; label: string; path: string }[] = [
  { value: 'health', label: 'Health', path: '#/system/health' },
  { value: 'models', label: 'Models', path: '#/system/models' },
  { value: 'notes', label: 'Updates', path: '#/system/notes' },
];

const SUBTITLE: Record<SystemTab, string> = {
  health: 'Data freshness, jobs and the store',
  models: 'How each model scores against the baseline',
  notes: 'Updates, findings and recommendations from Claude',
};

/** One System tab's data: GET /system/{health|models|notes}, sample data only on 404. */
function useSystemData(tab: SystemTab, props: RouteScreenProps) {
  const { apis, mode } = props;
  const health = useLiveOrMock(useCallback(() => apis.system.health(), [apis]), healthOk, tab === 'health' ? mode : 'mock');
  const models = useLiveOrMock(useCallback(() => apis.system.models(), [apis]), modelsNormal, tab === 'models' ? mode : 'mock');
  const notes = useLiveOrMock(useCallback(() => apis.system.notes(), [apis]), notesNormal, tab === 'notes' ? mode : 'mock');
  return { health, models, notes };
}

/**
 * System: diagnostics and updates, with top tabs Health · Models · Updates. Each tab reads its
 * own endpoint; if one is not implemented (404) the sample data shows with a "Prototype data" chip.
 */
export function SystemScreen(props: RouteScreenProps & { tab: SystemTab }) {
  const { tab, navigate } = props;
  const shell = useAppShell();
  const { health, models, notes } = useSystemData(tab, props);
  const active = tab === 'health' ? health : tab === 'models' ? models : notes;
  const asOf = tab === 'health' ? health.data?.as_of : tab === 'models' ? models.data?.as_of : null;
  const endpoint = tab === 'health' ? 'GET /system/health' : tab === 'models' ? 'GET /system/models' : 'GET /system/notes';

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden', maxWidth: 640, mx: 'auto' }}>
      <Box component="header" sx={{ pt: SAFE_TOP, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, minHeight: 52 }}>
          {shell?.menuButton}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" component="h1" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
              System
            </Typography>
            <Typography variant="caption" component="p" noWrap sx={{ color: 'text.secondary' }}>
              {asOf ? `${SUBTITLE[tab]} · as of ${shortDateTime(asOf)}` : SUBTITLE[tab]}
            </Typography>
          </Box>
          {shell?.headerActions}
        </Stack>
        <Tabs
          value={tab}
          onChange={(_, v: SystemTab) => navigate(TABS.find((t) => t.value === v)?.path ?? '#/system/health')}
          variant="fullWidth"
          aria-label="System sections"
          sx={{ minHeight: 44, '& .MuiTab-root': { minHeight: 44, fontWeight: 700 } }}
        >
          {TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
      </Box>
      <Box component="main" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', px: 2, pt: 1.5, pb: `calc(${SAFE_BOTTOM} + 64px)` }}>
        {tab === 'health' && <HealthView health={health.data} loading={health.loading} error={health.error} onRetry={health.refresh} />}
        {tab === 'models' && <ModelsView models={models.data} loading={models.loading} error={models.error} onRetry={models.refresh} />}
        {tab === 'notes' && <UpdatesView notes={notes.data} loading={notes.loading} error={notes.error} onRetry={notes.refresh} />}
      </Box>
      <PrototypeDataChip endpoints={active.isMock ? [endpoint] : []} />
    </Box>
  );
}

export function SystemHealthScreen(props: RouteScreenProps) {
  return <SystemScreen {...props} tab="health" />;
}
export function SystemModelsScreen(props: RouteScreenProps) {
  return <SystemScreen {...props} tab="models" />;
}
export function SystemNotesScreen(props: RouteScreenProps) {
  return <SystemScreen {...props} tab="notes" />;
}
