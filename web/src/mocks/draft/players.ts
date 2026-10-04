import type { Player } from '../../api/types';

/**
 * INVENTED sample players for Storybook and tests. Names are made up ("Sample Guard A")
 * and every number is synthetic, produced by a seeded generator below. Nothing here
 * comes from the draft API or from reference/ (Basketball Monster data is paid and
 * never enters this repo).
 */

const POS_WORD: Record<string, string> = { PG: 'Guard', SG: 'Wing', SF: 'Forward', PF: 'Big', C: 'Center' };
const ELIGIBLE: Record<string, string[]> = {
  PG: ['PG', 'G', 'Util'],
  SG: ['SG', 'G', 'Util'],
  SF: ['SF', 'F', 'Util'],
  PF: ['PF', 'F', 'Util'],
  C: ['C', 'Util'],
};
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
// Real NBA codes (so demo schedules join), invented players and numbers.
const TEAMS = ['DEN', 'NOP', 'PHX', 'BOS', 'MIA', 'SAC'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Small deterministic PRNG (mulberry32) so stories render identically every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function makePlayers(count = 80, seed = 7): Player[] {
  const rnd = seeded(seed);
  const perPos: Record<string, number> = {};
  const out: Player[] = [];
  for (let i = 0; i < count; i += 1) {
    const pos = POSITIONS[i % POSITIONS.length] ?? 'PG';
    const n = perPos[pos] ?? 0;
    perPos[pos] = n + 1;
    const suffix = n < LETTERS.length ? (LETTERS[n] ?? 'Z') : `${LETTERS[n % LETTERS.length] ?? 'Z'}${Math.floor(n / LETTERS.length)}`;
    const value = round(9 - i * 0.11 - rnd() * 0.3, 2);
    const twoPos = rnd() < 0.3 && pos !== 'C';
    const eligible = [...(ELIGIBLE[pos] ?? ['Util'])];
    if (twoPos) {
      const extra = pos === 'PG' ? 'SG' : pos === 'SG' ? 'SF' : pos === 'SF' ? 'PF' : 'C';
      eligible.splice(1, 0, extra);
    }
    const adpSource = i < 50 ? 'yahoo' : i < 65 ? 'bbm_adp' : 'bbm_rank';
    out.push({
      player_id: 9000 + i,
      name: `Sample ${POS_WORD[pos] ?? 'Player'} ${suffix}`,
      team_abbr: TEAMS[Math.floor(rnd() * TEAMS.length)] ?? 'NTH',
      position: pos,
      eligible,
      games: round(58 + rnd() * 22, 0),
      minutes_pg: round(24 + rnd() * 12, 1),
      value,
      value_pg: round(value / 70, 3),
      rank: i + 1,
      tier: Math.min(10, 1 + Math.floor(i / 9)),
      expected_pick: round(i + 1 + (rnd() - 0.5) * 6, 1),
      adp_source: adpSource,
      yahoo_adp: adpSource === 'yahoo' ? round(i + 1 + (rnd() - 0.5) * 6, 1) : null,
      injury_risk: rnd() < 0.15 ? 'H' : rnd() < 0.5 ? 'M' : 'L',
      sources: rnd() < 0.12 ? 'bbm_only' : 'bbm+last_season',
      // Invented players have no images: the UI shows initials and the team abbreviation.
      headshot_url: null,
      team_logo_url: null,
      rookie: rnd() < 0.1,
      playoff_games: 9 + Math.floor(rnd() * 4),
    });
  }
  // Ranks within position and by (invented) ADP, as the API would return them.
  const byPos = new Map<string, number>();
  for (const p of out) {
    const n = (byPos.get(p.position ?? '') ?? 0) + 1;
    byPos.set(p.position ?? '', n);
    p.pos_rank = n;
  }
  const byAdp = [...out].sort((a, b) => (a.expected_pick ?? 999) - (b.expected_pick ?? 999));
  const adpPos = new Map<string, number>();
  byAdp.forEach((p, i) => {
    p.adp_rank = i + 1;
    const n = (adpPos.get(p.position ?? '') ?? 0) + 1;
    adpPos.set(p.position ?? '', n);
    p.adp_pos_rank = n;
  });
  return out;
}

export const SAMPLE_PLAYERS: Player[] = makePlayers();
