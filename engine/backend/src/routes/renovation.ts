/* Renovation projects: /api/renovation.

   The engine's exhibition Projects module reworked for an ID + full-home
   customisation company (spec 2026-10-09 section 5). Its own file because
   routes/projects.ts is at its size ceiling. Every read and write is scoped to
   the active company; every gate fails closed when a read fails (409). */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanyId, activeCompanySql, requireActiveCompanyId } from "../scm/lib/companyScope";
import { financeHiddenForUser } from "../services/pmsAccess";
import { todayMyt } from "../scm/lib/my-time";
import { RENO_STAGES, STAGE_LABEL, isStageKey, type StageKey } from "../scm/shared/renovation-stages";
import {
  BOARD_CHECKLIST_KEYS,
  loadProjectRows,
  loadRenovationFacts,
  type Db,
  type ProjectFacts,
} from "../services/renovation/load";
import { computeProjectView, stageCompletionBlockers, type ProjectView } from "../services/renovation/view";
import { manualSkipRefusal } from "../services/renovation/stages";
import { GATE_REASON_TEXT } from "../services/renovation/gate";
import { createRenovationProject, validateCreate, type CreateRenovationInput } from "../services/renovation/create";
import { plannedDatesRefusal, isInternalTradeCode, tradeTaskStatus } from "../services/renovation/tradeTasks";
import { SUPPLY_CONDITION_LABEL } from "../services/renovation/conditions";
import { groupEvidence, type EvidencePhoto } from "../services/renovation/pod";
import { renderPodNoteHtml } from "../services/renovation/podNote";
import { syncTradeTasks, writeCachedStage } from "../services/renovation/contractSync";
import { syncProjectDates } from "../services/renovation/projectDates";
import { syncStepSla } from "../services/renovation/stepSla";
import renovationProject from "./renovationProject";
import renovationMonitor from "./renovationMonitor";
import renovationProperty from "./renovationProperty";
import renovationDocuments from "./renovationDocuments";
import renovationTimeline from "./renovationTimeline";
import { propertyColumnsReady, pushProjectToOpenSos, readProjectCustomerInfo, regenerateProjectName, writeProjectShared } from "../services/renovation/customerProperty";
import { projectNameFrom } from "../scm/shared/renovation-property";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx) => c.env.DB as unknown as Db;
const userId = (c: Ctx): number => Number(c.get("user")?.id ?? 0);
const coSql = (c: Ctx, col = "company_id") => activeCompanySql(c, col);

function stripFinance(c: Ctx): boolean {
  return financeHiddenForUser(c.get("user"));
}

async function loadOne(c: Ctx, id: number, opts: { checklistKeys?: readonly string[] } = {}): Promise<{ facts: ProjectFacts; view: ProjectView } | null> {
  const rows = await loadProjectRows(db(c), coSql(c, "p.company_id"), { projectId: id, includeArchived: true });
  if (rows.length === 0) return null;
  const facts = (await loadRenovationFacts(db(c), rows, opts)).get(id)!;
  const today = todayMyt();
  const view = computeProjectView(facts, today);
  await syncProjectDates(db(c), facts, view, today);
  await syncStepSla(db(c), [{ f: facts, v: view }], today);
  return { facts, view };
}

/** Wrap a handler so an unexpected read failure answers 409 and never opens a gate. */
function failClosed(handler: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx) => {
    try {
      return await handler(c);
    } catch (e) {
      console.error("[renovation] read failed", e);
      return c.json({ error: "renovation_read_failed", message: "Project facts could not be read, so nothing was changed. Try again." }, 409);
    }
  };
}

async function refreshCachedStage(c: Ctx, id: number): Promise<void> {
  const one = await loadOne(c, id, { checklistKeys: BOARD_CHECKLIST_KEYS });
  if (!one) return;
  await writeCachedStage(db(c), id, one.facts);
}

async function logActivity(c: Ctx, projectId: number, action: string, from: string | null, to: string | null, note: string | null) {
  await db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(projectId, action, from, to, note, userId(c), activeCompanyId(c) ?? 1).run();
}

function parseId(x: string | undefined): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Simplified project (owner decisions 11 Oct 2026): own file, mounted before the /:id routes ──
app.route("/", renovationProject);
// Project Monitor hub (GET /monitor), also before /:id
app.route("/", renovationMonitor);
// Customer + property information and its pick lists (mig 0112), also before /:id
app.route("/", renovationProperty);
// Every transaction document of a project (mig 0116), also before /:id
app.route("/", renovationDocuments);
// The project Timeline: system entries from the existing history plus hand-written notes (mig 0118), also before /:id
app.route("/", renovationTimeline);

// ── Mode: which Projects screens this install shows (app_settings projects_mode, mig 0082) ──

app.get("/mode", requirePageAccess("projects.list"), async (c) => {
  try {
    const row = await db(c).prepare(`SELECT value FROM app_settings WHERE key = 'projects_mode'`).bind().first<{ value: string | null }>();
    return c.json({ mode: row?.value === "renovation" ? "renovation" : "exhibition" });
  } catch (e) {
    console.error("[renovation] mode read failed", e);
    return c.json({ mode: "exhibition", error: "mode_unreadable" });
  }
});

// ── Project types ────────────────────────────────────────────────────────

