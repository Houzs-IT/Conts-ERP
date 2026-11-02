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
  | "delivery_return" | "purchase_return" | "purchase_invoice" | "sales_invoice" | "receipt"
  | "credit_note" | "official_receipt" | "deposit_invoice" | "payment_voucher" | "ap_invoice";

interface LineSpec {
  /** FROM ... WHERE that picks one document's lines (alias x); `?` is the document id. */
  from: string;
  /** Line order on the document; line numbers are counted from 1 in this order. */
  order: string;
  sku: string;
  description: string;
  /** The line upstream whose files this line shows (not copied): its document type and the column naming it. */
  parent?: { type: DocType; col: string };
}

interface DocTypeSpec {
  label: string;
  /** The document table, aliased d in every query. */
  table: string;
  /** The column that names one document and its kind: a uuid, a sales order's doc_no, an official receipt's number id. */
  idCol: string;
  idKind: "uuid" | "text" | "int";
  /** The document's number as people know it. */
  noExpr: string;
  /** The document's lines. */
  lines?: LineSpec;
  /** Files the document already kept before migration 0119 (a payment voucher's or AP invoice's supplier bill,
      lib/doc-files.ts): shown with its files, read-only, and still added and removed in their own panel, because the
      payment's print bundle and its posting lock read them there. */
  evidence?: { table: string; fk: string };
}

const item = (table: string, fk: string, extra: Partial<LineSpec> = {}): LineSpec => ({
  from: `scm.${table} x WHERE x.${fk} = ?::uuid`, order: "x.created_at, x.id", sku: "x.item_code",
  description: "coalesce(nullif(x.description, ''), x.item_code)", ...extra,
});

/* Account-posting lines (receipts, notes, vouchers, AP invoices): numbered, described, no item code. */
const account = (table: string, fk: string): LineSpec => ({
  from: `scm.${table} x WHERE x.${fk} = ?::uuid`, order: "x.line_no, x.id", sku: "''", description: "x.description",
});

/* A renovation quotation's or variation order's priced lines (items and their sub-items; headings and notes take no files). */
const renoLines = (where: string): LineSpec => ({
  from: `scm.reno_doc_lines x JOIN scm.reno_doc_sections s ON s.id = x.section_id WHERE x.kind IN ('ITEM', 'CHILD') AND ${where}`,
  order: "s.sort_order, x.sort_order, x.id", sku: "x.item_code", description: "coalesce(nullif(x.description, ''), x.item_code)",
});

