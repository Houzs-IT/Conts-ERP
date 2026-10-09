/* Proof of delivery / completion on the project.

   A line has POD when one of these covers it in full:
     - a site receipt (GRN received_at_site) on its PO line: photos + signature at the unit
     - a delivery order from our warehouse that is signed/delivered with a POD
       (signature or photo) on the engine's existing MobilePOD
   A stage completes only when every line it owns has a POD (spec section 5). */

import type { StageView } from "./stages";

export interface LinePod {
  /** qty received on site receipts for this SO line */
  siteQty: number;
  /** qty on delivered DOs that carry a POD */
  doPodQty: number;
}

export interface PodCoverage {
  total: number;
  covered: number;
  missing: string[];
}

export function podCoverage(
  view: Pick<StageView, "ownedLineIds">,
  qtyBySoItem: ReadonlyMap<string, number>,
  pods: ReadonlyMap<string, LinePod>,
): PodCoverage {
  const missing: string[] = [];
  for (const id of view.ownedLineIds) {
    const need = qtyBySoItem.get(id) ?? 0;
    if (need <= 0) continue;
    const p = pods.get(id) ?? { siteQty: 0, doPodQty: 0 };
    if (p.siteQty + p.doPodQty < need) missing.push(id);
  }
  const total = view.ownedLineIds.filter((id) => (qtyBySoItem.get(id) ?? 0) > 0).length;
  return { total, covered: total - missing.length, missing };
}

export interface EvidencePhoto {
  id: string;
  kind: string;
  location: string | null;
  r2_key: string;
  caption?: string | null;
  taken_at?: string | null;
  grn_id?: string | null;
  grn_number?: string | null;
  source: "site_receipt" | "delivery_order" | "checklist" | "task";
}

export interface EvidenceGroup {
  room: string;
  photos: EvidencePhoto[];
}

/** Photos grouped by room, rooms in first-seen order, unknown room last. */
export function groupEvidence(photos: readonly EvidencePhoto[]): EvidenceGroup[] {
  const groups = new Map<string, EvidencePhoto[]>();
  const NONE = "No room";
  for (const p of photos) {
    const room = String(p.location ?? "").trim() || NONE;
    const list = groups.get(room) ?? [];
    list.push(p);
    groups.set(room, list);
  }
  const out = [...groups.entries()].map(([room, list]) => ({ room, photos: list }));
  return out.sort((a, b) => (a.room === NONE ? 1 : 0) - (b.room === NONE ? 1 : 0));
}
