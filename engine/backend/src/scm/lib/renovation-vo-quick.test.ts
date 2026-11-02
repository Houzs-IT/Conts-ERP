import { describe, expect, it } from 'vitest';
import { quickVoLines } from './renovation-vo';
import type { DocLineOut } from './renovation-doc-lines';

const t = {
  id: 'L1', parentId: null, kind: 'ITEM', sortOrder: 1, room: 'Living', itemCode: 'SOF-1', description: 'Sofa', qty: 2, measureMilli: null,
  measureUom: null, uom: 'UNIT', unitPriceSen: 100000, listPriceSen: null, discountBp: 0, amountOverrideSen: null, isFoc: false, supplyByOwner: false,
  highlight: 'NONE', supplierId: 'S1', unitCostSen: 50000, stageCode: null, pageBreakBefore: false, voChange: null, omitTargetLineId: null, omitQty: null,
  measure: null, baseSen: 200000, netSen: 200000, overridden: false, soItemId: 'I1', voId: null, omittedByVoId: null,
} as DocLineOut;
const prod = { name: 'Sofa 2', costSen: 60000, supplierId: 'S2', uom: 'UNIT' };

describe('quickVoLines', () => {
  it('nothing changed: no VO lines', () => {
    expect(quickVoLines(t, { soItemId: 'I1', qty: 2 }, false, null)).toBeNull();
  });
  it('fewer of the same: omits the difference only', () => {
    const r = quickVoLines(t, { soItemId: 'I1', qty: 1 }, true, null)!;
    expect(r.add).toBeNull();
    expect(r.omit).toMatchObject({ voChange: 'OMIT', omitTargetLineId: 'L1', omitQty: 1 });
  });
  it('more of the same on a line a PO buys: adds the difference, keeps the line', () => {
    const r = quickVoLines(t, { soItemId: 'I1', qty: 5 }, true, null)!;
    expect(r.omit).toBeNull();
    expect(r.add).toMatchObject({ voChange: 'ADD', itemCode: 'SOF-1', qty: 3, room: 'Living', unitPriceSen: 100000 });
  });
  it('more of the same with no PO: replaces the line at the new qty', () => {
    const r = quickVoLines(t, { soItemId: 'I1', qty: 5 }, false, null)!;
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ qty: 5, itemCode: 'SOF-1' });
  });
  it('another SKU: omits whole, adds the new product at the old price', () => {
    const r = quickVoLines(t, { soItemId: 'I1', itemCode: 'SOF-2' }, false, prod)!;
    expect(r.sameSku).toBe(false);
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ itemCode: 'SOF-2', description: 'Sofa 2', qty: 2, unitPriceSen: 100000, supplierId: 'S2', unitCostSen: 60000 });
  });
  it('another price: replaces the line', () => {
    const r = quickVoLines(t, { soItemId: 'I1', unitPriceSen: 120000 }, true, null)!;
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ qty: 2, unitPriceSen: 120000 });
  });
  it('a measured line is replaced whole, never partly omitted', () => {
    const r = quickVoLines({ ...t, measureMilli: 5000 }, { soItemId: 'I1', qty: 1 }, false, null)!;
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ qty: 1, measureMilli: 5000 });
  });
});
