/* Beta project PO tab as the line manager (owner, 24 Oct 2026). Every current line of the project's live sales orders
   (after VOs), with what it costs the client, when it is to be ordered and delivered, whether a PO, goods receipt and
   delivery order exist, and any PO change a VO left waiting for purchasing to confirm.

   Edits to a line (SKU, colour, qty, remark) do not happen here: the screen raises a VO through the sales order's own
   amendment route, which applies at once (renovation-vo-rule.ts). This file reads, and stores only the planned dates
   (scm.reno_beta_line_plans, migration 0155) for a line no PO holds yet. */

import { isMissingRelation, type Db } from "./load";
import { voGoesTo } from "../../scm/lib/renovation-po-split";
import { variantCategoryOf } from "../../scm/lib/renovation-flow-rules";
import { photoList, skuPhotoList, type SkuPhoto } from "./betaVoPo";
import { keepVisiblePos, lineVisible, type CategoryScope } from "../categoryAccess";

async function rows<T>(db: Db, sql: string, ...args: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...args).all<T>();
  return (res.results ?? []) as T[];
}

/** po: we buy it; client: the client buys it (Client PO); works: our own works, nothing is bought. */
export type GoesTo = "po" | "client" | "works";
export type Mark = "yes" | "part" | "no";

export interface LinePo {
  poId: string;
  poNumber: string;
  poStatus: string;
  poLineId: string;
  poDate: string | null;
  /** The PO line's effective delivery date, by the rule every PO reader uses (scm/shared/effective-delivery.ts): the
      latest of the line's date and its supplier revisions, else the same for the PO header. */
  deliveryDate: string | null;
  /** A supplier revision on the PO line sets deliveryDate, so changing the line's own date would not move it. */
  supplierRevised: boolean;
  qty: number;
  received: number;
  /** Photos uploaded on the PO line itself (po-items/...); the SO line's own photos ride ManagedLine.photoKeys. */
  photoKeys: string[];
  /** The supplier on the PO. */
  supplierName?: string | null;
}

export interface SupplierChoice { id: string; code: string; name: string; main: boolean; priceSen: number | null }

/** A PO change raised by a VO that purchasing has not confirmed yet: the PO still shows the old line. */
export interface PendingPoChange {
  id: string;
  amendmentNo: string;
  poId: string;
  poNumber: string;
  /** The VO that raised it (VO-01, ...), when it is one of this project's. */
  voLabel: string | null;
}

export interface LineMaterial { code: string; name: string | null; uom: string | null; qty: number }

export interface ManagedLine {
  id: string;
  soDocNo: string;
  soStatus: string;
  /** False for a draft order: its lines change on the order itself, no VO needed. */
  voLocked: boolean;
  lineNo: number | null;
  itemCode: string;
  description: string;
  /** The variant summary the order prints (description2). */
  variantText: string | null;
  variants: Record<string, unknown>;
  itemGroup: string | null;
  uom: string;
  qty: number;
  unitPriceSen: number | null;
  discountSen: number | null;
  amountSen: number | null;
  area: string | null;
  remark: string | null;
  /** The supplier the line is to be bought from: the one picked on the SO tab, else the contract line's (pre-filled
      from the SKU's binding), else the SKU's main supplier. */
  supplierName: string | null;
  supplierId: string | null;
  /** The renovation contract line behind this SO line, where the supplier choice is kept (null: not a contract line). */
  contractLineId: string | null;
  /** The suppliers this SKU can be ordered from (its supplier bindings), main first (owner, 3 Nov 2026: only these).
      LinesAnswer.suppliers has the rest. */
  supplierChoices: SupplierChoice[];
  /** Its raw materials: the list saved on the line, else the SKU's composition times the line's qty. */
  materials: LineMaterial[];
  goesTo: GoesTo;
  /** The catalog group and sub-category codes (null: the product has none), for the role's category access. */
  categoryCode: string | null;
  subCode: string | null;
  /** The category that picks the line's variant fields, by the SO line's rule (renovation-flow-rules.ts
      variantCategoryOf: a FURNITURE sofa or bedframe is SOFA or BEDFRAME); null when the product is not in the catalog. */
  variantCategory: string | null;
  categoryLabel: string;
  categorySort: number;
  subLabel: string;
  subSort: number;
  pos: LinePo[];
  /** Photos uploaded on the sales order line. */
  photoKeys: string[];
  /** The SKU's catalog photos, primary first. */
  skuPhotos: SkuPhoto[];
  gr: Mark;
  do: Mark;
  plan: { orderOn: string | null; deliverOn: string | null; noPo: boolean };
}

