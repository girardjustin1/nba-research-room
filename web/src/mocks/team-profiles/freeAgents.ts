import type { FreeAgents, FreeAgentsRequest, PlayerRef } from '../../api/season';
import { SEARCHABLE } from './opponentRoster';

/** Free agents pasted from Yahoo's Players page. Invented players (the opponent sample list). */
const POLICY =
  "The free agents you pasted, kept on this computer only and never in the database: only the players found are kept, not the text. Replaced each time you paste; when Yahoo supplies the list, Yahoo's is used instead. Check a player is still free in Yahoo before adding him.";

const asFree = (p: PlayerRef): PlayerRef => ({ ...p, owner: 'free_agent' });
/** The second sample player is on waivers in every sample paste (Yahoo's "W (Nov 17)"). */
const WAIVER_UNTIL = '2026-11-17';
const marked = (p: PlayerRef, i: number): PlayerRef =>
  i === 1 ? { ...p, owner: 'waivers', waiver_until: WAIVER_UNTIL } : asFree(p);

export const freeAgentsEmpty: FreeAgents = { players: [], saved_at: null, age_hours: null, ambiguous: [], policy: POLICY };

export const freeAgentsFilled: FreeAgents = {
  ...freeAgentsEmpty,
  players: SEARCHABLE.slice(0, 8).map(marked),
  saved_at: '2026-11-15T21:40:00-05:00',
  age_hours: 3.2,
};

/** Pasted three days ago: other teams have moved since. */
export const freeAgentsStale: FreeAgents = { ...freeAgentsFilled, age_hours: 74 };

/** A paste where one name belongs to two players (skipped, not guessed). */
export const freeAgentsAmbiguous: FreeAgents = { ...freeAgentsFilled, age_hours: 0, ambiguous: ['jalen johnson'] };

/** A sample paste of Yahoo's Players page, clutter included (the second player on waivers). */
export const SAMPLE_PASTE = SEARCHABLE.slice(0, 5)
  .map(
    (p, i) =>
      `${p.name}  ${p.team_abbr ?? ''} - ${p.eligible.filter((e) => e !== 'Util').join(',')}\nPlayer Note  ${i === 1 ? 'W (Nov 17)' : 'FA'}  12  58  71  14%`,
  )
  .join('\n');

/** The sample save: every sample player whose name appears in the text. */
export function sampleSaveFree(body: FreeAgentsRequest, now = new Date().toISOString()): FreeAgents {
  const text = body.text.toLowerCase();
  const players = SEARCHABLE.filter((p) => text.includes(p.name.toLowerCase())).map((p) =>
    p === SEARCHABLE[1] && text.includes('w (') ? { ...p, owner: 'waivers' as const, waiver_until: WAIVER_UNTIL } : asFree(p),
  );
  if (players.length === 0) throw new Error('no NBA player names found in that text');
  return { ...freeAgentsEmpty, players, saved_at: now, age_hours: 0 };
}
