/* A draft DO may exist before the goods do: the short-stock question waits for Confirm. */
import { describe, expect, it } from 'vitest';
import { shortStockStops } from './check-stock-availability';

describe('shortStockStops', () => {
  const short = [{ itemCode: 'A' }];
  it('stops a confirmed DO that has not said ship anyway', () => {
    expect(shortStockStops(short, {})).toBe(true);
  });
  it('never stops a draft', () => {
    expect(shortStockStops(short, { asDraft: true })).toBe(false);
  });
  it('lets ship anyway through, and nothing short stops nothing', () => {
    expect(shortStockStops(short, { confirmShortStock: true })).toBe(false);
    expect(shortStockStops([], {})).toBe(false);
  });
});
