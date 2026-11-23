/* Payments per project from its live sales order (the renovation contract first, else the newest ordinary sales
   order): the renovation contract's instalments, or four plain payments, with what AutoCount collected before go-live.
   Shared by the Beta board and workspace (routes/renovationBeta.ts) and the project flow (stageLoad.ts), so the
   Design progress card and the stages read the same money. */

import { billingViews, type BillingView } from "../../scm/lib/renovation-billing";
import { paymentsOf, type BetaPayments, type BetaReceipt } from "./beta";
import { renoDbFromD1 } from "./dbBridge";
import type { Db } from "./load";

export interface ProjectSoRow { project_id: number; doc_no: string; kind: string | null; total_sen: number | null }
interface ReceiptRow { so_doc_no: string; paid_on: string; amount_sen: number; method: string | null; confirmed: boolean | null }

/* The live sales order of each project: a renovation contract first, else the newest ordinary sales order linked to
   the project (owner, 24 Oct 2026: "once I receive money, the project knows"). */
export const PROJECT_SO_SQL = (where: string): string =>
  `SELECT DISTINCT ON (so.project_id) so.project_id::int AS project_id, so.doc_no, to_jsonb(so)->>'so_kind' AS kind, so.local_total_sen::bigint AS total_sen
     FROM scm.mfg_sales_orders so JOIN projects p ON p.id = so.project_id
    WHERE ${where} AND so.company_id = ? AND so.status::text <> 'CANCELLED'
    ORDER BY so.project_id, (to_jsonb(so)->>'so_kind' = 'RENOVATION') DESC, so.so_date DESC NULLS LAST, so.doc_no DESC`;

/** Payments recorded on these orders, oldest first, grouped by order. `confirmed`: finance has confirmed the money
    (its official receipt is FORMAL, it posted before confirmation existed, or it is not money arriving; acc/receipts
    awaitsConfirmation); a renovation contract counts only those as received (chew, 21 Nov 2026). */
async function receiptsOf(db: Db, docNos: readonly string[]): Promise<Map<string, BetaReceipt[]>> {
  const out = new Map<string, BetaReceipt[]>();
  if (docNos.length === 0) return out;
  const rows = (await db.prepare(
    `SELECT p.so_doc_no, to_char(p.paid_at, 'YYYY-MM-DD') AS paid_on, p.amount_sen::bigint AS amount_sen, p.method::text AS method,
            (COALESCE(p.method::text, '') IN ('converted', 'imported', 'credit') OR p.amount_sen <= 0
              OR EXISTS (SELECT 1 FROM scm.acc_official_receipts r WHERE r.payment_source = 'SOPAY' AND r.payment_id = p.id::text AND r.status = 'FORMAL')
              OR EXISTS (SELECT 1 FROM scm.journal_entries j WHERE j.source_type = 'SOPAY' AND j.source_doc_no = p.id::text AND j.posted AND NOT j.reversed)) AS confirmed
       FROM scm.mfg_sales_order_payments p
      WHERE p.so_doc_no IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND p.paid_at IS NOT NULL
      ORDER BY p.paid_at, p.id`,
  ).bind(JSON.stringify(docNos)).all<ReceiptRow>()).results ?? [];
  for (const r of rows) {
    const list = out.get(r.so_doc_no) ?? [];
    list.push({ paidOn: r.paid_on, amountSen: Number(r.amount_sen), method: r.method, ...(r.confirmed === false ? { confirmed: false } : {}) });
    out.set(r.so_doc_no, list);
  }
  return out;
}

/** Payments per project from its live sales order: the renovation contract's instalments, or four plain payments.
    What AutoCount was paid before go-live on a contract it carried comes in the billing view itself
    (renovation-billing paidBeforeGoLiveSen, chew 23 Nov 2026): it fills the instalments AutoCount invoiced, and the
    order's own payments before go-live are inside it. */
export async function projectPayments(db: Db, companyId: number, sos: readonly ProjectSoRow[], pre?: ReadonlyMap<string, BillingView>): Promise<Map<number, BetaPayments>> {
  const out = new Map<number, BetaPayments>();
  const reno = sos.filter((s) => s.kind === "RENOVATION").map((s) => s.doc_no);
  /* `pre`: views the caller already read for these contracts (load.ts). Every order here is of `companyId`
     (PROJECT_SO_SQL), so a view read without the company filter is the same view. Only the missing ones are read. */
  const toRead = pre ? reno.filter((d) => !pre.has(d)) : reno;
  const [read, receipts] = await Promise.all([
    toRead.length > 0 ? billingViews(renoDbFromD1(db), toRead, companyId) : Promise.resolve(new Map<string, BillingView>()),
    receiptsOf(db, sos.map((s) => s.doc_no)),
  ]);
  const views = new Map<string, BillingView>([...(pre ?? []), ...read]);
  for (const so of sos) {
    const view = so.kind === "RENOVATION" ? views.get(so.doc_no) ?? null : null;
    out.set(Number(so.project_id), paymentsOf(view, { docNo: so.doc_no, totalSen: Number(so.total_sen ?? 0), receipts: receipts.get(so.doc_no) ?? [] }));
  }
  return out;
}