export const DOC_TYPES: Record<DocType, DocTypeSpec> = {
  quotation: {
    label: "Quotation", table: "scm.reno_quotations", idCol: "id", idKind: "uuid",
    noExpr: "(SELECT r.doc_no FROM scm.reno_quotation_revisions r WHERE r.quotation_id = d.id ORDER BY (r.rev_no = d.current_rev) DESC, r.rev_no DESC LIMIT 1)",
    /* The current revision's lines: a new revision is a new set of lines. */
    lines: renoLines(`s.revision_id = (SELECT r.id FROM scm.reno_quotation_revisions r JOIN scm.reno_quotations q ON q.id = r.quotation_id AND r.rev_no = q.current_rev WHERE q.id = ?::uuid)`),
  },
  sales_order: {
    label: "Sales order", table: "scm.mfg_sales_orders", idCol: "doc_no", idKind: "text", noExpr: "d.doc_no",
    lines: { ...item("mfg_sales_order_items", "doc_no"), from: "scm.mfg_sales_order_items x WHERE x.doc_no = ?", order: "x.line_no, x.id" },
  },
  variation_order: {
    label: "Variation order", table: "scm.reno_variation_orders", idCol: "id", idKind: "uuid", noExpr: "d.vo_no",
    lines: renoLines("s.vo_id = ?::uuid"),
  },
  purchase_order: {
    label: "Purchase order", table: "scm.purchase_orders", idCol: "id", idKind: "uuid", noExpr: "d.po_number",
    lines: item("purchase_order_items", "purchase_order_id", {
      order: "x.line_no, x.id", description: "coalesce(nullif(x.description, ''), nullif(x.material_name, ''), x.item_code)",
      parent: { type: "sales_order", col: "so_item_id" },
    }),
  },
  delivery_order: {
    label: "Delivery order", table: "scm.delivery_orders", idCol: "id", idKind: "uuid", noExpr: "d.do_number",
    lines: item("delivery_order_items", "delivery_order_id", { order: "x.line_no, x.id", parent: { type: "sales_order", col: "so_item_id" } }),
  },
  goods_received: {
    label: "Goods received", table: "scm.grns", idCol: "id", idKind: "uuid", noExpr: "d.grn_number",
    /* Lines saved in one go share a timestamp: number them in their PO lines' order, as the person sees them. */
    lines: item("grn_items", "grn_id", {
      order: "(SELECT p.line_no FROM scm.purchase_order_items p WHERE p.id = x.purchase_order_item_id) NULLS LAST, x.created_at, x.id",
      description: "coalesce(nullif(x.description, ''), nullif(x.material_name, ''), x.item_code)",
      parent: { type: "purchase_order", col: "purchase_order_item_id" },
    }),
  },
  delivery_return: {
    label: "Delivery return", table: "scm.delivery_returns", idCol: "id", idKind: "uuid", noExpr: "d.return_number",
    lines: item("delivery_return_items", "delivery_return_id", {
      order: "(SELECT o.line_no FROM scm.delivery_order_items o WHERE o.id = x.do_item_id) NULLS LAST, x.created_at, x.id", parent: { type: "delivery_order", col: "do_item_id" } }),
  },
  purchase_return: {
    label: "Purchase return", table: "scm.purchase_returns", idCol: "id", idKind: "uuid", noExpr: "d.return_number",
    lines: item("purchase_return_items", "purchase_return_id", {
      order: "(SELECT p.line_no FROM scm.grn_items g JOIN scm.purchase_order_items p ON p.id = g.purchase_order_item_id WHERE g.id = x.grn_item_id) NULLS LAST, x.created_at, x.id",
      description: "coalesce(nullif(x.description, ''), nullif(x.material_name, ''), x.item_code)",
      parent: { type: "goods_received", col: "grn_item_id" },
    }),
  },
  purchase_invoice: {
    label: "Purchase invoice", table: "scm.purchase_invoices", idCol: "id", idKind: "uuid", noExpr: "d.invoice_number",
    lines: item("purchase_invoice_items", "purchase_invoice_id", {
      order: "(SELECT p.line_no FROM scm.grn_items g JOIN scm.purchase_order_items p ON p.id = g.purchase_order_item_id WHERE g.id = x.grn_item_id) NULLS LAST, x.created_at, x.id",
      description: "coalesce(nullif(x.description, ''), nullif(x.material_name, ''), x.item_code)",
      parent: { type: "goods_received", col: "grn_item_id" },
    }),
  },
  sales_invoice: {
    label: "Sales invoice", table: "scm.sales_invoices", idCol: "id", idKind: "uuid", noExpr: "d.invoice_number",
    lines: item("sales_invoice_items", "sales_invoice_id", { order: "x.line_no, x.id", parent: { type: "sales_order", col: "so_item_id" } }),
  },
  receipt: {
    label: "Receipt", table: "scm.acc_receipts", idCol: "id", idKind: "uuid", noExpr: "d.receipt_number",
    lines: account("acc_receipt_lines", "receipt_id"),
  },
  credit_note: {
    label: "Credit / debit note", table: "scm.acc_credit_notes", idCol: "id", idKind: "uuid", noExpr: "d.note_number",
    lines: account("acc_credit_note_lines", "note_id"),
  },
  official_receipt: {
    label: "Official receipt", table: "scm.acc_official_receipts", idCol: "id", idKind: "int",
    noExpr: "coalesce(d.or_number, 'Draft receipt ' || d.id::text)",
  },
  deposit_invoice: { label: "Deposit invoice", table: "scm.acc_deposit_invoices", idCol: "id", idKind: "uuid", noExpr: "d.di_number" },
  payment_voucher: {
    label: "Payment voucher", table: "scm.payment_vouchers", idCol: "id", idKind: "uuid", noExpr: "d.pv_number",
    lines: account("payment_voucher_lines", "pv_id"), evidence: { table: "scm.acc_pv_files", fk: "pv_id" },
  },
  ap_invoice: {
    label: "AP invoice", table: "scm.ap_invoices", idCol: "id", idKind: "uuid", noExpr: "d.invoice_number",
    lines: account("ap_invoice_lines", "invoice_id"), evidence: { table: "scm.acc_ap_invoice_files", fk: "ap_invoice_id" },
  },
};

