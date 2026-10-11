/* Renovation settings for Project Maintenance (owner requirements 11 Oct 2026,
   migration 0087). Mounted inside routes/renovationProject.ts, so it sits under
   /api/renovation before the /:id routes.

     GET/POST /buildings, PATCH /buildings/:bid            building list (name, state, default property type)
     GET/POST /property-types, PATCH /property-types/:pid  Condo, Landed, Serviced apartment, Commercial, Others
     GET/POST /contractors, PATCH /contractors/:cid        renovation subcontractors; each is an engine supplier
     GET /contractors/supplier-options?q=                  suppliers not yet a contractor (to link one)
     GET /brands                                           project brands for the new-project form

   A contractor is always an engine supplier, because sales order lines bind a
   supplier and the SO -> PO split groups lines by it: adding a contractor links
   an existing supplier or creates one with code SC-<NAME>. Every read and write
   is scoped to the active company. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql, requireActiveCompanyId } from "../scm/lib/companyScope";
import type { Db } from "../services/renovation/load";
import { cleanBuilding, cleanContractor, cleanPropertyType, contractorSupplierCode } from "../services/renovation/projectSettings";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx) => c.env.DB as unknown as Db;
const coSql = (c: Ctx, col = "company_id") => activeCompanySql(c, col);
const body = async (c: Ctx): Promise<Record<string, unknown>> => (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};
const changes = (r: unknown) => Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 0);
const isUnique = (e: unknown) => String((e as { code?: string })?.code ?? "") === "23505" || /duplicate key|unique/i.test(String((e as Error)?.message ?? ""));

function parseId(x: string | undefined | null): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The property type, when given, must be one of this company's. */
async function propertyTypeOk(c: Ctx, companyId: number | null, id: number | null | undefined): Promise<boolean> {
  if (id == null) return true;
  const r = await db(c).prepare(`SELECT 1 AS ok FROM project_property_types WHERE id = ?${companyId ? ` AND company_id = ${companyId}` : coSql(c)}`).bind(id).first();
  return !!r;
}

// ── Brands (read; managed by the brand manager in Project Maintenance) ────

app.get("/brands", requirePageAccess("projects.list"), async (c) => {
  const res = await db(c).prepare(
    `SELECT id::int AS id, name, color, (active = 1) AS active FROM project_brands WHERE true${coSql(c)} ORDER BY sort_order, name`,
  ).bind().all();
  return c.json({ data: res.results ?? [] });
});

// ── Property types ───────────────────────────────────────────────────────

app.get("/property-types", requirePageAccess("projects.list"), async (c) => {
  const res = await db(c).prepare(
    `SELECT id::int AS id, name, sort_order, active FROM project_property_types WHERE true${coSql(c)} ORDER BY sort_order, lower(name)`,
  ).bind().all();
  return c.json({ data: res.results ?? [] });
});

app.post("/property-types", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanPropertyType(await body(c));
  if (!v.ok) return c.json(v, 400);
  try {
    const row = await db(c).prepare(
      `INSERT INTO project_property_types (company_id, name, sort_order)
       VALUES (?, ?, coalesce(?, (SELECT coalesce(max(sort_order), 0) + 10 FROM project_property_types WHERE company_id = ?))) RETURNING id::int AS id`,
    ).bind(co.companyId, v.value.name, v.value.sortOrder ?? null, co.companyId).first<{ id: number }>();
    return c.json({ id: row?.id }, 201);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "duplicate_name", message: "That property type is already on the list." }, 409);
    throw e;
  }
});

