import type { PickRecord, Session } from '../../api/types';
import { makeSession, TEAM_NAMES, teamForPick } from './fixtures';
import { SAMPLE_PLAYERS } from './players';

/**
 * The demo build's in-memory draft: a stand-in for the Python tracker so recorded picks,
 * removals, undo and team names show up in the grid, log, Teams tab and latest-pick card.
 * It only keeps the pick log; every engine number (recommendations, odds, insights) comes
 * from the shared sample fixtures, never computed here.
 */
export interface DemoDraft {
  mySlot: number;
  punts: string[];
  picks: PickRecord[];
  names: Record<string, string>;
}

const START_PICK = 30;

export function initialDemoDraft(): DemoDraft {
  const s = makeSession({ mySlot: 5, currentPick: START_PICK });
  return { mySlot: 5, punts: [], picks: s.picks.map((p) => ({ ...p })), names: { ...TEAM_NAMES } };
}

export function demoSession(d: DemoDraft): Session {
  const base = makeSession({ mySlot: d.mySlot, currentPick: 1, punts: d.punts });
  const taken = new Set(d.picks.map((p) => p.pick_no));
  let current: number | null = null;
  for (let n = 1; n <= base.total_picks; n += 1) {
    if (!taken.has(n)) {
      current = n;
      break;
    }
  }
  return {
    ...base,
    current_pick: current,
    on_the_clock: current == null ? null : teamForPick(current),
    picks: [...d.picks].sort((a, b) => a.pick_no - b.pick_no),
    team_names: { ...d.names, [String(d.mySlot)]: 'You' },
  };
}

export class DemoPickError extends Error {}

export function recordDemoPick(d: DemoDraft, body: { player_id?: number; player_name?: string; pick_no?: number; team_id?: number }): void {
  const s = demoSession(d);
  const player =
    body.player_id != null
      ? SAMPLE_PLAYERS.find((p) => p.player_id === body.player_id)
      : SAMPLE_PLAYERS.find((p) => p.name.toLowerCase() === (body.player_name ?? '').trim().toLowerCase());
  if (!player) throw new DemoPickError(body.player_name ? `could not match '${body.player_name}' (no_match)` : 'player is not in the sample pool');
  if (d.picks.some((p) => p.player_id === player.player_id)) throw new DemoPickError(`${player.name} is already drafted`);
  const pickNo = body.pick_no ?? s.current_pick;
  if (pickNo == null) throw new DemoPickError('the draft is complete');
  if (pickNo < 1 || pickNo > s.total_picks) throw new DemoPickError(`pick ${pickNo} is outside 1..${s.total_picks}`);
  if (d.picks.some((p) => p.pick_no === pickNo)) throw new DemoPickError(`pick ${pickNo} is already recorded`);
  const owner = teamForPick(pickNo);
  if (body.team_id != null && body.team_id !== owner) throw new DemoPickError(`pick ${pickNo} belongs to team ${owner}, not team ${body.team_id}`);
  d.picks.push({ pick_no: pickNo, round: Math.ceil(pickNo / s.teams), team_id: owner, player_id: player.player_id, player_name: player.name, is_keeper: false });
}

export function removeDemoPick(d: DemoDraft, pickNo: number): void {
  const i = d.picks.findIndex((p) => p.pick_no === pickNo);
  if (i < 0) throw new DemoPickError(`no pick ${pickNo} to remove`);
  d.picks.splice(i, 1);
}

export function undoDemoPick(d: DemoDraft): void {
  const live = d.picks.filter((p) => !p.is_keeper);
  if (!live.length) throw new DemoPickError('no picks to undo');
  const last = live.reduce((a, b) => (b.pick_no > a.pick_no ? b : a));
  removeDemoPick(d, last.pick_no);
}
