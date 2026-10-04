import { useMemo } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { createDraftApi } from './api/client';
import { createDemoApis, createDemoTransport } from './api/demoTransport';
import { createSeasonApi } from './api/season';
import { createSystemApi } from './api/system';
import { useHashRoute } from './app/router';
import type { AppApis } from './app/types';
import { AppFrame } from './components/app-shell/AppFrame';
import { theme } from './theme/theme';

/** True in `pnpm build:demo` (vite --mode demo, VITE_DEMO=1): no network, shared sample data. */
const IS_DEMO = import.meta.env.VITE_DEMO === '1';

/**
 * The app: three experiences (Draft, League, System) behind a left drawer, routed by the URL
 * hash from the route manifest (src/app/routes.ts). Live: every number comes from the local
 * API, and screens whose endpoint is not implemented show sample data marked "Prototype data".
 * Demo: the demo transport answers every endpoint from the shared mocks, offline.
 */
export function App() {
  const demo = useMemo(() => (IS_DEMO ? createDemoTransport('/api') : null), []);
  const apis = useMemo<AppApis>(
    () => (demo ? createDemoApis(demo) : { draft: createDraftApi('/api'), season: createSeasonApi('/api'), system: createSystemApi('/api') }),
    [demo],
  );
  const [hash, navigate] = useHashRoute();
  const demoProps = useMemo(() => (demo ? { reset: () => demo.reset() } : undefined), [demo]);
  return (
    <ThemeProvider theme={theme} disableTransitionOnChange noSsr>
      <CssBaseline />
      <AppFrame path={hash} navigate={navigate} mode="live" apis={apis} demo={demoProps} />
    </ThemeProvider>
  );
}
