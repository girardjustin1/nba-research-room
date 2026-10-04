import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { EXPERIENCE_HOME, LEAGUE_TAB_PATH, lastPath, rememberPath } from '../../app/experiences';
import { normalizePath } from '../../app/router';
import { findRoute, routesFor } from '../../app/routes';
import type { AppApis, Experience } from '../../app/types';
import type { DataMode } from '../../app/useLiveOrMock';
import { SAFE_TOP } from '../../lib/layout';
import { Adopted } from './Adopted';
import { AppShellContext, ShellAdoptionContext, type AppShellValue, type ShellPart } from './AppShellContext';
import { ExperienceDrawer, type ApiState } from './nav/ExperienceDrawer';
import { LeagueBottomNav } from './nav/LeagueBottomNav';
import { BellButton, MenuButton } from './nav/ShellButtons';
import { PrototypeDataChip } from './PrototypeDataChip';

export interface AppFrameProps {
  /** Current hash path, e.g. "#/league/matchup?x=1". */
  path: string;
  navigate: (path: string) => void;
  mode: DataMode;
  apis: AppApis;
  /** Storybook: open the drawer on first render. */
  initialDrawerOpen?: boolean;
}

/** Poll the API health in live mode so the drawer can say whether the engine is up. */
function useApiState(mode: DataMode, apis: AppApis): ApiState {
  const [state, setState] = useState<ApiState>(mode === 'mock' ? 'mock' : 'checking');
  useEffect(() => {
    if (mode === 'mock') return;
    let live = true;
    const check = () =>
      apis.draft.health().then(
        () => live && setState('up'),
        () => live && setState('down'),
      );
    void check();
    const id = setInterval(check, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [mode, apis]);
  return state;
}

/**
 * The app frame for all three experiences: resolves the route from the manifest, owns the
 * left experience drawer, and hands each screen its shell parts (☰, header actions, bottom
 * tabs) through AppShellContext. Screens render those parts in their own headers; a safety
 * ☰ floats top-left only if a screen did not render the menu button.
 */
export function AppFrame({ path, navigate, mode, apis, initialDrawerOpen = false }: AppFrameProps) {
  const normalized = normalizePath(path || '');
  const route = findRoute(normalized);
  const [drawer, setDrawer] = useState(initialDrawerOpen);
  const [adopted, setAdopted] = useState<Record<ShellPart, number>>({ menu: 0, actions: 0, nav: 0 });
  const apiState = useApiState(mode, apis);

  // Unknown or empty path: resume the last place, else the draft room.
  useEffect(() => {
    if (!route) navigate(lastPath() ?? EXPERIENCE_HOME.draft);
  }, [route, navigate]);
  useEffect(() => {
    if (route && mode === 'live') rememberPath(normalized);
  }, [route, normalized, mode]);

  const adopt = useCallback((part: ShellPart) => {
    setAdopted((a) => ({ ...a, [part]: a[part] + 1 }));
    return () => setAdopted((a) => ({ ...a, [part]: a[part] - 1 }));
  }, []);

  const experience: Experience = route?.experience ?? 'draft';
  const query = useMemo(() => new URLSearchParams(normalized.split('?')[1] ?? ''), [normalized]);
  const openDrawer = useCallback(() => setDrawer(true), []);

  const shell = useMemo<AppShellValue>(() => {
    const menuButton = (
      <Adopted part="menu">
        <MenuButton onClick={openDrawer} />
      </Adopted>
    );
    if (experience !== 'league') return { menuButton, headerActions: null, bottomNav: null };
    return {
      menuButton,
      headerActions: (
        <Adopted part="actions">
          <BellButton onClick={() => navigate('#/league/notifications')} />
        </Adopted>
      ),
      bottomNav: (
        <Adopted part="nav">
          <LeagueBottomNav value={route?.leagueTab ?? null} onChange={(t) => navigate(LEAGUE_TAB_PATH[t])} />
        </Adopted>
      ),
    };
  }, [experience, openDrawer, navigate, route?.leagueTab]);

  if (!route) return null;

  return (
    <ShellAdoptionContext.Provider value={adopt}>
      <AppShellContext.Provider value={shell}>
        <Box key={route.path} sx={{ position: 'relative', minHeight: '100dvh' }}>
          {route.render({ mode, apis, navigate, query })}
        </Box>
        {adopted.menu === 0 && (
          <Paper elevation={3} sx={{ position: 'fixed', top: `calc(${SAFE_TOP} + 6px)`, left: 'max(6px, calc(50% - 314px))', zIndex: 1300, borderRadius: '50%', pl: 1 }}>
            <MenuButton onClick={openDrawer} />
          </Paper>
        )}
        {mode === 'mock' && experience === 'draft' && <PrototypeDataChip endpoints={['Sample draft (Storybook mock API)']} bottomOffset={112} />}
        <ExperienceDrawer
          open={drawer}
          onOpen={openDrawer}
          onClose={() => setDrawer(false)}
          current={experience}
          path={normalized}
          destinations={routesFor(experience).map((r) => ({ path: r.path, title: r.title }))}
          navigate={navigate}
          apiState={apiState}
          resumePath={(e) => (mode === 'live' ? lastPath(e) : null)}
        />
      </AppShellContext.Provider>
    </ShellAdoptionContext.Provider>
  );
}