export const isDocType = (v: unknown): v is DocType => typeof v === "string" && Object.prototype.hasOwnProperty.call(DOC_TYPES, v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validDocId(type: DocType, id: string): boolean {
  const k = DOC_TYPES[type].idKind;
  return k === "uuid" ? UUID.test(id) : k === "int" ? /^\d{1,18}$/.test(id) : id.length > 0 && id.length <= 64;
}
const idCast = (type: DocType) => (DOC_TYPES[type].idKind === "uuid" ? "::uuid" : DOC_TYPES[type].idKind === "int" ? "::bigint" : "");

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
  source: "upload" | "import" | "legacy" | "pod" | "evidence";
  by: string | null;
  at: string;
  /** The line it is on, or null for the whole document. */
  lineId: string | null;
  /** Shown here but kept elsewhere: the driver's proof-of-delivery photo, or a file on the line upstream. */
  readOnly: boolean;
  /** For a file carried from upstream: where it is kept, e.g. "Sales order SO-2610-0003". */
  from?: string;
}

export interface DocRef { type: DocType; id: string; no: string; companyId: number }

export interface DocLine { id: string; lineNo: number; sku: string; description: string; parentId: string | null }

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
      WHERE d.${s.idCol} = ?${idCast(type)}${companySql}`,
  ).bind(id).first<{ id: string; no: string | null; company_id: number }>();
  return r ? { type, id: r.id, no: r.no ?? "", companyId: Number(r.company_id) } : null;
}

/** A Postgres text[] literal; document numbers and ids never hold quotes or backslashes, which are dropped. */
export const textArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, "")}"`).join(",")}}`;

/** Documents by their numbers, for the import. */
export async function findDocsByNumber(db: Db, type: DocType, numbers: string[], companySql: string): Promise<DocRef[]> {
  if (numbers.length === 0) return [];
  const s = DOC_TYPES[type];
  const q = type === "quotation"
    ? `SELECT DISTINCT d.id::text AS id, r.doc_no AS no, d.company_id::int AS company_id FROM ${s.table} d
         JOIN scm.reno_quotation_revisions r ON r.quotation_id = d.id WHERE r.doc_no = ANY(?::text[])${companySql}`
    : `SELECT d.${s.idCol}::text AS id, ${s.noExpr} AS no, d.company_id::int AS company_id FROM ${s.table} d
        WHERE ${s.noExpr} = ANY(?::text[])${companySql}`;
  const res = await db.prepare(q).bind(textArray(numbers)).all<{ id: string; no: string; company_id: number }>();
  return (res.results ?? []).map((r) => ({ type, id: r.id, no: r.no, companyId: Number(r.company_id) }));
}

/** A document's lines in order, numbered from 1, with the upstream line each one carries files from. */
export async function listLines(db: Db, doc: Pick<DocRef, "type" | "id">): Promise<DocLine[]> {
  const l = DOC_TYPES[doc.type].lines;
  if (!l) return [];
  const res = await db.prepare(
    `SELECT x.id::text AS id, (row_number() OVER (ORDER BY ${l.order}))::int AS line_no, coalesce(${l.sku}, '') AS sku,
            coalesce(${l.description}, '') AS description, ${l.parent ? `x.${l.parent.col}::text` : "NULL::text"} AS parent_id
       FROM ${l.from} ORDER BY line_no`,
  ).bind(doc.id).all<{ id: string; line_no: number; sku: string; description: string; parent_id: string | null }>();
  return (res.results ?? []).map((r) => ({ id: r.id, lineNo: Number(r.line_no), sku: r.sku, description: r.description, parentId: r.parent_id }));
}

/** True when `lineId` is one of the document's lines. */
export async function lineBelongs(db: Db, doc: Pick<DocRef, "type" | "id">, lineId: string): Promise<boolean> {
  const l = DOC_TYPES[doc.type].lines;
  if (!l || !UUID.test(lineId)) return false;
  const r = await db.prepare(`SELECT 1 AS ok FROM ${l.from} AND x.id = ?::uuid`).bind(doc.id, lineId).first<{ ok: number }>();
  return !!r;
}

const lineTable = (type: DocType): string => /^(scm\.\w+) x/.exec(DOC_TYPES[type].lines?.from ?? "")?.[1] ?? "";

/** For each of the lines, the lines upstream it carries files from, nearest first (a GR line: its PO line, then
    that PO line's SO line). Ids only; nothing is copied. */
export async function upstreamLines(db: Db, type: DocType, lines: DocLine[]): Promise<Map<string, Array<{ type: DocType; lineId: string }>>> {
  const out = new Map<string, Array<{ type: DocType; lineId: string }>>();
  type Step = { origin: string; type: DocType; parentId: string };
  let step: Step[] = DOC_TYPES[type].lines?.parent
    ? lines.filter((l) => l.parentId).map((l) => ({ origin: l.id, type, parentId: l.parentId as string }))
    : [];
  for (let depth = 0; depth < 4 && step.length; depth++) {
    const next: Step[] = [];
    const byType = new Map<DocType, Step[]>();
    for (const e of step) {
      const parentType = DOC_TYPES[e.type].lines?.parent?.type;
      if (!parentType) continue;
      out.set(e.origin, [...(out.get(e.origin) ?? []), { type: parentType, lineId: e.parentId }]);
      byType.set(parentType, [...(byType.get(parentType) ?? []), e]);
    }
    for (const [pt, es] of byType) {
      const grand = DOC_TYPES[pt].lines?.parent;
      if (!grand) continue;
      const res = await db.prepare(`SELECT x.id::text AS id, x.${grand.col}::text AS parent_id FROM ${lineTable(pt)} x WHERE x.id = ANY(?::uuid[])`)
        .bind(textArray([...new Set(es.map((e) => e.parentId))])).all<{ id: string; parent_id: string | null }>();
      const parentOf = new Map((res.results ?? []).map((r) => [r.id, r.parent_id]));
      for (const e of es) {
        const gp = parentOf.get(e.parentId);
        if (gp) next.push({ origin: e.origin, type: pt, parentId: gp });
      }
    }
    step = next;
  }
  return out;
}

interface Row {
  id: string; file_name: string; mime: string; size_bytes: number | string | null; caption: string | null; source: string;
  uploaded_by_name: string | null; created_at: string; doc_type: string; doc_id: string; line_id: string | null;
}

const toFile = (r: Row): DocFile => ({
  id: r.id, name: r.file_name, mime: r.mime, kind: fileKind(r.mime) ?? "file", size: Number(r.size_bytes ?? 0),
  caption: r.caption ?? "", source: r.source as DocFile["source"], by: r.uploaded_by_name, at: new Date(r.created_at).toISOString(),
  lineId: r.line_id, readOnly: false,
});

const COLS = `id::text AS id, file_name, mime, size_bytes, caption, source, uploaded_by_name, created_at, doc_type, doc_id, line_id`;

/** The files of many documents at once (the project roll-up), both levels, oldest first; keyed "type:id". */
export async function listFilesFor(db: Db, docs: Array<{ type: DocType; id: string }>, companyId: number): Promise<Map<string, DocFile[]>> {
  const out = new Map<string, DocFile[]>();
  if (docs.length === 0) return out;
  const res = await db.prepare(
    `SELECT ${COLS} FROM scm.doc_attachments
      WHERE deleted_at IS NULL AND company_id = ? AND (doc_type || ':' || doc_id) = ANY(?::text[])
      ORDER BY created_at, id`,
  ).bind(companyId, textArray(docs.map((d) => `${d.type}:${d.id}`))).all<Row>();
  for (const r of res.results ?? []) {
    const k = `${r.doc_type}:${r.doc_id}`;
    out.set(k, [...(out.get(k) ?? []), toFile(r)]);
  }
  return out;
}

/** The document's own files, both levels. */
export async function listFiles(db: Db, doc: DocRef): Promise<DocFile[]> {
  const res = await db.prepare(
    `SELECT ${COLS} FROM scm.doc_attachments
      WHERE deleted_at IS NULL AND company_id = ? AND doc_type = ? AND doc_id = ? ORDER BY created_at, id`,
  ).bind(doc.companyId, doc.type, doc.id).all<Row>();
  return (res.results ?? []).map(toFile);
}

async function docNumbers(db: Db, pairs: Array<{ type: DocType; id: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byType = new Map<DocType, string[]>();
  for (const p of pairs) byType.set(p.type, [...(byType.get(p.type) ?? []), p.id]);
  for (const [t, ids] of byType) {
    const s = DOC_TYPES[t];
    const res = await db.prepare(`SELECT d.${s.idCol}::text AS id, ${s.noExpr} AS no FROM ${s.table} d WHERE d.${s.idCol}::text = ANY(?::text[])`)
      .bind(textArray([...new Set(ids)])).all<{ id: string; no: string | null }>();
    for (const r of res.results ?? []) out.set(`${t}:${r.id}`, r.no ?? "");
  }
  return out;
}

/** Files on the lines upstream of these lines, as read-only files of the line that shows them, keyed by that line;
    with their keys, so this document's stream can serve them. */
export async function carriedFiles(db: Db, doc: DocRef, lines: DocLine[]): Promise<Map<string, Array<DocFile & { key: string }>>> {
  const out = new Map<string, Array<DocFile & { key: string }>>();
  const up = await upstreamLines(db, doc.type, lines);
  const wanted = [...new Set([...up.values()].flat().map((u) => `${u.type}:${u.lineId}`))];
  if (wanted.length === 0) return out;
  const res = await db.prepare(
    `SELECT ${COLS}, r2_key FROM scm.doc_attachments
      WHERE deleted_at IS NULL AND company_id = ? AND line_id IS NOT NULL AND (doc_type || ':' || line_id) = ANY(?::text[])
      ORDER BY created_at, id`,
  ).bind(doc.companyId, textArray(wanted)).all<Row & { r2_key: string }>();
  const rows = res.results ?? [];
  if (rows.length === 0) return out;
  const nos = await docNumbers(db, rows.map((r) => ({ type: r.doc_type as DocType, id: r.doc_id })));
  for (const [lineId, chain] of up) {
    for (const u of chain) {
      for (const r of rows.filter((x) => x.doc_type === u.type && x.line_id === u.lineId)) {
        out.set(lineId, [...(out.get(lineId) ?? []), {
          ...toFile(r), key: r.r2_key, lineId, readOnly: true,
          from: `${DOC_TYPES[u.type].label} ${nos.get(`${u.type}:${r.doc_id}`) ?? ""}`.trim(),
        }]);
      }
    }
  }
  return out;
}

/** A delivery order's proof-of-delivery photo as a read-only file, or null when the driver took none. */
/** Every proof-of-delivery photo on a delivery (pod_photo_keys; a delivery closed before several photos has just
 *  pod_r2_key). The first answers as "pod", the rest as "pod-1", "pod-2", ... */
export async function podFiles(db: Db, doId: string): Promise<Array<DocFile & { key: string }>> {
  const r = await db.prepare(
    `SELECT pod_r2_key, pod_photo_keys, coalesce(delivered_at, updated_at) AS at FROM scm.delivery_orders WHERE id = ?::uuid`,
  ).bind(doId).first<{ pod_r2_key: string | null; pod_photo_keys: unknown; at: string | null }>();
  if (!r) return [];
  const listed = Array.isArray(r.pod_photo_keys) ? r.pod_photo_keys.filter((k): k is string => typeof k === "string" && !!k) : [];
  const keys = listed.length ? listed : r.pod_r2_key ? [r.pod_r2_key] : [];
  const at = r.at ? new Date(r.at).toISOString() : "";
  return keys.map((key, n) => ({
    id: n === 0 ? POD_FILE_ID : `${POD_FILE_ID}-${n}`, key, name: keys.length > 1 ? `Proof of delivery photo ${n + 1}` : "Proof of delivery photo",
    mime: "image/jpeg", kind: "image" as const, size: 0, caption: "Taken by the driver at delivery", source: "pod" as const, by: null, at,
    lineId: null, readOnly: true,
  }));
}

export const isPodFileId = (fileId: string): boolean => fileId === POD_FILE_ID || /^pod-\d+$/.test(fileId);

export async function podFileById(db: Db, doId: string, fileId: string): Promise<(DocFile & { key: string }) | null> {
  return (await podFiles(db, doId)).find((f) => f.id === fileId) ?? null;
}

/** One of the document's own stored files (either level), with its R2 key (never sent to the browser). */
export async function fileRow(db: Db, doc: DocRef, fileId: string): Promise<{ key: string; mime: string; name: string } | null> {
  if (!UUID.test(fileId)) return null;
  return db.prepare(
    `SELECT r2_key AS key, mime, file_name AS name FROM scm.doc_attachments
      WHERE id = ?::uuid AND deleted_at IS NULL AND company_id = ? AND doc_type = ? AND doc_id = ?`,
  ).bind(fileId, doc.companyId, doc.type, doc.id).first<{ key: string; mime: string; name: string }>();
}

/** A file the document shows from a line upstream (for its stream). */
export async function carriedFileRow(db: Db, doc: DocRef, fileId: string): Promise<{ key: string; mime: string; name: string } | null> {
  if (!UUID.test(fileId) || !DOC_TYPES[doc.type].lines?.parent) return null;
  const carried = await carriedFiles(db, doc, await listLines(db, doc));
  for (const list of carried.values()) {
    const hit = list.find((f) => f.id === fileId);
    if (hit) return { key: hit.key, mime: hit.mime, name: hit.name };
  }
  return null;
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
  for (const a of raw as Array<null | { key?: string; name?: string; type?: string; size?: number; at?: string; by?: string | null }>) {
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

/** A payment voucher's or AP invoice's earlier evidence files, read-only; ids "ev-<id>". With their keys (SLIPS). */
export async function evidenceFiles(db: Db, doc: DocRef): Promise<Array<DocFile & { key: string }>> {
  const ev = DOC_TYPES[doc.type].evidence;
  if (!ev) return [];
  const res = await db.prepare(
    `SELECT id::text AS id, file_key, file_name, mime, size_bytes, created_at FROM ${ev.table}
      WHERE ${ev.fk}::text = ? AND company_id = ? ORDER BY sort_no, created_at`,
  ).bind(doc.id, doc.companyId).all<{ id: string; file_key: string; file_name: string; mime: string; size_bytes: number | null; created_at: string }>();
  return (res.results ?? []).map((r) => ({
    id: `ev-${r.id}`, key: r.file_key, name: r.file_name, mime: r.mime, kind: fileKind(r.mime) ?? "file", size: Number(r.size_bytes ?? 0),
    caption: "", source: "evidence" as const, by: null, at: r.created_at ? new Date(r.created_at).toISOString() : "",
    lineId: null, readOnly: true,
  }));
}
