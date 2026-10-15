/* Customer + property information on the renovation project (owner, 14 Oct 2026;
   migration 0112). Mounted inside routes/renovation.ts at /api/renovation, before
   its /:id routes.

     GET   /property-lists              property types + layouts, ready flag
     POST  /property-types              add a property type          (projects.manage)
     PATCH /property-types/:listId      rename / reorder / switch off (projects.manage)
     POST  /layouts                     add a layout                 (projects.manage)
     PATCH /layouts/:listId             change a layout              (projects.manage)
     GET   /:id/customer-info           the project's shared fields and its linked SOs
     PATCH /:id/customer-info           save them; open linked SOs follow (projects.write)

   The two-way rule lives in scm/shared/renovation-property.ts. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql, requireActiveCompanyId } from "../scm/lib/companyScope";
import type { Db } from "../services/renovation/load";
import { refreshProjectDates } from "../services/renovation/projectDates";
import {
  propertyColumnsReady,
  pushProjectToOpenSos,
  readProjectCustomerInfo,
  writeProjectShared,
  readProjectShared,
  readPropertyLists,
} from "../services/renovation/customerProperty";
import { parseCount, readPropertyInput, soOpenForProjectSync } from "../scm/shared/renovation-property";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx) => c.env.DB as unknown as Db;
const userId = (c: Ctx): number => Number(c.get("user")?.id ?? 0);
const coSql = (c: Ctx, col = "company_id") => activeCompanySql(c, col);
const body = async (c: Ctx): Promise<Record<string, unknown>> => (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseId(x: string | undefined | null): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const NOT_READY = { error: "property_columns_missing", message: "The property lists are not in the database yet (migration 0112)." };

app.get("/property-lists", requirePageAccess("projects.list"), async (c) => {
  if (!(await propertyColumnsReady(db(c)).catch(() => false))) return c.json({ ready: false, propertyTypes: [], layouts: [] });
  return c.json({ ready: true, ...(await readPropertyLists(db(c), coSql(c))) });
});

app.post("/property-types", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  if (!(await propertyColumnsReady(db(c)))) return c.json(NOT_READY, 409);
  const b = await body(c);
  const label = text(b.label, 80);
  if (!label) return c.json({ error: "label_required", message: "Give the property type a name." }, 400);
  const row = await db(c).prepare(
    `INSERT INTO project_property_types (company_id, label, sort_order)
     VALUES (?, ?, coalesce(?::int, (SELECT coalesce(max(sort_order), 0) + 10 FROM project_property_types WHERE company_id = ?)))
     ON CONFLICT (company_id, lower(label)) DO NOTHING RETURNING id::int AS id`,
  ).bind(co.companyId, label, b.sortOrder == null ? null : Number(b.sortOrder), co.companyId).first<{ id: number }>();
  if (!row) return c.json({ error: "duplicate", message: `${label} is already in the list.` }, 409);
  return c.json({ id: row.id }, 201);
});

app.patch("/property-types/:listId", requirePermission("projects.manage"), async (c) => {
  const id = parseId(c.req.param("listId"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await propertyColumnsReady(db(c)))) return c.json(NOT_READY, 409);
  const b = await body(c);
  const label = b.label === undefined ? null : text(b.label, 80);
  if (label === "") return c.json({ error: "label_required", message: "Give the property type a name." }, 400);
  try {
    const res = await db(c).prepare(
      `UPDATE project_property_types SET label = coalesce(?, label), sort_order = coalesce(?::int, sort_order),
              active = coalesce(?::boolean, active), updated_at = now() WHERE id = ?${coSql(c)} RETURNING id`,
    ).bind(label, b.sortOrder == null ? null : Number(b.sortOrder), typeof b.active === "boolean" ? b.active : null, id).first();
    if (!res) return c.json({ error: "not_found" }, 404);
  } catch (e) {
    if (/duplicate key|unique/i.test(String((e as Error)?.message))) return c.json({ error: "duplicate", message: `${label} is already in the list.` }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

function layoutNumbers(b: Record<string, unknown>, partial: boolean): { bedrooms: number | null; bathrooms: number | null } | string {
  const bedrooms = b.bedrooms === undefined && partial ? null : parseCount(b.bedrooms);
  const bathrooms = b.bathrooms === undefined && partial ? null : parseCount(b.bathrooms);
  if (Number.isNaN(bedrooms) || Number.isNaN(bathrooms)) return "Bedrooms and bathrooms are whole numbers from 0 to 20.";
  if (!partial && (bedrooms === null || bathrooms === null)) return "Give the number of bedrooms and bathrooms.";
  return { bedrooms, bathrooms };
}

app.post("/layouts", requirePermission("projects.manage"), async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  if (!(await propertyColumnsReady(db(c)))) return c.json(NOT_READY, 409);
  const b = await body(c);
  const nums = layoutNumbers(b, false);
  if (typeof nums === "string") return c.json({ error: "counts_invalid", message: nums }, 400);
  const label = text(b.label, 80) || `${nums.bedrooms} bed ${nums.bathrooms} bath`;
  const row = await db(c).prepare(
    `INSERT INTO project_layouts (company_id, label, bedrooms, bathrooms, sort_order)
     VALUES (?, ?, ?, ?, coalesce(?::int, (SELECT coalesce(max(sort_order), 0) + 10 FROM project_layouts WHERE company_id = ?)))
     ON CONFLICT (company_id, lower(label)) DO NOTHING RETURNING id::int AS id`,
  ).bind(co.companyId, label, nums.bedrooms, nums.bathrooms, b.sortOrder == null ? null : Number(b.sortOrder), co.companyId).first<{ id: number }>();
  if (!row) return c.json({ error: "duplicate", message: `${label} is already in the list.` }, 409);
  return c.json({ id: row.id }, 201);
});

app.patch("/layouts/:listId", requirePermission("projects.manage"), async (c) => {
  const id = parseId(c.req.param("listId"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await propertyColumnsReady(db(c)))) return c.json(NOT_READY, 409);
  const b = await body(c);
  const nums = layoutNumbers(b, true);
  if (typeof nums === "string") return c.json({ error: "counts_invalid", message: nums }, 400);
  const label = b.label === undefined ? null : text(b.label, 80);
  if (label === "") return c.json({ error: "label_required", message: "Give the layout a name." }, 400);
  try {
    const res = await db(c).prepare(
      `UPDATE project_layouts SET label = coalesce(?, label), bedrooms = coalesce(?::int, bedrooms), bathrooms = coalesce(?::int, bathrooms),
              sort_order = coalesce(?::int, sort_order), active = coalesce(?::boolean, active), updated_at = now()
        WHERE id = ?${coSql(c)} RETURNING id`,
    ).bind(label, nums.bedrooms, nums.bathrooms, b.sortOrder == null ? null : Number(b.sortOrder),
      typeof b.active === "boolean" ? b.active : null, id).first();
    if (!res) return c.json({ error: "not_found" }, 404);
  } catch (e) {
    if (/duplicate key|unique/i.test(String((e as Error)?.message))) return c.json({ error: "duplicate", message: `${label} is already in the list.` }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

async function linkedSos(c: Ctx, id: number) {
  const res = await db(c).prepare(
    `SELECT doc_no, coalesce(so_kind, 'STANDARD') AS so_kind, status::text AS status, so_date::text AS so_date,
            processing_date::text AS processing_date, proceeded_at::text AS proceeded_at
       FROM scm.mfg_sales_orders WHERE project_id = ? AND status::text <> 'CANCELLED' ORDER BY so_date DESC NULLS LAST, doc_no DESC`,
  ).bind(id).all<{ doc_no: string; so_kind: string; status: string; so_date: string | null; processing_date: string | null; proceeded_at: string | null }>();
  return (res.results ?? []).map((s) => ({ docNo: s.doc_no, kind: s.so_kind, status: s.status, soDate: s.so_date, followsProject: soOpenForProjectSync(s) }));
}

app.get("/:id/customer-info", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await propertyColumnsReady(db(c)))) return c.json(NOT_READY, 409);
  await refreshProjectDates(db(c), id, coSql(c, "p.company_id"));
  const p = await readProjectShared(db(c), id, coSql(c, "p.company_id"));
  if (!p) return c.json({ error: "not_found" }, 404);
  return c.json({ project: p, salesOrders: await linkedSos(c, id) });
});

app.patch("/:id/customer-info", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if (!(await propertyColumnsReady(db(c)))) return c.json(NOT_READY, 409);
  const before = await readProjectShared(db(c), id, coSql(c, "p.company_id"));
  if (!before) return c.json({ error: "not_found" }, 404);
  /* The same fields and the same required rules as the renovation sales order (owner, 14 Oct 2026). */
  const { value, problems } = await readProjectCustomerInfo(db(c), await body(c));
  if (problems.length) return c.json({ error: "validation_failed", problems }, 422);
  await writeProjectShared(db(c), id, value);
  const pushed = await pushProjectToOpenSos(db(c), id);
  await db(c).prepare(`INSERT INTO project_activity (project_id, action, to_value, note, user_id, company_id) VALUES (?, 'customer_info_saved', ?, ?, ?, (SELECT company_id FROM projects WHERE id = ?))`)
    .bind(id, pushed.updated.join(", ") || null, `Customer and property information saved; ${pushed.updated.length} open sales order(s) updated, ${pushed.kept.length} kept as printed`, userId(c), id).run();
  return c.json({ ok: true, salesOrdersUpdated: pushed.updated, salesOrdersKept: pushed.kept });
});

export default app;