export interface LinesAnswer {
  finance: boolean;
  /** False until migration 0155 is applied: planned dates cannot be saved yet. */
  plansReady: boolean;
  sos: Array<{ docNo: string; status: string; voLocked: boolean; renovation: boolean }>;
  suppliers: Array<{ id: string; name: string }>;
  lines: ManagedLine[];
  pendingPoChanges: PendingPoChange[];
  /** True when the caller's role sees only some categories: lines of the others are left out. */
  categoryRestricted: boolean;
}

/* ---------- pure pieces (tested) ---------- */

export function markOf(total: number, done: number): Mark {
  if (done <= 0 || total <= 0) return "no";
  return done >= total ? "yes" : "part";
}

/** Goods received across the line's live POs, against what those POs ordered. */
export function grOf(pos: readonly LinePo[]): Mark {
  const live = pos.filter((p) => p.poStatus !== "CANCELLED");
  return markOf(live.reduce((s, p) => s + p.qty, 0), live.reduce((s, p) => s + p.received, 0));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !DATE.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}

export interface LinePlanPatch { orderOn?: string | null; deliverOn?: string | null; noPo?: boolean }

/** A plan edit from the screen: each field optional, a date YYYY-MM-DD or null to clear. */
export function cleanLinePlan(b: Record<string, unknown>): { ok: true; patch: LinePlanPatch } | { ok: false; message: string } {
  const patch: LinePlanPatch = {};
  for (const k of ["orderOn", "deliverOn"] as const) {
    if (!(k in b)) continue;
    const d = cleanDate(b[k]);
    if (d === undefined) return { ok: false, message: `${k === "orderOn" ? "Order date" : "Delivery date"} must be a calendar date.` };
    patch[k] = d;
  }
  if ("noPo" in b) {
    if (typeof b.noPo !== "boolean") return { ok: false, message: "Say whether the line needs a PO." };
    patch.noPo = b.noPo;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: "Nothing to change." };
  return { ok: true, patch };
}

export function mergePlan(cur: ManagedLine["plan"], p: LinePlanPatch): ManagedLine["plan"] {
  const next = {
    orderOn: p.orderOn !== undefined ? p.orderOn : cur.orderOn,
    deliverOn: p.deliverOn !== undefined ? p.deliverOn : cur.deliverOn,
    noPo: p.noPo ?? cur.noPo,
  };
  return next;
}

export function planOrderRefusal(plan: ManagedLine["plan"]): string | null {
  return plan.orderOn && plan.deliverOn && plan.orderOn > plan.deliverOn ? "The order date cannot be after the delivery date." : null;
}

function variantsOf(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {}; } catch { return {}; }
  }
  return {};
}

function posOf(v: unknown): LinePo[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? (JSON.parse(v) as unknown[]) : [];
  return (list as Array<Record<string, unknown>>).map((p) => ({
    poId: String(p.po_id), poNumber: String(p.po_number), poStatus: String(p.po_status), poLineId: String(p.po_line_id),
    poDate: (p.po_date as string | null) ?? null, deliveryDate: (p.delivery_date as string | null) ?? null, supplierRevised: Boolean(p.supplier_revised), supplierName: (p.supplier_name as string | null) ?? null,
    qty: Number(p.qty ?? 0), received: Number(p.received ?? 0),
    photoKeys: photoList(p.photo_urls).filter((k) => k.startsWith("po-items/")),
  }));
}

/* ---------- reads ---------- */

const PROJECT_SO = `so.project_id = ? AND so.company_id = ? AND so.status::text <> 'CANCELLED'`;

interface LineRow {
  id: string; doc_no: string; so_status: string; line_no: number | null; item_code: string | null; description: string | null; description2: string | null;
  variants: unknown; item_group: string | null; uom: string | null; qty: number; unit_price_sen: number | null; discount_sen: number | null; total_sen: number | null;
  area: string | null; remark: string | null; supplier_name: string | null; supplier_code: string | null; cat_label: string | null; cat_sort: number | null;
  sub_label: string | null; sub_sort: number | null; cat_code: string | null; sub_code: string | null; prod_category: string | null; prod_sub: string | null; pos: unknown; delivered: number | null; photo_urls: unknown; sku_photos: unknown;
  supplier_id: string | null; contract_line_id: string | null; contract_supplier_id: string | null; contract_supplier_name: string | null; supplier_choices: unknown;
}

