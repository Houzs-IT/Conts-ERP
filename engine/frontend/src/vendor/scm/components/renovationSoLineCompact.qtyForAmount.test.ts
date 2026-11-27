import { describe, expect, it } from 'vitest';
import { qtyForAmount } from './renovationSoLineCompact';

describe('qtyForAmount', () => {
  it('gives the exact whole qty when the amount divides evenly', () => {
    expect(qtyForAmount(45_000, 4_500, 0, false)).toBe(10);
  });

  it('adds the discount back before dividing', () => {
    expect(qtyForAmount(12_000, 1_250, 500, false)).toBe(10);
  });

  it('rounds to the nearest whole qty on a sales order', () => {
    expect(qtyForAmount(5_000, 700, 0, false)).toBe(7);
    expect(qtyForAmount(10_000, 333, 0, false)).toBe(30);
  });

  it('never goes below 1 on a sales order', () => {
    expect(qtyForAmount(100, 199_900, 0, false)).toBe(1);
  });

  it('keeps three decimals on a quotation', () => {
    expect(qtyForAmount(5_000, 700, 0, true)).toBe(7.143);
  });
});
