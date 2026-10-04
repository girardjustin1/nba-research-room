import { describe, expect, it } from 'vitest';
import { lineupNormal } from '../../mocks/team-builder/lineup';
import { MOVE_ADD_BRAMWELL, MOVE_BENCH_ROSSWELL, MOVE_START_PELLHAM } from '../../mocks/team-builder/moves';
import { waiversNormal } from '../../mocks/team-builder/waivers';
import { feedNormal } from '../../mocks/team-player-analysis/feed';
import { SEASON_CATEGORIES } from '../../mocks/foundations/seasonCommon';
import { binColor, binIndex, inkOn, SEQUENTIAL } from './heatScale';
import {
  addDays,
  ago,
  buildLineupGrid,
  catDeltaLine,
  cellLabel,
  countByKind,
  dateRange,
  deadlineLabel,
  etClock,
  etDate,
  filterFeed,
  filterWaivers,
  formatValue,
  mondayOf,
  monthWeeks,
  moveTitle,
  pctRange,
  ptsDelta,
  signedNum,
  statValue,
  until,
  weekdayOf,
  whenLabel,
  worstLevel,
} from './seasonFormat';

describe('number formatting', () => {
  it('prints probability changes as signed percentage points with a real minus', () => {
    expect(ptsDelta(0.042)).toBe('+4.2 pts');
    expect(ptsDelta(-0.06)).toBe('−6.0 pts');
    expect(ptsDelta(0.0004)).toBe('±0.0 pts');
    expect(ptsDelta(0.11, 0, '')).toBe('+11');
    expect(ptsDelta(null)).toBe('—');
  });
  it('signed numbers, ranges, stats', () => {
    expect(signedNum(1.25)).toBe('+1.3');
    expect(signedNum(-2)).toBe('−2.0');
    expect(pctRange(0.45, 0.59)).toBe('45–59%');
    expect(pctRange(null, 0.5)).toBe('—');
    expect(statValue(0.4712, true)).toBe('.471');
    expect(statValue(83, false)).toBe('83');
    expect(statValue(32.8, false)).toBe('32.8');
  });
  it('formatValue covers every format and shows missing as a dash', () => {
    expect(formatValue(0.62, 'prob')).toBe('62%');
    expect(formatValue(0.046, 'prob_delta')).toBe('+4.6 pts');
    expect(formatValue(28.94, 'minutes')).toBe('28.9 min');
    expect(formatValue(0.205, 'percent')).toBe('20.5%');
    expect(formatValue(3, 'count')).toBe('3');
    expect(formatValue(4.84, 'decimal')).toBe('4.8');
    expect(formatValue(0.23, 'signed')).toBe('+0.2');
    expect(formatValue(29, 'rank')).toBe('29th');
    expect(formatValue(null, 'prob')).toBe('—');
  });
});