export function choicesOf(v: unknown): SupplierChoice[] {
  let list: unknown = v;
  if (typeof v === "string") { try { list = JSON.parse(v); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return (list as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id), code: String(c.code ?? ""), name: String(c.name ?? c.code ?? ""), main: Boolean(c.main),
    priceSen: c.priceSen === null || c.priceSen === undefined ? null : Number(c.priceSen),
  }));
}

interface PickedSupplier { id: string; name: string; code: string }

async function readPlans(db: Db, ids: readonly string[]): Promise<{ ready: boolean; byId: Map<string, ManagedLine["plan"]>; picked: Map<string, PickedSupplier>; saved: Set<string> }> {
  const byId = new Map<string, ManagedLine["plan"]>();
  const picked = new Map<string, PickedSupplier>();
  const saved = new Set<string>();
  if (ids.length === 0) return { ready: true, byId, picked, saved };
  try {
    const r = await rows<{ so_item_id: string; order_on: string | null; deliver_on: string | null; no_po: boolean; materials_saved: boolean; supplier_id: string | null; supplier_name: string | null; supplier_code: string | null }>(db,
      `SELECT p.so_item_id::text AS so_item_id, p.order_on::text AS order_on, p.deliver_on::text AS deliver_on, p.no_po, p.materials_saved,
              s.id::text AS supplier_id, s.name AS supplier_name, s.code AS supplier_code
         FROM scm.reno_beta_line_plans p LEFT JOIN scm.suppliers s ON s.id = p.supplier_id
        WHERE p.so_item_id::text IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
      JSON.stringify(ids));
    for (const p of r) {
      byId.set(p.so_item_id, { orderOn: p.order_on, deliverOn: p.deliver_on, noPo: Boolean(p.no_po) });
      if (p.materials_saved) saved.add(p.so_item_id);
      if (p.supplier_id) picked.set(p.so_item_id, { id: p.supplier_id, name: p.supplier_name ?? p.supplier_code ?? "", code: p.supplier_code ?? "" });
    }
    return { ready: true, byId, picked, saved };
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, byId, picked, saved };
    throw e;
  }
}

/** `voLabels`: so_amendments.id to its VO-0N label on this project (from loadProjectVos).
    `scope`: the caller's category access (categoryAccess.ts); lines outside it, and the PO changes of POs left with no line, are dropped. */
export async function loadProjectLines(
  db: Db, projectId: number, companyId: number, finance: boolean, voLabels: ReadonlyMap<string, string>, scope: CategoryScope | null = null,
): Promise<LinesAnswer> {
  const sos = await rows<{ doc_no: string; status: string; renovation: boolean }>(db,
    `SELECT so.doc_no, so.status::text AS status, EXISTS (SELECT 1 FROM scm.reno_so_contracts k WHERE k.so_doc_no = so.doc_no) AS renovation
       FROM scm.mfg_sales_orders so WHERE ${PROJECT_SO} ORDER BY so.so_date NULLS LAST, so.doc_no`,
    projectId, companyId);
  const all = await rows<LineRow>(db,
    `SELECT i.id::text AS id, i.doc_no, so.status::text AS so_status, i.line_no, i.item_code, i.description, i.description2, i.variants, i.item_group,
            i.uom, i.qty, i.unit_price_sen, i.discount_sen::bigint AS discount_sen, i.total_sen::bigint AS total_sen, i.remark,
            coalesce(nullif(trim(to_jsonb(i)->>'room'), ''), nullif(trim((SELECT l.room FROM scm.reno_doc_lines l WHERE l.so_item_id = i.id LIMIT 1)), ''), nullif(trim(i.location), '')) AS area,
            sup.name AS supplier_name, sup.code AS supplier_code, sup.id AS supplier_id,
            cl.id AS contract_line_id, cl.supplier_id AS contract_supplier_id, cl.supplier_name AS contract_supplier_name,
            (SELECT coalesce(json_agg(json_build_object('id', s2.id::text, 'code', s2.code, 'name', s2.name, 'main', coalesce(b2.is_main_supplier, false), 'priceSen', b2.unit_price_sen)
                                      ORDER BY b2.is_main_supplier DESC NULLS LAST, s2.name), '[]'::json)::text
               FROM scm.supplier_material_bindings b2 JOIN scm.suppliers s2 ON s2.id = b2.supplier_id
              WHERE b2.material_kind = 'mfg_product' AND b2.item_code = i.item_code AND b2.company_id = so.company_id) AS supplier_choices,
            cg.label AS cat_label, cg.sort_order AS cat_sort, sc.label AS sub_label, sc.sort_order AS sub_sort,
            cg.code AS cat_code, sc.code AS sub_code, prod.category AS prod_category, prod.sub_category AS prod_sub,
            (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'po_id', po.id::text, 'po_number', po.po_number, 'po_status', po.status::text, 'po_line_id', pi.id::text,
                      'po_date', po.po_date::text, 'delivery_date', coalesce(greatest(pi.delivery_date, pi.supplier_delivery_date_2, pi.supplier_delivery_date_3, pi.supplier_delivery_date_4),
                                                greatest(po.expected_at, po.supplier_delivery_date_2, po.supplier_delivery_date_3, po.supplier_delivery_date_4))::text,
                      'supplier_revised', coalesce(pi.supplier_delivery_date_2, pi.supplier_delivery_date_3, pi.supplier_delivery_date_4) IS NOT NULL,
                      'qty', pi.qty, 'received', pi.received_qty, 'photo_urls', to_jsonb(pi.photo_urls), 'supplier_name', ps.name) ORDER BY po.po_date, po.po_number), '[]'::jsonb)
               FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
               LEFT JOIN scm.suppliers ps ON ps.id = po.supplier_id
              WHERE pi.so_item_id = i.id) AS pos,
            (SELECT coalesce(sum(doi.qty), 0)::int FROM scm.delivery_order_items doi JOIN scm.delivery_orders dd ON dd.id = doi.delivery_order_id
              WHERE doi.so_item_id = i.id AND dd.status::text NOT IN ('CANCELLED', 'DRAFT')) AS delivered,
            i.photo_urls,
            (SELECT coalesce(json_agg(json_build_object('productId', ph.product_id, 'key', ph.r2_key, 'thumbKey', ph.thumb_key)
                                      ORDER BY ph.is_primary DESC, ph.sort_order, ph.created_at), '[]'::json)::text
               FROM scm.mfg_products mp JOIN scm.mfg_product_photos ph ON ph.product_id = mp.id AND ph.company_id = mp.company_id
              WHERE mp.code = i.item_code AND mp.company_id = so.company_id) AS sku_photos
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       LEFT JOIN LATERAL (SELECT s.id::text AS id, s.name, s.code FROM scm.supplier_material_bindings b JOIN scm.suppliers s ON s.id = b.supplier_id
                           WHERE b.material_kind = 'mfg_product' AND b.item_code = i.item_code AND b.company_id = so.company_id
                           ORDER BY b.is_main_supplier DESC LIMIT 1) sup ON true
       LEFT JOIN LATERAL (SELECT l.id::text AS id, l.supplier_id::text AS supplier_id, ls.name AS supplier_name
                            FROM scm.reno_doc_lines l LEFT JOIN scm.suppliers ls ON ls.id = l.supplier_id
                           WHERE l.so_item_id = i.id AND l.kind IN ('ITEM', 'CHILD') AND l.omitted_by_vo_id IS NULL LIMIT 1) cl ON true
       LEFT JOIN LATERAL (SELECT p.category_group, p.sub_category, p.category::text AS category FROM scm.mfg_products p
                           WHERE p.code = i.item_code AND p.company_id = so.company_id ORDER BY (p.status::text = 'ACTIVE') DESC LIMIT 1) prod ON true
       LEFT JOIN scm.product_category_groups cg ON cg.code = prod.category_group
       LEFT JOIN scm.product_sub_categories sc ON sc.group_code = cg.code AND sc.code = prod.sub_category
      WHERE ${PROJECT_SO} AND NOT coalesce(i.cancelled, false)
      ORDER BY so.so_date NULLS LAST, i.doc_no, i.line_no NULLS LAST`,
    projectId, companyId);
  const r = all.filter((x) => lineVisible(scope, x.cat_code ?? null, x.sub_code ?? null));
  const plans = await readPlans(db, r.map((x) => x.id));
  const materials = await readLineMaterials(db, r.map((x) => ({ id: x.id, itemCode: x.item_code ?? "", qty: Number(x.qty) })), companyId, plans.saved);
  const lines: ManagedLine[] = r.map((x) => {
    const pos = posOf(x.pos);
    const status = String(x.so_status ?? "").toUpperCase();
    const qty = Number(x.qty);
    const picked = plans.picked.get(x.id);
    return {
      id: x.id, soDocNo: x.doc_no, soStatus: status, voLocked: status !== "DRAFT", lineNo: x.line_no,
      itemCode: x.item_code ?? "", description: (x.description ?? "").trim() || (x.item_code ?? ""), variantText: x.description2?.trim() || null,
      variants: variantsOf(x.variants), itemGroup: x.item_group, uom: x.uom ?? "UNIT", qty,
      unitPriceSen: finance ? Number(x.unit_price_sen ?? 0) : null, discountSen: finance ? Number(x.discount_sen ?? 0) : null,
      amountSen: finance ? Number(x.total_sen ?? 0) : null,
      area: x.area, remark: x.remark?.trim() || null,
      supplierName: picked?.name ?? (x.contract_line_id ? x.contract_supplier_name : x.supplier_name),
      supplierId: picked?.id ?? (x.contract_line_id ? x.contract_supplier_id : x.supplier_id),
      contractLineId: x.contract_line_id, supplierChoices: choicesOf(x.supplier_choices), materials: materials.get(x.id) ?? [],
      goesTo: voGoesTo({ itemCode: x.item_code, itemGroup: x.item_group, mainSupplierCode: picked?.code ?? x.supplier_code }),
      categoryCode: x.cat_code ?? null, subCode: x.sub_code ?? null,
      variantCategory: x.prod_category ? variantCategoryOf(x.prod_category, x.prod_sub) : null,
      categoryLabel: x.cat_label ?? "Other", categorySort: x.cat_sort ?? 999, subLabel: x.sub_label ?? "General", subSort: x.sub_sort ?? 999,
      pos, photoKeys: photoList(x.photo_urls), skuPhotos: skuPhotoList(x.sku_photos), gr: grOf(pos), do: markOf(qty, Number(x.delivered ?? 0)),
      plan: plans.byId.get(x.id) ?? { orderOn: null, deliverOn: null, noPo: false },
    };
  });
  const pending = await rows<{ id: string; amendment_no: string; po_id: string; po_number: string; source: string | null }>(db,
    `SELECT a.id::text AS id, a.amendment_no, a.po_id::text AS po_id, a.po_number, a.source_so_amendment_id::text AS source
       FROM scm.po_amendments a JOIN scm.so_amendments sa ON sa.id = a.source_so_amendment_id
       JOIN scm.mfg_sales_orders so ON so.doc_no = sa.so_doc_no
      WHERE ${PROJECT_SO} AND a.status::text = 'REQUESTED'
      ORDER BY a.created_at`,
    projectId, companyId);
  const { results: supplierRows } = await db.prepare(
    `SELECT s.id::text AS id, s.name FROM scm.suppliers s WHERE s.company_id = ? AND s.status::text = 'ACTIVE' ORDER BY s.name`,
  ).bind(companyId).all<{ id: string; name: string }>();
  // A PO change shows only while the caller sees a line of that PO.
  const shownPending = keepVisiblePos(pending, (p) => p.po_id, lines.flatMap((l) => l.pos.map((p) => p.poId)), scope);
  return {
    finance, plansReady: plans.ready, categoryRestricted: scope !== null,
    sos: sos.map((s) => ({ docNo: s.doc_no, status: s.status, voLocked: String(s.status).toUpperCase() !== "DRAFT", renovation: Boolean(s.renovation) })),
    lines,
    suppliers: supplierRows ?? [],
    pendingPoChanges: shownPending.map((p) => ({
      id: p.id, amendmentNo: p.amendment_no, poId: p.po_id, poNumber: p.po_number, voLabel: p.source ? voLabels.get(p.source) ?? null : null,
    })),
  };
}

/* ---------- writes ---------- */

/** The line, when it is on one of this project's live sales orders and in the caller's category scope (a hidden line reads as missing). */
export async function projectLine(
  db: Db, projectId: number, companyId: number, soItemId: string, scope: CategoryScope | null = null,
): Promise<{ id: string; doc_no: string } | null> {
  const line = await db.prepare(
    `SELECT i.id::text AS id, i.doc_no, cg.code AS cat_code, sc.code AS sub_code
       FROM scm.mfg_sales_order_items i JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       LEFT JOIN LATERAL (SELECT p.category_group, p.sub_category FROM scm.mfg_products p
                           WHERE p.code = i.item_code AND p.company_id = so.company_id ORDER BY (p.status::text = 'ACTIVE') DESC LIMIT 1) prod ON true
       LEFT JOIN scm.product_category_groups cg ON cg.code = prod.category_group
       LEFT JOIN scm.product_sub_categories sc ON sc.group_code = cg.code AND sc.code = prod.sub_category
      WHERE i.id::text = ? AND ${PROJECT_SO}`,
  ).bind(soItemId, projectId, companyId).first<{ id: string; doc_no: string; cat_code: string | null; sub_code: string | null }>();
  if (!line || !lineVisible(scope, line.cat_code, line.sub_code)) return null;
  return { id: line.id, doc_no: line.doc_no };
}

export async function saveLinePlan(db: Db, soItemId: string, companyId: number, userId: number, patch: LinePlanPatch): Promise<ManagedLine["plan"] | { refusal: string }> {
  const cur = await db.prepare(`SELECT order_on::text AS order_on, deliver_on::text AS deliver_on, no_po FROM scm.reno_beta_line_plans WHERE so_item_id::text = ?`)
    .bind(soItemId).first<{ order_on: string | null; deliver_on: string | null; no_po: boolean }>();
  const next = mergePlan(cur ? { orderOn: cur.order_on, deliverOn: cur.deliver_on, noPo: Boolean(cur.no_po) } : { orderOn: null, deliverOn: null, noPo: false }, patch);
  const refusal = planOrderRefusal(next);
  if (refusal) return { refusal };
  await db.prepare(
    `INSERT INTO scm.reno_beta_line_plans (so_item_id, company_id, order_on, deliver_on, no_po, updated_by, updated_at)
     VALUES (?::uuid, ?, ?::date, ?::date, ?, ?, now())
     ON CONFLICT (so_item_id) DO UPDATE SET order_on = excluded.order_on, deliver_on = excluded.deliver_on, no_po = excluded.no_po,
       updated_by = excluded.updated_by, updated_at = now()`,
  ).bind(soItemId, companyId, next.orderOn, next.deliverOn, next.noPo, userId).run();
  return next;
}

/** One date on many lines in one read and one write: a band's date, which a request per line made slow (owner, 4 Nov
    2026). A line that is not the project's, or that the plan's rule refuses, is left out and named. */
export async function saveLinePlans(
  db: Db, projectId: number, companyId: number, userId: number, itemIds: readonly string[], patch: LinePlanPatch, scope: CategoryScope | null,
): Promise<{ saved: string[]; refused: { itemCode: string; reason: string }[]; docNos: string[] }> {
  const { results } = await db.prepare(
    `SELECT i.id::text AS id, i.doc_no, i.item_code, cg.code AS cat_code, sc.code AS sub_code,
            pl.order_on::text AS order_on, pl.deliver_on::text AS deliver_on, pl.no_po
       FROM scm.mfg_sales_order_items i JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       LEFT JOIN scm.reno_beta_line_plans pl ON pl.so_item_id = i.id
       LEFT JOIN LATERAL (SELECT p.category_group, p.sub_category FROM scm.mfg_products p
                           WHERE p.code = i.item_code AND p.company_id = so.company_id ORDER BY (p.status::text = 'ACTIVE') DESC LIMIT 1) prod ON true
       LEFT JOIN scm.product_category_groups cg ON cg.code = prod.category_group
       LEFT JOIN scm.product_sub_categories sc ON sc.group_code = cg.code AND sc.code = prod.sub_category
      WHERE i.id::text IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND ${PROJECT_SO}`,
  ).bind(JSON.stringify(itemIds), projectId, companyId).all<{
    id: string; doc_no: string; item_code: string; cat_code: string | null; sub_code: string | null; order_on: string | null; deliver_on: string | null; no_po: boolean | null;
  }>();
  const rows: { id: string; order_on: string | null; deliver_on: string | null; no_po: boolean }[] = [];
  const refused: { itemCode: string; reason: string }[] = [];
  const docNos = new Set<string>();
  for (const r of results ?? []) {
    if (!lineVisible(scope, r.cat_code, r.sub_code)) continue;
    const next = mergePlan({ orderOn: r.order_on, deliverOn: r.deliver_on, noPo: Boolean(r.no_po) }, patch);
    const refusal = planOrderRefusal(next);
    if (refusal) { refused.push({ itemCode: r.item_code, reason: refusal }); continue; }
    rows.push({ id: r.id, order_on: next.orderOn, deliver_on: next.deliverOn, no_po: next.noPo });
    docNos.add(r.doc_no);
  }
  if (rows.length) {
    await db.prepare(
      `INSERT INTO scm.reno_beta_line_plans (so_item_id, company_id, order_on, deliver_on, no_po, updated_by, updated_at)
       SELECT x.id, ?, x.order_on, x.deliver_on, x.no_po, ?, now()
         FROM jsonb_to_recordset(?::text::jsonb) AS x(id uuid, order_on date, deliver_on date, no_po boolean)
       ON CONFLICT (so_item_id) DO UPDATE SET order_on = excluded.order_on, deliver_on = excluded.deliver_on, no_po = excluded.no_po,
         updated_by = excluded.updated_by, updated_at = now()`,
    ).bind(companyId, userId, JSON.stringify(rows)).run();
  }
  return { saved: rows.map((r) => r.id), refused, docNos: [...docNos] };
}

/* ---------- supplier per line (owner, 3 Nov 2026) ---------- */

/** The renovation contract line behind an SO line, with what the supplier change needs. */
export async function contractLineOf(db: Db, soItemId: string): Promise<{ lineId: string; docNo: string; itemCode: string; version: number } | null> {
  const r = await db.prepare(
    `SELECT l.id::text AS line_id, s.so_doc_no AS doc_no, i.item_code, k.version
       FROM scm.reno_doc_lines l JOIN scm.reno_doc_sections s ON s.id = l.section_id
       JOIN scm.mfg_sales_order_items i ON i.id = l.so_item_id
       JOIN scm.reno_so_contracts k ON k.so_doc_no = s.so_doc_no
      WHERE l.so_item_id::text = ? AND l.kind IN ('ITEM', 'CHILD') AND l.omitted_by_vo_id IS NULL
      LIMIT 1`,
  ).bind(soItemId).first<{ line_id: string; doc_no: string; item_code: string | null; version: number }>();
  return r ? { lineId: r.line_id, docNo: r.doc_no, itemCode: r.item_code ?? "", version: Number(r.version) } : null;
}

/** Bind a supplier to a SKU from the line that needs it (owner, 4 Nov 2026: pick from the suppliers we have). No price
    yet; the SKU's first supplier becomes its main one. Null when the supplier is not this company's. */
export async function bindSupplier(db: Db, itemCode: string, companyId: number, supplierId: string): Promise<{ name: string; priceSen: number } | null> {
  const r = await db.prepare(
    `INSERT INTO scm.supplier_material_bindings (supplier_id, material_kind, item_code, material_name, supplier_sku, is_main_supplier, company_id)
     SELECT s.id, 'mfg_product', ?, coalesce((SELECT p.name FROM scm.mfg_products p WHERE p.code = ? AND p.company_id = s.company_id LIMIT 1), ?), ?,
            NOT EXISTS (SELECT 1 FROM scm.supplier_material_bindings b WHERE b.item_code = ? AND b.company_id = ?), ?
       FROM scm.suppliers s WHERE s.id::text = ? AND s.company_id = ?
     RETURNING (SELECT name FROM scm.suppliers WHERE id = supplier_id) AS name`,
  ).bind(itemCode, itemCode, itemCode, itemCode, itemCode, companyId, companyId, supplierId, companyId).first<{ name: string }>();
  return r ? { name: r.name, priceSen: 0 } : null;
}

/** The SKU's binding to this supplier, whose price becomes a contract line's cost; null when it is not bound. */
export async function supplierBinding(db: Db, itemCode: string, companyId: number, supplierId: string): Promise<{ name: string; priceSen: number } | null> {
  const r = await db.prepare(
    `SELECT s.name, coalesce(b.unit_price_sen, 0) AS price_sen
       FROM scm.supplier_material_bindings b JOIN scm.suppliers s ON s.id = b.supplier_id
      WHERE b.material_kind = 'mfg_product' AND b.item_code = ? AND b.company_id = ? AND b.supplier_id::text = ?
      LIMIT 1`,
  ).bind(itemCode, companyId, supplierId).first<{ name: string; price_sen: number }>();
  return r ? { name: r.name, priceSen: Number(r.price_sen) } : null;
}

/** The line's item code and the live PO that holds it, if one does: a raised PO keeps its supplier, as in MRP. */
export async function lineSupplierState(db: Db, soItemId: string): Promise<{ itemCode: string; poNumber: string | null }> {
  const r = await db.prepare(
    `SELECT i.item_code, (SELECT po.po_number FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                           WHERE pi.so_item_id = i.id AND po.status::text <> 'CANCELLED' LIMIT 1) AS po_number
       FROM scm.mfg_sales_order_items i WHERE i.id::text = ?`,
  ).bind(soItemId).first<{ item_code: string | null; po_number: string | null }>();
  return { itemCode: r?.item_code ?? "", poNumber: r?.po_number ?? null };
}

/** Each line's raw materials: its saved list, else the SKU's composition times its qty. */
async function readLineMaterials(db: Db, lines: ReadonlyArray<{ id: string; itemCode: string; qty: number }>, companyId: number, saved: ReadonlySet<string>): Promise<Map<string, LineMaterial[]>> {
  const out = new Map<string, LineMaterial[]>();
  if (lines.length === 0) return out;
  const push = (id: string, m: LineMaterial): void => { out.set(id, [...(out.get(id) ?? []), m]); };
  const product = `LEFT JOIN LATERAL (SELECT p.name, p.uom FROM scm.mfg_products p WHERE p.code = m.material_code AND p.company_id = m.company_id LIMIT 1) p ON true`;
  const savedIds = lines.filter((l) => saved.has(l.id)).map((l) => l.id);
  if (savedIds.length > 0) {
    const r = await rows<{ so_item_id: string; material_code: string; qty: number; name: string | null; uom: string | null }>(db,
      `SELECT m.so_item_id::text AS so_item_id, m.material_code, m.qty, p.name, p.uom FROM scm.so_line_materials m ${product}
        WHERE m.so_item_id::text IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY m.material_code`,
      JSON.stringify(savedIds));
    for (const m of r) push(m.so_item_id, { code: m.material_code, name: m.name, uom: m.uom, qty: Number(m.qty) });
  }
  const preset = lines.filter((l) => !saved.has(l.id) && l.itemCode);
  if (preset.length > 0) {
    const r = await rows<{ sku_code: string; material_code: string; qty: number; name: string | null; uom: string | null }>(db,
      `SELECT m.sku_code, m.material_code, m.qty, p.name, p.uom FROM scm.sku_compositions m ${product}
        WHERE m.company_id = ? AND m.sku_code IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY m.created_at`,
      companyId, JSON.stringify([...new Set(preset.map((l) => l.itemCode))]));
    for (const l of preset) for (const m of r) {
      if (m.sku_code === l.itemCode) push(l.id, { code: m.material_code, name: m.name, uom: m.uom, qty: Math.round(Number(m.qty) * l.qty * 1000) / 1000 });
    }
  }
  return out;
}

/** The codes among `codes` that are not active Raw material SKUs. */
export async function notRawMaterials(db: Db, codes: readonly string[], companyId: number): Promise<string[]> {
  const r = await rows<{ code: string }>(db,
    `SELECT code FROM scm.mfg_products WHERE company_id = ? AND category::text = 'RAW' AND status::text = 'ACTIVE'
        AND code IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    companyId, JSON.stringify(codes));
  const ok = new Set(r.map((x) => x.code));
  return codes.filter((c) => !ok.has(c));
}

