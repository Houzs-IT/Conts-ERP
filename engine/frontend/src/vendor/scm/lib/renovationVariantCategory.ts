/* The category that picks a SKU's variant fields on the SO line. The renovation catalog files a sofa or bedframe
   as FURNITURE with sub-category SOFA or BEDFRAME, so the sub-category decides there (owner, 1 Nov 2026: the SO
   shows what the picked SKU has). Same rule as backend scm/lib/renovation-flow-rules.ts variantCategoryOf. */
export function variantCategoryOf(category: string | null | undefined, subCategory: string | null | undefined): string {
  const sub = String(subCategory ?? "").toUpperCase();
  if (String(category ?? "").toUpperCase() === "FURNITURE" && (sub === "SOFA" || sub === "BEDFRAME")) return sub;
  return String(category ?? "");
}
