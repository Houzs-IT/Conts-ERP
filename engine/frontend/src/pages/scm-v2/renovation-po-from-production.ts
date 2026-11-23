// Transfer from Production Order -> New Purchase Order (owner, 23 Nov 2026: review in the New PO form, then Save).
// The picker hands its ticked rows over under poFromProductionPicks; the form turns each into the same pick shape the
// From-SO picker sends, carrying the material id that the saved PO line keeps.
import type { MaterialToOrder } from '../../vendor/scm/lib/production-order-queries';

export type ProductionPick = MaterialToOrder & { _pickQty: number };

export function formPickOfProduction(p: ProductionPick) {
  return {
    itemCode: p.itemCode,
    description: p.description,
    remainingQty: Math.ceil(p.qtyToOrder),
    qty: p.qtyNeeded,
    _pickQty: p._pickQty,
    variants: {},
    itemGroup: null,
    lineDeliveryDate: p.deliveryDate,
    deliveryDate: null,
    salesLocation: p.warehouseCode,
    soItemId: null,
    mainSupplierCode: p.mainSupplierCode,
    productionMaterialId: p.materialId,
  };
}

/** Bind every material code on these lines to the supplier, one ask per code. The server keeps an existing binding and
    makes the first binding of a SKU its main supplier (suppliers.ts POST /:id/bindings). */
export async function bindMaterialsTo(
  supplierId: string,
  lines: ReadonlyArray<{ itemCode: string; materialName: string }>,
  bind: (b: { supplierId: string; materialKind: 'mfg_product'; itemCode: string; materialName: string; supplierSku: string; isMainSupplier: boolean }) => Promise<unknown>,
): Promise<void> {
  const seen = new Set<string>();
  for (const l of lines) {
    const code = l.itemCode.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    await bind({ supplierId, materialKind: 'mfg_product', itemCode: code, materialName: l.materialName || code, supplierSku: code, isMainSupplier: false });
  }
}

/** One supplier per PO, as on Pick Sales Orders: once a bound line is ticked, other suppliers' lines lock; unbound lines
    never lock. */
export function lockedSupplierOf(rows: ReadonlyArray<Pick<MaterialToOrder, 'materialId' | 'mainSupplierCode'>>, picked: ReadonlySet<string>): string | null {
  for (const r of rows) if (picked.has(r.materialId) && r.mainSupplierCode) return r.mainSupplierCode;
  return null;
}
export const isLockedOut = (r: Pick<MaterialToOrder, 'materialId' | 'mainSupplierCode'>, locked: string | null, picked: ReadonlySet<string>): boolean =>
  Boolean(r.mainSupplierCode && locked && r.mainSupplierCode !== locked && !picked.has(r.materialId));
