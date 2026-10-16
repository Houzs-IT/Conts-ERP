/* Photos and documents on every document of the transaction flow (owner, 16 Oct 2026; migration 0119
   scm.doc_attachments). One list of files per document, whatever the document: this module knows each document
   type (its table, how its number reads, where its files are listed) and reads / writes the list. The routes are
   scm/routes/doc-attachments.ts (one small router per document, mounted on the document's own prefix so its area
   guard and company scope apply) and routes/renovationDocumentFiles.ts (the project's read-only roll-up).

   Files go in the bucket the sales order attachments and line photos already use (SO_ITEM_PHOTOS), under
   doc-attachments/<company>/<type>/<document>/<uuid>.<ext>. A delivery order's proof-of-delivery photo (taken by
   the driver, delivery_orders.pod_r2_key, SLIPS bucket) shows in its list as a file that cannot be removed. */

import type { Db } from "../../services/renovation/load";

export type DocType =
  | "quotation" | "sales_order" | "variation_order" | "purchase_order" | "delivery_order" | "goods_received"
  | "delivery_return" | "purchase_return" | "purchase_invoice" | "sales_invoice" | "receipt";

interface DocTypeSpec {
  label: string;
  /** The document table, aliased d in every query. */
  table: string;
  /** The column that names one document: a uuid, except a sales order's doc_no. */
  idCol: string;
  uuid: boolean;
  /** The document's number as people know it. */
  noExpr: string;
}

export const DOC_TYPES: Record<DocType, DocTypeSpec> = {
  quotation: {
    label: "Quotation", table: "scm.reno_quotations", idCol: "id", uuid: true,
    noExpr: "(SELECT r.doc_no FROM scm.reno_quotation_revisions r WHERE r.quotation_id = d.id ORDER BY (r.rev_no = d.current_rev) DESC, r.rev_no DESC LIMIT 1)",
  },
  sales_order: { label: "Sales order", table: "scm.mfg_sales_orders", idCol: "doc_no", uuid: false, noExpr: "d.doc_no" },
  variation_order: { label: "Variation order", table: "scm.reno_variation_orders", idCol: "id", uuid: true, noExpr: "d.vo_no" },
  purchase_order: { label: "Purchase order", table: "scm.purchase_orders", idCol: "id", uuid: true, noExpr: "d.po_number" },
  delivery_order: { label: "Delivery order", table: "scm.delivery_orders", idCol: "id", uuid: true, noExpr: "d.do_number" },
  goods_received: { label: "Goods received", table: "scm.grns", idCol: "id", uuid: true, noExpr: "d.grn_number" },
  delivery_return: { label: "Delivery return", table: "scm.delivery_returns", idCol: "id", uuid: true, noExpr: "d.return_number" },
  purchase_return: { label: "Purchase return", table: "scm.purchase_returns", idCol: "id", uuid: true, noExpr: "d.return_number" },
  purchase_invoice: { label: "Purchase invoice", table: "scm.purchase_invoices", idCol: "id", uuid: true, noExpr: "d.invoice_number" },
  sales_invoice: { label: "Sales invoice", table: "scm.sales_invoices", idCol: "id", uuid: true, noExpr: "d.invoice_number" },
  receipt: { label: "Receipt", table: "scm.acc_receipts", idCol: "id", uuid: true, noExpr: "d.receipt_number" },
};

