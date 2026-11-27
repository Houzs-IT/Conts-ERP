/* Whether a caller may see purchase-side documents at all: purchase orders, goods receipts, production orders and
   purchase invoices (owner, 27 Nov 2026: salespeople keep SO, DO, invoice and VO, never the purchase side).

   Not scmAreaAllows: that one lets through anyone whose scm_l2_configured is false, and a salesperson signed in from
   Property OS can be in that state while still holding scm.procurement = "none". An account with no page_access map
   at all predates the matrix and keeps today's behaviour. A position can grant one purchase document page while the
   umbrella stays "none"; that person opens those documents directly anyway, so the chain must not hide them. */

type ProcurementSubject = {
  permissions?: readonly string[] | null;
  permissions_set?: ReadonlySet<string> | null;
  page_access?: Readonly<Record<string, string | null | undefined>> | null;
} | null | undefined;

const PURCHASE_PAGES = [
  "scm.procurement",
  "scm.procurement.po",
  "scm.procurement.grn",
  "scm.procurement.pi",
  "scm.procurement.production",
] as const;

export function seesProcurement(user: unknown): boolean {
  const u = user as ProcurementSubject;
  if (!u) return true;
  if (u.permissions_set?.has("*") || u.permissions?.includes("*")) return true;
  const pa = u.page_access;
  if (!pa) return true;
  return PURCHASE_PAGES.some((key) => (pa[key] ?? "none") !== "none");
}
