/* What the VO list shows for each renovation VO (owner, 6 Nov 2026): what changed, the net, the contract before and
   after, the PO impact, and on opening a row each Added, Changed and Removed line with its Before, After and Amount.
   One batched read per table over the list's rows: the Workers plan caps outside calls per request.
   A value the record does not hold stays null. Imported VOs may have no before value, and it is never worked back. */

import { chunkIn } from "../../scm/lib/paginate-all";
import { amendmentChanges, asObject, type AmendmentChange, type AmendmentChangeInput } from "./renovationVoChanges";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (table: string) => any };

export type VoLineChange = "Added" | "Changed" | "Removed";

export interface VoListSide { qty: number | null; uom: string | null; unitPriceSen: number | null }

export interface VoListLine {
  change: VoLineChange;
  room: string | null;
  itemCode: string | null;
  description: string;
  /** null: Added has none, or the record does not hold it. */
  before: VoListSide | null;
  after: VoListSide | null;
  amountSen: number | null;
}

export interface VoListPoFix { poNumber: string | null; action: "AMEND" | "CANCEL"; newQty: number | null; open: boolean }

export interface VoListDetail {
  added: number;
  changed: number;
  removed: number;
  netSen: number | null;
  beforeSen: number | null;
  afterSen: number | null;
  signedName: string | null;
  signedAt: string | null;
  poFixes: VoListPoFix[];
  lines: VoListLine[];
}

export interface VoAmendmentLine {
  id: string;
  amendment_id: string;
  sales_order_item_id: string | null;
  change_type: string;
  new_item_code: string | null;
  new_qty: number | null;
  new_unit_price_sen: number | null;
  new_discount_sen: number | null;
  old_snapshot: unknown;
}

