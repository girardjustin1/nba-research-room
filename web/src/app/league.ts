import type { LiveOrMock } from './useLiveOrMock';

/** Today's date in the league's time zone (US Eastern), YYYY-MM-DD. */
export function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Endpoints whose data on screen is invented (mock fallback). */
export function mockEndpoints(parts: [LiveOrMock<unknown>, string][]): string[] {
  return parts.filter(([r]) => r.isMock).map(([, e]) => e);
}

/** First readable error across the screen's requests. */
export function firstError(parts: LiveOrMock<unknown>[]): string | null {
  const nr = parts.find((p) => p.notReady)?.notReady;
  if (nr) return nr;
  return parts.find((p) => p.error)?.error ?? null;
}

export const LEAGUE_NAV_HEIGHT = 60;
