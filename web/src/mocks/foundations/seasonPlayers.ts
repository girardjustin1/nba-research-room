import type { InjuryStatus, PlayerRef, PlayerStatus, RosterOwner, RosterSlot, SourceRef } from '../../api/season';

/**
 * INVENTED players for the in-season stories. Every name is made up and every number in
 * src/mocks/season is synthetic (hand-set magnitudes or the seeded generator). Team
 * abbreviations are real NBA codes only so schedules read naturally; headshots and logos
 * are always null. Nothing here comes from the API, the store, or reference/.
 */

export const AS_OF = '2026-11-18T17:42:00-05:00';

export const SOURCES = {
  teamPR: (team: string): SourceRef => ({ kind: 'x', handle: `@${team}_PR`, display_name: `${team} PR (sample)`, tier: 'official' }),
  insider: { kind: 'x', handle: '@sample_insider', display_name: 'Sample Insider', tier: 'insider' } as SourceRef,
  beat: (team: string): SourceRef => ({ kind: 'x', handle: `@${team.toLowerCase()}_beat`, display_name: `${team} beat (sample)`, tier: 'beat' }),
  aggregator: { kind: 'x', handle: '@sample_fantasy_wire', display_name: 'Fantasy Wire (sample)', tier: 'aggregator' } as SourceRef,
  bdl: { kind: 'bdl', handle: null, display_name: 'BallDontLie injuries', tier: null } as SourceRef,
  kalshi: { kind: 'kalshi', handle: null, display_name: 'Kalshi', tier: null } as SourceRef,
  book: { kind: 'sportsbook', handle: 'SampleBook', display_name: 'SampleBook', tier: null } as SourceRef,
};

const LABEL: Record<InjuryStatus, string> = {
  healthy: '',
  probable: 'P',
  questionable: 'Q',
  doubtful: 'D',
  out: 'O',
  day_to_day: 'DTD',
  suspended: 'SUSP',
};

export function status(code: InjuryStatus = 'healthy', extra: Partial<PlayerStatus> = {}): PlayerStatus {
  return {
    code,
    label: LABEL[code],
    play_prob: code === 'healthy' ? 0.97 : code === 'probable' ? 0.88 : code === 'questionable' ? 0.55 : code === 'doubtful' ? 0.2 : 0,
    minutes_cap: null,
    note: null,
    source: code === 'healthy' ? null : SOURCES.bdl,
    as_of: AS_OF,
    ...extra,
  };
}

function elig(...pos: RosterSlot[]): RosterSlot[] {
  const out = new Set<RosterSlot>(pos);
  if (pos.includes('PG') || pos.includes('SG')) out.add('G');
  if (pos.includes('SF') || pos.includes('PF')) out.add('F');
  out.add('Util');
  const order: RosterSlot[] = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'Util'];
  return order.filter((s) => out.has(s));
}

function p(id: number, name: string, team: string, pos: RosterSlot[], owner: RosterOwner, st?: PlayerStatus, pctRostered: number | null = null): PlayerRef {
  return {
    player_id: id,
    name,
    team_abbr: team,
    eligible: elig(...pos),
    headshot_url: null,
    team_logo_url: null,
    owner,
    status: st ?? status(),
    pct_rostered: pctRostered,
  };
}

/** My roster: 13 + 1 IL. Ids 100-113. */
export const MINE = {
  ashgrove: p(100, 'Rennick Ashgrove', 'CHA', ['PG'], 'mine'),
  kettering: p(101, 'Tobias Kettering', 'SAC', ['SG', 'SF'], 'mine'),
  mulvane: p(102, 'Dante Mulvane', 'MEM', ['PG', 'SG'], 'mine'),
  dunsmore: p(103, 'Elijah Dunsmore', 'UTA', ['SF', 'PF'], 'mine'),
  halvorsen: p(104, 'Soren Halvorsen', 'OKC', ['C'], 'mine'),
  castellan: p(105, 'Malik Castellan', 'ORL', ['PF', 'C'], 'mine'),
  ferrante: p(106, 'Jalen Ferrante', 'POR', ['SG'], 'mine'),
  lindqvist: p(107, 'Anders Lindqvist', 'DET', ['C'], 'mine'),
  abernethy: p(108, 'Kofi Abernethy', 'IND', ['SF'], 'mine'),
  rosswell: p(109, 'Wes Rosswell', 'BKN', ['PG'], 'mine', status('questionable', { minutes_cap: 24, note: 'Left hamstring; minutes limit if he plays', source: SOURCES.beat('BKN') })),
  talbridge: p(110, 'Theo Talbridge', 'WAS', ['PF'], 'mine'),
  venhaus: p(111, 'Bram Venhaus', 'TOR', ['SG', 'SF'], 'mine'),
  pellham: p(112, 'Isaac Pellham', 'HOU', ['C', 'PF'], 'mine'),
  thornbury: p(113, 'Marcus Thornbury', 'PHI', ['SF', 'PF'], 'mine', status('out', { note: 'Knee; re-evaluated in two weeks', play_prob: 0 })),
};

export const ROSTER: PlayerRef[] = [
  MINE.ashgrove,
  MINE.kettering,
  MINE.mulvane,
  MINE.dunsmore,
  MINE.halvorsen,
  MINE.castellan,
  MINE.ferrante,
  MINE.lindqvist,
  MINE.abernethy,
  MINE.rosswell,
  MINE.talbridge,
  MINE.venhaus,
  MINE.pellham,
];

/** Halvorsen ruled out tonight: the breaking-news variant. */
export const HALVORSEN_OUT: PlayerRef = {
  ...MINE.halvorsen,
  status: status('out', {
    note: 'Right ankle sprain; ruled out tonight',
    source: SOURCES.teamPR('OKC'),
    as_of: '2026-11-18T17:31:00-05:00',
  }),
};

/** Opponent players that show up in the feed. Ids 200+. */
export const THEIRS = {
  wexford: p(200, 'Grant Wexford', 'LAL', ['C'], 'opponent'),
  marlowe: p(201, 'Felix Marlowe', 'MIA', ['PG'], 'opponent', status('day_to_day', { note: 'Back tightness' })),
  stroud: p(202, 'Silas Stroud', 'DEN', ['SF', 'PF'], 'opponent'),
};

/** Free agents and waiver-wire players. Ids 300+. */
export const FREE_AGENTS = {
  bramwell: p(300, 'Callum Bramwell', 'NOP', ['C'], 'free_agent', undefined, 0.21),
  northcott: p(301, 'Nico Northcott', 'ATL', ['PG'], 'waivers', undefined, 0.34),
  sefton: p(302, 'Jonah Sefton', 'CHI', ['SG', 'SF'], 'free_agent', undefined, 0.12),
  hargreave: p(303, 'Ravi Hargreave', 'MIN', ['PF', 'C'], 'free_agent', undefined, 0.17),
  delacroix: p(304, 'Luc Delacroix', 'PHX', ['SG'], 'free_agent', undefined, 0.09),
  quillan: p(305, 'Omar Quillan', 'SAS', ['C'], 'waivers', status('probable', { note: 'Illness; expected to play' }), 0.28),
  everly: p(306, 'Ezra Everly', 'GSW', ['SF'], 'free_agent', undefined, 0.06),
  kingsmill: p(307, 'Aaron Kingsmill', 'DAL', ['PG', 'SG'], 'free_agent', status('questionable', { minutes_cap: 20, note: 'Returning from a calf strain' }), 0.15),
};