app.get("/types", requirePageAccess("projects.list"), async (c) => {
  const res = await db(c).prepare(
    `SELECT id::int AS id, slug, name, to_json(stage_keys) AS stage_keys, checklist_template_id::int AS checklist_template_id, sort_order, active FROM project_types WHERE true${coSql(c)} ORDER BY sort_order, name`,
  ).bind().all();
  return c.json({ data: res.results ?? [], stages: RENO_STAGES.map((k) => ({ key: k, label: STAGE_LABEL[k] })) });
});

function cleanStageKeys(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const keys: string[] = x.map(String).filter((k) => isStageKey(k));
  for (const must of ["design", "handover", "closed"]) if (!keys.includes(must)) keys.push(must);
  return RENO_STAGES.filter((k) => keys.includes(k));
}

app.post("/types", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = await c.req.json<{ name?: string; slug?: string; stageKeys?: unknown; sortOrder?: number }>();
  const name = String(b.name ?? "").trim();
  const keys = cleanStageKeys(b.stageKeys);
  if (!name || !keys) return c.json({ error: "name_and_stages_required" }, 400);
  const slug = String(b.slug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const row = await db(c).prepare(
    `INSERT INTO project_types (slug, name, stage_keys, sort_order, company_id) VALUES (?, ?, ?::text[], ?, ?) RETURNING id`,
  ).bind(slug, name, `{${keys.join(",")}}`, Number(b.sortOrder ?? 100), co.companyId).first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

app.patch("/types/:id", requirePermission("projects.manage"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const b = await c.req.json<{ name?: string; stageKeys?: unknown; active?: boolean; sortOrder?: number }>();
  const keys = b.stageKeys !== undefined ? cleanStageKeys(b.stageKeys) : undefined;
  if (keys === null) return c.json({ error: "invalid_stages" }, 400);
  const res = await db(c).prepare(
    `UPDATE project_types SET name = coalesce(?, name), stage_keys = coalesce(?::text[], stage_keys), active = coalesce(?, active),
            sort_order = coalesce(?, sort_order), updated_at = now()
      WHERE id = ?${coSql(c)}`,
  ).bind(b.name?.trim() || null, keys ? `{${keys.join(",")}}` : null, typeof b.active === "boolean" ? b.active : null,
    b.sortOrder ?? null, id).run() as { meta?: { changes?: number } };
  if (!res.meta?.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── Board ────────────────────────────────────────────────────────────────

app.get("/", requirePageAccess("projects.list"), failClosed(async (c) => {
  const rows = await loadProjectRows(db(c), coSql(c, "p.company_id"), { includeArchived: c.req.query("archived") === "1" });
  const facts = await loadRenovationFacts(db(c), rows, { checklistKeys: BOARD_CHECKLIST_KEYS });
  const today = todayMyt();
  const hideMoney = stripFinance(c);
  const views = new Map(rows.map((p) => [p.id, computeProjectView(facts.get(p.id)!, today)]));
  for (const p of rows) await syncProjectDates(db(c), facts.get(p.id)!, views.get(p.id)!, today);
  const data = rows.map((p) => {
    const f = facts.get(p.id)!;
    const v = views.get(p.id)!;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      building: p.building,
      unitNo: p.unit_no,
      customerName: p.customer_name,
      customerKind: p.customer_kind,
      typeName: f.type?.name ?? null,
      soDocNo: f.so?.doc_no ?? null,
      soDate: f.so?.so_date ?? null,
      salesperson: f.so?.agent ?? p.salesperson_name,
      soStatus: f.so?.status ?? null,
      furnitureCondition: v.conditions.furniture?.condition ?? null,
      renoItemCondition: v.conditions.renoItem?.condition ?? null,
      renoCondition: v.currentStage,
      renoConditionLabel: STAGE_LABEL[v.currentStage],
      payment: hideMoney ? { condition: v.payment.condition, label: v.payment.label } : v.payment,
      unitKey: v.unitKey,
      gateOpen: v.gate.open,
      redFlags: hideMoney ? v.redFlags.filter((r) => r.code !== "billing_due") : v.redFlags,
      plannedHandoverDate: p.planned_handover_date,
      linesUnavailable: f.linesUnavailable,
      archived: !!p.archived_at,
    };
  });
  return c.json({ data, conditionLabels: SUPPLY_CONDITION_LABEL });
}));

app.post("/", requirePermission("projects.write"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const body = await c.req.json<Partial<CreateRenovationInput>>().catch(() => ({} as Partial<CreateRenovationInput>));
  /* Owner, 14 Oct 2026: the form no longer asks "Customer is" (an outside customer unless a caller says
     otherwise) nor a free name: the name is Building + Unit, else the customer's name. */
  if (body.customerKind == null) body.customerKind = "customer";
  /* The New project form sends `customerInfo`: the same fields and required rules as the sales order
     (owner, 14 Oct 2026), checked before anything is written and saved with the project. */
  const raw = (body as { customerInfo?: unknown }).customerInfo;
  const info = raw && typeof raw === "object" && (await propertyColumnsReady(db(c)))
    ? await readProjectCustomerInfo(db(c), raw as Record<string, unknown>) : null;
  if (info?.problems.length) return c.json({ error: "validation_failed", problems: info.problems }, 422);
  if (info) {
    const v = info.value;
    Object.assign(body, {
      customerName: v.customerName, customerPhone: v.customerPhone || null, customerEmail: v.customerEmail || null,
      building: v.building || null, unitNo: v.unitNo || null,
    });
  }
  if (!String(body.name ?? "").trim()) body.name = projectNameFrom(body.building, body.unitNo, body.customerName);
  const refusal = validateCreate(body);
  if (refusal) return c.json({ error: refusal }, 400);
  const created = await createRenovationProject(db(c), body as CreateRenovationInput, userId(c), co.companyId);
  if (!created) return c.json({ error: "type_not_found" }, 400);
  if (info) await writeProjectShared(db(c), created.id, info.value);
  return c.json(created, 201);
});

// ── Calendar (cross-project tasks by planned dates) ─────────────────────

app.get("/calendar", requirePageAccess("projects.list"), async (c) => {
  const from = c.req.query("from") ?? todayMyt(-14);
  const to = c.req.query("to") ?? todayMyt(42);
  if (plannedDatesRefusal(from, to)) return c.json({ error: "invalid_range" }, 400);
  const supplierId = c.req.query("supplierId") || null;
  const projectId = c.req.query("projectId") ? parseId(c.req.query("projectId")) : null;
  const personId = c.req.query("personId") ? parseId(c.req.query("personId")) : null;
  const res = await db(c).prepare(
    `SELECT t.id::int AS id, t.project_id::int AS project_id, p.code AS project_code, p.name AS project_name, p.building, p.unit_no,
            t.stage_key, t.trade_code, t.fix_phase, t.label, t.fulfilment_kind, t.state, t.category_code, t.occurrence::int AS occurrence,
            coalesce((SELECT json_agg(json_build_object('id', pp.id::int, 'name', pp.name) ORDER BY pp.name)
                        FROM project_trade_task_assignees a JOIN project_people pp ON pp.id = a.person_id WHERE a.task_id = t.id), '[]'::json) AS assignees,
            t.supplier_id::text AS supplier_id, sup.name AS supplier_name, po.po_number,
            t.planned_start::text AS planned_start, t.planned_end::text AS planned_end,
            t.actual_start::text AS actual_start, t.actual_end::text AS actual_end,
            (EXISTS (SELECT 1 FROM project_trade_task_lines l WHERE l.task_id = t.id AND l.purchase_order_item_id IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM project_trade_task_lines l JOIN scm.purchase_order_items poi ON poi.id = l.purchase_order_item_id
                               WHERE l.task_id = t.id AND poi.received_qty < poi.qty)) AS po_fully_received
       FROM project_trade_tasks t
       JOIN projects p ON p.id = t.project_id AND p.archived_at IS NULL
       LEFT JOIN scm.suppliers sup ON sup.id = t.supplier_id
       LEFT JOIN scm.purchase_orders po ON po.id = t.purchase_order_id
      WHERE t.state <> 'skipped'
        AND coalesce(t.planned_start, t.planned_end) IS NOT NULL
        AND coalesce(t.planned_start, t.planned_end) <= ?::date
        AND coalesce(t.planned_end, t.planned_start) >= ?::date
        AND (?::uuid IS NULL OR t.supplier_id = ?::uuid)
        AND (?::bigint IS NULL OR t.project_id = ?::bigint)
        AND (?::bigint IS NULL OR EXISTS (SELECT 1 FROM project_trade_task_assignees a WHERE a.task_id = t.id AND a.person_id = ?::bigint))
        ${coSql(c, "p.company_id")}
      ORDER BY coalesce(t.planned_start, t.planned_end), p.code, t.seq`,
  ).bind(to, from, supplierId, supplierId, projectId, projectId, personId, personId).all<Record<string, unknown>>();
  const today = todayMyt();
  const data = (res.results ?? []).map((r) => ({
    ...r,
    status: tradeTaskStatus({
      state: String(r.state), fulfilment_kind: String(r.fulfilment_kind),
      planned_start: (r.planned_start as string) ?? null, planned_end: (r.planned_end as string) ?? null,
      actual_start: (r.actual_start as string) ?? null, actual_end: (r.actual_end as string) ?? null,
      poFullyReceived: r.po_fully_received === true,
    }, today),
  }));
  const contractors = await db(c).prepare(
    `SELECT DISTINCT sup.id::text AS id, sup.name FROM project_trade_tasks t JOIN projects p ON p.id = t.project_id
       JOIN scm.suppliers sup ON sup.id = t.supplier_id WHERE p.archived_at IS NULL${coSql(c, "p.company_id")} ORDER BY sup.name`,
  ).bind().all();
  const crew = await db(c).prepare(
    `SELECT DISTINCT pp.id::int AS id, pp.name FROM project_trade_task_assignees a JOIN project_people pp ON pp.id = a.person_id
       JOIN project_trade_tasks t ON t.id = a.task_id JOIN projects p ON p.id = t.project_id
      WHERE p.archived_at IS NULL${coSql(c, "p.company_id")} ORDER BY pp.name`,
  ).bind().all();
  return c.json({ from, to, data, contractors: contractors.results ?? [], crew: crew.results ?? [] });
});

// ── Checklist skip (with reason) ─────────────────────────────────────────

async function checklistItem(c: Ctx, itemId: number) {
  return db(c).prepare(
    `SELECT ck.id::int AS id, ck.project_id::int AS project_id, ck.item_key, ck.skippable, ck.status, ck.skip_reason
       FROM project_checklist ck JOIN projects p ON p.id = ck.project_id
      WHERE ck.id = ? AND p.project_kind = 'renovation'${coSql(c, "p.company_id")}`,
  ).bind(itemId).first<{ id: number; project_id: number; item_key: string | null; skippable: boolean; status: string; skip_reason: string | null }>();
}

app.post("/checklist/:itemId/skip", requirePermission("projects.write"), async (c) => {
  const itemId = parseId(c.req.param("itemId"));
  if (!itemId) return c.json({ error: "invalid_id" }, 400);
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const item = await checklistItem(c, itemId);
  if (!item) return c.json({ error: "not_found" }, 404);
  if (!item.skippable) return c.json({ error: "unskippable", message: "This item cannot be skipped." }, 409);
  const why = String(reason ?? "").trim();
  if (why.length < 3) return c.json({ error: "reason_required", message: "Give a reason of at least 3 characters." }, 400);
  if (item.status === "done") return c.json({ error: "already_done" }, 409);
  await db(c).prepare(
    `UPDATE project_checklist SET skip_reason = ?, skipped_by = ?, skipped_at = now(), updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`,
  ).bind(why, userId(c), itemId).run();
  await logActivity(c, item.project_id, "checklist_skipped", item.item_key, "skipped", why);
  return c.json({ ok: true });
});

app.post("/checklist/:itemId/unskip", requirePermission("projects.write"), async (c) => {
  const itemId = parseId(c.req.param("itemId"));
  if (!itemId) return c.json({ error: "invalid_id" }, 400);
  const item = await checklistItem(c, itemId);
  if (!item) return c.json({ error: "not_found" }, 404);
  await db(c).prepare(`UPDATE project_checklist SET skip_reason = NULL, skipped_by = NULL, skipped_at = NULL WHERE id = ?`).bind(itemId).run();
  await logActivity(c, item.project_id, "checklist_unskipped", item.item_key, "pending", null);
  return c.json({ ok: true });
});

// ── Trade and template tasks ─────────────────────────────────────────────

async function taskWithProject(c: Ctx, taskId: number) {
  return db(c).prepare(
    `SELECT t.id::int AS id, t.project_id::int AS project_id, t.stage_key, t.trade_code, t.fulfilment_kind, t.state, t.skip_source,
            t.planned_start::text AS planned_start, t.planned_end::text AS planned_end
       FROM project_trade_tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.id = ?${coSql(c, "p.company_id")}`,
  ).bind(taskId).first<{ id: number; project_id: number; stage_key: string; trade_code: string; fulfilment_kind: string; state: string; skip_source: string | null }>();
}

app.patch("/trade-tasks/:taskId", requirePermission("projects.write"), async (c) => {
  const taskId = parseId(c.req.param("taskId"));
  if (!taskId) return c.json({ error: "invalid_id" }, 400);
  const b = await c.req.json<{ plannedStart?: string | null; plannedEnd?: string | null; notes?: string | null; supplierId?: string | null }>();
  const task = await taskWithProject(c, taskId);
  if (!task) return c.json({ error: "not_found" }, 404);
  const start = b.plannedStart === undefined ? undefined : (b.plannedStart || null);
  const end = b.plannedEnd === undefined ? undefined : (b.plannedEnd || null);
  const refusal = plannedDatesRefusal(start ?? (task as { planned_start?: string | null }).planned_start ?? null,
    end ?? (task as { planned_end?: string | null }).planned_end ?? null);
  if (refusal) return c.json({ error: refusal }, 400);
  if (b.supplierId && isInternalTradeCode(task.trade_code)) return c.json({ error: "internal_task_has_no_supplier" }, 400);
  await db(c).prepare(
    `UPDATE project_trade_tasks
        SET planned_start = CASE WHEN ? THEN ?::date ELSE planned_start END,
            planned_end = CASE WHEN ? THEN ?::date ELSE planned_end END,
            notes = CASE WHEN ? THEN ? ELSE notes END,
            supplier_id = CASE WHEN ? THEN ?::uuid ELSE supplier_id END,
            updated_at = now()
      WHERE id = ?`,
  ).bind(start !== undefined, start ?? null, end !== undefined, end ?? null, b.notes !== undefined, b.notes ?? null,
    b.supplierId !== undefined, b.supplierId || null, taskId).run();
  return c.json({ ok: true });
});

app.post("/trade-tasks/:taskId/start", requirePermission("projects.write"), failClosed(async (c) => {
  const taskId = parseId(c.req.param("taskId"));
  if (!taskId) return c.json({ error: "invalid_id" }, 400);
  const task = await taskWithProject(c, taskId);
  if (!task) return c.json({ error: "not_found" }, 404);
  if (task.state === "skipped" || task.state === "done") return c.json({ error: `task_${task.state}` }, 409);
  await db(c).prepare(`UPDATE project_trade_tasks SET state = 'in_progress', actual_start = coalesce(actual_start, ?::date), updated_at = now() WHERE id = ?`)
    .bind(todayMyt(), taskId).run();
  return c.json({ ok: true });
}));

app.post("/trade-tasks/:taskId/complete", requirePermission("projects.write"), async (c) => {
  const taskId = parseId(c.req.param("taskId"));
  if (!taskId) return c.json({ error: "invalid_id" }, 400);
  const task = await taskWithProject(c, taskId);
  if (!task) return c.json({ error: "not_found" }, 404);
  if (task.fulfilment_kind === "po") {
    /* A PO task with PO lines completes on receipt; one added by hand with no PO line (e.g. curtain by a contractor) is ticked. */
    const linked = await db(c).prepare(`SELECT 1 AS x FROM project_trade_task_lines WHERE task_id = ? AND purchase_order_item_id IS NOT NULL LIMIT 1`).bind(taskId).first();
    if (linked) return c.json({ error: "po_task_completes_on_receipt", message: "A subcontracted task completes when its purchase order is received on site." }, 409);
  }
  if (task.state === "skipped") return c.json({ error: "task_skipped" }, 409);
  const b = await c.req.json<{ note?: string }>().catch(() => ({} as { note?: string }));
  await db(c).prepare(
    `UPDATE project_trade_tasks SET state = 'done', actual_start = coalesce(actual_start, ?::date), actual_end = ?::date,
            done_by = ?, done_at = now(), notes = coalesce(?, notes), updated_at = now() WHERE id = ?`,
  ).bind(todayMyt(), todayMyt(), userId(c), b.note ?? null, taskId).run();
  await logActivity(c, task.project_id, "task_done", task.trade_code, "done", b.note ?? null);
  return c.json({ ok: true });
});

app.post("/trade-tasks/:taskId/skip", requirePermission("projects.write"), async (c) => {
  const taskId = parseId(c.req.param("taskId"));
  if (!taskId) return c.json({ error: "invalid_id" }, 400);
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const why = String(reason ?? "").trim();
  if (why.length < 3) return c.json({ error: "reason_required" }, 400);
  const task = await taskWithProject(c, taskId);
  if (!task) return c.json({ error: "not_found" }, 404);
  if (task.state === "done") return c.json({ error: "task_done" }, 409);
  await db(c).prepare(
    `UPDATE project_trade_tasks SET state = 'skipped', skip_source = 'manual', skip_reason = ?, skipped_by = ?, skipped_at = now(), updated_at = now() WHERE id = ?`,
  ).bind(why, userId(c), taskId).run();
  await logActivity(c, task.project_id, "task_skipped", task.trade_code, "skipped", why);
  return c.json({ ok: true });
});

app.post("/trade-tasks/:taskId/unskip", requirePermission("projects.write"), async (c) => {
  const taskId = parseId(c.req.param("taskId"));
  if (!taskId) return c.json({ error: "invalid_id" }, 400);
  const task = await taskWithProject(c, taskId);
  if (!task) return c.json({ error: "not_found" }, 404);
  if (task.state !== "skipped") return c.json({ error: "not_skipped" }, 409);
  await db(c).prepare(
    `UPDATE project_trade_tasks SET state = 'open', skip_source = NULL, skip_reason = NULL, skipped_by = NULL, skipped_at = NULL, updated_at = now() WHERE id = ?`,
  ).bind(taskId).run();
  await logActivity(c, task.project_id, "task_unskipped", task.trade_code, "open", null);
  return c.json({ ok: true });
});

// ── Snags ────────────────────────────────────────────────────────────────

app.post("/snags/:defectId/close", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("defectId"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const res = await db(c).prepare(
    `UPDATE project_defects d SET closed_at = now(), closed_by = ?, resolved = 1
       FROM projects p WHERE p.id = d.project_id AND d.id = ? AND d.closed_at IS NULL${coSql(c, "p.company_id")}`,
  ).bind(userId(c), id).run() as { meta?: { changes?: number } };
  if (!res.meta?.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── One project ──────────────────────────────────────────────────────────

app.get("/:id", requirePageAccess("projects.list"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const one = await loadOne(c, id);
  if (!one) return c.json({ error: "not_found" }, 404);
  const { facts: f, view: v } = one;
  const hideMoney = stripFinance(c);
  const cases = await db(c).prepare(
    `SELECT id, assr_no, status, complaint_issue, created_at FROM assr_cases WHERE project_id = ?${coSql(c)} ORDER BY id DESC`,
  ).bind(id).all();
  const grns = await db(c).prepare(
    `SELECT g.id::text AS id, g.grn_number, g.status::text AS status, g.site_received_at, g.received_at_site,
            po.po_number, sup.name AS supplier_name
       FROM scm.grns g LEFT JOIN scm.purchase_orders po ON po.id = g.purchase_order_id LEFT JOIN scm.suppliers sup ON sup.id = g.supplier_id
      WHERE g.project_id = ? ORDER BY g.created_at DESC`,
  ).bind(id).all();
  const attending = await db(c).prepare(
    `SELECT pp.id::int AS id, pp.name, pp.active, pp.phone, to_json(pp.roles) AS roles FROM project_attendees a JOIN project_people pp ON pp.id = a.person_id
      WHERE a.project_id = ? ORDER BY lower(pp.name)`,
  ).bind(id).all<{ id: number; name: string; active: boolean; phone: string | null; roles: string[] }>();
  const pos = new Map<string, { id: string; po_number: string; supplier_name: string | null; status: string; lines: number; received: boolean }>();
  for (const pl of f.poLines) {
    const cur = pos.get(pl.purchase_order_id) ?? { id: pl.purchase_order_id, po_number: pl.po_number, supplier_name: pl.supplier_name, status: pl.po_status, lines: 0, received: true };
    cur.lines++;
    if (Number(pl.received_qty) < Number(pl.qty)) cur.received = false;
    pos.set(pl.purchase_order_id, cur);
  }
  return c.json({
    project: f.project,
    type: f.type,
    so: f.so,
    linesUnavailable: f.linesUnavailable,
    lines: f.lines,
    stages: v.stages,
    currentStage: v.currentStage,
    gate: { ...v.gate, messages: v.gate.reasons.map((r) => GATE_REASON_TEXT[r]) },
    billing: hideMoney ? { available: f.billing.available, hidden: true } : f.billing,
    prompts: hideMoney ? [] : v.prompts,
    payment: hideMoney ? { condition: v.payment.condition, label: v.payment.label } : v.payment,
    conditions: v.conditions,
    unitKey: v.unitKey,
    redFlags: v.redFlags,
    checklist: f.checklist,
    tasks: v.tasks,
    handover: f.handover,
    defects: f.defects,
    serviceCases: cases.results ?? [],
    purchaseOrders: [...pos.values()],
    receipts: grns.results ?? [],
    financeHidden: hideMoney,
    flow: v.flow,
    stepSla: f.stepSla ?? null,
    hold: v.hold,
    money: hideMoney ? { contractSen: null, receivedSen: null, receivedPct: null } : v.money,
    keyHolder: v.keyHolder,
    vo: v.vo,
    people: {
      sales: { id: f.project.sales_person_id ?? null, name: f.project.sales_person_name ?? null },
      designer: { id: f.project.designer_person_id ?? null, name: f.project.designer_person_name ?? null },
      renoPic: { id: f.project.reno_pic_person_id ?? null, name: f.project.reno_pic_person_name ?? null },
      // Owner, 14 Oct 2026: the screen shows Project PIC (reno_pic_person_id) and Attending (project_attendees).
      pic: { id: f.project.reno_pic_person_id ?? null, name: f.project.reno_pic_person_name ?? null },
      attending: attending.results ?? [],
    },
  });
}));

async function projectInCompany(c: Ctx, id: number): Promise<boolean> {
  const row = await db(c).prepare(`SELECT id FROM projects WHERE id = ? AND project_kind = 'renovation'${coSql(c)}`).bind(id).first();
  return !!row;
}

app.post("/:id/stages/:key/start", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  const key = c.req.param("key");
  if (!id || !isStageKey(key)) return c.json({ error: "invalid_stage" }, 400);
  const one = await loadOne(c, id);
  if (!one) return c.json({ error: "not_found" }, 404);
  const stage = one.view.stages.find((s) => s.key === key)!;
  if (stage.state === "skipped") return c.json({ error: "stage_skipped", message: "Un-skip the stage first." }, 409);
  if (stage.state !== "not_started") return c.json({ error: `stage_${stage.state}` }, 409);
  await db(c).prepare(
    `UPDATE project_stages SET state = 'in_progress', started_at = now(), started_by = ?, updated_at = now() WHERE project_id = ? AND stage_key = ?`,
  ).bind(userId(c), id, key).run();
  await logActivity(c, id, "stage_started", key, "in_progress", null);
  await refreshCachedStage(c, id);
  return c.json({ ok: true });
}));

app.post("/:id/stages/:key/complete", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  const key = c.req.param("key");
  if (!id || !isStageKey(key)) return c.json({ error: "invalid_stage" }, 400);
  const one = await loadOne(c, id);
  if (!one) return c.json({ error: "not_found" }, 404);
  const blockers = stageCompletionBlockers(one.facts, one.view, key);
  if (blockers.length > 0) return c.json({ error: "stage_blocked", blockers }, 409);
  await db(c).prepare(
    `UPDATE project_stages SET state = 'done', started_at = coalesce(started_at, now()), started_by = coalesce(started_by, ?),
            done_at = now(), done_by = ?, updated_at = now() WHERE project_id = ? AND stage_key = ?`,
  ).bind(userId(c), userId(c), id, key).run();
  await logActivity(c, id, "stage_done", key, "done", null);
  await refreshCachedStage(c, id);
  return c.json({ ok: true });
}));

app.post("/:id/stages/:key/skip", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  const key = c.req.param("key");
  if (!id || !isStageKey(key)) return c.json({ error: "invalid_stage" }, 400);
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const one = await loadOne(c, id, { checklistKeys: BOARD_CHECKLIST_KEYS });
  if (!one) return c.json({ error: "not_found" }, 404);
  const refusal = manualSkipRefusal(one.view.stages.find((s) => s.key === key), reason);
  if (refusal === "reason_required") return c.json({ error: refusal, message: "Give a reason of at least 3 characters." }, 400);
  if (refusal) return c.json({ error: refusal }, 409);
  await db(c).prepare(
    `UPDATE project_stages SET state = 'skipped', skip_reason = ?, skipped_by = ?, skipped_at = now(), started_at = started_at, updated_at = now()
      WHERE project_id = ? AND stage_key = ?`,
  ).bind(String(reason).trim(), userId(c), id, key).run();
  await logActivity(c, id, "stage_skipped", key, "skipped", String(reason).trim());
  await refreshCachedStage(c, id);
  return c.json({ ok: true });
}));

