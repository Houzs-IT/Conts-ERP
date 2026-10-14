/* Customer + property information shared by a renovation sales order and its
   project (owner, 14 Oct 2026; migration 0112). The rule is written once in
   scm/shared/renovation-property.ts; this file is its database side.

   Every function here reads or writes only columns 0112 adds when
   propertyColumnsReady() says they exist, so an engine deployed before the
   migration is applied keeps working with Houzs's sales order form. */

import type { Db } from "./load";
import {
  cleanRoomSections,
  roomsWithLineRooms,
  siteAddressFromSo,
  soAddressFromSite,
  soOpenForProjectSync,
  type PropertyValue,
  type SharedCustomerProperty,
} from "../../scm/shared/renovation-property";

export interface PropertyType { id: number; label: string; sort_order: number; active: boolean }
export interface Layout { id: number; label: string; bedrooms: number; bathrooms: number; sort_order: number; active: boolean }

/** True once migration 0112 is in this database (both lists and the SO copy columns). */
export async function propertyColumnsReady(db: Db): Promise<boolean> {
  const r = await db.prepare(
    `SELECT (to_regclass('public.project_layouts') IS NOT NULL
             AND to_regclass('public.project_property_types') IS NOT NULL
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'scm' AND table_name = 'mfg_sales_orders' AND column_name = 'built_up_sqft')
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'scm' AND table_name = 'mfg_sales_order_items' AND column_name = 'room')
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'built_up_sqft')) AS ready`,
  ).bind().first<{ ready: boolean }>();
  return r?.ready === true;
}

/** True when this install runs the renovation Projects screens (app_settings projects_mode, migration 0082). */
export async function renovationMode(db: Db): Promise<boolean> {
  const r = await db.prepare(`SELECT value FROM app_settings WHERE key = 'projects_mode'`).bind().first<{ value: string | null }>();
  return r?.value === "renovation";
}

export async function readPropertyLists(db: Db, companySql: string): Promise<{ propertyTypes: PropertyType[]; layouts: Layout[] }> {
  const types = await db.prepare(
    `SELECT id::int AS id, label, sort_order, active FROM project_property_types WHERE true${companySql} ORDER BY sort_order, label`,
  ).bind().all<PropertyType>();
  const layouts = await db.prepare(
    `SELECT id::int AS id, label, bedrooms, bathrooms, sort_order, active FROM project_layouts WHERE true${companySql} ORDER BY sort_order, bedrooms, bathrooms, label`,
  ).bind().all<Layout>();
  return { propertyTypes: types.results ?? [], layouts: layouts.results ?? [] };
}

