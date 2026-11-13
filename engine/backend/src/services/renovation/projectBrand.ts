/* A renovation project's brand (chew, 10 Nov 2026): Dream Crafter or The Conts, chosen when the project opens, or
   taken from the sales order a project is opened from. The brand brings its finance type, the control the customer
   is opened under: Dream Crafter → RENOVATION (301 / 480), The Conts → INHOUSE_RENOVATION (302 / 481), as
   public.project_brands.finance_kind says. Both stay changeable on the project until there is a contract. */

import type { Db } from "./load";

export type RenoFinanceKind = "RENOVATION" | "INHOUSE_RENOVATION";
export type ProjectBrand = { id: number; name: string; financeKind: RenoFinanceKind | null };

const kindOf = (v: unknown): RenoFinanceKind | null => (v === "RENOVATION" || v === "INHOUSE_RENOVATION" ? v : null);
const BRAND_COLS = "id::int AS id, name, finance_kind";
type BrandRow = { id: number; name: string; finance_kind: string | null };
const toBrand = (r: BrandRow): ProjectBrand => ({ id: Number(r.id), name: r.name, financeKind: kindOf(r.finance_kind) });

/** The brand a New project form names (`brandId`), else — an older caller — the brand of the finance type it sends
    (`financeKind`), else none. A brand that is not this company's, or is switched off, is refused. */
export async function projectBrandFrom(
  db: Db,
  body: Record<string, unknown>,
  companyId: number,
): Promise<{ ok: true; brand: ProjectBrand | null } | { ok: false; error: "brand_not_found"; message: string }> {
  const refused = { ok: false as const, error: "brand_not_found" as const, message: "That brand is not available." };
  if (body.brandId != null && body.brandId !== "") {
    const id = Number(body.brandId);
    if (!Number.isInteger(id) || id <= 0) return refused;
    const row = await db.prepare(`SELECT ${BRAND_COLS} FROM public.project_brands WHERE id = ? AND active = 1 AND company_id = ?`)
      .bind(id, companyId).first<BrandRow>();
    return row ? { ok: true, brand: toBrand(row) } : refused;
  }
  const kind = kindOf(body.financeKind);
  if (!kind) return { ok: true, brand: null };
  const row = await db.prepare(`SELECT ${BRAND_COLS} FROM public.project_brands WHERE finance_kind = ? AND active = 1 AND company_id = ? ORDER BY id LIMIT 1`)
    .bind(kind, companyId).first<BrandRow>();
  return { ok: true, brand: row ? toBrand(row) : null };
}

/** The brand a sales order is under: its contract's brand id, else its branding (the brand's name). None when it has
    neither, or names a brand this company does not keep. */
export async function brandOfSo(
  db: Db,
  so: { brandId: number | null; branding: string | null },
  companyId: number,
): Promise<ProjectBrand | null> {
  if (so.brandId != null) {
    const row = await db.prepare(`SELECT ${BRAND_COLS} FROM public.project_brands WHERE id = ? AND company_id = ?`)
      .bind(so.brandId, companyId).first<BrandRow>();
    if (row) return toBrand(row);
  }
  const name = String(so.branding ?? "").trim();
  if (!name) return null;
  const row = await db.prepare(`SELECT ${BRAND_COLS} FROM public.project_brands WHERE lower(name) = lower(?) AND company_id = ? ORDER BY active DESC, id LIMIT 1`)
    .bind(name, companyId).first<BrandRow>();
  return row ? toBrand(row) : null;
}

const BLANK = (column: string): string => `nullif(trim(${column}), '') IS NULL`;
const FILLED = (column: string): string => `nullif(trim(${column}), '') IS NOT NULL`;

/** A sales order linked to a project shares one brand with it (owner, 13 Nov 2026): whichever side has none takes the
    other's. A brand already set on either side is never overwritten. */
export async function shareBrandWithProject(db: Db, docNo: string, projectId: number): Promise<void> {
  await db.prepare(
    `UPDATE scm.mfg_sales_orders s SET branding = p.brand, updated_at = now()
       FROM projects p WHERE s.doc_no = ? AND p.id = ? AND ${BLANK("s.branding")} AND ${FILLED("p.brand")}`,
  ).bind(docNo, projectId).run();
  await db.prepare(
    `UPDATE scm.reno_so_contracts k SET brand_id = b.id
       FROM projects p JOIN public.project_brands b ON b.company_id = p.company_id AND lower(trim(b.name)) = lower(trim(p.brand))
      WHERE k.so_doc_no = ? AND p.id = ? AND k.brand_id IS NULL`,
  ).bind(docNo, projectId).run();
  await db.prepare(
    `UPDATE projects p SET brand = s.branding, updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       FROM scm.mfg_sales_orders s WHERE p.id = ? AND s.doc_no = ? AND ${BLANK("p.brand")} AND ${FILLED("s.branding")}`,
  ).bind(projectId, docNo).run();
}
