import type { Session, YahooFeedStatus } from '../../api/types';

/** The Yahoo picks feed's states, for stories. Invented names. */
const base: YahooFeedStatus = { state: 'live', detail: '', checked_at: '2026-10-18T19:41:12-04:00', yahoo_picks: 29, added: 3, unmatched: [], conflicts: [] };

export const feedLive: YahooFeedStatus = base;
export const feedWaiting: YahooFeedStatus = { ...base, state: 'waiting', yahoo_picks: 0, added: 0, checked_at: null };
export const feedError: YahooFeedStatus = { ...base, state: 'error', detail: "Yahoo didn't answer (throttled)" };
/** A name that matched no player and a pick the log has with someone else. */
export const feedNeedsYou: YahooFeedStatus = { ...base, unmatched: ['Sample Rookie Z'], conflicts: [27] };

export const withFeed = (s: Session, f: YahooFeedStatus): Session => ({ ...s, yahoo_feed: f });