app.patch("/property-types/:pid", requirePermission("projects.manage"), async (c) => {
  const id = parseId(c.req.param("pid"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const v = cleanPropertyType(await body(c), true);
  if (!v.ok) return c.json(v, 400);
  const p = v.value;
  try {
    const res = await db(c).prepare(
      `UPDATE project_property_types SET name = coalesce(?, name), active = coalesce(?, active), sort_order = coalesce(?, sort_order), updated_at = now()
        WHERE id = ?${coSql(c)}`,
    ).bind(p.name ?? null, p.active ?? null, p.sortOrder ?? null, id).run();
    if (!changes(res)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "duplicate_name", message: "That property type is already on the list." }, 409);
    throw e;
  }
});

// ── Buildings ────────────────────────────────────────────────────────────

const BUILDING_COLS = `b.id::int AS id, b.name, b.state, b.property_type_id::int AS property_type_id, pt.name AS property_type_name,
  b.sort_order, b.active, b.source, b.source_ref,
  (SELECT count(*)::int FROM projects p WHERE p.building_id = b.id AND p.archived_at IS NULL) AS project_count`;

app.get("/buildings", requirePageAccess("projects.list"), async (c) => {
  const active = c.req.query("active");
  const res = await db(c).prepare(
    `SELECT ${BUILDING_COLS} FROM project_buildings b LEFT JOIN project_property_types pt ON pt.id = b.property_type_id
      WHERE true${coSql(c, "b.company_id")} AND (?::boolean IS NULL OR b.active = ?::boolean)
      ORDER BY b.active DESC, b.name`,
  ).bind(active === "1" ? true : active === "0" ? false : null, active === "1" ? true : active === "0" ? false : null).all();
  return c.json({ data: res.results ?? [] });
});

app.post("/buildings", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanBuilding(await body(c));
  if (!v.ok) return c.json(v, 400);
  const b = v.value;
  if (!(await propertyTypeOk(c, co.companyId, b.propertyTypeId))) return c.json({ error: "property_type_invalid", message: "Pick a property type from the list." }, 400);
  try {
    const row = await db(c).prepare(
      `INSERT INTO project_buildings (company_id, name, state, property_type_id, sort_order) VALUES (?, ?, ?, ?::bigint, coalesce(?, 0)) RETURNING id::int AS id`,
    ).bind(co.companyId, b.name, b.state ?? null, b.propertyTypeId ?? null, b.sortOrder ?? null).first<{ id: number }>();
    return c.json({ id: row?.id }, 201);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "duplicate_name", message: "That building is already on the list." }, 409);
    throw e;
  }
});

/* Renaming a building renames it on its open projects too (the board and the Notion importer read the text). */
app.patch("/buildings/:bid", requirePermission("projects.manage"), async (c) => {
  const id = parseId(c.req.param("bid"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const v = cleanBuilding(await body(c), true);
  if (!v.ok) return c.json(v, 400);
  const b = v.value;
  if (!(await propertyTypeOk(c, null, b.propertyTypeId))) return c.json({ error: "property_type_invalid", message: "Pick a property type from the list." }, 400);
  try {
    const res = await db(c).prepare(
      `UPDATE project_buildings SET name = CASE WHEN ? THEN ? ELSE name END, state = CASE WHEN ? THEN ? ELSE state END,
              property_type_id = CASE WHEN ? THEN ?::bigint ELSE property_type_id END, active = coalesce(?, active),
              sort_order = coalesce(?, sort_order), updated_at = now()
        WHERE id = ?${coSql(c)}`,
    ).bind("name" in b, b.name ?? null, "state" in b, b.state ?? null, "propertyTypeId" in b, b.propertyTypeId ?? null,
      b.active ?? null, b.sortOrder ?? null, id).run();
    if (!changes(res)) return c.json({ error: "not_found" }, 404);
    if (b.name) {
      await db(c).prepare(`UPDATE projects SET building = ? WHERE building_id = ? AND archived_at IS NULL AND closed_at IS NULL`).bind(b.name, id).run();
    }
    return c.json({ ok: true });
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "duplicate_name", message: "That building is already on the list." }, 409);
    throw e;
  }
});

// ── Contractors (each one an engine supplier) ────────────────────────────

const CONTRACTOR_COLS = `k.id::int AS id, k.name, k.trade, k.supplier_id::text AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
  k.sort_order, k.active`;

