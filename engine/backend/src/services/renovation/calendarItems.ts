/* Dated items of renovation projects for the Calendar's Week view (owner, 15 Oct 2026): the week shows what
   happens on each day, not project bars. Each item is one chip on one day:
     onsite    a design onsite visit (project_design_records.done_on)
     3d / 2d   a 3D or 2D submission (project_design_files.submitted_on, else the upload day in Malaysia)
     po        a PO date, delivery: a delivery date (project_procurement_dates: a category's own dates, and a
               sub-category's when it has its own; a following sub-category is its category's chip)
     task      a site task with planned dates, on every day of its planned range
     handover  the planned handover date
   Served by GET /api/projects/calendar/events?items=1 under the calendar's own scope. A source table missing
   in an environment that lags on migrations is left out, never fails the calendar. */

import { isMissingRelation, type Db } from "./load";

export type CalendarItemKind = "onsite" | "3d" | "2d" | "po" | "delivery" | "task" | "handover";

export interface CalendarItem {
  key: string;
  projectId: number;
  projectName: string;
  /** "<project short name>" for the chip, the full name stays in projectName */
  short: string;
  date: string;
  kind: CalendarItemKind;
  /** what the item is, e.g. "Onsite", "PO · Furniture", "Plumbing work" */
  what: string;
  done: boolean;
  brand: string | null;
  status: string | null;
  organizer: string | null;
}

export interface ItemProject { project_id: number; name: string; building: string | null; unit_no: string | null; brand: string | null; status: string | null; organizer: string | null }

const MAX_DAYS = 62;
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
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
  for (let i = 0; i < MAX_DAYS && isoDay(ms) <= last; i++, ms += DAY) out.push(isoDay(ms));
  return out;
}

export interface ItemSources {
  onsite: Array<ItemProject & { id: number; done_on: string | null }>;
  design: Array<ItemProject & { id: number; kind: string; version: number; on_day: string | null }>;
  procurement: Array<ItemProject & { group_code: string; sub_code: string; group_label: string | null; sub_label: string | null; po_date: string | null; delivery_date: string | null }>;
  tasks: Array<ItemProject & { id: number; label: string; state: string; planned_start: string | null; planned_end: string | null }>;
  handover: Array<ItemProject & { planned_handover_date: string | null; handed_over_at: string | null }>;
}

const KIND_ORDER: Record<CalendarItemKind, number> = { handover: 0, onsite: 1, "3d": 2, "2d": 3, po: 4, delivery: 5, task: 6 };

