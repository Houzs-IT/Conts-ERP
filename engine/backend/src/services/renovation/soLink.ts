/* Sales order <-> project, in either order (owner decisions 11 Oct 2026).

   A renovation SO may be made before its project (quotation with no project ->
   convert) and linked later, or a project may pick an existing SO. Linking sets
   the project id on the SO, its contract header and its source quotation, then
   runs the same after-change work a conversion runs (site tasks from the
   contract's WORKS lines, cached stage). One live renovation SO per project
   stays (uq_mfg_so_reno_project).

   Unlinking is allowed only while nothing downstream depends on the link: no
   signed handover, no received PO line on the SO's lines, no site task on its
   lines started or done. It removes the task links of the SO's lines and the
   auto-made tasks left with no line that nobody touched. */

import type { Db } from "./load";
import { loadProjectRows, loadRenovationFacts } from "./load";
import { onContractLinesChanged, writeCachedStage } from "./contractSync";
import { autoProjectName } from "./projectSettings";
import { createRenovationProject, type CreateRenovationInput } from "./create";

export type LinkRefusal =
  | "so_not_found"
  | "not_renovation_so"
  | "so_cancelled"
  | "so_has_other_project"
  | "already_linked"
  | "project_has_so";

export const LINK_REFUSAL_TEXT: Readonly<Record<LinkRefusal, string>> = {
  so_not_found: "That sales order does not exist.",
  not_renovation_so: "Only a renovation sales order can be linked to a renovation project.",
  so_cancelled: "That sales order is cancelled.",
  so_has_other_project: "That sales order already belongs to another project. Unlink it there first.",
  already_linked: "That sales order is already linked to this project.",
  project_has_so: "This project already has a sales order. Unlink it first: one project has one contract.",
};

export interface SoForLink { so_kind: string | null; status: string; project_id: number | null; company_id: number }

export function linkRefusal(
  so: SoForLink | null,
  p: { projectCompanyId: number; projectProjectSo: string | null; projectId: number },
): LinkRefusal | null {
  if (!so || Number(so.company_id) !== Number(p.projectCompanyId)) return "so_not_found";
  if (so.so_kind !== "RENOVATION") return "not_renovation_so";
  if (so.status === "CANCELLED") return "so_cancelled";
  if (so.project_id != null && Number(so.project_id) !== p.projectId) return "so_has_other_project";
  if (so.project_id != null && Number(so.project_id) === p.projectId) return "already_linked";
  if (p.projectProjectSo) return "project_has_so";
  return null;
}

export interface UnlinkFacts { handedOver: boolean; receivedPoLines: number; startedTasks: number }

export function unlinkRefusal(f: UnlinkFacts): { code: "handover_signed" | "po_received" | "tasks_started"; message: string } | null {
  if (f.handedOver) return { code: "handover_signed", message: "The customer has signed the handover, so the contract stays with this project." };
  if (f.receivedPoLines > 0) {
    return { code: "po_received", message: `${f.receivedPoLines} purchase order line${f.receivedPoLines === 1 ? " has" : "s have"} been received for this contract, so it stays with this project.` };
  }
  if (f.startedTasks > 0) {
    return { code: "tasks_started", message: `${f.startedTasks} site task${f.startedTasks === 1 ? "" : "s"} on this contract's lines ${f.startedTasks === 1 ? "has" : "have"} started, so it stays with this project.` };
  }
  return null;
}

export type LinkResult = { ok: true; docNo: string } | { ok: false; status: 404 | 409; error: string; message: string };

async function projectHead(db: Db, projectId: number, companySql: string) {
  return db.prepare(`SELECT id::int AS id, company_id::int AS company_id FROM projects p WHERE p.id = ? AND p.project_kind = 'renovation'${companySql}`)
    .bind(projectId).first<{ id: number; company_id: number }>();
}

async function liveSoOfProject(db: Db, projectId: number): Promise<string | null> {
  const r = await db.prepare(`SELECT doc_no FROM scm.mfg_sales_orders WHERE project_id = ? AND so_kind = 'RENOVATION' AND status::text <> 'CANCELLED' LIMIT 1`)
    .bind(projectId).first<{ doc_no: string }>();
  return r?.doc_no ?? null;
}

