/* Beta renovation project workspace, bundle A (owner, 23 Oct 2026; plan
   docs/superpowers/plans/2026-10-23-beta-project-workspace.md section 9). Mounted at /api/beta after the auth gate.
   The global auth gate runs first. Every project, defect and design-file route is scoped to the active company (404 otherwise), and
   every write adds a project_activity row (action beta_*) that the existing timeline reads. Section 10 of the plan
   (Home, Projects and Calendar) adds the board read and the design, appointment and calendar entry writes at the end. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql, requireActiveCompanyId } from "../scm/lib/companyScope";
import { billingViews } from "../scm/lib/renovation-billing";
import { todayMyt } from "../scm/lib/my-time";
import { financeHiddenForUser } from "../services/pmsAccess";
import { setChecklistStatus } from "../services/projects";
import { calendarMePersonIds } from "../services/renovation/calendarItems";
import { syncPeopleFromUsers } from "../services/renovation/peopleSync";
import { isMissingRelation, loadProjectRows, loadRenovationFacts, type Db, type DbStmt } from "../services/renovation/load";
import { renoDbFromD1 } from "../services/renovation/dbBridge";
import { writeCachedStage } from "../services/renovation/contractSync";
import {
  BETA_DEFAULT_2D_DAYS, BETA_DEFAULT_3D_DAYS, cleanBetaReminder, cleanBetaSettings, cleanDefectFixed, cleanDefectRedo, cleanDefectReport,
  cleanDesignApproval, cleanDesignSent, defectMoveRefusal, designLabel, paymentsOf, type BetaPayments, type BetaReceipt, type DefectMove,
} from "../services/renovation/beta";
import {
  BETA_AMENDMENT_DAYS, buildBoardProject, cleanBetaAppointment, cleanBetaDesign, cleanBetaEvent, cleanBetaEventPatch, cleanBoardRange, cleanNoteDays,
  designChangeNote, designPersonIds, groupByProject, isAppointmentKind, paymentLabel, rolesOf,
  type BetaDesignPatch, type BetaEventPatch, type BoardAppointmentRow, type BoardFileRow, type BoardNoteRow, type BoardPayment, type BoardProjectRow,
  type BoardReviewRow,
} from "../services/renovation/betaBoard";
import { loadClientItems, loadProjectPoLines, loadProjectVos } from "../services/renovation/betaVoPo";
import { LINK_DAYS, signClientLink } from "../services/renovation/betaClientLink";
import {
  betaCategory, cleanAssignee, cleanDefectPatch, defectPatchNote, isImageName, money, sortDeliveries, uniqueAreas,
  type DefectPatch, type DeliveryType, type SiteDelivery, type SitePhoto,
} from "../services/renovation/betaSite";
import { projectDocSql } from "../services/renovation/documents";
import { readProjectTimeline, sortTimeline, timelineNotesReady, type TimelineCategory, type TimelineEntry } from "../services/renovation/timeline";
import { docFlowColumnsReady } from "../scm/routes/renovation-doc-flow";
import { POD_FILE_ID, attachmentsReady, listFilesFor, podFile, type DocFile } from "../scm/lib/doc-attachments";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx): Db => c.env.DB as unknown as Db;
const userId = (c: Ctx): number => Number(c.get("user")?.id ?? 0);
const coSql = (c: Ctx, col = "company_id"): string => activeCompanySql(c, col);
const body = async (c: Ctx): Promise<Record<string, unknown>> => (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};

function parseId(x: string | undefined | null): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}


async function projectCompany(c: Ctx, id: number): Promise<number | null> {
  const r = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${coSql(c)}`).bind(id).first<{ company_id: number }>();
  return r ? Number(r.company_id) : null;
}

/** The project_activity insert of `logActivity` in routes/renovation.ts, as a statement (to run alone or inside a batch). */
function activityStmt(c: Ctx, projectId: number, companyId: number, action: string, from: string | null, to: string | null, note: string | null): DbStmt {
  return db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(projectId, action, from, to, note, userId(c), companyId);
}

interface DefectRow {
  id: number; project_id: number; company_id: number; fixed_at: string | null; closed_at: string | null; item_description: string | null;
}

/** A defect of a renovation project in the active company (a closed one still reads; an archived one does not). */
async function defectOf(c: Ctx, defectId: number): Promise<DefectRow | null> {
  return db(c).prepare(
    `SELECT d.id::int AS id, d.project_id::int AS project_id, p.company_id::int AS company_id, d.fixed_at::text AS fixed_at, d.closed_at::text AS closed_at,
            d.item_description
       FROM project_defects d JOIN projects p ON p.id = d.project_id
      WHERE d.id = ? AND d.archived_at IS NULL AND p.project_kind = 'renovation'${coSql(c, "p.company_id")}`,
  ).bind(defectId).first<DefectRow>();
}

interface DesignFileRow { id: number; project_id: number; company_id: number; kind: string; version: number }

async function designFileOf(c: Ctx, fileId: number): Promise<DesignFileRow | null> {
  return db(c).prepare(
    `SELECT f.id::int AS id, f.project_id::int AS project_id, p.company_id::int AS company_id, f.kind, f.version::int AS version
       FROM project_design_files f JOIN projects p ON p.id = f.project_id
      WHERE f.id = ? AND p.project_kind = 'renovation'${coSql(c, "p.company_id")}`,
  ).bind(fileId).first<DesignFileRow>();
}

// ── Workspace ────────────────────────────────────────────────────────────

const TS = (col: string): string => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

interface ProjectSoRow { project_id: number; doc_no: string; kind: string | null; total_sen: number | null }
interface ReceiptRow { so_doc_no: string; paid_on: string; amount_sen: number; method: string | null }

/* The live sales order of each project: a renovation contract first, else the newest ordinary sales order linked to
   the project (owner, 24 Oct 2026: "once I receive money, the project knows"). */
const PROJECT_SO_SQL = (where: string): string =>
  `SELECT DISTINCT ON (so.project_id) so.project_id::int AS project_id, so.doc_no, to_jsonb(so)->>'so_kind' AS kind, so.local_total_sen::bigint AS total_sen
     FROM scm.mfg_sales_orders so JOIN projects p ON p.id = so.project_id
    WHERE ${where} AND so.company_id = ? AND so.status::text <> 'CANCELLED'
    ORDER BY so.project_id, (to_jsonb(so)->>'so_kind' = 'RENOVATION') DESC, so.so_date DESC NULLS LAST, so.doc_no DESC`;

