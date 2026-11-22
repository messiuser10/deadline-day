import { describe, expect, it } from 'vitest';
import { basePrice, marketValue, prices } from '../src';

describe('prices', () => {
  it('matches the spec table', () => {
    const table: [number, number, number][] = [
      [76, 45, 23],
      [78, 52, 26],
      [80, 60, 30],
      [82, 69, 35],
      [84, 80, 40],
      [86, 93, 47],
      [88, 107, 54],
      [90, 124, 62],
      [91, 133, 67],
    ];
    for (const [overall, mv, base] of table) {
      expect(prices(overall)).toEqual({ marketValueM: mv, basePriceM: base });
    }
  });

  it('rounds half up and never goes below 1', () => {
    // 0.5 * 45 = 22.5 rounds up to 23, not down to the even 22.
    expect(basePrice(76)).toBe(23);
    expect(marketValue(1)).toBe(1);
    expect(basePrice(1)).toBe(1);
  });

  it('uses the price curve parameters', () => {
    expect(marketValue(80, { anchor: 100, growth: 1.1, baseFraction: 0.5 })).toBe(100);
    expect(prices(81, { anchor: 100, growth: 1.1, baseFraction: 0.4 })).toEqual({ marketValueM: 110, basePriceM: 44 });
  });
});
