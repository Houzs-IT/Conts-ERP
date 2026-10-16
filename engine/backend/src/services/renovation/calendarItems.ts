/* Dated items of renovation projects for the Calendar (owner, 15 Oct 2026; Notion-style cards, 16 Oct 2026).
   Each item is one card on the calendar, from `date` to `end` (one day when they are equal):
     onsite     a site measure (project_design_records.done_on), by the people recorded on it
     3d / 2d    a 3D or 2D submission (project_design_files.submitted_on, else the upload day in Malaysia)
     amendment  a 3D / 2D amendment request (project_design_notes.noted_on), for the project's designer
     po         a PO date, delivery: a delivery date (project_procurement_dates: a category's own dates, and a
                sub-category's when it has its own; a following sub-category is its category's card)
     task       a site task over its planned range, by its crew (project_trade_task_assignees)
     handover   the planned handover date
   PO, delivery and handover belong to the project's renovation PIC. Every card carries a department, the colour
   the calendar paints it: the department of its people's roles (project_people.roles), preferring the one the
   kind of work belongs to, else the kind's own. Served by GET /api/projects/calendar/events?items=1 under the
   calendar's own scope. A source table missing in an environment that lags on migrations is left out (or read
   without its people), never fails the calendar. */

import { isMissingRelation, type Db } from "./load";

export type CalendarItemKind = "onsite" | "3d" | "2d" | "amendment" | "po" | "delivery" | "task" | "handover";
export type CalendarDepartment = "design" | "sales" | "renovation" | "management" | "site_crew";

export interface CalendarPerson { id: number; name: string; roles: string[] }

export interface CalendarItem {
  key: string;
  projectId: number;
  projectName: string;
  projectCode: string | null;
  /** "<project short name>" for the card, the full name stays in projectName */
  short: string;
  /** first day (YYYY-MM-DD) */
  date: string;
  /** last day, inclusive; equal to `date` for a one-day item */
  end: string;
  kind: CalendarItemKind;
  /** the card's heading, upper case: "SITE MEASURE", "3D 1ST SUBMISSION", "PLUMBING WORK" */
  title: string;
  /** what the item is in a sentence, e.g. "Onsite", "PO · Furniture", "Plumbing work" */
  what: string;
  done: boolean;
  people: CalendarPerson[];
  department: CalendarDepartment;
  /** a site task's subcontractor */
  supplier: string | null;
  brand: string | null;
  status: string | null;
  organizer: string | null;
}

export interface ItemProject {
  project_id: number; name: string; code?: string | null; building: string | null; unit_no: string | null;
  brand: string | null; status: string | null; organizer: string | null;
  /** the project's renovation PIC / designer as {id, name, roles} (json from the database, maybe as text) */
  reno_pic?: unknown; designer?: unknown;
}