app.post("/:id/stages/:key/unskip", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  const key = c.req.param("key");
  if (!id || !isStageKey(key)) return c.json({ error: "invalid_stage" }, 400);
  if (!(await projectInCompany(c, id))) return c.json({ error: "not_found" }, 404);
  const res = await db(c).prepare(
    `UPDATE project_stages SET state = 'not_started', skip_reason = NULL, skipped_by = NULL, skipped_at = NULL, updated_at = now()
      WHERE project_id = ? AND stage_key = ? AND state = 'skipped'`,
  ).bind(id, key).run() as { meta?: { changes?: number } };
  if (!res.meta?.changes) return c.json({ error: "not_skipped_by_hand", message: "Only a stage skipped by hand can be un-skipped; type and sales-order skips follow the contract." }, 409);
  await logActivity(c, id, "stage_unskipped", key, "not_started", null);
  await refreshCachedStage(c, id);
  return c.json({ ok: true });
});

app.patch("/:id/stages/:key", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  const key = c.req.param("key");
  if (!id || !isStageKey(key)) return c.json({ error: "invalid_stage" }, 400);
  const b = await c.req.json<{ plannedStart?: string | null; plannedEnd?: string | null }>();
  const refusal = plannedDatesRefusal(b.plannedStart ?? null, b.plannedEnd ?? null);
  if (refusal) return c.json({ error: refusal }, 400);
  if (!(await projectInCompany(c, id))) return c.json({ error: "not_found" }, 404);
  await db(c).prepare(
    `UPDATE project_stages SET planned_start = ?::date, planned_end = ?::date, updated_at = now() WHERE project_id = ? AND stage_key = ?`,
  ).bind(b.plannedStart || null, b.plannedEnd || null, id, key).run();
  return c.json({ ok: true });
});