/** Link an existing renovation SO to a project. `companySql` scopes the project read (activeCompanySql on p.company_id). */
export async function linkSoToProject(db: Db, projectId: number, docNo: string, actorId: number, companySql: string): Promise<LinkResult> {
  const p = await projectHead(db, projectId, companySql);
  if (!p) return { ok: false, status: 404, error: "not_found", message: "Project not found." };
  const so = await db.prepare(
    `SELECT doc_no, so_kind, status::text AS status, project_id::int AS project_id, company_id::int AS company_id FROM scm.mfg_sales_orders WHERE doc_no = ?`,
  ).bind(docNo).first<SoForLink & { doc_no: string }>();
  const refusal = linkRefusal(so, { projectCompanyId: p.company_id, projectProjectSo: await liveSoOfProject(db, projectId), projectId });
  if (refusal) return { ok: false, status: refusal === "so_not_found" ? 404 : 409, error: refusal, message: LINK_REFUSAL_TEXT[refusal] };
  const stmts = [
    db.prepare(`UPDATE scm.mfg_sales_orders SET project_id = ?, updated_at = now() WHERE doc_no = ? AND project_id IS NULL`).bind(projectId, docNo),
    db.prepare(`UPDATE scm.reno_so_contracts SET project_id = ?, updated_at = now() WHERE so_doc_no = ?`).bind(projectId, docNo),
    db.prepare(
      `UPDATE scm.reno_quotations q SET project_id = ?, updated_at = now()
         FROM scm.reno_so_contracts c WHERE c.so_doc_no = ? AND q.id = c.quotation_id AND q.project_id IS NULL`,
    ).bind(projectId, docNo),
    db.prepare(`INSERT INTO project_activity (project_id, action, to_value, user_id, company_id) VALUES (?, 'so_linked', ?, ?, ?)`)
      .bind(projectId, docNo, actorId, p.company_id),
  ];
  if (db.batch) await db.batch(stmts);
  else for (const s of stmts) await s.run();
  await onContractLinesChanged(db, docNo);
  return { ok: true, docNo };
}

