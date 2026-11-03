/* The amendment page's change labels (owner, 3 Nov 2026): reads the SO lines an amendment names and hands its lines to
   renovationVoChanges.ts. A renovation VO's amendment stores an edited line as a REMOVE and an ADD; here they come
   back as one card ("Qty changed 1 → 2"), built as a MODIFY line so the page's Was / Requesting card shows it whole. */

import { amendmentChanges, facetLabel, variantsAsOf, voTopic, type AmendmentChangeInput, type ChangeFacet, type OptionEdit } from "./renovationVoChanges";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (table: string) => any };

interface LineIn {
  id: string;
  amendment_id: string;
  sales_order_item_id: string | null;
  change_type: string;
  new_item_code: string | null;
  new_variants: unknown;
  new_qty: number | null;
  new_unit_price_sen: number | null;
  new_remark?: string | null;
  new_discount_sen?: number | null;
  old_snapshot: unknown;
}

export interface AmendmentChangeRow {
  lineIds: string[];
  facets: ChangeFacet[];
  labels: string[];
  /** The line the card renders: the stored line, or for a joined REMOVE + ADD a MODIFY made of the two. */
  line: LineIn;
}

export async function renovationAmendmentChanges(
  sb: Sb,
  amendment: { id?: string; so_doc_no: string; reason?: string | null; so_approved_at?: string | null; sent_at?: string | null; created_at?: string | null },
  lines: readonly LineIn[],
): Promise<{ topic: string; rows: AmendmentChangeRow[] } | null> {
  if (lines.length === 0) return { topic: voTopic(amendment.reason ?? null, []), rows: [] };
  const ids = [...new Set(lines.map((l) => l.sales_order_item_id).filter((x): x is string => !!x))];
  const cur = new Map<string, Record<string, unknown>>();
  if (ids.length) {
    const { data, error } = await sb.from("mfg_sales_order_items")
      .select("id, item_code, description, qty, unit_price_sen, variants, room, location").in("id", ids);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) cur.set(String(r.id), r);
  }
  const since = amendment.so_approved_at ?? amendment.sent_at ?? null;
  let edits: OptionEdit[] = [];
  if (since && lines.some((l) => String(l.change_type).toUpperCase() === "ADD")) {
    const { data } = await sb.from("mfg_so_audit_log").select("note, field_changes, created_at")
      .eq("so_doc_no", amendment.so_doc_no).eq("action", "UPDATE").gt("created_at", since).order("created_at", { ascending: true });
    edits = ((data ?? []) as Array<{ note: string | null; field_changes: unknown; created_at: string }>).map((e) => ({ note: e.note, field_changes: e.field_changes, at: e.created_at }));
  }
  const room = (r: Record<string, unknown> | undefined): string | null => {
    const v = String(r?.room ?? "").trim() || String(r?.location ?? "").trim();
    return v || null;
  };
  const inputs: AmendmentChangeInput[] = lines.map((l) => {
    const c = l.sales_order_item_id ? cur.get(l.sales_order_item_id) : undefined;
    const isAdd = String(l.change_type).toUpperCase() === "ADD";
    return {
      ...l,
      cur_item_code: (c?.item_code as string | null) ?? null,
      cur_description: (c?.description as string | null) ?? null,
      cur_qty: c?.qty == null ? null : Number(c.qty),
      cur_unit_price_sen: c?.unit_price_sen == null ? null : Number(c.unit_price_sen),
      cur_variants: isAdd ? variantsAsOf(l.new_item_code ?? (c?.item_code as string | null) ?? null, c?.variants ?? null, edits, since) : c?.variants ?? null,
      cur_room: room(c),
    };
  });
  const byId = new Map(lines.map((l) => [l.id, l]));
  const order = new Map(lines.map((l, i) => [l.id, i]));
  const first = (ids: string[]): number => Math.min(...ids.map((x) => order.get(x) ?? 0));
  const changes = amendmentChanges(inputs).sort((a, b) => first(a.lineIds) - first(b.lineIds));
  const rows: AmendmentChangeRow[] = changes.map((ch) => {
    const labels = ch.facets.map((f) => facetLabel(f));
    if (ch.lineIds.length === 2) {
      const [rid, aid] = ch.lineIds;
      const rem = byId.get(rid)!;
      const add = byId.get(aid)!;
      return {
        lineIds: ch.lineIds, facets: ch.facets, labels,
        line: {
          id: `${rid}+${aid}`, amendment_id: add.amendment_id, sales_order_item_id: add.sales_order_item_id, change_type: "MODIFY",
          new_item_code: ch.neu?.itemCode ?? add.new_item_code, new_variants: ch.neu?.variants ?? null, new_qty: ch.neu?.qty ?? add.new_qty,
          new_unit_price_sen: ch.neu?.unitPriceSen ?? add.new_unit_price_sen, new_remark: null, new_discount_sen: null, old_snapshot: rem.old_snapshot,
        },
      };
    }
    const l = byId.get(ch.lineIds[0])!;
    const isAdd = String(l.change_type).toUpperCase() === "ADD";
    return { lineIds: ch.lineIds, facets: ch.facets, labels, line: isAdd && ch.neu?.variants && l.new_variants == null ? { ...l, new_variants: ch.neu.variants } : l };
  });
  const topic = voTopic(amendment.reason ?? null, changes.map((ch) => ({
    description: ch.neu?.description || ch.old?.description || "", itemCode: ch.neu?.itemCode ?? ch.old?.itemCode ?? null, facets: ch.facets,
  })));
  return { topic, rows };
}