const DAY = 86_400_000;
const MAX_DAYS = 62;
const day = (x: unknown): string | null => {
  if (x == null) return null;
  const s = x instanceof Date ? x.toISOString() : String(x);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** "Skyline A-12-3" from building "Skyline Residence" + unit "A-12-3" (two words when the first is under five
    letters: "Eco Sky 15-06"); the project name when there is no unit. */
export function shortProjectName(p: Pick<ItemProject, "name" | "building" | "unit_no">): string {
  const unit = p.unit_no?.trim();
  if (!unit) return p.name;
  const words = (p.building ?? "").trim().split(/\s+/).filter(Boolean);
  const b = words.slice(0, words[0] && words[0].length < 5 ? 2 : 1).join(" ");
  return b ? `${b} ${unit}` : unit;
}

/** The days of [start, end] that fall inside [from, to]; one date when the other is missing. */
export function daysWithin(start: string | null, end: string | null, from: string, to: string): string[] {
  const s = start ?? end;
  const e = end ?? start;
  if (!s || !e || e < s) return s && s >= from && s <= to ? [s] : [];
  const out: string[] = [];
  let ms = Date.parse(`${s < from ? from : s}T00:00:00Z`);
  const last = e > to ? to : e;
  for (let i = 0; i < MAX_DAYS && new Date(ms).toISOString().slice(0, 10) <= last; i++, ms += DAY) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

/** People from a json column: an array, one object, or either as text; anything else is nobody. */
export function peopleOf(x: unknown): CalendarPerson[] {
  let v = x;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  const out: CalendarPerson[] = [];
  for (const p of list as Array<Record<string, unknown> | null>) {
    if (!p || typeof p !== "object") continue;
    const id = Number(p.id);
    if (!Number.isFinite(id) || id <= 0 || out.some((o) => o.id === id)) continue;
    let roles = p.roles;
    if (typeof roles === "string") roles = roles.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
    out.push({ id, name: String(p.name ?? ""), roles: Array.isArray(roles) ? roles.map(String) : [] });
  }
  return out;
}

const ROLE_DEPARTMENT: Readonly<Partial<Record<string, CalendarDepartment>>> = {
  designer: "design", sales: "sales", reno_pic: "renovation", admin: "management", boss: "management", site_crew: "site_crew",
};
/** When one person holds several roles, the one that names their department. */
const DEPARTMENT_ORDER: readonly CalendarDepartment[] = ["design", "renovation", "sales", "site_crew", "management"];

/** The departments a person's roles put them in, most telling first. */
export function personDepartments(roles: readonly string[]): CalendarDepartment[] {
  const set = new Set(roles.map((r) => ROLE_DEPARTMENT[r]).filter((d): d is CalendarDepartment => !!d));
  return DEPARTMENT_ORDER.filter((d) => set.has(d));
}

/** The card's department: the kind's own (`base`) when one of its people is in it, else the first person's
    department, else the kind's own. */
export function itemDepartment(base: CalendarDepartment, people: readonly CalendarPerson[]): CalendarDepartment {
  const depts = people.map((p) => personDepartments(p.roles));
  if (depts.some((d) => d.includes(base))) return base;
  return depts.find((d) => d.length > 0)?.[0] ?? base;
}

const ORDINAL = (n: number) => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "TH" : (["TH", "ST", "ND", "RD"][n % 10] ?? "TH");
  return `${n}${s}`;
};

export interface ItemSources {
  onsite: Array<ItemProject & { id: number; done_on: string | null; people?: unknown }>;
  design: Array<ItemProject & { id: number; kind: string; version: number; on_day: string | null; people?: unknown }>;
  amendments?: Array<ItemProject & { id: number; kind: string; noted_on: string | null; closed: boolean | null }>;
  procurement: Array<ItemProject & { group_code: string; sub_code: string; group_label: string | null; sub_label: string | null; po_date: string | null; delivery_date: string | null }>;
  tasks: Array<ItemProject & {
    id: number; label: string; state: string; planned_start: string | null; planned_end: string | null;
    people?: unknown; supplier_name?: string | null; fulfilment_kind?: string | null; category_stage?: string | null;
  }>;
  handover: Array<ItemProject & { planned_handover_date: string | null; handed_over_at: string | null }>;
}

const KIND_ORDER: Record<CalendarItemKind, number> = { handover: 0, onsite: 1, "3d": 2, "2d": 3, amendment: 4, po: 5, delivery: 6, task: 7 };

/** Pure: the cards overlapping [from, to], sorted by first day, then kind, then project. */
export function buildCalendarItems(src: ItemSources, from: string, to: string): CalendarItem[] {
  const out: CalendarItem[] = [];
  const inRange = (d: string | null): d is string => !!d && d >= from && d <= to;
  const base = (p: ItemProject) => ({
    projectId: Number(p.project_id), projectName: p.name, projectCode: p.code ?? null, short: shortProjectName(p),
    brand: p.brand, status: p.status, organizer: p.organizer, supplier: null as string | null,
  });
  const push = (p: ItemProject, x: Omit<CalendarItem, keyof ReturnType<typeof base> | "end" | "department"> & { end?: string; supplier?: string | null }, dept: CalendarDepartment) =>
    out.push({ ...base(p), ...x, end: x.end ?? x.date, department: itemDepartment(dept, x.people) });

  for (const r of src.onsite) {
    const d = day(r.done_on);
    if (inRange(d)) push(r, { key: `onsite-${r.id}`, date: d, kind: "onsite", title: "SITE MEASURE", what: "Onsite", done: true, people: peopleOf(r.people) }, "design");
  }
  for (const r of src.design) {
    const d = day(r.on_day);
    if (r.kind !== "3d" && r.kind !== "2d") continue;
    if (inRange(d)) {
      push(r, {
        key: `design-${r.id}`, date: d, kind: r.kind, title: `${r.kind.toUpperCase()} ${ORDINAL(Number(r.version) || 1)} SUBMISSION`,
        what: `${r.kind.toUpperCase()} v${r.version} submitted`, done: true, people: peopleOf(r.people),
      }, "design");
    }
  }
  for (const r of src.amendments ?? []) {
    const d = day(r.noted_on);
    if (r.kind !== "3d" && r.kind !== "2d") continue;
    if (inRange(d)) {
      push(r, {
        key: `amendment-${r.id}`, date: d, kind: "amendment", title: `${r.kind.toUpperCase()} AMENDMENT`,
        what: `${r.kind.toUpperCase()} amendment`, done: !!r.closed, people: peopleOf(r.designer),
      }, "design");
    }
  }
  for (const r of src.procurement) {
    const what = r.sub_code ? `${r.group_label ?? r.group_code} / ${r.sub_label ?? r.sub_code}` : (r.group_label ?? r.group_code);
    const po = day(r.po_date);
    const dl = day(r.delivery_date);
    const k = `${r.project_id}-${r.group_code}-${r.sub_code}`;
    const people = peopleOf(r.reno_pic);
    if (inRange(po)) push(r, { key: `po-${k}`, date: po, kind: "po", title: `PO · ${what}`.toUpperCase(), what: `PO · ${what}`, done: false, people }, "renovation");
    if (inRange(dl)) push(r, { key: `delivery-${k}`, date: dl, kind: "delivery", title: `DELIVERY · ${what}`.toUpperCase(), what: `Delivery · ${what}`, done: false, people }, "renovation");
  }
  for (const r of src.tasks) {
    const s = day(r.planned_start) ?? day(r.planned_end);
    let e = day(r.planned_end) ?? s;
    if (!s || !e) continue;
    if (e < s) e = s;
    if (e < from || s > to) continue;
    const dept: CalendarDepartment = r.category_stage === "design" ? "design" : r.fulfilment_kind === "internal" ? "site_crew" : "renovation";
    push(r, {
      key: `task-${r.id}`, date: s, end: e, kind: "task", title: r.label.toUpperCase(), what: r.label, done: r.state === "done",
      people: peopleOf(r.people), supplier: r.supplier_name ?? null,
    }, dept);
  }
  for (const r of src.handover) {
    const d = day(r.planned_handover_date);
    if (inRange(d)) push(r, { key: `handover-${r.project_id}`, date: d, kind: "handover", title: "HANDOVER", what: "Planned handover", done: r.handed_over_at != null, people: peopleOf(r.reno_pic) }, "renovation");
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.short.localeCompare(b.short) || a.key.localeCompare(b.key));
}

const PERSON_JSON = (alias: string) => `json_build_object('id', ${alias}.id::int, 'name', ${alias}.name, 'roles', to_json(${alias}.roles))`;
const PROJECT_COLS = `p.id::int AS project_id, p.code, p.name, p.building, p.unit_no, p.brand, p.status, p.organizer`;
const PIC_COL = `(SELECT ${PERSON_JSON("pic")} FROM project_people pic WHERE pic.id = p.reno_pic_person_id) AS reno_pic`;
const DESIGNER_COL = `(SELECT ${PERSON_JSON("des")} FROM project_people des WHERE des.id = p.designer_person_id) AS designer`;
const RENO = `p.archived_at IS NULL AND coalesce(to_jsonb(p)->>'project_kind', 'exhibition') = 'renovation'`;

/** Rows of `sql`; when one of its tables is missing, rows of `fallback` (the same without the newer joins), else none. */
async function read<T>(db: Db, sql: string, binds: unknown[], fallback?: string): Promise<T[]> {
  try {
    const res = await db.prepare(sql).bind(...binds).all<T>();
    return (res.results ?? []) as T[];
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    return fallback ? read<T>(db, fallback, binds) : [];
  }
}

/** Calendar items under the calendar route's scope: `scopeWhere` / `coSql` are its fragments (alias p),
    `scopeBinds` their binds. An invalid or over-long range answers no items. */
export async function renovationCalendarItems(db: Db, from: string, to: string, scopeWhere: string, scopeBinds: unknown[], coSql: string): Promise<CalendarItem[]> {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  from = String(from).slice(0, 10);
  to = String(to).slice(0, 10);
  if (!iso.test(from) || !iso.test(to) || to < from || (Date.parse(to) - Date.parse(from)) / DAY > MAX_DAYS) return [];
  const scope = `${scopeWhere}${coSql}`;
  const agg = (join: string) => `coalesce((SELECT json_agg(${PERSON_JSON("pp")} ORDER BY pp.name) ${join}), '[]'::json)`;
  const onsiteSql = (people: string) =>
    `SELECT r.id::int AS id, r.done_on::text AS done_on, ${people} AS people, ${PROJECT_COLS}
       FROM project_design_records r JOIN projects p ON p.id = r.project_id
      WHERE ${RENO} AND r.done_on BETWEEN ?::date AND ?::date${scope}`;
  const designSql = (people: string) =>
    `SELECT f.id::int AS id, f.kind, f.version::int AS version, ${people} AS people, ${PROJECT_COLS},
            coalesce(to_jsonb(f)->>'submitted_on', ((f.uploaded_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::text) AS on_day
       FROM project_design_files f JOIN projects p ON p.id = f.project_id
      WHERE ${RENO} AND f.kind IN ('3d', '2d')
        AND coalesce((to_jsonb(f)->>'submitted_on')::date, (f.uploaded_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) BETWEEN ?::date AND ?::date${scope}`;
  const ownPerson = (col: string) => agg(`FROM project_people pp WHERE pp.id = ${col}`);
  const taskSql = (people: string, extra: string, joins: string) =>
    `SELECT t.id::int AS id, t.label, t.state, t.planned_start::text AS planned_start, t.planned_end::text AS planned_end,
            t.fulfilment_kind, ${people} AS people, ${extra}, ${PROJECT_COLS}
       FROM project_trade_tasks t JOIN projects p ON p.id = t.project_id${joins}
      WHERE ${RENO} AND t.state <> 'skipped'
        AND coalesce(t.planned_start, t.planned_end) <= ?::date AND coalesce(t.planned_end, t.planned_start) >= ?::date${scope}`;
  const [onsite, design, amendments, procurement, tasks, handover] = await Promise.all([
    read<ItemSources["onsite"][number]>(db,
      onsiteSql(`coalesce(nullif(${agg("FROM project_design_record_people rp JOIN project_people pp ON pp.id = rp.person_id WHERE rp.record_id = r.id")}::text, '[]')::json, ${ownPerson("r.person_id")})`),
      [from, to, ...scopeBinds], onsiteSql(ownPerson("r.person_id"))),
    read<ItemSources["design"][number]>(db,
      designSql(`coalesce(nullif(${agg("FROM project_design_file_people fp JOIN project_people pp ON pp.id = fp.person_id WHERE fp.file_id = f.id")}::text, '[]')::json, ${ownPerson("f.person_id")})`),
      [from, to, ...scopeBinds], designSql(ownPerson("f.person_id"))),
    read<NonNullable<ItemSources["amendments"]>[number]>(db,
      `SELECT n.id::int AS id, n.kind, n.noted_on::text AS noted_on, (to_jsonb(n)->>'closed_at') IS NOT NULL AS closed, ${DESIGNER_COL}, ${PROJECT_COLS}
         FROM project_design_notes n JOIN projects p ON p.id = n.project_id
        WHERE ${RENO} AND n.noted_on BETWEEN ?::date AND ?::date${scope}`, [from, to, ...scopeBinds]),
    read<ItemSources["procurement"][number]>(db,
      `SELECT d.group_code, d.sub_code, g.label AS group_label, s.label AS sub_label,
              d.po_date::text AS po_date, d.delivery_date::text AS delivery_date, ${PIC_COL}, ${PROJECT_COLS}
         FROM project_procurement_dates d JOIN projects p ON p.id = d.project_id
         LEFT JOIN scm.product_category_groups g ON g.code = d.group_code
         LEFT JOIN scm.product_sub_categories s ON s.group_code = d.group_code AND s.code = d.sub_code
        WHERE ${RENO} AND (d.sub_code = '' OR d.mode = 'own') AND d.mode <> 'none'
          AND (d.po_date BETWEEN ?::date AND ?::date OR d.delivery_date BETWEEN ?::date AND ?::date)${scope}`,
      [from, to, from, to, ...scopeBinds]),
    read<ItemSources["tasks"][number]>(db,
      taskSql(
        agg("FROM project_trade_task_assignees a JOIN project_people pp ON pp.id = a.person_id WHERE a.task_id = t.id"),
        `sup.name AS supplier_name, cat.stage_key AS category_stage`,
        `\n       LEFT JOIN scm.suppliers sup ON sup.id = t.supplier_id
       LEFT JOIN project_task_categories cat ON cat.company_id = t.company_id AND cat.code = t.category_code`,
      ),
      [to, from, ...scopeBinds],
      taskSql(`'[]'::json`, `NULL AS supplier_name, NULL AS category_stage`, "")),
    read<ItemSources["handover"][number]>(db,
      `SELECT p.planned_handover_date::text AS planned_handover_date, p.handed_over_at::text AS handed_over_at, ${PIC_COL}, ${PROJECT_COLS}
         FROM projects p
        WHERE ${RENO} AND p.planned_handover_date BETWEEN ?::date AND ?::date${scope}`, [from, to, ...scopeBinds]),
  ]);
  return buildCalendarItems({ onsite, design, amendments, procurement, tasks, handover }, from, to);
}

/** The people (project_people ids) the signed-in user is, for the calendar's "My tasks": linked by engine user,
    or by the Property OS account with the same email (public.conts_staff, migration 0113). */
export async function calendarMePersonIds(db: Db, userId: number | null | undefined, email: string | null | undefined): Promise<number[]> {
  if (!userId && !email) return [];
  const byUser = `SELECT pp.id::int AS id FROM project_people pp WHERE pp.user_id = ?`;
  let rows: Array<{ id: number }> = [];
  try {
    rows = (await db.prepare(`${byUser} OR pp.pos_user_id IN (SELECT s.id::text FROM conts_staff s WHERE lower(s.email) = lower(?))`)
      .bind(userId ?? 0, email ?? "").all<{ id: number }>()).results ?? [];
  } catch {
    // Before migration 0113 there is no account link; the engine user link still counts.
    rows = await read<{ id: number }>(db, byUser, [userId ?? 0]).catch(() => []);
  }
  return [...new Set(rows.map((r) => Number(r.id)))];
}
