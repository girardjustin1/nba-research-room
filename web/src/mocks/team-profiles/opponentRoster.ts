import type { OpponentRoster, OpponentRosterRequest, OpponentScreenshot, PlayerRef, RosterSlot, TeamNamesRequest } from '../../api/season';
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

/** Invented team names (a few left unnamed, as before anyone registers them). */
const NAMES: Record<number, string> = {
  1: 'Paint Protectors', 2: 'Glass Cleaners', 3: 'Corner Threes', 4: 'Late Rotation',
  5: 'Backdoor Cutters', 6: 'Full Court Press', 7: 'Pick and Pop', 9: 'Second Unit',
  10: 'Shot Clock', 12: 'Bench Mob',
};
const label = (t: number, names: Record<number, string>) => ({ team_id: t, label: names[t] ?? `Team ${t}`, name: names[t] ?? null });
const TEAMS = Array.from({ length: 14 }, (_, i) => i + 1)
  .filter((t) => t !== 11)
  .map((t) => label(t, NAMES));
const NO_NAMES = TEAMS.map((t) => ({ ...t, label: `Team ${t.team_id}`, name: null }));

const POLICY =
  "Team names, and one opponent's roster at a time, replaced each week. Kept on this computer only and never in the database; players' names and positions come from the NBA data.";

export const opponentRosterEmpty: OpponentRoster = {
  week: { week: 5, start: '2026-11-16', end: '2026-11-22' },
  teams: NO_NAMES,
  opponent_team_id: null,
  players: [],
  unmatched: [],
  saved_at: null,
  policy: POLICY,
};

export const opponentRosterFilled: OpponentRoster = {
  ...opponentRosterEmpty,
  teams: TEAMS,
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
  const named = body.team_name === undefined ? prev : sampleSaveNames(prev, { teams: [{ team_id: body.team_id, name: body.team_name }] });
  return { ...named, opponent_team_id: body.team_id, players, unmatched, saved_at: now };
}

/** The sample naming: register, rename, or clear (blank) team names. */
export function sampleSaveNames(prev: OpponentRoster, body: TeamNamesRequest): OpponentRoster {
  const names: Record<number, string> = {};
  for (const t of prev.teams) if (t.name) names[t.team_id] = t.name;
  for (const t of body.teams) {
    const n = (t.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (n) names[t.team_id] = n;
    else delete names[t.team_id];
  }
  return { ...prev, teams: prev.teams.map((t) => label(t.team_id, names)) };
}

/** The sample screenshot read: four sample players and the first named team. */
export function sampleScreenshot(prev: OpponentRoster): OpponentScreenshot {
  const team = prev.teams.find((t) => t.name);
  return {
    team_id: team?.team_id ?? null,
    team_name: team?.name ?? null,
    players: SEARCHABLE.slice(0, 4).map((p) => ({ ...p, owner: 'opponent' as const })),
    skipped_mine: 1,
    too_many: false,
    ambiguous: [],
    policy: 'Read on this Mac by its own text recognition: the screenshot and its text are deleted once read and never sent anywhere. Check the players, then Save.',
  };
}