app.patch("/:id", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await projectInCompany(c, id))) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<Record<string, unknown>>();
  const allowed: Record<string, string> = {
    name: "name", building: "building", unitNo: "unit_no", siteAddress: "site_address", customerName: "customer_name",
    customerPhone: "customer_phone", customerEmail: "customer_email", salespersonName: "salesperson_name", notes: "notes",
    plannedHandoverDate: "planned_handover_date",
  };
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, col] of Object.entries(allowed)) {
    if (!(k in b)) continue;
    const val = b[k] == null || b[k] === "" ? null : String(b[k]);
    if (col === "name" && !val) return c.json({ error: "name_required" }, 400);
    if (col === "planned_handover_date" && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return c.json({ error: "date_invalid" }, 400);
    sets.push(col === "planned_handover_date" ? `${col} = ?::date` : `${col} = ?`);
    args.push(val);
  }
  if (sets.length === 0) return c.json({ ok: true });
  await db(c).prepare(`UPDATE projects SET ${sets.join(", ")}, updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`)
    .bind(...args, id).run();
  /* The name follows Building + Unit (owner, 14 Oct 2026) unless this edit names the project itself. */
  if (!("name" in b) && ["building", "unitNo", "customerName"].some((k) => k in b)) await regenerateProjectName(db(c), id);
  /* The project is the master of the customer fields (mig 0112): its open sales orders follow. */
  const shared = ["building", "unitNo", "siteAddress", "customerName", "customerPhone", "customerEmail"].some((k) => k in b);
  if (shared && (await propertyColumnsReady(db(c)).catch(() => false))) {
    const pushed = await pushProjectToOpenSos(db(c), id);
    return c.json({ ok: true, salesOrdersUpdated: pushed.updated, salesOrdersKept: pushed.kept });
  }
  return c.json({ ok: true });
});

