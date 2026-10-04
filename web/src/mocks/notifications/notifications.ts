import type { NotificationsResponse, SeasonNotification } from '../../api/season';
import { conf, prov } from '../foundations/seasonCommon';
import { AS_OF, FREE_AGENTS, HALVORSEN_OUT, MINE } from '../foundations/seasonPlayers';
import { ALERT_HALVORSEN, STALE_AS_OF, STALE_REASON } from '../matchup-analysis/week';

/** Invented notifications for the inbox and alert cards. */

const t = (hhmm: string, date = '2026-11-18') => `${date}T${hhmm}:00-05:00`;

export const N_INJURY: SeasonNotification = {
  id: 'n-injury-halvorsen',
  kind: 'injury',
  priority: 'urgent',
  created_at: t('17:33'),
  title: 'Halvorsen ruled out tonight',
  body: 'Your C slot scores nothing tonight unless you move Pellham in before his 8:00 pm tip.',
  read: false,
  player: HALVORSEN_OUT,
  impact: ALERT_HALVORSEN.impact,
  action: { label: 'Start Pellham at C', target: 'move', ref: 'm-start-pellham-c' },
  deadline: { kind: 'lineup_lock', at: t('20:00') },
  claim: null,
  provenance: [prov('x_feed', '@OKC_PR, official'), prov('simulate')],
};

export const N_LOCK: SeasonNotification = {
  id: 'n-lock-tonight',
  kind: 'lineup_lock',
  priority: 'high',
  created_at: t('17:40'),
  title: 'Lineup locks start at 7:00 pm',
  body: 'Two changes for tonight are not made yet: Pellham over Ferrante at Util, Mulvane to PG.',
  read: false,
  player: null,
  impact: {
    delta_p_win: 0.021,
    cat_deltas: [{ key: 'reb', delta_p: 0.04, p_after: 0.61 }],
    summary: 'Making both changes: P(win week) +2.1 pts.',
    suggestion: null,
    move_id: null,
    severity: 'medium',
    confidence: conf('high', 0.82),
    computed_at: t('17:40'),
  },
  action: { label: 'Open today’s lineup', target: 'lineup', ref: null },
  deadline: { kind: 'lineup_lock', at: t('19:00') },
  claim: null,
  provenance: [prov('optimizer')],
};

export const N_WAIVER_OPP: SeasonNotification = {
  id: 'n-waiver-bramwell',
  kind: 'waiver',
  priority: 'high',
  created_at: t('17:12'),
  title: 'Pickup: Callum Bramwell is still a free agent',
  body: '3 playable games Thu–Sun; BLK goes from a coin flip to 60%. Adding him before Thursday’s 8:00 pm tip uses acquisition 3 of 4.',
  read: true,
  player: FREE_AGENTS.bramwell,
  impact: {
    delta_p_win: 0.046,
    cat_deltas: [
      { key: 'blk', delta_p: 0.11, p_after: 0.6 },
      { key: 'reb', delta_p: 0.06, p_after: 0.63 },
    ],
    summary: 'P(win week) +4.6 pts if you add him and drop Venhaus.',
    suggestion: 'Add Bramwell, drop Venhaus after tonight’s game.',
    move_id: 'm-add-bramwell',
    severity: 'high',
    confidence: conf('medium', 0.68),
    computed_at: t('17:12'),
  },
  action: { label: 'See the pickup', target: 'pickups', ref: null },
  deadline: { kind: 'add_before_game', at: '2026-11-19T20:00:00-05:00' },
  claim: null,
  provenance: [prov('yahoo', 'free agents 5:15 pm'), prov('optimizer')],
};

export const N_CLAIM: SeasonNotification = {
  id: 'n-claim-northcott',
  kind: 'waiver',
  priority: 'normal',
  created_at: t('09:05'),
  title: 'Waiver claim pending: Nico Northcott',
  body: 'Clears Friday 3:00 am. If it clears, Talbridge is dropped and you have 1 acquisition left.',
  read: true,
  player: FREE_AGENTS.northcott,
  impact: null,
  action: { label: 'Review the claim', target: 'move', ref: 'm-add-northcott' },
  deadline: { kind: 'waiver_clears', at: '2026-11-20T03:00:00-05:00' },
  claim: { status: 'pending', player: FREE_AGENTS.northcott, drop: MINE.talbridge, clears_at: '2026-11-20T03:00:00-05:00', clears_in_days: 2, acquisitions_left: 1 },
  provenance: [prov('yahoo', 'transactions')],
};

