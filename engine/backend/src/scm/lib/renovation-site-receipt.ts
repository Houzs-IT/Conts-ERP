/* company-scope-file: reads one GRN flag by id for a caller that already loaded
   that GRN under its own company predicate; writes nothing.

   SITE RECEIPT — a goods receipt taken at the customer's unit (renovation flow,
   migration 0079 `scm.grns.received_at_site`). The goods are in the customer's
   home, never in a warehouse, so a site receipt books NO stock: not on post, not
   when it is cancelled or edited, and a purchase return of its lines takes no
   stock out. The PO received_qty recount, audit rows and money still run.

   Every stock write in grns.ts and purchase-returns.ts asks this module first
   (tests/grnSiteReceiptStockGuard.test.ts slices the source to prove it).
   A flag that cannot be read answers 'unknown' and the caller refuses: booking
   phantom stock and dropping real stock are both wrong, so neither is guessed. */

export type GrnSiteFlag = "site" | "warehouse" | "unknown";

/** Postgres undefined_column / PostgREST unknown column: the database has not
    applied 0079, so no site receipt can exist yet. */
export function isMissingColumnError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const msg = String(err?.message ?? e ?? "");
  return err?.code === "42703" || err?.code === "PGRST204" || /column .*received_at_site.* does not exist|received_at_site.*schema cache/i.test(msg);
}

/** True when this GRN's lines put stock on a shelf. */
export function grnBooksStock(flag: GrnSiteFlag, migratedNoStock = false): boolean {
  return flag === "warehouse" && !migratedNoStock;
}

type FlagQuery = {
  from(t: string): {
    select(cols: string): {
      eq(col: string, v: unknown): { maybeSingle(): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> };
      in(col: string, v: unknown[]): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
    };
  };
};

export async function readGrnSiteFlag(sb: unknown, grnId: string): Promise<GrnSiteFlag> {
  try {
    const { data, error } = await (sb as FlagQuery).from("grns").select("received_at_site").eq("id", grnId).maybeSingle();
    if (error) return isMissingColumnError(error) ? "warehouse" : "unknown";
    return (data as { received_at_site?: boolean | null } | null)?.received_at_site === true ? "site" : "warehouse";
  } catch (e) {
    return isMissingColumnError(e) ? "warehouse" : "unknown";
  }
}

/** The subset of these GRNs that are site receipts; null when it cannot be read. */
export async function siteReceivedGrnIds(sb: unknown, grnIds: readonly string[]): Promise<Set<string> | null> {
  const ids = [...new Set(grnIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  try {
    const { data, error } = await (sb as FlagQuery).from("grns").select("id, received_at_site").in("id", ids);
    if (error) return isMissingColumnError(error) ? new Set() : null;
    return new Set(((data ?? []) as Array<{ id: string; received_at_site?: boolean | null }>).filter((r) => r.received_at_site === true).map((r) => r.id));
  } catch (e) {
    return isMissingColumnError(e) ? new Set() : null;
  }
}

export const SITE_FLAG_UNREADABLE = {
  error: "site_flag_unreadable",
  message: "Could not tell whether this goods receipt was taken on site, so no stock was changed. Try again.",
} as const;
