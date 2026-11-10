import { describe, expect, it } from 'vitest';
import { contractLineEdits } from './contractLineEdits';

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
