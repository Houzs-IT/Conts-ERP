/* A New Purchase Order line raised from Transfer from Production Order carries `productionMaterialId` (owner, 23 Nov
   2026: review in the New PO form before saving). The create handler checks those lines here and links each saved line
   to its material, the way /production-orders/material-pos does: only a submitted order that is not held, the same item,
   and no more than the material still has no live PO for. */
import { orderedByMaterial, type PickerPoLine } from './renovation-material-picker';

export type MaterialForLine = {
  id: string; item_code: string; uom: string | null; qty_needed: number | string;
  order: { po_number: string; status: string; on_hold: boolean; project_id: number | null } | null;
};
export type MaterialLineRefusal = { error: string; reason: string; materialId?: string };
type LineIn = { itemCode?: unknown; qty?: unknown; soItemId?: unknown; productionMaterialId?: unknown };

export const materialIdOf = (it: LineIn): string | null =>
  typeof it.productionMaterialId === 'string' && it.productionMaterialId ? it.productionMaterialId : null;

/** Why these lines cannot be saved, or null. `materials` is what the company can see, `poLines` the PO lines already
    linked to them. A PO line counts whole units, so a material needing 2.5 may take 3. */
export function materialLineRefusal(items: readonly LineIn[], materials: readonly MaterialForLine[], poLines: readonly PickerPoLine[]): MaterialLineRefusal | null {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const ordered = orderedByMaterial(poLines);
  const asked = new Map<string, number>();
  for (const it of items) {
    const id = materialIdOf(it);
    if (!id) continue;
    const m = byId.get(id);
    if (!m?.order) return { error: 'material_not_found', reason: 'A production order material on this PO no longer exists. Open Transfer from Production Order again.', materialId: id };
    if (it.soItemId) return { error: 'material_line_invalid', reason: `${m.item_code}: a line cannot buy for a Sales Order and a production order at once.`, materialId: id };
    if (m.order.status !== 'SUBMITTED' || m.order.on_hold) return { error: 'material_order_not_open', reason: `${m.order.po_number} is not open for ordering, so ${m.item_code} cannot be bought for it.`, materialId: id };
    if (String(it.itemCode ?? '') !== m.item_code) return { error: 'material_line_invalid', reason: `This line is ${String(it.itemCode)} but the production order material is ${m.item_code}.`, materialId: id };
    asked.set(id, (asked.get(id) ?? 0) + Math.max(0, Number(it.qty ?? 0)));
  }
  for (const [id, qty] of asked) {
    const m = byId.get(id)!;
    const left = Math.max(0, Math.ceil(Number(m.qty_needed) - (ordered.get(id) ?? 0)));
    if (qty > left) {
      return {
        error: 'material_qty_exceeds_remaining',
        reason: left > 0
          ? `${m.item_code} for ${m.order!.po_number}: ordering ${qty}, but only ${left} is still to order.`
          : `${m.item_code} for ${m.order!.po_number} is already fully on a PO.`,
        materialId: id,
      };
    }
  }
  return null;
}

/** The project a PO raised only for one project's materials belongs to, else null. */
export function singleMaterialProject(items: readonly LineIn[], materials: readonly MaterialForLine[]): number | null {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const projects = new Set<number | null>();
  for (const it of items) {
    const id = materialIdOf(it);
    if (!id) continue;
    const p = byId.get(id)?.order?.project_id;
    projects.add(p == null ? null : Number(p));
  }
  const [only] = [...projects];
  return projects.size === 1 && only != null ? only : null;
}

/** Read the materials the lines name, scoped to the company, and the PO lines already linked to them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SCM routes carry an untyped supabase-js client
export async function loadMaterialsForLines(sb: any, companyId: number | null, items: readonly LineIn[]): Promise<{ materials: MaterialForLine[]; poLines: PickerPoLine[]; error: string | null }> {
  const ids = [...new Set(items.map(materialIdOf).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return { materials: [], poLines: [], error: null };
  if (companyId == null) return { materials: [], poLines: [], error: null };
  const mats = await sb.from('production_order_materials')
    .select('id, item_code, uom, qty_needed, order:production_orders (po_number, status, on_hold, project_id)')
    .in('id', ids).eq('company_id', companyId);
  if (mats.error) return { materials: [], poLines: [], error: String(mats.error.message) };
  const lines = await sb.from('purchase_order_items').select('production_material_id, qty, po:purchase_orders!inner (status)').in('production_material_id', ids);
  if (lines.error) return { materials: [], poLines: [], error: String(lines.error.message) };
  return { materials: (mats.data ?? []) as MaterialForLine[], poLines: (lines.data ?? []) as PickerPoLine[], error: null };
}

/** The columns a material line adds to its PO line: the link, the material's unit, and from_mrp as production_link_po
    sets it, so the line never counts against a Sales Order's quota. */
export function materialLineFields(materialId: string | null, uomOf: ReadonlyMap<string, string | null>): Record<string, unknown> {
  if (!materialId) return {};
  const uom = uomOf.get(materialId);
  return { production_material_id: materialId, from_mrp: true, ...(uom ? { uom } : {}) };
}
