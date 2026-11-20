/* The sales order lines still waiting for a variant, by the same rule as the project's SO tab (owner, 20 Nov 2026).
   The SO tab picks a line's variant fields from its catalog product (variantCategoryOf: a FURNITURE sofa or bedframe is
   SOFA or BEDFRAME). Renovation lines are all saved with item_group "renovation", so checking item_group alone found
   none and Design > Variants read 0 while the SO tab still asked "Pick variants" on every sofa and bedframe. */

import { variantCategoryOf } from "../../scm/lib/renovation-flow-rules";
import { missingVariantAxes } from "../../scm/shared/so-variant-rule";

export interface VariantLine {
  itemCode: string | null;
  itemGroup: string | null;
  /** The catalog product's category and sub-category; null when the code is not in the catalog. */
  prodCategory: string | null;
  prodSub: string | null;
  variants: Record<string, unknown> | null;
}

export interface VariantPending { itemCode: string; missing: string[] }

/** The variant group a line is checked against: its catalog product's, else the group saved on the line. */
export function variantGroupOf(l: Pick<VariantLine, "itemGroup" | "prodCategory" | "prodSub">): string {
  const fromCatalog = l.prodCategory ? variantCategoryOf(l.prodCategory, l.prodSub) : null;
  return (fromCatalog ?? l.itemGroup ?? "").toLowerCase();
}

/** Every line missing a required variant, with the fields left to pick in the words the SO tab uses. */
export function pendingVariants(lines: readonly VariantLine[]): VariantPending[] {
  const out: VariantPending[] = [];
  for (const l of lines) {
    const missing = missingVariantAxes(variantGroupOf(l), l.variants, l.itemCode ?? null).map((a) => a.label);
    if (missing.length > 0) out.push({ itemCode: l.itemCode ?? "", missing });
  }
  return out;
}