/** Payments recorded on these orders, oldest first, grouped by order. */
async function receiptsOf(c: Ctx, docNos: readonly string[]): Promise<Map<string, BetaReceipt[]>> {
  const out = new Map<string, BetaReceipt[]>();
  if (docNos.length === 0) return out;
  const rows = (await db(c).prepare(
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

/** Payments per project from its live sales order: the renovation contract's instalments, or four plain payments. */
async function projectPayments(c: Ctx, companyId: number, sos: readonly ProjectSoRow[]): Promise<Map<number, BetaPayments>> {
  const out = new Map<number, BetaPayments>();
  const reno = sos.filter((s) => s.kind === "RENOVATION").map((s) => s.doc_no);
  const [views, receipts] = await Promise.all([
    reno.length > 0 ? billingViews(renoDbFromD1(db(c)), reno, companyId) : Promise.resolve(new Map()),
    receiptsOf(c, sos.map((s) => s.doc_no)),
  ]);
  for (const so of sos) {
    const view = so.kind === "RENOVATION" ? views.get(so.doc_no) ?? null : null;
    out.set(Number(so.project_id), paymentsOf(view, { docNo: so.doc_no, totalSen: Number(so.total_sen ?? 0), receipts: receipts.get(so.doc_no) ?? [] }));
  }
  return out;
}

async function paymentsFor(c: Ctx, projectId: number, companyId: number): Promise<BetaPayments> {
  if (financeHiddenForUser(c.get("user"))) return { state: "hidden" };
  try {
    const so = await db(c).prepare(PROJECT_SO_SQL("so.project_id = ?")).bind(projectId, companyId).first<ProjectSoRow>();
    if (!so) return { state: "none" };
    return (await projectPayments(c, companyId, [so])).get(projectId) ?? { state: "none" };
  } catch (e) {
    // Only an environment whose billing tables are not there yet reads as "no payments"; any other failure surfaces.
    if (isMissingRelation(e)) return { state: "none" };
    throw e;
  }
}

app.get("/projects/:id/workspace", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  try {
    const settings = await db(c).prepare(`SELECT design_3d_days::int AS d3, design_2d_days::int AS d2 FROM project_beta_settings WHERE company_id = ?`)
      .bind(co).first<{ d3: number; d2: number }>();
    const reviews = await db(c).prepare(
      `SELECT file_id::int AS file_id, sent_on::text AS sent_on, due_on::text AS due_on, approved_on::text AS approved_on, approved_by_name, approval_note
         FROM project_design_file_reviews WHERE project_id = ? ORDER BY file_id`,
    ).bind(id).all<{ file_id: number; sent_on: string | null; due_on: string | null; approved_on: string | null; approved_by_name: string | null; approval_note: string | null }>();
    const defects = await db(c).prepare(
      `SELECT d.id::int AS id, d.phase, d.location, d.item_description, d.trade, d.due_date::text AS due_date, d.reported_at, u.name AS reported_by_name,
              d.photo_r2_key, d.after_photo_r2_key, ${TS("d.fixed_at")} AS fixed_at, ${TS("d.closed_at")} AS closed_at, d.redo_count::int AS redo_count
         FROM project_defects d LEFT JOIN users u ON u.id = d.reported_by
        WHERE d.project_id = ? AND d.archived_at IS NULL ORDER BY d.id`,
    ).bind(id).all<{
      id: number; phase: string; location: string | null; item_description: string | null; trade: string | null; due_date: string | null; reported_at: string | null;
      reported_by_name: string | null; photo_r2_key: string | null; after_photo_r2_key: string | null; fixed_at: string | null; closed_at: string | null; redo_count: number;
    }>();
    const payments = await paymentsFor(c, id, co);
    return c.json({
      settings: { design3dDays: settings?.d3 ?? BETA_DEFAULT_3D_DAYS, design2dDays: settings?.d2 ?? BETA_DEFAULT_2D_DAYS },
      reviews: (reviews.results ?? []).map((r) => ({
        fileId: r.file_id, sentOn: r.sent_on, dueOn: r.due_on, approvedOn: r.approved_on, approvedByName: r.approved_by_name, approvalNote: r.approval_note,
      })),
      defects: (defects.results ?? []).map((d) => ({
        id: d.id, phase: d.phase, location: d.location, description: d.item_description, trade: d.trade, dueDate: d.due_date, reportedAt: d.reported_at,
        reportedByName: d.reported_by_name, photoKey: d.photo_r2_key, afterPhotoKey: d.after_photo_r2_key, fixedAt: d.fixed_at, closedAt: d.closed_at,
        redoCount: d.redo_count,
      })),
      payments,
    });
  } catch (e) {
    console.error("[renovation-beta] workspace read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The workspace could not be read. Try again." }, 409);
  }
});

// ── Settings ─────────────────────────────────────────────────────────────

app.put("/settings", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanBetaSettings(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  await db(c).prepare(
    `INSERT INTO project_beta_settings (company_id, design_3d_days, design_2d_days, updated_by, updated_at) VALUES (?, ?, ?, ?, now())
     ON CONFLICT (company_id) DO UPDATE SET design_3d_days = excluded.design_3d_days, design_2d_days = excluded.design_2d_days,
                                            updated_by = excluded.updated_by, updated_at = now()`,
  ).bind(co.companyId, v.value.design3dDays, v.value.design2dDays, userId(c)).run();
  return c.json({ ok: true });
});

// ── Defects ──────────────────────────────────────────────────────────────

app.post("/projects/:id/defects", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const raw = await body(c);
  const v = cleanDefectReport(raw, id);
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const { location, description, trade, dueDate, photoKey } = v.value;
  const who = cleanAssignee(raw);
  if (!who.ok) return c.json({ error: who.error, message: who.message }, 400);
  const named = await companyPeople(c, co, who.value == null ? [] : [who.value]);
  if (!named) return c.json(PERSON_REFUSAL, 400);
  const reportNote = [location, trade, who.value == null ? null : `to fix: ${named.get(who.value) ?? "someone"}`].filter(Boolean).join(", ") || null;
  // Phase 'snag' so the handover rule (every snag closed first) counts it.
  // One statement: the defect and its activity row are written together or not at all.
  const row = await db(c).prepare(
    `WITH d AS (
       INSERT INTO project_defects (project_id, phase, reported_by_role, item_description, photo_r2_key, reported_by, reported_at,
                                    resolved, stage_key, location, due_date, trade, company_id, assignee_person_id)
       VALUES (?, 'snag', 'supervisor', ?, ?, ?, to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 0, 'handover', ?, ?::date, ?, ?, ?::bigint)
       RETURNING id, project_id, company_id, item_description),
     a AS (
       INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
       SELECT d.project_id, 'beta_defect_reported', NULL, d.item_description, ?::text, ?::bigint, d.company_id FROM d)
     SELECT id::int AS id FROM d`,
  ).bind(id, description, photoKey, userId(c), location, dueDate, trade, co, who.value, reportNote, userId(c))
    .first<{ id: number }>();
  if (!row) return c.json({ error: "defect_not_saved", message: "The problem could not be saved. Try again." }, 409);
  return c.json({ id: row.id }, 201);
});

/** The three moves of the repair loop share one shape: look the defect up, check the move, then one statement that
    runs the guarded update and writes its activity row together. */
async function moveDefect(c: Ctx, move: DefectMove): Promise<Response> {
  const defectId = parseId(c.req.param("defectId"));
  if (!defectId) return c.json({ error: "invalid_id" }, 400);
  const d = await defectOf(c, defectId);
  if (!d) return c.json({ error: "not_found" }, 404);
  const refused = defectMoveRefusal(move, { fixedAt: d.fixed_at, closedAt: d.closed_at });
  if (refused) return c.json(refused, 409);
  const raw = await body(c);
  const action = move === "fixed" ? "beta_defect_fixed" : move === "redo" ? "beta_defect_redo" : "beta_defect_closed";
  let update: string;
  let args: unknown[];
  let note: string | null = null;
  if (move === "fixed") {
    const v = cleanDefectFixed(raw, d.project_id);
    if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
    update = `UPDATE project_defects SET fixed_at = now(), fixed_by = ?, after_photo_r2_key = ? WHERE id = ? AND fixed_at IS NULL AND closed_at IS NULL`;
    args = [userId(c), v.value.afterPhotoKey, defectId];
  } else if (move === "redo") {
    const v = cleanDefectRedo(raw);
    if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
    note = v.value.note;
    update = `UPDATE project_defects SET fixed_at = NULL, fixed_by = NULL, after_photo_r2_key = NULL, redo_count = redo_count + 1
               WHERE id = ? AND fixed_at IS NOT NULL AND closed_at IS NULL`;
    args = [defectId];
  } else {
    update = `UPDATE project_defects SET closed_at = now(), closed_by = ?, resolved = 1 WHERE id = ? AND closed_at IS NULL`;
    args = [userId(c), defectId];
  }
  // The activity row is written from the rows the update really changed, so a lost race writes nothing and answers 409.
  const row = await db(c).prepare(
    `WITH u AS (${update} RETURNING id, item_description),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT ?::bigint, ?::text, NULL, u.item_description, ?::text, ?::bigint, ?::bigint FROM u)
     SELECT id::int AS id FROM u`,
  ).bind(...args, d.project_id, action, note, userId(c), d.company_id).first<{ id: number }>();
  if (!row) return c.json({ error: "defect_changed", message: "Someone else just changed this problem. Reload and look again." }, 409);
  return c.json({ ok: true });
}