app.post("/:id/trade-tasks/sync", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const one = await loadOne(c, id, { checklistKeys: BOARD_CHECKLIST_KEYS });
  if (!one) return c.json({ error: "not_found" }, 404);
  const f = one.facts;
  const synced = await syncTradeTasks(db(c), id, f);
  if (!synced) return c.json({ error: f.linesUnavailable ?? "lines_unavailable", message: "The contract lines cannot be read yet." }, 409);
  return c.json(synced);
}));

app.post("/:id/snags", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await projectInCompany(c, id))) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ location?: string; description?: string; photoR2Key?: string | null; phase?: string }>();
  const desc = String(b.description ?? "").trim();
  if (!desc) return c.json({ error: "description_required" }, 400);
  const phase = b.phase === "defect_check" ? "defect_check" : "snag";
  if (b.photoR2Key && !b.photoR2Key.startsWith(`renovation/${id}/`)) return c.json({ error: "invalid_photo_key" }, 400);
  const row = await db(c).prepare(
    `INSERT INTO project_defects (project_id, phase, reported_by_role, item_description, photo_r2_key, reported_by, reported_at,
                                  resolved, stage_key, location, due_date, company_id)
     VALUES (?, ?, 'supervisor', ?, ?, ?, to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 0, ?, ?, ?::date, ?) RETURNING id`,
  ).bind(id, phase, desc, b.photoR2Key ?? null, userId(c), phase === "snag" ? "handover" : "defect_check", b.location?.trim() || null,
    phase === "snag" ? todayMyt(7) : null, activeCompanyId(c) ?? 1).first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