export interface VoSoItem {
  id: string;
  item_code: string | null;
  description: string | null;
  qty: number | null;
  unit_price_sen: number | null;
  uom: string | null;
  location: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The old line's money, or null when the snapshot does not hold it. */
function snapshotTotal(o: Record<string, unknown>): number | null {
  const stored = num(o.total_sen);
  if (stored !== null) return stored;
  const qty = num(o.qty);
  const price = num(o.unit_price_sen ?? o.unitPriceSen);
  return qty !== null && price !== null ? qty * price - (num(o.discount_sen ?? o.discountSen) ?? 0) : null;
}

const changeOf = (ch: AmendmentChange): VoLineChange => (!ch.old ? "Added" : !ch.neu ? "Removed" : "Changed");

/** A VO's stored lines as the rows of its dropdown. `amendmentChanges` joins a REMOVE and its ADD back into one change. */
export function voListLines(lines: readonly VoAmendmentLine[], items: ReadonlyMap<string, VoSoItem>): VoListLine[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const inputs: AmendmentChangeInput[] = lines.map((l) => {
    const c = l.sales_order_item_id ? items.get(l.sales_order_item_id) : undefined;
    return {
      ...l,
      cur_item_code: c?.item_code ?? null,
      cur_description: c?.description ?? null,
      cur_qty: num(c?.qty),
      cur_unit_price_sen: num(c?.unit_price_sen),
      cur_room: c?.location?.trim() || null,
    };
  });
  return amendmentChanges(inputs).map((ch) => {
    const rows = ch.lineIds.map((id) => byId.get(id)!);
    const removed = rows.find((r) => String(r.change_type).toUpperCase() !== "ADD") ?? null;
    const added = rows.find((r) => String(r.change_type).toUpperCase() !== "REMOVE") ?? null;
    /* A removed or changed line's before lives only in old_snapshot. Reading it off the SO line would show the after. */
    const snap = removed ? asObject(removed.old_snapshot) : null;
    const uomOf = (id: string | null | undefined): string | null => (id ? items.get(id)?.uom ?? null : null);
    const before: VoListSide | null = snap && ch.old ? {
      qty: num(snap.qty),
      unitPriceSen: num(snap.unit_price_sen ?? snap.unitPriceSen),
      uom: (snap.uom as string | null | undefined) ?? uomOf(removed?.sales_order_item_id),
    } : null;
    const after: VoListSide | null = ch.neu ? {
      qty: ch.neu.qty,
      unitPriceSen: ch.neu.unitPriceSen,
      uom: uomOf(added?.sales_order_item_id) ?? before?.uom ?? null,
    } : null;
    const oldTotal = snap ? snapshotTotal(snap) : null;
    const newTotal = after && after.qty !== null && after.unitPriceSen !== null
      ? after.qty * after.unitPriceSen - (num(added?.new_discount_sen) ?? 0) : null;
    const change = changeOf(ch);
    const amountSen = change === "Added" ? newTotal
      : change === "Removed" ? (oldTotal === null ? null : -oldTotal)
      : (oldTotal === null || newTotal === null ? null : newTotal - oldTotal);
    return {
      change, amountSen, before, after,
      room: ch.neu?.room ?? ch.old?.room ?? null,
      itemCode: ch.neu?.itemCode ?? ch.old?.itemCode ?? null,
      description: ch.neu?.description || ch.old?.description || "",
    };
  });
}

interface VoHead { id: string; amendment_id: string; net_sen: number | null; signed_name: string | null; signed_at: string | null }
interface PoFlag { vo_id: string; purchase_order_item_id: string; action: "AMEND" | "CANCEL"; new_qty: number | null; status: string }

/** Keyed by so_amendments.id. An amendment that is not a renovation VO has no entry. */
export async function voListDetails(sb: Sb, amendmentIds: readonly string[], finance: boolean): Promise<Map<string, VoListDetail>> {
  const out = new Map<string, VoListDetail>();
  if (amendmentIds.length === 0) return out;
  const must = <T>(r: { data: T[]; error: { message: string } | null }): T[] => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  const heads = must(await chunkIn<VoHead>(amendmentIds, (b, from, to) =>
    sb.from("reno_variation_orders").select("id, amendment_id, net_sen, signed_name, signed_at").in("amendment_id", b).range(from, to)));
  if (heads.length === 0) return out;
  const ids = heads.map((h) => h.amendment_id);

  const lines = must(await chunkIn<VoAmendmentLine>(ids, (b, from, to) =>
    sb.from("so_amendment_lines")
      .select("id, amendment_id, sales_order_item_id, change_type, new_item_code, new_qty, new_unit_price_sen, new_discount_sen, old_snapshot")
      .in("amendment_id", b).range(from, to)));
  const itemIds = [...new Set(lines.map((l) => l.sales_order_item_id).filter((x): x is string => !!x))];
  const items = new Map<string, VoSoItem>();
  if (itemIds.length) {
    const rows = must(await chunkIn<VoSoItem>(itemIds, (b, from, to) =>
      sb.from("mfg_sales_order_items").select("id, item_code, description, qty, unit_price_sen, uom, location").in("id", b).range(from, to)));
    for (const r of rows) items.set(r.id, r);
  }

  /* The contract as it stood before each VO, frozen when the VO was applied (renovation-vo.ts applyVo). */
  const revisions = must(await chunkIn<{ amendment_id: string; before: unknown }>(ids, (b, from, to) =>
    sb.from("so_revisions").select("amendment_id, before:snapshot->header->local_total_sen").in("amendment_id", b).range(from, to)));
  const beforeOf = new Map(revisions.map((r) => [r.amendment_id, num(r.before)]));

  const flags = must(await chunkIn<PoFlag>(heads.map((h) => h.id), (b, from, to) =>
    sb.from("reno_po_line_flags").select("vo_id, purchase_order_item_id, action, new_qty, status").in("vo_id", b).range(from, to)));
  const poOfLine = new Map<string, string>();
  if (flags.length) {
    const poLines = must(await chunkIn<{ id: string; purchase_order_id: string }>([...new Set(flags.map((f) => f.purchase_order_item_id))], (b, from, to) =>
      sb.from("purchase_order_items").select("id, purchase_order_id").in("id", b).range(from, to)));
    const pos = must(await chunkIn<{ id: string; po_number: string }>([...new Set(poLines.map((l) => l.purchase_order_id))], (b, from, to) =>
      sb.from("purchase_orders").select("id, po_number").in("id", b).range(from, to)));
    const numberOf = new Map(pos.map((p) => [p.id, p.po_number]));
    for (const l of poLines) {
      const n = numberOf.get(l.purchase_order_id);
      if (n) poOfLine.set(l.id, n);
    }
  }

  for (const h of heads) {
    const voLines = voListLines(lines.filter((l) => l.amendment_id === h.amendment_id), items);
    const count = (c: VoLineChange) => voLines.filter((l) => l.change === c).length;
    const beforeSen = beforeOf.get(h.amendment_id) ?? null;
    const netSen = num(h.net_sen);
    out.set(h.amendment_id, {
      added: count("Added"), changed: count("Changed"), removed: count("Removed"),
      netSen: finance ? netSen : null,
      beforeSen: finance ? beforeSen : null,
      afterSen: finance && beforeSen !== null && netSen !== null ? beforeSen + netSen : null,
      signedName: h.signed_name, signedAt: h.signed_at,
      poFixes: flags.filter((f) => f.vo_id === h.id).map((f) => ({
        poNumber: poOfLine.get(f.purchase_order_item_id) ?? null, action: f.action, newQty: num(f.new_qty), open: f.status === "OPEN",
      })),
      lines: finance ? voLines : voLines.map((l) => ({
        ...l, amountSen: null,
        before: l.before && { ...l.before, unitPriceSen: null },
        after: l.after && { ...l.after, unitPriceSen: null },
      })),
    });
  }
  return out;
}
