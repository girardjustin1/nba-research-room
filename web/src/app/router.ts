import { useCallback, useEffect, useState } from 'react';

/** Old in-season links (#/season/<tab>[/<view>]) map onto the League routes. */
const LEGACY: Record<string, string> = {
  '#/season/matchup': '#/league/matchup',
  '#/season/builder/lineup': '#/league/team',
  '#/season/builder/moves': '#/league/team/moves',
  '#/season/builder/pickups': '#/league/team/pickups',
  '#/season/research': '#/league/players',
  '#/season/results': '#/league/results',
  '#/season/alerts': '#/league/notifications',
};

export function normalizePath(hash: string): string {
  const h = hash.startsWith('#') ? hash : `#${hash}`;
  const [base = '', q] = h.split('?');
  const mapped = LEGACY[base] ?? (base.startsWith('#/season') ? '#/league/matchup' : base);
  return q ? `${mapped}?${q}` : mapped;
}

/** Hash routing for the real app (no router dependency). */
export function useHashRoute(): [string, (path: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((path: string) => {
    window.location.hash = path;
  }, []);
  return [hash, navigate];
}

/** In-memory routing for Storybook: same navigation, without touching the iframe URL. */
export function useMemoryRoute(initial: string): [string, (path: string) => void] {
  const [path, setPath] = useState(initial);
  return [path, setPath];
}