app.post("/defects/:defectId/fixed", requirePermission("projects.write"), (c) => moveDefect(c, "fixed"));
app.post("/defects/:defectId/redo", requirePermission("projects.write"), (c) => moveDefect(c, "redo"));
app.post("/defects/:defectId/close", requirePermission("projects.write"), (c) => moveDefect(c, "close"));

// ── Drawings: sent to the customer, approved by the customer ─────────────

app.post("/design-files/:fileId/sent", requirePermission("projects.write"), async (c) => {
  const fileId = parseId(c.req.param("fileId"));
  if (!fileId) return c.json({ error: "invalid_id" }, 400);
  const f = await designFileOf(c, fileId);
  if (!f) return c.json({ error: "not_found" }, 404);
  const v = cleanDesignSent(await body(c), todayMyt());
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_design_file_reviews (file_id, project_id, company_id, sent_on, due_on, sent_by, updated_at) VALUES (?, ?, ?, ?::date, ?::date, ?, now())
       ON CONFLICT (file_id) DO UPDATE SET sent_on = excluded.sent_on, due_on = excluded.due_on, sent_by = excluded.sent_by, updated_at = now()`,
    ).bind(fileId, f.project_id, f.company_id, v.value.sentOn, v.value.dueOn, userId(c)),
    activityStmt(c, f.project_id, f.company_id, "beta_drawing_sent", null, designLabel(f.kind, f.version), `Sent ${v.value.sentOn}, answer due ${v.value.dueOn}`),
  ]);
  return c.json({ ok: true });
});

const SHOP_DRAWINGS_ITEM = "shop_drawings_signed";

/** The 2D approval is the customer signing off the shop drawings: tick that checklist item the way its status route does. */
async function tickShopDrawings(c: Ctx, projectId: number): Promise<void> {
  const item = await db(c).prepare(`SELECT id::int AS id, status FROM project_checklist WHERE project_id = ? AND item_key = ?`)
    .bind(projectId, SHOP_DRAWINGS_ITEM).first<{ id: number; status: string }>();
  // A project without the item (older template) has nothing to tick.
  if (!item || item.status === "done") return;
  await setChecklistStatus(c.env, item.id, "done", userId(c));
  const rows = await loadProjectRows(db(c), "", { projectId, includeArchived: true });
  if (rows.length === 0) return;
  const facts = (await loadRenovationFacts(db(c), rows)).get(projectId);
  if (facts) await writeCachedStage(db(c), projectId, facts);
}

app.post("/design-files/:fileId/approval", requirePermission("projects.write"), async (c) => {
  const fileId = parseId(c.req.param("fileId"));
  if (!fileId) return c.json({ error: "invalid_id" }, 400);
  const f = await designFileOf(c, fileId);
  if (!f) return c.json({ error: "not_found" }, 404);
  const v = cleanDesignApproval(await body(c), todayMyt());
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const { approvedOn, approvedByName, note } = v.value;
  // The tick goes first and can be repeated safely (it does nothing when the item is already done), so a failure here
  // leaves no approval behind; the record and its activity row are then written together.
  if (f.kind === "2d") await tickShopDrawings(c, f.project_id);
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_design_file_reviews (file_id, project_id, company_id, approved_on, approved_by_name, approval_note, approval_recorded_by, updated_at)
       VALUES (?, ?, ?, ?::date, ?, ?, ?, now())
       ON CONFLICT (file_id) DO UPDATE SET approved_on = excluded.approved_on, approved_by_name = excluded.approved_by_name,
                                           approval_note = excluded.approval_note, approval_recorded_by = excluded.approval_recorded_by, updated_at = now()`,
    ).bind(fileId, f.project_id, f.company_id, approvedOn, approvedByName, note, userId(c)),
    activityStmt(c, f.project_id, f.company_id, "beta_drawing_approved", approvedByName, designLabel(f.kind, f.version), [`On ${approvedOn}`, note].filter(Boolean).join(" · ")),
  ]);
  return c.json({ ok: true });
});

app.delete("/design-files/:fileId/approval", requirePermission("projects.write"), async (c) => {
  const fileId = parseId(c.req.param("fileId"));
  if (!fileId) return c.json({ error: "invalid_id" }, 400);
  const f = await designFileOf(c, fileId);
  if (!f) return c.json({ error: "not_found" }, 404);
  // The checklist item stays as it is: taking back a record does not un-sign the shop drawings.
  const row = await db(c).prepare(
    `WITH u AS (UPDATE project_design_file_reviews SET approved_on = NULL, approved_by_name = NULL, approval_note = NULL, approval_recorded_by = NULL, updated_at = now()
                 WHERE file_id = ? AND approved_on IS NOT NULL RETURNING file_id),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT ?::bigint, 'beta_drawing_approval_removed', NULL, ?::text, NULL, ?::bigint, ?::bigint FROM u)
     SELECT file_id::int AS file_id FROM u`,
  ).bind(fileId, f.project_id, designLabel(f.kind, f.version), userId(c), f.company_id).first<{ file_id: number }>();
  if (!row) return c.json({ error: "not_approved", message: "This version has no approval to remove." }, 409);
  return c.json({ ok: true });
});

// ── Reminders (the WhatsApp button logs here) ────────────────────────────

app.post("/projects/:id/reminders", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanBetaReminder(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  await activityStmt(c, id, co, "beta_reminder", null, v.value.kind, v.value.text).run();
  return c.json({ ok: true });
});

// ── Home, Projects and Calendar (plan section 10) ────────────────────────

const MYT = "Asia/Kuala_Lumpur";
const idList = (xs: ReadonlyArray<number>): string => JSON.stringify(xs.map(String));

/** The names of these people when every one of them is an active person of the company, else null. */
async function companyPeople(c: Ctx, companyId: number, ids: readonly number[]): Promise<Map<number, string> | null> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const res = await db(c).prepare(
    `SELECT id::int AS id, name FROM project_people WHERE company_id = ? AND active AND id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`,
  ).bind(companyId, idList(wanted)).all<{ id: number; name: string }>();
  const found = new Map((res.results ?? []).map((r) => [Number(r.id), r.name] as const));
  return wanted.every((id) => found.has(id)) ? found : null;
}

const PERSON_REFUSAL = { error: "person_invalid", message: "That person is not on this company's list." } as const;

interface BoardPersonRow { id: number; name: string; roles: unknown; position: string | null; department: string | null; offered: boolean }

/* The board's people follow the project page's people list (routes/renovationProject.ts GET /people; owner,
   14 Oct 2026): the list is brought in line with the user accounts first, and `offered` is true only for people
   linked to an active account, labelled with the account's position and department. Every person of the company
   is sent, so names on old records still read; the screens offer and filter by `offered` only. Before migration
   0113 (no staff view) every active person is offered, as on the project page. */
async function boardPeople(c: Ctx, companyId: number): Promise<BoardPersonRow[]> {
  let fromUsers = false;
  try {
    fromUsers = await syncPeopleFromUsers(db(c), companyId);
  } catch (e) {
    console.error("[renovation-beta] people sync failed", e);
  }
  const res = await db(c).prepare(
    fromUsers
      ? `SELECT pp.id::int AS id, pp.name, to_json(pp.roles) AS roles, s.position, s.department, (pp.pos_user_id IS NOT NULL AND pp.active) AS offered
           FROM project_people pp LEFT JOIN conts_staff s ON s.id = pp.pos_user_id
          WHERE pp.company_id = ? ORDER BY lower(pp.name), pp.id`
      : `SELECT id::int AS id, name, to_json(roles) AS roles, NULL AS position, NULL AS department, active AS offered
           FROM project_people WHERE company_id = ? ORDER BY lower(name), id`,
  ).bind(companyId).all<BoardPersonRow>();
  return res.results ?? [];
}

