/* Design work (owner, 19 Nov 2026; migration 0342): the works of a renovation project, kept in Project Maintenance.
   The list is the calendar's Add work types; the works marked in_design are the rows of Design progress and the steps
   of the Design stage, in their order. Built-in works (system) keep their rule and cannot be removed:
     measure     Site measure: the booked site measure, or a measure recorded
     approve_3d  3D: Record approval
     approve_2d  2D: Record approval
     payment_2   Second payment: the second instalment received
     booking     done once its booked day has passed (after midnight), the day recorded
   Pure checks plus the reads and writes, on the D1-style Db of services/renovation/load.ts. */

import type { Db } from "./load";

export const WORK_RULES = ["booking", "measure", "approve_3d", "approve_2d", "payment_2"] as const;
export type WorkRule = (typeof WORK_RULES)[number];

export interface WorkType {
  id: number; code: string; label: string; rule: WorkRule; bookable: boolean; inDesign: boolean;
  sortOrder: number; active: boolean; system: boolean;
}

/** The built-in design works and the appointment each reads (null: not an appointment). */
export const SYSTEM_APPOINTMENT: Readonly<Record<string, "site_measure" | "carpentry_measure" | "site_briefing" | null>> = {
  measure: "site_measure", carpentry: "carpentry_measure", briefing: "site_briefing", w3d: null, w2d: null, payment_2: null,
};

/** What a company sees before migration 0342: the types the code used to carry. */
export const LEGACY_WORK_TYPES: readonly WorkType[] = [
  { code: "measure", label: "Site measure", rule: "measure", bookable: true, inDesign: true, sortOrder: 10, system: true },
  { code: "w3d", label: "3D", rule: "approve_3d", bookable: true, inDesign: true, sortOrder: 20, system: true },
  { code: "w2d", label: "2D", rule: "approve_2d", bookable: true, inDesign: true, sortOrder: 30, system: true },
  { code: "payment_2", label: "Second payment", rule: "payment_2", bookable: false, inDesign: true, sortOrder: 40, system: true },
  { code: "carpentry", label: "Carpentry measure", rule: "booking", bookable: true, inDesign: true, sortOrder: 50, system: true },
  { code: "briefing", label: "Site briefing", rule: "booking", bookable: true, inDesign: true, sortOrder: 60, system: true },
  { code: "update", label: "Drawing update", rule: "booking", bookable: true, inDesign: false, sortOrder: 110, system: false },
  { code: "client", label: "Client meeting", rule: "booking", bookable: true, inDesign: false, sortOrder: 120, system: false },
  { code: "meeting", label: "Internal meeting", rule: "booking", bookable: true, inDesign: false, sortOrder: 130, system: false },
  { code: "amend", label: "Amendment", rule: "booking", bookable: true, inDesign: false, sortOrder: 140, system: false },
  { code: "po", label: "PO / C.PO", rule: "booking", bookable: true, inDesign: false, sortOrder: 150, system: false },
].map((w, i) => ({ id: -(i + 1), active: true, ...w }) as WorkType);

interface Row { id: number; code: string; label: string; rule: string; bookable: boolean; in_design: boolean; sort_order: number; active: boolean; system: boolean }
const fromRow = (r: Row): WorkType => ({
  id: Number(r.id), code: r.code, label: r.label, rule: (WORK_RULES as readonly string[]).includes(r.rule) ? (r.rule as WorkRule) : "booking",
  bookable: !!r.bookable, inDesign: !!r.in_design, sortOrder: Number(r.sort_order), active: !!r.active, system: !!r.system,
});

const missingTable = (e: unknown): boolean => /project_work_types/.test(String((e as Error)?.message ?? e)) && /does not exist|relation/.test(String((e as Error)?.message ?? e));

/** The company's works in order, archived ones too; the legacy list until migration 0342 is applied. */
export async function listWorkTypes(db: Db, companyId: number): Promise<WorkType[]> {
  try {
    const r = await db.prepare(
      `SELECT id::int AS id, code, label, rule, bookable, in_design, sort_order::int AS sort_order, active, system
         FROM project_work_types WHERE company_id = ? ORDER BY sort_order, id`,
    ).bind(companyId).all<Row>();
    const rows = (r.results ?? []).map(fromRow);
    return rows.length ? rows : [...LEGACY_WORK_TYPES];
  } catch (e) {
    if (missingTable(e)) return [...LEGACY_WORK_TYPES];
    throw e;
  }
}

/** An event may take any active work of the list, or one of the old types while the list is not there. */
export async function eventTypeKnown(db: Db, companyId: number, code: string): Promise<boolean> {
  const list = await listWorkTypes(db, companyId);
  return list.some((w) => w.code === code && w.active);
}

type Clean<T> = { ok: true; value: T } | { ok: false; error: string; message: string };
const no = (error: string, message: string) => ({ ok: false as const, error, message });

export interface WorkTypeInput { label?: string; bookable?: boolean; inDesign?: boolean; sortOrder?: number; active?: boolean }

/** A new work: a name, bookable, in Design progress or not. Its code is made from the name. */
export function cleanNewWorkType(b: Record<string, unknown>, taken: readonly string[]): Clean<Required<Pick<WorkTypeInput, "label" | "bookable" | "inDesign">> & { code: string; sortOrder: number }> {
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (label.length < 1 || label.length > 60) return no("label_invalid", "Name the work (up to 60 characters).");
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "work";
  let code = base, n = 2;
  while (taken.includes(code)) code = `${base}_${n++}`;
  const sortOrder = typeof b.sortOrder === "number" && Number.isInteger(b.sortOrder) ? b.sortOrder : 1000;
  return { ok: true, value: { label, code, bookable: b.bookable !== false, inDesign: b.inDesign === true, sortOrder } };
}

/** A change to a work. A built-in work keeps its rule: it may be renamed, reordered and moved in or out of Design
    progress, never archived or made bookable when its rule is not a booking. */
export function cleanWorkTypePatch(b: Record<string, unknown>, cur: WorkType): Clean<WorkTypeInput> {
  const out: WorkTypeInput = {};
  if (b.label !== undefined) {
    const label = typeof b.label === "string" ? b.label.trim() : "";
    if (label.length < 1 || label.length > 60) return no("label_invalid", "Name the work (up to 60 characters).");
    out.label = label;
  }
  if (b.sortOrder !== undefined) {
    if (typeof b.sortOrder !== "number" || !Number.isInteger(b.sortOrder) || b.sortOrder < 0 || b.sortOrder > 100000) return no("order_invalid", "Order is a whole number.");
    out.sortOrder = b.sortOrder;
  }
  if (b.inDesign !== undefined) out.inDesign = b.inDesign === true;
  if (b.bookable !== undefined) {
    if (cur.system && cur.rule !== "booking" && cur.rule !== "measure" && b.bookable === true && !cur.bookable) return no("fixed_rule", `${cur.label} keeps its own rule.`);
    if (cur.system && cur.rule === "booking" && b.bookable === false) return no("fixed_rule", `${cur.label} is done by its booked day, so it stays bookable.`);
    out.bookable = b.bookable === true;
  }
  if (b.active !== undefined) {
    if (cur.system && b.active === false) return no("fixed_rule", `${cur.label} is built in and cannot be switched off.`);
    out.active = b.active === true;
  }
  return { ok: true, value: out };
}