/** Take the SO off its project when nothing downstream depends on the link. */
export async function unlinkSoFromProject(db: Db, projectId: number, actorId: number, companySql: string): Promise<LinkResult> {
  const rows = await loadProjectRows(db, companySql, { projectId, includeArchived: true });
  if (rows.length === 0) return { ok: false, status: 404, error: "not_found", message: "Project not found." };
  const f = (await loadRenovationFacts(db, rows)).get(projectId)!;
  if (!f.so) return { ok: false, status: 409, error: "no_so", message: "This project has no sales order to unlink." };
  const soItems = new Set((f.allLines ?? []).map((l) => l.soItemId));
  /* a PO line can sit on an SO item the contract-lines read missed (phase 2 tables lagging): count those too */
  for (const pl of f.poLines) soItems.add(pl.so_item_id);
  const taskIdsOnSo = new Set(f.taskLines.filter((tl) => soItems.has(tl.so_item_id)).map((tl) => Number(tl.task_id)));
  const started = f.tasks.filter((t) => taskIdsOnSo.has(Number(t.id)) && (t.state === "in_progress" || t.state === "done" || !!t.actual_start));
  const refusal = unlinkRefusal({
    handedOver: !!f.handover || !!f.project.handed_over_at,
    receivedPoLines: f.poLines.filter((pl) => Number(pl.received_qty) > 0).length,
    startedTasks: started.length,
  });
  if (refusal) return { ok: false, status: 409, error: refusal.code, message: refusal.message };
  const docNo = f.so.doc_no;
  const items = JSON.stringify([...soItems]);
  const stmts = [
    db.prepare(
      `DELETE FROM project_trade_task_lines l USING project_trade_tasks t
        WHERE t.id = l.task_id AND t.project_id = ? AND l.so_item_id::text IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    ).bind(projectId, items),
    /* auto-made PO tasks of this contract that are now lineless and untouched: no dates, no crew, no notes */
    db.prepare(
      `DELETE FROM project_trade_tasks t
        WHERE t.project_id = ? AND t.id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)
          AND t.fulfilment_kind = 'po' AND t.state = 'open' AND t.actual_start IS NULL AND t.planned_start IS NULL AND t.planned_end IS NULL
          AND t.notes IS NULL AND t.source = 'app'
          AND NOT EXISTS (SELECT 1 FROM project_trade_task_lines l WHERE l.task_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM project_trade_task_assignees a WHERE a.task_id = t.id)`,
    ).bind(projectId, JSON.stringify([...taskIdsOnSo])),
    db.prepare(
      `UPDATE project_trade_tasks t SET purchase_order_id = NULL, updated_at = now()
        WHERE t.project_id = ? AND t.id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)
          AND NOT EXISTS (SELECT 1 FROM project_trade_task_lines l WHERE l.task_id = t.id)`,
    ).bind(projectId, JSON.stringify([...taskIdsOnSo])),
    db.prepare(`UPDATE scm.reno_quotations q SET project_id = NULL, updated_at = now() FROM scm.reno_so_contracts c
                 WHERE c.so_doc_no = ? AND q.id = c.quotation_id AND q.project_id = ?`).bind(docNo, projectId),
    db.prepare(`UPDATE scm.reno_so_contracts SET project_id = NULL, updated_at = now() WHERE so_doc_no = ?`).bind(docNo),
    db.prepare(`UPDATE scm.mfg_sales_orders SET project_id = NULL, updated_at = now() WHERE doc_no = ? AND project_id = ?`).bind(docNo, projectId),
    db.prepare(`INSERT INTO project_activity (project_id, action, from_value, user_id, company_id) VALUES (?, 'so_unlinked', ?, ?, ?)`)
      .bind(projectId, docNo, actorId, Number(f.project.company_id)),
  ];
  if (db.batch) await db.batch(stmts);
  else for (const s of stmts) await s.run();
  const after = (await loadRenovationFacts(db, rows)).get(projectId)!;
  await writeCachedStage(db, projectId, after);
  return { ok: true, docNo };
}

/** Open a project from an SO that has none: name, customer, building and unit come from the contract header. */
export async function createProjectFromSo(
  db: Db,
  docNo: string,
  input: { projectTypeId: number; name?: string | null; salesPersonId?: number | null },
  actorId: number,
  companyId: number,
  companySql: string,
): Promise<LinkResult & { projectId?: number; code?: string }> {
  const so = await db.prepare(
    `SELECT o.doc_no, o.so_kind, o.status::text AS status, o.project_id::int AS project_id, o.company_id::int AS company_id, o.debtor_name,
            o.phone, o.email, o.agent, c.customer_name, c.building, c.unit_no
       FROM scm.mfg_sales_orders o LEFT JOIN scm.reno_so_contracts c ON c.so_doc_no = o.doc_no WHERE o.doc_no = ?`,
  ).bind(docNo).first<SoForLink & { debtor_name: string | null; phone: string | null; email: string | null; agent: string | null; customer_name: string | null; building: string | null; unit_no: string | null }>();
  const refusal = linkRefusal(so, { projectCompanyId: companyId, projectProjectSo: null, projectId: -1 });
  if (refusal) return { ok: false, status: refusal === "so_not_found" ? 404 : 409, error: refusal, message: LINK_REFUSAL_TEXT[refusal] };
  const customer = (so!.customer_name || so!.debtor_name || "").trim();
  const name = String(input.name ?? "").trim() || autoProjectName(so!.building, so!.unit_no, customer) || docNo;
  const body: CreateRenovationInput = {
    name, projectTypeId: input.projectTypeId, customerKind: "customer", customerName: customer || name,
    customerPhone: so!.phone, customerEmail: so!.email, building: so!.building || null, unitNo: so!.unit_no || null,
    salespersonName: so!.agent, salesPersonId: input.salesPersonId ?? null,
  };
  const created = await createRenovationProject(db, body, actorId, companyId);
  if (!created) return { ok: false, status: 409, error: "type_not_found", message: "That project type does not exist or is switched off." };
  const linked = await linkSoToProject(db, created.id, docNo, actorId, companySql);
  if (!linked.ok) return linked;
  return { ok: true, docNo, projectId: created.id, code: created.code };
}
