/* Payments per project from its live sales order (the renovation contract first, else the newest ordinary sales
   order): the renovation contract's instalments, or four plain payments, with what AutoCount collected before go-live.
   Shared by the Beta board and workspace (routes/renovationBeta.ts) and the project flow (stageLoad.ts), so the
   Design progress card and the stages read the same money. */

import { goLiveOf } from "../../acc/go-live";
import { billingViews, type BillingView } from "../../scm/lib/renovation-billing";
import { paymentsOf, type BetaPayments, type BetaReceipt } from "./beta";
import { renoDbFromD1 } from "./dbBridge";
import type { Db } from "./load";

export interface ProjectSoRow { project_id: number; doc_no: string; kind: string | null; total_sen: number | null }
interface ReceiptRow { so_doc_no: string; paid_on: string; amount_sen: number; method: string | null }

/* The live sales order of each project: a renovation contract first, else the newest ordinary sales order linked to
   the project (owner, 24 Oct 2026: "once I receive money, the project knows"). */
export const PROJECT_SO_SQL = (where: string): string =>
  `SELECT DISTINCT ON (so.project_id) so.project_id::int AS project_id, so.doc_no, to_jsonb(so)->>'so_kind' AS kind, so.local_total_sen::bigint AS total_sen
     FROM scm.mfg_sales_orders so JOIN projects p ON p.id = so.project_id
    WHERE ${where} AND so.company_id = ? AND so.status::text <> 'CANCELLED'
    ORDER BY so.project_id, (to_jsonb(so)->>'so_kind' = 'RENOVATION') DESC, so.so_date DESC NULLS LAST, so.doc_no DESC`;

/** Payments recorded on these orders, oldest first, grouped by order. */
async function receiptsOf(db: Db, docNos: readonly string[]): Promise<Map<string, BetaReceipt[]>> {
  const out = new Map<string, BetaReceipt[]>();
  if (docNos.length === 0) return out;
  const rows = (await db.prepare(
    `SELECT so_doc_no, to_char(paid_at, 'YYYY-MM-DD') AS paid_on, amount_sen::bigint AS amount_sen, method::text AS method
       FROM scm.mfg_sales_order_payments
      WHERE so_doc_no IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND paid_at IS NOT NULL
      ORDER BY paid_at, id`,
  ).bind(JSON.stringify(docNos)).all<ReceiptRow>()).results ?? [];
  for (const r of rows) {
    const list = out.get(r.so_doc_no) ?? [];
    list.push({ paidOn: r.paid_on, amountSen: Number(r.amount_sen), method: r.method });
    out.set(r.so_doc_no, list);
  }
  return out;
}

interface CarriedRow { doc_no: string; golive_sen: number; open_sen: number; ahead_sen: number; sole: boolean }

/* The go-live date is set once when the ledger starts; every payments read asked for it again. Kept a minute per isolate. */
const GO_LIVE_TTL_MS = 60_000;
const goLiveCache = new Map<number, { at: number; goLive: string | null }>();
async function goLiveCached(db: Db, companyId: number): Promise<string | null> {
  const hit = goLiveCache.get(companyId);
  if (hit && Date.now() - hit.at < GO_LIVE_TTL_MS) return hit.goLive;
  const set = await db.prepare(`SELECT ledger_start_date::text AS ledger_start_date, documents_cutover_date::text AS documents_cutover_date
     FROM scm.acc_company_settings WHERE company_id = ?`).bind(companyId).first<{ ledger_start_date: string | null; documents_cutover_date: string | null }>();
  const goLive = goLiveOf(set ?? null);
  goLiveCache.set(companyId, { at: Date.now(), goLive });
  return goLive;
}

/** What AutoCount collected on the contracts it carried (seeded at go-live; acc/reno-opening): the go-live amount
    less what its customer still had open, plus what they had paid ahead (acc/reno-projects reads it the same way). It
    is one payment on the eve of go-live; the order's own payments before go-live are AutoCount's already. */