/** The 3D or 2D people of the board row `bd`, in the order picked, as JSON [{ id, name }]. A row written only to the
    single column (before migration 0148) still reads as that one person. */
function designPeopleSql(kind: "3d" | "2d"): string {
  const k = kind === "3d" ? "3d" : "2d";
  return `(SELECT coalesce(json_agg(json_build_object('id', x.id::int, 'name', pp.name) ORDER BY x.n), '[]'::json)
             FROM unnest(CASE WHEN cardinality(bd.person_${k}_ids) > 0 THEN bd.person_${k}_ids
                              WHEN bd.person_${k}_id IS NOT NULL THEN ARRAY[bd.person_${k}_id] ELSE '{}'::bigint[] END) WITH ORDINALITY AS x(id, n)
             JOIN project_people pp ON pp.id = x.id)`;
}
const KIND_REFUSAL = { error: "kind_invalid", message: "Pick the appointment from the list." } as const;

/** Payment label per project, from the same sales order and payments the workspace reads. */
async function boardPayments(c: Ctx, companyId: number, scope: string): Promise<Map<number, BoardPayment>> {
  const out = new Map<number, BoardPayment>();
  try {
    const sos = (await db(c).prepare(PROJECT_SO_SQL(scope)).bind(companyId).all<ProjectSoRow>()).results ?? [];
    for (const [id, p] of await projectPayments(c, companyId, sos)) out.set(id, paymentLabel(p));
  } catch (e) {
    // Same rule as the workspace: only billing tables that are not there yet read as "no payment"; anything else surfaces.
    if (!isMissingRelation(e)) throw e;
  }
  return out;
}

interface EventRow {
  id: number; project_id: number | null; on_date: string; at_time: string | null; type: string; note: string | null; person_id: number | null; done: boolean;
}

app.get("/board", requirePageAccess("projects.list"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const today = todayMyt();
  const range = cleanBoardRange(c.req.query("from"), c.req.query("to"), today);
  if (!range.ok) return c.json({ error: range.error, message: range.message }, 400);
  const companyId = co.companyId;
  // With projectId the same answer is cut down to that one project (and its events), for the project workspace.
  const only = c.req.query("projectId");
  const projectId = only === undefined ? null : parseId(only);
  if (only !== undefined && projectId == null) return c.json({ error: "invalid_id" }, 400);
  const scope = `p.project_kind = 'renovation' AND p.archived_at IS NULL${coSql(c, "p.company_id")}${projectId == null ? "" : ` AND p.id = ${projectId}`}`;
  const eventScope = projectId == null ? "" : ` AND e.project_id = ${projectId}`;
  const user = c.get("user");
  const hidden = financeHiddenForUser(user);
  try {
    // One query per data set over the whole scoped project list, grouped in code below.
    const [settings, people, projects, files, notes, reviews, appointments, events, payments, meIds] = await Promise.all([
      db(c).prepare(`SELECT design_3d_days::int AS d3, design_2d_days::int AS d2 FROM project_beta_settings WHERE company_id = ?`)
        .bind(companyId).first<{ d3: number; d2: number }>(),
      boardPeople(c, companyId),
      db(c).prepare(
        `SELECT p.id::int AS id, p.code, p.name, p.building, p.unit_no, p.customer_name, coalesce(sp.name, p.salesperson_name) AS sales_name, p.created_at,
                p.planned_handover_date::text AS handover_on,
                p.designer_person_id::int AS lead_id, dp.name AS lead_name, p.reno_pic_person_id::int AS pic_id, rp.name AS pic_name,
                ${designPeopleSql("3d")} AS p3_people, ${designPeopleSql("2d")} AS p2_people,
                (SELECT min(r.done_on) FROM project_design_records r WHERE r.project_id = p.id AND r.kind = 'site_measure')::text AS measured_on,
                bd.start_3d_on::text AS start_3d_on, bd.start_2d_on::text AS start_2d_on, bd.po_done_on::text AS po_done_on
           FROM projects p
           LEFT JOIN project_people sp ON sp.id = p.sales_person_id
           LEFT JOIN project_people dp ON dp.id = p.designer_person_id
           LEFT JOIN project_people rp ON rp.id = p.reno_pic_person_id
           LEFT JOIN project_beta_design bd ON bd.project_id = p.id
          WHERE ${scope} ORDER BY p.id DESC`,
      ).bind().all<BoardProjectRow>(),
      db(c).prepare(
        `SELECT f.id::int AS id, f.project_id::int AS project_id, f.kind, f.version::int AS version,
                coalesce(f.submitted_on, (f.uploaded_at AT TIME ZONE '${MYT}')::date)::text AS submitted_on
           FROM project_design_files f JOIN projects p ON p.id = f.project_id
          WHERE f.kind IN ('3d', '2d') AND ${scope} ORDER BY f.project_id, f.version, f.id`,
      ).bind().all<BoardFileRow>(),
      db(c).prepare(
        `SELECT n.id::int AS id, n.project_id::int AS project_id, n.kind, n.noted_on::text AS noted_on,
                (n.closed_at AT TIME ZONE '${MYT}')::date::text AS closed_on, d.days::int AS days
           FROM project_design_notes n JOIN projects p ON p.id = n.project_id
           LEFT JOIN project_beta_note_days d ON d.note_id = n.id
          WHERE ${scope} ORDER BY n.project_id, n.noted_on, n.id`,
      ).bind().all<BoardNoteRow>(),
      db(c).prepare(
        `SELECT r.file_id::int AS file_id, r.project_id::int AS project_id, r.sent_on::text AS sent_on, r.approved_on::text AS approved_on
           FROM project_design_file_reviews r JOIN projects p ON p.id = r.project_id
           JOIN project_design_files f ON f.id = r.file_id AND f.kind IN ('3d', '2d')
          WHERE ${scope} ORDER BY r.project_id, r.file_id`,
      ).bind().all<BoardReviewRow>(),
      db(c).prepare(
        `SELECT a.project_id::int AS project_id, a.kind, a.on_date::text AS on_date, to_char(a.at_time, 'HH24:MI') AS at_time, a.person_id::int AS person_id,
                a.with_text, ${TS("a.done_at")} AS done_at
           FROM project_beta_appointments a JOIN projects p ON p.id = a.project_id
          WHERE ${scope} ORDER BY a.project_id, a.kind`,
      ).bind().all<BoardAppointmentRow>(),
      db(c).prepare(
        `SELECT e.id::int AS id, e.project_id::int AS project_id, e.on_date::text AS on_date, to_char(e.at_time, 'HH24:MI') AS at_time, e.type, e.note,
                e.person_id::int AS person_id, e.done
           FROM project_beta_events e LEFT JOIN projects p ON p.id = e.project_id
          WHERE e.company_id = ? AND e.on_date BETWEEN ?::date AND ?::date
            AND (e.project_id IS NULL OR (p.project_kind = 'renovation' AND p.archived_at IS NULL))${eventScope}
          ORDER BY e.on_date, e.at_time NULLS LAST, e.id`,
      ).bind(companyId, range.value.from, range.value.to).all<EventRow>(),
      hidden ? Promise.resolve(new Map<number, BoardPayment>()) : boardPayments(c, companyId, scope),
      calendarMePersonIds(db(c), user?.id, user?.email),
    ]);
    if (projectId != null && (projects.results ?? []).length === 0) return c.json({ error: "not_found" }, 404);
    const sets = {
      files: groupByProject(files.results ?? []), notes: groupByProject(notes.results ?? []),
      reviews: groupByProject(reviews.results ?? []), appointments: groupByProject(appointments.results ?? []),
    };
    const peopleList = people.map((p) => ({
      id: Number(p.id), name: p.name, roles: rolesOf(p.roles), position: p.position ?? null, department: p.department ?? null, offered: !!p.offered,
    }));
    const mine = new Set(meIds);
    const paymentOf = (projectId: number): BoardPayment => (hidden ? { state: "hidden" } : payments.get(projectId) ?? { state: "none" });
    return c.json({
      today,
      mePersonId: peopleList.find((p) => p.offered && mine.has(p.id))?.id ?? peopleList.find((p) => mine.has(p.id))?.id ?? null,
      settings: { design3dDays: settings?.d3 ?? BETA_DEFAULT_3D_DAYS, design2dDays: settings?.d2 ?? BETA_DEFAULT_2D_DAYS, amendmentDays: BETA_AMENDMENT_DAYS },
      people: peopleList,
      projects: (projects.results ?? []).map((p) => buildBoardProject(p, sets, paymentOf(Number(p.id)))),
      events: (events.results ?? []).map((e) => ({
        id: e.id, projectId: e.project_id, onDate: e.on_date, atTime: e.at_time, type: e.type, note: e.note, personId: e.person_id, done: e.done,
      })),
    });
  } catch (e) {
    console.error("[renovation-beta] board read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The board could not be read. Try again." }, 409);
  }
});

