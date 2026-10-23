/* The simplified renovation project (owner decisions 11 Oct 2026,
   docs/superpowers/specs/2026-10-11-renovation-simplified-project.md).
   Mounted inside routes/renovation.ts at /api/renovation, before its /:id routes.

   Read APIs for the Project Monitor and the Notion importer:
     GET /board-rows                 board rows (decision 7 columns)
     GET /people?role=&active=       people master, kept in line with the user accounts
     GET /key-log?projectId=         unit key moves
     GET /design-records?projectId=  site measures, design files and design notes
     GET /:id/procurement            PO / delivery dates per catalog category and sub-category
     GET /:id/step                   current step, derived step, manual step, hold, steps, history
   Writes: people, flow steps, task categories (Project Maintenance); manual step,
   hold flag, people on a project, key moves, site measures, design files, SO
   link / unlink / project from SO, site tasks by category, crew and fulfilment.
   Every read and write is scoped to the active company. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql, requireActiveCompanyId } from "../scm/lib/companyScope";
import { financeHiddenForUser } from "../services/pmsAccess";
import { todayMyt } from "../scm/lib/my-time";
import { FLOW_STEP_KEYS, PERSON_ROLES, isFlowStepKey, taskCategoryDef } from "../scm/shared/renovation-stages";
import { BOARD_CHECKLIST_KEYS, loadProjectRows, loadRenovationFacts, type Db } from "../services/renovation/load";
import { computeProjectView } from "../services/renovation/view";
import { boardRowOf } from "../services/renovation/boardRow";
import {
  cleanAttending, cleanDesignFilePatch, cleanDesignKind, cleanDesignLink, cleanDesignNote, cleanHold, cleanKeyMove, cleanManualStep, cleanPerson, cleanSiteMeasure,
  DESIGN_FILE_MAX, DESIGN_FILE_TYPES, designAttachRefusal,
} from "../services/renovation/records";
import { buildProcurementView, cleanCategoryDates, cleanSubDates, type GroupDefRow, type ProcRow, type SubDefRow } from "../services/renovation/procurement";
import { createProjectFromSo, linkSoToProject, unlinkSoFromProject } from "../services/renovation/soLink";
import { manualTaskRow, plannedDatesRefusal } from "../services/renovation/tradeTasks";
import { writeCachedStage } from "../services/renovation/contractSync";
import { syncProjectDates } from "../services/renovation/projectDates";
import { stepSlaReady, syncStepSla } from "../services/renovation/stepSla";
import { audit } from "../services/audit";
import { SUPPLY_CONDITION_LABEL } from "../services/renovation/conditions";
import { staffViewReady, syncPeopleFromUsers } from "../services/renovation/peopleSync";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx) => c.env.DB as unknown as Db;
const userId = (c: Ctx): number => Number(c.get("user")?.id ?? 0);
const userName = (c: Ctx): string => String(c.get("user").name || userId(c));
const coSql = (c: Ctx, col = "company_id") => activeCompanySql(c, col);
const body = async (c: Ctx): Promise<Record<string, unknown>> => (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};

function parseId(x: string | undefined | null): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function failClosed(handler: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx) => {
    try {
      return await handler(c);
    } catch (e) {
      console.error("[renovation] request failed", e);
      return c.json({ error: "renovation_read_failed", message: "Project facts could not be read, so nothing was changed. Try again." }, 409);
    }
  };
}

async function projectCompany(c: Ctx, id: number): Promise<number | null> {
  const r = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${coSql(c)}`).bind(id).first<{ company_id: number }>();
  return r ? Number(r.company_id) : null;
}

/** Every person id must be a person of this company (active or not). */
async function peopleRefusal(c: Ctx, companyId: number, ids: Array<number | null | undefined>): Promise<string | null> {
  const list = [...new Set(ids.filter((x): x is number => x != null))];
  if (list.length === 0) return null;
  const r = await db(c).prepare(
    `SELECT count(*)::int AS n FROM project_people WHERE company_id = ? AND id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`,
  ).bind(companyId, JSON.stringify(list.map(String))).first<{ n: number }>();
  return Number(r?.n ?? 0) === list.length ? null : "person_not_found";
}

async function loadViews(c: Ctx, opts: { projectId?: number; includeArchived?: boolean }) {
  const rows = await loadProjectRows(db(c), coSql(c, "p.company_id"), opts);
  const facts = await loadRenovationFacts(db(c), rows, { checklistKeys: BOARD_CHECKLIST_KEYS });
  const today = todayMyt();
  const list = rows.map((p) => {
    const f = facts.get(p.id)!;
    return { f, v: computeProjectView(f, today) };
  });
  /* The step is computed here, so this is where a project reaching (or leaving) Closed gets its end date written. */
  for (const { f, v } of list) await syncProjectDates(db(c), f, v, today);
  await syncStepSla(db(c), list, today);
  return list;
}

/** After a hand move of the step: read the project again so its end date follows the new step. */
async function resyncDates(c: Ctx, id: number): Promise<void> {
  await loadViews(c, { projectId: id, includeArchived: true });
}

// ── Board rows (read API) ───────────────────────────────────────────────

app.get("/board-rows", requirePageAccess("projects.list"), failClosed(async (c) => {
  const hideMoney = financeHiddenForUser(c.get("user"));
  const list = await loadViews(c, { includeArchived: c.req.query("archived") === "1" });
  return c.json({ data: list.map(({ f, v }) => boardRowOf(f, v, { hideMoney })), arrivalLabels: SUPPLY_CONDITION_LABEL });
}));

// ── People master ────────────────────────────────────────────────────────

const PERSON_COLS = `id::int AS id, name, to_json(roles) AS roles, active, user_id::int AS user_id, phone, notes, source, source_ref, created_at, updated_at`;
const PP_COLS = `pp.id::int AS id, pp.name, to_json(pp.roles) AS roles, pp.active, pp.user_id::int AS user_id, pp.phone, pp.notes, pp.source, pp.source_ref, pp.created_at, pp.updated_at`;

/* People come from the user accounts (owner, 14 Oct 2026; services/renovation/peopleSync.ts). Each read brings
   project_people in line with the accounts first, then offers only people linked to an active account; the
   rest stay for the names on old records. The one exception is site crew without a login (owner, 14 Oct 2026):
   people not linked to an account and carrying the site_crew role stay pickable as site task crew only (`crew`),
   kept in Project Maintenance. `linked` says whether a row follows an account (its name and on/off come from
   Users and roles, not from here). Before migration 0113 the list is the people master as it was. */
app.get("/people", requirePageAccess("projects.list"), async (c) => {
  const role = c.req.query("role") ?? "";
  if (role && !(PERSON_ROLES as readonly string[]).includes(role)) return c.json({ error: "role_invalid" }, 400);
  const active = c.req.query("active");
  const co = requireActiveCompanyId(c);
  let fromUsers = false;
  try {
    fromUsers = co.ok ? await syncPeopleFromUsers(db(c), co.companyId) : await staffViewReady(db(c));
  } catch (e) {
    // The list must still open (old records, pickers' current values) when the accounts cannot be read.
    console.error("[renovation] people sync failed", e);
  }
  const activeArg = active === "1" ? true : active === "0" ? false : null;
  const res = await db(c).prepare(
    fromUsers
      ? `SELECT ${PP_COLS}, s.position, s.department, (pp.pos_user_id IS NOT NULL AND pp.active) AS offered,
                  (pp.pos_user_id IS NOT NULL) AS linked, (pp.pos_user_id IS NULL AND pp.active AND 'site_crew' = ANY(pp.roles)) AS crew
           FROM project_people pp LEFT JOIN conts_staff s ON s.id = pp.pos_user_id
          WHERE true${coSql(c, "pp.company_id")} AND (? = '' OR ? = ANY(pp.roles)) AND (?::boolean IS NULL OR pp.active = ?::boolean)
          ORDER BY pp.active DESC, lower(pp.name)`
      : `SELECT ${PERSON_COLS}, NULL AS position, NULL AS department, active AS offered, false AS linked,
                (active AND 'site_crew' = ANY(roles)) AS crew FROM project_people
          WHERE true${coSql(c)} AND (? = '' OR ? = ANY(roles)) AND (?::boolean IS NULL OR active = ?::boolean)
          ORDER BY active DESC, lower(name)`,
  ).bind(role, role, activeArg, activeArg).all();
  return c.json({ data: res.results ?? [], roles: PERSON_ROLES, fromUsers });
});

