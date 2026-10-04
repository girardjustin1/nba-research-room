import type { SeasonTab } from './components/foundations/ScreenFrame';
import type { BuilderView } from './components/team-builder/BuilderTabs';

/** #/season/<tab>[/<view>] → which in-season screen to show (unknown parts fall back to the Lineup). */
export function parseSeasonHash(hash: string): { tab: SeasonTab; view: BuilderView | null } {
  const [, , tab = 'builder', view] = hash.replace(/^#/, '').split('/');
  const t = (['matchup', 'builder', 'research', 'results', 'alerts'] as const).find((x) => x === tab) ?? 'builder';
  const v = t === 'builder' ? ((['lineup', 'moves', 'pickups'] as const).find((x) => x === view) ?? 'lineup') : null;
  return { tab: t, view: v };
}

