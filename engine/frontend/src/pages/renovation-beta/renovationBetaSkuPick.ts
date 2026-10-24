/* The PO tab's Swap SKU picker, as pure rules: which catalog rows it offers and under which group. The catalog is
   loaded once and filtered here, like the sales order's own SKU picker (SoLineCard), so typing never waits on the
   server. */

import { matchesProductQuery, type MfgProductRow } from "../../vendor/scm/lib/mfg-products-queries";
import { RENOVATION_GROUPS, categoryGroupOf, type CatalogGroup } from "../../vendor/shared/renovation-catalog";

export type PickRow = Pick<MfgProductRow, "id" | "code" | "name" | "category" | "description" | "barcode" | "status" | "sell_price_sen"> &
  Partial<Pick<MfgProductRow, "category_group" | "sub_category" | "primaryThumbUrl" | "primaryPhotoUrl">>;

/** The row's catalog group (the stored group, else derived from its category). */
export function groupOfRow(r: Pick<PickRow, "category" | "category_group">): CatalogGroup | null {
  return categoryGroupOf(r.category_group ?? null) ?? categoryGroupOf(r.category);
}

/** The groups that have at least one offered SKU, in the catalog's own order, with counts. */
export function pickGroups(rows: readonly PickRow[], current: string): Array<{ code: CatalogGroup; label: string; count: number }> {
  const n = new Map<CatalogGroup, number>();
  for (const r of rows) {
    if (!offered(r, current)) continue;
    const g = groupOfRow(r);
    if (g) n.set(g, (n.get(g) ?? 0) + 1);
  }
  return RENOVATION_GROUPS.filter((g) => n.has(g.code)).map((g) => ({ code: g.code, label: g.label, count: n.get(g.code) ?? 0 }));
}

function offered(r: PickRow, current: string): boolean {
  return r.code !== current && String(r.status).toUpperCase() === "ACTIVE";
}

/** The rows to show: active SKUs other than the line's own, in the group (null = all), matching the typed text.
    A typed search looks across every group, so a code typed while a group is chosen is still found. */
export function pickRows(rows: readonly PickRow[], opts: { current: string; group: CatalogGroup | null; query: string }): PickRow[] {
  const q = opts.query.trim();
  return rows
    .filter((r) => offered(r, opts.current))
    .filter((r) => (q ? matchesProductQuery(r, q) : opts.group === null || groupOfRow(r) === opts.group))
    .sort((a, b) => a.code.localeCompare(b.code));
}
