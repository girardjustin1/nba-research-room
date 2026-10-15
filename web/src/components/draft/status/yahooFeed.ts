import type { YahooFeedStatus } from '../../../api/types';

/** The status bar's second line: what the Yahoo picks feed is doing, or null when it's off. */
export function feedLine(f: YahooFeedStatus | null | undefined): string | null {
  if (!f || f.state === 'off') return null;
  if (f.state === 'waiting') return 'Yahoo picks: reading from 30 min before the draft';
  if (f.state === 'error') return `Yahoo picks: ${f.detail || "Yahoo didn't answer"} · retrying`;
  return `Yahoo picks: live · ${f.added} added · Yahoo lists ${f.yahoo_picks}`;
}
