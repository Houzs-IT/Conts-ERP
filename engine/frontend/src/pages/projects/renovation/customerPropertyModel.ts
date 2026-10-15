/* The customer + property block shared by the renovation sales order form and the
   project screens (owner, 14 Oct 2026; migrations 0112, 0115): the same Customer,
   Delivery address and Order information fields on both. Pure form state: numbers
   stay strings while typed; the server reads and checks them
   (vendor/shared/renovation-property.ts, the same file the backend runs). */

import { parseCount, parseSqft, renoSoRequiredProblems } from "../../../vendor/shared/renovation-property";

export interface PropertyTypeOption { id: number; label: string; sort_order: number; active: boolean }
export interface LayoutOption { id: number; label: string; bedrooms: number; bathrooms: number; sort_order: number; active: boolean }
export interface PropertyLists { ready: boolean; propertyTypes: PropertyTypeOption[]; layouts: LayoutOption[] }

/** A project's shared fields as the server sends them. */
export interface ProjectShared {
  id: number;
  code: string | null;
  name: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  salespersonId: string;
  salespersonName: string;
  address1: string;
  address2: string;
  state: string;
  city: string;
  postcode: string;
  country: string;
  salesLocation: string;
  siteAddress: string;
  building: string;
  unitNo: string;
  propertyType: string;
  layoutLabel: string;
  bedrooms: number | null;
  bathrooms: number | null;
  builtUpSqft: number | null;
  startDate: string | null;
  endDate: string | null;
}

export interface CustomerPropertyValue {
  projectId: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  /** Employee id (scm.staff), '' when none. */
  salespersonId: string;
  address1: string;
  address2: string;
  state: string;
  city: string;
  postcode: string;
  country: string;
  salesLocation: string;
  building: string;
  unitNo: string;
  propertyType: string;
  layoutLabel: string;
  bedrooms: string;
  bathrooms: string;
  builtUpSqft: string;
}

/** Order of the fields as every form shows them (customer, delivery address, order information). */
export const BLOCK_STRING_KEYS = [
  "customerName", "customerPhone", "customerEmail", "salespersonId",
  "address1", "address2", "state", "city", "postcode", "country", "salesLocation",
  "building", "unitNo", "propertyType", "layoutLabel", "bedrooms", "bathrooms", "builtUpSqft",
] as const satisfies ReadonlyArray<keyof CustomerPropertyValue>;

export const EMPTY_CUSTOMER_PROPERTY: CustomerPropertyValue = {
  projectId: null, customerName: "", customerPhone: "", customerEmail: "", salespersonId: "",
  address1: "", address2: "", state: "", city: "", postcode: "", country: "", salesLocation: "",
  building: "", unitNo: "", propertyType: "", layoutLabel: "", bedrooms: "", bathrooms: "", builtUpSqft: "",
};

const numText = (n: number | null | undefined) => (n == null ? "" : String(n));

/** The block filled from a project (opening an SO from a project, or picking one). */
export function fromProject(p: ProjectShared): CustomerPropertyValue {
  return {
    projectId: p.id, customerName: p.customerName, customerPhone: p.customerPhone, customerEmail: p.customerEmail,
    salespersonId: p.salespersonId, address1: p.address1, address2: p.address2, state: p.state, city: p.city,
    postcode: p.postcode, country: p.country, salesLocation: p.salesLocation,
    building: p.building, unitNo: p.unitNo, propertyType: p.propertyType, layoutLabel: p.layoutLabel,
    bedrooms: numText(p.bedrooms), bathrooms: numText(p.bathrooms), builtUpSqft: numText(p.builtUpSqft),
  };
}

/** Picking a project on an SO: the project's values win where it has one, the SO keeps what it typed where the project is blank. */
export function mergeProjectIntoSo(v: CustomerPropertyValue, p: ProjectShared): CustomerPropertyValue {
  const fromP = fromProject(p);
  const out = { ...v, projectId: p.id };
  for (const k of Object.keys(fromP) as Array<keyof CustomerPropertyValue>) {
    if (k === "projectId") continue;
    const val = fromP[k];
    if (typeof val === "string" && val.trim() !== "") (out as Record<string, unknown>)[k] = val;
  }
  return out;
}

