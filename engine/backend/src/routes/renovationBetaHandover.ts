/* Handover snag list (TODO item 17; migration 0296), after Hookka's qc-templates / qc-inspections / qc-pending. Mounted
   at /api/beta beside renovationBeta.ts, behind the same auth gate. Every project, check and template here is scoped
   to the active company (404 otherwise). Until 0296 is applied the reads answer ready: false and the writes refuse
   with not_ready.

   GET  /handover-templates                 the company's checklists with their items (?all=1 also lists switched-off ones)
   POST /handover-templates                 { name, items: [{ area, item, criteria }] }            projects.manage
   PUT  /handover-templates/:id             { name, active, items } replaces the items              projects.manage
   GET  /projects/:id/handover-checks       the project's checks, newest first, each with its items and their defect
   POST /projects/:id/handover-checks       { templateId } copies the template's items; one open check per project
   POST /handover-check-items/:itemId       { result: "pass" | "na" | null, note } (a Fail is a defect report:
                                            POST /projects/:id/defects with checkItemId, in renovationBeta.ts)
   POST /handover-checks/:id/finish         every item marked first; until then the check stays open
   POST /handover-checks/:id/reopen         a finished check back to open
   POST /handover-checks/:id/remove         an open check with nothing marked yet (started by mistake)
   GET  /defect-queue                       every open defect and every open check of the company's projects */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql, requireActiveCompanyId } from "../scm/lib/companyScope";
import { isMissingRelation, type Db } from "../services/renovation/load";
import {
  HANDOVER_NOT_READY as NOT_READY, checkProgress, cleanItemMark, cleanTemplate, finishRefusal, itemMarkRefusal, templateItemsJson,
} from "../services/renovation/handoverChecks";

type Ctx = Context<{ Bindings: Env }>;
type Row = Record<string, unknown>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx): Db => c.env.DB as unknown as Db;
const userId = (c: Ctx): number => Number(c.get("user")?.id ?? 0);
const coSql = (c: Ctx, col = "company_id"): string => activeCompanySql(c, col);
const body = async (c: Ctx): Promise<Record<string, unknown>> => (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};
const TS = (col: string): string => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const str = (x: unknown): string | null => (x == null || x === "" ? null : String(x));
const num = (x: unknown): number | null => (x == null ? null : Number(x));

function parseId(x: string | undefined | null): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "23505" || /duplicate key value/i.test(String(err?.message ?? ""));
}

/** Runs a handler and turns a missing 0296 table into its answer (reads: ready false; writes: not_ready). */
function guarded(read: boolean, fn: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx): Promise<Response> => {
    try {
      return await fn(c);
    } catch (e) {
      if (isMissingRelation(e)) return read ? c.json({ ready: false }) : c.json(NOT_READY, 409);
      console.error("[renovation-beta] handover checklist failed", e);
      return c.json({ error: "handover_check_failed", message: "That could not be done just now. Try again." }, 500);
    }
  };
}

async function projectCompany(c: Ctx, id: number): Promise<number | null> {
  const r = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${coSql(c)}`)
    .bind(id).first<{ company_id: number }>();
  return r ? Number(r.company_id) : null;
}

interface CheckRow { id: number; project_id: number; company_id: number; completed_at: string | null; template_name: string }

/** A check of a renovation project in the active company. */
async function checkOf(c: Ctx, checkId: number): Promise<CheckRow | null> {
  return db(c).prepare(
    `SELECT k.id::int AS id, k.project_id::int AS project_id, k.company_id::int AS company_id, ${TS("k.completed_at")} AS completed_at, k.template_name
       FROM project_handover_checks k JOIN projects p ON p.id = k.project_id
      WHERE k.id = ? AND p.project_kind = 'renovation'${coSql(c, "p.company_id")}`,
  ).bind(checkId).first<CheckRow>();
}

function activity(c: Ctx, projectId: number, companyId: number, action: string, to: string | null, note: string | null) {
  return db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, ?, NULL, ?, ?, ?, ?)`)
    .bind(projectId, action, to, note, userId(c), companyId);
}