/* Which projects and site tasks each person is crew on (owner, 16 Oct 2026: Project Maintenance shows it next to
   every crew member without a login). Open tasks first; archived projects left out. */
app.get("/crew-assignments", requirePageAccess("projects.list"), async (c) => {
  const res = await db(c).prepare(
    `SELECT a.person_id::int AS person_id, t.id::int AS task_id, t.label, t.state, t.planned_start::text AS planned_start,
            t.planned_end::text AS planned_end, p.id::int AS project_id, p.code AS project_code, p.name AS project_name
       FROM project_trade_task_assignees a
       JOIN project_trade_tasks t ON t.id = a.task_id
       JOIN projects p ON p.id = t.project_id AND p.archived_at IS NULL AND p.project_kind = 'renovation'
      WHERE true${coSql(c, "p.company_id")}
      ORDER BY a.person_id, (t.state IN ('done', 'skipped')), t.planned_start NULLS LAST, p.name, t.seq`,
  ).bind().all();
  return c.json({ data: res.results ?? [] });
});

app.post("/people", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanPerson(await body(c));
  if (!v.ok) return c.json(v, 400);
  const p = v.value;
  const row = await db(c).prepare(
    `INSERT INTO project_people (company_id, name, roles, active, user_id, phone, notes) VALUES (?, ?, ?::text[], ?, ?, ?, ?) RETURNING id::int AS id`,
  ).bind(co.companyId, p.name, `{${(p.roles ?? []).join(",")}}`, p.active ?? true, p.userId ?? null, p.phone ?? null, p.notes ?? null).first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

app.patch("/people/:personId", requirePermission("projects.manage"), async (c) => {
  const id = parseId(c.req.param("personId"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const v = cleanPerson(await body(c), true);
  if (!v.ok) return c.json(v, 400);
  const p = v.value;
  // A person linked to a user account follows the account: change it in Users and roles.
  if (await staffViewReady(db(c))) {
    const linked = await db(c).prepare(`SELECT pos_user_id FROM project_people WHERE id = ?${coSql(c)}`).bind(id).first<{ pos_user_id: string | null }>();
    if (linked?.pos_user_id) return c.json({ error: "person_is_account", message: "This person is a user account. Change the name or switch it off in Property OS, Users and roles." }, 409);
  }
  const res = await db(c).prepare(
    `UPDATE project_people SET name = CASE WHEN ? THEN ? ELSE name END, roles = CASE WHEN ? THEN ?::text[] ELSE roles END,
            active = CASE WHEN ? THEN ? ELSE active END, user_id = CASE WHEN ? THEN ?::bigint ELSE user_id END,
            phone = CASE WHEN ? THEN ? ELSE phone END, notes = CASE WHEN ? THEN ? ELSE notes END, updated_at = now()
      WHERE id = ?${coSql(c)}`,
  ).bind("name" in p, p.name ?? null, "roles" in p, `{${(p.roles ?? []).join(",")}}`, "active" in p, p.active ?? true,
    "userId" in p, p.userId ?? null, "phone" in p, p.phone ?? null, "notes" in p, p.notes ?? null, id).run() as { meta?: { changes?: number } };
  if (!res.meta?.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── Flow steps and task categories (Project Maintenance) ────────────────

app.get("/flow-steps", requirePageAccess("projects.list"), async (c) => {
  const res = await db(c).prepare(
    `SELECT s.step_key, s.label, s.sort_order, s.active, (to_jsonb(s)->>'sla_days')::int AS sla_days
       FROM project_flow_steps s WHERE true${coSql(c, "s.company_id")} ORDER BY s.sort_order, s.step_key`,
  ).bind().all();
  return c.json({ data: res.results ?? [], keys: FLOW_STEP_KEYS, slaReady: await stepSlaReady(db(c)) });
});

/** Whole days 1-3650, or null (blank = no SLA); undefined when the value is not a valid number of days. */
function cleanSlaDays(v: unknown): number | null | undefined {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : undefined;
}

/* SLA per step (owner, 16 Oct 2026; migration 0121): the default days a project may stay in a step. A project copies
   it when it enters the step (services/renovation/stepSla.ts). Audited. */
app.put("/flow-steps/:key/sla", requirePermission("projects.manage"), async (c) => {
  const key = c.req.param("key");
  if (!isFlowStepKey(key) || key === "closed") return c.json({ error: "step_invalid", message: "Closed has no SLA." }, 400);
  if (!(await stepSlaReady(db(c)))) return c.json({ error: "sla_not_ready", message: "SLA needs a database update (migration 0121) that is not applied yet." }, 409);
  const days = cleanSlaDays((await body(c)).days);
  if (days === undefined) return c.json({ error: "days_invalid", message: "Days allowed is a whole number from 1 to 3650, or blank for no SLA." }, 400);
  const before = await db(c).prepare(`SELECT sla_days, label FROM project_flow_steps WHERE step_key = ?${coSql(c)}`).bind(key).first<{ sla_days: number | null; label: string }>();
  if (!before) return c.json({ error: "not_found" }, 404);
  await db(c).prepare(`UPDATE project_flow_steps SET sla_days = ?, updated_at = now() WHERE step_key = ?${coSql(c)}`).bind(days, key).run();
  await audit(c, {
    action: "project_step_sla.update", entityType: "project_flow_step", entityId: key,
    summary: `SLA for ${before.label}: ${before.sla_days ?? "none"} -> ${days ?? "none"} days`,
    meta: { before: before.sla_days ?? null, after: days },
  });
  return c.json({ ok: true, days });
});

app.patch("/flow-steps/:key", requirePermission("projects.manage"), async (c) => {
  const key = c.req.param("key");
  if (!isFlowStepKey(key)) return c.json({ error: "step_invalid" }, 400);
  const b = await body(c);
  const label = b.label === undefined ? null : String(b.label ?? "").trim();
  if (label === "") return c.json({ error: "label_required", message: "A step needs a label." }, 400);
  if (key === "design" && b.active === false) return c.json({ error: "design_always_on", message: "Design is where every project starts, so it cannot be switched off." }, 409);
  const sort = b.sortOrder === undefined ? null : Number(b.sortOrder);
  if (sort !== null && !Number.isInteger(sort)) return c.json({ error: "sort_invalid" }, 400);
  const res = await db(c).prepare(
    `UPDATE project_flow_steps SET label = coalesce(?, label), sort_order = coalesce(?, sort_order), active = coalesce(?, active), updated_at = now()
      WHERE step_key = ?${coSql(c)}`,
  ).bind(label, sort, typeof b.active === "boolean" ? b.active : null, key).run() as { meta?: { changes?: number } };
  if (!res.meta?.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.get("/task-categories", requirePageAccess("projects.list"), async (c) => {
  const res = await db(c).prepare(
    `SELECT code, label, stage_key, trade_code, fix_phase, internal_key, trade_default, sort_order, active, notion
       FROM project_task_categories WHERE true${coSql(c)} ORDER BY sort_order, code`,
  ).bind().all();
  return c.json({ data: res.results ?? [] });
});

app.patch("/task-categories/:code", requirePermission("projects.manage"), async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!taskCategoryDef(code)) return c.json({ error: "category_invalid" }, 400);
  const b = await body(c);
  const label = b.label === undefined ? null : String(b.label ?? "").trim();
  if (label === "") return c.json({ error: "label_required" }, 400);
  const sort = b.sortOrder === undefined ? null : Number(b.sortOrder);
  if (sort !== null && !Number.isInteger(sort)) return c.json({ error: "sort_invalid" }, 400);
  const res = await db(c).prepare(
    `UPDATE project_task_categories SET label = coalesce(?, label), sort_order = coalesce(?, sort_order), active = coalesce(?, active), updated_at = now()
      WHERE code = ?${coSql(c)}`,
  ).bind(label, sort, typeof b.active === "boolean" ? b.active : null, code).run() as { meta?: { changes?: number } };
  if (!res.meta?.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ── Key log and design records (read APIs) ──────────────────────────────

app.get("/key-log", requirePageAccess("projects.list"), async (c) => {
  const pid = c.req.query("projectId") ? parseId(c.req.query("projectId")) : null;
  if (c.req.query("projectId") && !pid) return c.json({ error: "invalid_id" }, 400);
  const res = await db(c).prepare(
    `SELECT km.id::int AS id, km.project_id::int AS project_id, p.code AS project_code, p.name AS project_name, km.moved_on::text AS moved_on,
            km.from_person_id::int AS from_person_id, fp.name AS from_person_name, km.to_person_id::int AS to_person_id, tp.name AS to_person_name,
            km.note, km.recorded_by::int AS recorded_by, u.name AS recorded_by_name, km.created_at, km.source, km.source_ref
       FROM project_key_moves km
       JOIN projects p ON p.id = km.project_id
       LEFT JOIN project_people fp ON fp.id = km.from_person_id
       LEFT JOIN project_people tp ON tp.id = km.to_person_id
       LEFT JOIN users u ON u.id = km.recorded_by
      WHERE (?::bigint IS NULL OR km.project_id = ?::bigint)${coSql(c, "p.company_id")}
      ORDER BY km.moved_on DESC, km.id DESC LIMIT 2000`,
  ).bind(pid, pid).all();
  return c.json({ data: res.results ?? [] });
});

app.get("/design-records", requirePageAccess("projects.list"), async (c) => {
  const pid = c.req.query("projectId") ? parseId(c.req.query("projectId")) : null;
  if (c.req.query("projectId") && !pid) return c.json({ error: "invalid_id" }, 400);
  const measures = await db(c).prepare(
    `SELECT r.id::int AS id, r.project_id::int AS project_id, r.kind, r.done_on::text AS done_on, r.person_id::int AS person_id, pp.name AS person_name,
            r.note, r.recorded_by::int AS recorded_by, r.created_at, r.source, r.source_ref,
            coalesce((SELECT json_agg(json_build_object('id', x.id::int, 'name', x.name) ORDER BY lower(x.name))
                        FROM project_design_record_people rp JOIN project_people x ON x.id = rp.person_id WHERE rp.record_id = r.id), '[]'::json) AS people,
            coalesce((SELECT json_agg(json_build_object('id', rf.id::int, 'file_name', rf.file_name, 'r2_key', rf.r2_key, 'content_type', rf.content_type) ORDER BY rf.id)
                        FROM project_design_record_files rf WHERE rf.record_id = r.id), '[]'::json) AS files
       FROM project_design_records r JOIN projects p ON p.id = r.project_id LEFT JOIN project_people pp ON pp.id = r.person_id
      WHERE (?::bigint IS NULL OR r.project_id = ?::bigint)${coSql(c, "p.company_id")}
      ORDER BY r.done_on DESC NULLS LAST, r.id DESC LIMIT 2000`,
  ).bind(pid, pid).all();
  const files = await db(c).prepare(
    `SELECT f.id::int AS id, f.project_id::int AS project_id, f.kind, f.version, f.file_name, f.content_type, f.size_bytes, f.r2_key, f.external_url,
            f.person_id::int AS person_id, pp.name AS person_name, f.uploaded_by::int AS uploaded_by, u.name AS uploaded_by_name, f.uploaded_at, f.note,
            f.submitted_on::text AS submitted_on, f.next_person_id::int AS next_person_id, np.name AS next_person_name, f.source, f.source_ref,
            coalesce((SELECT json_agg(json_build_object('id', x.id::int, 'name', x.name) ORDER BY lower(x.name))
                        FROM project_design_file_people fp JOIN project_people x ON x.id = fp.person_id WHERE fp.file_id = f.id), '[]'::json) AS people
       FROM project_design_files f JOIN projects p ON p.id = f.project_id
       LEFT JOIN project_people pp ON pp.id = f.person_id LEFT JOIN project_people np ON np.id = f.next_person_id
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE (?::bigint IS NULL OR f.project_id = ?::bigint)${coSql(c, "p.company_id")}
      ORDER BY f.project_id, f.kind, f.version DESC LIMIT 5000`,
  ).bind(pid, pid).all();
  const notes = await db(c).prepare(
    `SELECT n.id::int AS id, n.project_id::int AS project_id, n.kind, n.noted_on::text AS noted_on, n.requested_by_person_id::int AS requested_by_person_id,
            pp.name AS requested_by_person_name, n.requested_by_text, n.note, n.created_at, u.name AS created_by_name,
            n.closed_by_file_id::int AS closed_by_file_id, n.closed_at
       FROM project_design_notes n JOIN projects p ON p.id = n.project_id
       LEFT JOIN project_people pp ON pp.id = n.requested_by_person_id LEFT JOIN users u ON u.id = n.created_by
      WHERE (?::bigint IS NULL OR n.project_id = ?::bigint)${coSql(c, "p.company_id")}
      ORDER BY n.project_id, n.noted_on DESC, n.id DESC LIMIT 5000`,
  ).bind(pid, pid).all();
  return c.json({ measures: measures.results ?? [], files: files.results ?? [], notes: notes.results ?? [] });
});

// ── SO side: projects an SO can link to, SOs a project can link ─────────

app.get("/linkable-sos", requirePageAccess("projects.list"), async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const res = await db(c).prepare(
    /* Owner 14 Oct 2026: an SO raised on the sales order form (STANDARD) links the same way as a renovation
       contract. Its building is the copy migration 0112 adds, read through to_jsonb so this list still works
       before that migration is applied. */
    `SELECT o.doc_no, o.so_date::text AS so_date, o.debtor_name, o.status::text AS status, o.local_total_sen, o.so_kind,
            coalesce(c.building, to_jsonb(o)->>'building') AS building, coalesce(c.unit_no, to_jsonb(o)->>'unit_no') AS unit_no
       FROM scm.mfg_sales_orders o LEFT JOIN scm.reno_so_contracts c ON c.so_doc_no = o.doc_no
      WHERE o.so_kind IN ('RENOVATION', 'STANDARD') AND o.status::text <> 'CANCELLED' AND o.project_id IS NULL${coSql(c, "o.company_id")}
        AND (? = '' OR o.doc_no ILIKE '%' || ? || '%' OR coalesce(o.debtor_name, '') ILIKE '%' || ? || '%'
             OR coalesce(c.building, to_jsonb(o)->>'building', '') ILIKE '%' || ? || '%')
      ORDER BY o.so_date DESC NULLS LAST, o.doc_no DESC LIMIT 50`,
  ).bind(q, q, q, q).all();
  return c.json({ data: res.results ?? [] });
});

app.post("/from-so", requirePermission("projects.write"), failClosed(async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = await body(c);
  const docNo = String(b.docNo ?? "").trim();
  const typeId = parseId(String(b.projectTypeId ?? ""));
  if (!docNo || !typeId) return c.json({ error: "doc_and_type_required", message: "Pick the sales order and the project type." }, 400);
  const salesPersonId = b.salesPersonId == null || b.salesPersonId === "" ? null : parseId(String(b.salesPersonId));
  if (await peopleRefusal(c, co.companyId, [salesPersonId])) return c.json({ error: "person_not_found" }, 400);
  const r = await createProjectFromSo(db(c), docNo, { projectTypeId: typeId, name: b.name ? String(b.name) : null, salesPersonId }, userId(c), co.companyId, coSql(c, "p.company_id"));
  if (!r.ok) return c.json({ error: r.error, message: r.message }, r.status);
  return c.json({ id: r.projectId, code: r.code, docNo: r.docNo }, 201);
}));

app.post("/link-so", requirePermission("projects.write"), failClosed(async (c) => {
  const b = await body(c);
  const pid = parseId(String(b.projectId ?? ""));
  const docNo = String(b.docNo ?? "").trim();
  if (!pid || !docNo) return c.json({ error: "project_and_doc_required" }, 400);
  const r = await linkSoToProject(db(c), pid, docNo, userId(c), coSql(c, "p.company_id"));
  if (!r.ok) return c.json({ error: r.error, message: r.message }, r.status);
  return c.json({ ok: true, docNo: r.docNo });
}));

// ── One project ─────────────────────────────────────────────────────────

app.get("/:id/step", requirePageAccess("projects.list"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const [one] = await loadViews(c, { projectId: id, includeArchived: true });
  if (!one) return c.json({ error: "not_found" }, 404);
  const { f, v } = one;
  const history = await db(c).prepare(
    `SELECT l.id::int AS id, l.kind, l.from_value, l.to_value, l.reason, l.user_id::int AS user_id, u.name AS user_name,
            l.person_id::int AS person_id, pp.name AS person_name, l.at, l.source, l.source_ref
       FROM project_flow_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN project_people pp ON pp.id = l.person_id
      WHERE l.project_id = ? ORDER BY l.at DESC, l.id DESC LIMIT 200`,
  ).bind(id).all();
  return c.json({
    projectId: id,
    ...v.flow,
    manual: v.flow.manualStep ? { step: v.flow.manualStep, base: f.project.flow_manual_base_step ?? null, reason: f.project.flow_manual_reason ?? null,
      by: f.project.flow_manual_by ?? null, at: f.project.flow_manual_at ?? null, inEffect: v.flow.manualInEffect } : null,
    hold: v.hold,
    history: history.results ?? [],
  });
}));

app.post("/:id/step", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const v = cleanManualStep(await body(c));
  if (!v.ok) return c.json(v, 400);
  const [one] = await loadViews(c, { projectId: id, includeArchived: true });
  if (!one) return c.json({ error: "not_found" }, 404);
  if (!one.v.flow.steps.some((s) => s.key === v.value.step)) return c.json({ error: "step_inactive", message: "That step is switched off in Project Maintenance." }, 409);
  const co = Number(one.f.project.company_id);
  await db(c).batch!([
    db(c).prepare(
      `UPDATE projects SET flow_manual_step = ?, flow_manual_base_step = ?, flow_manual_reason = ?, flow_manual_by = ?, flow_manual_at = now(),
              updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`,
    ).bind(v.value.step, one.v.flow.derived, v.value.reason, userId(c), id),
    db(c).prepare(`INSERT INTO project_flow_log (project_id, company_id, kind, from_value, to_value, reason, user_id) VALUES (?, ?, 'manual_step', ?, ?, ?, ?)`)
      .bind(id, co, one.v.flow.current, v.value.step, v.value.reason, userId(c)),
  ]);
  await resyncDates(c, id);
  return c.json({ ok: true });
}));

app.post("/:id/step/follow-data", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const [one] = await loadViews(c, { projectId: id, includeArchived: true });
  if (!one) return c.json({ error: "not_found" }, 404);
  if (!one.f.project.flow_manual_step) return c.json({ ok: true, unchanged: true });
  await db(c).batch!([
    db(c).prepare(
      `UPDATE projects SET flow_manual_step = NULL, flow_manual_base_step = NULL, flow_manual_reason = NULL, flow_manual_by = NULL, flow_manual_at = NULL,
              updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`,
    ).bind(id),
    db(c).prepare(`INSERT INTO project_flow_log (project_id, company_id, kind, from_value, to_value, user_id) VALUES (?, ?, 'follow_data', ?, ?, ?)`)
      .bind(id, Number(one.f.project.company_id), one.v.flow.current, one.v.flow.derived, userId(c)),
  ]);
  await resyncDates(c, id);
  return c.json({ ok: true });
}));

app.post("/:id/hold", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanHold(await body(c));
  if (!v.ok) return c.json(v, 400);
  await db(c).batch!([
    db(c).prepare(`UPDATE projects SET hold_flag = ?, hold_note = ?, hold_by = ?, hold_at = now() WHERE id = ?`).bind(v.value.flag, v.value.note, userId(c), id),
    db(c).prepare(`INSERT INTO project_flow_log (project_id, company_id, kind, to_value, reason, user_id) VALUES (?, ?, 'hold_set', ?, ?, ?)`)
      .bind(id, co, v.value.flag, v.value.note, userId(c)),
  ]);
  return c.json({ ok: true });
});

app.post("/:id/hold/clear", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const cur = await db(c).prepare(`SELECT hold_flag FROM projects WHERE id = ?`).bind(id).first<{ hold_flag: string | null }>();
  if (!cur?.hold_flag) return c.json({ ok: true, unchanged: true });
  const note = String((await body(c)).note ?? "").trim() || null;
  await db(c).batch!([
    db(c).prepare(`UPDATE projects SET hold_flag = NULL, hold_note = NULL, hold_by = NULL, hold_at = NULL WHERE id = ?`).bind(id),
    db(c).prepare(`INSERT INTO project_flow_log (project_id, company_id, kind, from_value, reason, user_id) VALUES (?, ?, 'hold_cleared', ?, ?, ?)`)
      .bind(id, co, cur.hold_flag, note, userId(c)),
  ]);
  return c.json({ ok: true });
});

/* A project's own SLA for one of its steps (owner, 16 Oct 2026): blank puts the step back on the default. Written to
   the project's activity, so it shows on its Timeline. */
app.put("/:id/step-sla/:key", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  const key = c.req.param("key");
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!isFlowStepKey(key) || key === "closed") return c.json({ error: "step_invalid", message: "Closed has no SLA." }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  if (!(await stepSlaReady(db(c)))) return c.json({ error: "sla_not_ready", message: "SLA needs a database update (migration 0121) that is not applied yet." }, 409);
  const b = await body(c);
  const useDefault = b.useDefault === true;
  const days = useDefault ? null : cleanSlaDays(b.days);
  if (days === undefined) return c.json({ error: "days_invalid", message: "Days allowed is a whole number from 1 to 3650, or blank for no SLA." }, 400);
  const prev = await db(c).prepare(
    `SELECT s.sla_days, s.sla_source, fs.sla_days AS default_days, fs.label FROM project_flow_steps fs
       LEFT JOIN project_step_sla s ON s.project_id = ? AND s.step_key = fs.step_key
      WHERE fs.company_id = ? AND fs.step_key = ?`,
  ).bind(id, co, key).first<{ sla_days: number | null; sla_source: string | null; default_days: number | null; label: string }>();
  const fromDays = prev?.sla_source ? prev.sla_days : prev?.default_days ?? null;
  const toDays = useDefault ? prev?.default_days ?? null : days;
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_step_sla (project_id, company_id, step_key, sla_days, sla_source, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, step_key) DO UPDATE SET sla_days = excluded.sla_days, sla_source = excluded.sla_source,
         updated_by = excluded.updated_by, updated_at = now()`,
    ).bind(id, co, key, toDays, useDefault ? (toDays == null ? null : "default") : "project", userId(c)),
    db(c).prepare(
      `INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, 'sla_changed', ?, ?, ?, ?, ?)`,
    ).bind(id, fromDays == null ? "no SLA" : `${fromDays} days`, toDays == null ? "no SLA" : `${toDays} days`,
      `SLA for ${prev?.label ?? key}${useDefault ? " (back to the default)" : ""}`, userId(c), co),
  ]);
  return c.json({ ok: true, days: toDays });
});

app.patch("/:id/people", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const b = await body(c);
  // picPersonId is the Project PIC (owner, 14 Oct 2026), stored in reno_pic_person_id like renoPicPersonId.
  const cols: Record<string, string> = { salesPersonId: "sales_person_id", designerPersonId: "designer_person_id", renoPicPersonId: "reno_pic_person_id", picPersonId: "reno_pic_person_id" };
  const sets: string[] = [];
  const args: unknown[] = [];
  const ids: Array<number | null> = [];
  const audit: Array<{ action: string; col: string; to: number | null }> = [];
  for (const [k, col] of Object.entries(cols)) {
    if (!(k in b)) continue;
    const val = b[k] == null || b[k] === "" ? null : parseId(String(b[k]));
    if (b[k] != null && b[k] !== "" && val === null) return c.json({ error: "person_invalid" }, 400);
    if (sets.includes(`${col} = ?`)) continue;
    sets.push(`${col} = ?`);
    args.push(val);
    ids.push(val);
    audit.push({ action: `${col.replace(/_person_id$/, "")}_changed`, col, to: val });
  }
  let attending: number[] | null = null;
  if ("attendingPersonIds" in b) {
    const a = cleanAttending(b);
    if (!a.ok) return c.json(a, 400);
    attending = a.value;
    ids.push(...attending);
  }
  if (sets.length === 0 && attending === null) return c.json({ ok: true });
  if (await peopleRefusal(c, co, ids)) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  const nameOf = `(SELECT name FROM project_people WHERE id = ?)`;
  const stmts = [];
  for (const a of audit) {
    stmts.push(db(c).prepare(
      `INSERT INTO project_activity (project_id, action, from_value, to_value, user_id, company_id)
       SELECT ?, ?, (SELECT pp.name FROM projects p JOIN project_people pp ON pp.id = p.${a.col} WHERE p.id = ?), ${nameOf}, ?, ?`,
    ).bind(id, a.action, id, a.to, userId(c), co));
  }
  if (sets.length) {
    stmts.push(db(c).prepare(`UPDATE projects SET ${sets.join(", ")}, updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`)
      .bind(...args, id));
  }
  if (attending !== null) {
    const list = JSON.stringify(attending.map(String));
    stmts.push(
      db(c).prepare(
        `INSERT INTO project_activity (project_id, action, from_value, to_value, user_id, company_id)
         SELECT ?, 'attending_changed',
                (SELECT string_agg(pp.name, ', ' ORDER BY lower(pp.name)) FROM project_attendees a JOIN project_people pp ON pp.id = a.person_id WHERE a.project_id = ?),
                (SELECT string_agg(pp.name, ', ' ORDER BY lower(pp.name)) FROM project_people pp WHERE pp.id::text IN (SELECT jsonb_array_elements_text(?::text::jsonb))),
                ?, ?`,
      ).bind(id, id, list, userId(c), co),
      db(c).prepare(`DELETE FROM project_attendees WHERE project_id = ? AND person_id::text NOT IN (SELECT jsonb_array_elements_text(?::text::jsonb))`).bind(id, list),
      db(c).prepare(
        `INSERT INTO project_attendees (project_id, person_id, created_by)
         SELECT ?, (x)::bigint, ? FROM jsonb_array_elements_text(?::text::jsonb) AS x ON CONFLICT (project_id, person_id) DO NOTHING`,
      ).bind(id, userId(c), list),
    );
  }
  await db(c).batch!(stmts);
  return c.json({ ok: true });
});

app.post("/:id/key-moves", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanKeyMove(await body(c), todayMyt());
  if (!v.ok) return c.json(v, 400);
  if (await peopleRefusal(c, co, [v.value.fromPersonId, v.value.toPersonId])) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  const row = await db(c).prepare(
    `INSERT INTO project_key_moves (project_id, company_id, moved_on, from_person_id, to_person_id, note, recorded_by)
     VALUES (?, ?, ?::date, ?, ?, ?, ?) RETURNING id::int AS id`,
  ).bind(id, co, v.value.movedOn, v.value.fromPersonId, v.value.toPersonId, v.value.note, userId(c)).first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

async function keyMoveOf(c: Ctx, moveId: number) {
  return db(c).prepare(
    `SELECT km.id::int AS id, km.project_id::int AS project_id, km.company_id::int AS company_id, km.moved_on::text AS moved_on,
            fp.name AS from_name, tp.name AS to_name
       FROM project_key_moves km JOIN projects p ON p.id = km.project_id
       LEFT JOIN project_people fp ON fp.id = km.from_person_id LEFT JOIN project_people tp ON tp.id = km.to_person_id
      WHERE km.id = ?${coSql(c, "p.company_id")}`,
  ).bind(moveId).first<{ id: number; project_id: number; company_id: number; moved_on: string; from_name: string | null; to_name: string | null }>();
}
const keyMoveText = (on: string, from: string | null, to: string | null) => `${on}: ${from ?? "-"} to ${to ?? "-"}`;

app.patch("/key-moves/:moveId", requirePermission("projects.write"), async (c) => {
  const moveId = parseId(c.req.param("moveId"));
  if (!moveId) return c.json({ error: "invalid_id" }, 400);
  const m = await keyMoveOf(c, moveId);
  if (!m) return c.json({ error: "not_found" }, 404);
  const v = cleanKeyMove(await body(c), todayMyt());
  if (!v.ok) return c.json(v, 400);
  if (await peopleRefusal(c, m.company_id, [v.value.fromPersonId, v.value.toPersonId])) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_activity (project_id, action, from_value, to_value, user_id, company_id)
       SELECT ?, 'key_move_edited', ?, ? || ': ' || coalesce((SELECT name FROM project_people WHERE id = ?), '-') || ' to '
              || coalesce((SELECT name FROM project_people WHERE id = ?), '-'), ?, ?`,
    ).bind(m.project_id, keyMoveText(m.moved_on, m.from_name, m.to_name), v.value.movedOn, v.value.fromPersonId, v.value.toPersonId, userId(c), m.company_id),
    db(c).prepare(`UPDATE project_key_moves SET moved_on = ?::date, from_person_id = ?, to_person_id = ?, note = ? WHERE id = ?`)
      .bind(v.value.movedOn, v.value.fromPersonId, v.value.toPersonId, v.value.note, moveId),
  ]);
  return c.json({ ok: true });
});