export const isDocType = (v: unknown): v is DocType => typeof v === "string" && Object.prototype.hasOwnProperty.call(DOC_TYPES, v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validDocId = (type: DocType, id: string): boolean =>
  DOC_TYPES[type].uuid ? UUID.test(id) : id.length > 0 && id.length <= 64;

/* What a file may be. Phone photos (HEIC included), PDFs and short videos; nothing that a browser would run. */
const IMAGE = /^image\/(jpeg|png|webp|gif|heic|heif)$/;
const VIDEO = /^video\/(mp4|quicktime|webm|3gpp)$/;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/* A Worker takes a request body up to 100 MB; a minute of phone video fits under this. */
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;

export function fileKind(mime: string): "image" | "video" | "pdf" | null {
  const m = mime.toLowerCase();
  if (IMAGE.test(m)) return "image";
  if (VIDEO.test(m)) return "video";
  if (m === "application/pdf") return "pdf";
  return null;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp", "application/pdf": "pdf",
};
export const extFor = (mime: string): string => EXT[mime.toLowerCase()] ?? "bin";

export function attachmentKey(companyId: number, type: DocType, docId: string, mime: string): string {
  const safeDoc = docId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `doc-attachments/${companyId}/${type}/${safeDoc}/${crypto.randomUUID()}.${extFor(mime)}`;
}

/** The id of a delivery order's proof-of-delivery photo in its list. */
export const POD_FILE_ID = "pod";

export interface DocFile {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "video" | "pdf" | "file";
  size: number;
  caption: string;
  source: "upload" | "import" | "legacy" | "pod";
  by: string | null;
  at: string;
  /** The driver's proof-of-delivery photo: shown with the document's files, kept with the delivery. */
  readOnly: boolean;
}

export interface DocRef { type: DocType; id: string; no: string; companyId: number }

let tableKnown = false;
/** Migration 0119 is in this database. */
export async function attachmentsReady(db: Db): Promise<boolean> {
  if (tableKnown) return true;
  const r = await db.prepare(`SELECT to_regclass('scm.doc_attachments') IS NOT NULL AS ready`).bind().first<{ ready: boolean }>();
  tableKnown = r?.ready === true;
  return tableKnown;
}

/** One document under the caller's company (`companySql` from activeCompanySql(c, 'd.company_id')). */
export async function loadDoc(db: Db, type: DocType, id: string, companySql: string): Promise<DocRef | null> {
  if (!validDocId(type, id)) return null;
  const s = DOC_TYPES[type];
  const r = await db.prepare(
    `SELECT d.${s.idCol}::text AS id, ${s.noExpr} AS no, d.company_id::int AS company_id FROM ${s.table} d
      WHERE d.${s.idCol} = ?${s.uuid ? "::uuid" : ""}${companySql}`,
  ).bind(id).first<{ id: string; no: string | null; company_id: number }>();
  return r ? { type, id: r.id, no: r.no ?? "", companyId: Number(r.company_id) } : null;
}

/** Documents by their numbers, for the import: one row per number found (a number can name two documents only
    across companies, and the caller's company filter removes the other). */
export async function findDocsByNumber(db: Db, type: DocType, numbers: string[], companySql: string): Promise<DocRef[]> {
  if (numbers.length === 0) return [];
  const s = DOC_TYPES[type];
  const where = type === "quotation"
    ? `d.id IN (SELECT r.quotation_id FROM scm.reno_quotation_revisions r WHERE r.doc_no = ANY(?::text[]))`
    : `${s.noExpr} = ANY(?::text[])`;
  const q = type === "quotation"
    ? `SELECT d.id::text AS id, r.doc_no AS no, d.company_id::int AS company_id FROM ${s.table} d
         JOIN scm.reno_quotation_revisions r ON r.quotation_id = d.id WHERE r.doc_no = ANY(?::text[])${companySql}`
    : `SELECT d.${s.idCol}::text AS id, ${s.noExpr} AS no, d.company_id::int AS company_id FROM ${s.table} d WHERE ${where}${companySql}`;
  const res = await db.prepare(q).bind(`{${numbers.map((n) => `"${n.replace(/["\\]/g, "")}"`).join(",")}}`).all<{ id: string; no: string; company_id: number }>();
  const seen = new Set<string>();
  const out: DocRef[] = [];
  for (const r of res.results ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ type, id: r.id, no: r.no, companyId: Number(r.company_id) });
  }
  return out;
}

interface Row {
  id: string; file_name: string; mime: string; size_bytes: number | string; caption: string; source: string;
  uploaded_by_name: string | null; created_at: string; doc_type: string; doc_id: string;
}

const toFile = (r: Row): DocFile => ({
  id: r.id, name: r.file_name, mime: r.mime, kind: fileKind(r.mime) ?? "file", size: Number(r.size_bytes ?? 0),
  caption: r.caption ?? "", source: r.source as DocFile["source"], by: r.uploaded_by_name, at: new Date(r.created_at).toISOString(),
  readOnly: false,
});

const COLS = `id::text AS id, file_name, mime, size_bytes, caption, source, uploaded_by_name, created_at, doc_type, doc_id`;

