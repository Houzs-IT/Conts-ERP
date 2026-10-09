/* The default PO party of a SKU (renovation catalog, spec 2026-10-09 section 3
   "Binding"). Each SKU binds one main supplier (subcontractors are suppliers
   too) with its cost; that binding pre-fills a quotation / SO line's supplier
   and cost, and the SO -> PO split groups lines by it. A line may override it.

   Rule: the main binding; else the only binding; else none (the line must pick).
   Two mains cannot exist after migration 0063, but if a read ever returns two
   the answer is "no default", never whichever came first. */

export interface BindingForParty {
  id: string;
  supplier_id: string;
  is_main_supplier: boolean | null;
  unit_price_sen: number | null;
}

export interface DefaultParty {
  supplierId: string;
  bindingId: string;
  unitPriceSen: number;
  source: 'main' | 'only';
}

export function resolveDefaultParty(bindings: readonly BindingForParty[]): DefaultParty | null {
  const mains = bindings.filter((b) => b.is_main_supplier === true);
  const pick = mains.length === 1 ? mains[0] : mains.length === 0 && bindings.length === 1 ? bindings[0] : null;
  if (!pick) return null;
  return {
    supplierId: pick.supplier_id,
    bindingId: pick.id,
    unitPriceSen: pick.unit_price_sen ?? 0,
    source: mains.length === 1 ? 'main' : 'only',
  };
}
