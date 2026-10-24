/* Beta workspace, bundle B: the VO, PO and Client PO tabs (owner, 24 Oct 2026). Read only.

   VO: the owner calls every sales order amendment a VO. A project's VOs are
   - the engine's SO amendments (scm.so_amendments) on any non-cancelled SO of the project, and
   - the renovation contract's own variation orders (scm.reno_variation_orders, renovation-vo.ts).
   Approving a renovation VO writes an so_amendments row too (amendment_id); that row is shown once, as the VO,
   because the VO carries the add / omit lines with their room and amounts.
   PO: every purchase order stamped with the project (purchase_orders.project_id, 0116) or holding a line bought for
   one of the project's SO lines (purchase_order_items.so_item_id).
   Client PO: SO lines the client buys: supplied by the owner, or a customer-supplied SKU (supplier CUSTOMER, the
   CUS-* placeholders; isCustomerSupplied in renovation-po-split.ts). */

import { readVo } from "../../scm/lib/renovation-vo";
import { isCustomerSupplied, poPickerOffers, voGoesTo } from "../../scm/lib/renovation-po-split";
import { renoDbFromD1 } from "./dbBridge";
import type { Db } from "./load";

async function rows<T>(db: Db, sql: string, ...args: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...args).all<T>();
  return (res.results ?? []) as T[];
}

const TS = (col: string): string => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** The project's live SOs, as a subquery on `so` (the alias the caller joins). */
const PROJECT_SO = `so.project_id = ? AND so.company_id = ? AND so.status::text <> 'CANCELLED'`;

export type VoBucket = "pending" | "approved" | "closed";
/** po: we buy it; client: the client buys it (Client PO); works: our own works or service, nothing is bought. */
export type GoesTo = "po" | "client" | "works";

export interface VoLine {
  itemCode: string | null;
  description: string;
  room: string | null;
  /** + added, - deducted, 0 a change that keeps the quantity (a different spec or price). */
  qty: number;
  /** A measured line's size (for example "12.5 sqft"); qty is then 1 or -1. */
  measure: string | null;
  /** null when finance figures are hidden, or the record does not hold the before value. */
  amountSen: number | null;
  change: "add" | "deduct" | "change";
  /** The line's quantity after the VO, shown when the VO changes only its price (qty is then 0). */
  lineQty: number | null;
  goesTo: GoesTo;
  /** A spec change: the item code it replaced. */
  fromItemCode: string | null;
  /** What a change to an existing line moved, in words ("Colour: White -> Grey", "Remark: ..."), so a change that
      costs nothing (a colour or a remark) still reads as a record. Empty for an added or removed line. */
  changes?: string[];
}

export interface VoRow {
  key: string;
  /** VO-01, VO-02, ... in the order they were raised on this project. */
  label: string;
  source: "amendment" | "renovation";
  no: string;
  soDocNo: string;
  title: string | null;
  status: string;
  statusLabel: string;
  bucket: VoBucket;
  date: string | null;
  raisedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** A sales order VO, recorded and applied at once (no approver): read "Recorded <date> by <raisedBy>". */
  recorded: boolean;
  netSen: number | null;
  /** The engine screen that shows this VO in full. */
  href: string;
  lines: VoLine[];
}

export interface VoTotals { addedSen: number; deductedSen: number; netSen: number; pendingNetSen: number }

export interface VoAnswer {
  /** The project's current SO, where "New VO" goes: a renovation contract raises a VO, any other SO its amendment. */
  so: { docNo: string; renovation: boolean } | null;
  finance: boolean;
  vos: VoRow[];
  counts: { pending: number; approved: number; closed: number };
  totals: VoTotals | null;
}

/* ---------- pure pieces (tested) ---------- */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function snapshotOf(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try { const o = JSON.parse(v); return o && typeof o === "object" ? (o as Record<string, unknown>) : {}; } catch { return {}; }
  }
  return {};
}

export interface AmendmentLineRow {
  change_type: string;
  new_item_code: string | null;
  new_qty: number | null;
  new_unit_price_sen: number | null;
  new_discount_sen: number | null;
  new_remark?: string | null;
  new_variants?: unknown;
  old_snapshot: unknown;
  cur_item_code: string | null;
  cur_description: string | null;
  cur_qty: number | null;
  cur_total_sen: number | null;
  product_name: string | null;
  /** The SO line's room (its renovation line's room, else its own room / location), when the line exists. */
  cur_room?: string | null;
  cur_item_group?: string | null;
  /** The SKU's catalog category and main supplier code, for where the line goes. */
  product_category?: string | null;
  main_supplier?: string | null;
}

