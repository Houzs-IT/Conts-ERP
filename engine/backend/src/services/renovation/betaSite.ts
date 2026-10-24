/* Beta workspace: Site & photos, Defects as repair tickets, and the Timeline (owner, 24 Oct 2026; BRIEF-beta-oct24
   sections 5 to 8). Pure rules for routes/renovationBeta.ts: input checks, how deliveries and their photos are put
   together, and which Timeline filter an entry belongs to. No database here. */

import type { BetaRefusal } from "./beta";
import { isIsoDay, BETA_TRADES, DEFECT_DESCRIPTION_MAX, DEFECT_LOCATION_MAX, type BetaTrade } from "./beta";
import type { TimelineCategory, TimelineEntry } from "./timeline";

const no = (error: string, message: string): { ok: false; error: string; message: string } => ({ ok: false, error, message });
type Json = Record<string, unknown>;

/* ---------- Site & photos: deliveries with their proof photos ---------- */

export type DeliveryType = "delivery_order" | "goods_received";

export interface SitePhoto {
  id: string;
  /** The API path that streams it (the project's own file route or the project's document-file route). */
  path: string;
  name: string;
  image: boolean;
  /** Photo, video, or another file (a PDF): the screens draw a video as a play tile and never a broken photo. */
  kind: "image" | "video" | "file";
  /** The room the photo was taken in, when the site team tagged it. */
  area: string | null;
  at: string | null;
  source: "pod" | "site" | "upload";
}

export interface SiteDelivery {
  type: DeliveryType;
  id: string;
  no: string;
  /** When it reached the unit: delivered / received on site, else the document's date. */
  at: string | null;
  status: string;
  /** Supplier for a goods receipt; the sales order for a delivery order. */
  from: string | null;
  poNumber: string | null;
  poIds: string[];
  /** The rooms of the sales order lines it carries, in line order. */
  areas: string[];
  /** The lines it carries: the sales order line (null when none) and, on a goods receipt, the PO line. */
  lines: DeliveryLine[];
  photos: SitePhoto[];
}

export interface DeliveryLine { soItemId: string | null; poLineId: string | null; qty: number }

/** Trimmed, de-duplicated (case-insensitive, first spelling kept), in the order given. */
export function uniqueAreas(xs: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const s = String(x ?? "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

const IMAGE = /\.(png|jpe?g|webp|gif|heic)$/i;
export const isImageName = (name: string, mime?: string | null): boolean => IMAGE.test(name) || String(mime ?? "").startsWith("image/");

/** Newest first; undated last, keeping their order. */
export function sortDeliveries(list: SiteDelivery[]): SiteDelivery[] {
  return [...list].sort((a, b) => (a.at && b.at ? b.at.localeCompare(a.at) : a.at ? -1 : b.at ? 1 : 0));
}

/* ---------- Defects as repair tickets ---------- */

export interface DefectPatch {
  assigneePersonId?: number | null;
  trade?: BetaTrade | null;
  dueDate?: string | null;
  location?: string | null;
  description?: string;
}

const isTrade = (x: unknown): x is BetaTrade => typeof x === "string" && (BETA_TRADES as readonly string[]).includes(x);

/** Only the fields sent change; at least one must be sent. */
export function cleanDefectPatch(b: Json): BetaRefusal<DefectPatch> {
  const out: DefectPatch = {};
  if ("assigneePersonId" in b) {
    const v = b.assigneePersonId;
    if (v == null || v === "") out.assigneePersonId = null;
    else if (typeof v === "number" && Number.isInteger(v) && v > 0) out.assigneePersonId = v;
    else return no("person_invalid", "Pick who fixes it from the list.");
  }
  if ("trade" in b) {
    if (b.trade == null || b.trade === "") out.trade = null;
    else if (isTrade(b.trade)) out.trade = b.trade;
    else return no("trade_invalid", "Pick the kind of work from the list.");
  }
  if ("dueDate" in b) {
    if (b.dueDate == null || b.dueDate === "") out.dueDate = null;
    else if (isIsoDay(b.dueDate)) out.dueDate = b.dueDate;
    else return no("date_invalid", "Give the fix-by date as YYYY-MM-DD.");
  }
  if ("location" in b) {
    if (b.location != null && typeof b.location !== "string") return no("location_invalid", "The area must be text.");
    const s = typeof b.location === "string" ? b.location.trim().slice(0, DEFECT_LOCATION_MAX) : "";
    out.location = s || null;
  }
  if ("description" in b) {
    const s = typeof b.description === "string" ? b.description.trim().slice(0, DEFECT_DESCRIPTION_MAX) : "";
    if (!s) return no("description_required", "Say what is wrong.");
    out.description = s;
  }
  if (Object.keys(out).length === 0) return no("nothing_to_change", "Nothing to change.");
  return { ok: true, value: out };
}

/** The assignee given when reporting (optional). */
export function cleanAssignee(b: Json): BetaRefusal<number | null> {
  const v = b.assigneePersonId;
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return { ok: true, value: v };
  return no("person_invalid", "Pick who fixes it from the list.");
}

/** "Fix by 31 Oct · Ali" style note for the activity row of an edit. */
export function defectPatchNote(p: DefectPatch, personName: string | null): string | null {
  const parts: string[] = [];
  if ("assigneePersonId" in p) parts.push(p.assigneePersonId == null ? "No one named to fix it" : `To fix: ${personName ?? "someone"}`);
  if ("trade" in p) parts.push(p.trade ? `Work: ${p.trade}` : "No kind of work");
  if ("dueDate" in p) parts.push(p.dueDate ? `Fix by ${p.dueDate}` : "No fix-by date");
  if ("location" in p) parts.push(p.location ? `Area: ${p.location}` : "No area");
  if ("description" in p) parts.push("Description changed");
  return parts.join(" · ") || null;
}

/* ---------- Timeline: one filter per entry ---------- */

/** The engine timeline reads every history row as "system"; Beta files each under what it is about. */
export function betaCategory(e: Pick<TimelineEntry, "id" | "category" | "title">): TimelineCategory {
  if (e.category !== "system") return e.category;
  const id = e.id;
  const t = (e.title ?? "").toLowerCase();
  if (/^(po|gr|do|deliv|grsite):/.test(id)) return "supplier";
  if (/^(so|pay|vo):/.test(id)) return "sales";
  if (/^(design|dnote|onsite):/.test(id)) return "design";
  if (/^key:/.test(id) || id === "project:handover") return "site";
  if (/^defect|key passed|handed over|handover|site task|task |snag/.test(t)) return "site";
  if (/(3d|2d|drawing|design|approval|amendment|site measure|carpentry measure|site briefing)/.test(t)) return "design";
  if (/^reminder|customer/.test(t)) return "customer";
  if (/(sales order|payment|invoice|variation)/.test(t)) return "sales";
  return "system";
}

export const money = (sen: number): string => `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