// ── Templates ────────────────────────────────────────────────────────────

app.get("/handover-templates", requirePageAccess("projects.list"), guarded(true, async (c) => {
  const all = c.req.query("all") === "1";
  const rows = await db(c).prepare(
    `SELECT t.id::int AS id, t.name, t.active::int AS active, ${TS("t.updated_at")} AS updated_at,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'area', i.area, 'item', i.item, 'criteria', i.criteria) ORDER BY i.sequence)
                        FROM handover_checklist_template_items i WHERE i.template_id = t.id), '[]'::jsonb)::text AS items
       FROM handover_checklist_templates t
      WHERE TRUE${coSql(c, "t.company_id")}${all ? "" : " AND t.active"}
      ORDER BY t.active DESC, lower(t.name), t.id`,
  ).bind().all<Row>();
  return c.json({
    ready: true,
    templates: (rows.results ?? []).map((t) => ({
      id: Number(t.id), name: String(t.name), active: Number(t.active) === 1, updatedAt: str(t.updated_at),
      items: (JSON.parse(String(t.items ?? "[]")) as Row[]).map((i) => ({ id: Number(i.id), area: str(i.area), item: String(i.item), criteria: str(i.criteria) })),
    })),
  });
}));

const ITEMS_INSERT = `INSERT INTO handover_checklist_template_items (template_id, sequence, area, item, criteria)
  SELECT ?::bigint, x.n, x.area, x.item, x.criteria FROM jsonb_to_recordset(?::text::jsonb) WITH ORDINALITY AS x(area text, item text, criteria text, n bigint)`;
const NAME_TAKEN = { error: "name_taken", message: "Another checklist already has that name." } as const;

