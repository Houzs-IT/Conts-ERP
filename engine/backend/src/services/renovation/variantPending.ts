/* The sales order lines still waiting for a variant, by the same rule as the project's SO tab (owner, 20 Nov 2026).
   The SO tab picks a line's variant fields from its catalog product (variantCategoryOf: a FURNITURE sofa or bedframe is
   SOFA or BEDFRAME). Renovation lines are all saved with item_group "renovation", so checking item_group alone found
   none and Design > Variants read 0 while the SO tab still asked "Pick variants" on every sofa and bedframe. */

import { variantCategoryOf } from "../../scm/lib/renovation-flow-rules";
import { missingVariantAxes } from "../../scm/shared/so-variant-rule";

export interface VariantLine {
  /** The SO line, so a screen can save its variants (absent where only the count is needed). */
  id?: string;
  docNo?: string | null;
  description?: string | null;
  itemCode: string | null;
  itemGroup: string | null;
  /** The catalog product's category and sub-category; null when the code is not in the catalog. */
  prodCategory: string | null;
  prodSub: string | null;
  variants: Record<string, unknown> | null;
}

/** One line still to pick (owner, 20 Nov 2026: the Variants list shows each SKU, picked there, gone once filled). */
export interface VariantPending {
  itemCode: string;
  missing: string[];
  id?: string;
  docNo?: string | null;
  description?: string | null;
  /** The variant group the picker shows (SOFA, BEDFRAME, ...), as the SO tab's variantCategory. */
  category?: string;
  variants?: Record<string, unknown>;
}

/** The variant group a line is checked against: its catalog product's, else the group saved on the line. */
export function variantGroupOf(l: Pick<VariantLine, "itemGroup" | "prodCategory" | "prodSub">): string {
  const fromCatalog = l.prodCategory ? variantCategoryOf(l.prodCategory, l.prodSub) : null;
  return (fromCatalog ?? l.itemGroup ?? "").toLowerCase();
}

/** Every line missing a required variant, with the fields left to pick in the words the SO tab uses. */
export function pendingVariants(lines: readonly VariantLine[]): VariantPending[] {
  const out: VariantPending[] = [];
  for (const l of lines) {
    const group = variantGroupOf(l);
    const missing = missingVariantAxes(group, l.variants, l.itemCode ?? null).map((a) => a.label);
    if (missing.length === 0) continue;
    out.push({
      itemCode: l.itemCode ?? "", missing,
      ...(l.id !== undefined ? {
        id: l.id, docNo: l.docNo ?? null, description: l.description ?? null,
        category: l.prodCategory ? variantCategoryOf(l.prodCategory, l.prodSub) ?? group.toUpperCase() : group.toUpperCase(),
        variants: l.variants ?? {},
      } : {}),
    });
  }
  return out;
}