const VARIANT_LABEL: Readonly<Record<string, string>> = {
  colorCode: "Colour", colourLabel: "Colour", colourId: "Colour", fabricCode: "Fabric", fabricLabel: "Fabric", size: "Size",
  legHeight: "Leg", divanHeight: "Divan", gap: "Gap", totalHeight: "Total height", seatHeight: "Seat",
};

const shown = (v: unknown): string => (v === null || v === undefined || v === "" ? "none" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The fields a change to an existing line moved, in words. Variants are compared key by key, the remark key aside
    (it rides new_remark; amendment-noop-lines.ts). */
export function lineChangeWords(l: Pick<AmendmentLineRow, "change_type" | "new_item_code" | "new_qty" | "new_remark" | "new_variants" | "old_snapshot">): string[] {
  const type = String(l.change_type ?? "").toUpperCase();
  if (type === "ADD" || type === "REMOVE") return [];
  const old = snapshotOf(l.old_snapshot);
  const out: string[] = [];
  const oldCode = (old.item_code ?? old.itemCode ?? null) as string | null;
  if (l.new_item_code && oldCode && l.new_item_code !== oldCode) out.push(`SKU: ${oldCode} -> ${l.new_item_code}`);
  const oldQty = num(old.qty);
  const newQty = num(l.new_qty);
  if (newQty !== null && oldQty !== null && newQty !== oldQty) out.push(`Qty: ${oldQty} -> ${newQty}`);
  if (l.new_variants != null) {
    const before = snapshotOf(old.variants);
    const after = snapshotOf(l.new_variants);
    const seen = new Set<string>();
    for (const k of [...Object.keys(before), ...Object.keys(after)]) {
      if (k === "remark" || seen.has(k)) continue;
      seen.add(k);
      if (shown(before[k]) === shown(after[k])) continue;
      out.push(`${VARIANT_LABEL[k] ?? k}: ${shown(before[k])} -> ${shown(after[k])}`);
    }
  }
  if (l.new_remark != null && l.new_remark.trim() !== String(old.remark ?? "").trim()) {
    out.push(l.new_remark.trim() ? `Remark: ${l.new_remark.trim()}` : "Remark cleared");
  }
  return out;
}

/** One SO amendment line as a VO line: what it adds or deducts, in quantity and money. */
export function amendmentLineChange(l: AmendmentLineRow): VoLine {
  const old = snapshotOf(l.old_snapshot);
  const type = String(l.change_type ?? "").toUpperCase();
  const oldCode = (old.item_code ?? old.itemCode ?? null) as string | null;
  const oldQty = num(old.qty);
  const oldPrice = num(old.unit_price_sen ?? old.unitPriceSen);
  const oldDisc = num(old.discount_sen ?? old.discountSen) ?? 0;
  const oldTotal = num(old.total_sen) ?? (oldQty !== null && oldPrice !== null ? oldQty * oldPrice - oldDisc : null);
  const itemCode = l.new_item_code ?? oldCode ?? l.cur_item_code;
  const description = String(old.description ?? l.cur_description ?? l.product_name ?? "").trim() || (l.product_name ?? "");
  const goesTo: GoesTo = voGoesTo({
    itemCode, itemGroup: l.cur_item_group ?? ((old.itemGroup ?? old.item_group ?? null) as string | null) ?? l.product_category ?? null,
    mainSupplierCode: l.main_supplier ?? null,
  });
  /* An added line has no SO line to read a room from; the VO carries the room it was added in (old_snapshot.room). */
  const room = l.cur_room ?? (typeof old.room === "string" && old.room.trim() ? old.room.trim() : null);
  const base = { itemCode, description, room, measure: null, goesTo, fromItemCode: null };
  if (type === "ADD") {
    const qty = num(l.new_qty) ?? num(l.cur_qty) ?? 0;
    const price = num(l.new_unit_price_sen);
    const amount = price !== null ? qty * price - (num(l.new_discount_sen) ?? 0) : num(l.cur_total_sen);
    return { ...base, qty, lineQty: qty, amountSen: amount, change: "add" };
  }
  if (type === "REMOVE") {
    const qty = oldQty ?? num(l.cur_qty) ?? 0;
    const total = oldTotal ?? num(l.cur_total_sen);
    return { ...base, itemCode: oldCode ?? l.cur_item_code, qty: -qty, lineQty: 0, amountSen: total === null ? null : -total, change: "deduct" };
  }
  const newQty = num(l.new_qty);
  const qty = newQty !== null && oldQty !== null ? newQty - oldQty : 0;
  let amount: number | null = null;
  if (oldTotal !== null && (oldQty !== null || newQty !== null) && (oldPrice !== null || num(l.new_unit_price_sen) !== null)) {
    const q = newQty ?? oldQty ?? 0;
    const p = num(l.new_unit_price_sen) ?? oldPrice ?? 0;
    const d = num(l.new_discount_sen) ?? oldDisc;
    amount = q * p - d - oldTotal;
  }
  const fromItemCode = l.new_item_code && oldCode && l.new_item_code !== oldCode ? oldCode : null;
  /* A line whose quantity stays is a change (a price or spec change), never an add or a deduct: VO-03's
     6000 -> 6500 cabinet read "1 added" (owner run, 24 Oct 2026). The amount still carries the money. */
  const change = qty > 0 ? "add" : qty < 0 ? "deduct" : "change";
  return { ...base, qty, lineQty: newQty ?? oldQty ?? num(l.cur_qty), amountSen: amount, change, fromItemCode, changes: lineChangeWords(l) };
}

const AMENDMENT_STATUS: Readonly<Record<string, [string, VoBucket]>> = {
  REQUESTED: ["Requested", "pending"],
  SUPPLIER_PENDING: ["Waiting for supplier", "pending"],
  /* Conts (owner, 24 Oct 2026): a sales order VO has no approval step; it is recorded and applied in one go. */
  SO_APPROVED: ["Recorded", "approved"],
  PO_APPROVED: ["Recorded", "approved"],
  SENT: ["Recorded", "approved"],
  REJECTED: ["Rejected", "closed"],
};

export function amendmentStatus(status: string, resolution: string | null): [string, VoBucket] {
  const s = String(status ?? "").toUpperCase();
  if (s === "REJECTED" && /withdr/i.test(String(resolution ?? ""))) return ["Withdrawn", "closed"];
  return AMENDMENT_STATUS[s] ?? [s ? s.charAt(0) + s.slice(1).toLowerCase() : "Requested", "pending"];
}

const RENO_STATUS: Readonly<Record<string, [string, VoBucket]>> = {
  DRAFT: ["Draft", "pending"],
  SENT: ["Sent to client", "pending"],
  APPROVED: ["Approved", "approved"],
  CANCELLED: ["Cancelled", "closed"],
};

export function renoVoStatus(status: string): [string, VoBucket] {
  return RENO_STATUS[String(status ?? "").toUpperCase()] ?? ["Draft", "pending"];
}

/** Dashboard numbers: added, deducted and net over approved VOs; the pending VOs' net on its own. */
export function voTotals(vos: readonly VoRow[]): VoTotals {
  let addedSen = 0;
  let deductedSen = 0;
  let pendingNetSen = 0;
  for (const v of vos) {
    if (v.bucket === "pending") { pendingNetSen += v.netSen ?? 0; continue; }
    if (v.bucket !== "approved") continue;
    for (const l of v.lines) {
      const a = l.amountSen ?? 0;
      if (a > 0) addedSen += a; else deductedSen += a;
    }
  }
  return { addedSen, deductedSen, netSen: addedSen + deductedSen, pendingNetSen };
}

export function voCounts(vos: readonly VoRow[]): VoAnswer["counts"] {
  return {
    pending: vos.filter((v) => v.bucket === "pending").length,
    approved: vos.filter((v) => v.bucket === "approved").length,
    closed: vos.filter((v) => v.bucket === "closed").length,
  };
}

function hideMoney(v: VoRow): VoRow {
  return { ...v, netSen: null, lines: v.lines.map((l) => ({ ...l, amountSen: null })) };
}

/* ---------- reads ---------- */

async function customerSupplierIds(db: Db, companyId: number): Promise<Set<string>> {
  const r = await rows<{ id: string }>(db, `SELECT id::text AS id FROM scm.suppliers WHERE code = 'CUSTOMER' AND company_id = ?`, companyId);
  return new Set(r.map((x) => x.id));
}

async function amendmentVos(db: Db, projectId: number, companyId: number): Promise<VoRow[]> {
  const heads = await rows<{
    id: string; so_doc_no: string; amendment_no: string; status: string; resolution: string | null; reason: string | null; created_at: string | null;
    approved_at: string | null; raised_by: string | null; approved_by: string | null;
  }>(db,
    `SELECT a.id::text AS id, a.so_doc_no, a.amendment_no, a.status::text AS status, a.resolution, a.reason, ${TS("a.created_at")} AS created_at,
            ${TS("coalesce(a.so_approved_at, a.po_approved_at, a.sent_at)")} AS approved_at,
            (SELECT st.name FROM scm.staff st WHERE st.id = a.requested_by) AS raised_by,
            (SELECT st.name FROM scm.staff st WHERE st.id = coalesce(a.so_approved_by, a.po_approved_by)) AS approved_by
       FROM scm.so_amendments a JOIN scm.mfg_sales_orders so ON so.doc_no = a.so_doc_no
      WHERE ${PROJECT_SO}
        AND NOT EXISTS (SELECT 1 FROM scm.reno_variation_orders v WHERE v.amendment_id = a.id)
      ORDER BY a.created_at DESC`,
    projectId, companyId);
  if (heads.length === 0) return [];
  const lines = await rows<AmendmentLineRow & { amendment_id: string }>(db,
    `SELECT l.amendment_id::text AS amendment_id, l.change_type, l.new_item_code, l.new_qty, l.new_unit_price_sen, l.new_discount_sen::int AS new_discount_sen,
            l.new_remark, l.new_variants, l.old_snapshot, i.item_code AS cur_item_code, i.description AS cur_description, i.qty AS cur_qty, i.total_sen AS cur_total_sen,
            coalesce(nullif(trim((SELECT rl.room FROM scm.reno_doc_lines rl WHERE rl.so_item_id = i.id LIMIT 1)), ''), nullif(trim(to_jsonb(i)->>'room'), ''), nullif(trim(i.location), '')) AS cur_room,
            i.item_group AS cur_item_group,
            (SELECT p.category::text FROM scm.mfg_products p WHERE p.code = coalesce(l.new_item_code, i.item_code) AND p.company_id = so.company_id LIMIT 1) AS product_category,
            (SELECT s.code FROM scm.supplier_material_bindings b JOIN scm.suppliers s ON s.id = b.supplier_id
              WHERE b.material_kind = 'mfg_product' AND b.item_code = coalesce(l.new_item_code, i.item_code) AND b.company_id = so.company_id
              ORDER BY b.is_main_supplier DESC LIMIT 1) AS main_supplier,
            (SELECT p.name FROM scm.mfg_products p WHERE p.code = coalesce(l.new_item_code, i.item_code) AND p.company_id = so.company_id LIMIT 1) AS product_name
       FROM scm.so_amendment_lines l
       JOIN scm.so_amendments a ON a.id = l.amendment_id
       JOIN scm.mfg_sales_orders so ON so.doc_no = a.so_doc_no
       LEFT JOIN scm.mfg_sales_order_items i ON i.id = l.sales_order_item_id
      WHERE ${PROJECT_SO}
        AND NOT EXISTS (SELECT 1 FROM scm.reno_variation_orders v WHERE v.amendment_id = a.id)
      ORDER BY l.amendment_id, i.line_no NULLS LAST`,
    projectId, companyId);
  const byId = new Map<string, VoLine[]>();
  for (const l of lines) {
    const list = byId.get(l.amendment_id) ?? [];
    list.push(amendmentLineChange(l));
    byId.set(l.amendment_id, list);
  }
  return heads.map((h) => {
    const [statusLabel, bucket] = amendmentStatus(h.status, h.resolution);
    const ls = byId.get(h.id) ?? [];
    return {
      key: `a:${h.id}`, label: "", source: "amendment", no: h.amendment_no, soDocNo: h.so_doc_no, title: h.reason, status: h.status, statusLabel, bucket,
      date: h.created_at, raisedBy: h.raised_by, approvedBy: null, approvedAt: null, recorded: bucket === "approved",
      netSen: ls.reduce((s, l) => s + (l.amountSen ?? 0), 0), href: `/scm/amendments/${h.id}`, lines: ls,
    };
  });
}

async function renovationVos(db: Db, projectId: number, companyId: number, customerIds: Set<string>): Promise<VoRow[]> {
  const heads = await rows<{ id: string; created_by: string | null; created_at: string | null }>(db,
    `SELECT v.id::text AS id, v.created_by, ${TS("v.created_at")} AS created_at
       FROM scm.reno_variation_orders v JOIN scm.mfg_sales_orders so ON so.doc_no = v.so_doc_no
      WHERE ${PROJECT_SO} AND v.company_id = so.company_id
      ORDER BY v.doc_date DESC, v.seq DESC`,
    projectId, companyId);
  const reno = renoDbFromD1(db);
  const out: VoRow[] = [];
  for (const h of heads) {
    const v = await readVo(reno, h.id, companyId);
    const [statusLabel, bucket] = renoVoStatus(v.status);
    const lines: VoLine[] = [];
    for (const s of v.sections) {
      for (const l of s.lines) {
        if (l.kind !== "ITEM" && l.kind !== "CHILD") continue;
        const omit = l.voChange === "OMIT";
        const client = l.supplyByOwner
          || isCustomerSupplied({ itemCode: l.itemCode, supplierCode: l.supplierId ? (customerIds.has(l.supplierId) ? "CUSTOMER" : "OTHER") : null, unitCostSen: l.unitCostSen });
        const measured = l.measureMilli !== null && l.measure !== null;
        lines.push({
          itemCode: l.itemCode, description: l.description, room: l.room || null,
          qty: measured ? (omit ? -1 : 1) : omit ? -l.qty : l.qty,
          measure: measured ? `${Number(l.measure)} ${l.measureUom ?? ""}`.trim() : null,
          lineQty: omit ? 0 : measured ? 1 : l.qty,
          amountSen: l.netSen, change: omit ? "deduct" : "add", fromItemCode: null,
          goesTo: client ? "client" : !l.supplierId && !poPickerOffers({ itemCode: l.itemCode, itemGroup: null, mainSupplierCode: null }) ? "works" : "po",
        });
      }
    }
    out.push({
      key: `v:${v.id}`, label: "", source: "renovation", no: v.voNo, soDocNo: v.soDocNo, title: v.title || null, status: v.status, statusLabel, bucket,
      date: v.docDate, raisedBy: h.created_by, recorded: false, approvedBy: bucket === "approved" ? v.approvedBy : null, approvedAt: bucket === "approved" ? v.approvedAt : null,
      netSen: v.totals.netSen, href: `/scm/renovation/variation-orders/${v.id}`, lines,
    });
  }
  return out;
}

/** VO-01, VO-02, ... oldest first, so a VO keeps its number when a newer one is raised. */
export function labelVos<T extends { date: string | null; no: string }>(vos: readonly T[]): Array<T & { label: string }> {
  return [...vos]
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")) || a.no.localeCompare(b.no))
    .map((v, i) => ({ ...v, label: `VO-${String(i + 1).padStart(2, "0")}` }));
}

export async function loadProjectVos(db: Db, projectId: number, companyId: number, finance: boolean): Promise<VoAnswer> {
  const customerIds = await customerSupplierIds(db, companyId);
  const all = labelVos([...(await renovationVos(db, projectId, companyId, customerIds)), ...(await amendmentVos(db, projectId, companyId))]);
  const [so] = await rows<{ doc_no: string; renovation: boolean }>(db,
    `SELECT so.doc_no, EXISTS (SELECT 1 FROM scm.reno_so_contracts k WHERE k.so_doc_no = so.doc_no) AS renovation
       FROM scm.mfg_sales_orders so WHERE ${PROJECT_SO}
      ORDER BY so.so_date DESC NULLS LAST, so.doc_no DESC LIMIT 1`,
    projectId, companyId);
  return {
    so: so ? { docNo: so.doc_no, renovation: Boolean(so.renovation) } : null,
    finance,
    vos: finance ? all : all.map(hideMoney),
    counts: voCounts(all),
    totals: finance ? voTotals(all) : null,
  };
}

/* ---------- category labels ---------- */

/** Category group and sub-category of a line: the line's own, else its product's; labels from the catalog tree. */
const CATEGORY_SQL = (code: string, group: string, sub: string, company: string): string => `
  LEFT JOIN LATERAL (SELECT p.category_group, p.sub_category FROM scm.mfg_products p
                      WHERE p.code = ${code} AND p.company_id = ${company} ORDER BY (p.status::text = 'ACTIVE') DESC LIMIT 1) prod ON true
  LEFT JOIN scm.product_category_groups cg ON cg.code = coalesce(${group}, prod.category_group)
  LEFT JOIN scm.product_sub_categories sc ON sc.group_code = cg.code AND sc.code = coalesce(${sub}, prod.sub_category)`;

/* ---------- PO ---------- */

export type GrState = "yes" | "part" | "no";

export interface PoLine {
  id: string;
  poId: string;
  poNumber: string;
  poStatus: string;
  supplierName: string | null;
  categoryCode: string | null;
  categoryLabel: string;
  categorySort: number;
  subCode: string | null;
  subLabel: string;
  subSort: number;
  product: string;
  sku: string;
  uom: string;
  qty: number;
  area: string | null;
  poDate: string | null;
  deliveryDate: string | null;
  /** Goods received against this PO line: all, some, none. */
  gr: GrState;
  /** A delivery order was issued for the SO line this PO line buys. */
  delivered: boolean;
}

export interface PoAnswer {
  lines: PoLine[];
  counts: { pos: number; lines: number; received: number; delivered: number; cancelled: number };
}

export function grState(qty: number, received: number): GrState {
  if (received <= 0) return "no";
  return received >= qty ? "yes" : "part";
}

export function poLineCounts(lines: readonly PoLine[]): PoAnswer["counts"] {
  const live = lines.filter((l) => l.poStatus !== "CANCELLED");
  return {
    pos: new Set(live.map((l) => l.poId)).size,
    lines: live.length,
    received: live.filter((l) => l.gr === "yes").length,
    delivered: live.filter((l) => l.delivered).length,
    cancelled: new Set(lines.filter((l) => l.poStatus === "CANCELLED").map((l) => l.poId)).size,
  };
}

export async function loadProjectPoLines(db: Db, projectId: number, companyId: number): Promise<PoAnswer> {
  const r = await rows<{
    id: string; po_id: string; po_number: string; po_status: string; supplier_name: string | null; cat: string | null; cat_label: string | null; cat_sort: number | null;
    sub: string | null; sub_label: string | null; sub_sort: number | null; product: string | null; sku: string; uom: string | null; qty: number; received_qty: number;
    area: string | null; po_date: string | null; delivery_date: string | null; delivered: boolean;
  }>(db,
    `SELECT pi.id::text AS id, po.id::text AS po_id, po.po_number, po.status::text AS po_status, s.name AS supplier_name,
            cg.code AS cat, cg.label AS cat_label, cg.sort_order AS cat_sort, sc.code AS sub, sc.label AS sub_label, sc.sort_order AS sub_sort,
            coalesce(nullif(pi.description, ''), pi.material_name) AS product, pi.item_code AS sku, pi.uom, pi.qty, pi.received_qty,
            coalesce(nullif(pi.room, ''), (SELECT nullif(l.room, '') FROM scm.reno_doc_lines l WHERE l.so_item_id = pi.so_item_id LIMIT 1)) AS area,
            po.po_date::text AS po_date, coalesce(pi.delivery_date, po.expected_at)::text AS delivery_date,
            (pi.so_item_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM scm.delivery_order_items doi JOIN scm.delivery_orders dd ON dd.id = doi.delivery_order_id
                WHERE doi.so_item_id = pi.so_item_id AND dd.status::text NOT IN ('CANCELLED', 'DRAFT'))) AS delivered
       FROM scm.purchase_order_items pi
       JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
       LEFT JOIN scm.suppliers s ON s.id = po.supplier_id
       ${CATEGORY_SQL("pi.item_code", "coalesce(pi.category_group, po.category_group)", "coalesce(pi.sub_category, po.sub_category)", "po.company_id")}
      WHERE po.company_id = ?
        AND (po.project_id = ?
             OR EXISTS (SELECT 1 FROM scm.purchase_order_items x
                          JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id
                          JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
                         WHERE x.purchase_order_id = po.id AND ${PROJECT_SO}))
      ORDER BY po.po_date, po.po_number, pi.line_no NULLS LAST`,
    companyId, projectId, projectId, companyId);
  const lines: PoLine[] = r.map((x) => ({
    id: x.id, poId: x.po_id, poNumber: x.po_number, poStatus: x.po_status, supplierName: x.supplier_name,
    categoryCode: x.cat, categoryLabel: x.cat_label ?? "Other", categorySort: x.cat_sort ?? 999,
    subCode: x.sub, subLabel: x.sub_label ?? "General", subSort: x.sub_sort ?? 999,
    product: x.product ?? x.sku, sku: x.sku, uom: x.uom ?? "UNIT", qty: Number(x.qty), area: x.area,
    poDate: x.po_date, deliveryDate: x.delivery_date, gr: grState(Number(x.qty), Number(x.received_qty)), delivered: Boolean(x.delivered),
  }));
  return { lines, counts: poLineCounts(lines) };
}

/* ---------- Client PO ---------- */

export interface ClientItem {
  key: string;
  soDocNo: string;
  /** The SO line id, for its photos; null for a VO line not on the SO yet. */
  soItemId: string | null;
  itemCode: string | null;
  description: string;
  categoryLabel: string;
  categorySort: number;
  subLabel: string;
  subSort: number;
  area: string | null;
  qty: number;
  measure: string | null;
  uom: string | null;
  photoKeys: string[];
  /** The SKU's own catalog photos (scm.mfg_product_photos), primary first. */
  skuPhotos: SkuPhoto[];
  /** The VO that added it, when one did. */
  voNo: string | null;
  /** A VO not approved yet: the item is not on the SO until it is. */
  pending: boolean;
}

export interface SkuPhoto { productId: string; key: string; thumbKey: string | null }

export interface ClientAnswer { items: ClientItem[] }

export function skuPhotoList(v: unknown): SkuPhoto[] {
  let arr: unknown = v;
  if (typeof v === "string") { try { arr = JSON.parse(v); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return typeof o.productId === "string" && typeof o.key === "string" && o.key
      ? [{ productId: o.productId, key: o.key, thumbKey: typeof o.thumbKey === "string" && o.thumbKey ? o.thumbKey : null }]
      : [];
  });
}

export function photoList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.startsWith("{")) return v.slice(1, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).filter(Boolean);
  return [];
}