describe('league time', () => {
  it('reads timestamps in Eastern time regardless of the machine', () => {
    expect(etDate('2026-11-19T02:30:00Z')).toBe('2026-11-18');
    expect(etClock('2026-11-18T20:00:00-05:00')).toBe('8:00 pm');
    expect(weekdayOf('2026-11-18')).toBe('Wed');
    expect(dateRange('2026-11-16', '2026-11-22')).toBe('Nov 16–22');
    expect(dateRange('2027-02-15', '2027-02-28')).toBe('Feb 15–28');
    expect(dateRange('2026-11-30', '2026-12-06')).toBe('Nov 30–Dec 6');
  });
  it('labels deadlines relative to today', () => {
    expect(deadlineLabel({ kind: 'lineup_lock', at: '2026-11-18T20:00:00-05:00' }, '2026-11-18')).toBe('Lock at 8:00 pm ET today');
    expect(deadlineLabel({ kind: 'waiver_clears', at: '2026-11-20T03:00:00-05:00' }, '2026-11-18')).toBe('Waiver clears Fri 3:00 am ET');
    expect(deadlineLabel({ kind: 'add_before_game', at: '2026-11-19T20:00:00-05:00' }, '2026-11-18')).toBe('Add before tomorrow 8:00 pm ET (first game)');
    expect(whenLabel('2026-11-18T19:00:00-05:00', '2026-11-18')).toBe('today 7:00 pm ET');
  });
  it('relative ages use the response clock', () => {
    const now = '2026-11-18T17:42:00-05:00';
    expect(ago('2026-11-18T17:42:00-05:00', now)).toBe('just now');
    expect(ago('2026-11-18T17:31:00-05:00', now)).toBe('11m ago');
    expect(ago('2026-11-18T06:31:00-05:00', now)).toBe('11h ago');
    expect(ago('2026-11-16T06:52:00-05:00', now)).toBe('Mon');
    expect(until('2026-11-18T18:30:00-05:00', now)).toBe('in 48m');
    expect(until('2026-11-18T17:00:00-05:00', now)).toBe('due now');
  });
  it('calendar math is Monday-first and covers whole months', () => {
    expect(mondayOf('2026-11-18')).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02');
    const weeks = monthWeeks('2026-11');
    expect(weeks[0]![0]).toBe('2026-10-26');
    expect(weeks.at(-1)![6]).toBe('2026-12-06');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe('labels', () => {
  it('move titles and category delta lines', () => {
    expect(moveTitle(MOVE_ADD_BRAMWELL)).toBe('Add Callum Bramwell, drop Bram Venhaus');
    expect(moveTitle(MOVE_START_PELLHAM)).toBe('Start Isaac Pellham over Jalen Ferrante');
    expect(moveTitle(MOVE_BENCH_ROSSWELL)).toBe('Bench Wes Rosswell');
    expect(catDeltaLine(MOVE_ADD_BRAMWELL.cat_deltas, SEASON_CATEGORIES, 3)).toBe('BLK +11 · REB +6 · 3PTM −4');
  });
  it('worst confidence level', () => {
    expect(worstLevel(['high', 'medium', 'high'])).toBe('medium');
    expect(worstLevel(['high', 'none'])).toBe('none');
    expect(worstLevel([])).toBe('high');
  });
});

describe('reshaping', () => {
  it('feed filters keep order and count by kind', () => {
    const counts = countByKind(feedNormal.items);
    expect(counts.all).toBe(feedNormal.items.length);
    expect(counts.news + counts.market + counts.model + counts.data).toBe(counts.all);
    expect(filterFeed(feedNormal.items, 'market').every((i) => i.kind === 'market')).toBe(true);
  });
  it('waiver filters by eligibility and category help, keeping engine rank', () => {
    const c = filterWaivers(waiversNormal.candidates, 'C', 'all');
    expect(c.map((x) => x.player.name)).toEqual(['Callum Bramwell', 'Ravi Hargreave', 'Omar Quillan']);
    const ast = filterWaivers(waiversNormal.candidates, 'all', 'ast');
    expect(ast.every((x) => x.cats_helped.includes('ast'))).toBe(true);
    expect(ast.map((x) => x.rank)).toEqual([...ast.map((x) => x.rank)].sort((a, b) => a - b));
  });
  it('lineup grid marks real start/sit changes apart from slot shuffles', () => {
    const rest = lineupNormal.days.slice(1);
    const rows = buildLineupGrid(rest, lineupNormal.roster);
    const lind = rows.find((r) => r.player.name === 'Anders Lindqvist')!;
    const thu = lind.cells[0]!;
    expect(thu.state).toBe('start');
    expect(thu.changed).toBe(true);
    expect(cellLabel(thu)).toBe('C');
    const ross = rows.find((r) => r.player.name === 'Wes Rosswell')!;
    const fri = ross.cells[1]!;
    expect(fri.state).toBe('bench');
    expect(fri.changed).toBe(true);
    const ash = rows.find((r) => r.player.name === 'Rennick Ashgrove')!;
    expect(cellLabel(ash.cells[0]!)).toBe('–');
    expect(rows.every((r) => r.cells.length === rest.length)).toBe(true);
  });
});

describe('heat scale', () => {
  it('bins sequential values into fifths and clamps', () => {
    expect(binIndex(0, 'sequential', 0, 25)).toBe(0);
    expect(binIndex(12.5, 'sequential', 0, 25)).toBe(2);
    expect(binIndex(99, 'sequential', 0, 25)).toBe(4);
    expect(binColor(30, 'sequential', 0, 25, 'light')).toBe(SEQUENTIAL.light[4]);
  });
  it('bins diverging values symmetrically about zero', () => {
    expect(binIndex(-4, 'diverging', -4, 4)).toBe(0);
    expect(binIndex(0.3, 'diverging', -4, 4)).toBe(2);
    expect(binIndex(3, 'diverging', -4, 4)).toBe(4);
  });
  it('picks the higher-contrast ink for a fill', () => {
    expect(inkOn('#104281')).toBe('#ffffff');
    expect(inkOn('#86b6ef')).toBe('#0b0b0b');
  });
});
