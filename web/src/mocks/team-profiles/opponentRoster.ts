import type { OpponentRoster, OpponentRosterRequest, PlayerRef, RosterSlot } from '../../api/season';
import { THEIRS } from '../foundations/seasonPlayers';

/** This week's opponent, entered by hand. Invented teams and players (ids 200+). */
const more = (id: number, name: string, team: string, elig: RosterSlot[]): PlayerRef => ({
  ...THEIRS.stroud,
  player_id: id,
  name,
  team_abbr: team,
  eligible: [...elig, 'Util'],
  status: { ...THEIRS.stroud.status },
});

const OPPONENT: PlayerRef[] = [
  THEIRS.wexford,
  THEIRS.marlowe,
  THEIRS.stroud,
  more(203, 'Arlo Penhallow', 'BOS', ['SG', 'SF']),
  more(204, 'Desmond Quarry', 'CLE', ['PF', 'C']),
  more(205, 'Teodor Vasko', 'MIL', ['PG', 'SG']),
];

/** Every player the search box can find in the sample data (the NBA list in the real app). */
export const SEARCHABLE: PlayerRef[] = [
  ...OPPONENT,
  more(206, 'Kellan Ashby', 'NYK', ['SF']),
  more(207, 'Ruben Oakhurst', 'SAC', ['C']),
  more(208, 'Mateo Brightwater', 'DAL', ['PG']),
  more(209, 'Jasper Kilgannon', 'IND', ['SF', 'PF']),
];

const TEAMS = Array.from({ length: 14 }, (_, i) => i + 1)
  .filter((t) => t !== 11)
  .map((t) => ({ team_id: t, label: `Team ${t}` }));

const POLICY =
  'One opponent at a time, replaced each week. Kept on this computer only and never in the database; names and positions come from the NBA data.';

export const opponentRosterEmpty: OpponentRoster = {
  week: { week: 5, start: '2026-11-16', end: '2026-11-22' },
  teams: TEAMS,
  opponent_team_id: null,
  players: [],
  unmatched: [],
  saved_at: null,
  policy: POLICY,
};

export const opponentRosterFilled: OpponentRoster = {
  ...opponentRosterEmpty,
  opponent_team_id: 4,
  players: OPPONENT,
  saved_at: '2026-11-16T09:12:00-05:00',
};

export const opponentRosterUnmatched: OpponentRoster = {
  ...opponentRosterFilled,
  unmatched: [
    { name: 'Penhalow', suggestions: ['Arlo Penhallow'] },
    { name: 'Some Rookie', suggestions: [] },
  ],
};

/** The sample search: names containing the text (case-insensitive). */
export function sampleSearch(q: string): PlayerRef[] {
  const k = q.trim().toLowerCase();
  return k.length < 2 ? [] : SEARCHABLE.filter((p) => p.name.toLowerCase().includes(k)).slice(0, 10);
}

/** The sample save: picked ids plus pasted names matched exactly (case-insensitive). */
export function sampleSave(prev: OpponentRoster, body: OpponentRosterRequest, now = new Date().toISOString()): OpponentRoster {
  const ids = [...body.player_ids];
  const unmatched: OpponentRoster['unmatched'] = [];
  for (const raw of body.names) {
    const name = raw.trim();
    if (!name) continue;
    const hit = SEARCHABLE.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (hit) ids.push(hit.player_id);
    else unmatched.push({ name, suggestions: sampleSearch(name.split(' ').pop() ?? '').map((p) => p.name).slice(0, 3) });
  }
  const players = [...new Set(ids)].map((id) => SEARCHABLE.find((p) => p.player_id === id)).filter((p): p is PlayerRef => !!p);
  return { ...prev, opponent_team_id: body.team_id, players, unmatched, saved_at: now };
}