/* The room of a client line, read the way the PO tab reads it: the renovation line's room, else the SO line's own room
   (Conts rooms, migration 0112), else its location. A plain sales order has no renovation lines, so reading only the
   first left every Client PO line without an area while the PO tab showed them (live run, 24 Oct 2026). */
export const CLIENT_LINE_ROOM = `coalesce(nullif(trim(d.room), ''), nullif(trim(to_jsonb(i)->>'room'), ''), nullif(trim(i.location), ''))`;

/** SO lines the client buys: supplier CUSTOMER (the line's, else the SKU's main supplier), a CUS-* SKU at cost 0, or supplied by the owner. */
export async function loadClientItems(db: Db, projectId: number, companyId: number, pendingVos: readonly VoRow[] = []): Promise<ClientAnswer> {
  const r = await rows<{
    id: string; doc_no: string; item_code: string | null; description: string | null; qty: number; uom: string | null; unit_cost_sen: number; photo_urls: unknown;
    room: string | null; supply_by_owner: boolean | null; line_supplier_code: string | null; main_supplier_code: string | null; measure: string | null;
    measure_uom: string | null; vo_no: string | null; cat_label: string | null; cat_sort: number | null; sub_label: string | null; sub_sort: number | null;
    sku_photos: unknown;
  }>(db,
    `SELECT i.id::text AS id, i.doc_no, i.item_code, i.description, i.qty, i.uom, i.unit_cost_sen, i.photo_urls,
            ${CLIENT_LINE_ROOM} AS room, d.supply_by_owner, d.line_supplier_code, d.measure, d.measure_uom, d.vo_no,
            cg.label AS cat_label, cg.sort_order AS cat_sort, sc.label AS sub_label, sc.sort_order AS sub_sort,
            (SELECT sp.code FROM scm.supplier_material_bindings b JOIN scm.suppliers sp ON sp.id = b.supplier_id
              WHERE b.item_code = i.item_code AND b.company_id = so.company_id AND b.is_main_supplier LIMIT 1) AS main_supplier_code,
            (SELECT coalesce(json_agg(json_build_object('productId', ph.product_id, 'key', ph.r2_key, 'thumbKey', ph.thumb_key)
                                      ORDER BY ph.is_primary DESC, ph.sort_order, ph.created_at), '[]'::json)::text
               FROM scm.mfg_products mp JOIN scm.mfg_product_photos ph ON ph.product_id = mp.id AND ph.company_id = mp.company_id
              WHERE mp.code = i.item_code AND mp.company_id = so.company_id) AS sku_photos
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       LEFT JOIN LATERAL (
         SELECT l.room, l.supply_by_owner, ls.code AS line_supplier_code, l.measure::text AS measure, l.measure_uom,
                (SELECT v.vo_no FROM scm.reno_variation_orders v WHERE v.id = coalesce(l.vo_id, s.added_by_vo_id)) AS vo_no
           FROM scm.reno_doc_lines l JOIN scm.reno_doc_sections s ON s.id = l.section_id
           LEFT JOIN scm.suppliers ls ON ls.id = l.supplier_id
          WHERE l.so_item_id = i.id AND s.so_doc_no = i.doc_no
          LIMIT 1) d ON true
       ${CATEGORY_SQL("i.item_code", "NULL::text", "NULL::text", "so.company_id")}
      WHERE ${PROJECT_SO} AND NOT i.cancelled
      ORDER BY i.doc_no, i.line_no NULLS LAST`,
    projectId, companyId);
  const items: ClientItem[] = [];
  for (const x of r) {
    const owner = Boolean(x.supply_by_owner);
    const sku = isCustomerSupplied({ itemCode: x.item_code, supplierCode: x.line_supplier_code ?? x.main_supplier_code ?? null, unitCostSen: Number(x.unit_cost_sen) });
    if (!owner && !sku) continue;
    items.push({
      key: `so:${x.id}`, soDocNo: x.doc_no, soItemId: x.id, itemCode: x.item_code, description: x.description ?? "",
      categoryLabel: x.cat_label ?? "Other", categorySort: x.cat_sort ?? 999, subLabel: x.sub_label ?? "General", subSort: x.sub_sort ?? 999,
      area: x.room || null, qty: Number(x.qty), measure: x.measure ? `${Number(x.measure)} ${x.measure_uom ?? ""}`.trim() : null, uom: x.uom,
      photoKeys: photoList(x.photo_urls), skuPhotos: skuPhotoList(x.sku_photos), voNo: x.vo_no, pending: false,
    });
  }
  // A VO not on the SO yet that adds a client item: listed so the client can be asked early, marked as such.
  for (const v of pendingVos) {
    if (v.bucket !== "pending") continue;
    v.lines.forEach((l, i) => {
      if (l.goesTo !== "client" || l.change !== "add") return;
      items.push({
        key: `${v.key}:${i}`, soDocNo: v.soDocNo, soItemId: null, itemCode: l.itemCode, description: l.description,
        categoryLabel: "Other", categorySort: 999, subLabel: "General", subSort: 999, area: l.room, qty: l.qty, measure: l.measure, uom: null,
        photoKeys: [], skuPhotos: [], voNo: v.label, pending: true,
      });
    });
  }
  return { items };
}

