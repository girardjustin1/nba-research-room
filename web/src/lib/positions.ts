import type { Player, PositionKey } from '../api/types';

export const POSITIONS: PositionKey[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/**
 * Position colors are by GROUP (guards / forwards / centers), not per position. The draft
 * grid lets any two colors sit side by side (an all-pairs form), and the dataviz validator
 * shows no five documented hues stay distinguishable there in both modes; three do:
 *   light #2a78d6,#eb6834,#1baf7a  all-pairs PASS (CVD dE 9.2, normal 24.0; aqua < 3:1 -> labels)
 *   dark  #3987e5,#d95926,#199e70  all-pairs PASS (CVD dE 9.4, normal 20.9)
 * Every cell and badge prints the exact position (PG, SG, ...) so color is never the only cue.
 */
export type PositionGroup = 'G' | 'F' | 'C';

export const GROUP_LABEL: Record<PositionGroup, string> = { G: 'Guards', F: 'Forwards', C: 'Centers' };

export function positionGroup(pos: string | null | undefined): PositionGroup | null {
  if (!pos) return null;
  if (pos === 'PG' || pos === 'SG' || pos === 'G') return 'G';
  if (pos === 'SF' || pos === 'PF' || pos === 'F') return 'F';
  if (pos === 'C') return 'C';
  return null;
}

export const GROUP_COLORS: Record<'light' | 'dark', Record<PositionGroup, string>> = {
  light: { G: '#2a78d6', F: '#eb6834', C: '#1baf7a' },
  dark: { G: '#3987e5', F: '#d95926', C: '#199e70' },
};

export type PosFilter = 'ALL' | PositionKey | 'G' | 'F' | 'ROOKIE';
export const POS_FILTERS: PosFilter[] = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'ROOKIE'];

/** Eligibility filter for the Available list (G = any guard slot, F = any forward slot). */
export function matchesFilter(p: Player, f: PosFilter): boolean {
  if (f === 'ALL') return true;
  if (f === 'ROOKIE') return p.rookie === true;
  const e = p.eligible ?? (p.position ? [p.position] : []);
  if (f === 'G') return e.some((s) => s === 'PG' || s === 'SG' || s === 'G');
  if (f === 'F') return e.some((s) => s === 'SF' || s === 'PF' || s === 'F');
  return e.includes(f) || p.position === f;
}
