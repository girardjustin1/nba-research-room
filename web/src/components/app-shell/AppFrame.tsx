import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { EXPERIENCE_HOME, LEAGUE_TAB_PATH, lastPath, rememberPath } from '../../app/experiences';
import { onNotificationsChanged } from '../../app/notificationActions';
import { LEAGUE_NAV_HEIGHT } from '../../app/league';
import { normalizePath } from '../../app/router';
import { findRoute, routesFor } from '../../app/routes';
import type { AppApis, Experience } from '../../app/types';
import { useLiveOrMock, type DataMode } from '../../app/useLiveOrMock';
import { notificationsNormal } from '../../mocks/notifications/notifications';
import { Adopted } from './Adopted';
import { AppShellContext, ShellAdoptionContext, type AppShellValue, type ShellPart } from './AppShellContext';
import { ExperienceDrawer, type ApiState } from './nav/ExperienceDrawer';
import { LeagueBottomNav } from './nav/LeagueBottomNav';
import { BellButton, MenuButton } from './nav/ShellButtons';
import { DemoBadge } from './DemoBadge';
import { YahooAttribution } from './YahooAttribution';
import { YahooStatusBanner } from './YahooStatusBanner';
import type { YahooStatus } from '../../api/system';
import { PrototypeDataChip } from './PrototypeDataChip';

export interface AppFrameProps {
  /** Current hash path, e.g. "#/league/matchup?x=1". */
  path: string;
  navigate: (path: string) => void;
  mode: DataMode;
  apis: AppApis;
  /** Storybook: open the drawer on first render. */
  initialDrawerOpen?: boolean;
  /** Demo build: shows the "Demo · sample data" badge and a Reset demo action. */
  demo?: { reset: () => void };
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
 * tabs) through AppShellContext. Screens render those parts in their own headers, so each
 * route shows exactly one ☰ and (in League) one bottom nav.
 */
/**
 * The bell's unread count (GET /season/notifications); null outside League. Re-read on every
 * navigation and whenever a screen marks alerts read (audit B09: useLiveOrMock only reloads on
 * refresh, not when its load function changes).
 */
function useUnread(path: string, mode: DataMode, apis: AppApis, inLeague: boolean): number | null {
  const load = useCallback(() => apis.season.notifications(), [apis]);
  const n = useLiveOrMock(load, notificationsNormal, inLeague ? mode : 'mock');
  const { refresh } = n;
  const [seen, setSeen] = useState(path);
  if (seen !== path) {
    setSeen(path);
    refresh();
  }
  useEffect(() => onNotificationsChanged(refresh), [refresh]);
  return inLeague ? (n.data?.unread ?? null) : null;
}

/**
 * How the last Yahoo read went (GET /system/yahoo), re-read on every navigation in live mode. The
 * page that just loaded has read Yahoo by then, so this reflects it. Dismissing hides the banner
 * until the state changes.
 */
function useYahooStatus(path: string, mode: DataMode, apis: AppApis, on: boolean) {
  const [status, setStatus] = useState<YahooStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'live' || !on) return;
    let live = true;
    const t = setTimeout(() => {
      apis.system.yahoo().then(
        (s) => live && setStatus(s),
        () => live && setStatus(null),
      );
    }, 1500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [path, mode, apis, on]);
  const key = status ? `${status.state}` : null;
  return {
    status: key !== null && key === dismissed ? null : status,
    dismiss: () => setDismissed(key),
  };
}

export function AppFrame({ path, navigate, mode, apis, initialDrawerOpen = false, demo }: AppFrameProps) {
  const normalized = normalizePath(path || '');
  const route = findRoute(normalized);
  const [drawer, setDrawer] = useState(initialDrawerOpen);
  const polled = useApiState(mode, apis);
  const apiState: ApiState = demo ? 'demo' : polled;

  // Unknown or empty path: resume the last place, else the draft room.
  useEffect(() => {
    if (!route) navigate(lastPath() ?? EXPERIENCE_HOME.draft);
  }, [route, navigate]);
  useEffect(() => {
    if (route && mode === 'live') rememberPath(normalized);
  }, [route, normalized, mode]);

  // Screens register the shell parts they render (season-ui's ScreenFrame does too). Every
  // route renders its own ☰ now, so nothing needs a fallback; the hook stays for that contract.
  const adopt = useCallback((part: ShellPart) => {
    void part;
    return () => {};
  }, []);

  const experience: Experience = route?.experience ?? 'draft';
  const unread = useUnread(normalized, mode, apis, experience === 'league');
  const yahoo = useYahooStatus(normalized, mode, apis, !demo && (experience === 'league' || experience === 'draft'));
  const query = useMemo(() => new URLSearchParams(normalized.split('?')[1] ?? ''), [normalized]);
  const openDrawer = useCallback(() => setDrawer(true), []);

  const shell = useMemo<AppShellValue>(() => {
    const menuButton = (
      <Adopted part="menu">
        <MenuButton onClick={openDrawer} />
      </Adopted>
    );
    const demoBadge = demo ? <DemoBadge compact onReset={demo.reset} /> : null;
    if (experience !== 'league') return { menuButton, headerActions: demoBadge, bottomNav: null, demoBadge: demo ? <DemoBadge onReset={demo.reset} /> : null };
    return {
      menuButton,
      demoBadge,
      headerActions: (
        <Adopted part="actions">
          {demoBadge}
          <BellButton onClick={() => navigate('#/league/notifications')} unread={unread} />
        </Adopted>
      ),
      bottomNav: (
        <Adopted part="nav">
          <LeagueBottomNav value={route?.leagueTab ?? null} onChange={(t) => navigate(LEAGUE_TAB_PATH[t])} />
        </Adopted>
      ),
    };
  }, [experience, openDrawer, navigate, route?.leagueTab, demo, unread]);

  if (!route) return null;

  return (
    <ShellAdoptionContext.Provider value={adopt}>
      <AppShellContext.Provider value={shell}>
        <Box key={route.path} sx={{ position: 'relative', minHeight: '100dvh' }}>
          {route.render({ mode, apis, navigate, query })}
        </Box>
        {mode === 'live' && !demo && (experience === 'league' || experience === 'draft') && (
          <YahooAttribution bottomOffset={experience === 'league' ? LEAGUE_NAV_HEIGHT : 0} />
        )}
        <YahooStatusBanner
          status={yahoo.status}
          onDismiss={yahoo.dismiss}
          bottomOffset={experience === 'league' ? LEAGUE_NAV_HEIGHT : 0}
        />
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
          onResetDemo={demo?.reset}
        />
      </AppShellContext.Provider>
    </ShellAdoptionContext.Provider>
  );
}