app.post("/handover-templates", requirePermission("projects.manage"), guarded(false, async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanTemplate(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  try {
    const row = await db(c).prepare(
      `WITH t AS (INSERT INTO handover_checklist_templates (company_id, name, active, created_by, updated_by) VALUES (?, ?, ?, ?, ?) RETURNING id),
            i AS (INSERT INTO handover_checklist_template_items (template_id, sequence, area, item, criteria)
                  SELECT t.id, x.n, x.area, x.item, x.criteria FROM t, jsonb_to_recordset(?::text::jsonb) WITH ORDINALITY AS x(area text, item text, criteria text, n bigint))
       SELECT id::int AS id FROM t`,
    ).bind(co.companyId, v.value.name, v.value.active, userId(c), userId(c), templateItemsJson(v.value.items)).first<{ id: number }>();
    return c.json({ id: row?.id }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json(NAME_TAKEN, 409);
    throw e;
  }
}));

app.put("/handover-templates/:id", requirePermission("projects.manage"), guarded(false, async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const v = cleanTemplate(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const found = await db(c).prepare(`SELECT id FROM handover_checklist_templates WHERE id = ?${coSql(c)}`).bind(id).first();
  if (!found) return c.json({ error: "not_found" }, 404);
  // One transaction: the items are replaced whole. Checks already started keep their own copy.
  try {
    await db(c).batch!([
      db(c).prepare(`UPDATE handover_checklist_templates SET name = ?, active = ?, updated_by = ?, updated_at = now() WHERE id = ?`)
        .bind(v.value.name, v.value.active, userId(c), id),
      db(c).prepare(`DELETE FROM handover_checklist_template_items WHERE template_id = ?`).bind(id),
      db(c).prepare(ITEMS_INSERT).bind(id, templateItemsJson(v.value.items)),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json(NAME_TAKEN, 409);
    throw e;
  }
  return c.json({ ok: true });
}));

// ── Checks on a project ──────────────────────────────────────────────────

app.get("/projects/:id/handover-checks", requirePageAccess("projects.list"), guarded(true, async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if ((await projectCompany(c, id)) == null) return c.json({ error: "not_found" }, 404);
  const [checks, items] = await Promise.all([
    db(c).prepare(
      `SELECT k.id::int AS id, k.template_name, ${TS("k.started_at")} AS started_at, su.name AS started_by_name,
              ${TS("k.completed_at")} AS completed_at, cu.name AS completed_by_name
         FROM project_handover_checks k
         LEFT JOIN users su ON su.id = k.started_by
         LEFT JOIN users cu ON cu.id = k.completed_by
        WHERE k.project_id = ? ORDER BY k.id DESC`,
    ).bind(id).all<Row>(),
    db(c).prepare(
      `SELECT i.id::int AS id, i.check_id::int AS check_id, i.area, i.item, i.criteria, i.result, i.note, i.defect_id::int AS defect_id,
              ${TS("i.checked_at")} AS checked_at, u.name AS checked_by_name,
              ${TS("d.fixed_at")} AS defect_fixed_at, ${TS("d.closed_at")} AS defect_closed_at
         FROM project_handover_check_items i
         JOIN project_handover_checks k ON k.id = i.check_id
         LEFT JOIN users u ON u.id = i.checked_by
         LEFT JOIN project_defects d ON d.id = i.defect_id AND d.archived_at IS NULL
        WHERE k.project_id = ? ORDER BY i.check_id, i.sequence`,
    ).bind(id).all<Row>(),
  ]);
  const byCheck = new Map<number, Row[]>();
  for (const i of items.results ?? []) {
    const k = Number(i.check_id);
    byCheck.set(k, [...(byCheck.get(k) ?? []), i]);
  }
  return c.json({
    ready: true,
    checks: (checks.results ?? []).map((k) => {
      const its = byCheck.get(Number(k.id)) ?? [];
      return {
        id: Number(k.id), templateName: String(k.template_name), startedAt: str(k.started_at), startedByName: str(k.started_by_name),
        completedAt: str(k.completed_at), completedByName: str(k.completed_by_name),
        progress: checkProgress(its.map((i) => ({ result: str(i.result) }))),
        items: its.map((i) => ({
          id: Number(i.id), area: str(i.area), item: String(i.item), criteria: str(i.criteria), result: str(i.result), note: str(i.note),
          defectId: num(i.defect_id), defectState: i.defect_id == null ? null : i.defect_closed_at ? "closed" : i.defect_fixed_at ? "fixed" : "open",
          checkedAt: str(i.checked_at), checkedByName: str(i.checked_by_name),
        })),
      };
    }),
  });
}));

app.post("/projects/:id/handover-checks", requirePermission("projects.write"), guarded(false, async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const templateId = parseId(String((await body(c)).templateId ?? ""));
  if (!templateId) return c.json({ error: "template_required", message: "Pick a checklist." }, 400);
  const open = await db(c).prepare(`SELECT id FROM project_handover_checks WHERE project_id = ? AND completed_at IS NULL`).bind(id).first();
  if (open) return c.json({ error: "check_open", message: "This project already has an open handover check. Finish it or carry on with it." }, 409);
  const row = await db(c).prepare(
    `WITH tp AS (SELECT id, name FROM handover_checklist_templates WHERE id = ? AND company_id = ? AND active),
          k AS (INSERT INTO project_handover_checks (project_id, company_id, template_id, template_name, started_by)
                SELECT ?, ?, tp.id, tp.name, ? FROM tp RETURNING id, template_id, template_name),
          i AS (INSERT INTO project_handover_check_items (check_id, sequence, area, item, criteria)
                SELECT k.id, ti.sequence, ti.area, ti.item, ti.criteria FROM k JOIN handover_checklist_template_items ti ON ti.template_id = k.template_id),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT ?::bigint, 'handover_check_started', NULL, k.template_name, NULL, ?::bigint, ?::bigint FROM k)
     SELECT id::int AS id FROM k`,
  ).bind(templateId, co, id, co, userId(c), id, userId(c), co).first<{ id: number }>();
  if (!row) return c.json({ error: "template_not_found", message: "That checklist is not on this company's list, or it is switched off." }, 404);
  return c.json({ id: row.id }, 201);
}));

app.post("/handover-check-items/:itemId", requirePermission("projects.write"), guarded(false, async (c) => {
  const itemId = parseId(c.req.param("itemId"));
  if (!itemId) return c.json({ error: "invalid_id" }, 400);
  const v = cleanItemMark(await body(c));
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const it = await db(c).prepare(
    `SELECT i.check_id::int AS check_id, i.result, i.defect_id::int AS defect_id FROM project_handover_check_items i WHERE i.id = ?`,
  ).bind(itemId).first<{ check_id: number; result: string | null; defect_id: number | null }>();
  const k = it ? await checkOf(c, Number(it.check_id)) : null;
  if (!it || !k) return c.json({ error: "not_found" }, 404);
  const refused = itemMarkRefusal({ completedAt: k.completed_at }, { result: it.result, defectId: it.defect_id == null ? null : Number(it.defect_id) });
  if (refused) return c.json(refused, 409);
  const { result, note } = v.value;
  const row = await db(c).prepare(
    `UPDATE project_handover_check_items SET result = ?::text, note = ?::text,
            checked_by = CASE WHEN ?::text IS NULL THEN NULL ELSE ?::bigint END,
            checked_at = CASE WHEN ?::text IS NULL THEN NULL ELSE now() END
      WHERE id = ? AND defect_id IS NULL
        AND check_id IN (SELECT id FROM project_handover_checks WHERE id = ? AND completed_at IS NULL)
      RETURNING id::int AS id`,
  ).bind(result, note, result, userId(c), result, itemId, k.id).first<{ id: number }>();
  if (!row) return c.json({ error: "check_changed", message: "Someone else just changed this check. Reload and look again." }, 409);
  return c.json({ ok: true });
}));

app.post("/handover-checks/:id/finish", requirePermission("projects.write"), guarded(false, async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const k = await checkOf(c, id);
  if (!k) return c.json({ error: "not_found" }, 404);
  const items = await db(c).prepare(`SELECT result FROM project_handover_check_items WHERE check_id = ?`).bind(id).all<{ result: string | null }>();
  const progress = checkProgress(items.results ?? []);
  const refused = finishRefusal({ completedAt: k.completed_at }, progress);
  if (refused) return c.json({ ...refused, progress }, 409);
  const row = await db(c).prepare(
    `WITH u AS (UPDATE project_handover_checks SET completed_at = now(), completed_by = ?
                 WHERE id = ? AND completed_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM project_handover_check_items i WHERE i.check_id = ? AND i.result IS NULL)
                 RETURNING id, template_name),
          a AS (INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
                SELECT ?::bigint, 'handover_check_finished', NULL, u.template_name, ?::text, ?::bigint, ?::bigint FROM u)
     SELECT id::int AS id FROM u`,
  ).bind(userId(c), id, id, k.project_id, `${progress.passed} passed, ${progress.failed} failed, ${progress.na} not applicable`, userId(c), k.company_id)
    .first<{ id: number }>();
  if (!row) return c.json({ error: "check_changed", message: "Someone else just changed this check. Reload and look again." }, 409);
  return c.json({ ok: true, progress });
}));