async function autocountCollected(db: Db, companyId: number, docNos: readonly string[]): Promise<{ goLive: string | null; bySo: Map<string, number> }> {
  const bySo = new Map<string, number>();
  const goLive = await goLiveCached(db, companyId);
  if (!goLive || docNos.length === 0) return { goLive, bySo };
  const rows = (await db.prepare(
    `WITH k AS (
       SELECT so.doc_no, so.debtor_code, rc.golive_contract_sen
         FROM scm.mfg_sales_orders so JOIN scm.reno_so_contracts rc ON rc.so_doc_no = so.doc_no
        WHERE so.company_id = ? AND rc.golive_contract_sen IS NOT NULL AND so.doc_no IN (SELECT jsonb_array_elements_text(?::text::jsonb)))
     SELECT k.doc_no, k.golive_contract_sen::bigint AS golive_sen,
            COALESCE((SELECT sum(i.total_sen) FROM scm.sales_invoices i WHERE i.company_id = ? AND i.opening_balance AND i.debtor_code = k.debtor_code
                       AND upper(i.status::text) NOT IN ('DRAFT', 'CANCELLED', 'VOID')), 0)::bigint AS open_sen,
            COALESCE((SELECT sum(cc.amount_sen) FROM scm.customer_credits cc WHERE cc.company_id = ? AND cc.source_type = 'OPENING'
                       AND cc.debtor_code = k.debtor_code), 0)::bigint AS ahead_sen,
            (SELECT count(*) FROM scm.mfg_sales_orders o WHERE o.company_id = ? AND o.debtor_code = k.debtor_code AND o.status::text <> 'CANCELLED') = 1 AS sole
       FROM k`,
  ).bind(companyId, JSON.stringify(docNos), companyId, companyId, companyId).all<CarriedRow>()).results ?? [];
  for (const r of rows) {
    if (!r.sole) continue;
    const sen = Number(r.golive_sen) + Number(r.ahead_sen) - Number(r.open_sen);
    if (sen > 0) bySo.set(r.doc_no, sen);
  }
  return { goLive, bySo };
}

const dayBefore = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Payments per project from its live sales order: the renovation contract's instalments, or four plain payments. */
export async function projectPayments(db: Db, companyId: number, sos: readonly ProjectSoRow[], pre?: ReadonlyMap<string, BillingView>): Promise<Map<number, BetaPayments>> {
  const out = new Map<number, BetaPayments>();
  const reno = sos.filter((s) => s.kind === "RENOVATION").map((s) => s.doc_no);
  /* `pre`: views the caller already read for these contracts (load.ts). Every order here is of `companyId`
     (PROJECT_SO_SQL), so a view read without the company filter is the same view. Only the missing ones are read. */
  const toRead = pre ? reno.filter((d) => !pre.has(d)) : reno;
  const [read, receipts, carried] = await Promise.all([
    toRead.length > 0 ? billingViews(renoDbFromD1(db), toRead, companyId) : Promise.resolve(new Map<string, BillingView>()),
    receiptsOf(db, sos.map((s) => s.doc_no)),
    autocountCollected(db, companyId, reno),
  ]);
  const views = new Map<string, BillingView>([...(pre ?? []), ...read]);
  for (const so of sos) {
    const view = so.kind === "RENOVATION" ? views.get(so.doc_no) ?? null : null;
    let mine = receipts.get(so.doc_no) ?? [];
    const before = carried.bySo.get(so.doc_no);
    if (before != null && carried.goLive) {
      const goLive = carried.goLive;
      mine = [{ paidOn: dayBefore(goLive), amountSen: before, method: "autocount" }, ...mine.filter((r) => r.paidOn >= goLive)];
    }
    out.set(Number(so.project_id), paymentsOf(view, { docNo: so.doc_no, totalSen: Number(so.total_sen ?? 0), receipts: mine }));
  }
  return out;
}
