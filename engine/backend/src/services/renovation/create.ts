/* Opening a renovation project. One SQL statement (data-modifying CTEs), so the
   project, its finance row, its 11 stage rows, its stage checklist copied from
   the type's template and its template tasks all exist together or not at all.
   No venue, organizer or event type: those belong to exhibitions. Code RN-YYMM-NNN
   (the internal code); the name defaults to "<BUILDING> <UNIT> <CUSTOMER>"; the start
   date is the day it is created, and the SLA due date follows from the type. */

import { RENO_STAGES } from "../../scm/shared/renovation-stages";
import type { Db } from "./load";
import { planTradeTasks } from "./tradeTasks";
import { autoProjectName, DEFAULT_BRAND_NAME } from "./projectSettings";

export interface CreateRenovationInput {
  /** optional: blank means "<BUILDING> <UNIT> <CUSTOMER>" in capitals (autoProjectName) */
  name?: string | null;
  projectTypeId: number;
  customerKind?: "owner" | "customer";
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  posOwnerId?: string | null;
  posUnitId?: string | null;
  /** building list (migration 0087); the building text is copied from it. Without it, building text is matched to the list. */
  buildingId?: number | null;
  building?: string | null;
  unitNo?: string | null;
  state?: string | null;
  siteAddress?: string | null;
  plannedHandoverDate?: string | null;
  salespersonName?: string | null;
  picId?: number | null;
  notes?: string | null;
  /* people master (migration 0083) */
  salesPersonId?: number | null;
  designerPersonId?: number | null;
  renoPicPersonId?: number | null;
  /* new-project form (migration 0087) */
  propertyTypeId?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  builtUpSqft?: number | null;
  /** project brand; blank means the company's Dream Crafter brand */
  brandId?: number | null;
}

export type CreateRefusal =
  | "type_required"
  | "customer_kind_invalid"
  | "customer_required"
  | "building_required"
  | "unit_required"
  | "sales_required"
  | "brand_required"
  | "date_invalid"
  | "uuid_invalid"
  | "person_invalid"
  | "property_type_invalid"
  | "rooms_invalid"
  | "size_invalid";

export const CREATE_REFUSAL_TEXT: Record<CreateRefusal, string> = {
  type_required: "Pick a project type.",
  customer_kind_invalid: "The customer must be an outside customer or a Conts-managed owner.",
  customer_required: "Enter the customer name.",
  building_required: "Pick the building from the list.",
  unit_required: "Enter the unit number.",
  sales_required: "Pick the sales person.",
  brand_required: "Pick the brand.",
  date_invalid: "Use a date like 2026-10-11.",
  uuid_invalid: "The customer link is not valid.",
  person_invalid: "Pick people from the people list.",
  property_type_invalid: "Pick a property type from the list.",
  rooms_invalid: "Bedrooms and bathrooms are whole numbers from 0 to 50.",
  size_invalid: "Built-up size is a number of square feet above 0.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const posInt = (v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0;
const blank = (v: unknown) => v == null || v === "";

/** The new-project form's required set (owner 11 Oct 2026): customer name, building (from the list), unit no, sales
 *  person, project type, brand. Phone, property type, bedrooms, bathrooms, built-up, designer and notes are optional.
 *  The project name is not asked: a blank name becomes "<BUILDING> <UNIT> <CUSTOMER>". */
export function validateCreate(body: Partial<CreateRenovationInput>): CreateRefusal | null {
  if (!String(body.customerName ?? "").trim() && !body.customerId) return "customer_required";
  if (!posInt(body.buildingId)) return "building_required";
  if (!String(body.unitNo ?? "").trim()) return "unit_required";
  if (!posInt(body.salesPersonId)) return "sales_required";
  if (!posInt(body.projectTypeId)) return "type_required";
  if (!posInt(body.brandId)) return "brand_required";
  if (body.customerKind != null && body.customerKind !== "owner" && body.customerKind !== "customer") return "customer_kind_invalid";
  if (body.customerId && !UUID.test(body.customerId)) return "uuid_invalid";
  if (body.plannedHandoverDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.plannedHandoverDate)) return "date_invalid";
  for (const k of ["designerPersonId", "renoPicPersonId"] as const) {
    if (!blank(body[k]) && !posInt(body[k])) return "person_invalid";
  }
  if (!blank(body.propertyTypeId) && !posInt(body.propertyTypeId)) return "property_type_invalid";
  for (const k of ["bedrooms", "bathrooms"] as const) {
    const v = body[k];
    if (!blank(v) && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 50)) return "rooms_invalid";
  }
  if (!blank(body.builtUpSqft) && !(Number.isFinite(Number(body.builtUpSqft)) && Number(body.builtUpSqft) > 0 && Number(body.builtUpSqft) < 1e8)) return "size_invalid";
  return null;
}

