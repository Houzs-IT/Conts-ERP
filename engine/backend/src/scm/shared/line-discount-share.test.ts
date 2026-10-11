import { describe, expect, it } from 'vitest';
import { lineDiscountShare } from './line-discount-share';

describe('lineDiscountShare (C5: a line discount carries through, in proportion)', () => {
  it('a whole-line move carries the whole discount', () => {
    expect(lineDiscountShare(4000, 2, 0, 2)).toBe(4000);
  });

  it('two halves carry half each, never the whole discount twice', () => {
    expect(lineDiscountShare(4000, 2, 0, 1)).toBe(2000);
    expect(lineDiscountShare(4000, 2, 1, 1)).toBe(2000);
  });

  it('uneven splits add up to the discount exactly, the last piece taking the rounding', () => {
    const pieces = [1, 1, 1].map((q, i) => lineDiscountShare(1000, 3, i, q));
    expect(pieces.reduce((s, v) => s + v, 0)).toBe(1000);
    expect(pieces).toEqual([333, 334, 333]);
  });

  it('over-delivery past the line quantity carries nothing', () => {
    expect(lineDiscountShare(4000, 2, 2, 1)).toBe(0);
    expect(lineDiscountShare(4000, 2, 1, 5)).toBe(2000);
  });

  it('no discount, or a line with no quantity, carries nothing', () => {
    expect(lineDiscountShare(0, 2, 0, 1)).toBe(0);
    expect(lineDiscountShare(500, 0, 0, 1)).toBe(0);
  });
});