// ── Design dates and people ──────────────────────────────────────────────

const DESIGN_DATE_COLUMNS = { start3dOn: "start_3d_on", start2dOn: "start_2d_on", poDoneOn: "po_done_on" } as const;
const DESIGN_PEOPLE_COLUMNS = { person3dIds: "person_3d", person2dIds: "person_2d" } as const;

/** [column, placeholder, value] for each field sent. A people list writes its array and, for older code, the single
    column as the first pick (migration 0148). */
function designColumns(p: BetaDesignPatch): Array<readonly [string, string, unknown]> {
  const out: Array<readonly [string, string, unknown]> = [];
  for (const k of Object.keys(DESIGN_DATE_COLUMNS) as Array<keyof typeof DESIGN_DATE_COLUMNS>) {
    if (k in p) out.push([DESIGN_DATE_COLUMNS[k], "?::date", p[k] ?? null]);
  }
  for (const k of Object.keys(DESIGN_PEOPLE_COLUMNS) as Array<keyof typeof DESIGN_PEOPLE_COLUMNS>) {
    const ids = p[k];
    if (ids === undefined) continue;
    out.push([`${DESIGN_PEOPLE_COLUMNS[k]}_ids`, "?::text::bigint[]", `{${ids.join(",")}}`]);
    out.push([`${DESIGN_PEOPLE_COLUMNS[k]}_id`, "?::bigint", ids[0] ?? null]);
  }
  return out;
}

app.put("/projects/:id/design", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanBetaDesign(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const people = await companyPeople(c, co, designPersonIds(v.value));
  if (!people) return c.json(PERSON_REFUSAL, 400);
  const cols = designColumns(v.value);
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_beta_design (project_id, company_id, ${cols.map(([col]) => col).join(", ")}, updated_by, updated_at)
       VALUES (?, ?, ${cols.map(([, cast]) => cast).join(", ")}, ?, now())
       ON CONFLICT (project_id) DO UPDATE SET ${cols.map(([col]) => `${col} = excluded.${col}`).join(", ")}, updated_by = excluded.updated_by, updated_at = now()`,
    ).bind(id, co, ...cols.map(([, , value]) => value), userId(c)),
    activityStmt(c, id, co, "beta_design_changed", null, null, designChangeNote(v.value, people)),
  ]);
  return c.json({ ok: true });
});

app.put("/design-notes/:noteId/days", requirePermission("projects.write"), async (c) => {
  const noteId = parseId(c.req.param("noteId"));
  if (!noteId) return c.json({ error: "invalid_id" }, 400);
  const n = await db(c).prepare(
    `SELECT n.project_id::int AS project_id, n.kind, p.company_id::int AS company_id
       FROM project_design_notes n JOIN projects p ON p.id = n.project_id
      WHERE n.id = ? AND p.project_kind = 'renovation'${coSql(c, "p.company_id")}`,
  ).bind(noteId).first<{ project_id: number; kind: string; company_id: number }>();
  if (!n) return c.json({ error: "not_found" }, 404);
  const v = cleanNoteDays(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  await db(c).batch!([
    db(c).prepare(`INSERT INTO project_beta_note_days (note_id, days) VALUES (?, ?) ON CONFLICT (note_id) DO UPDATE SET days = excluded.days`)
      .bind(noteId, v.value.days),
    activityStmt(c, n.project_id, n.company_id, "beta_note_days", n.kind.toUpperCase(), String(v.value.days), null),
  ]);
  return c.json({ ok: true });
});

// ── Appointments: site measure, carpentry measure, site briefing ─────────

app.put("/projects/:id/appointments/:kind", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  const kind = c.req.param("kind");
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!isAppointmentKind(kind)) return c.json(KIND_REFUSAL, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanBetaAppointment(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const { onDate, atTime, personId, withText } = v.value;
  const people = await companyPeople(c, co, personId == null ? [] : [personId]);
  if (!people) return c.json(PERSON_REFUSAL, 400);
  const who = personId == null ? null : `by ${people.get(personId) ?? "someone"}`;
  // Booking again with the same day keeps it done; a moved day is a new appointment, so it is not done any more.
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_beta_appointments (project_id, company_id, kind, on_date, at_time, person_id, with_text, created_by)
       VALUES (?, ?, ?, ?::date, ?::time, ?::bigint, ?, ?)
       ON CONFLICT (project_id, kind) DO UPDATE SET on_date = excluded.on_date, at_time = excluded.at_time, person_id = excluded.person_id,
                                                    with_text = excluded.with_text,
                                                    done_at = CASE WHEN project_beta_appointments.on_date = excluded.on_date THEN project_beta_appointments.done_at END`,
    ).bind(id, co, kind, onDate, atTime, personId, withText, userId(c)),
    activityStmt(c, id, co, "beta_appointment_booked", null, kind, [`On ${onDate}`, atTime, who, withText].filter(Boolean).join(" · ")),
  ]);
  return c.json({ ok: true });
});

app.post("/projects/:id/appointments/:kind/done", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  const kind = c.req.param("kind");
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!isAppointmentKind(kind)) return c.json(KIND_REFUSAL, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const row = await db(c).prepare(
    `WITH u AS (UPDATE project_beta_appointments SET done_at = now() WHERE project_id = ? AND kind = ? AND done_at IS NULL RETURNING id, kind, on_date),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT ?::bigint, 'beta_appointment_done', NULL, u.kind, 'Booked for ' || u.on_date::text, ?::bigint, ?::bigint FROM u)
     SELECT id::int AS id FROM u`,
  ).bind(id, kind, id, userId(c), co).first<{ id: number }>();
  if (row) return c.json({ ok: true });
  // Nothing changed: either there is no such appointment, or it was already done.
  const exists = await db(c).prepare(`SELECT id::int AS id FROM project_beta_appointments WHERE project_id = ? AND kind = ?`).bind(id, kind).first<{ id: number }>();
  if (!exists) return c.json({ error: "not_found" }, 404);
  return c.json({ error: "already_done", message: "This appointment is already marked done." }, 409);
});

