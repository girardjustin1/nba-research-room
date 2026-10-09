import type { YahooStatus } from '../../api/system';

const base = { checked_at: '2026-11-04T23:41:00Z', seconds: 8.0, paused: true, degraded: true } as const;

export const yahooLive: YahooStatus = {
  state: 'live', checked_at: '2026-11-04T23:41:00Z', seconds: 1.4, paused: false, degraded: false,
  message: 'Read from Yahoo just now.',
};
export const yahooSlow: YahooStatus = {
  ...base, state: 'slow',
  message: "Yahoo didn't answer in time: showing your own entries and the last saved plan.",
};
export const yahooDown: YahooStatus = {
  ...base, state: 'down', seconds: 0.6,
  message: "Yahoo couldn't be read: showing your own entries and the last saved plan.",
};
export const yahooNoAccess: YahooStatus = {
  ...base, state: 'no_access', seconds: 0.9,
  message: "Yahoo isn't letting the app read the league yet: using your own entries.",
};
/** The demo and Storybook's app frame: not signed in, so no banner. */
export const yahooOff: YahooStatus = {
  state: 'off', checked_at: null, seconds: null, paused: false, degraded: false,
  message: 'Not signed in to Yahoo: using your own entries.',
};