app.post("/:id/handover", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const b = await c.req.json<{
    customerSignerName?: string; customerSignatureR2Key?: string; keysReturned?: number; accessCardsReturned?: number;
    depositRefundNote?: string; notes?: string; lat?: number; lng?: number; accuracyM?: number;
  }>();
  const one = await loadOne(c, id, { checklistKeys: BOARD_CHECKLIST_KEYS });
  if (!one) return c.json({ error: "not_found" }, 404);
  if (one.facts.handover) return c.json({ error: "already_signed" }, 409);
  if (one.view.openSnags > 0) return c.json({ error: "snags_open", count: one.view.openSnags, message: "Close every snag before the customer signs the handover." }, 409);
  const signer = String(b.customerSignerName ?? "").trim();
  if (!signer) return c.json({ error: "signer_required" }, 400);
  if (!b.customerSignatureR2Key || !b.customerSignatureR2Key.startsWith(`renovation/${id}/`)) return c.json({ error: "signature_required" }, 400);
  const hasGps = typeof b.lat === "number" && typeof b.lng === "number";
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_handovers (project_id, customer_signer_name, customer_signature_r2_key, staff_user_id, keys_returned, access_cards_returned,
                                      deposit_refund_note, notes, lat, lng, accuracy_m, located_at, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${hasGps ? "now()" : "NULL"}, ?)`,
    ).bind(id, signer, b.customerSignatureR2Key, userId(c), b.keysReturned ?? null, b.accessCardsReturned ?? null,
      b.depositRefundNote ?? null, b.notes ?? null, hasGps ? b.lat : null, hasGps ? b.lng : null, hasGps ? (b.accuracyM ?? null) : null,
      Number(one.facts.project.company_id)),
    db(c).prepare(
      `UPDATE project_checklist SET status = 'done', completed_by = ?, completed_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              evidence_r2_key = ? WHERE project_id = ? AND item_key = 'handover_signed'`,
    ).bind(userId(c), b.customerSignatureR2Key, id),
    db(c).prepare(`UPDATE projects SET handed_over_at = now() WHERE id = ?`).bind(id),
  ]);
  await logActivity(c, id, "handover_signed", null, signer, null);
  await refreshCachedStage(c, id);
  return c.json({ ok: true }, 201);
}));

// ── Files (R2 renovation/{projectId}/...) ───────────────────────────────

const FILE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const FILE_MAX = 10 * 1024 * 1024;

app.post("/:id/files", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await projectInCompany(c, id))) return c.json({ error: "not_found" }, 404);
  const type = (c.req.header("content-type") || "").split(";")[0]!.trim().toLowerCase();
  const ext = FILE_TYPES[type];
  if (!ext) return c.json({ error: "unsupported_type" }, 415);
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) return c.json({ error: "empty" }, 400);
  if (buf.byteLength > FILE_MAX) return c.json({ error: "too_large" }, 413);
  const kind = (c.req.query("kind") ?? "file").replace(/[^a-z_]/g, "").slice(0, 20) || "file";
  const key = `renovation/${id}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await c.env.POD_BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key }, 201);
});

