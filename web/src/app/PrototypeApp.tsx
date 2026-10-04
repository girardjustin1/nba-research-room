import { useMemo } from 'react';
import { AppFrame } from '../components/app-shell/AppFrame';
import { createMockApis } from '../mocks/app-shell/apis';
import { useMemoryRoute } from './router';

/**
 * The real app frame on sample data, for Storybook's Prototype section: same routes, same
 * drawer, headers and bottom tabs, navigation kept in memory (the iframe URL never changes).
 */
export function PrototypeApp({ path, drawerOpen = false }: { path: string; drawerOpen?: boolean }) {
  const apis = useMemo(() => createMockApis(), []);
  const [current, navigate] = useMemoryRoute(path);
  return <AppFrame path={current} navigate={navigate} mode="mock" apis={apis} initialDrawerOpen={drawerOpen} />;
}