app.delete("/projects/:id/appointments/:kind", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  const kind = c.req.param("kind");
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!isAppointmentKind(kind)) return c.json(KIND_REFUSAL, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const row = await db(c).prepare(
    `WITH d AS (DELETE FROM project_beta_appointments WHERE project_id = ? AND kind = ? RETURNING id, kind, on_date),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT ?::bigint, 'beta_appointment_removed', NULL, d.kind, 'Was booked for ' || d.on_date::text, ?::bigint, ?::bigint FROM d)
     SELECT id::int AS id FROM d`,
  ).bind(id, kind, id, userId(c), co).first<{ id: number }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── Calendar entries ─────────────────────────────────────────────────────

// An entry with a project also writes that project's activity row, in the same statement; one without a project has none.
const eventNote = (alias: string): string => `concat_ws(' · ', ${alias}.on_date::text, ${alias}.note)`;

app.post("/events", requirePermission("projects.write"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanBetaEvent(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const { projectId, onDate, atTime, type, note, personId } = v.value;
  if (projectId != null && (await projectCompany(c, projectId)) == null) return c.json({ error: "not_found" }, 404);
  if (!(await companyPeople(c, co.companyId, personId == null ? [] : [personId]))) return c.json(PERSON_REFUSAL, 400);
  const row = await db(c).prepare(
    `WITH e AS (INSERT INTO project_beta_events (company_id, project_id, on_date, at_time, type, note, person_id, created_by)
                VALUES (?, ?::bigint, ?::date, ?::time, ?, ?, ?::bigint, ?) RETURNING id, project_id, company_id, type, note, on_date),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT e.project_id, 'beta_event_added', NULL, e.type, ${eventNote("e")}, ?::bigint, e.company_id FROM e WHERE e.project_id IS NOT NULL)
     SELECT id::int AS id FROM e`,
  ).bind(co.companyId, projectId, onDate, atTime, type, note, personId, userId(c), userId(c)).first<{ id: number }>();
  if (!row) return c.json({ error: "event_not_saved", message: "The entry could not be saved. Try again." }, 409);
  return c.json({ id: row.id }, 201);
});

const EVENT_COLUMNS = {
  projectId: ["project_id", "?::bigint"], onDate: ["on_date", "?::date"], atTime: ["at_time", "?::time"], type: ["type", "?::text"],
  note: ["note", "?::text"], personId: ["person_id", "?::bigint"], done: ["done", "?::boolean"],
} as const satisfies Record<keyof BetaEventPatch, readonly [string, string]>;

app.patch("/events/:id", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanBetaEventPatch(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const { projectId, personId } = v.value;
  if (projectId != null && (await projectCompany(c, projectId)) == null) return c.json({ error: "not_found" }, 404);
  if (!(await companyPeople(c, co.companyId, personId == null ? [] : [personId]))) return c.json(PERSON_REFUSAL, 400);
  const sent = (Object.keys(EVENT_COLUMNS) as Array<keyof BetaEventPatch>).filter((k) => k in v.value);
  const row = await db(c).prepare(
    `WITH u AS (UPDATE project_beta_events SET ${sent.map((k) => `${EVENT_COLUMNS[k][0]} = ${EVENT_COLUMNS[k][1]}`).join(", ")}, updated_at = now()
                 WHERE id = ? AND company_id = ? RETURNING id, project_id, company_id, type, note, on_date),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT u.project_id, 'beta_event_changed', NULL, u.type, ${eventNote("u")}, ?::bigint, u.company_id FROM u WHERE u.project_id IS NOT NULL)
     SELECT id::int AS id FROM u`,
  ).bind(...sent.map((k) => v.value[k] ?? null), id, co.companyId, userId(c)).first<{ id: number }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.delete("/events/:id", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const row = await db(c).prepare(
    `WITH d AS (DELETE FROM project_beta_events WHERE id = ? AND company_id = ? RETURNING id, project_id, company_id, type, note, on_date),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT d.project_id, 'beta_event_removed', NULL, d.type, ${eventNote("d")}, ?::bigint, d.company_id FROM d WHERE d.project_id IS NOT NULL)
     SELECT id::int AS id FROM d`,
  ).bind(id, co.companyId, userId(c)).first<{ id: number }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── VO, PO, Client PO (bundle B, owner 24 Oct 2026) ─────────────────────

/** A read of the project's documents; a database without the renovation tables yet reads as empty. */
async function readOr<T>(c: Ctx, what: string, fn: () => Promise<T>): Promise<Response> {
  try {
    return c.json(await fn());
  } catch (e) {
    console.error(`[renovation-beta] ${what} read failed`, e);
    return c.json({ error: "renovation_read_failed", message: `The ${what} could not be read. Try again.` }, 409);
  }
}

app.get("/projects/:id/vo", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  return readOr(c, "VO list", () => loadProjectVos(db(c), id, co, !financeHiddenForUser(c.get("user"))));
});

app.get("/projects/:id/po", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  return readOr(c, "purchase order", () => loadProjectPoLines(db(c), id, co));
});

app.get("/projects/:id/client-po", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  return readOr(c, "client item", async () => {
    const vo = await loadProjectVos(db(c), id, co, false);
    return loadClientItems(db(c), id, co, vo.vos);
  });
});

/** A read-only link for the client to the Client PO list. The token carries the project and company, signed. */
app.post("/projects/:id/client-link", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const secret = (c.env as unknown as { CONTS_SSO_SECRET?: string }).CONTS_SSO_SECRET;
  if (!secret) return c.json({ error: "link_unavailable", message: "Client links are not set up on this server yet." }, 503);
  const expiresAt = Date.now() + LINK_DAYS * 86_400_000;
  const token = await signClientLink(secret, { projectId: id, companyId: co, expiresAt });
  await activityStmt(c, id, co, "beta_client_link", null, null, `Client PO link made, valid until ${new Date(expiresAt).toISOString().slice(0, 10)}`).run();
  return c.json({ token, expiresAt: new Date(expiresAt).toISOString() });
});

// ── Site & photos, Defects as repair tickets, Timeline (BRIEF-beta-oct24 sections 5 to 8) ──

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

async function rowsOf(c: Ctx, q: { text: string; args: unknown[] }): Promise<Row[]> {
  return (await db(c).prepare(q.text).bind(...q.args).all<Row>()).results ?? [];
}

/* The room of a sales order line: the renovation line's room, else the item's own location. */
const LINE_AREA = `coalesce(nullif(trim((SELECT to_jsonb(l)->>'room' FROM scm.reno_doc_lines l WHERE to_jsonb(l)->>'so_item_id' = i.id::text LIMIT 1)), ''), nullif(trim(i.location), ''))`;

/** Every DO and goods receipt of the project (the same sets as its Procurement details), each with the rooms of the
    lines it carries and every photo on it: the driver's POD, the site team's receipt photos and files added to it. */
async function siteDeliveries(c: Ctx, projectId: number, companyId: number): Promise<{ areas: string[]; deliveries: SiteDelivery[] }> {
  const q = (sql: string) => projectDocSql(sql, projectId, companyId);
  const [soAreas, dos, grs, doAreas, grAreas, sitePhotos] = await Promise.all([
    rowsOf(c, q(`SELECT ${LINE_AREA} AS area FROM scm.mfg_sales_order_items i
                  WHERE i.doc_no IN (SELECT doc_no FROM scm.mfg_sales_orders WHERE project_id = ?1 AND company_id = ?2) AND NOT i.cancelled
                  ORDER BY i.doc_no, i.line_no NULLS LAST, i.created_at, i.id`)),
    rowsOf(c, q(`SELECT d.id::text AS id, d.do_number AS no, ${TS("coalesce(d.delivered_at, d.signed_at, d.dispatched_at)")} AS at,
                        d.created_at::date::text AS made_on, d.status::text AS status, d.so_doc_no
                   FROM scm.delivery_orders d WHERE d.id IN (__DOS__) AND d.status::text <> 'CANCELLED'`)),
    rowsOf(c, q(`SELECT g.id::text AS id, g.grn_number AS no, ${TS("coalesce(g.site_received_at, (g.received_at::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'))")} AS at,
                        g.status::text AS status, sup.name AS supplier, po.po_number, g.purchase_order_id::text AS po_id,
                        (SELECT json_agg(DISTINCT x.purchase_order_id::text) FROM scm.grn_items gi JOIN scm.purchase_order_items x ON x.id = gi.purchase_order_item_id
                          WHERE gi.grn_id = g.id) AS po_ids
                   FROM scm.grns g LEFT JOIN scm.suppliers sup ON sup.id = g.supplier_id LEFT JOIN scm.purchase_orders po ON po.id = g.purchase_order_id
                  WHERE g.id IN (__GRS__) AND g.status::text NOT IN ('CANCELLED', 'DRAFT')`)),
    rowsOf(c, q(`SELECT x.delivery_order_id::text AS doc_id, ${LINE_AREA} AS area
                   FROM scm.delivery_order_items x JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id
                  WHERE x.delivery_order_id IN (__DOS__) ORDER BY x.line_no, x.id`)),
    rowsOf(c, q(`SELECT gi.grn_id::text AS doc_id, ${LINE_AREA} AS area
                   FROM scm.grn_items gi JOIN scm.purchase_order_items x ON x.id = gi.purchase_order_item_id
                   JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id
                  WHERE gi.grn_id IN (__GRS__) ORDER BY gi.created_at, gi.id`)),
    rowsOf(c, { text: `SELECT ph.id::text AS id, ph.grn_id::text AS grn_id, ph.location, ph.r2_key, ph.caption, ph.kind, ${TS("coalesce(ph.taken_at, ph.created_at)")} AS at
                         FROM scm.grn_site_photos ph WHERE ph.project_id = ? ORDER BY ph.created_at`, args: [projectId] }),
  ]);
  const ready = await attachmentsReady(db(c)).catch(() => false);
  const docRefs = [
    ...dos.map((d) => ({ type: "delivery_order" as const, id: String(d.id) })),
    ...grs.map((g) => ({ type: "goods_received" as const, id: String(g.id) })),
  ];
  const attached = ready ? await listFilesFor(db(c), docRefs, companyId) : new Map<string, DocFile[]>();
  const areasOf = (rows: Row[], id: string) => uniqueAreas(rows.filter((r) => r.doc_id === id).map((r) => str(r.area)));
  const docPath = (type: DeliveryType, docId: string, fileId: string) =>
    `/api/renovation/${projectId}/document-files/${type}/${encodeURIComponent(docId)}/${encodeURIComponent(fileId)}`;
  const uploads = (type: DeliveryType, docId: string): SitePhoto[] => (attached.get(`${type}:${docId}`) ?? []).map((f) => ({
    id: `${type}-${docId}-${f.id}`, path: docPath(type, docId, f.id), name: f.caption || f.name, image: f.kind === "image", area: null, at: f.at || null, source: "upload" as const,
  }));

  const out: SiteDelivery[] = [];
  for (const d of dos) {
    const id = String(d.id);
    const photos: SitePhoto[] = [];
    const pod = await podFile(db(c), id).catch(() => null);
    if (pod) photos.push({ id: `pod-${id}`, path: docPath("delivery_order", id, POD_FILE_ID), name: "Proof of delivery", image: true, area: null, at: pod.at || null, source: "pod" });
    photos.push(...uploads("delivery_order", id));
    out.push({
      type: "delivery_order", id, no: String(d.no), at: str(d.at) ?? str(d.made_on), status: String(d.status), from: str(d.so_doc_no), poNumber: null, poIds: [],
      areas: areasOf(doAreas, id), photos,
    });
  }
  for (const g of grs) {
    const id = String(g.id);
    const site: SitePhoto[] = sitePhotos.filter((p) => p.grn_id === id).map((p) => ({
      id: `site-${String(p.id)}`, path: `/api/renovation/${projectId}/files?key=${encodeURIComponent(String(p.r2_key))}`,
      name: str(p.caption) ?? (p.kind === "supplier_do" ? "Supplier delivery order" : "Site photo"), image: isImageName(String(p.r2_key)),
      area: str(p.location), at: str(p.at), source: "site" as const,
    }));
    const poIds = uniqueAreas([str(g.po_id), ...(Array.isArray(g.po_ids) ? (g.po_ids as unknown[]).map(str) : [])]);
    out.push({
      type: "goods_received", id, no: String(g.no), at: str(g.at), status: String(g.status), from: str(g.supplier), poNumber: str(g.po_number), poIds,
      areas: uniqueAreas([...areasOf(grAreas, id), ...site.map((p) => p.area)]), photos: [...site, ...uploads("goods_received", id)],
    });
  }
  return { areas: uniqueAreas(soAreas.map((r) => str(r.area))), deliveries: sortDeliveries(out) };
}

app.get("/projects/:id/site", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  try {
    if (!(await docFlowColumnsReady(db(c)).catch(() => false))) return c.json({ ready: false, areas: [], deliveries: [] });
    return c.json({ ready: true, ...(await siteDeliveries(c, id, co)) });
  } catch (e) {
    console.error("[renovation-beta] site read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The deliveries and their photos could not be read. Try again." }, 409);
  }
});

