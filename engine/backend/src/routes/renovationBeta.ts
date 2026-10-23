/* Beta renovation project workspace, bundle A (owner, 23 Oct 2026; plan
   docs/superpowers/plans/2026-10-23-beta-project-workspace.md section 9). Mounted at /api/beta after the auth gate.
   The global auth gate runs first; inside this router the switch comes first on every route: where BETA_ENABLED is
   not "true" (production) this answers 404 before any permission check or query. Every project, defect and design-file route is scoped to the active company (404 otherwise), and
   every write adds a project_activity row (action beta_*) that the existing timeline reads. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql, requireActiveCompanyId } from "../scm/lib/companyScope";
import { isBetaEnabled } from "../scm/lib/renovation-beta-enabled";
import { billingViews } from "../scm/lib/renovation-billing";
import { todayMyt } from "../scm/lib/my-time";
import { financeHiddenForUser } from "../services/pmsAccess";
import { setChecklistStatus } from "../services/projects";
import { isMissingRelation, loadProjectRows, loadRenovationFacts, type Db, type DbStmt } from "../services/renovation/load";
import { renoDbFromD1 } from "../services/renovation/dbBridge";
import { writeCachedStage } from "../services/renovation/contractSync";
import {
  BETA_DEFAULT_2D_DAYS, BETA_DEFAULT_3D_DAYS, cleanBetaReminder, cleanBetaSettings, cleanDefectFixed, cleanDefectRedo, cleanDefectReport,
  cleanDesignApproval, cleanDesignSent, defectMoveRefusal, designLabel, paymentsOf, type BetaPayments, type DefectMove,
} from "../services/renovation/beta";

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

// The first middleware of this router: before any permission check or query here, so a switched-off worker reads nothing.
app.use("*", async (c, next) => {
  if (!isBetaEnabled(c.env)) return c.json({ error: "not_found" }, 404);
  await next();
});

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

/** Payments of the project's renovation SO (the non-cancelled one, as services/renovation/load.ts finds it). */
async function paymentsFor(c: Ctx, projectId: number, companyId: number): Promise<BetaPayments> {
  if (financeHiddenForUser(c.get("user"))) return { state: "hidden" };
  try {
    const so = await db(c).prepare(
      `SELECT so.doc_no FROM scm.mfg_sales_orders so
        WHERE so.project_id = ? AND so.company_id = ? AND so.status::text <> 'CANCELLED' AND to_jsonb(so)->>'so_kind' = 'RENOVATION'
        ORDER BY so.so_date DESC NULLS LAST, so.doc_no DESC LIMIT 1`,
    ).bind(projectId, companyId).first<{ doc_no: string }>();
    if (!so) return { state: "none" };
    const views = await billingViews(renoDbFromD1(db(c)), [so.doc_no], companyId);
    return paymentsOf(views.get(so.doc_no) ?? null);
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
  const v = cleanDefectReport(await body(c), id);
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const { location, description, trade, dueDate, photoKey } = v.value;
  // Phase 'snag' so the handover rule (every snag closed first) counts it.
  // One statement: the defect and its activity row are written together or not at all.
  const row = await db(c).prepare(
    `WITH d AS (
       INSERT INTO project_defects (project_id, phase, reported_by_role, item_description, photo_r2_key, reported_by, reported_at,
                                    resolved, stage_key, location, due_date, trade, company_id)
       VALUES (?, 'snag', 'supervisor', ?, ?, ?, to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 0, 'handover', ?, ?::date, ?, ?)
       RETURNING id, project_id, company_id, item_description),
     a AS (
       INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
       SELECT d.project_id, 'beta_defect_reported', NULL, d.item_description, ?::text, ?::bigint, d.company_id FROM d)
     SELECT id::int AS id FROM d`,
  ).bind(id, description, photoKey, userId(c), location, dueDate, trade, co, [location, trade].filter(Boolean).join(", ") || null, userId(c))
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

export default app;