/** YYMM in Malaysia time. */
export function codeMonth(now: Date): string {
  const myt = new Date(now.getTime() + 8 * 3600 * 1000);
  return `${String(myt.getUTCFullYear()).slice(2)}${String(myt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface CreateRefs {
  building: { id: number; name: string; state: string | null; property_type_id: number | null } | null;
  brand: { id: number; name: string } | null;
  propertyTypeId: number | null;
}

/** The building (by id, else by the building text), the brand (by id, else the company's Dream Crafter) and the
 *  property type, each only when it belongs to the company. */
export async function loadCreateRefs(db: Db, input: Pick<CreateRenovationInput, "buildingId" | "building" | "brandId" | "propertyTypeId">, companyId: number): Promise<CreateRefs> {
  const buildingId = input.buildingId ? Number(input.buildingId) : null;
  const brandId = input.brandId ? Number(input.brandId) : null;
  const ptId = input.propertyTypeId ? Number(input.propertyTypeId) : null;
  const r = await db.prepare(
    `SELECT
       (SELECT to_json(x) FROM (SELECT id::int AS id, name, state, property_type_id::int AS property_type_id FROM project_buildings
                                 WHERE company_id = ? AND (id = ?::bigint OR (?::bigint IS NULL AND upper(trim(name)) = upper(trim(?::text))))
                                 ORDER BY id LIMIT 1) x) AS building,
       (SELECT to_json(x) FROM (SELECT id::int AS id, name FROM project_brands
                                 WHERE company_id = ? AND (id = ?::bigint OR (?::bigint IS NULL AND lower(name) = lower(?::text)))
                                 ORDER BY id LIMIT 1) x) AS brand,
       (SELECT id::int FROM project_property_types WHERE company_id = ? AND id = ?::bigint) AS property_type_id`,
  ).bind(companyId, buildingId, buildingId, input.building ?? null, companyId, brandId, brandId, DEFAULT_BRAND_NAME, companyId, ptId)
    .first<{ building: CreateRefs["building"] | string | null; brand: CreateRefs["brand"] | string | null; property_type_id: number | null }>();
  const parse = <T,>(x: T | string | null | undefined): T | null => (x == null ? null : typeof x === "string" ? (JSON.parse(x) as T) : x);
  return { building: parse(r?.building), brand: parse(r?.brand), propertyTypeId: r?.property_type_id != null ? Number(r.property_type_id) : null };
}

/** Today in Malaysia time, YYYY-MM-DD: a new project's start date. */
function mytDate(now: Date): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function createRenovationProject(
  db: Db,
  input: CreateRenovationInput,
  actorId: number,
  companyId: number,
  now = new Date(),
): Promise<{ id: number; code: string; name: string } | null> {
  const typeRow = await db
    .prepare(`SELECT to_json(stage_keys) AS stage_keys FROM project_types WHERE id = ? AND active AND company_id = ?`)
    .bind(input.projectTypeId, companyId)
    .first<{ stage_keys: string[] }>();
  if (!typeRow) return null;
  const refs = await loadCreateRefs(db, input, companyId);
  const buildingText = refs.building?.name ?? (String(input.building ?? "").trim() || null);
  const customer = input.customerName?.trim() || null;
  const unitNo = String(input.unitNo ?? "").trim() || null;
  const name = String(input.name ?? "").trim() || autoProjectName(buildingText, unitNo, customer) || "NEW PROJECT";
  const state = String(input.state ?? "").trim() || refs.building?.state || null;
  const propertyTypeId = refs.propertyTypeId ?? refs.building?.property_type_id ?? null;
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const internal = planTradeTasks({ works: [], existing: [], typeStageKeys: typeRow.stage_keys }).create.map((t) => ({
    stage_key: t.stageKey,
    trade_code: t.tradeCode,
    category_code: t.categoryCode,
    label: t.label,
    seq: t.seq,
  }));
  const yymm = codeMonth(now);
  const row = await db
    .prepare(
      `WITH t AS (
         SELECT id, stage_keys, checklist_template_id FROM project_types WHERE id = ? AND active AND company_id = ?
       ),
       code AS (
         SELECT 'RN-' || ? || '-' || lpad((coalesce(max(substring(code from '^RN-[0-9]{4}-([0-9]+)$')::int), 0) + 1)::text, 3, '0') AS code
           FROM projects WHERE code LIKE 'RN-' || ? || '-%'
       ),
       p AS (
         INSERT INTO projects (code, name, stage, project_kind, project_type_id, customer_kind, customer_id, customer_name,
                               customer_phone, customer_email, pos_owner_id, pos_unit_id, building, unit_no, site_address,
                               planned_handover_date, salesperson_name, pic_id, notes, created_by, company_id, reno_stage,
                               sales_person_id, designer_person_id, reno_pic_person_id,
                               building_id, state, property_type_id, bedrooms, bathrooms, built_up_sqft, brand_id, brand, start_date)
         SELECT code.code, ?, 'draft', 'renovation', t.id, ?, ?::uuid, ?, ?, ?, ?, ?, ?, ?, ?, ?::date, ?, ?, ?, ?, ?, 'design',
                (SELECT id FROM project_people WHERE id = ?::bigint AND company_id = ?),
                (SELECT id FROM project_people WHERE id = ?::bigint AND company_id = ?),
                (SELECT id FROM project_people WHERE id = ?::bigint AND company_id = ?),
                ?::bigint, ?, ?::bigint, ?::smallint, ?::smallint, ?::numeric, ?::bigint, ?, ?
           FROM t, code
         RETURNING id, code
       ),
       fin AS (INSERT INTO project_finance (project_id) SELECT id FROM p RETURNING project_id),
       st AS (
         INSERT INTO project_stages (project_id, stage_key, seq, in_type, company_id)
         SELECT p.id, k.key, (k.ord - 1)::int, (k.key = ANY(t.stage_keys) OR k.key IN ('design', 'handover', 'closed')), ?
           FROM p, t, unnest(?::text[]) WITH ORDINALITY AS k(key, ord)
         RETURNING id
       ),
       sec AS (
         INSERT INTO project_checklist_sections (project_id, name, sort_order, display_mode, company_id, stage_key)
         SELECT p.id, ts.name, ts.sort_order, coalesce(ts.display_mode, 'list'), ?, ts.stage_key
           FROM p, t JOIN project_checklist_template_sections ts ON ts.template_id = t.checklist_template_id
          WHERE ts.stage_key = ANY(t.stage_keys)
         RETURNING id, stage_key, name, sort_order
       ),
       items AS (
         INSERT INTO project_checklist (project_id, seq, title, description, status, section_id, role_label, crew_visible,
                                        company_id, item_key, evidence_hint, skippable)
         SELECT p.id, ti.seq, ti.title, ti.description, 'pending', sec.id, ti.role_label, ti.crew_visible, ?, ti.item_key,
                ti.evidence_hint, ti.skippable
           FROM p, t
           JOIN project_checklist_template_items ti ON ti.template_id = t.checklist_template_id
           JOIN project_checklist_template_sections ts ON ts.id = ti.section_id
           -- each item lands in the copy of ITS section: two template sections may share a stage
           JOIN sec ON sec.stage_key = ts.stage_key AND sec.name = ts.name AND sec.sort_order = ts.sort_order
         RETURNING id
       ),
       tasks AS (
         INSERT INTO project_trade_tasks (project_id, stage_key, trade_code, fix_phase, label, seq, fulfilment_kind, company_id, category_code)
         SELECT p.id, x.stage_key, x.trade_code, 'single', x.label, x.seq, 'internal', ?, x.category_code
           FROM p, jsonb_to_recordset(?::text::jsonb) AS x(stage_key text, trade_code text, category_code text, label text, seq int)
         RETURNING id
       ),
       act AS (
         INSERT INTO project_activity (project_id, action, to_value, user_id, company_id)
         SELECT p.id, 'created', p.code, ?, ? FROM p RETURNING id
       )
       SELECT p.id, p.code, (SELECT count(*) FROM st)::int AS stages, (SELECT count(*) FROM items)::int AS items,
              (SELECT count(*) FROM tasks)::int AS tasks, (SELECT count(*) FROM fin)::int AS fin, (SELECT count(*) FROM act)::int AS act
         FROM p`,
    )
    .bind(
      input.projectTypeId, companyId,
      yymm, yymm,
      name, input.customerKind ?? "customer", input.customerId ?? null, customer,
      String(input.customerPhone ?? "").trim() || null, input.customerEmail ?? null, input.posOwnerId ?? null, input.posUnitId ?? null,
      buildingText, unitNo, input.siteAddress ?? null, input.plannedHandoverDate || null,
      input.salespersonName ?? null, input.picId ?? null, String(input.notes ?? "").trim() || null, actorId, companyId,
      input.salesPersonId || null, companyId, input.designerPersonId || null, companyId, input.renoPicPersonId || null, companyId,
      refs.building?.id ?? null, state, propertyTypeId, num(input.bedrooms), num(input.bathrooms), num(input.builtUpSqft),
      refs.brand?.id ?? null, refs.brand?.name ?? null, mytDate(now),
      companyId, `{${RENO_STAGES.join(",")}}`,
      companyId,
      companyId,
      companyId, JSON.stringify(internal),
      actorId, companyId,
    )
    .first<{ id: number; code: string }>();
  return row ? { id: Number(row.id), code: row.code, name } : null;
}
