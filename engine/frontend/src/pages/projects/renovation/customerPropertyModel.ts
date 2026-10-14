/* The customer + property block shared by the renovation sales order form and the
   project screens (owner, 14 Oct 2026; migration 0112). Pure form state: numbers
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
  siteAddress: string;
  building: string;
  unitNo: string;
  propertyType: string;
  layoutLabel: string;
  bedrooms: string;
  bathrooms: string;
  builtUpSqft: string;
}

export const EMPTY_CUSTOMER_PROPERTY: CustomerPropertyValue = {
  projectId: null, customerName: "", customerPhone: "", customerEmail: "", siteAddress: "", building: "", unitNo: "",
  propertyType: "", layoutLabel: "", bedrooms: "", bathrooms: "", builtUpSqft: "",
};

const numText = (n: number | null | undefined) => (n == null ? "" : String(n));

/** The block filled from a project (opening an SO from a project, or picking one). */
export function fromProject(p: ProjectShared): CustomerPropertyValue {
  return {
    projectId: p.id, customerName: p.customerName, customerPhone: p.customerPhone, customerEmail: p.customerEmail,
    siteAddress: p.siteAddress, building: p.building, unitNo: p.unitNo, propertyType: p.propertyType, layoutLabel: p.layoutLabel,
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
  return {
    customerName: v.customerName.trim(), customerPhone: v.customerPhone.trim(), customerEmail: v.customerEmail.trim(),
    siteAddress: v.siteAddress.trim(), building: v.building.trim(), unitNo: v.unitNo.trim(), propertyType: v.propertyType,
    layoutLabel: v.layoutLabel, bedrooms: v.bedrooms.trim(), bathrooms: v.bathrooms.trim(), builtUpSqft: v.builtUpSqft.trim(),
  };
}

/** Field labels to ring red: the same required list the server applies to a renovation SO. */
export function missingFields(v: CustomerPropertyValue, head: { customerName: string; phone: string; address1: string }): Set<string> {
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

/** "14 Oct 2026" from an ISO date, "Not set" when blank. */
export function showDate(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
