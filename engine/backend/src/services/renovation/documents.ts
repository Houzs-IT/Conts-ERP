/* Every transaction document of a renovation project (owner, 14 Oct 2026, "batch 4"): quotations, sales orders,
   purchase orders (one category each, migration 0116), goods receipts, delivery orders, sales invoices, delivery
   returns and purchase returns. A document belongs to the project when it names the project (project_id) or comes
   from one of the project's sales orders (directly, or through its PO / DO lines). Read by the project's
   "Procurement details" card (POs and GRs under their category rows) and its "Project documents" card.
   Needs migration 0116 (the routes check docFlowColumnsReady first). */

import type { Db } from "./load";

export interface ProjectPo {
  id: string; poNumber: string; status: string; poDate: string | null; expectedAt: string | null; totalSen: number;
  supplierName: string | null; categoryGroup: string | null; subCategory: string | null;
  orderedQty: number; receivedQty: number; receipt: "none" | "partial" | "full";
}
export interface ProjectGr { id: string; grnNumber: string; receivedAt: string | null; status: string; totalSen: number; poIds: string[]; atSite: boolean }
export interface ProjectDocRow { id: string; no: string; date: string | null; status: string; amountSen: number | null }
/* Where a document hangs in the project's Procurement details: its SO, DO or PO. */
export interface ProjectDo extends ProjectDocRow { soDocNo: string | null; deliveredAt: string | null; podR2Key: string | null; signed: boolean }
export interface ProjectSi extends ProjectDocRow { soDocNo: string | null; deliveryOrderId: string | null }
export interface ProjectReturn extends ProjectDocRow { parentId: string | null }
export interface ProjectDocuments {
  quotations: ProjectDocRow[];
  salesOrders: Array<ProjectDocRow & { kind: string }>;
  purchaseOrders: ProjectPo[];
  goodsReceipts: ProjectGr[];
  deliveryOrders: ProjectDo[];
  salesInvoices: ProjectSi[];
  deliveryReturns: ProjectReturn[];
  purchaseReturns: ProjectReturn[];
}

/* The project's sales orders, POs, DOs and GRs as SQL sets; `?` 1 = project id, 2 = company id. */
const SOS = `SELECT doc_no FROM scm.mfg_sales_orders WHERE project_id = ?1 AND company_id = ?2`;
const POS = `SELECT id FROM scm.purchase_orders WHERE project_id = ?1 AND company_id = ?2
             UNION SELECT x.purchase_order_id FROM scm.purchase_order_items x JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id
                    WHERE i.doc_no IN (${SOS})`;
const DOS = `SELECT id FROM scm.delivery_orders WHERE company_id = ?2 AND (project_id = ?1 OR so_doc_no IN (${SOS}))`;
const GRS = `SELECT id FROM scm.grns WHERE company_id = ?2 AND (project_id = ?1 OR purchase_order_id IN (${POS}))
             UNION SELECT g.grn_id FROM scm.grn_items g JOIN scm.purchase_order_items x ON x.id = g.purchase_order_item_id
                    WHERE x.purchase_order_id IN (${POS})`;
const SIS = `SELECT id FROM scm.sales_invoices WHERE company_id = ?2 AND (project_id = ?1 OR so_doc_no IN (${SOS}) OR delivery_order_id IN (${DOS}))`;

/* The Db shim binds positional `?`; numbered placeholders above are expanded here into the repeated binds. */
function expand(sql: string, projectId: number, companyId: number): { text: string; args: number[] } {
  const args: number[] = [];
  const text = sql.replace(/\?([12])/g, (_m, n: string) => { args.push(n === "1" ? projectId : companyId); return "?"; });
  return { text, args };
}

const num = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? null : String(v).slice(0, 10));