/* Defects as repair tickets: everything the board and the ticket show, with who fixes it. */
app.get("/projects/:id/defects", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  try {
    const rows = await db(c).prepare(
      `SELECT d.id::int AS id, d.phase, d.location, d.item_description, d.trade, d.due_date::text AS due_date, d.reported_at, u.name AS reported_by_name,
              d.photo_r2_key, d.after_photo_r2_key, ${TS("d.fixed_at")} AS fixed_at, fu.name AS fixed_by_name, ${TS("d.closed_at")} AS closed_at,
              cu.name AS closed_by_name, d.redo_count::int AS redo_count, d.assignee_person_id::int AS assignee_id, ap.name AS assignee_name, ap.phone AS assignee_phone,
              (SELECT a.note FROM project_activity a WHERE a.project_id = d.project_id AND a.action = 'beta_defect_redo' AND a.to_value = d.item_description
                ORDER BY a.id DESC LIMIT 1) AS last_redo_note
         FROM project_defects d
         LEFT JOIN users u ON u.id = d.reported_by
         LEFT JOIN users fu ON fu.id = d.fixed_by
         LEFT JOIN users cu ON cu.id = d.closed_by
         LEFT JOIN project_people ap ON ap.id = d.assignee_person_id
        WHERE d.project_id = ? AND d.archived_at IS NULL ORDER BY d.id`,
    ).bind(id).all<Row>();
    return c.json({
      defects: (rows.results ?? []).map((d) => ({
        id: Number(d.id), phase: String(d.phase), location: str(d.location), description: str(d.item_description), trade: str(d.trade), dueDate: str(d.due_date),
        reportedAt: str(d.reported_at), reportedByName: str(d.reported_by_name), photoKey: str(d.photo_r2_key), afterPhotoKey: str(d.after_photo_r2_key),
        fixedAt: str(d.fixed_at), fixedByName: str(d.fixed_by_name), closedAt: str(d.closed_at), closedByName: str(d.closed_by_name), redoCount: Number(d.redo_count ?? 0),
        assigneeId: d.assignee_id == null ? null : Number(d.assignee_id), assigneeName: str(d.assignee_name), assigneePhone: str(d.assignee_phone),
        lastRedoNote: str(d.last_redo_note),
      })),
    });
  } catch (e) {
    console.error("[renovation-beta] defects read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The defects could not be read. Try again." }, 409);
  }
});

const DEFECT_PATCH_COLUMNS = {
  assigneePersonId: ["assignee_person_id", "?::bigint"], trade: ["trade", "?::text"], dueDate: ["due_date", "?::date"],
  location: ["location", "?::text"], description: ["item_description", "?::text"],
} as const satisfies Record<keyof DefectPatch, readonly [string, string]>;