app.post("/handover-checks/:id/reopen", requirePermission("projects.write"), guarded(false, async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const k = await checkOf(c, id);
  if (!k) return c.json({ error: "not_found" }, 404);
  if (!k.completed_at) return c.json({ error: "check_open", message: "This check is still open." }, 409);
  const other = await db(c).prepare(`SELECT id FROM project_handover_checks WHERE project_id = ? AND completed_at IS NULL AND id <> ?`).bind(k.project_id, id).first();
  if (other) return c.json({ error: "check_open", message: "Another handover check of this project is open. Finish it first." }, 409);
  await db(c).batch!([
    db(c).prepare(`UPDATE project_handover_checks SET completed_at = NULL, completed_by = NULL WHERE id = ?`).bind(id),
    activity(c, k.project_id, k.company_id, "handover_check_reopened", k.template_name, null),
  ]);
  return c.json({ ok: true });
}));

app.post("/handover-checks/:id/remove", requirePermission("projects.write"), guarded(false, async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const k = await checkOf(c, id);
  if (!k) return c.json({ error: "not_found" }, 404);
  const row = await db(c).prepare(
    `DELETE FROM project_handover_checks WHERE id = ? AND completed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM project_handover_check_items i WHERE i.check_id = ? AND i.result IS NOT NULL)
      RETURNING id::int AS id`,
  ).bind(id, id).first<{ id: number }>();
  if (!row) return c.json({ error: "check_in_use", message: "Only an open check with nothing marked yet can be removed." }, 409);
  return c.json({ ok: true });
}));

