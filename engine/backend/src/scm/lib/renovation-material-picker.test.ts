import { describe, expect, it } from 'vitest';
import { materialsToOrder, orderedByMaterial, type PickerMaterial } from './renovation-material-picker';

const mat = (id: string, needed: number, extra: Partial<PickerMaterial> = {}): PickerMaterial => ({
  id, production_order_id: 'o1', item_code: `RM-${id}`, description: null, uom: 'PCS', qty_needed: needed,
  processing_date: null, delivery_date: null, ...extra,
});
const orders = new Map([['o1', { id: 'o1', po_number: 'PRO-2611-001', project_id: 7 }]]);

describe('materialsToOrder', () => {
  it('takes qty on a live PO off what is still to order', () => {
    const rows = materialsToOrder({
      materials: [mat('a', 10)], orders, mainSupplierOf: new Map(),
      poLines: [{ production_material_id: 'a', qty: 4, po: { status: 'SUBMITTED' } }, { production_material_id: 'a', qty: 1, po: { status: 'DRAFT' } }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qtyNeeded: 10, qtyOrdered: 5, qtyToOrder: 5 });
  });

  it('does not count lines on a cancelled PO, so the material shows again', () => {
    const rows = materialsToOrder({
      materials: [mat('a', 3)], orders, mainSupplierOf: new Map(),
      poLines: [{ production_material_id: 'a', qty: 3, po: { status: 'CANCELLED' } }],
    });
    expect(rows[0]).toMatchObject({ qtyOrdered: 0, qtyToOrder: 3 });
  });

  it('leaves out a fully ordered material and one whose order is not open', () => {
    const rows = materialsToOrder({
      materials: [mat('a', 2), mat('b', 2, { production_order_id: 'closed' })], orders, mainSupplierOf: new Map(),
      poLines: [{ production_material_id: 'a', qty: 2, po: { status: 'RECEIVED' } }],
    });
    expect(rows).toEqual([]);
  });

  it('carries the main supplier, project and SO numbers', () => {
    const rows = materialsToOrder({
      materials: [mat('a', 1)], orders, poLines: [],
      mainSupplierOf: new Map([['RM-a', { id: 's1', code: 'SUP1', name: 'Supplier One' }]]),
      projectOf: new Map([[7, { code: 'RN-1', name: 'Unit 1' }]]),
      soDocsOf: new Map([['o1', ['SO-1']]]),
    });
    expect(rows[0]).toMatchObject({ mainSupplierCode: 'SUP1', projectCode: 'RN-1', soDocNos: ['SO-1'], productionOrderNo: 'PRO-2611-001' });
  });
});

describe('orderedByMaterial', () => {
  it('sums per material and skips a line whose PO is gone', () => {
    expect([...orderedByMaterial([
      { production_material_id: 'a', qty: '1.5', po: { status: 'SUBMITTED' } },
      { production_material_id: 'a', qty: 2, po: null },
    ])]).toEqual([['a', 1.5]]);
  });
});