export const N_GAMEDAY: SeasonNotification = {
  id: 'n-gameday',
  kind: 'game_day',
  priority: 'low',
  created_at: t('08:00'),
  title: 'Game day: 10 of your players play tonight',
  body: 'You have 11 games for 10 slots; Opp has 7. Light night league-wide tomorrow (4 games).',
  read: true,
  player: null,
  impact: null,
  action: { label: 'Open the matchup', target: 'feed', ref: null },
  deadline: null,
  claim: null,
  provenance: [prov('schedule')],
};

export const N_NEWS_ROSSWELL: SeasonNotification = {
  id: 'n-news-rosswell',
  kind: 'news',
  priority: 'normal',
  created_at: t('16:57'),
  title: 'Rosswell questionable Friday, minutes cap 24',
  body: 'If he plays it is under a cap: benching him Friday protects TO and FG%.',
  read: false,
  player: MINE.rosswell,
  impact: {
    delta_p_win: -0.011,
    cat_deltas: [{ key: 'ast', delta_p: -0.02, p_after: 0.37 }],
    summary: 'P(win week) −1.1 pts from the news.',
    suggestion: 'Bench Rosswell Friday unless cleared without a limit.',
    move_id: 'm-bench-rosswell',
    severity: 'medium',
    confidence: conf('low', 0.45, [{ key: 'status', label: 'Beat report only', effect: 'P(plays) 55%' }]),
    computed_at: t('16:57'),
  },
  action: { label: 'See the bench move', target: 'move', ref: 'm-bench-rosswell' },
  deadline: { kind: 'lineup_lock', at: '2026-11-20T19:30:00-05:00' },
  claim: null,
  provenance: [prov('x_feed', 'beat writer'), prov('simulate')],
};

export const N_MODEL: SeasonNotification = {
  id: 'n-model',
  kind: 'model',
  priority: 'low',
  created_at: '2026-11-16T06:52:00-05:00',
  title: 'Scoreboard updated through week 3',
  body: 'LightGBM and the hierarchical model beat EWMA on minutes; Ridge stays gated off.',
  read: true,
  player: null,
  impact: null,
  action: { label: 'Open the scoreboard', target: 'feed', ref: null },
  deadline: null,
  claim: null,
  provenance: [prov('backtest')],
};

const ITEMS = [N_INJURY, N_LOCK, N_WAIVER_OPP, N_NEWS_ROSSWELL, N_CLAIM, N_GAMEDAY, N_MODEL];

export const notificationsNormal: NotificationsResponse = {
  as_of: AS_OF,
  stale: false,
  stale_reason: null,
  provenance: [prov('x_feed'), prov('yahoo'), prov('optimizer')],
  items: ITEMS,
  unread: ITEMS.filter((i) => !i.read).length,
};

export const notificationsEmpty: NotificationsResponse = { ...notificationsNormal, items: [], unread: 0 };
export const notificationsAllRead: NotificationsResponse = { ...notificationsNormal, items: ITEMS.map((i) => ({ ...i, read: true })), unread: 0 };
export const notificationsStale: NotificationsResponse = { ...notificationsNormal, as_of: STALE_AS_OF, stale: true, stale_reason: STALE_REASON };

export const N_CLAIM_CLEARED: SeasonNotification = {
  ...N_CLAIM,
  id: 'n-claim-cleared',
  title: 'Claim cleared: Nico Northcott is yours',
  body: 'Talbridge was dropped. 1 acquisition left this week.',
  claim: { ...N_CLAIM.claim!, status: 'cleared', clears_in_days: 0 },
  created_at: '2026-11-20T03:02:00-05:00',
  read: false,
};

export const N_CLAIM_LOST: SeasonNotification = {
  ...N_CLAIM,
  id: 'n-claim-lost',
  priority: 'high',
  title: 'Claim lost: Northcott went to a team with higher priority',
  body: 'Your acquisitions are unchanged (2 left). Next best AST pickup: Aaron Kingsmill (+0.4 pts).',
  claim: { ...N_CLAIM.claim!, status: 'lost', clears_in_days: 0, acquisitions_left: 2 },
  action: { label: 'See pickups', target: 'pickups', ref: null },
  read: false,
};