app.delete("/key-moves/:moveId", requirePermission("projects.write"), async (c) => {
  const moveId = parseId(c.req.param("moveId"));
  if (!moveId) return c.json({ error: "invalid_id" }, 400);
  const m = await keyMoveOf(c, moveId);
  if (!m) return c.json({ error: "not_found" }, 404);
  await db(c).batch!([
    db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, user_id, company_id) VALUES (?, 'key_move_deleted', ?, ?, ?)`)
      .bind(m.project_id, keyMoveText(m.moved_on, m.from_name, m.to_name), userId(c), m.company_id),
    db(c).prepare(`DELETE FROM project_key_moves WHERE id = ?`).bind(moveId),
  ]);
  return c.json({ ok: true });
});

/** The several PICs of an Onsite entry or a design submission (migration 0114); person_id keeps the first. */
function peopleInsert(c: Ctx, table: "project_design_record_people" | "project_design_file_people", col: "record_id" | "file_id", rowId: number, ids: number[]) {
  return db(c).prepare(
    `INSERT INTO ${table} (${col}, person_id) SELECT ?::bigint, (x)::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS x ON CONFLICT DO NOTHING`,
  ).bind(rowId, JSON.stringify(ids.map(String)));
}

/** The first 2D version, in the order the Design card numbers them (submit date, then upload). */
const FIRST_2D_FILE_SQL = `(SELECT f1.id FROM project_design_files f1 WHERE f1.project_id = ? AND f1.kind = '2d'
                             ORDER BY coalesce(f1.submitted_on, f1.uploaded_at::date), f1.uploaded_at, f1.id LIMIT 1)`;

/**
 * After a design version is saved: its PICs, and (a 2D amended version) every 2D amendment request still open,
 * which it answers. V1 is the first submission, never an answer to a request (owner, 15 Oct 2026), so nothing
 * closes while the project has a single 2D version; a request V1 was once recorded as closing counts as open.
 */
async function afterDesignFile(c: Ctx, projectId: number, kind: string, fileId: number, personIds: number[]) {
  const stmts = [];
  if (personIds.length) stmts.push(peopleInsert(c, "project_design_file_people", "file_id", fileId, personIds));
  if (kind === "2d") {
    stmts.push(db(c).prepare(
      `UPDATE project_design_notes SET closed_by_file_id = ?, closed_at = now()
        WHERE project_id = ? AND kind = '2d'
          AND (closed_by_file_id IS NULL OR closed_by_file_id = ${FIRST_2D_FILE_SQL})
          AND ? <> ${FIRST_2D_FILE_SQL}`,
    ).bind(fileId, projectId, projectId, fileId, projectId));
  }
  if (stmts.length) await db(c).batch!(stmts);
}

app.post("/:id/site-measures", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanSiteMeasure(await body(c));
  if (!v.ok) return c.json(v, 400);
  if (await peopleRefusal(c, co, v.value.personIds)) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  const row = await db(c).prepare(
    `INSERT INTO project_design_records (project_id, company_id, kind, done_on, person_id, note, recorded_by)
     VALUES (?, ?, 'site_measure', ?::date, ?, ?, ?) RETURNING id::int AS id`,
  ).bind(id, co, v.value.doneOn, v.value.personId, v.value.note, userId(c)).first<{ id: number }>();
  if (row && v.value.personIds.length) await peopleInsert(c, "project_design_record_people", "record_id", row.id, v.value.personIds).run();
  return c.json({ id: row?.id }, 201);
});

/* One photo or file on an Onsite entry: raw body, ?fileName=. Same types and size limit as design files. */
app.post("/:id/site-measures/:recordId/files", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  const recordId = parseId(c.req.param("recordId"));
  if (!id || !recordId) return c.json({ error: "invalid_id" }, 400);
  if ((await projectCompany(c, id)) == null) return c.json({ error: "not_found" }, 404);
  const rec = await db(c).prepare(`SELECT id FROM project_design_records WHERE id = ? AND project_id = ?`).bind(recordId, id).first();
  if (!rec) return c.json({ error: "not_found" }, 404);
  const type = (c.req.header("content-type") || "").split(";")[0]!.trim().toLowerCase();
  const ext = DESIGN_FILE_TYPES[type];
  if (!ext) return c.json({ error: "unsupported_type", message: "PDF, image, DWG or ZIP files only." }, 415);
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) return c.json({ error: "empty" }, 400);
  if (buf.byteLength > DESIGN_FILE_MAX) return c.json({ error: "too_large", message: "A file can be up to 25 MB." }, 413);
  const fileName = (c.req.query("fileName") ?? "").trim().slice(0, 200) || `onsite.${ext}`;
  const key = `renovation/${id}/onsite-${recordId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await c.env.POD_BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
  const row = await db(c).prepare(
    `INSERT INTO project_design_record_files (record_id, project_id, file_name, content_type, size_bytes, r2_key, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id::int AS id`,
  ).bind(recordId, id, fileName, type, buf.byteLength, key, userId(c)).first<{ id: number }>();
  return c.json({ id: row?.id, key }, 201);
});

/* Upload one design file: raw body, ?kind=2d|3d|other&fileName=&personId=&note=. Versions count up per kind. */
app.post("/:id/design-files", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const kind = cleanDesignKind(c.req.query("kind"));
  if (!kind) return c.json({ error: "kind_invalid", message: "Say whether this is a 2D, 3D or other file." }, 400);
  const type = (c.req.header("content-type") || "").split(";")[0]!.trim().toLowerCase();
  const ext = DESIGN_FILE_TYPES[type];
  if (!ext) return c.json({ error: "unsupported_type", message: "PDF, image, DWG or ZIP files only." }, 415);
  const rawIds = (c.req.query("personIds") ?? c.req.query("personId") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const maybeIds = [...new Set(rawIds.map((x) => parseId(x)))];
  if (maybeIds.some((x) => x === null)) return c.json({ error: "person_invalid" }, 400);
  const personIds = maybeIds.filter((x): x is number => x !== null);
  const personId = personIds[0] ?? null;
  const nextPersonId = kind === "3d" && c.req.query("nextPersonId") ? parseId(c.req.query("nextPersonId")) : null;
  if (kind === "3d" && c.req.query("nextPersonId") && !nextPersonId) return c.json({ error: "person_invalid" }, 400);
  if (await peopleRefusal(c, co, [...personIds, nextPersonId])) return c.json({ error: "person_not_found" }, 400);
  const submittedOn = c.req.query("submittedOn") || todayMyt();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(submittedOn) || submittedOn > todayMyt()) return c.json({ error: "date_invalid", message: "Give a submit date that is not ahead of today." }, 400);
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) return c.json({ error: "empty" }, 400);
  if (buf.byteLength > DESIGN_FILE_MAX) return c.json({ error: "too_large", message: "A design file can be up to 25 MB." }, 413);
  const fileName = (c.req.query("fileName") ?? "").trim().slice(0, 200) || `${kind}.${ext}`;
  const key = `renovation/${id}/design-${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await c.env.POD_BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
  const row = await db(c).prepare(
    `INSERT INTO project_design_files (project_id, company_id, kind, version, file_name, content_type, size_bytes, r2_key, person_id, uploaded_by, note,
                                      submitted_on, next_person_id)
     SELECT ?, ?, ?, coalesce(max(version), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?::date, ? FROM project_design_files WHERE project_id = ? AND kind = ?
     RETURNING id::int AS id, version`,
  ).bind(id, co, kind, fileName, type, buf.byteLength, key, personId, userId(c), (c.req.query("note") ?? "").trim() || null, submittedOn, nextPersonId, id, kind)
    .first<{ id: number; version: number }>();
  if (row) await afterDesignFile(c, id, kind, row.id, personIds);
  return c.json({ id: row?.id, version: row?.version, key }, 201);
});

/* A design submission given as a link (3D always; 2D may be a link or an upload). Versions count up per kind like uploads. */
app.post("/:id/design-links", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanDesignLink(await body(c), todayMyt());
  if (!v.ok) return c.json(v, 400);
  const d = v.value;
  if (await peopleRefusal(c, co, [...d.personIds, d.nextPersonId])) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  const name = d.name ?? d.url.replace(/^https?:\/\//i, "").slice(0, 200);
  const row = await db(c).prepare(
    `INSERT INTO project_design_files (project_id, company_id, kind, version, file_name, external_url, person_id, uploaded_by, note, submitted_on, next_person_id)
     SELECT ?, ?, ?, coalesce(max(version), 0) + 1, ?, ?, ?, ?, ?, ?::date, ? FROM project_design_files WHERE project_id = ? AND kind = ?
     RETURNING id::int AS id, version`,
  ).bind(id, co, d.kind, name, d.url, d.personId, userId(c), d.note, d.submittedOn, d.nextPersonId, id, d.kind).first<{ id: number; version: number }>();
  if (row) await afterDesignFile(c, id, d.kind, row.id, d.personIds);
  return c.json({ id: row?.id, version: row?.version }, 201);
});

/* Edit a design version (owner, 14 Oct 2026): its PICs (e.g. on an imported v1 that has none), 2D PIC, submit
   date, note, and the link of a link submission. The file itself and its version number do not change. */
app.patch("/design-files/:fileId", requirePermission("projects.write"), async (c) => {
  const fileId = parseId(c.req.param("fileId"));
  if (!fileId) return c.json({ error: "invalid_id" }, 400);
  const f = await db(c).prepare(
    `SELECT f.id::int AS id, f.project_id::int AS project_id, p.company_id::int AS company_id, f.kind, f.version, f.external_url
       FROM project_design_files f JOIN projects p ON p.id = f.project_id WHERE f.id = ?${coSql(c, "p.company_id")}`,
  ).bind(fileId).first<{ id: number; project_id: number; company_id: number; kind: string; version: number; external_url: string | null }>();
  if (!f) return c.json({ error: "not_found" }, 404);
  const v = cleanDesignFilePatch(await body(c), todayMyt());
  if (!v.ok) return c.json(v, 400);
  const e = v.value;
  if (e.url !== undefined && !f.external_url) return c.json({ error: "not_a_link", message: "This version is an uploaded file; upload a new version instead." }, 409);
  if (await peopleRefusal(c, f.company_id, [...(e.personIds ?? []), e.nextPersonId])) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  const stmts = [
    db(c).prepare(
      `UPDATE project_design_files
          SET person_id = CASE WHEN ? THEN ?::bigint ELSE person_id END,
              next_person_id = CASE WHEN ? THEN ?::bigint ELSE next_person_id END,
              submitted_on = CASE WHEN ? THEN ?::date ELSE submitted_on END,
              external_url = CASE WHEN ? THEN ? ELSE external_url END,
              file_name = CASE WHEN ? THEN ? ELSE file_name END,
              note = CASE WHEN ? THEN ? ELSE note END
        WHERE id = ?`,
    ).bind(e.personIds !== undefined, e.personId ?? null, e.nextPersonId !== undefined, e.nextPersonId ?? null,
      e.submittedOn !== undefined, e.submittedOn ?? null, e.url !== undefined, e.url ?? null,
      e.url !== undefined, (e.url ?? "").replace(/^https?:\/\//i, "").slice(0, 200), e.note !== undefined, e.note ?? null, fileId),
    db(c).prepare(`INSERT INTO project_activity (project_id, action, to_value, user_id, company_id) VALUES (?, 'design_version_edited', ?, ?, ?)`)
      .bind(f.project_id, `${f.kind} v${f.version}`, userId(c), f.company_id),
  ];
  if (e.personIds !== undefined) {
    stmts.push(db(c).prepare(`DELETE FROM project_design_file_people WHERE file_id = ?`).bind(fileId));
    if (e.personIds.length) stmts.push(peopleInsert(c, "project_design_file_people", "file_id", fileId, e.personIds));
  }
  await db(c).batch!(stmts);
  return c.json({ ok: true });
});

/* Attach the file to a design version that so far is only a link (an imported Notion PDF): raw body, streamed to R2.
   Only a version without a file; the version number, date and people stay. */
app.put("/design-files/:fileId/file", requirePermission("projects.write"), async (c) => {
  const fileId = parseId(c.req.param("fileId"));
  if (!fileId) return c.json({ error: "invalid_id" }, 400);
  const f = await db(c).prepare(
    `SELECT f.id::int AS id, f.project_id::int AS project_id, p.company_id::int AS company_id, f.kind, f.version, f.r2_key
       FROM project_design_files f JOIN projects p ON p.id = f.project_id WHERE f.id = ?${coSql(c, "p.company_id")}`,
  ).bind(fileId).first<{ id: number; project_id: number; company_id: number; kind: string; version: number; r2_key: string | null }>();
  if (!f) return c.json({ error: "not_found" }, 404);
  if (f.r2_key) return c.json({ error: "has_file", message: "This version already has its file; upload a new version instead." }, 409);
  const refusal = designAttachRefusal(c.req.header("content-type"), c.req.header("content-length"));
  if (refusal) return c.json({ error: refusal.error, message: refusal.message }, refusal.status);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty", message: "The file is empty." }, 400);
  const type = c.req.header("content-type")!.split(";")[0]!.trim().toLowerCase();
  const size = Number(c.req.header("content-length"));
  const key = `renovation/${f.project_id}/design-${f.kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${DESIGN_FILE_TYPES[type]}`;
  await c.env.POD_BUCKET.put(key, body, { httpMetadata: { contentType: type } });
  const row = await db(c).prepare(
    `UPDATE project_design_files SET r2_key = ?, content_type = ?, size_bytes = ?, external_url = NULL
      WHERE id = ? AND r2_key IS NULL RETURNING id::int AS id`,
  ).bind(key, type, size, fileId).first<{ id: number }>();
  if (!row) {
    // another upload got there first: keep its file, drop ours
    await c.env.POD_BUCKET.delete(key);
    return c.json({ error: "has_file", message: "This version already has its file." }, 409);
  }
  await db(c).prepare(`INSERT INTO project_activity (project_id, action, to_value, user_id, company_id) VALUES (?, 'design_file_attached', ?, ?, ?)`)
    .bind(f.project_id, `${f.kind} v${f.version}`, userId(c), f.company_id).run();
  return c.json({ id: fileId, key }, 201);
});

/* Edit an Onsite entry: date, PICs and remark. */
app.patch("/site-measures/:recordId", requirePermission("projects.write"), async (c) => {
  const recordId = parseId(c.req.param("recordId"));
  if (!recordId) return c.json({ error: "invalid_id" }, 400);
  const r = await db(c).prepare(
    `SELECT r.id::int AS id, r.project_id::int AS project_id, p.company_id::int AS company_id
       FROM project_design_records r JOIN projects p ON p.id = r.project_id WHERE r.id = ?${coSql(c, "p.company_id")}`,
  ).bind(recordId).first<{ id: number; project_id: number; company_id: number }>();
  if (!r) return c.json({ error: "not_found" }, 404);
  const v = cleanSiteMeasure(await body(c));
  if (!v.ok) return c.json(v, 400);
  if (await peopleRefusal(c, r.company_id, v.value.personIds)) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  const stmts = [
    db(c).prepare(`UPDATE project_design_records SET done_on = ?::date, person_id = ?, note = ? WHERE id = ?`).bind(v.value.doneOn, v.value.personId, v.value.note, recordId),
    db(c).prepare(`DELETE FROM project_design_record_people WHERE record_id = ?`).bind(recordId),
    db(c).prepare(`INSERT INTO project_activity (project_id, action, to_value, user_id, company_id) VALUES (?, 'onsite_edited', ?, ?, ?)`)
      .bind(r.project_id, v.value.doneOn, userId(c), r.company_id),
  ];
  if (v.value.personIds.length) stmts.push(peopleInsert(c, "project_design_record_people", "record_id", recordId, v.value.personIds));
  await db(c).batch!(stmts);
  return c.json({ ok: true });
});

app.post("/:id/design-notes", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanDesignNote(await body(c), todayMyt());
  if (!v.ok) return c.json(v, 400);
  const n = v.value;
  if (await peopleRefusal(c, co, [n.requestedByPersonId])) return c.json({ error: "person_not_found", message: "Pick the person from the list." }, 400);
  const row = await db(c).prepare(
    `INSERT INTO project_design_notes (project_id, company_id, kind, noted_on, requested_by_person_id, requested_by_text, note, created_by)
     VALUES (?, ?, ?, ?::date, ?, ?, ?, ?) RETURNING id::int AS id`,
  ).bind(id, co, n.kind, n.notedOn, n.requestedByPersonId, n.requestedByText, n.note, userId(c)).first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

// ── Procurement details: PO and delivery dates per catalog category / sub-category ──

async function procurementOf(c: Ctx, id: number) {
  const [groups, subs, rows] = await Promise.all([
    db(c).prepare(`SELECT code, label, sort_order FROM scm.product_category_groups ORDER BY sort_order, code`).bind().all<GroupDefRow>(),
    db(c).prepare(`SELECT group_code, code, label, sort_order FROM scm.product_sub_categories WHERE active ORDER BY group_code, sort_order, code`).bind().all<SubDefRow>(),
    db(c).prepare(
      `SELECT group_code, sub_code, po_date::text AS po_date, delivery_date::text AS delivery_date, mode, updated_at::text AS updated_at, updated_by
         FROM project_procurement_dates WHERE project_id = ?`,
    ).bind(id).all<ProcRow>(),
  ]);
  return buildProcurementView(groups.results ?? [], subs.results ?? [], rows.results ?? []);
}

app.get("/:id/procurement", requirePageAccess("projects.list"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if ((await projectCompany(c, id)) == null) return c.json({ error: "not_found" }, 404);
  return c.json({ projectId: id, groups: await procurementOf(c, id) });
}));

app.put("/:id/procurement/:group", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const group = (c.req.param("group") ?? "").toUpperCase();
  const known = await db(c).prepare(`SELECT code FROM scm.product_category_groups WHERE code = ?`).bind(group).first();
  if (!known) return c.json({ error: "category_invalid", message: "That product category does not exist." }, 400);
  const v = cleanCategoryDates(await body(c));
  if (!v.ok) return c.json(v, 400);
  await db(c).batch!([
    db(c).prepare(
      `INSERT INTO project_procurement_dates (project_id, group_code, sub_code, po_date, delivery_date, mode, updated_at, updated_by)
       VALUES (?, ?, '', ?::date, ?::date, 'follow', now(), ?)
       ON CONFLICT (project_id, group_code, sub_code) DO UPDATE SET po_date = excluded.po_date, delivery_date = excluded.delivery_date,
         updated_at = now(), updated_by = excluded.updated_by`,
    ).bind(id, group, v.value.poDate, v.value.deliveryDate, userName(c)),
    db(c).prepare(`INSERT INTO project_activity (project_id, action, to_value, note, user_id, company_id) VALUES (?, 'procurement_dates', ?, ?, ?, ?)`)
      .bind(id, `PO ${v.value.poDate ?? "-"} / delivery ${v.value.deliveryDate ?? "-"}`, group, userId(c), co),
  ]);
  return c.json({ ok: true, groups: await procurementOf(c, id) });
}));

app.put("/:id/procurement/:group/:sub", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const group = (c.req.param("group") ?? "").toUpperCase();
  const sub = (c.req.param("sub") ?? "").toUpperCase();
  const known = await db(c).prepare(`SELECT code FROM scm.product_sub_categories WHERE group_code = ? AND code = ?`).bind(group, sub).first();
  if (!known) return c.json({ error: "sub_category_invalid", message: "That sub-category does not exist under this category." }, 400);
  const v = cleanSubDates(await body(c));
  if (!v.ok) return c.json(v, 400);
  const s = v.value;
  await db(c).batch!([
    s.mode === "follow"
      ? db(c).prepare(`DELETE FROM project_procurement_dates WHERE project_id = ? AND group_code = ? AND sub_code = ?`).bind(id, group, sub)
      : db(c).prepare(
        `INSERT INTO project_procurement_dates (project_id, group_code, sub_code, po_date, delivery_date, mode, updated_at, updated_by)
         VALUES (?, ?, ?, ?::date, ?::date, ?, now(), ?)
         ON CONFLICT (project_id, group_code, sub_code) DO UPDATE SET po_date = excluded.po_date, delivery_date = excluded.delivery_date,
           mode = excluded.mode, updated_at = now(), updated_by = excluded.updated_by`,
      ).bind(id, group, sub, s.poDate, s.deliveryDate, s.mode, userName(c)),
    db(c).prepare(`INSERT INTO project_activity (project_id, action, to_value, note, user_id, company_id) VALUES (?, 'procurement_dates', ?, ?, ?, ?)`)
      .bind(id, s.mode === "own" ? `own: PO ${s.poDate ?? "-"} / delivery ${s.deliveryDate ?? "-"}` : s.mode, `${group}/${sub}`, userId(c), co),
  ]);
  return c.json({ ok: true, groups: await procurementOf(c, id) });
}));

app.post("/:id/unlink-so", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const r = await unlinkSoFromProject(db(c), id, userId(c), coSql(c, "p.company_id"));
  if (!r.ok) return c.json({ error: r.error, message: r.message }, r.status);
  return c.json({ ok: true, docNo: r.docNo });
}));

// ── Site tasks: add by category, crew, fulfilment ───────────────────────

app.post("/:id/tasks", requirePermission("projects.write"), failClosed(async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const b = await body(c);
  const cat = taskCategoryDef(String(b.categoryCode ?? ""));
  if (!cat) return c.json({ error: "category_invalid", message: "Pick a task category." }, 400);
  const fulfilment = b.fulfilment === "po" ? "po" : "internal";
  const start = (b.plannedStart as string) || null;
  const end = (b.plannedEnd as string) || null;
  const dates = plannedDatesRefusal(start, end);
  if (dates) return c.json({ error: dates }, 400);
  const assignees = Array.isArray(b.assigneeIds) ? [...new Set(b.assigneeIds.map((x) => parseId(String(x))))] : [];
  if (assignees.some((x) => x === null)) return c.json({ error: "person_invalid" }, 400);
  if (await peopleRefusal(c, co, assignees)) return c.json({ error: "person_not_found", message: "Pick the crew from the people list." }, 400);
  const existing = await db(c).prepare(`SELECT trade_code, fix_phase, occurrence::int AS occurrence FROM project_trade_tasks WHERE project_id = ?`)
    .bind(id).all<{ trade_code: string; fix_phase: string; occurrence: number }>();
  const row = manualTaskRow(cat, existing.results ?? [], { fulfilment });
  const ins = await db(c).prepare(
    `INSERT INTO project_trade_tasks (project_id, stage_key, trade_code, fix_phase, label, seq, fulfilment_kind, company_id, category_code, occurrence,
                                      planned_start, planned_end, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::date, ?::date, ?) RETURNING id::int AS id`,
  ).bind(id, row.stageKey, row.tradeCode, row.fixPhase, row.label, row.seq, row.fulfilmentKind, co, row.categoryCode, row.occurrence,
    start, end, String(b.notes ?? "").trim() || null).first<{ id: number }>();
  if (assignees.length) {
    await db(c).prepare(
      `INSERT INTO project_trade_task_assignees (task_id, person_id, company_id)
       SELECT ?, (x)::bigint, ? FROM jsonb_array_elements_text(?::text::jsonb) AS x ON CONFLICT (task_id, person_id) DO NOTHING`,
    ).bind(ins?.id, co, JSON.stringify(assignees.map(String))).run();
  }
  await db(c).prepare(`INSERT INTO project_activity (project_id, action, to_value, user_id, company_id) VALUES (?, 'task_added', ?, ?, ?)`)
    .bind(id, row.label, userId(c), co).run();
  return c.json({ id: ins?.id, occurrence: row.occurrence }, 201);
}));

async function taskOf(c: Ctx, taskId: number) {
  return db(c).prepare(
    `SELECT t.id::int AS id, t.project_id::int AS project_id, t.company_id::int AS company_id, t.trade_code, t.fulfilment_kind, t.state, t.label,
            EXISTS (SELECT 1 FROM project_trade_task_lines l JOIN scm.purchase_order_items poi ON poi.id = l.purchase_order_item_id
                     WHERE l.task_id = t.id AND poi.received_qty > 0) AS po_received
       FROM project_trade_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?${coSql(c, "p.company_id")}`,
  ).bind(taskId).first<{ id: number; project_id: number; company_id: number; trade_code: string; fulfilment_kind: string; state: string; label: string; po_received: boolean }>();
}

app.put("/trade-tasks/:taskId/assignees", requirePermission("projects.write"), async (c) => {
  const taskId = parseId(c.req.param("taskId"));
  if (!taskId) return c.json({ error: "invalid_id" }, 400);
  const t = await taskOf(c, taskId);
  if (!t) return c.json({ error: "not_found" }, 404);
  const b = await body(c);
  const ids = Array.isArray(b.personIds) ? [...new Set(b.personIds.map((x) => parseId(String(x))))] : null;
  if (!ids || ids.some((x) => x === null)) return c.json({ error: "person_invalid" }, 400);
  if (await peopleRefusal(c, Number(t.company_id), ids)) return c.json({ error: "person_not_found", message: "Pick the crew from the people list." }, 400);
  const list = JSON.stringify(ids.map(String));
  await db(c).batch!([
    db(c).prepare(`DELETE FROM project_trade_task_assignees WHERE task_id = ? AND person_id::text NOT IN (SELECT jsonb_array_elements_text(?::text::jsonb))`).bind(taskId, list),
    db(c).prepare(
      `INSERT INTO project_trade_task_assignees (task_id, person_id, company_id)
       SELECT ?, (x)::bigint, ? FROM jsonb_array_elements_text(?::text::jsonb) AS x ON CONFLICT (task_id, person_id) DO NOTHING`,
    ).bind(taskId, Number(t.company_id), list),
  ]);
  return c.json({ ok: true });
});

/* po <-> in-house crew. In-house: no PO, no supplier; refused once a PO line of the task was received (the receipt completes it). */
app.post("/trade-tasks/:taskId/fulfilment", requirePermission("projects.write"), async (c) => {
  const taskId = parseId(c.req.param("taskId"));
  if (!taskId) return c.json({ error: "invalid_id" }, 400);
  const t = await taskOf(c, taskId);
  if (!t) return c.json({ error: "not_found" }, 404);
  const kind = (await body(c)).kind;
  if (kind !== "inhouse" && kind !== "po") return c.json({ error: "kind_invalid", message: "Choose in-house crew or purchase order." }, 400);
  if (t.state === "done" || t.state === "skipped") return c.json({ error: `task_${t.state}` }, 409);
  if (kind === "po") {
    if (String(t.trade_code).startsWith("INTERNAL:")) return c.json({ error: "template_task_inhouse", message: "This is our own team's task; it has no purchase order." }, 409);
    await db(c).prepare(`UPDATE project_trade_tasks SET fulfilment_kind = 'po', updated_at = now() WHERE id = ?`).bind(taskId).run();
  } else {
    if (t.po_received) return c.json({ error: "po_received", message: "Goods or work on this task's purchase order were already received, so it stays on the PO." }, 409);
    await db(c).prepare(`UPDATE project_trade_tasks SET fulfilment_kind = 'internal', purchase_order_id = NULL, supplier_id = NULL, updated_at = now() WHERE id = ?`).bind(taskId).run();
  }
  await db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, 'task_fulfilment', ?, ?, ?, ?, ?)`)
    .bind(t.project_id, t.fulfilment_kind, kind === "po" ? "po" : "internal", t.label, userId(c), Number(t.company_id)).run();
  const rows = await loadProjectRows(db(c), "", { projectId: t.project_id, includeArchived: true });
  if (rows.length) await writeCachedStage(db(c), t.project_id, (await loadRenovationFacts(db(c), rows)).get(t.project_id)!);
  return c.json({ ok: true });
});

export default app;
