/* Built-in POs and the project's 2D drawings (owner, 5 Nov 2026). A live PO that buys a Built-in SKU prints the approved
   2D set behind it, once per PO. A newer approved set therefore changes what the carpenter holds, so it is recorded on
   each such PO as an approved amendment and a new revision, with the old PO kept in po_revisions as any other revision. */

import type { Db } from "./load";

export interface BuiltinPo { id: string; poNumber: string; revision: number; supplierName: string | null }

const ON_PROJECT = `(po.project_id = ? OR EXISTS (SELECT 1 FROM scm.mfg_sales_order_items si JOIN scm.mfg_sales_orders so ON so.doc_no = si.doc_no
                                                   WHERE si.id = pi.so_item_id AND so.project_id = ?))`;

export async function builtinPosOf(db: Db, projectId: number, companyId: number): Promise<BuiltinPo[]> {
  const { results } = await db.prepare(
    `SELECT DISTINCT po.id::text AS id, po.po_number, po.revision, s.name AS supplier_name
       FROM scm.purchase_orders po
       JOIN scm.purchase_order_items pi ON pi.purchase_order_id = po.id
       JOIN scm.mfg_products p ON p.code = pi.item_code AND p.company_id = po.company_id AND p.category::text = 'BUILTIN'
       LEFT JOIN scm.suppliers s ON s.id = po.supplier_id
      WHERE po.company_id = ? AND po.status::text NOT IN ('DRAFT', 'CANCELLED') AND ${ON_PROJECT}
      ORDER BY po.po_number`,
  ).bind(companyId, projectId, projectId).all<{ id: string; po_number: string; revision: number; supplier_name: string | null }>();
  return (results ?? []).map((r) => ({ id: r.id, poNumber: r.po_number, revision: Number(r.revision), supplierName: r.supplier_name }));
}

/** Records a newly approved 2D set on every Built-in PO of the project. Answers the amendment numbers. */
export async function recordDrawingAmendments(db: Db, projectId: number, companyId: number, label: string, approvedOn: string): Promise<string[]> {
  const out: string[] = [];
  for (const po of await builtinPosOf(db, projectId, companyId)) {
    const count = await db.prepare(`SELECT count(*)::int AS n FROM scm.po_amendments WHERE po_id = ?::uuid`).bind(po.id).first<{ n: number }>();
    const amendmentNo = `${po.poNumber}/A${Number(count?.n ?? 0) + 1}`;
    await db.prepare(
      `WITH a AS (
         INSERT INTO scm.po_amendments (po_id, po_number, amendment_no, status, reason, approved_at, company_id)
         VALUES (?::uuid, ?, ?, 'APPROVED', ?, now(), ?) RETURNING id
       ), s AS (
         INSERT INTO scm.po_revisions (po_id, revision, snapshot, amendment_id)
         SELECT po.id, po.revision,
                jsonb_build_object('header', to_jsonb(po), 'snapshotAt', now(),
                  'lines', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no NULLS LAST, i.created_at) FROM scm.purchase_order_items i WHERE i.purchase_order_id = po.id), '[]'::jsonb)),
                a.id
           FROM scm.purchase_orders po, a WHERE po.id = ?::uuid
         ON CONFLICT (po_id, revision) DO NOTHING
       )
       UPDATE scm.purchase_orders SET revision = revision + 1, updated_at = now() WHERE id = ?::uuid`,
    ).bind(po.id, po.poNumber, amendmentNo, `2D drawings updated to ${label}, client approved ${approvedOn}.`, companyId, po.id, po.id).run();
    out.push(amendmentNo);
  }
  return out;
}

export interface PoDrawings {
  projectId: number | null;
  projectName?: string;
  unit?: string | null;
  files?: unknown[];
  approved?: { fileId: number; version: number; approvedOn: string } | null;
}

/** The project and the approved 2D set behind a Built-in PO; projectId is null for any other PO. */
export async function poDrawings(db: Db, poId: string, companyId: number): Promise<PoDrawings> {
  const p = await db.prepare(
    `SELECT pr.id::int AS id, pr.name, pr.building, pr.unit_no
       FROM scm.purchase_orders po
       JOIN scm.purchase_order_items pi ON pi.purchase_order_id = po.id
       JOIN scm.mfg_products m ON m.code = pi.item_code AND m.company_id = po.company_id AND m.category::text = 'BUILTIN'
       LEFT JOIN scm.mfg_sales_order_items si ON si.id = pi.so_item_id
       LEFT JOIN scm.mfg_sales_orders so ON so.doc_no = si.doc_no
       JOIN projects pr ON pr.id = coalesce(po.project_id, so.project_id)
      WHERE po.id = ?::uuid AND po.company_id = ? LIMIT 1`,
  ).bind(poId, companyId).first<{ id: number; name: string; building: string | null; unit_no: string | null }>();
  if (!p) return { projectId: null };
  return { ...(await projectDrawings(db, p.id)), projectName: p.name, unit: [p.building, p.unit_no].filter(Boolean).join(" ") || null };
}

/** The project's 2D files and its approved set, for a Built-in line that may have no PO yet. */
export async function projectDrawings(db: Db, projectId: number): Promise<PoDrawings> {
  const p = { id: projectId };
  const { results } = await db.prepare(
    `SELECT f.id::int AS id, f.kind, f.version::int AS version, f.file_name, f.r2_key, f.external_url, f.content_type, f.size_bytes,
            f.submitted_on::text AS submitted_on, f.uploaded_at::text AS uploaded_at
       FROM project_design_files f WHERE f.project_id = ? AND f.kind = '2d' ORDER BY f.version`,
  ).bind(p.id).all<Record<string, unknown>>();
  const a = await db.prepare(
    `SELECT f.id::int AS id, f.version::int AS version, r.approved_on::text AS approved_on
       FROM project_design_files f JOIN project_design_file_reviews r ON r.file_id = f.id
      WHERE f.project_id = ? AND f.kind = '2d' AND r.approved_on IS NOT NULL ORDER BY f.version DESC LIMIT 1`,
  ).bind(p.id).first<{ id: number; version: number; approved_on: string }>();
  return {
    projectId: p.id, files: results ?? [],
    approved: a ? { fileId: a.id, version: a.version, approvedOn: a.approved_on } : null,
  };
}
