import type { Session } from '../api/types';
import { ordinal } from './format';

/**
 * Display helpers for pick numbers. The API is the authority on who picks when (it checks
 * the team on every POST /draft/pick); these only lay the draft grid out on screen.
 * `snakeSlot` mirrors availability.pick_number for a standard snake, and
 * `gridMatchesApi` cross-checks it against the API's my_picks so a non-snake order
 * (keepers, traded picks) is flagged instead of silently mis-drawn.
 */

export function roundOf(pick: number, teams: number): number {
  return Math.ceil(pick / teams);
}

export function pickInRound(pick: number, teams: number): number {
  return pick - (roundOf(pick, teams) - 1) * teams;
}

/** 27 in a 14-team league -> "2.13". */
export function roundPick(pick: number, teams: number): string {
  return `${roundOf(pick, teams)}.${String(pickInRound(pick, teams)).padStart(2, '0')}`;
}

/** "2.13 (27th)" */
export function roundPickLong(pick: number, teams: number): string {
  return `${roundPick(pick, teams)} (${ordinal(pick)})`;
}

/** Draft slot (column) that owns overall pick `pick` in a snake draft. */
export function snakeSlot(pick: number, teams: number): number {
  const r = roundOf(pick, teams);
  const i = pickInRound(pick, teams);
  return r % 2 === 1 ? i : teams + 1 - i;
}

/** Overall pick number of (round, slot) in a snake draft. */
export function snakePick(round: number, slot: number, teams: number): number {
  return (round - 1) * teams + (round % 2 === 1 ? slot : teams + 1 - slot);
}

/** True when the snake layout agrees with the API's own list of my picks. */
export function gridMatchesApi(session: Session): boolean {
  if (session.my_slot == null) return true;
  const mine = Array.from({ length: session.rounds }, (_, r) => snakePick(r + 1, session.my_slot ?? 1, session.teams));
  return mine.length === session.my_picks.length && mine.every((p, i) => p === session.my_picks[i]);
}

export function teamName(session: Session, slot: number): string {
  const saved = session.team_names?.[String(slot)];
  if (slot === session.my_slot) return 'You';
  return saved && saved.trim() ? saved : `Team ${slot}`;
}

/** My first pick at or after the current pick, from the API's my_picks. */
export function myNextPick(session: Session): number | null {
  const c = session.current_pick;
  if (c == null) return null;
  return session.my_picks.find((p) => p >= c) ?? null;
}
