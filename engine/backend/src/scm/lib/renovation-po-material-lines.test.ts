import { describe, expect, it } from 'vitest';
import src from '../routes/mfg-purchase-orders.ts?raw';
import { materialLineFields, materialLineRefusal, singleMaterialProject, type MaterialForLine } from './renovation-po-material-lines';

const mat = (id: string, needed: number, order: Partial<NonNullable<MaterialForLine['order']>> = {}): MaterialForLine => ({
  id, item_code: 'RM-1', uom: 'BAG', qty_needed: needed,
  order: { po_number: 'PRO-1', status: 'SUBMITTED', on_hold: false, project_id: 7, ...order },
});
const line = (qty: number, extra: Record<string, unknown> = {}) => ({ itemCode: 'RM-1', qty, productionMaterialId: 'm1', ...extra });

describe('materialLineRefusal', () => {
  it('lets a line order what is still to order', () => {
    expect(materialLineRefusal([line(6)], [mat('m1', 10)], [{ production_material_id: 'm1', qty: 4, po: { status: 'SUBMITTED' } }])).toBeNull();
  });

  it('refuses more than the material still has no live PO for', () => {
    expect(materialLineRefusal([line(7)], [mat('m1', 10)], [{ production_material_id: 'm1', qty: 4, po: { status: 'DRAFT' } }]))
      .toMatchObject({ error: 'material_qty_exceeds_remaining' });
  });

  it('does not count a cancelled PO against the material', () => {
    expect(materialLineRefusal([line(10)], [mat('m1', 10)], [{ production_material_id: 'm1', qty: 10, po: { status: 'CANCELLED' } }])).toBeNull();
  });

  it('adds up two lines for the same material and rounds a part unit up', () => {
    expect(materialLineRefusal([line(2), line(1)], [mat('m1', 2.5)], [])).toBeNull();
    expect(materialLineRefusal([line(2), line(2)], [mat('m1', 2.5)], [])).toMatchObject({ error: 'material_qty_exceeds_remaining' });
  });

  it('refuses a material of another company, a closed or held order, another item, or an SO link', () => {
    expect(materialLineRefusal([line(1)], [], [])).toMatchObject({ error: 'material_not_found' });
    expect(materialLineRefusal([line(1)], [mat('m1', 5, { status: 'RECEIVED' })], [])).toMatchObject({ error: 'material_order_not_open' });
    expect(materialLineRefusal([line(1)], [mat('m1', 5, { on_hold: true })], [])).toMatchObject({ error: 'material_order_not_open' });
    expect(materialLineRefusal([line(1, { itemCode: 'RM-2' })], [mat('m1', 5)], [])).toMatchObject({ error: 'material_line_invalid' });
    expect(materialLineRefusal([line(1, { soItemId: 's1' })], [mat('m1', 5)], [])).toMatchObject({ error: 'material_line_invalid' });
  });

  it('ignores lines without a material', () => {
    expect(materialLineRefusal([{ itemCode: 'X', qty: 99 }], [], [])).toBeNull();
  });
});

describe('materialLineFields / singleMaterialProject', () => {
  it('links the line and takes the material unit', () => {
    expect(materialLineFields('m1', new Map([['m1', 'BAG']]))).toEqual({ production_material_id: 'm1', from_mrp: true, uom: 'BAG' });
    expect(materialLineFields(null, new Map())).toEqual({});
  });
  it('names the project only when every material line shares it', () => {
    expect(singleMaterialProject([line(1)], [mat('m1', 5)])).toBe(7);
    expect(singleMaterialProject([line(1), { ...line(1), productionMaterialId: 'm2' }], [mat('m1', 5), { ...mat('m2', 5), order: { po_number: 'PRO-2', status: 'SUBMITTED', on_hold: false, project_id: 8 } }])).toBeNull();
  });
});

describe('PO create handler', () => {
  it('checks and links Transfer from Production Order lines', () => {
    const handler = src.slice(src.indexOf('export const createMfgPurchaseOrderHandler'), src.indexOf("mfgPurchaseOrders.post('/', createMfgPurchaseOrderHandler)"));
    expect(handler).toContain('materialLineRefusal(items, matLoad.materials, matLoad.poLines)');
    expect(handler).toContain('...materialLineFields(materialIdOf(it), materialUom)');
  });
});