/** Fields the picked project has nothing in (by form label), for the note under Project. */
export function projectGaps(p: ProjectShared): string[] {
  const gaps: string[] = [];
  if (!p.customerName.trim()) gaps.push("customer");
  if (!p.customerPhone.trim()) gaps.push("phone");
  if (!p.address1.trim()) gaps.push("address");
  if (!p.building.trim() && !p.unitNo.trim()) gaps.push("building and unit");
  if (!p.propertyType.trim() || !p.layoutLabel.trim() || p.builtUpSqft == null) gaps.push("property");
  return gaps;
}

/** The layout list row matching the typed counts, if any. */
export function layoutFor(v: Pick<CustomerPropertyValue, "bedrooms" | "bathrooms" | "layoutLabel">, layouts: readonly LayoutOption[]): LayoutOption | null {
  const byLabel = layouts.find((l) => l.label.toLowerCase() === v.layoutLabel.trim().toLowerCase());
  if (byLabel && String(byLabel.bedrooms) === v.bedrooms && String(byLabel.bathrooms) === v.bathrooms) return byLabel;
  return layouts.find((l) => String(l.bedrooms) === v.bedrooms && String(l.bathrooms) === v.bathrooms && l.active) ?? null;
}

export function applyLayout(v: CustomerPropertyValue, layout: LayoutOption | null): CustomerPropertyValue {
  if (!layout) return { ...v, layoutLabel: "", bedrooms: "", bathrooms: "" };
  return { ...v, layoutLabel: layout.label, bedrooms: String(layout.bedrooms), bathrooms: String(layout.bathrooms) };
}

/** The `renovation` block the SO create / order-information save sends. */
export function toRenovationBlock(v: CustomerPropertyValue) {
  return {
    projectId: v.projectId, building: v.building.trim(), unitNo: v.unitNo.trim(), propertyType: v.propertyType,
    layoutLabel: v.layoutLabel, bedrooms: v.bedrooms.trim(), bathrooms: v.bathrooms.trim(), builtUpSqft: v.builtUpSqft.trim(),
  };
}

/** The body the project's PATCH /:id/customer-info takes. */
export function toProjectBody(v: CustomerPropertyValue) {
  return Object.fromEntries(BLOCK_STRING_KEYS.map((k) => [k, v[k].trim()])) as Record<(typeof BLOCK_STRING_KEYS)[number], string>;
}

/** Field labels to ring red: the same required list the server applies to the SO and to the project. */
export function missingFields(v: CustomerPropertyValue): Set<string> {
  const head = { customerName: v.customerName, phone: v.customerPhone, address1: v.address1 };
  const bedrooms = parseCount(v.bedrooms);
  const bathrooms = parseCount(v.bathrooms);
  const sqft = parseSqft(v.builtUpSqft);
  const out = new Set(renoSoRequiredProblems({
    ...head,
    property: {
      propertyType: v.propertyType, layoutLabel: v.layoutLabel,
      bedrooms: Number.isNaN(bedrooms) ? null : bedrooms, bathrooms: Number.isNaN(bathrooms) ? null : bathrooms,
      builtUpSqft: Number.isNaN(sqft) ? null : sqft,
    },
  }).map((p) => p.field));
  if (Number.isNaN(bedrooms) || Number.isNaN(bathrooms)) out.add("Layout");
  if (Number.isNaN(sqft)) out.add("Built-up sq ft");
  return out;
}

/** What the read-only Start date / End date show (owner, 15 Oct 2026; migration 0117). Nobody types them: the start
    is the day the project was created, the end the day it reached Closed. A sales order shows its project's dates,
    and a dash when it has no project; a project not yet created or not yet Closed says when the date will come. */
export function projectDatesText(project: Pick<ProjectShared, "startDate" | "endDate"> | null | undefined, mode: "so" | "project"): {
  start: string; end: string; startSet: boolean; endSet: boolean;
} {
  if (!project) {
    return mode === "so"
      ? { start: "—", end: "—", startSet: false, endSet: false }
      : { start: "Set when saved", end: "Set when Closed", startSet: false, endSet: false };
  }
  return {
    start: project.startDate ? showDate(project.startDate) : "—",
    end: project.endDate ? showDate(project.endDate) : "Set when Closed",
    startSet: !!project.startDate,
    endSet: !!project.endDate,
  };
}

/** "14 Oct 2026" from an ISO date, "Not set" when blank. */
export function showDate(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
