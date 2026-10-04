import { describe, expect, it } from 'vitest';
import type { DraftTeam, PickInsight, PoolPlayer } from '../api/types';
import { latestInsightByTeam, nearestSnap, picksBeforeMe, pp, projPickIndex, strengths } from './draftHelpers';
import { matchesFilter, positionGroup } from './positions';

const p = (id: number, adp: number | null, extra: Partial<PoolPlayer> = {}) => ({ player_id: id, name: `P${id}`, expected_pick: adp, ...extra }) as PoolPlayer;

describe('projPickIndex', () => {
  it('places the divider before the first player expected after my next pick', () => {
    const list = [p(1, 20), p(2, 31.5), p(3, 33), p(4, 33.4), p(5, 40)];
    expect(projPickIndex(list, 33)).toBe(3);
    expect(projPickIndex(list, 10)).toBe(0);
    expect(projPickIndex(list, 99)).toBe(5);
    expect(projPickIndex(list, null)).toBeNull();
  });
});

describe('teams helpers', () => {
  it('orders strengths and weaknesses from z_balance, skipping missing values', () => {
    expect(strengths({ pts: 1.2, reb: -0.8, ast: 0.3, blk: null, tov: -1.5 })).toEqual({ strong: ['pts', 'ast'], weak: ['tov', 'reb'] });
  });
  it('flags teams that pick between now and my next pick', () => {
    const t = (next: number | null, me = false) => ({ next_pick: next, is_me: me }) as DraftTeam;
    expect(picksBeforeMe(t(31), 30, 33)).toBe(true);
    expect(picksBeforeMe(t(30), 30, 33)).toBe(true);
    expect(picksBeforeMe(t(33), 30, 33)).toBe(false);
    expect(picksBeforeMe(t(31, true), 30, 33)).toBe(false);
    expect(picksBeforeMe(t(null), 30, 33)).toBe(false);
  });
  it('keeps the newest insight per team', () => {
    const i = (pick: number, team: number) => ({ pick_no: pick, team_id: team }) as PickInsight;
    const m = latestInsightByTeam([i(3, 3), i(26, 3), i(12, 1)]);
    expect(m.get(3)?.pick_no).toBe(26);
    expect(m.get(1)?.pick_no).toBe(12);
  });
});

describe('sheet and chart helpers', () => {
  it('snaps to the nearest height', () => {
    const h = { collapsed: 100, half: 400, full: 800 };
    expect(nearestSnap(150, h)).toBe('collapsed');
    expect(nearestSnap(500, h)).toBe('half');
    expect(nearestSnap(700, h)).toBe('full');
  });
  it('formats signed percentage points', () => {
    expect(pp(0.031)).toBe('+3.1');
    expect(pp(-0.004)).toBe('−0.4');
    expect(pp(0.0001)).toBe('±0.0');
    expect(pp(null)).toBe('—');
  });
  it('groups positions and filters by eligibility', () => {
    expect(['PG', 'SG', 'SF', 'PF', 'C', 'X'].map(positionGroup)).toEqual(['G', 'G', 'F', 'F', 'C', null]);
    const wing = p(1, 1, { position: 'SG', eligible: ['SG', 'SF', 'G', 'F', 'Util'], rookie: true });
    expect(matchesFilter(wing, 'G')).toBe(true);
    expect(matchesFilter(wing, 'SF')).toBe(true);
    expect(matchesFilter(wing, 'C')).toBe(false);
    expect(matchesFilter(wing, 'ROOKIE')).toBe(true);
  });
});
