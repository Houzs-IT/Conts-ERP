import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { bindMaterialsTo, formPickOfProduction, isLockedOut, lockedSupplierOf, type ProductionPick } from './renovation-po-from-production';

const row = (id: string, supplier: string | null, extra: Partial<ProductionPick> = {}): ProductionPick => ({
  materialId: id, productionOrderId: 'o1', productionOrderNo: 'PRO-1', projectId: null, projectCode: null, projectName: null, soDocNos: [],
  itemCode: `RM-${id}`, description: 'Plywood', uom: 'PCS', qtyNeeded: 10, qtyOrdered: 4, qtyToOrder: 5.5,
  processingDate: null, deliveryDate: '2026-12-01', mainSupplierId: supplier ? `id-${supplier}` : null, mainSupplierCode: supplier, mainSupplierName: null, warehouseCode: 'CONTS-WH',
  _pickQty: 3, ...extra,
});

describe('formPickOfProduction', () => {
  it('carries the material id and pick qty into the New PO form, with no SO link', () => {
    expect(formPickOfProduction(row('a', 'SUP1'))).toMatchObject({
      itemCode: 'RM-a', _pickQty: 3, remainingQty: 6, soItemId: null, productionMaterialId: 'a', mainSupplierCode: 'SUP1', lineDeliveryDate: '2026-12-01', salesLocation: 'CONTS-WH',
    });
  });
});

describe('one supplier per PO', () => {
  it('locks other suppliers once a bound line is ticked; unbound lines never lock', () => {
    const rows = [row('a', 'SUP1'), row('b', 'SUP2'), row('c', null)];
    const picked = new Set(['a']);
    const locked = lockedSupplierOf(rows, picked);
    expect(locked).toBe('SUP1');
    expect(isLockedOut(rows[1]!, locked, picked)).toBe(true);
    expect(isLockedOut(rows[2]!, locked, picked)).toBe(false);
    expect(lockedSupplierOf(rows, new Set(['c']))).toBeNull();
  });
});

describe('bindMaterialsTo', () => {
  it('binds each code once to the new supplier', async () => {
    const bind = vi.fn().mockResolvedValue({});
    await bindMaterialsTo('s9', [{ itemCode: 'RM-a', materialName: 'A' }, { itemCode: 'RM-a', materialName: 'A' }, { itemCode: 'RM-b', materialName: '' }], bind);
    expect(bind.mock.calls.map((c) => c[0])).toEqual([
      { supplierId: 's9', materialKind: 'mfg_product', itemCode: 'RM-a', materialName: 'A', supplierSku: 'RM-a', isMainSupplier: false },
      { supplierId: 's9', materialKind: 'mfg_product', itemCode: 'RM-b', materialName: 'RM-b', supplierSku: 'RM-b', isMainSupplier: false },
    ]);
  });
});

describe('New PO form', () => {
  it('reads the production picks and sends each line its material id', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'PurchaseOrderNew.tsx'), 'utf8');
    expect(src).toContain("readScmHandoff<ProductionPick[]>('poFromProductionPicks')");
    expect(src).toContain('productionMaterialId: l.productionMaterialId ?? null');
  });
});