// ── The queue across projects ────────────────────────────────────────────

app.get("/defect-queue", requirePageAccess("projects.list"), async (c) => {
  const scope = `p.project_kind = 'renovation' AND p.archived_at IS NULL${coSql(c, "p.company_id")}`;
  try {
    const defects = await db(c).prepare(
      `SELECT d.id::int AS id, d.project_id::int AS project_id, p.code AS project_code, p.name AS project_name, p.customer_name,
              d.location, d.item_description, d.trade, d.due_date::text AS due_date, d.reported_at, ${TS("d.fixed_at")} AS fixed_at,
              d.redo_count::int AS redo_count, d.assignee_person_id::int AS assignee_id, ap.name AS assignee_name, ap.phone AS assignee_phone,
              d.photo_r2_key
         FROM project_defects d
         JOIN projects p ON p.id = d.project_id
         LEFT JOIN project_people ap ON ap.id = d.assignee_person_id
        WHERE d.phase = 'snag' AND d.closed_at IS NULL AND d.archived_at IS NULL AND ${scope}
        ORDER BY d.due_date NULLS LAST, d.id
        LIMIT 1000`,
    ).bind().all<Row>();
    let checks: Row[] = [];
    let checksReady = true;
    try {
      const r = await db(c).prepare(
        `SELECT k.id::int AS id, k.project_id::int AS project_id, p.code AS project_code, p.name AS project_name, k.template_name,
                ${TS("k.started_at")} AS started_at, su.name AS started_by_name,
                count(i.id)::int AS total, count(i.result)::int AS checked, count(*) FILTER (WHERE i.result = 'fail')::int AS failed
           FROM project_handover_checks k
           JOIN projects p ON p.id = k.project_id
           LEFT JOIN users su ON su.id = k.started_by
           LEFT JOIN project_handover_check_items i ON i.check_id = k.id
          WHERE k.completed_at IS NULL AND ${scope}
          GROUP BY k.id, p.code, p.name, su.name
          ORDER BY k.started_at`,
      ).bind().all<Row>();
      checks = r.results ?? [];
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
      checksReady = false;
    }
    return c.json({
      checksReady,
      defects: (defects.results ?? []).map((d) => ({
        id: Number(d.id), projectId: Number(d.project_id), projectCode: str(d.project_code), projectName: str(d.project_name), customerName: str(d.customer_name),
        location: str(d.location), description: str(d.item_description), trade: str(d.trade), dueDate: str(d.due_date), reportedAt: str(d.reported_at),
        fixedAt: str(d.fixed_at), redoCount: Number(d.redo_count ?? 0), assigneeId: num(d.assignee_id), assigneeName: str(d.assignee_name),
        assigneePhone: str(d.assignee_phone), photoKey: str(d.photo_r2_key),
      })),
      checks: checks.map((k) => ({
        id: Number(k.id), projectId: Number(k.project_id), projectCode: str(k.project_code), projectName: str(k.project_name), templateName: String(k.template_name),
        startedAt: str(k.started_at), startedByName: str(k.started_by_name), total: Number(k.total ?? 0), checked: Number(k.checked ?? 0), failed: Number(k.failed ?? 0),
      })),
    });
  } catch (e) {
    console.error("[renovation-beta] defect queue read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The defect queue could not be read. Try again." }, 500);
  }
});

export default app;
