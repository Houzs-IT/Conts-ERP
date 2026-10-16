/* GET /api/renovation/:id/document-files — every photo and document attached to the project's transaction
   documents (owner, 16 Oct 2026; migration 0119), grouped by document, so the project page shows everything in one
   place: quotations, sales orders, variation orders, purchase orders, delivery orders (with the driver's
   proof-of-delivery photo), goods received, returns and invoices. Which documents belong to the project is
   services/renovation/documents.ts's rule, plus the variation orders of its sales orders and the purchase invoices
   of its POs and goods receipts. Read-only: files are added and removed on each document's own page.
   GET /api/renovation/:id/document-files/:type/:docId/:fileId streams one, after checking the document is the
   project's, so a project viewer sees the files without needing each supply chain screen. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess } from "../middleware/auth";
import { activeCompanySql } from "../scm/lib/companyScope";
import type { Db } from "../services/renovation/load";
import { expand, readProjectDocuments, GRS, POS, SOS } from "../services/renovation/documents";
import { docFlowColumnsReady } from "../scm/routes/renovation-doc-flow";
import {
  DOC_TYPES, POD_FILE_ID, attachmentsReady, fileRow, isDocType, listFilesFor, podFile, type DocFile, type DocType,
} from "../scm/lib/doc-attachments";
import { streamObject } from "../scm/routes/doc-attachments";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();
const db = (c: Ctx) => c.env.DB as unknown as Db;

export interface ProjectDocGroup { type: DocType; label: string; id: string; no: string; date: string | null; status: string; files: DocFile[] }

async function projectDocs(d: Db, projectId: number, companyId: number) {
  const docs = await readProjectDocuments(d, projectId, companyId);
  const run = async <T>(sql: string) => {
    const q = expand(sql, projectId, companyId);
    return (await d.prepare(q.text).bind(...q.args).all<T>()).results ?? [];
  };
  const [vos, pis] = await Promise.all([
    run<{ id: string; vo_no: string; doc_date: string | null; status: string }>(
      `SELECT id::text AS id, vo_no, doc_date::text AS doc_date, status FROM scm.reno_variation_orders
        WHERE company_id = ?2 AND so_doc_no IN (${SOS}) ORDER BY doc_date, vo_no`),
    run<{ id: string; invoice_number: string; invoice_date: string | null; status: string }>(
      `SELECT id::text AS id, invoice_number, invoice_date::text AS invoice_date, status::text AS status FROM scm.purchase_invoices
        WHERE company_id = ?2 AND (purchase_order_id IN (${POS}) OR grn_id IN (${GRS})) ORDER BY invoice_date, invoice_number`).catch(() => []),
  ]);
  const out: Array<Omit<ProjectDocGroup, "files" | "label">> = [
    ...docs.quotations.map((r) => ({ type: "quotation" as const, id: r.id, no: r.no, date: r.date, status: r.status })),
    ...docs.salesOrders.map((r) => ({ type: "sales_order" as const, id: r.id, no: r.no, date: r.date, status: r.status })),
    ...vos.map((r) => ({ type: "variation_order" as const, id: r.id, no: r.vo_no, date: r.doc_date?.slice(0, 10) ?? null, status: r.status })),
    ...docs.purchaseOrders.map((r) => ({ type: "purchase_order" as const, id: r.id, no: r.poNumber, date: r.poDate, status: r.status })),
    ...docs.deliveryOrders.map((r) => ({ type: "delivery_order" as const, id: r.id, no: r.no, date: r.date, status: r.status })),
    ...docs.goodsReceipts.map((r) => ({ type: "goods_received" as const, id: r.id, no: r.grnNumber, date: r.receivedAt, status: r.status })),
    ...docs.deliveryReturns.map((r) => ({ type: "delivery_return" as const, id: r.id, no: r.no, date: r.date, status: r.status })),
    ...docs.purchaseReturns.map((r) => ({ type: "purchase_return" as const, id: r.id, no: r.no, date: r.date, status: r.status })),
    ...pis.map((r) => ({ type: "purchase_invoice" as const, id: r.id, no: r.invoice_number, date: r.invoice_date?.slice(0, 10) ?? null, status: r.status })),
    ...docs.salesInvoices.map((r) => ({ type: "sales_invoice" as const, id: r.id, no: r.no, date: r.date, status: r.status })),
  ];
  return out;
}

async function projectCompany(c: Ctx, id: number): Promise<number | null> {
  const p = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${activeCompanySql(c)}`)
    .bind(id).first<{ company_id: number }>();
  return p ? Number(p.company_id) : null;
}

app.get("/:id/document-files", requirePageAccess("projects.list"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  try {
    const companyId = await projectCompany(c, id);
    if (companyId == null) return c.json({ error: "not_found" }, 404);
    if (!(await docFlowColumnsReady(db(c))) || !(await attachmentsReady(db(c)))) return c.json({ ready: false, projectId: id, documents: [] });
    const docs = await projectDocs(db(c), id, companyId);
    const files = await listFilesFor(db(c), docs, companyId);
    const groups: ProjectDocGroup[] = [];
    for (const d of docs) {
      const list = [...(files.get(`${d.type}:${d.id}`) ?? [])];
      if (d.type === "delivery_order") {
        const pod = await podFile(db(c), d.id).catch(() => null);
        if (pod) { const { key: _key, ...shown } = pod; list.unshift(shown); }
      }
      groups.push({ ...d, label: DOC_TYPES[d.type].label, files: list });
    }
    return c.json({ ready: true, projectId: id, documents: groups });
  } catch (e) {
    console.error("[renovation] document files read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The project's files could not be read. Try again." }, 409);
  }
});

app.get("/:id/document-files/:type/:docId/:fileId", requirePageAccess("projects.list"), async (c) => {
  const id = Number(c.req.param("id"));
  const type = c.req.param("type");
  const docId = c.req.param("docId");
  const fileId = c.req.param("fileId");
  if (!Number.isInteger(id) || id <= 0 || !isDocType(type)) return c.json({ error: "invalid_id" }, 400);
  const companyId = await projectCompany(c, id);
  if (companyId == null) return c.json({ error: "not_found" }, 404);
  const docs = await projectDocs(db(c), id, companyId);
  const doc = docs.find((d) => d.type === type && d.id === docId);
  if (!doc) return c.json({ error: "not_found" }, 404);
  const range = c.req.header("range");
  if (type === "delivery_order" && fileId === POD_FILE_ID) {
    const pod = await podFile(db(c), doc.id);
    const res = pod && ((await streamObject(c.env.SLIPS, pod.key, pod.mime, pod.name, range)) ?? (await streamObject(c.env.POD_BUCKET, pod.key, pod.mime, pod.name, range)));
    return res ?? c.json({ error: "not_found" }, 404);
  }
  const row = await fileRow(db(c), { type, id: doc.id, no: doc.no, companyId }, fileId);
  if (!row) return c.json({ error: "not_found" }, 404);
  return (await streamObject(c.env.SO_ITEM_PHOTOS, row.key, row.mime, row.name, range)) ?? c.json({ error: "object_missing" }, 404);
});

export default app;
