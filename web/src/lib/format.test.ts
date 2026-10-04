import { describe, expect, it } from 'vitest';
import { clock, eligibleLabel, MISSING, ordinal, pct, signed, splitReasons } from './format';

describe('pct', () => {
  it('rounds probabilities to whole percents', () => {
    expect(pct(0.734)).toBe('73%');
    expect(pct(0.5)).toBe('50%');
    expect(pct(0)).toBe('0%');
    expect(pct(1)).toBe('100%');
  });
  it('never implies certainty for tiny or near-certain values', () => {
    expect(pct(0.003)).toBe('<1%');
    expect(pct(0.997)).toBe('>99%');
  });
  it('shows a dash for missing values instead of a neutral default', () => {
    expect(pct(null)).toBe(MISSING);
    expect(pct(undefined)).toBe(MISSING);
    expect(pct(Number.NaN)).toBe(MISSING);
  });
});

describe('signed', () => {
  it('formats gains with an explicit sign', () => {
    expect(signed(0.123)).toBe('+0.12');
    expect(signed(-0.04)).toBe('−0.04');
    expect(signed(0)).toBe('±0.00');
    expect(signed(-0.001)).toBe('±0.00');
    expect(signed(null)).toBe(MISSING);
  });
});

describe('clock', () => {
  it('formats seconds as m:ss and clamps at zero', () => {
    expect(clock(60)).toBe('1:00');
    expect(clock(59.2)).toBe('1:00');
    expect(clock(7)).toBe('0:07');
    expect(clock(0.4)).toBe('0:01');
    expect(clock(-3)).toBe('0:00');
  });
});

describe('helpers', () => {
  it('splits engine reasons on semicolons', () => {
    expect(splitReasons('+0.31 expected categories; helps REB +6%;  fills an open C slot ')).toEqual([
      '+0.31 expected categories',
      'helps REB +6%',
      'fills an open C slot',
    ]);
    expect(splitReasons(null)).toEqual([]);
  });
  it('drops Util from eligibility and falls back to position', () => {
    expect(eligibleLabel(['PG', 'G', 'Util'])).toBe('PG, G');
    expect(eligibleLabel([], 'C')).toBe('C');
    expect(eligibleLabel(null, null)).toBe(MISSING);
  });
  it('builds ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 14, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '14th', '21st']);
  });
});
