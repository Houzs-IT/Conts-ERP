/* Renovation settings and the new-project form (owner requirements 11 Oct 2026,
   migration 0087): the auto project name, the SLA due date, and the checks for
   buildings, property types, contractors and SLA days. Pure. */

export const DEFAULT_BRAND_NAME = "Dream Crafter";

/** "<BUILDING> <UNIT> <CUSTOMER>" in capitals, like the owner's Notion titles ("BARON C-20-08 MR ALBERT"). */
export function autoProjectName(building: string | null | undefined, unitNo: string | null | undefined, customer: string | null | undefined): string {
  return [building, unitNo, customer]
    .map((x) => String(x ?? "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface SlaView {
  startDate: string;
  days: number;
  dueDate: string;
  /** days from today to the due date; negative once passed */
  daysLeft: number;
  /** passed and not yet handed over */
  overdue: boolean;
}

/** SLA due date = start + the project type's SLA days. The start is the project's start date, else the day it was
 *  created (Malaysia time). Read-time, so editing a type's SLA days moves its open projects' due dates. No SLA days, no SLA. */
export function slaOf(i: { startDate: string | null | undefined; createdAt: string | null | undefined; slaDays: number | null | undefined; handedOver: boolean; today: string }): SlaView | null {
  const days = Number(i.slaDays);
  if (!Number.isInteger(days) || days <= 0) return null;
  let start = String(i.startDate ?? "").slice(0, 10);
  if (!DATE.test(start)) {
    const created = i.createdAt ? new Date(String(i.createdAt)) : null;
    if (!created || Number.isNaN(created.getTime())) return null;
    start = new Date(created.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  }
  const dueDate = addDays(start, days);
  const daysLeft = daysBetween(i.today, dueDate);
  return { startDate: start, days, dueDate, daysLeft, overdue: !i.handedOver && daysLeft < 0 };
}

export type Clean<T> = { ok: true; value: T } | { ok: false; error: string; message: string };

const text = (x: unknown): string => String(x ?? "").trim().replace(/\s+/g, " ");
const optId = (x: unknown): number | null | "bad" => {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : "bad";
};

export function cleanSlaDays(x: unknown): Clean<number | null> {
  if (x == null || x === "") return { ok: true, value: null };
  const n = Number(x);
  if (!Number.isInteger(n) || n < 1 || n > 3650) return { ok: false, error: "sla_days_invalid", message: "SLA days must be a whole number from 1 to 3650." };
  return { ok: true, value: n };
}

export interface BuildingInput { name?: string; state?: string | null; propertyTypeId?: number | null; active?: boolean; sortOrder?: number }

/** A building needs a name (kept in capitals, like Notion's list); state and default property type are optional. */
export function cleanBuilding(b: Record<string, unknown>, patch = false): Clean<BuildingInput> {
  const out: BuildingInput = {};
  if (!patch || "name" in b) {
    const name = text(b.name).toUpperCase();
    if (!name) return { ok: false, error: "name_required", message: "Enter the building name." };
    if (name.length > 120) return { ok: false, error: "name_too_long", message: "Keep the building name under 120 characters." };
    out.name = name;
  }
  if (!patch || "state" in b) out.state = text(b.state) || null;
  if (!patch || "propertyTypeId" in b) {
    const id = optId(b.propertyTypeId);
    if (id === "bad") return { ok: false, error: "property_type_invalid", message: "Pick a property type from the list." };
    out.propertyTypeId = id;
  }
  if ("active" in b) out.active = b.active !== false;
  if ("sortOrder" in b && Number.isInteger(Number(b.sortOrder))) out.sortOrder = Number(b.sortOrder);
  return { ok: true, value: out };
}

export function cleanPropertyType(b: Record<string, unknown>, patch = false): Clean<{ name?: string; active?: boolean; sortOrder?: number }> {
  const out: { name?: string; active?: boolean; sortOrder?: number } = {};
  if (!patch || "name" in b) {
    const name = text(b.name);
    if (!name) return { ok: false, error: "name_required", message: "Enter the property type." };
    if (name.length > 60) return { ok: false, error: "name_too_long", message: "Keep the property type under 60 characters." };
    out.name = name;
  }
  if ("active" in b) out.active = b.active !== false;
  if ("sortOrder" in b && Number.isInteger(Number(b.sortOrder))) out.sortOrder = Number(b.sortOrder);
  return { ok: true, value: out };
}

export interface ContractorInput { name?: string; trade?: string | null; supplierId?: string | null; active?: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A contractor (subcontractor name, kept in capitals) and, optionally, the existing supplier it is. */
export function cleanContractor(b: Record<string, unknown>, patch = false): Clean<ContractorInput> {
  const out: ContractorInput = {};
  if (!patch || "name" in b) {
    const name = text(b.name).toUpperCase();
    if (!name) return { ok: false, error: "name_required", message: "Enter the contractor's name." };
    if (name.length > 80) return { ok: false, error: "name_too_long", message: "Keep the name under 80 characters." };
    out.name = name;
  }
  if (!patch || "trade" in b) out.trade = text(b.trade) || null;
  if (!patch && b.supplierId != null && b.supplierId !== "") {
    if (!UUID.test(String(b.supplierId))) return { ok: false, error: "supplier_invalid", message: "Pick the supplier from the list." };
    out.supplierId = String(b.supplierId);
  }
  if ("active" in b) out.active = b.active !== false;
  return { ok: true, value: out };
}

/** Supplier code for a new contractor: SC-<NAME>, letters and digits only. */
export function contractorSupplierCode(name: string): string {
  return `SC-${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "CONTRACTOR"}`;
}