/** Replaces the line's list in one statement and marks it saved, so the composition stops applying to this line. */
export async function saveLineMaterials(db: Db, soItemId: string, companyId: number, userId: number, materials: ReadonlyArray<{ code: string; qty: number }>): Promise<void> {
  const list = JSON.stringify(materials);
  await db.prepare(
    `WITH picked AS (SELECT code, qty FROM jsonb_to_recordset(?::text::jsonb) AS x(code text, qty numeric)),
     gone AS (DELETE FROM scm.so_line_materials m WHERE m.so_item_id = ?::uuid AND m.material_code NOT IN (SELECT code FROM picked)),
     kept AS (INSERT INTO scm.so_line_materials (so_item_id, company_id, material_code, qty, updated_by)
              SELECT ?::uuid, ?, code, qty, ? FROM picked
              ON CONFLICT (so_item_id, material_code) DO UPDATE SET qty = excluded.qty, updated_by = excluded.updated_by, updated_at = now())
     INSERT INTO scm.reno_beta_line_plans (so_item_id, company_id, materials_saved, updated_by, updated_at)
     VALUES (?::uuid, ?, true, ?, now())
     ON CONFLICT (so_item_id) DO UPDATE SET materials_saved = true, updated_by = excluded.updated_by, updated_at = now()`,
  ).bind(list, soItemId, soItemId, companyId, userId, soItemId, companyId, userId).run();
}

/** Keeps the pick on the line's plan, leaving its dates as they are. */
export async function saveLineSupplier(db: Db, soItemId: string, companyId: number, userId: number, supplierId: string): Promise<void> {
  await db.prepare(
    `INSERT INTO scm.reno_beta_line_plans (so_item_id, company_id, supplier_id, updated_by, updated_at)
     VALUES (?::uuid, ?, ?::uuid, ?, now())
     ON CONFLICT (so_item_id) DO UPDATE SET supplier_id = excluded.supplier_id, updated_by = excluded.updated_by, updated_at = now()`,
  ).bind(soItemId, companyId, supplierId, userId).run();
}