export async function readProjectDocuments(db: Db, projectId: number, companyId: number): Promise<ProjectDocuments> {
  const run = async <T>(sql: string) => {
    const q = expand(sql, projectId, companyId);
    return (await db.prepare(q.text).bind(...q.args).all<T>()).results ?? [];
  };
  const [quotes, sos, pos, grs, dos, sis, drs, prs] = await Promise.all([
    run<Record<string, unknown>>(
      `SELECT q.id::text AS id, r.doc_no, r.doc_date::text AS doc_date, q.status, q.converted_so_doc_no
         FROM scm.reno_quotations q JOIN scm.reno_quotation_revisions r ON r.quotation_id = q.id AND r.rev_no = q.current_rev
        WHERE q.project_id = ?1 AND q.company_id = ?2 ORDER BY q.created_at`),
    run<Record<string, unknown>>(
      `SELECT doc_no, so_date::text AS so_date, coalesce(so_kind, 'STANDARD') AS so_kind, status::text AS status, local_total_sen
         FROM scm.mfg_sales_orders WHERE doc_no IN (${SOS}) ORDER BY so_date, doc_no`),
    run<Record<string, unknown>>(
      `SELECT po.id::text AS id, po.po_number, po.status::text AS status, po.po_date::text AS po_date,
              greatest(po.expected_at, po.supplier_delivery_date_2, po.supplier_delivery_date_3, po.supplier_delivery_date_4)::text AS expected_at,
              po.total_sen, sup.name AS supplier_name, po.category_group, po.sub_category,
              coalesce((SELECT sum(x.qty) FROM scm.purchase_order_items x WHERE x.purchase_order_id = po.id), 0)::int AS ordered_qty,
              coalesce((SELECT sum(least(x.received_qty, x.qty)) FROM scm.purchase_order_items x WHERE x.purchase_order_id = po.id), 0)::int AS received_qty
         FROM scm.purchase_orders po LEFT JOIN scm.suppliers sup ON sup.id = po.supplier_id
        WHERE po.id IN (${POS}) ORDER BY po.po_date, po.po_number`),
    run<Record<string, unknown>>(
      `SELECT g.id::text AS id, g.grn_number, g.received_at::text AS received_at, g.status::text AS status, g.total_sen, g.received_at_site,
              array_to_string(array(SELECT DISTINCT coalesce(x.purchase_order_id, g.purchase_order_id)::text
                                      FROM scm.grn_items gi LEFT JOIN scm.purchase_order_items x ON x.id = gi.purchase_order_item_id
                                     WHERE gi.grn_id = g.id) || g.purchase_order_id::text, ',') AS po_ids
         FROM scm.grns g WHERE g.id IN (${GRS}) ORDER BY g.received_at, g.grn_number`),
    run<Record<string, unknown>>(
      `SELECT id::text AS id, do_number, do_date::text AS do_date, status::text AS status, local_total_sen, so_doc_no,
              delivered_at::text AS delivered_at, pod_r2_key, signature_data IS NOT NULL AS signed
         FROM scm.delivery_orders WHERE id IN (${DOS}) ORDER BY do_date, do_number`),
    run<Record<string, unknown>>(
      `SELECT id::text AS id, invoice_number, invoice_date::text AS invoice_date, status::text AS status, total_sen, so_doc_no,
              delivery_order_id::text AS delivery_order_id
         FROM scm.sales_invoices WHERE id IN (${SIS}) ORDER BY invoice_date, invoice_number`),
    run<Record<string, unknown>>(
      `SELECT id::text AS id, return_number, return_date::text AS return_date, status::text AS status, refund_sen,
              delivery_order_id::text AS parent_id
         FROM scm.delivery_returns WHERE company_id = ?2 AND (delivery_order_id IN (${DOS}) OR sales_invoice_id IN (${SIS}))
        ORDER BY return_date, return_number`),
    run<Record<string, unknown>>(
      `SELECT id::text AS id, return_number, return_date::text AS return_date, status::text AS status, refund_sen,
              purchase_order_id::text AS parent_id
         FROM scm.purchase_returns WHERE company_id = ?2 AND (purchase_order_id IN (${POS}) OR grn_id IN (${GRS}))
        ORDER BY return_date, return_number`),
  ]);
  const row = (id: unknown, no: unknown, date: unknown, status: unknown, amount: unknown): ProjectDocRow =>
    ({ id: String(id), no: String(no), date: s(date), status: String(status ?? ""), amountSen: amount == null ? null : num(amount) });
  return {
    quotations: quotes.map((r) => row(r.id, r.doc_no, r.doc_date, r.converted_so_doc_no ? "CONVERTED" : r.status, null)),
    salesOrders: sos.map((r) => ({ ...row(r.doc_no, r.doc_no, r.so_date, r.status, r.local_total_sen), kind: String(r.so_kind) })),
    purchaseOrders: pos.map((r) => {
      const ordered = num(r.ordered_qty);
      const received = num(r.received_qty);
      return {
        id: String(r.id), poNumber: String(r.po_number), status: String(r.status), poDate: s(r.po_date), expectedAt: s(r.expected_at),
        totalSen: num(r.total_sen), supplierName: (r.supplier_name as string | null) ?? null,
        categoryGroup: (r.category_group as string | null) ?? null, subCategory: (r.sub_category as string | null) ?? null,
        orderedQty: ordered, receivedQty: received,
        receipt: received <= 0 ? "none" : received >= ordered ? "full" : "partial",
      };
    }),
    goodsReceipts: grs.map((r) => ({
      id: String(r.id), grnNumber: String(r.grn_number), receivedAt: s(r.received_at), status: String(r.status), totalSen: num(r.total_sen),
      /* A comma list, not an array: the DB shim hands Postgres arrays back as text. */
      poIds: [...new Set(String(r.po_ids ?? "").split(",").filter(Boolean))], atSite: r.received_at_site === true,
    })),
    deliveryOrders: dos.map((r) => ({
      ...row(r.id, r.do_number, r.do_date, r.status, r.local_total_sen), soDocNo: (r.so_doc_no as string | null) ?? null,
      deliveredAt: s(r.delivered_at), podR2Key: (r.pod_r2_key as string | null) ?? null, signed: r.signed === true,
    })),
    salesInvoices: sis.map((r) => ({
      ...row(r.id, r.invoice_number, r.invoice_date, r.status, r.total_sen), soDocNo: (r.so_doc_no as string | null) ?? null,
      deliveryOrderId: (r.delivery_order_id as string | null) ?? null,
    })),
    deliveryReturns: drs.map((r) => ({ ...row(r.id, r.return_number, r.return_date, r.status, r.refund_sen), parentId: (r.parent_id as string | null) ?? null })),
    purchaseReturns: prs.map((r) => ({ ...row(r.id, r.return_number, r.return_date, r.status, r.refund_sen), parentId: (r.parent_id as string | null) ?? null })),
  };
}