/** Pure: the chips inside [from, to], sorted by day, then kind, then project. */
export function buildCalendarItems(src: ItemSources, from: string, to: string): CalendarItem[] {
  const out: CalendarItem[] = [];
  const inRange = (d: string | null): d is string => !!d && d >= from && d <= to;
  const base = (p: ItemProject) => ({
    projectId: Number(p.project_id), projectName: p.name, short: shortProjectName(p), brand: p.brand, status: p.status, organizer: p.organizer,
  });
  for (const r of src.onsite) {
    const d = day(r.done_on);
    if (inRange(d)) out.push({ ...base(r), key: `onsite-${r.id}`, date: d, kind: "onsite", what: "Onsite", done: true });
  }
  for (const r of src.design) {
    const d = day(r.on_day);
    if (r.kind !== "3d" && r.kind !== "2d") continue;
    if (inRange(d)) out.push({ ...base(r), key: `design-${r.id}`, date: d, kind: r.kind, what: `${r.kind.toUpperCase()} v${r.version} submitted`, done: true });
  }
  for (const r of src.procurement) {
    const what = r.sub_code ? `${r.group_label ?? r.group_code} / ${r.sub_label ?? r.sub_code}` : (r.group_label ?? r.group_code);
    const po = day(r.po_date);
    const dl = day(r.delivery_date);
    const k = `${r.project_id}-${r.group_code}-${r.sub_code}`;
    if (inRange(po)) out.push({ ...base(r), key: `po-${k}`, date: po, kind: "po", what: `PO · ${what}`, done: false });
    if (inRange(dl)) out.push({ ...base(r), key: `delivery-${k}`, date: dl, kind: "delivery", what: `Delivery · ${what}`, done: false });
  }
  for (const r of src.tasks) {
    for (const d of daysWithin(day(r.planned_start), day(r.planned_end), from, to)) {
      out.push({ ...base(r), key: `task-${r.id}-${d}`, date: d, kind: "task", what: r.label, done: r.state === "done" });
    }
  }
  for (const r of src.handover) {
    const d = day(r.planned_handover_date);
    if (inRange(d)) out.push({ ...base(r), key: `handover-${r.project_id}`, date: d, kind: "handover", what: "Planned handover", done: r.handed_over_at != null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.short.localeCompare(b.short) || a.key.localeCompare(b.key));
}

const PROJECT_COLS = `p.id::int AS project_id, p.name, p.building, p.unit_no, p.brand, p.status, p.organizer`;
const RENO = `p.archived_at IS NULL AND coalesce(to_jsonb(p)->>'project_kind', 'exhibition') = 'renovation'`;

async function read<T>(db: Db, sql: string, binds: unknown[]): Promise<T[]> {
  try {
    const res = await db.prepare(sql).bind(...binds).all<T>();
    return (res.results ?? []) as T[];
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

/** Week-view items under the calendar route's scope: `scopeWhere` / `coSql` are its fragments (alias p),
    `scopeBinds` their binds. An invalid or over-long range answers no items. */
export async function renovationCalendarItems(db: Db, from: string, to: string, scopeWhere: string, scopeBinds: unknown[], coSql: string): Promise<CalendarItem[]> {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  from = String(from).slice(0, 10);
  to = String(to).slice(0, 10);
  if (!iso.test(from) || !iso.test(to) || to < from || (Date.parse(to) - Date.parse(from)) / DAY > MAX_DAYS) return [];
  const scope = `${scopeWhere}${coSql}`;
  const [onsite, design, procurement, tasks, handover] = await Promise.all([
    read<ItemSources["onsite"][number]>(db,
      `SELECT r.id::int AS id, r.done_on::text AS done_on, ${PROJECT_COLS}
         FROM project_design_records r JOIN projects p ON p.id = r.project_id
        WHERE ${RENO} AND r.done_on BETWEEN ?::date AND ?::date${scope}`, [from, to, ...scopeBinds]),
    read<ItemSources["design"][number]>(db,
      `SELECT f.id::int AS id, f.kind, f.version::int AS version, ${PROJECT_COLS},
              coalesce(to_jsonb(f)->>'submitted_on', ((f.uploaded_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::text) AS on_day
         FROM project_design_files f JOIN projects p ON p.id = f.project_id
        WHERE ${RENO} AND f.kind IN ('3d', '2d')
          AND coalesce((to_jsonb(f)->>'submitted_on')::date, (f.uploaded_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) BETWEEN ?::date AND ?::date${scope}`,
      [from, to, ...scopeBinds]),
    read<ItemSources["procurement"][number]>(db,
      `SELECT d.group_code, d.sub_code, g.label AS group_label, s.label AS sub_label,
              d.po_date::text AS po_date, d.delivery_date::text AS delivery_date, ${PROJECT_COLS}
         FROM project_procurement_dates d JOIN projects p ON p.id = d.project_id
         LEFT JOIN scm.product_category_groups g ON g.code = d.group_code
         LEFT JOIN scm.product_sub_categories s ON s.group_code = d.group_code AND s.code = d.sub_code
        WHERE ${RENO} AND (d.sub_code = '' OR d.mode = 'own') AND d.mode <> 'none'
          AND (d.po_date BETWEEN ?::date AND ?::date OR d.delivery_date BETWEEN ?::date AND ?::date)${scope}`,
      [from, to, from, to, ...scopeBinds]),
    read<ItemSources["tasks"][number]>(db,
      `SELECT t.id::int AS id, t.label, t.state, t.planned_start::text AS planned_start, t.planned_end::text AS planned_end, ${PROJECT_COLS}
         FROM project_trade_tasks t JOIN projects p ON p.id = t.project_id
        WHERE ${RENO} AND t.state <> 'skipped'
          AND coalesce(t.planned_start, t.planned_end) <= ?::date AND coalesce(t.planned_end, t.planned_start) >= ?::date${scope}`,
      [to, from, ...scopeBinds]),
    read<ItemSources["handover"][number]>(db,
      `SELECT p.planned_handover_date::text AS planned_handover_date, p.handed_over_at::text AS handed_over_at, ${PROJECT_COLS}
         FROM projects p
        WHERE ${RENO} AND p.planned_handover_date BETWEEN ?::date AND ?::date${scope}`, [from, to, ...scopeBinds]),
  ]);
  return buildCalendarItems({ onsite, design, procurement, tasks, handover }, from, to);
}