export interface ProjectShared extends SharedCustomerProperty {
  id: number;
  code: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/** The shared fields of one renovation project of this company, or null. */
export async function readProjectShared(db: Db, projectId: number, companySql: string): Promise<ProjectShared | null> {
  const r = await db.prepare(
    `SELECT p.id::int AS id, p.code, p.name, p.customer_name, p.customer_phone, p.customer_email, p.site_address, p.building, p.unit_no,
            p.property_type, p.layout_label, p.bedrooms, p.bathrooms, p.built_up_sqft::float8 AS built_up_sqft,
            p.start_date, p.end_date
       FROM projects p WHERE p.id = ? AND p.project_kind = 'renovation'${companySql}`,
  ).bind(projectId).first<Record<string, unknown>>();
  if (!r) return null;
  return {
    id: Number(r.id), code: (r.code as string | null) ?? null, name: s(r.name),
    customerName: s(r.customer_name), customerPhone: s(r.customer_phone), customerEmail: s(r.customer_email),
    siteAddress: s(r.site_address), building: s(r.building), unitNo: s(r.unit_no),
    propertyType: s(r.property_type), layoutLabel: s(r.layout_label), bedrooms: n(r.bedrooms), bathrooms: n(r.bathrooms),
    builtUpSqft: n(r.built_up_sqft),
    startDate: r.start_date ? s(r.start_date).slice(0, 10) : null, endDate: r.end_date ? s(r.end_date).slice(0, 10) : null,
  };
}

/** Project picker for the SO form: renovation projects of this company, newest first, with their shared fields. */
export async function searchProjects(db: Db, companySql: string, q: string): Promise<ProjectShared[]> {
  const res = await db.prepare(
    `SELECT p.id::int AS id FROM projects p
      WHERE p.project_kind = 'renovation' AND p.archived_at IS NULL${companySql}
        AND (? = '' OR p.name ILIKE '%' || ? || '%' OR coalesce(p.code, '') ILIKE '%' || ? || '%'
             OR coalesce(p.building, '') ILIKE '%' || ? || '%' OR coalesce(p.customer_name, '') ILIKE '%' || ? || '%')
      ORDER BY p.id DESC LIMIT 30`,
  ).bind(q, q, q, q, q).all<{ id: number }>();
  const out: ProjectShared[] = [];
  for (const row of res.results ?? []) {
    const one = await readProjectShared(db, Number(row.id), companySql);
    if (one) out.push(one);
  }
  return out;
}

/** The SO's copy of the shared fields as written by the SO form. */
export interface SoShared extends PropertyValue {
  customerName: string;
  phone: string;
  email: string;
  address1: string;
  address2: string;
  building: string;
  unitNo: string;
}

/** SO -> project: the SO's values become the project's (a blank email or address never wipes the project's). */
export async function writeSoToProject(db: Db, projectId: number, so: SoShared, actorId: number, companyId: number, docNo: string): Promise<void> {
  const site = siteAddressFromSo(so.address1, so.address2);
  await db.prepare(
    `UPDATE projects SET customer_name = coalesce(nullif(?, ''), customer_name), customer_phone = coalesce(nullif(?, ''), customer_phone),
            customer_email = coalesce(nullif(?, ''), customer_email), site_address = coalesce(nullif(?, ''), site_address),
            building = coalesce(nullif(?, ''), building), unit_no = coalesce(nullif(?, ''), unit_no),
            property_type = coalesce(nullif(?, ''), property_type), layout_label = coalesce(nullif(?, ''), layout_label),
            bedrooms = coalesce(?::int, bedrooms), bathrooms = coalesce(?::int, bathrooms),
            built_up_sqft = coalesce(?::numeric, built_up_sqft),
            updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      WHERE id = ? AND project_kind = 'renovation'`,
  ).bind(so.customerName, so.phone, so.email, site, so.building, so.unitNo, so.propertyType, so.layoutLabel,
    so.bedrooms, so.bathrooms, so.builtUpSqft, projectId).run();
  await regenerateProjectName(db, projectId);
  await db.prepare(`INSERT INTO project_activity (project_id, action, to_value, note, user_id, company_id) VALUES (?, 'customer_info_from_so', ?, ?, ?, ?)`)
    .bind(projectId, docNo, "Customer and property information saved from the sales order", actorId, companyId).run();
}

/** The project's name follows its building and unit (projectNameFrom in scm/shared/renovation-property.ts;
    the same rule in SQL, run after the fields it reads are saved). */
export async function regenerateProjectName(db: Db, projectId: number): Promise<void> {
  await db.prepare(
    `UPDATE projects SET name = coalesce(
        nullif(concat_ws(' ', nullif(regexp_replace(trim(coalesce(building, '')), '[[:space:]]+', ' ', 'g'), ''),
                              nullif(regexp_replace(trim(coalesce(unit_no, '')), '[[:space:]]+', ' ', 'g'), '')), ''),
        nullif(regexp_replace(trim(coalesce(customer_name, '')), '[[:space:]]+', ' ', 'g'), ''),
        name)
      WHERE id = ? AND project_kind = 'renovation'`,
  ).bind(projectId).run();
}

/** "Link existing SO" on the project (owner, 14 Oct 2026): the SO's customer, address and property come into
    the project at once. Every SO value that is filled wins; an empty SO value never clears a project field. */
export async function copySoIntoProject(db: Db, docNo: string, projectId: number, actorId: number, companyId: number): Promise<boolean> {
  if (!(await propertyColumnsReady(db))) return false;
  const r = await db.prepare(
    `SELECT debtor_name, phone, email, address1, address2, building, unit_no, property_type, layout_label, bedrooms, bathrooms,
            built_up_sqft::float8 AS built_up_sqft
       FROM scm.mfg_sales_orders WHERE doc_no = ?`,
  ).bind(docNo).first<Record<string, unknown>>();
  if (!r) return false;
  await writeSoToProject(db, projectId, {
    customerName: s(r.debtor_name), phone: s(r.phone), email: s(r.email), address1: s(r.address1), address2: s(r.address2),
    building: s(r.building), unitNo: s(r.unit_no), propertyType: s(r.property_type), layoutLabel: s(r.layout_label),
    bedrooms: n(r.bedrooms), bathrooms: n(r.bathrooms), builtUpSqft: n(r.built_up_sqft),
  }, actorId, companyId, docNo);
  return true;
}

/** Stamp the SO's own copy of the shared property fields and its project link. */
export async function writeSoPropertyColumns(db: Db, docNo: string, projectId: number | null, so: Pick<SoShared, keyof PropertyValue | "building" | "unitNo">): Promise<void> {
  await db.prepare(
    `UPDATE scm.mfg_sales_orders SET project_id = ?, building = nullif(?, ''), unit_no = nullif(?, ''), property_type = nullif(?, ''),
            layout_label = nullif(?, ''), bedrooms = ?::int, bathrooms = ?::int, built_up_sqft = ?::numeric, updated_at = now()
      WHERE doc_no = ? AND coalesce(so_kind, 'STANDARD') = 'STANDARD'`,
  ).bind(projectId, so.building, so.unitNo, so.propertyType, so.layoutLabel, so.bedrooms, so.bathrooms, so.builtUpSqft, docNo).run();
}

/** The SO's rooms: its ordered room list and each live line's room (lines of another order are never touched). */
export async function writeSoRooms(db: Db, docNo: string, sections: readonly string[], itemRooms: ReadonlyArray<{ id: string; room: string }>): Promise<void> {
  const known = await db.prepare(`SELECT id::text AS id FROM scm.mfg_sales_order_items WHERE doc_no = ?`).bind(docNo).all<{ id: string }>();
  const mine = new Set((known.results ?? []).map((r) => r.id));
  const rows = itemRooms.filter((r) => mine.has(r.id));
  const rooms = roomsWithLineRooms(sections, rows.map((r) => r.room));
  await db.prepare(`UPDATE scm.mfg_sales_orders SET room_sections = ?::text::jsonb, updated_at = now() WHERE doc_no = ?`)
    .bind(JSON.stringify(rooms), docNo).run();
  if (rows.length) {
    await db.prepare(
      `UPDATE scm.mfg_sales_order_items i SET room = nullif(x.room, '')
         FROM jsonb_to_recordset(?::text::jsonb) AS x(id uuid, room text)
        WHERE i.id = x.id AND i.doc_no = ?`,
    ).bind(JSON.stringify(rows), docNo).run();
  }
}

/** After a create: the inserted lines in line order take the rooms the form sent for its lines, matched by
    item code in order, so a line the server added (a free item) is left without a room instead of shifting. */
export function roomsForCreatedLines(
  inserted: ReadonlyArray<{ id: string; item_code: string | null }>,
  sent: ReadonlyArray<{ itemCode: string; room: string }>,
): Array<{ id: string; room: string }> {
  const queue = new Map<string, string[]>();
  for (const s of sent) {
    const list = queue.get(s.itemCode) ?? [];
    list.push(s.room);
    queue.set(s.itemCode, list);
  }
  const out: Array<{ id: string; room: string }> = [];
  for (const row of inserted) {
    const list = queue.get(row.item_code ?? '');
    const room = list?.shift();
    if (room) out.push({ id: row.id, room });
  }
  return out;
}

export async function readSoRooms(db: Db, docNo: string): Promise<{ roomSections: string[]; itemRooms: Record<string, string> }> {
  const h = await db.prepare(`SELECT room_sections FROM scm.mfg_sales_orders WHERE doc_no = ?`).bind(docNo).first<{ room_sections: unknown }>();
  const items = await db.prepare(`SELECT id::text AS id, room FROM scm.mfg_sales_order_items WHERE doc_no = ? AND room IS NOT NULL`).bind(docNo).all<{ id: string; room: string }>();
  const raw = typeof h?.room_sections === 'string' ? JSON.parse(h.room_sections) as unknown : h?.room_sections;
  return {
    roomSections: cleanRoomSections(raw),
    itemRooms: Object.fromEntries((items.results ?? []).map((r) => [r.id, r.room])),
  };
}

/** Project -> its open SOs (soOpenForProjectSync). Returns the doc numbers refreshed and those left as printed. */
export async function pushProjectToOpenSos(db: Db, projectId: number): Promise<{ updated: string[]; kept: string[] }> {
  const p = await db.prepare(
    `SELECT customer_name, customer_phone, customer_email, site_address, building, unit_no, property_type, layout_label,
            bedrooms, bathrooms, built_up_sqft::float8 AS built_up_sqft FROM projects WHERE id = ?`,
  ).bind(projectId).first<Record<string, unknown>>();
  if (!p) return { updated: [], kept: [] };
  const sos = await db.prepare(
    `SELECT doc_no, so_kind, status::text AS status, processing_date::text AS processing_date, proceeded_at::text AS proceeded_at
       FROM scm.mfg_sales_orders WHERE project_id = ? AND status::text <> 'CANCELLED' ORDER BY doc_no`,
  ).bind(projectId).all<{ doc_no: string; so_kind: string | null; status: string; processing_date: string | null; proceeded_at: string | null }>();
  const updated: string[] = [];
  const kept: string[] = [];
  const addr = soAddressFromSite(s(p.site_address));
  for (const so of sos.results ?? []) {
    if (!soOpenForProjectSync(so)) { kept.push(so.doc_no); continue; }
    await db.prepare(
      `UPDATE scm.mfg_sales_orders SET debtor_name = coalesce(nullif(?, ''), debtor_name), phone = coalesce(nullif(?, ''), phone),
              email = coalesce(nullif(?, ''), email), address1 = coalesce(nullif(?, ''), address1),
              address2 = CASE WHEN ? = '' THEN address2 ELSE nullif(?, '') END,
              building = ?, unit_no = ?, property_type = ?, layout_label = ?, bedrooms = ?::int, bathrooms = ?::int,
              built_up_sqft = ?::numeric, updated_at = now()
        WHERE doc_no = ? AND status::text IN ('DRAFT', 'CONFIRMED') AND processing_date IS NULL AND proceeded_at IS NULL`,
    ).bind(s(p.customer_name), s(p.customer_phone), s(p.customer_email), addr.address1, addr.address1, addr.address2,
      p.building ?? null, p.unit_no ?? null, p.property_type ?? null, p.layout_label ?? null, n(p.bedrooms), n(p.bathrooms), n(p.built_up_sqft),
      so.doc_no).run();
    updated.push(so.doc_no);
  }
  return { updated, kept };
}