app.get("/:id/files", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  const key = c.req.query("key") ?? "";
  if (!id || !key.startsWith(`renovation/${id}/`) || key.includes("..")) return c.json({ error: "invalid_key" }, 400);
  if (!(await projectInCompany(c, id))) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.POD_BUCKET.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(obj.body, { headers });
});

// ── POD: evidence by room, and a printable delivery / completion note ────

async function loadPod(c: Ctx, id: number) {
  const photos = await db(c).prepare(
    `SELECT ph.id::text AS id, ph.kind, ph.location, ph.r2_key, ph.caption, ph.taken_at, g.id::text AS grn_id, g.grn_number
       FROM scm.grn_site_photos ph JOIN scm.grns g ON g.id = ph.grn_id
      WHERE ph.project_id = ? AND g.status::text <> 'CANCELLED' ORDER BY ph.created_at`,
  ).bind(id).all<EvidencePhoto>();
  const receipts = await db(c).prepare(
    `SELECT g.id::text AS id, g.grn_number, g.site_received_at, g.site_lat, g.site_lng, g.site_accuracy_m, g.customer_signer_name,
            g.supervisor_signature_r2_key, g.customer_signature_r2_key, g.site_notes, st.name AS supervisor_name,
            po.po_number, sup.name AS supplier_name,
            (SELECT json_agg(json_build_object('item_code', gi.item_code, 'name', gi.material_name, 'qty', gi.qty_accepted))
               FROM scm.grn_items gi WHERE gi.grn_id = g.id) AS lines
       FROM scm.grns g
       LEFT JOIN scm.staff st ON st.id = g.supervisor_user_id
       LEFT JOIN scm.purchase_orders po ON po.id = g.purchase_order_id
       LEFT JOIN scm.suppliers sup ON sup.id = g.supplier_id
      WHERE g.project_id = ? AND g.received_at_site AND g.status::text NOT IN ('CANCELLED', 'DRAFT')
      ORDER BY g.site_received_at`,
  ).bind(id).all<Record<string, unknown>>();
  const deliveries = await db(c).prepare(
    `SELECT d.id::text AS id, d.do_number, d.delivered_at, d.pod_r2_key, d.signature_data IS NOT NULL AS signed, d.status::text AS status
       FROM scm.delivery_orders d JOIN scm.mfg_sales_orders so ON so.doc_no = d.so_doc_no
      WHERE so.project_id = ? AND d.status::text IN ('SIGNED', 'DELIVERED', 'INVOICED') ORDER BY d.delivered_at`,
  ).bind(id).all<Record<string, unknown>>().catch((e: unknown) => {
    console.error("[renovation] DO POD read failed", e);
    return { results: [] as Record<string, unknown>[] };
  });
  const list = (photos.results ?? []).map((p) => ({ ...p, source: "site_receipt" as const }));
  return { rooms: groupEvidence(list), receipts: receipts.results ?? [], deliveries: deliveries.results ?? [] };
}

app.get("/:id/pod", requirePageAccess("projects.list"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await projectInCompany(c, id))) return c.json({ error: "not_found" }, 404);
  return c.json(await loadPod(c, id));
}));

app.get("/:id/pod/print", requirePageAccess("projects.list"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const one = await loadOne(c, id, { checklistKeys: BOARD_CHECKLIST_KEYS });
  if (!one) return c.json({ error: "not_found" }, 404);
  const pod = await loadPod(c, id);
  const html = renderPodNoteHtml({ project: one.facts.project, receipts: pod.receipts, deliveries: pod.deliveries, rooms: pod.rooms, grnId: c.req.query("grnId") ?? null });
  return c.html(html);
}));

export default app;
