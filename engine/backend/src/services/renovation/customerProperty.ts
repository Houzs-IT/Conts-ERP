/* Customer + property information shared by a renovation sales order and its
   project (owner, 14 Oct 2026; migration 0112). The rule is written once in
   scm/shared/renovation-property.ts; this file is its database side.

   Every function here reads or writes only columns 0112 adds when
   propertyColumnsReady() says they exist, so an engine deployed before the
   migration is applied keeps working with Houzs's sales order form. */

import type { Db } from "./load";
import {
  SHARED_FIELDS,
  STRUCTURED_PROJECT_COLUMNS,
  cleanRoomSections,
  roomsWithLineRooms,
  readPropertyInput,
  renoSoRequiredProblems,
  siteAddressFromParts,
  soAddressFromSite,
  type PropertyProblem,
  type PropertyValue,
  type SharedCustomerProperty,
  type SharedFieldKey,
  type SharedFieldKind,
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
  /** The salesperson's name (scm.staff), for display. */
  salespersonName: string;
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/** True once migration 0115 is in this database (the project's structured address and salesperson). */
export async function structuredProjectColumnsReady(db: Db): Promise<boolean> {
  const r = await db.prepare(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
  ).bind(JSON.stringify(STRUCTURED_PROJECT_COLUMNS)).first<{ n: number }>();
  return Number(r?.n ?? 0) === STRUCTURED_PROJECT_COLUMNS.length;
}

/** The SQL for one shared field's bound value; '' binds as NULL. */
function castOf(kind: SharedFieldKind): string {
  return kind === "uuid" ? "nullif(?, '')::uuid" : kind === "int" ? "nullif(?, '')::int" : kind === "numeric" ? "nullif(?, '')::numeric" : "nullif(?, '')";
}
const bindOf = (v: unknown): string => (v == null ? "" : String(v).trim());

/** The shared fields this database can store on a project (all of them once 0115 is in). */
async function projectFields(db: Db) {
  const ready = await structuredProjectColumnsReady(db);
  return SHARED_FIELDS.filter((f) => ready || !STRUCTURED_PROJECT_COLUMNS.includes(f.project));
}

/** One shared value read off a row by its column. */
function valueOf(kind: SharedFieldKind, v: unknown): string | number | null {
  return kind === "int" || kind === "numeric" ? n(v) : s(v);
}

/** The shared fields of one renovation project of this company, or null. Read through to_jsonb so the
    0115 columns are simply blank before that migration is applied. */
export async function readProjectShared(db: Db, projectId: number, companySql: string): Promise<ProjectShared | null> {
  const r = await db.prepare(
    `SELECT to_jsonb(p) AS row, (SELECT st.name FROM scm.staff st WHERE st.id::text = to_jsonb(p)->>'salesperson_staff_id') AS salesperson_name
       FROM projects p WHERE p.id = ? AND p.project_kind = 'renovation'${companySql}`,
  ).bind(projectId).first<{ row: Record<string, unknown> | string; salesperson_name: string | null }>();
  if (!r) return null;
  const row = (typeof r.row === "string" ? JSON.parse(r.row) : r.row) as Record<string, unknown>;
  const shared: Record<string, unknown> = Object.fromEntries(SHARED_FIELDS.map((f) => [f.key, valueOf(f.kind, row[f.project])]));
  const site = s(row.site_address);
  /* A project saved before 0115: its single address shows as line 1 / line 2. */
  if (!shared.address1 && site) Object.assign(shared, soAddressFromSite(site));
  return {
    ...(shared as unknown as SharedCustomerProperty),
    siteAddress: site,
    id: Number(row.id), code: (row.code as string | null) ?? null, name: s(row.name),
    startDate: row.start_date ? s(row.start_date).slice(0, 10) : null, endDate: row.end_date ? s(row.end_date).slice(0, 10) : null,
    salespersonName: s(r.salesperson_name) || s(row.salesperson_name),
  };
}

/** Project edit / new project (the project is the master): every shared field is set as given, the single
    address column and the salesperson's name follow, and the name follows Building + Unit. */
export async function writeProjectShared(db: Db, projectId: number, v: Partial<Record<SharedFieldKey, unknown>>): Promise<void> {
  const fields = await projectFields(db);
  const sets = fields.map((f) => `${f.project} = ${castOf(f.kind)}`);
  const args = fields.map((f) => bindOf(v[f.key]));
  const site = siteAddressFromParts({ address1: s(v.address1), address2: s(v.address2), postcode: s(v.postcode), city: s(v.city), state: s(v.state) });
  const withStaff = fields.some((f) => f.key === "salespersonId");
  await db.prepare(
    `UPDATE projects SET ${sets.join(", ")}, site_address = nullif(?, '')${withStaff
      ? ", salesperson_name = coalesce((SELECT st.name FROM scm.staff st WHERE st.id = nullif(?, '')::uuid), salesperson_name)" : ""},
            updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      WHERE id = ? AND project_kind = 'renovation'`,
  ).bind(...args, site, ...(withStaff ? [bindOf(v.salespersonId)] : []), projectId).run();
  await regenerateProjectName(db, projectId);
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

/** The SO's values of the shared fields, by key. */
export type SoShared = Partial<Record<SharedFieldKey, string | number | null>>;

/** An SO's shared fields off its header (every SHARED_FIELDS column). */
export async function readSoShared(db: Db, docNo: string): Promise<SoShared | null> {
  const r = await db.prepare(`SELECT to_jsonb(o) AS row FROM scm.mfg_sales_orders o WHERE o.doc_no = ?`).bind(docNo).first<{ row: Record<string, unknown> | string }>();
  if (!r) return null;
  const row = (typeof r.row === "string" ? JSON.parse(r.row) : r.row) as Record<string, unknown>;
  return Object.fromEntries(SHARED_FIELDS.map((f) => [f.key, valueOf(f.kind, row[f.so])]));
}

/** SO -> project: every filled SO value becomes the project's; an empty one never clears a project field. */
export async function writeSoToProject(db: Db, projectId: number, so: SoShared, actorId: number, companyId: number, docNo: string): Promise<void> {
  const fields = await projectFields(db);
  const sets = fields.map((f) => `${f.project} = coalesce(${castOf(f.kind)}, ${f.project})`);
  const args = fields.map((f) => bindOf(so[f.key]));
  await db.prepare(
    `UPDATE projects SET ${sets.join(", ")},
            updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      WHERE id = ? AND project_kind = 'renovation'`,
  ).bind(...args, projectId).run();
  if (fields.some((f) => f.key === "address1")) {
    /* The single address column and the salesperson's name follow the structured fields just saved. */
    await db.prepare(
      `UPDATE projects SET
              site_address = coalesce(nullif(concat_ws(chr(10), nullif(address1, ''), nullif(address2, ''),
                nullif(concat_ws(' ', nullif(postcode, ''), nullif(city, '')), ''), nullif(state, '')), ''), site_address),
              salesperson_name = coalesce((SELECT st.name FROM scm.staff st WHERE st.id = salesperson_staff_id), salesperson_name)
        WHERE id = ? AND project_kind = 'renovation'`,
    ).bind(projectId).run();
  } else {
    const site = [s(so.address1), s(so.address2)].filter(Boolean).join("\n");
    await db.prepare(`UPDATE projects SET site_address = coalesce(nullif(?, ''), site_address) WHERE id = ?`).bind(site, projectId).run();
  }
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

/** "Link existing SO" on the project (owner, 14 Oct 2026): the SO's shared fields come into the project at
    once, by the same rule as saving the SO. */
export async function copySoIntoProject(db: Db, docNo: string, projectId: number, actorId: number, companyId: number): Promise<boolean> {
  if (!(await propertyColumnsReady(db))) return false;
  const so = await readSoShared(db, docNo);
  if (!so) return false;
  await writeSoToProject(db, projectId, so, actorId, companyId, docNo);
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

/** Project -> every linked SO that is not cancelled: every filled project value becomes the SO's; an empty one
    never clears an SO field. Returns the doc numbers refreshed (`kept` stays for callers and is always empty). */
export async function pushProjectToOpenSos(db: Db, projectId: number): Promise<{ updated: string[]; kept: string[] }> {
  const p = await readProjectShared(db, projectId, "");
  if (!p) return { updated: [], kept: [] };
  /* Every SO column exists; before 0115 the project's structured values are blank (its single address is split
     into lines 1 and 2 by readProjectShared), and a blank never clears the SO's. */
  const fields = SHARED_FIELDS;
  const sos = await db.prepare(
    `SELECT doc_no, so_kind, status::text AS status, processing_date::text AS processing_date, proceeded_at::text AS proceeded_at
       FROM scm.mfg_sales_orders WHERE project_id = ? AND status::text <> 'CANCELLED' ORDER BY doc_no`,
  ).bind(projectId).all<{ doc_no: string; so_kind: string | null; status: string; processing_date: string | null; proceeded_at: string | null }>();
  const updated: string[] = [];
  const kept: string[] = [];
  /* Before 0115 the project's address is its single text: lines 1 and 2 go across. */
  const values: Record<string, unknown> = { ...p };
  const sets = fields.map((f) => `${f.so} = coalesce(${castOf(f.kind)}, ${f.so})`);
  /* Every shared field is the same on both sides (owner, 1 Nov 2026: "Project 只要一连起来，相同的信息...两边要互通"):
     a filled project value reaches every linked SO that is not cancelled, a signed contract included. */
  for (const so of sos.results ?? []) {
    await db.prepare(`UPDATE scm.mfg_sales_orders SET ${sets.join(", ")}, updated_at = now() WHERE doc_no = ? AND status::text <> 'CANCELLED'`)
      .bind(...fields.map((f) => bindOf(values[f.key])), so.doc_no).run();
    updated.push(so.doc_no);
  }
  return { updated, kept };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** The project's Customer info as the shared block sends it, checked by the SO's own rules (same required
    fields, same number checks). `problems` empty means it may be saved. */
export async function readProjectCustomerInfo(db: Db, b: Record<string, unknown>): Promise<{ value: Partial<Record<SharedFieldKey, unknown>>; problems: PropertyProblem[] }> {
  const { value: prop, problems } = readPropertyInput(b);
  const value: Partial<Record<SharedFieldKey, unknown>> = {
    customerName: clip(b.customerName, 160), customerPhone: clip(b.customerPhone, 40), customerEmail: clip(b.customerEmail, 160),
    salespersonId: clip(b.salespersonId, 40), address1: clip(b.address1, 200), address2: clip(b.address2, 200), state: clip(b.state, 80),
    city: clip(b.city, 80), postcode: clip(b.postcode, 20), country: clip(b.country, 80), salesLocation: clip(b.salesLocation, 40),
    building: clip(b.building, 120), unitNo: clip(b.unitNo, 40), ...prop,
  };
  if (value.salespersonId) {
    const ok = UUID_RE.test(String(value.salespersonId))
      && !!(await db.prepare(`SELECT 1 AS ok FROM scm.staff WHERE id = ?::uuid`).bind(String(value.salespersonId)).first());
    if (!ok) problems.push({ code: "salesperson_unknown", message: "That salesperson is not an employee here.", field: "Salesperson" });
  }
  const invalid = new Set(problems.map((p) => p.field));
  for (const p of renoSoRequiredProblems({ customerName: String(value.customerName), phone: String(value.customerPhone), address1: String(value.address1), property: prop })) {
    if (!invalid.has(p.field)) problems.push(p);
  }
  return { value, problems };
}
