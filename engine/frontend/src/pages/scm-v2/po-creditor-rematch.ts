import type { BindingRow, MaterialKind } from '../../vendor/scm/lib/suppliers-queries';

export interface RematchableLine {
  itemCode: string;
  bindingId?: string;
  materialKind?: MaterialKind;
  supplierSku?: string;
  unitPriceSen: number;
  priceTouched?: boolean;
  mainSupplierCode?: string | null;
}

export interface CreditorRematch<L> {
  kept: L[];
  removed: L[];
}

/** A changed creditor keeps each line whose SKU it also sells, rebound to its supplier SKU and price; the rest go.
    Lines with no item code carry nothing of the old creditor and stay. A line that follows another main supplier goes. */
export function rematchLinesToCreditor<L extends RematchableLine>(
  lines: readonly L[],
  nextBindings: readonly BindingRow[],
  pickable: readonly BindingRow[],
  nextSupplierCode: string | null,
): CreditorRematch<L> {
  const kept: L[] = [];
  const removed: L[] = [];
  for (const line of lines) {
    const code = line.itemCode.trim();
    if (!code) { kept.push(line); continue; }
    const followsOther = Boolean(line.mainSupplierCode) && line.mainSupplierCode !== nextSupplierCode;
    // Same rule as the picker: a binding on an active SKU wins over one on a retired SKU (HC-0153).
    const binding = followsOther ? undefined
      : pickable.find((b) => b.item_code === code) ?? nextBindings.find((b) => b.item_code === code);
    if (!binding) { removed.push(line); continue; }
    kept.push({
      ...line,
      bindingId: binding.id,
      materialKind: binding.material_kind,
      supplierSku: binding.supplier_sku,
      unitPriceSen: binding.unit_price_sen,
      priceTouched: false,
    });
  }
  return { kept, removed };
}
