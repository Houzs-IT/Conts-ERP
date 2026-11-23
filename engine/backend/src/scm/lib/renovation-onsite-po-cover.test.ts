import { describe, expect, it } from 'vitest';
import { onSiteLinesWithNothingComing } from './renovation-onsite-po-cover';

const line = (over: Partial<{ soItemId: string | null; itemCode: string; qty: number; warehouseId: string }> = {}) =>
  ({ soItemId: 'so-1', itemCode: 'RN-PAINTING', qty: 1, warehouseId: 'onsite', ...over });
const works = new Set(['RN-PAINTING']);

describe('a Works line shipping from On-site (click sweep 2, G4)', () => {
  it('with no PO, no production order and nothing on site is short', () => {
    expect(onSiteLinesWithNothingComing([line()], works, new Set(), new Map())).toHaveLength(1);
  });
  it('with its PO or production order raised is not: the delivery receives it on site', () => {
    expect(onSiteLinesWithNothingComing([line()], works, new Set(['so-1']), new Map())).toEqual([]);
  });
  it('with the goods already on site is not', () => {
    expect(onSiteLinesWithNothingComing([line()], works, new Set(), new Map([['onsite::RN-PAINTING', 1]]))).toEqual([]);
  });
  it('a negative on-site balance covers nothing', () => {
    expect(onSiteLinesWithNothingComing([line()], works, new Set(), new Map([['onsite::RN-PAINTING', -1]]))).toHaveLength(1);
  });
  it('goods that pool are left to the pooled check', () => {
    expect(onSiteLinesWithNothingComing([line({ itemCode: 'SOFA-1' })], works, new Set(), new Map())).toEqual([]);
  });
});
