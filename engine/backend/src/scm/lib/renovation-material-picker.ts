/* Purchase Orders > Transfer from Production Order (owner, 23 Nov 2026): the raw materials open production orders still
   need bought. Pure, so the "to order" rule is tested without a database. */

export type PickerMaterial = {
  id: string; production_order_id: string; item_code: string; description: string | null; uom: string | null;
  qty_needed: number | string; processing_date: string | null; delivery_date: string | null;
};
export type PickerOrder = { id: string; po_number: string; project_id: number | null };
export type PickerPoLine = { production_material_id: string; qty: number | string | null; po: { status: string } | null };
export type PickerSupplier = { id: string; code: string; name: string | null };

export type MaterialToOrder = {
  materialId: string; productionOrderId: string; productionOrderNo: string;
  projectId: number | null; projectCode: string | null; projectName: string | null; soDocNos: string[];
  itemCode: string; description: string | null; uom: string | null;
  qtyNeeded: number; qtyOrdered: number; qtyToOrder: number;
  processingDate: string | null; deliveryDate: string | null;
  mainSupplierId: string | null; mainSupplierCode: string | null; mainSupplierName: string | null;
};

/** Qty already on a PO that still stands, per material. A cancelled PO buys nothing, so its lines free the qty again. */
export function orderedByMaterial(lines: readonly PickerPoLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.po || l.po.status === 'CANCELLED') continue;
    out.set(l.production_material_id, (out.get(l.production_material_id) ?? 0) + Number(l.qty ?? 0));
  }
  return out;
}

export function materialsToOrder(input: {
  materials: readonly PickerMaterial[];
  orders: ReadonlyMap<string, PickerOrder>;
  poLines: readonly PickerPoLine[];
  mainSupplierOf: ReadonlyMap<string, PickerSupplier>;
  projectOf?: ReadonlyMap<number, { code: string | null; name: string | null }>;
  soDocsOf?: ReadonlyMap<string, string[]>;
}): MaterialToOrder[] {
  const ordered = orderedByMaterial(input.poLines);
  const out: MaterialToOrder[] = [];
  for (const m of input.materials) {
    const order = input.orders.get(m.production_order_id);
    if (!order) continue;
    const needed = Number(m.qty_needed) || 0;
    const onPo = ordered.get(m.id) ?? 0;
    const toOrder = Math.round(Math.max(0, needed - onPo) * 1000) / 1000;
    if (toOrder <= 0) continue;
    const sup = input.mainSupplierOf.get(m.item_code) ?? null;
    const project = order.project_id == null ? null : input.projectOf?.get(order.project_id) ?? null;
    out.push({
      materialId: m.id, productionOrderId: order.id, productionOrderNo: order.po_number,
      projectId: order.project_id, projectCode: project?.code ?? null, projectName: project?.name ?? null,
      soDocNos: input.soDocsOf?.get(order.id) ?? [],
      itemCode: m.item_code, description: m.description, uom: m.uom,
      qtyNeeded: needed, qtyOrdered: onPo, qtyToOrder: toOrder,
      processingDate: m.processing_date, deliveryDate: m.delivery_date,
      mainSupplierId: sup?.id ?? null, mainSupplierCode: sup?.code ?? null, mainSupplierName: sup?.name ?? null,
    });
  }
  return out.sort((a, b) => (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999')
    || a.productionOrderNo.localeCompare(b.productionOrderNo) || a.itemCode.localeCompare(b.itemCode));
}
