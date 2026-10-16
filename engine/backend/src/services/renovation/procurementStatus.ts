/* Where a renovation project's goods stand (owner, 15 Oct 2026): for every item line of the project, whether it is
   ORDERED (on a live purchase order), RECEIVED (a goods receipt took it in) and DELIVERED (a delivery order handed it
   over, or a site receipt took it in at the unit itself), with the goods receipts and delivery orders that did it.
   The project's Procurement details card counts these per category / sub-category; it never lists the lines.

   An item line is a line of one of the project's sales orders (not the RENO- system rows), or a line of a project PO
   that no sales order line stands behind. Its category is its product's (migration 0061), else the PO line's
   (migration 0116). Reads only; the documents are linked the same way GET /:id/documents links them. */

import type { Db } from "./load";
import { DOS, GRS, POS, SOS, expand } from "./documents";

export interface GrRef { id: string; no: string; date: string | null; atSite: boolean; photos: number }
export interface DoRef { id: string; no: string; date: string | null; status: string; delivered: boolean; signed: boolean; hasPod: boolean }
/** A purchase order behind the line (owner, 16 Oct 2026: the card links every PO, DO and GR of a category). */
export interface PoRef { id: string; no: string; date: string | null; status: string }
export interface StatusLine {
  categoryGroup: string | null;
  subCategory: string | null;
  qty: number;
  orderedQty: number;
  receivedQty: number;
  deliveredQty: number;
  grs: GrRef[];
  dos: DoRef[];
  pos: PoRef[];
}

export interface SoLineRow { id: string; qty: number; category_group: string | null; sub_category: string | null }
export interface PoLineRow {
  id: string; so_item_id: string | null; qty: number; category_group: string | null; sub_category: string | null;
  po_id?: string | null; po_number?: string | null; po_date?: string | null; po_status?: string | null;
}
export interface GrLineRow { po_item_id: string | null; qty: number; grn_id: string; grn_number: string; date: string | null; at_site: boolean; photos: number }
export interface DoLineRow { so_item_id: string | null; qty: number; do_id: string; do_number: string; status: string; date: string | null; delivered: boolean; signed: boolean; has_pod: boolean }

const n = (v: unknown) => Number(v ?? 0);
const pushOnce = <T extends { id: string }>(list: T[], x: T) => { if (!list.some((y) => y.id === x.id)) list.push(x); };

/** One status line per item line, with its receipts and deliveries. Pure. */
export function buildStatusLines(so: readonly SoLineRow[], po: readonly PoLineRow[], gr: readonly GrLineRow[], dos: readonly DoLineRow[]): StatusLine[] {
  const poBySo = new Map<string, PoLineRow[]>();
  for (const p of po) if (p.so_item_id) poBySo.set(p.so_item_id, [...(poBySo.get(p.so_item_id) ?? []), p]);
  const grByPo = new Map<string, GrLineRow[]>();
  for (const g of gr) if (g.po_item_id) grByPo.set(g.po_item_id, [...(grByPo.get(g.po_item_id) ?? []), g]);
  const doBySo = new Map<string, DoLineRow[]>();
  for (const d of dos) if (d.so_item_id) doBySo.set(d.so_item_id, [...(doBySo.get(d.so_item_id) ?? []), d]);
  const soIds = new Set(so.map((s) => s.id));

  const line = (qty: number, cat: string | null, sub: string | null, poLines: readonly PoLineRow[], doLines: readonly DoLineRow[]): StatusLine => {
    const out: StatusLine = { categoryGroup: cat, subCategory: sub, qty, orderedQty: 0, receivedQty: 0, deliveredQty: 0, grs: [], dos: [], pos: [] };
    let siteQty = 0;
    for (const p of poLines) {
      out.orderedQty += n(p.qty);
      if (p.po_id && p.po_number) pushOnce(out.pos, { id: p.po_id, no: p.po_number, date: p.po_date ?? null, status: p.po_status ?? "" });
      for (const g of grByPo.get(p.id) ?? []) {
        out.receivedQty += n(g.qty);
        if (g.at_site) siteQty += n(g.qty);
        pushOnce(out.grs, { id: g.grn_id, no: g.grn_number, date: g.date, atSite: g.at_site, photos: n(g.photos) });
      }
    }
    let doQty = 0;
    for (const d of doLines) {
      if (d.delivered) doQty += n(d.qty);
      pushOnce(out.dos, { id: d.do_id, no: d.do_number, date: d.date, status: d.status, delivered: d.delivered, signed: d.signed, hasPod: d.has_pod });
    }
    /* A site receipt is the goods arriving at the unit: received and delivered at once. */
    out.deliveredQty = doQty + siteQty;
    return out;
  };

  const lines: StatusLine[] = [];
  for (const s of so) {
    if (n(s.qty) <= 0) continue;
    const poLines = poBySo.get(s.id) ?? [];
    lines.push(line(n(s.qty), s.category_group ?? poLines[0]?.category_group ?? null, s.sub_category ?? poLines[0]?.sub_category ?? null, poLines, doBySo.get(s.id) ?? []));
  }
  for (const p of po) {
    if (p.so_item_id && soIds.has(p.so_item_id)) continue;
    if (n(p.qty) <= 0) continue;
    lines.push(line(n(p.qty), p.category_group, p.sub_category, [p], []));
  }
  return lines;
}

