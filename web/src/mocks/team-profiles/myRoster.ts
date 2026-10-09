import type { MyRoster, MyRosterRequest, PlayerRef } from '../../api/season';
import { MINE, ROSTER } from '../foundations/seasonPlayers';
import { SEARCHABLE } from './opponentRoster';

/** My roster, entered by hand. Invented players (ids 100-113). */
const POLICY =
  "Your roster, kept on this computer only and never in the database; replaced each time you save. When Yahoo supplies your roster, Yahoo's is used instead.";

export const myRosterEmpty: MyRoster = { players: [], il_ids: [], max_players: 14, unmatched: [], saved_at: null, policy: POLICY };

export const myRosterFilled: MyRoster = {
  ...myRosterEmpty,
  players: [...ROSTER, MINE.thornbury],
  il_ids: [MINE.thornbury.player_id],
  saved_at: '2026-11-15T21:40:00-05:00',
};

const ALL: PlayerRef[] = [...ROSTER, MINE.thornbury, ...SEARCHABLE];

/** The sample search for my roster: my players and the opponent sample list. */
export function sampleSearchMine(q: string): PlayerRef[] {
  const k = q.trim().toLowerCase();
  return k.length < 2 ? [] : ALL.filter((p) => p.name.toLowerCase().includes(k)).slice(0, 10);
}

/** The sample save: picked ids plus pasted names matched exactly; IL kept for players still listed. */
export function sampleSaveMine(prev: MyRoster, body: MyRosterRequest, now = new Date().toISOString()): MyRoster {
  const ids = [...body.player_ids];
  const unmatched: MyRoster['unmatched'] = [];
  for (const raw of body.names) {
    const name = raw.trim();
    if (!name) continue;
    const hit = ALL.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (hit) ids.push(hit.player_id);
    else unmatched.push({ name, suggestions: sampleSearchMine(name.split(' ').pop() ?? '').map((p) => p.name).slice(0, 3) });
  }
  const players = [...new Set(ids)]
    .map((id) => ALL.find((p) => p.player_id === id))
    .filter((p): p is PlayerRef => !!p)
    .map((p) => ({ ...p, owner: 'mine' as const }));
  const kept = new Set(players.map((p) => p.player_id));
  return { ...prev, players, il_ids: body.il_ids.filter((i) => kept.has(i)), unmatched, saved_at: now };
}