app.patch("/defects/:defectId", requirePermission("projects.write"), async (c) => {
  const defectId = parseId(c.req.param("defectId"));
  if (!defectId) return c.json({ error: "invalid_id" }, 400);
  const d = await defectOf(c, defectId);
  if (!d) return c.json({ error: "not_found" }, 404);
  if (d.closed_at) return c.json({ error: "defect_closed", message: "This problem is already closed." }, 409);
  const v = cleanDefectPatch(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const personId = v.value.assigneePersonId;
  const people = await companyPeople(c, d.company_id, personId == null ? [] : [personId]);
  if (!people) return c.json(PERSON_REFUSAL, 400);
  const sent = (Object.keys(DEFECT_PATCH_COLUMNS) as Array<keyof DefectPatch>).filter((k) => k in v.value);
  const note = defectPatchNote(v.value, personId == null ? null : people.get(personId) ?? null);
  const row = await db(c).prepare(
    `WITH u AS (UPDATE project_defects SET ${sent.map((k) => `${DEFECT_PATCH_COLUMNS[k][0]} = ${DEFECT_PATCH_COLUMNS[k][1]}`).join(", ")}
                 WHERE id = ? AND closed_at IS NULL RETURNING id, item_description),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT ?::bigint, 'beta_defect_changed', NULL, u.item_description, ?::text, ?::bigint, ?::bigint FROM u)
     SELECT id::int AS id FROM u`,
  ).bind(...sent.map((k) => v.value[k] ?? null), defectId, d.project_id, note, userId(c), d.company_id).first<{ id: number }>();
  if (!row) return c.json({ error: "defect_changed", message: "Someone else just changed this problem. Reload and look again." }, 409);
  return c.json({ ok: true });
});

/** Beta's own Timeline: the engine's timeline, each entry filed under what it is about, plus the sales order,
    payments received, variation orders, deliveries and site receipts. */
async function betaTimelineExtras(c: Ctx, projectId: number, companyId: number): Promise<TimelineEntry[]> {
  const q = (sql: string) => projectDocSql(sql, projectId, companyId);
  const hidden = financeHiddenForUser(c.get("user"));
  const safe = (p: Promise<Row[]>): Promise<Row[]> => p.catch((e: unknown) => { if (isMissingRelation(e)) return []; throw e; });
  const [sos, pays, vos, dos, grs] = await Promise.all([
    safe(rowsOf(c, q(`SELECT doc_no, so_date::text AS so_date, ${TS("created_at")} AS created_at, status::text AS status, local_total_sen::bigint AS total_sen
                        FROM scm.mfg_sales_orders WHERE project_id = ?1 AND company_id = ?2`))),
    hidden ? Promise.resolve([] as Row[]) : safe(rowsOf(c, q(
      `SELECT p.id::text AS id, p.so_doc_no, p.paid_at::text AS paid_on, ${TS("p.created_at")} AS created_at, p.amount_sen::bigint AS amount_sen, p.method::text AS method
         FROM scm.mfg_sales_order_payments p WHERE p.so_doc_no IN (SELECT doc_no FROM scm.mfg_sales_orders WHERE project_id = ?1 AND company_id = ?2)`))),
    safe(rowsOf(c, q(`SELECT v.id::text AS id, v.vo_no, v.title, v.status, v.net_sen::bigint AS net_sen, ${TS("v.created_at")} AS created_at,
                             ${TS("v.approved_at")} AS approved_at, v.approved_by, v.signed_name
                        FROM scm.reno_variation_orders v
                       WHERE v.company_id = ?2 AND v.so_doc_no IN (SELECT doc_no FROM scm.mfg_sales_orders WHERE project_id = ?1 AND company_id = ?2)`))),
    safe(rowsOf(c, q(`SELECT d.id::text AS id, d.do_number, ${TS("d.delivered_at")} AS delivered_at, d.pod_r2_key IS NOT NULL AS has_pod,
                             d.signature_data IS NOT NULL AS signed
                        FROM scm.delivery_orders d WHERE d.id IN (__DOS__) AND d.delivered_at IS NOT NULL`))),
    safe(rowsOf(c, q(`SELECT g.id::text AS id, g.grn_number, ${TS("g.site_received_at")} AS at, sup.name AS supplier, g.customer_signer_name,
                             (SELECT count(*) FROM scm.grn_site_photos ph WHERE ph.grn_id = g.id)::int AS photos
                        FROM scm.grns g LEFT JOIN scm.suppliers sup ON sup.id = g.supplier_id
                       WHERE g.id IN (__GRS__) AND g.received_at_site AND g.site_received_at IS NOT NULL`))),
  ]);
  const out: TimelineEntry[] = [];
  const day = (d: unknown, fallback: unknown): { at: string; dateOnly: boolean } | null => {
    const s = str(d);
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return { at: `${s}T00:00:00Z`, dateOnly: true };
    const f = str(fallback);
    return f ? { at: f, dateOnly: false } : null;
  };
  const add = (id: string, when: { at: string; dateOnly: boolean } | null, category: TimelineCategory, title: string, body: string | null, by: string | null = null) => {
    if (when) out.push({ id, at: when.at, dateOnly: when.dateOnly, category, title, body, by });
  };
  for (const s of sos) {
    add(`so:${String(s.doc_no)}`, day(s.so_date, s.created_at), "sales", `Sales order ${String(s.doc_no)}`,
      [hidden || s.total_sen == null ? null : money(Number(s.total_sen)), str(s.status)].filter(Boolean).join(" · ") || null);
  }
  for (const p of pays) {
    add(`pay:${String(p.id)}`, day(p.paid_on, p.created_at), "sales", `Payment received ${money(Number(p.amount_sen ?? 0))}`,
      [str(p.method), str(p.so_doc_no)].filter(Boolean).join(" · ") || null);
  }
  for (const v of vos) {
    const label = `Variation order ${String(v.vo_no)}`;
    add(`vo:${String(v.id)}`, day(null, v.created_at), "sales", `${label} drafted`,
      [str(v.title), hidden ? null : money(Number(v.net_sen ?? 0))].filter(Boolean).join(" · ") || null);
    if (v.approved_at) add(`vo:${String(v.id)}:approved`, day(null, v.approved_at), "sales", `${label} approved`, str(v.signed_name) ? `Signed by ${String(v.signed_name)}` : null, str(v.approved_by));
  }
  for (const d of dos) {
    add(`deliv:${String(d.id)}`, day(null, d.delivered_at), "supplier", `Delivered: ${String(d.do_number)}`,
      [d.has_pod === true ? "Proof of delivery photo" : null, d.signed === true ? "signed" : null].filter(Boolean).join(" · ") || "No proof of delivery yet");
  }
  for (const g of grs) {
    const n = Number(g.photos ?? 0);
    add(`grsite:${String(g.id)}`, day(null, g.at), "supplier", `Received on site: ${String(g.grn_number)}`,
      [str(g.supplier), `${n} photo${n === 1 ? "" : "s"}`, str(g.customer_signer_name) ? `signed by ${String(g.customer_signer_name)}` : null].filter(Boolean).join(" · "));
  }
  return out;
}

app.get("/projects/:id/timeline", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  try {
    const [notesReady, docsReady] = await Promise.all([timelineNotesReady(db(c)), docFlowColumnsReady(db(c)).catch(() => false)]);
    const [base, extra] = await Promise.all([
      readProjectTimeline(db(c), id, co, { docsReady, notesReady }),
      docsReady ? betaTimelineExtras(c, id, co) : Promise.resolve([] as TimelineEntry[]),
    ]);
    const entries = sortTimeline([...base, ...extra]).map((e) => ({ ...e, category: betaCategory(e) }));
    return c.json({ entries });
  } catch (e) {
    console.error("[renovation-beta] timeline read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The project's timeline could not be read. Try again." }, 409);
  }
});

export default app;