const PRODUCT = (codeCol: string) => `LEFT JOIN LATERAL (SELECT m.category_group, m.sub_category FROM scm.mfg_products m
  WHERE m.code = ${codeCol} AND m.company_id = ?2 ORDER BY (m.status::text = 'ACTIVE') DESC LIMIT 1) pr ON true`;

export async function readStatusLines(db: Db, projectId: number, companyId: number): Promise<StatusLine[]> {
  const run = async <T>(sql: string) => {
    const q = expand(sql, projectId, companyId);
    return (await db.prepare(q.text).bind(...q.args).all<T>()).results ?? [];
  };
  const [so, po, gr, dos] = await Promise.all([
    run<SoLineRow>(
      `SELECT i.id::text AS id, i.qty, pr.category_group, pr.sub_category
         FROM scm.mfg_sales_order_items i ${PRODUCT("i.item_code")}
        WHERE i.doc_no IN (${SOS}) AND NOT i.cancelled AND coalesce(i.item_code, '') NOT LIKE 'RENO-%'`),
    run<PoLineRow>(
      `SELECT x.id::text AS id, x.so_item_id::text AS so_item_id, x.qty, po.id::text AS po_id, po.po_number,
              po.po_date::text AS po_date, po.status::text AS po_status,
              coalesce(x.category_group, pr.category_group) AS category_group, coalesce(x.sub_category, pr.sub_category) AS sub_category
         FROM scm.purchase_order_items x JOIN scm.purchase_orders po ON po.id = x.purchase_order_id ${PRODUCT("x.item_code")}
        WHERE po.id IN (${POS}) AND po.status::text <> 'CANCELLED'`),
    run<GrLineRow>(
      `SELECT gi.purchase_order_item_id::text AS po_item_id, gi.qty_accepted AS qty, g.id::text AS grn_id, g.grn_number,
              coalesce(g.site_received_at::date, g.received_at)::text AS date, g.received_at_site AS at_site,
              (SELECT count(*) FROM scm.grn_site_photos ph WHERE ph.grn_id = g.id)::int AS photos
         FROM scm.grn_items gi JOIN scm.grns g ON g.id = gi.grn_id
        WHERE g.id IN (${GRS}) AND g.status::text NOT IN ('CANCELLED', 'DRAFT')`),
    run<DoLineRow>(
      `SELECT di.so_item_id::text AS so_item_id, di.qty, d.id::text AS do_id, d.do_number, d.status::text AS status,
              coalesce(d.delivered_at::date, d.do_date)::text AS date,
              (d.delivered_at IS NOT NULL OR d.status::text IN ('SIGNED', 'DELIVERED', 'INVOICED')) AS delivered,
              d.signature_data IS NOT NULL AS signed, d.pod_r2_key IS NOT NULL AS has_pod
         FROM scm.delivery_order_items di JOIN scm.delivery_orders d ON d.id = di.delivery_order_id
        WHERE d.id IN (${DOS}) AND d.status::text NOT IN ('CANCELLED', 'DRAFT')`),
  ]);
  const bool = (v: unknown) => v === true || v === "t" || v === "true";
  return buildStatusLines(
    so,
    po,
    gr.map((g) => ({ ...g, at_site: bool(g.at_site) })),
    dos.map((d) => ({ ...d, delivered: bool(d.delivered), signed: bool(d.signed), has_pod: bool(d.has_pod) })),
  );
}
