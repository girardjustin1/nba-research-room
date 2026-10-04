import { useMemo } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { createDraftApi } from './api/client';
import { createSeasonApi } from './api/season';
import { createSystemApi } from './api/system';
import { useHashRoute } from './app/router';
import type { AppApis } from './app/types';
import { AppFrame } from './components/app-shell/AppFrame';
import { theme } from './theme/theme';

/**
 * The app: three experiences (Draft, League, System) behind a left drawer, routed by the URL
 * hash from the route manifest (src/app/routes.ts). Every number comes from the local API;
 * screens whose endpoint is not implemented yet show sample data marked "Prototype data".
 */
export function App() {
  const apis = useMemo<AppApis>(() => ({ draft: createDraftApi('/api'), season: createSeasonApi('/api'), system: createSystemApi('/api') }), []);
  const [hash, navigate] = useHashRoute();
  return (
    <ThemeProvider theme={theme} disableTransitionOnChange noSsr>
      <CssBaseline />
      <AppFrame path={hash} navigate={navigate} mode="live" apis={apis} />
    </ThemeProvider>
  );
}
