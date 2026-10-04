import { useMemo } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { createDraftApi } from './api/client';
import { DraftRoom } from './components/DraftRoom';
import { theme } from './theme/theme';

/** The live draft room. Every number on screen comes from the local draft API. */
export function App() {
  const api = useMemo(() => createDraftApi('/api'), []);
  return (
    <ThemeProvider theme={theme} disableTransitionOnChange noSsr>
      <CssBaseline />
      <DraftRoom api={api} />
    </ThemeProvider>
  );
}