/** The files of many documents at once (the project roll-up), oldest first. */
export async function listFilesFor(db: Db, docs: Array<{ type: DocType; id: string }>, companyId: number): Promise<Map<string, DocFile[]>> {
  const out = new Map<string, DocFile[]>();
  if (docs.length === 0) return out;
  const keys = docs.map((d) => `${d.type}:${d.id}`);
  const res = await db.prepare(
    `SELECT ${COLS} FROM scm.doc_attachments
      WHERE deleted_at IS NULL AND company_id = ? AND (doc_type || ':' || doc_id) = ANY(?::text[])
      ORDER BY created_at, id`,
  ).bind(companyId, `{${keys.map((k) => `"${k.replace(/["\\]/g, "")}"`).join(",")}}`).all<Row>();
  for (const r of res.results ?? []) {
    const k = `${r.doc_type}:${r.doc_id}`;
    const list = out.get(k) ?? [];
    list.push(toFile(r));
    out.set(k, list);
  }
  return out;
}

export async function listFiles(db: Db, doc: DocRef): Promise<DocFile[]> {
  const res = await db.prepare(
    `SELECT ${COLS} FROM scm.doc_attachments
      WHERE deleted_at IS NULL AND company_id = ? AND doc_type = ? AND doc_id = ? ORDER BY created_at, id`,
  ).bind(doc.companyId, doc.type, doc.id).all<Row>();
  return (res.results ?? []).map(toFile);
}

/** A delivery order's proof-of-delivery photo as a read-only file, or null when the driver took none. */
export async function podFile(db: Db, doId: string): Promise<(DocFile & { key: string }) | null> {
  const r = await db.prepare(
    `SELECT pod_r2_key, coalesce(delivered_at, updated_at) AS at FROM scm.delivery_orders WHERE id = ?::uuid`,
  ).bind(doId).first<{ pod_r2_key: string | null; at: string | null }>();
  if (!r?.pod_r2_key) return null;
  return {
    id: POD_FILE_ID, key: r.pod_r2_key, name: "Proof of delivery photo", mime: "image/jpeg", kind: "image", size: 0,
    caption: "Taken by the driver at delivery", source: "pod", by: null, at: r.at ? new Date(r.at).toISOString() : "", readOnly: true,
  };
}

/** One stored file of a document, with its R2 key (never sent to the browser). */
export async function fileRow(db: Db, doc: DocRef, fileId: string): Promise<{ key: string; mime: string; name: string } | null> {
  if (!UUID.test(fileId)) return null;
  return db.prepare(
    `SELECT r2_key AS key, mime, file_name AS name FROM scm.doc_attachments
      WHERE id = ?::uuid AND deleted_at IS NULL AND company_id = ? AND doc_type = ? AND doc_id = ?`,
  ).bind(fileId, doc.companyId, doc.type, doc.id).first<{ key: string; mime: string; name: string }>();
}

/* A sales order's older attachment list (migration 0115, scm.mfg_sales_orders.attachments, renovation mode) joins
   the shared list the first time the order's files load. The same R2 object is named, nothing is copied, and the
   unique r2_key makes it happen once. A database without 0115 has nothing to bring over. */
export async function adoptLegacySoAttachments(db: Db, doc: DocRef): Promise<void> {
  if (doc.type !== "sales_order") return;
  let raw: unknown;
  try {
    const r = await db.prepare(`SELECT attachments FROM scm.mfg_sales_orders WHERE doc_no = ?`).bind(doc.id).first<{ attachments: unknown }>();
    raw = typeof r?.attachments === "string" ? JSON.parse(r.attachments) : r?.attachments;
  } catch {
    return;
  }
  if (!Array.isArray(raw) || raw.length === 0) return;
  for (const a of raw as Array<{ key?: string; name?: string; type?: string; size?: number; at?: string; by?: string | null }>) {
    if (!a?.key || !fileKind(String(a.type ?? ""))) continue;
    await db.prepare(
      `INSERT INTO scm.doc_attachments (company_id, doc_type, doc_id, r2_key, file_name, mime, size_bytes, source, uploaded_by_name, created_at)
       VALUES (?, 'sales_order', ?, ?, ?, ?, ?, 'legacy', ?, coalesce(?::timestamptz, now())) ON CONFLICT (r2_key) DO NOTHING`,
    ).bind(doc.companyId, doc.id, a.key, String(a.name || "attachment").slice(0, 200), String(a.type).toLowerCase(), Number(a.size ?? 0),
      a.by ?? null, a.at ?? null).run();
  }
}

export function cleanName(name: string, mime: string): string {
  const n = name.replace(/[\u0000-\u001f"\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return n || `file.${extFor(mime)}`;
}