/** One photo on the client's link: an opaque reference the link's photo route resolves again, never the storage key. */
export interface ClientPublicPhoto { ref: string; from: "line" | "sku" }

export type ClientPublicItem = Pick<ClientItem, "key" | "itemCode" | "description" | "categoryLabel" | "subLabel" | "area" | "qty" | "measure" | "uom" | "pending">
  & { photos: ClientPublicPhoto[] };

/** A storage key's reference on the client link: 24 hex of its SHA-256, so the link names no key and no document
 *  number, and a reference only resolves to a photo of an item on that same link. */
export async function photoRef(key: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`beta-client-photo:${key}`)));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ClientPhotoTarget { key: string; thumbKey: string | null; from: "line" | "sku" }

/** Every photo the client link may show, by reference: the lines' photos and the SKUs' photos. */
export async function clientPhotoIndex(items: readonly ClientItem[]): Promise<Map<string, ClientPhotoTarget>> {
  const out = new Map<string, ClientPhotoTarget>();
  for (const i of items) {
    for (const k of i.photoKeys) out.set(await photoRef(k), { key: k, thumbKey: null, from: "line" });
    for (const ph of i.skuPhotos) out.set(await photoRef(ph.key), { key: ph.key, thumbKey: ph.thumbKey, from: "sku" });
  }
  return out;
}

/** What the client's read-only link shows: no prices, suppliers, staff or storage keys; photos by reference only. */
export async function clientView(items: readonly ClientItem[]): Promise<ClientPublicItem[]> {
  return Promise.all(items.map(async (i) => ({
    key: i.key, itemCode: i.itemCode, description: i.description, categoryLabel: i.categoryLabel, subLabel: i.subLabel, area: i.area, qty: i.qty,
    measure: i.measure, uom: i.uom, pending: i.pending,
    photos: [
      ...(await Promise.all(i.photoKeys.map(async (k) => ({ ref: await photoRef(k), from: "line" as const })))),
      ...(await Promise.all(i.skuPhotos.map(async (ph) => ({ ref: await photoRef(ph.key), from: "sku" as const })))),
    ],
  })));
}
