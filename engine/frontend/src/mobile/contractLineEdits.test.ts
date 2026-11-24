import { describe, expect, it } from 'vitest';
import { contractDiscountSen, contractLineEdits } from './contractLineEdits';

const items = [{ id: 'a', item_code: 'X', qty: 2, unit_price_sen: 1000 }];

describe('the phone edits a contract through its VO route', () => {
  it('a qty change', () => {
    expect(contractLineEdits([{ salesOrderItemId: 'a', changeType: 'QTY', newQty: 3 }], items).edits).toEqual([{ soItemId: 'a', qty: 3 }]);
  });
  it('a removal', () => {
    expect(contractLineEdits([{ salesOrderItemId: 'a', changeType: 'REMOVE' }], items).edits).toEqual([{ soItemId: 'a', remove: true }]);
  });
  it('a new line, with no room on the phone', () => {
    expect(contractLineEdits([{ changeType: 'ADD', newItemCode: 'Y', newQty: 2, newUnitPriceSen: 500 }], items).adds[0]).toMatchObject({ room: '', itemCode: 'Y', qty: 2, unitPriceSen: 500 });
  });
  it('a changed SKU carries its options', () => {
    const out = contractLineEdits([{ salesOrderItemId: 'a', changeType: 'SPEC', newItemCode: 'Z', newVariants: { c: 1 } }], items);
    expect(out.edits).toEqual([{ soItemId: 'a', itemCode: 'Z', variants: { c: 1 }, remark: undefined }]);
  });
  it('options alone are no edit: they save on the line', () => {
    expect(contractLineEdits([{ salesOrderItemId: 'a', changeType: 'SPEC', newVariants: { c: 1 } }], items)).toEqual({ edits: [], adds: [] });
  });
});

describe('the contract discount row', () => {
  const withDiscount = [...items, { id: 'd', item_code: 'RENO-DISCOUNT', qty: 1, unit_price_sen: -897900 }];
  it('the bin removes the discount and sends no line edit', () => {
    expect(contractLineEdits([{ salesOrderItemId: 'd', changeType: 'REMOVE' }], withDiscount)).toEqual({ edits: [], adds: [], discountSen: 0 });
  });
  it('a new negative price is the new discount', () => {
    expect(contractLineEdits([{ salesOrderItemId: 'd', changeType: 'SPEC', newUnitPriceSen: -500000 }], withDiscount).discountSen).toBe(500000);
  });
  it('other lines still go out as edits beside it', () => {
    const out = contractLineEdits([{ salesOrderItemId: 'd', changeType: 'REMOVE' }, { salesOrderItemId: 'a', changeType: 'QTY', newQty: 3 }], withDiscount);
    expect(out).toEqual({ edits: [{ soItemId: 'a', qty: 3 }], adds: [], discountSen: 0 });
  });
  it('a positive price or a qty change on it is refused', () => {
    expect(() => contractDiscountSen([{ salesOrderItemId: 'd', changeType: 'SPEC', newUnitPriceSen: 100 }], withDiscount)).toThrow(/negative amount/);
    expect(() => contractDiscountSen([{ salesOrderItemId: 'd', changeType: 'QTY', newQty: 2 }], withDiscount)).toThrow(/only takes a new amount/);
  });
  it('a discount row a VO already removed is left alone', () => {
    const removed = [{ id: 'd', item_code: 'RENO-DISCOUNT', qty: 1, unit_price_sen: -897900, cancelled: true }];
    expect(contractDiscountSen([{ salesOrderItemId: 'd', changeType: 'REMOVE' }], removed).discountSen).toBeUndefined();
  });
});
