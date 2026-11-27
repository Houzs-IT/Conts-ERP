/* Mirror of the server rule (engine/backend/src/lib/procurement-visible.ts): whether this account may see purchase
   orders, goods receipts, production orders and purchase invoices at all (owner, 27 Nov 2026: salespeople never do).
   The server already withholds the data; this only keeps the screen from showing an empty card or a dead link. */

import { useAuth } from "../auth/AuthContext";

type ProcurementSubject = { permissions?: readonly string[] | null; page_access?: Readonly<Record<string, string | undefined>> | null } | null | undefined;

const PURCHASE_PAGES = ["scm.procurement", "scm.procurement.po", "scm.procurement.grn", "scm.procurement.pi", "scm.procurement.production"] as const;

export function seesProcurement(user: ProcurementSubject): boolean {
  if (!user) return true;
  if (user.permissions?.includes("*")) return true;
  const pa = user.page_access;
  if (!pa) return true;
  return PURCHASE_PAGES.some((key) => (pa[key] ?? "none") !== "none");
}

export function useSeesProcurement(): boolean {
  return seesProcurement(useAuth().user);
}