app.get("/contractors", requirePageAccess("projects.list"), async (c) => {
  const res = await db(c).prepare(
    `SELECT ${CONTRACTOR_COLS} FROM project_reno_contractors k LEFT JOIN scm.suppliers s ON s.id = k.supplier_id
      WHERE true${coSql(c, "k.company_id")} ORDER BY k.active DESC, k.sort_order, k.name`,
  ).bind().all();
  return c.json({ data: res.results ?? [] });
});

app.get("/contractors/supplier-options", requirePageAccess("projects.list"), async (c) => {
  const q = String(c.req.query("q") ?? "").trim();
  const res = await db(c).prepare(
    `SELECT s.id::text AS id, s.code, s.name FROM scm.suppliers s
      WHERE true${coSql(c, "s.company_id")} AND s.status::text = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM project_reno_contractors k WHERE k.supplier_id = s.id)
        AND (? = '' OR s.name ILIKE '%' || ? || '%' OR s.code ILIKE '%' || ? || '%')
      ORDER BY s.name LIMIT 50`,
  ).bind(q, q, q).all();
  return c.json({ data: res.results ?? [] });
});

app.post("/contractors", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const v = cleanContractor(await body(c));
  if (!v.ok) return c.json(v, 400);
  const k = v.value;
  let supplierId = k.supplierId ?? null;
  if (supplierId) {
    const s = await db(c).prepare(`SELECT id::text AS id FROM scm.suppliers WHERE id = ?::uuid AND company_id = ?`).bind(supplierId, co.companyId).first();
    if (!s) return c.json({ error: "supplier_invalid", message: "That supplier was not found." }, 400);
  } else {
    // Same name as an existing supplier: that is the contractor. Otherwise a new supplier SC-<NAME>.
    const code = contractorSupplierCode(k.name!);
    const found = await db(c).prepare(
      `SELECT id::text AS id FROM scm.suppliers WHERE company_id = ? AND (code = ? OR upper(trim(name)) = ?) ORDER BY (code = ?) DESC LIMIT 1`,
    ).bind(co.companyId, code, k.name, code).first<{ id: string }>();
    supplierId = found?.id ?? (await db(c).prepare(
      `INSERT INTO scm.suppliers (code, name, supplier_type, category, company_id) VALUES (?, ?, 'Subcontractor', ?, ?) RETURNING id::text AS id`,
    ).bind(code, k.name, k.trade ?? null, co.companyId).first<{ id: string }>())?.id ?? null;
  }
  if (!supplierId) return c.json({ error: "supplier_not_created", message: "The supplier for this contractor could not be created." }, 409);
  try {
    const row = await db(c).prepare(
      `INSERT INTO project_reno_contractors (company_id, name, trade, supplier_id, sort_order)
       VALUES (?, ?, ?, ?::uuid, (SELECT coalesce(max(sort_order), 0) + 10 FROM project_reno_contractors WHERE company_id = ?)) RETURNING id::int AS id`,
    ).bind(co.companyId, k.name, k.trade ?? null, supplierId, co.companyId).first<{ id: number }>();
    return c.json({ id: row?.id, supplierId }, 201);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "duplicate", message: "That contractor or supplier is already on the list." }, 409);
    throw e;
  }
});

app.patch("/contractors/:cid", requirePermission("projects.manage"), async (c) => {
  const id = parseId(c.req.param("cid"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const v = cleanContractor(await body(c), true);
  if (!v.ok) return c.json(v, 400);
  const k = v.value;
  try {
    const res = await db(c).prepare(
      `UPDATE project_reno_contractors SET name = coalesce(?, name), trade = CASE WHEN ? THEN ? ELSE trade END, active = coalesce(?, active), updated_at = now()
        WHERE id = ?${coSql(c)}`,
    ).bind(k.name ?? null, "trade" in k, k.trade ?? null, k.active ?? null, id).run();
    if (!changes(res)) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "duplicate", message: "That contractor is already on the list." }, 409);
    throw e;
  }
});

export default app;
