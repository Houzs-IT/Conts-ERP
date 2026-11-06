/* Production orders: /api/scm/production-orders (owner, 4 Nov 2026: "copy the purchase order exactly into production
   order"). The Purchase Order routes cloned onto their own tables (migration 0208), same request and response shapes, so
   the cloned screens work unchanged. What the PO's handlers did to OTHER documents is left out on purpose, because a
   production order shares no state with them: no SO quota (po_qty_picked), no allocations, no AutoCount, no GRN lock, no
   amendments, no email to a supplier. An order made from a PO to INHOUSE is created by the trigger in that migration. */

import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { PO_STATUS_BUCKETS } from '../lib/po-status-buckets';
import { HELD_OR_TERM } from '../lib/document-hold';
import { makeHoldHandler } from '../lib/document-hold-route';
import { PO_HEADER_COLS, PO_LIST_SELECT, poListSelect, orderPoList, readPoListFilters } from '../lib/po-list-read';
import { attachPoLines, buildPoExportRows } from '../lib/production-line-export';
import { buildPoFacets } from '../lib/production-list-facets';
import { buildVariantSummary } from '../shared';
import { orderSofaModuleRowsWithinBuilds, sortLinesByStoredLineNo, sortSoLinesByGroupRank } from '../shared/so-line-display';
import { nextPoLineNo, stampPoLineNos } from '../lib/po-line-order';
import { parseLineNumbers, invalidLineNumberBody } from '../shared/line-numbers';
import { VALID_CURRENCIES, VALID_KINDS } from '../lib/purchase-doc-vocab';
import { cascadePoSupplierDate, SUPPLIER_DATE_SLOT_COL, type SupplierDateSlot } from '../lib/production-supplier-date-cascade';
import { description2InputsChanged } from '../lib/po-line-description2';
import { dateOrNull, coerceEmptyDates } from '../lib/date-coerce';
import { todayMyt } from '../lib/my-time';
import { mintMonthlyDocNo, insertWithDocNoRetry } from '../lib/doc-no';
import { readStatusCounts } from '../lib/status-counts';
import { scopeToCompany, activeCompanyId, stampCompany, companyDocPrefix, requireActiveCompanyId, scopeToCompanyId, NOT_THIS_COMPANY } from '../lib/companyScope';
import { enrichLinesWithFabricSupplierCode } from '../lib/fabric-supplier-code';
import { signSoItemPhotoUrl, soItemPhotoBindings } from '../lib/r2';
import { baseKeyOf, thumbKeyFor } from '../../services/photoThumbs';
import { proxyFallbackPayload, type PhotoUrlPayload } from '../lib/photoProxyFallback';
import { unknownProductCodeRefusal } from '../lib/validate-item-codes';
import { recordEntityAudit, diffFields, compactChanges, fieldChange, statusChange } from '../lib/entity-audit';
import { PO_LINE_AUDIT_FIELDS, PO_LINE_AUDIT_SELECT } from '../lib/entity-audit-fields';
import { eager } from '../lib/concurrency';
import { skuCategoryResolver, lineIdentityFields } from '../lib/sku-category';
import { readMfgProductBindings } from '../lib/supplier-bindings';
import { VALID_STATUSES, parseBulkSupplierDateBody, createMfgPurchaseOrderHandler, cancelPurchaseOrderHandler, reopenPurchaseOrderHandler } from './mfg-purchase-orders';
import { computeMrp } from './mrp';
import { postGrnAndRollup, recordGrnCreate } from './grns';
import { createDoFromSoLinesHandler, deductInventoryForDo, patchDeliveryOrderStatusHandler, soDeliverableRemaining } from './delivery-orders-mfg';
import { createDraftGrnsFromPoItemsCore, type GrnFromPoItemsContext } from '../lib/grn-from-po-core';
import { loadLeadBuffers } from '../../services/agents/procurement-learning';
import { paginateAll, chunkIn } from '../lib/paginate-all';
import { pgrestInList } from '../lib/pgrest-in-list';
import { klToday, materialDates } from '../lib/production-material-dates';
import { scmAreaAllows } from '../middleware/area-guard';
import { checkReturn, filterProductionTab, holidaySet, materialVerdict, progressOf, stockStatusOf, validHours, wholeNeed, type MaterialState, type PoLink, type ReturnLine } from '../lib/renovation-production';
import { filterProductionList } from '../lib/production-list-read';
import { PRODUCTION_DOC, issueMaterials, returnMaterial, reverseIssues } from '../lib/renovation-production-stock';

export const productionOrders = new Hono<{ Bindings: Env; Variables: Variables }>();
productionOrders.use('*', supabaseAuth);

const RAW_CATEGORY = 'RAW';

export type MaterialPick = { materialId: string; orderId: string; qty: number; supplierId: string; warehouseId: string; projectId: number | null };

/* Combined: one PO per supplier and warehouse. Per SO: one per production order as well. */
export function groupMaterialPicks<T extends MaterialPick>(picks: readonly T[], perOrder: boolean): T[][] {
  const by = new Map<string, T[]>();
  for (const p of picks) {
    const k = `${p.supplierId}|${p.warehouseId}|${perOrder ? p.orderId : ''}`;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.values()];
}

const toProduction = (select: string): string => select.replace('items:purchase_order_items', 'items:production_order_items');
const PRODUCTION_COLS = 'production_time_days, production_time_hours, plan_start, actual_start_at, project_id, source_po_id';
const PRODUCTION_LIST_SELECT = `${toProduction(PO_LIST_SELECT)}, ${PRODUCTION_COLS}`;
export const productionListSelect = (f: Parameters<typeof poListSelect>[0]): string => `${toProduction(poListSelect(f))}, ${PRODUCTION_COLS}`;

const PO_AUDIT_FIELDS: Array<[string, string]> = [
  ['productionTimeDays', 'production_time_days'], ['productionTimeHours', 'production_time_hours'], ['planStart', 'plan_start'],
  ['poDate', 'po_date'], ['expectedAt', 'expected_at'], ['currency', 'currency'],
  ['notes', 'notes'], ['supplierId', 'supplier_id'], ['purchaseLocationId', 'purchase_location_id'],
  ['supplierDeliveryDate2', 'supplier_delivery_date_2'], ['supplierDeliveryDate3', 'supplier_delivery_date_3'],
  ['supplierDeliveryDate4', 'supplier_delivery_date_4'],
];

/* The BEFORE half of the header PATCH's from->to pairs, plus the identity
   columns every audit row on this entity needs. */
const PO_AUDIT_SELECT =
  `id, po_number, status, company_id, ${PO_AUDIT_FIELDS.map(([, snake]) => snake).join(', ')}`;


const ITEM_COLS = 'line_no, id, production_order_id, binding_id, material_kind, item_code, material_name, supplier_sku, qty, unit_price_sen, line_total_sen, received_qty, notes, created_at, ' +
  'item_group, description, description2, uom, discount_sen, unit_cost_sen, gap_inches, divan_height_inches, divan_price_sen, leg_height_inches, leg_price_sen, ' +
  'custom_specials, line_suffix, special_order_price_sen, variants, delivery_date, warehouse_id, supplier_delivery_date_2, supplier_delivery_date_3, supplier_delivery_date_4, ' +
  'so_item_id, photo_urls, room, category_group, sub_category';

/** His estimate in days: blank is no estimate. */
const productionTime = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 10) / 10 : null;
};

async function loadAuditMeta(sb: any, id: string): Promise<{ docNo: string | null; companyId: number | null; status: string | null }> {
  const { data } = await sb.from('production_orders').select('po_number, company_id, status').eq('id', id).maybeSingle();
  const r = (data ?? {}) as { po_number?: string; company_id?: number; status?: string };
  return { docNo: r.po_number ?? null, companyId: r.company_id ?? null, status: r.status ?? null };
}

async function recomputePoTotals(sb: any, poId: string) {
  const { data: items, error: itemsErr } = await sb.from('production_order_items')
    .select('line_total_sen')
    .eq('production_order_id', poId);
  /* A failed READ is not an empty PO, and `?? []` cannot tell them apart — it
     folded a transient blip into subtotal_sen / total_sen ZERO on an order
     whose lines were intact, i.e. a PO the supplier is owed for silently claimed
     to be worth nothing. The ERROR is the signal, never the emptiness: a
     genuinely empty PO resolves error === null with data === [] and MUST still
     fall through to zero the header. */
  if (itemsErr) {
    /* eslint-disable-next-line no-console */
    console.error('[po-recompute] item read failed — header left unchanged:', poId, itemsErr.message);
    return;
  }
  const subtotal = (items ?? []).reduce((s: number, r: any) => s + (r.line_total_sen ?? 0), 0);
  const { error: updErr } = await sb.from('production_orders').update({
    subtotal_sen: subtotal,
    total_sen: subtotal,
    updated_at: new Date().toISOString(),
  }).eq('id', poId);
  if (updErr) {
    /* eslint-disable-next-line no-console */
    console.error('[po-recompute] header update failed — totals left STALE:', poId, updErr.message);
  }
}

/* Keep header expected_at in sync with the lines: earliest non-null line
   delivery_date, else null. Mirrors the PO-create rule so a per-line Delivery
   Date edit shows on the PO list + PDF (both read the header expected_at).
   Best-effort: never fail the line write on this. (Commander 2026-06-18 #2/#3) */
export async function recomputePoExpectedAt(sb: any, poId: string) {
  try {
    const { data: lines } = await sb.from('production_order_items')
      .select('delivery_date')
      .eq('production_order_id', poId);
    const dates = ((lines ?? []) as Array<{ delivery_date: string | null }>)
      .map((r) => r.delivery_date)
      .filter((d): d is string => Boolean(d))
      .sort();
    await sb.from('production_orders')
      .update({ expected_at: dates[0] ?? null, updated_at: new Date().toISOString() })
      .eq('id', poId);
  } catch (e) {
    console.error('[recomputePoExpectedAt] best-effort failed', { poId, error: e });
  }
}



type MaterialCols = { id: string; production_order_id: string; item_code: string; qty_needed: number | string; qty_issued: number; qty_issued_short: number };

/* One read for every material's verdict, the list's and the order page's, so the two cannot disagree. A failed plan read
   leaves the plan out rather than failing the page: what the material itself has still counts. */
async function materialVerdicts(c: any, sb: any, materials: MaterialCols[], companyId: number | null) {
  if (materials.length === 0) return new Map<string, ReturnType<typeof materialVerdict>>();
  const { data: linked, error } = await sb.from('purchase_order_items')
    .select('production_material_id, qty, received_qty, delivery_date, purchase_order_id, po:purchase_orders!inner (po_number, status, expected_at)')
    .in('production_material_id', materials.map((m) => m.id));
  if (error) throw new Error(error.message);
  const own = new Map<string, PoLink[]>();
  for (const l of (linked ?? []) as unknown as Array<PoLink & { production_material_id: string; po: PoLink['po'] & { status: string } }>) {
    if (!l.po || l.po.status === 'CANCELLED') continue;
    own.set(l.production_material_id, [...(own.get(l.production_material_id) ?? []), l]);
  }
  let lines = new Map<string, { source: string; shortageQty: number; poNumber: string | null; poEta: string | null }>();
  if (companyId != null) {
    try {
      const plan = await computeMrp(sb, { catFilter: RAW_CATEGORY, whFilter: null, includeUndated: true, companyId, leadBuffers: await loadLeadBuffers(c.env.DB) });
      lines = new Map(plan.skus.flatMap((s) => s.lines).map((l) => [l.soItemId, l]));
    } catch (e) { console.error('[production] material plan read failed', e); }
  }
  return new Map(materials.map((m) => [m.id, materialVerdict(m, own.get(m.id) ?? [], lines.get(m.id))]));
}

/* The Stock Status of each order on a list (owner, 6 Nov 2026): READY when every raw material is here, else NOT READY. An
   order with no materials has nothing to wait for and stays blank. */
async function attachMaterialReadiness(c: any, sb: any, rows: Array<Record<string, unknown>>, companyId: number | null): Promise<void> {
  const open = rows.filter((r) => r.status === 'SUBMITTED' || r.status === 'DRAFT' || r.status === 'RECEIVED');
  if (open.length === 0) return;
  const { data: mats } = await sb.from('production_order_materials').select('id, production_order_id, item_code, qty_needed, qty_issued, qty_issued_short').in('production_order_id', open.map((r) => r.id));
  const materials = (mats ?? []) as MaterialCols[];
  if (materials.length === 0) return;
  const verdicts = await materialVerdicts(c, sb, materials, companyId).catch(() => new Map<string, { state: MaterialState }>());
  for (const r of open) {
    const states = materials.filter((m) => m.production_order_id === r.id).flatMap((m) => { const v = verdicts.get(m.id); return v ? [v.state] : []; });
    const status = stockStatusOf(states);
    if (status) r.material_stock_status = status;
  }
}

/* Sundays and public holidays are not schedule days. A failed read leaves Sundays only rather than failing the page. */
type HolidayRow = { holiday_date: string; state: string | null };
async function loadHolidays(sb: any): Promise<HolidayRow[]> {
  const { data, error } = await sb.from('production_holidays').select('holiday_date, state');
  if (error) console.error('[production] holiday read failed', error.message);
  return (data ?? []) as HolidayRow[];
}

/** Status, Progress and Assigned To for the page of rows the list is about to send. */
async function attachProgress(sb: any, rows: Array<Record<string, unknown>>, stateOf: (r: Record<string, unknown>) => string | null): Promise<void> {
  if (rows.length === 0) return;
  const holidays = await loadHolidays(sb);
  const today = todayMyt();
  const { data: people } = await sb.from('production_order_workers').select('production_order_id, name').in('production_order_id', rows.map((r) => r.id)).order('created_at');
  for (const r of rows) {
    r.progress = progressOf(r as never, today, holidaySet(holidays, stateOf(r)));
    r.assigned_to = ((people ?? []) as Array<{ production_order_id: string; name: string }>).filter((p) => p.production_order_id === r.id).map((p) => p.name);
  }
}

/* Prices on a production order are for those who run it or may see cost (audit item 20): a Procurement user who may only
   look reads the work, not what it is worth. */
const PRICE_KEYS = ['subtotal_sen', 'tax_sen', 'total_sen', 'unit_price_sen', 'line_total_sen', 'unit_cost_sen', 'discount_sen'];
const mayReadProductionPrices = (c: any): boolean => {
  const u = c.get('houzsUser') as { product_cost_viewer?: boolean; project_finance_viewer?: boolean } | undefined;
  return Boolean(u?.product_cost_viewer || u?.project_finance_viewer) || scmAreaAllows(c.get('houzsUser'), 'scm.procurement.production', 'edit');
};
const hidePrices = (rows: Array<Record<string, unknown>>): void => {
  for (const r of rows) {
    for (const k of PRICE_KEYS) if (k in r) r[k] = 0;
    if (Array.isArray(r.lines)) hidePrices(r.lines as Array<Record<string, unknown>>);
  }
};

productionOrders.get('/', async (c) => {
  const status = c.req.query('status');
  const supplierId = c.req.query('supplierId');
  const supabase = c.get('supabase');

  /* Opt-in server-side pagination + search + sort + status-counts (mirrors the
     SO list in mfg-sales-orders.ts). The PRESENCE of `page` switches paging on;
     when it is absent/empty the query below is BYTE-IDENTICAL to the historical
     behavior (order po_date desc, created_at desc, limit 500, status + supplierId
     params, company scope, `{ purchaseOrders }` shape). */
  const pageRaw = c.req.query('page');
  const paginate = pageRaw !== undefined && pageRaw !== '';

  let data: unknown = null;
  let error: { message: string } | null = null;
  let total = 0;
  let page = 0;
  let pageSize = 50;
  let statusCounts: Record<string, number> | undefined;
  let countError: string | null = null; // held, not returned here, so the LIST read's own error still wins the report

  if (!paginate) {
    /* --- LEGACY PATH (unchanged) --- */
    let q = supabase
      .from('production_orders')
      .select(PRODUCTION_LIST_SELECT)
      .order('po_date', { ascending: false })
      .order('created_at', { ascending: false })
      // Bound the result so PostgREST's default 1000-row cap can't silently
      // truncate the PO list — match the SO/DO/SI list convention.
      .limit(500);
    if (status && VALID_STATUSES.has(status)) q = q.eq('status', status);
    if (supplierId) q = q.eq('supplier_id', supplierId);
    q = scopeToCompany(q, c); // multi-company: isolate to the active company
    const res = await q;
    data = res.data;
    error = res.error;
  } else {
    /* --- PAGINATED PATH (opt-in via `page`) --- */
    page = Math.max(0, Math.trunc(Number(pageRaw)) || 0);
    const psRaw = Number(c.req.query('pageSize'));
    pageSize = Number.isFinite(psRaw) && psRaw > 0 ? Math.min(100, Math.max(1, Math.trunc(psRaw))) : 50;

    const filters = readPoListFilters((k) => c.req.query(k));
    const q = filterProductionList(
      orderPoList(supabase.from('production_orders').select(productionListSelect(filters), { count: 'exact' }), filters.sort),
      filters,
      c,
      VALID_STATUSES,
    ).range(page * pageSize, page * pageSize + pageSize - 1);

    /* Status counts mirror the FE filter-pill buckets (draft / outstanding /
       open / partial / received / cancelled) over the SAME company + supplier
       filters but WITHOUT status / search / pagination. `outstanding` overlaps
       open + partial by design — see PO_STATUS_BUCKETS. */
    const countBase = () => {
      let cq = supabase.from('production_orders').select('*', { count: 'exact', head: true });
      if (supplierId) cq = cq.eq('supplier_id', supplierId);
      cq = scopeToCompany(cq, c);
      return cq;
    };
    /* PERF: the seven head-only counts read nothing the page query produces, so
       they are issued alongside it rather than after it. Semantics unchanged. */
    const countsProm = eager(Promise.all([
      countBase(),
      countBase().in('status', PO_STATUS_BUCKETS.draft),
      countBase().in('status', PO_STATUS_BUCKETS.outstanding),
      countBase().in('status', PO_STATUS_BUCKETS.open),
      countBase().in('status', PO_STATUS_BUCKETS.partial),
      countBase().in('status', PO_STATUS_BUCKETS.received),
      countBase().in('status', PO_STATUS_BUCKETS.cancelled),
      countBase().or(HELD_OR_TERM),
      ...(['pending', 'in_progress', 'overdue', 'completed'] as const).map((t) => filterProductionTab(countBase(), t, todayMyt())),
    ]));
    const res = await q;
    data = res.data;
    error = res.error;
    total = res.count ?? (res.data?.length ?? 0);
    const [allC, draftC, outstandingC, openC, partialC, receivedC, cancelledC, onHoldC, pendingC, inProgressC, overdueC, completedC] = (await countsProm)();
    // A count that could not be READ is reported, never served as 0; an empty bucket still answers 0 (lib/status-counts.ts).
    const counted = readStatusCounts({ all: allC, draft: draftC, outstanding: outstandingC, open: openC, partial: partialC, received: receivedC, cancelled: cancelledC, on_hold: onHoldC, pending: pendingC!, in_progress: inProgressC!, overdue: overdueC!, completed: completedC! });
    if (counted.ok) statusCounts = counted.counts; else countError = counted.reason;
  }
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (countError) return c.json({ error: 'status_counts_failed', reason: countError }, 500);

  /* Nothing is received against a production order: no downstream lock, no GRN column. */
  const stamped = { rows: ((data ?? []) as Array<{ id: string } & Record<string, unknown>>).map((r) => ({ ...r, has_children: false, transfer_to_grns: [] })) };
  if (paginate) {
    const projectStates = new Map<number, string | null>();
    const projectIds = [...new Set(stamped.rows.map((r) => Number((r as { project_id?: number | null }).project_id)).filter(Boolean))];
    if (projectIds.length > 0) {
      const { data: projects } = await supabase.schema('public').from('projects').select('id, code, name, state').in('id', projectIds);
      const list = (projects ?? []) as Array<{ id: number; code: string | null; name: string | null; state: string | null }>;
      const labels = new Map(list.map((x) => [Number(x.id), [x.code, x.name].filter(Boolean).join(' · ')]));
      for (const x of list) projectStates.set(Number(x.id), x.state);
      for (const r of stamped.rows) (r as Record<string, unknown>).project_label = labels.get(Number((r as { project_id?: number | null }).project_id)) ?? null;
    }
    /* The page's lines, for the grid's line columns (Item Code, Qty, Delivery
       Date, ...) — the same read the export uses (lib/po-line-export.ts), so the
       screen and the file agree cell for cell. The legacy unpaged path does not
       carry them: its callers never render a line column. */
    const withLines = await attachPoLines(supabase, c, stamped.rows);
    if (withLines.error) return c.json({ error: 'lines_read_failed', reason: withLines.error }, 500);
    await attachMaterialReadiness(c, supabase, withLines.rows as Array<Record<string, unknown>>, activeCompanyId(c) ?? null);
    await attachProgress(supabase, withLines.rows as Array<Record<string, unknown>>, (r) => projectStates.get(Number(r.project_id)) ?? null);
    if (!mayReadProductionPrices(c)) hidePrices(withLines.rows as Array<Record<string, unknown>>);
    return c.json({ purchaseOrders: withLines.rows, total, page, pageSize, statusCounts });
  }
  const purchaseOrders = stamped.rows;
  return c.json({ purchaseOrders });
});



/* The sales order a production order belongs to, for the customer and site on its page: its lines' SO, else its
   project's live one. The SO is read, never written. */
const LINKED_SO_COLS = 'doc_no, status, debtor_name, phone, email, customer_type, agent, salesperson_id, ref, customer_so_no, '
  + 'address1, address2, city, postcode, customer_state, customer_country, sales_location, building_type, venue, processing_date, '
  + 'customer_delivery_date, branding, payment_method, project_id, so_kind';
async function loadLinkedSo(sb: any, c: any, items: Array<{ so_item_id?: string | null }>, projectId: number | null): Promise<Record<string, unknown> | null> {
  const soItemId = items.map((i) => i.so_item_id).find(Boolean);
  let docNo: string | null = null;
  if (soItemId) {
    const { data } = await scopeToCompany(sb.from('mfg_sales_order_items').select('doc_no').eq('id', soItemId), c).maybeSingle();
    docNo = (data as { doc_no?: string } | null)?.doc_no ?? null;
  }
  if (!docNo && projectId != null) {
    const { data } = await scopeToCompany(sb.from('mfg_sales_orders').select('doc_no').eq('project_id', projectId).neq('status', 'CANCELLED'), c).order('so_date').limit(1);
    docNo = ((data ?? [])[0] as { doc_no?: string } | undefined)?.doc_no ?? null;
  }
  if (!docNo) return null;
  const { data: so } = await scopeToCompany(sb.from('mfg_sales_orders').select(LINKED_SO_COLS).eq('doc_no', docNo), c).maybeSingle();
  if (!so) return null;
  const { data: pays } = await sb.from('mfg_sales_order_payments').select('method').eq('so_doc_no', docNo);
  const methods = [...new Set(((pays ?? []) as Array<{ method: string | null }>).map((x) => x.method).filter(Boolean))].sort();
  return { ...(so as Record<string, unknown>), payment_methods_summary: methods.join(' + ') };
}

productionOrders.get('/export/rows', async (c) => {
  const out = await buildPoExportRows(c.get('supabase'), c, readPoListFilters((k) => c.req.query(k)), VALID_STATUSES);
  if (out.error !== null) return c.json({ error: 'export_failed', reason: out.error }, 500);
  return c.json(out);
});

productionOrders.get('/facets', async (c) => {
  const out = await buildPoFacets(c.get('supabase'), c, readPoListFilters((k) => c.req.query(k)), VALID_STATUSES);
  if (out.error !== null) return c.json({ error: 'facets_failed', reason: out.error }, 500);
  return c.json(out);
});

/* The production orders behind a PO or a sales order, for those pages' links. */
productionOrders.get('/links', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const poId = c.req.query('poId');
  const soDocNo = c.req.query('soDocNo');
  if (poId) {
    const { data, error } = await scopeToCompanyId(sb.from('production_orders').select('id, po_number, status').eq('source_po_id', poId), co.companyId);
    if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
    return c.json({ productionOrders: data ?? [] });
  }
  if (!soDocNo) return c.json({ productionOrders: [] });
  const { data, error } = await sb.from('production_order_items').select('order:production_orders!inner (id, po_number, status, company_id), so:mfg_sales_order_items!inner (doc_no)')
    .eq('so.doc_no', soDocNo).eq('order.company_id', co.companyId);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const seen = new Map<string, unknown>();
  for (const r of (data ?? []) as unknown as Array<{ order: { id: string; po_number: string; status: string } }>) seen.set(r.order.id, { id: r.order.id, po_number: r.order.po_number, status: r.order.status });
  return c.json({ productionOrders: [...seen.values()] });
});

/* The raw material SKUs a material can be: the catalog's Raw material category. */
productionOrders.get('/raw-skus', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await paginateAll<{ code: string; name: string | null; uom: string | null }>((from, to) =>
    scopeToCompanyId(c.get('supabase').from('mfg_products').select('code, name, uom').eq('category', RAW_CATEGORY).eq('status', 'ACTIVE'), co.companyId)
      .order('code').range(from, to) as never);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ skus: data ?? [] });
});

const rawSkuOf = async (sb: any, companyId: number, code: string) => {
  const { data } = await scopeToCompanyId(sb.from('mfg_products').select('code, name, uom, category').eq('code', code), companyId).limit(1);
  return ((data ?? [])[0] ?? null) as { name: string | null; uom: string | null; category: string } | null;
};
const positiveQty = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e8 ? Math.round(n * 1000) / 1000 : null;
};

/* ── SKU Composition (owner, 5 Nov 2026) ──
   Which raw materials one unit of a SKU uses. Read on its own screen; nothing fills a production order from it yet. */
type ProductName = { code: string; name: string | null; uom: string | null };

productionOrders.get('/sku-composition/skus', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await paginateAll<ProductName>((from, to) =>
    scopeToCompanyId(c.get('supabase').from('mfg_products').select('code, name, uom').neq('category', RAW_CATEGORY).eq('status', 'ACTIVE'), co.companyId)
      .order('code').range(from, to) as never);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ skus: data ?? [] });
});

productionOrders.get('/sku-composition', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data, error } = await paginateAll<{ id: string; sku_code: string; material_code: string; qty: number; notes: string | null }>((from, to) =>
    scopeToCompanyId(sb.from('sku_compositions').select('id, sku_code, material_code, qty, notes'), co.companyId).order('sku_code').order('created_at').range(from, to) as never);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = data ?? [];
  const { data: names, error: nameErr } = await chunkIn<ProductName>([...new Set(rows.flatMap((r) => [r.sku_code, r.material_code]))], (batch, from, to) =>
    scopeToCompanyId(sb.from('mfg_products').select('code, name, uom'), co.companyId).filter('code', 'in', pgrestInList(batch)).order('id').range(from, to));
  if (nameErr) return c.json({ error: 'load_failed', reason: nameErr.message }, 500);
  const byCode = new Map((names ?? []).map((p) => [p.code, p]));
  return c.json({ rows: rows.map((r) => ({
    ...r, sku_name: byCode.get(r.sku_code)?.name ?? null, material_name: byCode.get(r.material_code)?.name ?? null, uom: byCode.get(r.material_code)?.uom ?? null,
  })) });
});

productionOrders.post('/sku-composition', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const skuCode = String(b.skuCode ?? '').trim();
  const materialCode = String(b.materialCode ?? '').trim();
  const qty = positiveQty(b.qty);
  if (!skuCode || !materialCode || qty == null) return c.json({ error: 'validation', message: 'Choose a SKU and a raw material, and give a quantity above zero.' }, 422);
  const sku = await rawSkuOf(sb, co.companyId, skuCode);
  if (!sku || String(sku.category) === RAW_CATEGORY) return c.json({ error: 'validation', message: `${skuCode} is not a SKU that can have a composition.` }, 422);
  const material = await rawSkuOf(sb, co.companyId, materialCode);
  if (!material || String(material.category) !== RAW_CATEGORY) return c.json({ error: 'validation', message: `${materialCode} is not a Raw material SKU.` }, 422);
  const { data, error } = await sb.from('sku_compositions').insert({
    company_id: co.companyId, sku_code: skuCode, material_code: materialCode, qty, notes: b.notes ? String(b.notes) : null, updated_by: c.get('houzsUser')?.id ?? null,
  }).select('id').single();
  if (error?.code === '23505') return c.json({ error: 'validation', message: `${materialCode} is already in ${skuCode}: change its quantity instead.` }, 409);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true, id: (data as { id: string }).id }, 201);
});

productionOrders.patch('/sku-composition/:rowId', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: c.get('houzsUser')?.id ?? null };
  if (b.qty !== undefined) {
    const qty = positiveQty(b.qty);
    if (qty == null) return c.json({ error: 'validation', message: 'Give a quantity above zero.' }, 422);
    updates.qty = qty;
  }
  if (b.notes !== undefined) updates.notes = b.notes ? String(b.notes) : null;
  const { data, error } = await scopeToCompanyId(c.get('supabase').from('sku_compositions').update(updates).eq('id', c.req.param('rowId')), co.companyId).select('id').maybeSingle();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  if (!data) return c.json(NOT_THIS_COMPANY, 404);
  return c.json({ ok: true });
});

productionOrders.delete('/sku-composition/:rowId', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await scopeToCompanyId(c.get('supabase').from('sku_compositions').delete().eq('id', c.req.param('rowId')), co.companyId).select('id').maybeSingle();
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  if (!data) return c.json(NOT_THIS_COMPANY, 404);
  return c.json({ ok: true });
});

/* ── MRP shortages -> raw-material POs ──
   MRP's Proceed PO sends raw-material picks here; SO picks keep going to /mfg-purchase-orders/from-sos. Each PO goes
   through createMfgPurchaseOrderHandler, the create a PO typed by hand goes through, and lands as MRP's POs do:
   confirmed, not emailed. A pick is capped at what the material still has no PO for, so a repeat press orders nothing. */
productionOrders.post('/material-pos', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await c.req.json().catch(() => ({}))) as { picks?: Array<{ materialId?: string; qty?: number; supplierId?: string | null }>; expectedAt?: string; mode?: string };
  const picks = (b.picks ?? []).filter((p) => p.materialId && Number(p.qty) > 0);
  if (picks.length === 0) return c.json({ error: 'validation', message: 'Nothing to order.' }, 422);
  const ids = picks.map((p) => String(p.materialId));
  type MaterialRow = { id: string; item_code: string; description: string | null; qty_needed: number; delivery_date: string | null; production_order_id: string;
    order: { po_number: string; status: string; on_hold: boolean; purchase_location_id: string | null; project_id: number | null } | null };
  const { data: mats, error: matErr } = await scopeToCompanyId(sb.from('production_order_materials')
    .select('id, item_code, description, qty_needed, delivery_date, production_order_id, order:production_orders (po_number, status, on_hold, purchase_location_id, project_id)')
    .in('id', ids), co.companyId);
  if (matErr) return c.json({ error: 'load_failed', reason: matErr.message }, 500);
  const byId = new Map(((mats ?? []) as unknown as MaterialRow[]).map((m) => [m.id, m]));
  const { data: linked, error: linkErr } = await sb.from('purchase_order_items')
    .select('production_material_id, qty, po:purchase_orders!inner (status)').in('production_material_id', ids);
  if (linkErr) return c.json({ error: 'load_failed', reason: linkErr.message }, 500);
  const onPo = new Map<string, number>();
  for (const l of (linked ?? []) as unknown as Array<{ production_material_id: string; qty: number; po: { status: string } | null }>) {
    if (l.po?.status === 'CANCELLED') continue;
    onPo.set(l.production_material_id, (onPo.get(l.production_material_id) ?? 0) + Number(l.qty ?? 0));
  }
  const codes = [...new Set([...byId.values()].map((m) => m.item_code))];
  const { data: binds, error: bindErr } = await readMfgProductBindings<{ item_code: string; supplier_id: string; unit_price_sen: number }>(sb, {
    codes, companyId: co.companyId, select: 'item_code, supplier_id, unit_price_sen',
  });
  if (bindErr) return c.json({ error: 'load_failed', reason: bindErr.message }, 500);
  const { data: inhouse } = await scopeToCompanyId(sb.from('suppliers').select('id').eq('code', 'INHOUSE'), co.companyId).maybeSingle();
  const { data: wh } = await scopeToCompanyId(sb.from('warehouses').select('id').eq('is_active', true), co.companyId).order('code').limit(1);
  const fallbackWh = ((wh ?? [])[0] as { id: string } | undefined)?.id ?? null;
  const { data: prods } = await chunkIn<{ code: string; name: string | null; cost_price_sen: number | null }>(codes, (batch, from, to) =>
    scopeToCompanyId(sb.from('mfg_products').select('code, name, cost_price_sen').filter('code', 'in', pgrestInList(batch)), co.companyId).order('id').range(from, to) as never);
  const prodOf = new Map(prods.map((p) => [p.code, p]));

  const resolved: Array<MaterialPick & { itemCode: string; name: string; unitPriceSen: number; deliveryDate: string | null }> = [];
  const noSupplier: string[] = [];
  for (const p of picks) {
    const m = byId.get(String(p.materialId));
    if (!m?.order) return c.json({ error: 'validation', message: 'A picked material no longer exists. Refresh MRP.' }, 409);
    if (m.order.status !== 'SUBMITTED' || m.order.on_hold) return c.json({ error: 'validation', message: `${m.order.po_number} is not open for ordering.` }, 409);
    const warehouseId = m.order.purchase_location_id ?? fallbackWh;
    if (!warehouseId) return c.json({ error: 'validation', message: 'Add a warehouse first.' }, 409);
    /* A PO line counts whole units; a material may need 2.5 bags. */
    const qty = Math.min(Math.ceil(Number(p.qty)), Math.ceil(Number(m.qty_needed) - (onPo.get(m.id) ?? 0)));
    if (qty <= 0) continue;
    const own = binds.filter((x) => x.item_code === m.item_code);
    const supplierId = p.supplierId ?? own[0]?.supplier_id ?? null;
    if (!supplierId) { noSupplier.push(m.item_code); continue; }
    if (supplierId === (inhouse as { id: string } | null)?.id) return c.json({ error: 'validation', message: `${m.item_code} is a raw material: buy it from an outside supplier.` }, 409);
    resolved.push({
      materialId: m.id, orderId: m.production_order_id, qty, supplierId, warehouseId, projectId: m.order.project_id == null ? null : Number(m.order.project_id),
      itemCode: m.item_code, name: prodOf.get(m.item_code)?.name ?? m.description ?? m.item_code,
      unitPriceSen: Number(own.find((x) => x.supplier_id === supplierId)?.unit_price_sen ?? prodOf.get(m.item_code)?.cost_price_sen ?? 0),
      deliveryDate: dateOrNull(b.expectedAt) ?? m.delivery_date,
    });
  }
  if (noSupplier.length > 0) return c.json({ error: 'missing_bindings', itemCodes: [...new Set(noSupplier)] }, 400);
  if (resolved.length === 0) return c.json({ total: 0, created: [], alreadyOrdered: true }, 200);

  const created: Array<{ id: string; poNumber: string }> = [];
  for (const group of groupMaterialPicks(resolved, b.mode === 'per-so')) {
    const first = group[0]!;
    const projects = [...new Set(group.map((g) => g.projectId))];
    const body = {
      supplierId: first.supplierId, purchaseLocationId: first.warehouseId,
      expectedAt: group.map((g) => g.deliveryDate).filter(Boolean).sort()[0] ?? null,
      items: group.map((g) => ({
        materialKind: 'mfg_product', itemCode: g.itemCode, materialName: g.name, description: g.name, qty: g.qty,
        unitPriceSen: g.unitPriceSen, deliveryDate: g.deliveryDate, warehouseId: g.warehouseId,
      })),
    };
    const out = await createMfgPurchaseOrderHandler({
      req: { json: async () => body }, get: (k: string) => c.get(k as 'supabase'), set: (k: string, v: unknown) => c.set(k as 'supabase', v as never), env: c.env,
      json: (j: unknown, status?: number) => ({ json: j, status: status ?? 200 }),
    }) as unknown as { json: { id?: string; poNumber?: string } & Record<string, unknown>; status: number };
    if (out.status >= 300 || !out.json.id) return c.json({ ...out.json, created }, out.status as 409);
    const { error: rpcErr } = await sb.rpc('production_link_po', {
      p_po: out.json.id, p_materials: group.map((g) => g.materialId), p_project: projects.length === 1 ? projects[0] : null,
    });
    if (rpcErr) return c.json({ error: 'link_failed', reason: rpcErr.message, created }, 500);
    created.push({ id: out.json.id, poNumber: String(out.json.poNumber) });
  }
  return c.json({ total: created.length, created }, 201);
});

/* What changed after Start, for the notice at the top of the order (owner, 6 Nov 2026): workers keep going, so they must
   see it. A VO counts when it touches this order's lines; a PO change arrives through migration 0236's trigger. */
export type OrderChange = { source: string; text: string; at: string; href: string | null };
async function changesAfterStart(sb: any, header: Record<string, unknown>, soItemIds: string[]): Promise<OrderChange[]> {
  const started = header.actual_start_at as string | null;
  if (!started || header.status === 'RECEIVED' || header.status === 'CANCELLED') return [];
  const out: OrderChange[] = [];
  const { data: logged } = await sb.from('entity_audit_log').select('note, created_at').eq('entity_type', 'PRODUCTION_ORDER').eq('entity_id', String(header.id)).eq('source', 'po_sync').gt('created_at', started).order('created_at', { ascending: false }).limit(10);
  const sourcePo = (header as { source_po?: { po_number: string } | null }).source_po?.po_number ?? 'the PO';
  for (const r of (logged ?? []) as Array<{ note: string | null; created_at: string }>) out.push({ source: sourcePo, text: r.note ?? 'A line changed', at: r.created_at, href: header.source_po_id ? `/scm/purchase-orders/${String(header.source_po_id)}` : null });
  if (soItemIds.length > 0) {
    const { data: soLines } = await sb.from('mfg_sales_order_items').select('id, doc_no').in('id', soItemIds);
    const docNos = [...new Set(((soLines ?? []) as Array<{ doc_no: string }>).map((l) => l.doc_no))];
    if (docNos.length > 0) {
      const { data: vos } = await sb.from('reno_variation_orders').select('vo_no, seq, so_doc_no, amendment_id, approved_at').in('so_doc_no', docNos).eq('status', 'APPROVED').gt('approved_at', started).order('approved_at', { ascending: false });
      for (const v of (vos ?? []) as Array<{ vo_no: string; seq: number; so_doc_no: string; amendment_id: string | null; approved_at: string }>) {
        if (!v.amendment_id) continue;
        const { data: lines } = await sb.from('so_amendment_lines').select('sales_order_item_id, change_type, new_qty, old_snapshot').eq('amendment_id', v.amendment_id).in('sales_order_item_id', soItemIds);
        const said = ((lines ?? []) as Array<{ new_qty: number | null; old_snapshot: { qty?: number; item_code?: string } | null }>)
          .map((l) => `${l.old_snapshot?.item_code ?? 'A line'}${l.old_snapshot?.qty != null && l.new_qty != null ? ` ${l.old_snapshot.qty} to ${l.new_qty}` : ' changed'}`);
        if (said.length > 0) out.push({ source: `VO-${String(v.seq).padStart(2, '0')}`, text: said.join(', '), at: v.approved_at, href: `/scm/sales-orders/${encodeURIComponent(v.so_doc_no)}` });
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* In-house technicians, for Assign. */
productionOrders.get('/workers', async (c) => {
  const { data, error } = await c.get('supabase').from('production_workers').select('id, name, trade').order('name');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ workers: data ?? [] });
});

productionOrders.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const [headerRes, itemsRes] = await Promise.all([
    scopeToCompany(supabase.from('production_orders')
      .select(`${PO_HEADER_COLS}, ${PRODUCTION_COLS}, actual_start_by_name, completion_grn_id, completion_do_id, completion_step, completion_error, supplier:suppliers(id, code, name, contact_person, phone, email, address)`)
      .eq('id', id), c).maybeSingle(),
    supabase.from('production_order_items').select(ITEM_COLS).eq('production_order_id', id).order('line_no', { ascending: true }),
  ]);
  if (headerRes.error) return c.json({ error: 'load_failed', reason: headerRes.error.message }, 500);
  if (!headerRes.data) return c.json({ error: 'not_found' }, 404);
  if (itemsRes.error) return c.json({ error: 'load_failed', reason: itemsRes.error.message }, 500);
  const header = headerRes.data as unknown as Record<string, unknown>;
  let sourcePo: { id: string; po_number: string } | null = null;
  if (header.source_po_id) {
    const { data } = await supabase.from('purchase_orders').select('id, po_number').eq('id', String(header.source_po_id)).maybeSingle();
    sourcePo = (data as { id: string; po_number: string } | null) ?? null;
  }
  const purchaseOrder = { ...header, has_children: false, has_open_amendment: false, open_amendment: null, source_po: sourcePo };
  const linkedSo = await loadLinkedSo(supabase, c, (itemsRes.data ?? []) as unknown as Array<{ so_item_id?: string | null }>, header.project_id as number | null);
  const itemRows = orderSofaModuleRowsWithinBuilds(sortSoLinesByGroupRank(
    sortLinesByStoredLineNo((itemsRes.data ?? []) as unknown as Array<Record<string, unknown> & { id: string; item_code: string }>),
    (r) => r.item_group as string | null | undefined,
  ));
  /* "For SO" on the page and the PDF: the SO lines are read, never written. */
  const soItemIds = [...new Set(itemRows.map((it) => it.so_item_id as string | null).filter(Boolean))] as string[];
  const soDocByItem = new Map<string, string>();
  if (soItemIds.length > 0) {
    const { data: soLines } = await supabase.from('mfg_sales_order_items').select('id, doc_no').in('id', soItemIds);
    for (const r of (soLines ?? []) as Array<{ id: string; doc_no: string }>) soDocByItem.set(r.id, r.doc_no);
  }
  const items = itemRows.map((it) => ({
    ...it, receipts: [], allocations: [], so_doc_no: it.so_item_id ? soDocByItem.get(String(it.so_item_id)) ?? null : null, so_drift: null,
  }));
  await enrichLinesWithFabricSupplierCode(supabase, c, items);
  const [grn, dord] = await Promise.all([
    header.completion_grn_id ? supabase.from('grns').select('id, grn_number, status').eq('id', String(header.completion_grn_id)).maybeSingle() : { data: null },
    header.completion_do_id ? supabase.from('delivery_orders').select('id, do_number, status').eq('id', String(header.completion_do_id)).maybeSingle() : { data: null },
  ]);
  const projectId = header.project_id == null ? null : Number(header.project_id);
  const { data: projectRow } = projectId == null ? { data: null } : await supabase.schema('public').from('projects').select('id, code, name, state, building, unit_no').eq('id', projectId).maybeSingle();
  const project = (projectRow ?? null) as { id: number; code: string | null; name: string | null; state: string | null; building: string | null; unit_no: string | null } | null;
  const [holidayRows, { data: workers }, changes] = await Promise.all([
    loadHolidays(supabase),
    supabase.from('production_order_workers').select('id, person_key, name, trade, how').eq('production_order_id', id).order('created_at'),
    changesAfterStart(supabase, { ...header, source_po: sourcePo }, itemRows.map((it) => it.so_item_id as string | null).filter(Boolean) as string[]),
  ]);
  const progress = progressOf(header as never, todayMyt(), holidaySet(holidayRows, project?.state));
  const out = { purchaseOrder, items, linkedSo, project, progress, workers: workers ?? [], changes, holidays: [...holidaySet(holidayRows, project?.state)], completion: { grn: grn.data ?? null, deliveryOrder: dord.data ?? null } };
  if (!mayReadProductionPrices(c)) hidePrices([out.purchaseOrder as unknown as Record<string, unknown>, ...(items as Array<Record<string, unknown>>)]);
  return c.json(out);
});

productionOrders.get('/:id/revisions', (c) => c.json({ revisions: [] }));

/* ── Raw materials ── */

const loadOrderHead = async (sb: any, companyId: number, id: string) => {
  const { data } = await scopeToCompanyId(sb.from('production_orders').select('id, status, expected_at, po_number, actual_start_at, on_hold').eq('id', id), companyId).maybeSingle();
  return data as { id: string; status: string; expected_at: string | null; po_number: string; actual_start_at: string | null; on_hold: boolean } | null;
};
productionOrders.get('/:id/materials', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await scopeToCompanyId(c.get('supabase').from('production_order_materials')
    .select('id, item_code, description, uom, qty_needed, processing_date, delivery_date, notes, qty_issued, qty_returned, qty_issued_short, added_how, from_composition').eq('production_order_id', c.req.param('id')), co.companyId).order('created_at');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ materials: data ?? [] });
});

productionOrders.post('/:id/materials', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrderHead(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  if (order.status === 'CANCELLED') return c.json({ error: 'validation', message: 'This production order is cancelled.' }, 409);
  if (order.actual_start_at || order.status === 'RECEIVED') return c.json({ error: 'validation', message: 'This order has started: use Request more instead.' }, 409);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = String(b.itemCode ?? '').trim();
  const qty = positiveQty(b.qtyNeeded);
  if (!code || qty == null) return c.json({ error: 'validation', message: 'Choose a raw material and give a quantity above zero.' }, 422);
  const sku = await rawSkuOf(sb, co.companyId, code);
  if (!sku || String(sku.category) !== RAW_CATEGORY) return c.json({ error: 'validation', message: `${code} is not a Raw material SKU.` }, 422);
  const auto = materialDates(order.expected_at, klToday());
  const { data, error } = await sb.from('production_order_materials').insert({
    production_order_id: order.id, company_id: co.companyId, item_code: code, description: sku.name, uom: sku.uom, qty_needed: qty,
    processing_date: dateOrNull(b.processingDate) ?? auto.processingDate, delivery_date: dateOrNull(b.deliveryDate) ?? auto.deliveryDate, notes: b.notes ? String(b.notes) : null, updated_by: c.get('houzsUser')?.id ?? null,
  }).select('id').single();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true, id: (data as { id: string }).id }, 201);
});

const materialOf = async (sb: any, companyId: number, orderId: string, id: string) => {
  const { data } = await scopeToCompanyId(sb.from('production_order_materials').select('id, item_code, qty_issued').eq('id', id).eq('production_order_id', orderId), companyId).maybeSingle();
  return data as { id: string; item_code: string; qty_issued: number } | null;
};

productionOrders.patch('/:id/materials/:materialId', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const m = await materialOf(sb, co.companyId, c.req.param('id'), c.req.param('materialId'));
  if (!m) return c.json(NOT_THIS_COMPANY, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: c.get('houzsUser')?.id ?? null };
  if (b.qtyNeeded !== undefined) {
    const qty = positiveQty(b.qtyNeeded);
    if (qty == null) return c.json({ error: 'validation', message: 'Give a quantity above zero.' }, 422);
    if (m.qty_issued > 0) return c.json({ error: 'validation', message: `${m.item_code} has left stock: use Request more or Return stock.` }, 409);
    updates.qty_needed = qty;
  }
  if (b.processingDate !== undefined) updates.processing_date = dateOrNull(b.processingDate);
  if (b.deliveryDate !== undefined) updates.delivery_date = dateOrNull(b.deliveryDate);
  if (b.notes !== undefined) updates.notes = b.notes ? String(b.notes) : null;
  const { error } = await sb.from('production_order_materials').update(updates).eq('id', m.id);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

productionOrders.delete('/:id/materials/:materialId', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const m = await materialOf(sb, co.companyId, c.req.param('id'), c.req.param('materialId'));
  if (!m) return c.json(NOT_THIS_COMPANY, 404);
  if (m.qty_issued > 0) return c.json({ error: 'validation', message: `${m.item_code} has left stock: use Return stock instead.` }, 409);
  const { count, error: refErr } = await sb.from('purchase_order_items').select('id', { count: 'exact', head: true }).eq('production_material_id', m.id);
  if (refErr) return c.json({ error: 'load_failed', reason: refErr.message }, 500);
  if ((count ?? 0) > 0) return c.json({ error: 'validation', message: `${m.item_code} is on a purchase order, so it stays here.` }, 409);
  const { error } = await sb.from('production_order_materials').delete().eq('id', m.id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: c.req.param('id'), action: 'UPDATE', actor: c.get('houzsUser'), companyId: co.companyId, note: `Material removed: ${m.item_code}`,
    fieldChanges: [],
  });
  return c.json({ ok: true });
});

/* Each material's stock status, from the same allocation the MRP page shows, so the two cannot disagree, and where it
   sits: where it left from once issued, else the warehouse holding the most, else where its PO is arriving. */
export type { MaterialState } from '../lib/renovation-production';
productionOrders.get('/:id/material-status', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data: mats, error } = await scopeToCompanyId(sb.from('production_order_materials').select('id, production_order_id, item_code, qty_needed, qty_issued, qty_issued_short').eq('production_order_id', c.req.param('id')), co.companyId);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = (mats ?? []) as MaterialCols[];
  if (rows.length === 0) return c.json({ statuses: {} });
  const verdicts = await materialVerdicts(c, sb, rows, co.companyId);
  const { data: wh } = await sb.from('warehouses').select('id, code').eq('company_id', co.companyId);
  const codeOf = new Map(((wh ?? []) as Array<{ id: string; code: string }>).map((w) => [w.id, w.code]));
  const { data: moved } = await sb.from('inventory_movements').select('source_doc_id, warehouse_id, qty').eq('source_doc_type', PRODUCTION_DOC).eq('movement_type', 'OUT').in('source_doc_id', rows.map((r) => r.id));
  const { data: bal } = await sb.from('inventory_balances').select('warehouse_id, item_code, qty').eq('company_id', co.companyId).in('item_code', [...new Set(rows.map((r) => r.item_code))]);
  const { data: arriving } = await sb.from('purchase_order_items').select('production_material_id, warehouse_id, po:purchase_orders!inner (purchase_location_id)').in('production_material_id', rows.map((r) => r.id));
  const heaviest = (list: Array<{ warehouse_id: string; qty: number }>): string | null => {
    const top = [...list].filter((x) => x.qty > 0 && codeOf.get(x.warehouse_id) !== 'ONSITE').sort((a, b) => b.qty - a.qty)[0];
    return top ? codeOf.get(top.warehouse_id) ?? null : null;
  };
  const statuses: Record<string, unknown> = {};
  for (const r of rows) {
    const v = verdicts.get(r.id);
    const out = ((moved ?? []) as Array<{ source_doc_id: string; warehouse_id: string; qty: number }>).filter((x) => x.source_doc_id === r.id);
    const toCome = ((arriving ?? []) as unknown as Array<{ production_material_id: string; warehouse_id: string | null; po: { purchase_location_id: string | null } | null }>).find((x) => x.production_material_id === r.id);
    const here = out.length > 0 ? heaviest(out) : heaviest(((bal ?? []) as Array<{ warehouse_id: string; item_code: string; qty: number }>).filter((b) => b.item_code === r.item_code));
    const coming = toCome ? codeOf.get(toCome.warehouse_id ?? toCome.po?.purchase_location_id ?? '') ?? null : null;
    statuses[r.id] = { ...v, issued: r.qty_issued, warehouse: here ?? (v?.state === 'po' ? coming : null), arriving: !here && v?.state === 'po' && Boolean(coming) };
  }
  return c.json({ statuses });
});

const createProductionOrder = async (c: any) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const supplierId = body.supplierId as string | undefined;
  if (!supplierId) return c.json({ error: 'supplier_id_required' }, 400);
  const expectedAt = dateOrNull(body.expectedAt) ?? todayMyt();
  const purchaseLocationId = body.purchaseLocationId as string | undefined;
  if (!purchaseLocationId) return c.json({ error: 'purchase_location_id_required' }, 400);
  const headerD2 = dateOrNull(body.supplierDeliveryDate2);
  const headerD3 = dateOrNull(body.supplierDeliveryDate3);
  const headerD4 = dateOrNull(body.supplierDeliveryDate4);
  const items = (body.items as Array<Record<string, unknown>> | undefined) ?? [];
  const currency = ((body.currency as string) ?? 'MYR').toUpperCase();
  if (!VALID_CURRENCIES.has(currency)) return c.json({ error: 'invalid_currency' }, 400);
  const supabase = c.get('supabase');
  const user = c.get('user');

  const groupOf = await skuCategoryResolver(supabase, items, activeCompanyId(c) ?? null);
  const unknownCodes = await unknownProductCodeRefusal(supabase, items.map((it) => ({ code: it.itemCode, kind: it.materialKind })), activeCompanyId(c));
  if (unknownCodes) return c.json(unknownCodes, 409);
  for (const [i, it] of items.entries()) {
    const parsed = parseLineNumbers({ qty: { value: it.qty }, unitPriceSen: { value: it.unitPriceSen }, discountSen: { value: it.discountSen } });
    if (!parsed.ok) {
      const b = invalidLineNumberBody(parsed.invalid);
      return c.json({ ...b, reason: `Line ${i + 1}: ${b.reason}` }, 400);
    }
    if (!VALID_KINDS.has(it.materialKind as string)) return c.json({ error: 'invalid_material_kind', reason: `Line ${i + 1}` }, 400);
    if (!it.itemCode || !it.materialName) return c.json({ error: 'item_code_required', reason: `Line ${i + 1}` }, 400);
  }
  let subtotal = 0;
  const itemRows = items.map((it) => {
    const qty = Math.max(0, Number(it.qty ?? 0));
    const unit = Math.max(0, Number(it.unitPriceSen ?? 0));
    const discountSen = Math.max(0, Number(it.discountSen ?? 0));
    const lineTotal = Math.max(0, qty * unit - discountSen);
    subtotal += lineTotal;
    return {
      binding_id: (it.bindingId as string | undefined) ?? null, material_kind: it.materialKind, item_code: it.itemCode, material_name: it.materialName,
      supplier_sku: (it.supplierSku as string | undefined) ?? null, qty, unit_price_sen: unit, line_total_sen: lineTotal,
      notes: (it.notes as string | undefined) ?? null, discount_sen: discountSen, delivery_date: dateOrNull(it.deliveryDate),
      supplier_delivery_date_2: dateOrNull(it.supplierDeliveryDate2) ?? headerD2, supplier_delivery_date_3: dateOrNull(it.supplierDeliveryDate3) ?? headerD3,
      supplier_delivery_date_4: dateOrNull(it.supplierDeliveryDate4) ?? headerD4, warehouse_id: (it.warehouseId as string | undefined) ?? null,
      variants: (it.variants as unknown) ?? null, description: (it.description as string | undefined) ?? null,
      ...lineIdentityFields(groupOf, it, buildVariantSummary),
      so_item_id: (it.soItemId as string | undefined) ?? null,
    };
  });
  const yymm = todayMyt().slice(2, 7).replace('-', '');
  const series = `${companyDocPrefix(c)}PRO-${yymm}`;
  const asDraft = body.asDraft === true;
  const headerInsert: Record<string, unknown> = {
    company_id: activeCompanyId(c), supplier_id: supplierId, status: asDraft ? 'DRAFT' : 'SUBMITTED', submitted_at: asDraft ? null : new Date().toISOString(),
    currency, expected_at: expectedAt, supplier_delivery_date_2: headerD2, supplier_delivery_date_3: headerD3, supplier_delivery_date_4: headerD4,
    production_time_days: productionTime(body.productionTimeDays), production_time_hours: productionTime(body.productionTimeHours),
    plan_start: dateOrNull(body.planStart),
    notes: (body.notes as string | undefined) ?? null, subtotal_sen: subtotal, tax_sen: 0, total_sen: subtotal, created_by: user.id, purchase_location_id: purchaseLocationId,
  };
  /* The column's default is the database's UTC date, a day behind in Malaysia until 8am. */
  headerInsert.po_date = body.poDate || todayMyt();
  let poNumber = '';
  const { data: headerData, error: hErr } = await insertWithDocNoRetry(
    async () => { poNumber = await mintMonthlyDocNo(supabase, 'production_orders', 'po_number', series); return poNumber; },
    (dn) => {
      headerInsert.po_number = dn;
      return supabase.from('production_orders').insert(headerInsert).select('id, po_number').single();
    },
  );
  if (hErr) return c.json({ error: 'insert_failed', reason: hErr.message }, 500);
  const header = headerData as unknown as { id: string; po_number: string };
  if (itemRows.length > 0) {
    const toInsert = stampPoLineNos(itemRows.map((r) => ({ ...r, production_order_id: header.id })), 1);
    const { error: iErr } = await supabase.from('production_order_items').insert(stampCompany(toInsert, c));
    if (iErr) {
      await supabase.from('production_orders').delete().eq('id', header.id);
      return c.json({ error: 'items_insert_failed', reason: iErr.message }, 500);
    }
  }
  await recordEntityAudit(supabase, {
    entityType: 'PRODUCTION_ORDER', entityId: header.id, entityDocNo: header.po_number, action: 'CREATE', actor: c.get('houzsUser'), companyId: activeCompanyId(c),
    statusSnapshot: String(headerInsert.status),
    fieldChanges: compactChanges([fieldChange('status', null, headerInsert.status), fieldChange('supplierId', null, supplierId), fieldChange('totalSen', null, subtotal), fieldChange('lineCount', null, itemRows.length)]),
  });
  return c.json({ id: header.id, poNumber: header.po_number }, 201);
};
productionOrders.post('/', createProductionOrder);

/* Transfer from Sales Order (owner, 6 Nov 2026): it raises an in-house PO in between, through the PO's own create, so every
   order has a PO, the SO quota and its guards are the PO's, and migration 0208's trigger makes the order. One PO per SO:
   Works and Built-in are bound to one unit. A PO and an order to anyone but the In-house Production Team do not mix here. */
productionOrders.post('/from-sos', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await c.req.json().catch(() => ({}))) as {
    picks?: Array<{ soItemId: string; qty: number; supplierId?: string | null }>; targetPoId?: string; expectedAt?: string; purchaseLocationId?: string;
    supplierByCode?: Record<string, string>;
  };
  const picks = (b.picks ?? []).filter((p) => p.soItemId && Number(p.qty) > 0);
  if (picks.length === 0) return c.json({ error: 'no_picks', message: 'Nothing to convert.' }, 400);
  if (picks.some((p) => !Number.isFinite(Number(p.qty)) || Math.floor(Number(p.qty)) < 1)) return c.json({ error: 'validation', message: 'Pick at least one whole unit of each line.' }, 422);
  const { data: inhouseRow } = await scopeToCompanyId(sb.from('suppliers').select('id').eq('code', 'INHOUSE'), co.companyId).maybeSingle();
  const inhouseId = (inhouseRow as { id: string } | null)?.id ?? null;
  if (!inhouseId) return c.json({ error: 'no_inhouse', message: 'Add the In-house Production Team as a supplier first.' }, 409);
  const outside = picks.find((p) => (p.supplierId ?? inhouseId) !== inhouseId);
  if (outside) return c.json({ error: 'not_inhouse', message: 'A production order is for our own team. Raise a PO for an outside supplier.' }, 409);
  type SoLine = { id: string; doc_no: string; item_code: string; description: string | null; item_group: string | null; variants: unknown; warehouse_id: string | null; line_delivery_date: string | null; qty: number; po_qty_picked: number | null };
  const { data: soRows, error: soErr } = await scopeToCompanyId(sb.from('mfg_sales_order_items')
    .select('id, doc_no, item_code, description, item_group, variants, warehouse_id, line_delivery_date, qty, po_qty_picked').in('id', picks.map((p) => p.soItemId)), co.companyId);
  if (soErr) return c.json({ error: 'load_failed', reason: soErr.message }, 500);
  const soById = new Map(((soRows ?? []) as unknown as SoLine[]).map((r) => [r.id, r]));
  const missingLine = picks.find((p) => !soById.has(p.soItemId));
  if (missingLine) return c.json({ error: 'so_line_not_found', message: 'A picked Sales Order line no longer exists. Refresh and try again.' }, 404);
  const toItem = (p: { soItemId: string; qty: number }, so: SoLine) => ({
    materialKind: 'mfg_product', itemCode: so.item_code, materialName: so.description ?? so.item_code, description: so.description, qty: Math.floor(Number(p.qty)),
    unitPriceSen: 0, variants: so.variants,
    itemGroup: so.item_group, deliveryDate: b.expectedAt ?? so.line_delivery_date, warehouseId: b.purchaseLocationId ?? so.warehouse_id, soItemId: so.id,
  });

  if (b.targetPoId) {
    const { data: target } = await scopeToCompanyId(sb.from('production_orders').select('id, status, source_po_id').eq('id', b.targetPoId), co.companyId).maybeSingle();
    const order = target as { id: string; status: string; source_po_id: string | null } | null;
    if (!order) return c.json(NOT_THIS_COMPANY, 404);
    if (order.status === 'RECEIVED' || order.status === 'CANCELLED') return c.json({ error: 'validation', message: `This production order is ${order.status === 'RECEIVED' ? 'complete' : 'cancelled'}.` }, 409);
    for (const p of picks) {
      const so = soById.get(p.soItemId)!;
      const left = Number(so.qty) - Number(so.po_qty_picked ?? 0);
      if (Math.floor(Number(p.qty)) > left) return c.json({ error: 'qty_exceeds_remaining', message: `${so.item_code}: only ${left} of this Sales Order line is left to order.` }, 409);
    }
    const { data: last } = await sb.from('production_order_items').select('line_no').eq('production_order_id', b.targetPoId).order('line_no', { ascending: false }).limit(1);
    const start = Number(((last ?? [])[0] as { line_no?: number } | undefined)?.line_no ?? 0) + 1;
    const rows = picks.map((p) => {
      const it = toItem(p, soById.get(p.soItemId)!);
      return { production_order_id: b.targetPoId, company_id: co.companyId, material_kind: 'mfg_product', item_code: it.itemCode, material_name: it.materialName, description: it.description,
        qty: it.qty, unit_price_sen: it.unitPriceSen, line_total_sen: 0, variants: it.variants, item_group: it.itemGroup, delivery_date: it.deliveryDate, warehouse_id: it.warehouseId, so_item_id: it.soItemId };
    });
    const { error } = await sb.from('production_order_items').insert(stampPoLineNos(rows, start));
    if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
    await recomputePoTotals(sb, b.targetPoId);
    await recomputePoExpectedAt(sb, b.targetPoId);
    return c.json({ total: 1, created: [], appended: rows.length }, 201);
  }

  const bySo = new Map<string, Array<ReturnType<typeof toItem>>>();
  for (const p of picks) {
    const so = soById.get(p.soItemId)!;
    bySo.set(so.doc_no, [...(bySo.get(so.doc_no) ?? []), toItem(p, so)]);
  }
  const { data: wh } = await scopeToCompanyId(sb.from('warehouses').select('id').eq('code', 'ONSITE'), co.companyId).maybeSingle();
  const created: Array<{ id: string; poNumber: string; purchaseOrderId: string; purchaseOrderNumber: string; supplierId: string; lineCount: number }> = [];
  for (const [, items] of bySo) {
    const location = b.purchaseLocationId ?? items.find((i) => i.warehouseId)?.warehouseId ?? (wh as { id: string } | null)?.id;
    if (!location) return c.json({ error: 'purchase_location_id_required', message: 'These sales order lines have no warehouse.', created }, 409);
    const body = { supplierId: inhouseId, purchaseLocationId: location, expectedAt: items.map((i) => i.deliveryDate).filter(Boolean).sort()[0] ?? null, items };
    const out = await createMfgPurchaseOrderHandler({
      req: { json: async () => body }, get: (k: string) => c.get(k as 'supabase'), set: (k: string, v: unknown) => c.set(k as 'supabase', v as never), env: c.env,
      json: (j: unknown, status?: number) => ({ json: j, status: status ?? 200 }),
    }) as unknown as { json: { id?: string; poNumber?: string } & Record<string, unknown>; status: number };
    if (out.status >= 300 || !out.json.id) return c.json({ ...out.json, created }, out.status as 409);
    const { data: made, error: madeErr } = await scopeToCompanyId(sb.from('production_orders').select('id, po_number').eq('source_po_id', out.json.id), co.companyId).maybeSingle();
    if (madeErr || !made) return c.json({ error: 'order_not_made', message: `${String(out.json.poNumber)} was raised but no production order came of it.`, created }, 409);
    const order = made as { id: string; po_number: string };
    created.push({ id: order.id, poNumber: order.po_number, purchaseOrderId: out.json.id, purchaseOrderNumber: String(out.json.poNumber), supplierId: inhouseId, lineCount: items.length });
  }
  return c.json({ total: created.length, created }, 201);
});

productionOrders.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data: beforeRow } = await scopeToCompanyId(sb.from('production_orders').select(PO_AUDIT_SELECT).eq('id', id), co.companyId).maybeSingle();
  if (!beforeRow) return c.json(NOT_THIS_COMPANY, 404);
  const before = (beforeRow ?? {}) as unknown as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of PO_AUDIT_FIELDS) {
    if (body[from] !== undefined) updates[to] = body[from];
  }
  if (updates.production_time_days !== undefined) updates.production_time_days = productionTime(updates.production_time_days);
  if (updates.production_time_hours !== undefined) updates.production_time_hours = productionTime(updates.production_time_hours);
  const { data, error } = await scopeToCompanyId(sb.from('production_orders').update(coerceEmptyDates(updates)).eq('id', id), co.companyId).select('*').single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  const auditPatch: Record<string, unknown> = {};
  for (const [camel, snake] of PO_AUDIT_FIELDS) {
    if (updates[snake] !== undefined) auditPatch[camel] = updates[snake];
  }
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: id, entityDocNo: (before.po_number as string | null) ?? null, action: 'UPDATE', actor: c.get('houzsUser'),
    companyId: (before.company_id as number | null) ?? activeCompanyId(c), statusSnapshot: (before.status as string | null) ?? null,
    fieldChanges: diffFields(before, auditPatch, PO_AUDIT_FIELDS),
  });
  for (const [bodyKey, col] of [
    ['supplierDeliveryDate2', 'supplier_delivery_date_2'], ['supplierDeliveryDate3', 'supplier_delivery_date_3'], ['supplierDeliveryDate4', 'supplier_delivery_date_4'],
  ] as const) {
    const v = body[bodyKey];
    if (v === undefined || v === null || v === '') continue;
    await scopeToCompanyId(sb.from('production_order_items').update({ [col]: v }).eq('production_order_id', id), co.companyId).is(col, null);
  }
  return c.json({ purchaseOrder: data });
});

productionOrders.post('/bulk-supplier-date', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const parsed = parseBulkSupplierDateBody(body);
  if (!parsed.ok) return c.json(parsed.payload, parsed.status);
  const { slot, date, poIds, applyToLines } = parsed.req;
  const updated: Array<{ id: string; poNumber: string | null }> = [];
  const skipped: Array<{ id: string; poNumber: string | null; reason: string }> = [];
  for (const id of poIds) {
    const { data: beforeRow } = await scopeToCompanyId(sb.from('production_orders').select(PO_AUDIT_SELECT).eq('id', id), co.companyId).maybeSingle();
    if (!beforeRow) { skipped.push({ id, poNumber: null, reason: 'Not found in this company.' }); continue; }
    const before = beforeRow as unknown as Record<string, unknown>;
    const poNumber = (before.po_number as string | null) ?? null;
    const written = await cascadePoSupplierDate(sb, {
      companyId: co.companyId, poId: id, before, slot: slot as SupplierDateSlot, date, applyToLines, actor: c.get('houzsUser') ?? null, note: null,
    });
    if (!written.ok) { skipped.push({ id, poNumber, reason: written.reason }); continue; }
    updated.push({ id, poNumber });
  }
  return c.json({ slot, date, applyToLines, updated, skipped, slotColumn: SUPPLIER_DATE_SLOT_COL[slot as SupplierDateSlot] });
});

/* A finished or cancelled order's lines stay as they were (audit item 10): they are what its GR and DO were raised from. */
const linesClosed = (status: string): boolean => status === 'RECEIVED' || status === 'CANCELLED';
const LINES_CLOSED = { error: 'lines_closed', message: 'This production order is finished: its lines can no longer change.' };

productionOrders.post('/:id/items', async (c) => {
  const poId = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);
  if (!it.materialName) return c.json({ error: 'material_name_required' }, 400);
  const sb = c.get('supabase');
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data: parent } = await scopeToCompanyId(sb.from('production_orders').select('id, status').eq('id', poId), co.companyId).maybeSingle();
  if (!parent) return c.json(NOT_THIS_COMPANY, 404);
  if (linesClosed((parent as { status: string }).status)) return c.json(LINES_CLOSED, 409);
  const unknownAdd = await unknownProductCodeRefusal(sb, [{ code: it.itemCode, kind: it.materialKind }], co.companyId);
  if (unknownAdd) return c.json(unknownAdd, 409);
  const addGroupOf = await skuCategoryResolver(sb, [it], co.companyId ?? null);
  const parsedLine = parseLineNumbers({ qty: { value: it.qty, fallback: 1 }, unitPriceSen: { value: it.unitPriceSen }, discountSen: { value: it.discountSen } });
  if (!parsedLine.ok) return c.json(invalidLineNumberBody(parsedLine.invalid), 400);
  const { qty, unitPriceSen, discountSen } = parsedLine.nums as { qty: number; unitPriceSen: number; discountSen: number };
  const row: Record<string, unknown> = {
    production_order_id: poId, so_item_id: ((it.soItemId ?? it.so_item_id) as string | null | undefined) || null, binding_id: (it.bindingId as string) ?? null,
    material_kind: (it.materialKind as string) ?? 'mfg_product', item_code: it.itemCode, material_name: it.materialName, supplier_sku: (it.supplierSku as string) ?? null,
    qty, unit_price_sen: unitPriceSen, line_total_sen: Math.max(0, qty * unitPriceSen - discountSen), notes: (it.notes as string) ?? null,
    gap_inches: (it.gapInches as number) ?? null, divan_height_inches: (it.divanHeightInches as number) ?? null, divan_price_sen: Number(it.divanPriceSen ?? 0),
    leg_height_inches: (it.legHeightInches as number) ?? null, leg_price_sen: Number(it.legPriceSen ?? 0), custom_specials: (it.customSpecials as unknown) ?? null,
    line_suffix: (it.lineSuffix as string) ?? null, special_order_price_sen: Number(it.specialOrderPriceSen ?? 0), variants: (it.variants as unknown) ?? null,
    description: (it.description as string) ?? null, ...lineIdentityFields(addGroupOf, it, buildVariantSummary), uom: (it.uom as string) ?? 'UNIT', discount_sen: discountSen,
    unit_cost_sen: Number(it.unitCostSen ?? 0), delivery_date: dateOrNull(it.deliveryDate), supplier_delivery_date_2: dateOrNull(it.supplierDeliveryDate2),
    supplier_delivery_date_3: dateOrNull(it.supplierDeliveryDate3), supplier_delivery_date_4: dateOrNull(it.supplierDeliveryDate4), warehouse_id: (it.warehouseId as string) ?? null,
  };
  const { data: last } = await sb.from('production_order_items').select('line_no').eq('production_order_id', poId).order('line_no', { ascending: false }).limit(1);
  const lineNo = Number(((last ?? [])[0] as { line_no?: number } | undefined)?.line_no ?? 0) + 1;
  const { data, error } = await sb.from('production_order_items').insert({ ...row, line_no: lineNo, company_id: activeCompanyId(c) }).select('*').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  await recomputePoTotals(sb, poId);
  await recomputePoExpectedAt(sb, poId);
  const added = (data ?? {}) as unknown as Record<string, unknown>;
  const meta = await loadAuditMeta(sb, poId);
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: poId, entityDocNo: meta.docNo, action: 'UPDATE', actor: c.get('houzsUser'), companyId: meta.companyId ?? activeCompanyId(c),
    statusSnapshot: meta.status, note: `Line added: ${String(it.itemCode ?? '')}`,
    fieldChanges: compactChanges(PO_LINE_AUDIT_FIELDS.map(([camel, snake]) => fieldChange(camel, null, added[snake] ?? null))),
  });
  return c.json({ item: data }, 201);
});

productionOrders.patch('/:id/items/:itemId', async (c) => {
  const poId = c.req.param('id'); const itemId = c.req.param('itemId');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data: prevRow } = await scopeToCompanyId(sb.from('production_order_items').select(PO_LINE_AUDIT_SELECT + ', variants, so_item_id, material_kind, source_po_item_id, order:production_orders!inner (status)').eq('id', itemId).eq('production_order_id', poId), co.companyId).maybeSingle();
  if (!prevRow) return c.json(NOT_THIS_COMPANY, 404);
  const prev = prevRow as unknown as Record<string, unknown>;
  if (linesClosed((prev.order as { status: string }).status)) return c.json(LINES_CLOSED, 409);
  if (prev.source_po_item_id && it.itemCode !== undefined && String(it.itemCode ?? '') !== String(prev.item_code ?? '')) {
    return c.json({ error: 'follows_po', message: 'This line follows its PO: change the SKU there.' }, 409);
  }
  const parsedEdit = parseLineNumbers({
    qty: { value: it.qty !== undefined ? it.qty : prev.qty },
    unitPriceSen: { value: it.unitPriceSen !== undefined ? it.unitPriceSen : prev.unit_price_sen },
    discountSen: { value: it.discountSen !== undefined ? it.discountSen : prev.discount_sen },
  });
  if (!parsedEdit.ok) return c.json(invalidLineNumberBody(parsedEdit.invalid), 400);
  const { qty, unitPriceSen: unit, discountSen: discount } = parsedEdit.nums as { qty: number; unitPriceSen: number; discountSen: number };
  if (it.itemCode !== undefined && String(it.itemCode ?? '') !== String(prev.item_code ?? '')) {
    const unknownEdit = await unknownProductCodeRefusal(sb, [{ code: it.itemCode, kind: it.materialKind ?? prev.material_kind }], co.companyId);
    if (unknownEdit) return c.json(unknownEdit, 409);
  }
  const updates: Record<string, unknown> = { qty, unit_price_sen: unit, discount_sen: discount, line_total_sen: Math.max(0, qty * unit - discount) };
  for (const [from, to] of [
    ['itemCode', 'item_code'], ['materialName', 'material_name'], ['supplierSku', 'supplier_sku'], ['itemGroup', 'item_group'], ['description', 'description'],
    ['description2', 'description2'], ['uom', 'uom'], ['unitCostSen', 'unit_cost_sen'], ['notes', 'notes'], ['gapInches', 'gap_inches'],
    ['divanHeightInches', 'divan_height_inches'], ['divanPriceSen', 'divan_price_sen'], ['legHeightInches', 'leg_height_inches'], ['legPriceSen', 'leg_price_sen'],
    ['customSpecials', 'custom_specials'], ['lineSuffix', 'line_suffix'], ['specialOrderPriceSen', 'special_order_price_sen'], ['variants', 'variants'],
    ['deliveryDate', 'delivery_date'], ['warehouseId', 'warehouse_id'], ['supplierDeliveryDate2', 'supplier_delivery_date_2'],
    ['supplierDeliveryDate3', 'supplier_delivery_date_3'], ['supplierDeliveryDate4', 'supplier_delivery_date_4'],
  ] as const) {
    if (it[from] !== undefined) updates[to] = it[from];
  }
  if (description2InputsChanged(prev, it)) {
    const effGroup = (it.itemGroup ?? prev.item_group) as string | null | undefined;
    const effVariants = (it.variants ?? prev.variants) as Record<string, unknown> | null | undefined;
    updates['description2'] = buildVariantSummary(String(effGroup ?? ''), effVariants ?? null) || null;
  }
  if (it.soItemId !== undefined || it.so_item_id !== undefined) updates['so_item_id'] = ((it.soItemId ?? it.so_item_id) as string | null | undefined) || null;
  const { error } = await scopeToCompanyId(sb.from('production_order_items').update(coerceEmptyDates(updates)).eq('id', itemId), co.companyId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  const auditPatch: Record<string, unknown> = {};
  for (const [camel, snake] of PO_LINE_AUDIT_FIELDS) {
    if (updates[snake] !== undefined) auditPatch[camel] = updates[snake];
  }
  const lineChanges = diffFields(prev, auditPatch, PO_LINE_AUDIT_FIELDS);
  if (lineChanges.length > 0) {
    const meta = await loadAuditMeta(sb, poId);
    await recordEntityAudit(sb, {
      entityType: 'PRODUCTION_ORDER', entityId: poId, entityDocNo: meta.docNo, action: 'UPDATE', actor: c.get('houzsUser'), companyId: meta.companyId ?? activeCompanyId(c),
      statusSnapshot: meta.status, note: `Line edited: ${String(prev.item_code ?? itemId)}`, fieldChanges: lineChanges,
    });
  }
  await recomputePoTotals(sb, poId);
  await recomputePoExpectedAt(sb, poId);
  return c.json({ ok: true });
});

productionOrders.delete('/:id/items/:itemId', async (c) => {
  const poId = c.req.param('id'); const itemId = c.req.param('itemId');
  const sb = c.get('supabase');
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data: doomedRow } = await scopeToCompanyId(sb.from('production_order_items').select(PO_LINE_AUDIT_SELECT + ', source_po_item_id, order:production_orders!inner (status)').eq('id', itemId).eq('production_order_id', poId), co.companyId).maybeSingle();
  if (!doomedRow) return c.json(NOT_THIS_COMPANY, 404);
  const gone = doomedRow as unknown as Record<string, unknown>;
  if (linesClosed((gone.order as { status: string }).status)) return c.json(LINES_CLOSED, 409);
  if (gone.source_po_item_id) return c.json({ error: 'follows_po', message: 'This line follows its PO: remove it there.' }, 409);
  const { error } = await scopeToCompanyId(sb.from('production_order_items').delete().eq('id', itemId), co.companyId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  const meta = await loadAuditMeta(sb, poId);
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: poId, entityDocNo: meta.docNo, action: 'UPDATE', actor: c.get('houzsUser'), companyId: meta.companyId ?? activeCompanyId(c),
    statusSnapshot: meta.status, note: `Line removed: ${String(gone.item_code ?? itemId)}`,
    fieldChanges: compactChanges(PO_LINE_AUDIT_FIELDS.map(([camel, snake]) => fieldChange(camel, gone[snake] ?? null, null))),
  });
  await recomputePoTotals(sb, poId);
  await recomputePoExpectedAt(sb, poId);
  return c.body(null, 204);
});

export const proItemPhotoSignedHandler = async (c: any) => {
  const sb = c.get('supabase');
  const poId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));

  const { data: item } = await scopeToCompany(sb
    .from('production_order_items')
    .select('production_order_id, photo_urls')
    .eq('id', itemId), c)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { production_order_id: string; photo_urls: string[] | null };
  if (i.production_order_id !== poId) return c.json({ error: 'item_doc_mismatch' }, 400);
  if (!(i.photo_urls ?? []).includes(photoKey)) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  try {
    const bindings = soItemPhotoBindings(c.env);
    const { signedUrl, expiresAt } = await signSoItemPhotoUrl(bindings, photoKey);
    // Signed thumb sibling. A photo uploaded before thumbnails existed has no
    // `.thumb` object — the URL 404s and the client falls back to signedUrl.
    const { signedUrl: thumbUrl } = await signSoItemPhotoUrl(bindings, thumbKeyFor(photoKey));
    const payload: PhotoUrlPayload = { mode: 'signed', signedUrl, thumbUrl, expiresAt };
    return c.json(payload);
  } catch (e) {
    /* 2026-08-10: R2 S3 creds unset in prod => signing throws for every photo.
       Fall back to the proxy route below (R2 binding, no creds needed) rather
       than 500. See scm/lib/photoProxyFallback.ts for why this is not returned
       as `signedUrl`. */
    return c.json(
      proxyFallbackPayload(
        'pro-item-photo',
        `/production-orders/${poId}/items/${itemId}`,
        photoKey,
        e,
      ),
    );
  }
};

productionOrders.get('/:id/items/:itemId/photos/:photoKey/signed', proItemPhotoSignedHandler);

export const proItemPhotoProxyHandler = async (c: any) => {
  const sb = c.get('supabase');
  const poId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const photoKey = decodeURIComponent(c.req.param('photoKey'));

  if (!c.env.SO_ITEM_PHOTOS) {
    return c.json({ error: 'photo_bucket_not_configured' }, 500);
  }

  const { data: item } = await scopeToCompany(sb
    .from('production_order_items')
    .select('production_order_id, photo_urls')
    .eq('id', itemId), c)
    .maybeSingle();
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const i = item as { production_order_id: string; photo_urls: string[] | null };
  if (i.production_order_id !== poId) return c.json({ error: 'item_doc_mismatch' }, 400);
  if (!(i.photo_urls ?? []).includes(baseKeyOf(photoKey))) {
    return c.json({ error: 'photo_not_in_item' }, 404);
  }

  const obj = await c.env.SO_ITEM_PHOTOS.get(photoKey);
  if (!obj) return c.json({ error: 'photo_not_found_in_r2' }, 404);

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      // Keys are immutable per object (uuid / ac-<DtlKey>-<n>), so a replaced
      // photo is a different key. `private` — PO photos are not public.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
};

productionOrders.get('/:id/items/:itemId/photos/:photoKey', proItemPhotoProxyHandler);



const setStatus = async (c: any, from: string[], to: string, patch: Record<string, unknown>, note?: string) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data: cur, error: readErr } = await scopeToCompanyId(sb.from('production_orders').select('id, status, po_number, company_id, total_sen').eq('id', id), co.companyId).maybeSingle();
  if (readErr) return c.json({ error: 'load_failed', reason: readErr.message }, 500);
  if (!cur) return c.json(NOT_THIS_COMPANY, 404);
  const row = cur as { status: string; po_number: string; company_id: number; total_sen: number };
  if (row.status === to) return c.json({ purchaseOrder: { id, status: to } });
  if (!from.includes(row.status)) return c.json({ error: 'cannot_change', message: `This production order is ${row.status}.` }, 409);
  const { error } = await scopeToCompanyId(sb.from('production_orders').update({ status: to, updated_at: new Date().toISOString(), ...patch }).eq('id', id), co.companyId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: id, entityDocNo: row.po_number, action: to === 'CANCELLED' ? 'CANCEL' : 'UPDATE', actor: c.get('houzsUser'), companyId: row.company_id,
    statusSnapshot: to, note, fieldChanges: compactChanges([...statusChange(row.status, to), fieldChange('totalSen', null, Number(row.total_sen ?? 0))]),
  });
  return c.json({ purchaseOrder: { id, status: to } });
};

productionOrders.patch('/:id/confirm', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data } = await scopeToCompanyId(c.get('supabase').from('production_orders').select('purchase_location_id').eq('id', c.req.param('id')), co.companyId).maybeSingle();
  if (data && !(data as { purchase_location_id: string | null }).purchase_location_id) {
    return c.json({ error: 'warehouse_required', message: 'Set the Purchase Location before confirming.' }, 409);
  }
  return setStatus(c, ['DRAFT'], 'SUBMITTED', { submitted_at: new Date().toISOString() });
});

const START_CLEARED = { actual_start_at: null, actual_start_by: null, actual_start_by_name: null };

/* Puts a started order back to not started: its stock returns first, so a stop here leaves it started and repeatable. */
async function undoStart(c: any, sb: any, orderId: string): Promise<string | null> {
  const back = await reverseIssues(sb, orderId, c.get('user')?.id ?? null);
  if (!back.ok) return back.reason;
  const { error } = await sb.from('production_order_workers').delete().eq('production_order_id', orderId).eq('how', 'STARTED');
  return error ? error.message : null;
}

/* The reason is mandatory, as on a PO; it is kept on the order's history. An order partly through Complete cannot be
   cancelled (audit item 11): its GR or DO must be undone first. The issued stock comes back, and the in-house PO goes with
   the order, so nothing is left open behind it. */
productionOrders.patch('/:id/cancel', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 5) return c.json({ error: 'reason_required', message: 'Say why this production order is being cancelled.' }, 400);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data } = await scopeToCompanyId(sb.from('production_orders').select('status, source_po_id, actual_start_at, completion_grn_id, completion_do_id, completion_step').eq('id', c.req.param('id')), co.companyId).maybeSingle();
  const o = data as { status: string; source_po_id: string | null; actual_start_at: string | null; completion_grn_id: string | null; completion_do_id: string | null; completion_step: string | null } | null;
  if (o?.status === 'SUBMITTED' && (o.completion_step || o.completion_grn_id || o.completion_do_id)) {
    const live = await liveCompletionDocs(sb, o);
    if (live.length > 0 || o.completion_step) return c.json({ error: 'documents_live', message: live.length > 0 ? `Cancel ${live.join(' and ')} first, then cancel this production order.` : 'Complete has already run on this order. Finish it, then reopen it.' }, 409);
  }
  if (o?.actual_start_at && o.status !== 'RECEIVED') {
    const problem = await undoStart(c, sb, c.req.param('id'));
    if (problem) return c.json({ error: 'stock_failed', message: problem }, 409);
    await touchProjectTasks(sb, c.req.param('id'), 'reopen');
  }
  const res = await setStatus(c, ['DRAFT', 'SUBMITTED', 'ON_HOLD'], 'CANCELLED', { cancelled_at: new Date().toISOString(), start_lock_at: null, ...START_CLEARED }, reason);
  if (res.status >= 300 || !o?.source_po_id || o.status === 'CANCELLED') return res;
  const po = await callHandler(c, cancelPurchaseOrderHandler, { reason }, { id: o.source_po_id });
  if (po.status >= 300) return c.json({ purchaseOrder: { id: c.req.param('id'), status: 'CANCELLED' }, warning: `The production order is cancelled, but its PO stayed open: ${words(po.json, 'it could not be cancelled')}` });
  return res;
});

/* A completed order reopens only once its GR and DO are undone: they are real documents with stock behind them. Reopened,
   it is not started again: its stock is back and the next Start issues it afresh. */
productionOrders.patch('/:id/reopen', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data } = await scopeToCompanyId(sb.from('production_orders').select('status, source_po_id, completion_grn_id, completion_do_id').eq('id', c.req.param('id')), co.companyId).maybeSingle();
  const o = data as { status: string; source_po_id: string | null; completion_grn_id: string | null; completion_do_id: string | null } | null;
  if (o?.status === 'RECEIVED') {
    const live = await liveCompletionDocs(sb, o);
    if (live.length > 0) return c.json({ error: 'documents_live', message: `Cancel ${live.join(' and ')} first, then reopen this production order.` }, 409);
    const problem = await undoStart(c, sb, c.req.param('id'));
    if (problem) return c.json({ error: 'stock_failed', message: problem }, 409);
    await touchProjectTasks(sb, c.req.param('id'), 'reopen');
    return setStatus(c, ['RECEIVED'], 'SUBMITTED', { received_at: null, completion_grn_id: null, completion_do_id: null, completion_step: null, completion_error: null, ...START_CLEARED });
  }
  const res = await setStatus(c, ['CANCELLED'], 'SUBMITTED', { cancelled_at: null });
  if (res.status >= 300 || !o?.source_po_id || o.status !== 'CANCELLED') return res;
  const { data: po } = await sb.from('purchase_orders').select('status').eq('id', o.source_po_id).maybeSingle();
  if ((po as { status?: string } | null)?.status !== 'CANCELLED') return res;
  const back = await callHandler(c, reopenPurchaseOrderHandler, {}, { id: o.source_po_id });
  if (back.status >= 300) return c.json({ purchaseOrder: { id: c.req.param('id'), status: 'SUBMITTED' }, warning: `The production order is back, but its PO stayed cancelled: ${words(back.json, 'it could not be reopened')}` });
  return res;
});

async function liveCompletionDocs(sb: any, o: { completion_grn_id: string | null; completion_do_id: string | null }): Promise<string[]> {
  const [grn, dord] = await Promise.all([
    o.completion_grn_id ? sb.from('grns').select('grn_number, status').eq('id', o.completion_grn_id).maybeSingle() : { data: null },
    o.completion_do_id ? sb.from('delivery_orders').select('do_number, status').eq('id', o.completion_do_id).maybeSingle() : { data: null },
  ]);
  const out: string[] = [];
  if (grn.data && grn.data.status !== 'CANCELLED') out.push(grn.data.grn_number);
  if (dord.data && dord.data.status !== 'CANCELLED') out.push(dord.data.do_number);
  return out;
}

/* Production Order is the truth for Works and project tasks follow it (owner, 6 Nov 2026): Start stamps the task's actual
   start, Complete closes it, undoing Start opens it again. A task is linked by the PO line it was raised on. A failed
   update never stops the order: it is logged and the task can still be closed by hand. */
async function touchProjectTasks(sb: any, orderId: string, what: 'start' | 'done' | 'reopen'): Promise<void> {
  try {
    const { data: lines } = await sb.from('production_order_items').select('source_po_item_id').eq('production_order_id', orderId).not('source_po_item_id', 'is', null);
    const poItems = ((lines ?? []) as Array<{ source_po_item_id: string }>).map((l) => l.source_po_item_id);
    if (poItems.length === 0) return;
    const pub = sb.schema('public');
    const { data: links } = await pub.from('project_trade_task_lines').select('task_id').in('purchase_order_item_id', poItems);
    const ids = [...new Set(((links ?? []) as Array<{ task_id: number }>).map((l) => l.task_id))];
    if (ids.length === 0) return;
    const today = todayMyt();
    const now = new Date().toISOString();
    if (what === 'start') {
      await pub.from('project_trade_tasks').update({ actual_start: today, updated_at: now }).in('id', ids).is('actual_start', null);
    } else if (what === 'done') {
      await pub.from('project_trade_tasks').update({ actual_start: today, updated_at: now }).in('id', ids).is('actual_start', null);
      await pub.from('project_trade_tasks').update({ state: 'done', actual_end: today, done_at: now, updated_at: now }).in('id', ids).not('state', 'in', '(done,skipped)');
    } else {
      await pub.from('project_trade_tasks').update({ state: 'open', actual_start: null, actual_end: null, done_at: null, updated_at: now }).in('id', ids).eq('state', 'done');
    }
  } catch (e) {
    console.error('[production] project task update failed', orderId, what, e);
  }
}

/* ── Complete ──
   Owner, 4 Nov 2026: a completed order receives its PO and delivers its SO lines. Three requests, driven by the screen,
   each small enough for the Workers free plan and each safe to repeat: it looks at what already exists and does only
   what is left. The order turns Complete only when the last one lands, so a stop midway leaves it open with Retry.
   The GRN and DO come from the code those documents always use; the handlers run on this request's own session, so
   their own gates refuse here as they do on their own pages, and the two area gates a direct call skips are checked at
   the door. A stock move that failed stays a failure: Retry looks at the ledger, not at the document's status. */
export const callHandler = async (c: any, handler: (ctx: any) => Promise<Response>, body: unknown, param?: Record<string, string>) => {
  const req = new Proxy(c.req, { get(t, k) {
    if (k === 'json') return async () => body;
    if (k === 'param' && param) return (n: string) => param[n];
    const v = (t as any)[k];
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  const ctx = new Proxy(c, { get(t, k) {
    if (k === 'req') return req;
    const v = (t as any)[k];
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  const res = await handler(ctx);
  return { status: res.status, json: (await res.clone().json().catch(() => ({}))) as Record<string, unknown> };
};
const words = (j: Record<string, unknown>, fallback: string): string => String(j.message ?? j.reason ?? j.error ?? fallback);

type CompletionOrder = {
  id: string; po_number: string; status: string; on_hold: boolean; source_po_id: string | null; purchase_location_id: string | null;
  completion_grn_id: string | null; completion_do_id: string | null; completion_step: string | null; actual_start_at: string | null;
};

const movedStock = async (sb: any, doc: 'GRN' | 'DO', id: string, type: 'IN' | 'OUT'): Promise<boolean> => {
  const { count } = await sb.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('source_doc_type', doc).eq('source_doc_id', id).eq('movement_type', type);
  return (count ?? 0) > 0;
};

async function completeGrnStep(c: any, sb: any, companyId: number, o: CompletionOrder): Promise<string | null> {
  /* Anything listed after Start (a line added, a composition change) leaves stock here, so nothing finishes unissued. */
  const issued = await issueMaterials(sb, { orderId: o.id, poNumber: o.po_number, companyId, performedBy: c.get('user')?.id ?? null });
  if (!issued.ok) return issued.reason;
  if (o.completion_grn_id) {
    const { data: grn } = await sb.from('grns').select('status').eq('id', o.completion_grn_id).maybeSingle();
    const status = (grn as { status?: string } | null)?.status;
    if (status && status !== 'CANCELLED') {
      /* Posted with no stock behind it is an earlier failed move: posting again books only what is missing. */
      if (status === 'POSTED' && await movedStock(sb, 'GRN', o.completion_grn_id, 'IN')) return null;
      const posted = await postGrnAndRollup(sb, o.completion_grn_id, c.get('user').id, companyId);
      if (!posted.ok) return `The goods receipt was raised but not posted: ${posted.reason}`;
      return posted.movementErrors?.length ? `The goods receipt posted but its stock did not move: ${posted.movementErrors.join('; ')}` : null;
    }
  }
  if (!o.source_po_id) return null;
  const { data: lines, error } = await sb.from('purchase_order_items').select('id, qty, received_qty').eq('purchase_order_id', o.source_po_id);
  if (error) return error.message;
  const picks = ((lines ?? []) as Array<{ id: string; qty: number; received_qty: number | null }>)
    .map((l) => ({ poItemId: l.id, qty: Number(l.qty) - Number(l.received_qty ?? 0) })).filter((p) => p.qty > 0);
  if (picks.length === 0) {
    /* Already received by hand, nothing to double. The receipt is still this order's, so its photos reach that GR. */
    const { data: line } = await sb.from('grn_items').select('grn_id, grn:grns!inner (status), poi:purchase_order_items!inner (purchase_order_id)')
      .eq('poi.purchase_order_id', o.source_po_id).eq('grn.status', 'POSTED').limit(1).maybeSingle();
    const grnId = (line as { grn_id?: string } | null)?.grn_id;
    if (grnId) await sb.from('production_orders').update({ completion_grn_id: grnId }).eq('id', o.id);
    return null;
  }
  const core = await createDraftGrnsFromPoItemsCore({
    req: { json: async () => ({ picks, notes: `Completed from production order ${o.po_number}` }) },
    get: ((key: string) => c.get(key as 'supabase')) as unknown as GrnFromPoItemsContext['get'],
  }, { fromProductionOrder: true });
  if (!core.ok) return words(core.body, 'The goods receipt could not be raised.');
  const draft = core.created[0];
  if (!draft) return 'The goods receipt could not be raised.';
  await sb.from('production_orders').update({ completion_grn_id: draft.id }).eq('id', o.id);
  /* The team's own works carry no purchase cost until labour is costed, and the receipt says so. */
  await sb.from('grn_items').update({ zero_cost_ack: true, zero_cost_reason: `In-house works, ${o.po_number}`, zero_cost_ack_by: c.get('user').id, zero_cost_ack_at: new Date().toISOString() })
    .eq('grn_id', draft.id).eq('unit_price_sen', 0);
  const posted = await postGrnAndRollup(sb, draft.id, c.get('user').id, draft.companyId);
  if (!posted.ok) return `The goods receipt was raised but not posted: ${posted.reason}`;
  await recordGrnCreate(sb, c.get('houzsUser'), companyId, draft.id, draft.lineCount, `Received from ${draft.poNumbers.join(', ')} on completing ${o.po_number}`);
  if (posted.movementErrors?.length) return `The goods receipt posted but its stock did not move: ${posted.movementErrors.join('; ')}`;
  return null;
}

async function completeDoStep(c: any, sb: any, o: CompletionOrder): Promise<string | null> {
  if (o.completion_do_id) {
    const { data: dord } = await sb.from('delivery_orders').select('status').eq('id', o.completion_do_id).maybeSingle();
    const status = (dord as { status?: string } | null)?.status;
    if (status && status !== 'CANCELLED') {
      if (status === 'DRAFT' || await movedStock(sb, 'DO', o.completion_do_id, 'OUT')) return null;
      const failed = await deductInventoryForDo(sb, o.completion_do_id, c.get('user').id);
      return failed.length > 0 ? `The delivery order was raised but its stock did not move: ${failed.join('; ')}` : null;
    }
  }
  const { data: lines, error } = await sb.from('production_order_items').select('so_item_id, qty').eq('production_order_id', o.id).not('so_item_id', 'is', null);
  if (error) return error.message;
  const wanted = (lines ?? []) as Array<{ so_item_id: string; qty: number }>;
  if (wanted.length === 0) return null;   // no SO behind it: nothing to deliver
  const { data: soLines } = await sb.from('mfg_sales_order_items').select('id, doc_no').in('id', wanted.map((l) => l.so_item_id));
  const docNos = [...new Set(((soLines ?? []) as Array<{ doc_no: string }>).map((l) => l.doc_no))];
  const remaining = await soDeliverableRemaining(sb, docNos);
  const picks = wanted.flatMap((l) => {
    const left = Number(remaining.get(l.so_item_id)?.remaining ?? 0);
    const qty = Math.min(left, Number(l.qty));
    return qty > 0 ? [{ soItemId: l.so_item_id, qty }] : [];   // already delivered: skipped, not doubled
  });
  if (picks.length === 0) return null;
  const out = await callHandler(c, createDoFromSoLinesHandler, { picks, confirmShortStock: true, warehouseId: o.purchase_location_id ?? undefined });
  if (out.status >= 300 || !out.json.id) return words(out.json, 'The delivery order could not be raised.');
  await sb.from('production_orders').update({ completion_do_id: out.json.id }).eq('id', o.id);
  const moved = out.json.movementErrors as string[] | undefined;
  return moved?.length ? `The delivery order was raised but its stock did not move: ${moved.join('; ')}` : null;
}

async function completeDeliverStep(c: any, sb: any, o: CompletionOrder): Promise<string | null> {
  if (o.completion_do_id) {
    const { data: dord } = await sb.from('delivery_orders').select('status').eq('id', o.completion_do_id).maybeSingle();
    if ((dord as { status?: string } | null)?.status !== 'DELIVERED') {
      const out = await callHandler(c, patchDeliveryOrderStatusHandler, { status: 'DELIVERED' }, { id: o.completion_do_id });
      if (out.status >= 300) return words(out.json, 'The delivery order could not be marked delivered.');
    }
  }
  const now = new Date().toISOString();
  const { error } = await sb.from('production_orders').update({ status: 'RECEIVED', received_at: now, updated_at: now }).eq('id', o.id).eq('status', 'SUBMITTED');
  if (error) return error.message;
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: o.id, entityDocNo: o.po_number, action: 'UPDATE', actor: c.get('houzsUser'), companyId: activeCompanyId(c),
    statusSnapshot: 'RECEIVED', note: 'Completed', fieldChanges: compactChanges(statusChange('SUBMITTED', 'RECEIVED')),
  });
  await touchProjectTasks(sb, o.id, 'done');
  return null;
}

productionOrders.post('/:id/complete', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await c.req.json().catch(() => ({}))) as { step?: string };
  const step = b.step;
  if (step !== 'grn' && step !== 'do' && step !== 'deliver') return c.json({ error: 'validation', message: 'Unknown step.' }, 400);
  const actor = c.get('houzsUser');
  if (!scmAreaAllows(actor, 'scm.procurement.grn', 'edit') || !scmAreaAllows(actor, 'scm.sales.delivery', 'edit')) {
    return c.json({ error: 'forbidden', message: 'Completing raises a goods receipt and a delivery order: you need edit access to both.' }, 403);
  }
  const cols = 'id, po_number, status, on_hold, source_po_id, purchase_location_id, completion_grn_id, completion_do_id, completion_step, actual_start_at';
  const { data } = await scopeToCompanyId(sb.from('production_orders').select(cols).eq('id', c.req.param('id')), co.companyId).maybeSingle();
  const o = data as CompletionOrder | null;
  if (!o) return c.json(NOT_THIS_COMPANY, 404);
  if (o.status === 'RECEIVED') return c.json({ ok: true, done: true });
  if (o.status !== 'SUBMITTED') return c.json({ error: 'validation', message: `Only an order in production can be completed (this one is ${o.status.toLowerCase()}).` }, 409);
  if (o.on_hold) return c.json({ error: 'validation', message: 'This production order is on hold. Take it off hold first.' }, 409);
  if (!o.actual_start_at && !o.completion_step) return c.json({ error: 'not_started', message: 'Press Start first: that is when its stock leaves.' }, 409);
  /* One step at a time: a second press, or a retry while the first still runs, finds the lock and stops. */
  const stale = new Date(Date.now() - 120_000).toISOString();
  const { data: locked } = await scopeToCompanyId(sb.from('production_orders').update({ completion_lock_at: new Date().toISOString() }).eq('id', o.id), co.companyId)
    .or(`completion_lock_at.is.null,completion_lock_at.lt.${stale}`).select('id');
  if (!(locked ?? []).length) return c.json({ error: 'already_running', message: 'This step is already running. Wait a moment, then look again.' }, 409);
  let problem: string | null;
  try {
    problem = step === 'grn' ? await completeGrnStep(c, sb, co.companyId, o)
      : step === 'do' ? await completeDoStep(c, sb, o)
        : await completeDeliverStep(c, sb, o);
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  await sb.from('production_orders').update({
    completion_lock_at: null, completion_error: problem,
    ...(problem ? {} : { completion_step: step === 'deliver' ? 'done' : step }),
  }).eq('id', o.id);
  if (problem) return c.json({ error: 'step_failed', step, message: problem }, 409);
  return c.json({ ok: true, step });
});


/* ── Start, and what follows it (owner, 6 Nov 2026) ──
   Start does not wait for every material: stock leaves now and may go negative until goods arrive, and the screen gives
   one short reminder before calling this. Whole units, rounded up. The press is claimed first, so a double tap issues
   once; a press after Start only says it has started. A stock write that fails stops the Start and says so. */
const actorName = (c: any): string => {
  const u = c.get('houzsUser') as { name?: string; full_name?: string; email?: string } | undefined;
  return u?.name ?? u?.full_name ?? u?.email ?? 'Unknown';
};

productionOrders.post('/:id/start', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const order = await loadOrderHead(sb, co.companyId, id);
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  if (order.actual_start_at) return c.json({ ok: true, alreadyStarted: true, startedAt: order.actual_start_at });
  if (order.status !== 'SUBMITTED') return c.json({ error: 'validation', message: `Only a confirmed order can start (this one is ${order.status.toLowerCase()}).` }, 409);
  if (order.on_hold) return c.json({ error: 'validation', message: 'This production order is on hold. Take it off hold first.' }, 409);
  const stale = new Date(Date.now() - 120_000).toISOString();
  const { data: locked, error: lockErr } = await scopeToCompanyId(sb.from('production_orders').update({ start_lock_at: new Date().toISOString() }).eq('id', id), co.companyId)
    .is('actual_start_at', null).or(`start_lock_at.is.null,start_lock_at.lt.${stale}`).select('id');
  if (lockErr) return c.json({ error: 'update_failed', reason: lockErr.message }, 500);
  if (!(locked ?? []).length) return c.json({ error: 'already_running', message: 'Start is already running. Wait a moment, then look again.' }, 409);
  const staffId = c.get('user')?.id ?? null;
  const issued = await issueMaterials(sb, { orderId: id, poNumber: order.po_number, companyId: co.companyId, performedBy: staffId }).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
  if (!issued.ok) {
    await sb.from('production_orders').update({ start_lock_at: null }).eq('id', id);
    return c.json({ error: 'stock_failed', message: issued.reason }, 409);
  }
  const name = actorName(c);
  const now = new Date().toISOString();
  const { error: startErr } = await sb.from('production_orders').update({ actual_start_at: now, actual_start_by: staffId, actual_start_by_name: name, start_lock_at: null, updated_at: now }).eq('id', id);
  if (startErr) return c.json({ error: 'update_failed', reason: startErr.message }, 500);
  const { data: named } = await sb.from('production_order_workers').select('name').eq('production_order_id', id);
  if (!((named ?? []) as Array<{ name: string }>).some((w) => w.name.toLowerCase() === name.toLowerCase())) {
    await sb.from('production_order_workers').insert({ production_order_id: id, company_id: co.companyId, person_key: `user:${String(c.get('houzsUser')?.id ?? name)}`, name, how: 'STARTED', created_by: staffId });
  }
  await touchProjectTasks(sb, id, 'start');
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: id, entityDocNo: order.po_number, action: 'UPDATE', actor: c.get('houzsUser'), companyId: co.companyId, statusSnapshot: order.status,
    note: `Started by ${name}`, fieldChanges: compactChanges([fieldChange('actualStartAt', null, now)]),
  });
  return c.json({ ok: true, startedAt: now, issuedLines: issued.issuedLines, shortLines: issued.shortLines });
});

/* Extra material after Start: it lands on the order's raw materials and leaves stock as Start's did, so a request with no
   stock behind it reads Short and MRP buys it. */
productionOrders.post('/:id/request-more', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrderHead(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  if (!order.actual_start_at || order.status !== 'SUBMITTED') return c.json({ error: 'validation', message: 'Request more is for an order in progress.' }, 409);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = String(b.itemCode ?? '').trim();
  const qty = positiveQty(b.qty);
  if (!code || qty == null) return c.json({ error: 'validation', message: 'Choose a raw material and give a quantity above zero.' }, 422);
  const sku = await rawSkuOf(sb, co.companyId, code);
  if (!sku || String(sku.category) !== RAW_CATEGORY) return c.json({ error: 'validation', message: `${code} is not a Raw material SKU.` }, 422);
  const auto = materialDates(order.expected_at, klToday());
  const { data, error } = await sb.from('production_order_materials').insert({
    production_order_id: order.id, company_id: co.companyId, item_code: code, description: sku.name, uom: sku.uom, qty_needed: wholeNeed(qty), processing_date: auto.processingDate,
    delivery_date: dateOrNull(b.neededBy) ?? auto.deliveryDate, added_how: 'REQUESTED', requested_at: new Date().toISOString(), requested_by_name: actorName(c), updated_by: c.get('houzsUser')?.id ?? null,
  }).select('id').single();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  const materialId = (data as { id: string }).id;
  const issued = await issueMaterials(sb, { orderId: order.id, poNumber: order.po_number, companyId: co.companyId, performedBy: c.get('user')?.id ?? null, only: [materialId] });
  if (!issued.ok) {
    await sb.from('production_order_materials').delete().eq('id', materialId);
    return c.json({ error: 'stock_failed', message: issued.reason }, 409);
  }
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: order.id, entityDocNo: order.po_number, action: 'UPDATE', actor: c.get('houzsUser'), companyId: co.companyId, statusSnapshot: order.status,
    note: `Requested more: ${wholeNeed(qty)} ${code}`, fieldChanges: [],
  });
  return c.json({ ok: true, id: materialId, short: issued.shortLines > 0 }, 201);
});

/* Used less than listed: back into the warehouse picked. Every line is checked before the first one moves. */
productionOrders.post('/:id/return-stock', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrderHead(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  if (!order.actual_start_at || (order.status !== 'SUBMITTED' && order.status !== 'RECEIVED')) return c.json({ error: 'validation', message: 'Return stock is for an order that has started.' }, 409);
  const b = (await c.req.json().catch(() => ({}))) as { lines?: Array<Partial<ReturnLine>> };
  const lines = (b.lines ?? []).map((l) => ({ materialId: String(l.materialId ?? ''), qty: Number(l.qty), warehouseId: String(l.warehouseId ?? '') })).filter((l) => l.qty !== 0);
  if (lines.length === 0) return c.json({ error: 'validation', message: 'Give a quantity to return.' }, 422);
  const { data: mats, error } = await scopeToCompanyId(sb.from('production_order_materials').select('id, item_code, description, qty_needed, qty_issued, qty_returned, qty_issued_short').eq('production_order_id', order.id), co.companyId);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  type Mat = { id: string; item_code: string; description: string | null; qty_needed: number; qty_issued: number; qty_returned: number; qty_issued_short: number };
  const byId = new Map(((mats ?? []) as Mat[]).map((m) => [m.id, m]));
  const refusal = checkReturn(lines, byId);
  if (refusal) return c.json({ error: 'validation', message: refusal }, 422);
  const { data: wh } = await sb.from('warehouses').select('id').eq('company_id', co.companyId).in('id', [...new Set(lines.map((l) => l.warehouseId))]);
  if (((wh ?? []) as unknown[]).length !== new Set(lines.map((l) => l.warehouseId)).size) return c.json({ error: 'validation', message: 'Pick a warehouse of this company.' }, 422);
  let moved = 0;
  for (const l of lines) {
    const m = byId.get(l.materialId)!;
    const problem = await returnMaterial(sb, { m, qty: l.qty, warehouseId: l.warehouseId, poNumber: order.po_number, companyId: co.companyId, performedBy: c.get('user')?.id ?? null });
    if (problem) return c.json({ error: 'stock_failed', message: moved > 0 ? `${moved} line(s) went back. ${problem}` : problem, moved }, 409);
    m.qty_returned += l.qty;
    moved += 1;
  }
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: order.id, entityDocNo: order.po_number, action: 'UPDATE', actor: c.get('houzsUser'), companyId: co.companyId, statusSnapshot: order.status,
    note: `Returned stock: ${lines.map((l) => `${l.qty} ${byId.get(l.materialId)!.item_code}`).join(', ')}`, fieldChanges: [],
  });
  return c.json({ ok: true, moved });
});

/* Assign (owner, 6 Nov 2026): the picked people replace the assigned ones. Whoever pressed Start stays. */
productionOrders.put('/:id/workers', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrderHead(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  if (linesClosed(order.status)) return c.json({ error: 'validation', message: 'This production order is finished.' }, 409);
  const b = (await c.req.json().catch(() => ({}))) as { workerIds?: unknown };
  const ids = [...new Set(Array.isArray(b.workerIds) ? b.workerIds.map(String) : [])];
  const { data: roster, error } = await sb.from('production_workers').select('id, name, trade');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const known = new Map(((roster ?? []) as Array<{ id: string; name: string; trade: string | null }>).map((w) => [w.id, w]));
  if (ids.some((x) => !known.has(x))) return c.json({ error: 'validation', message: 'Pick people from the list.' }, 422);
  const { error: delErr } = await sb.from('production_order_workers').delete().eq('production_order_id', order.id).eq('how', 'ASSIGNED');
  if (delErr) return c.json({ error: 'save_failed', reason: delErr.message }, 500);
  if (ids.length > 0) {
    const { error: insErr } = await sb.from('production_order_workers').upsert(ids.map((x) => ({
      production_order_id: order.id, company_id: co.companyId, person_key: x, name: known.get(x)!.name, trade: known.get(x)!.trade, how: 'ASSIGNED', created_by: c.get('user')?.id ?? null,
    })), { onConflict: 'production_order_id,person_key', ignoreDuplicates: true });
    if (insErr) return c.json({ error: 'save_failed', reason: insErr.message }, 500);
  }
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: order.id, entityDocNo: order.po_number, action: 'UPDATE', actor: c.get('houzsUser'), companyId: co.companyId, statusSnapshot: order.status,
    note: `Assigned: ${ids.map((x) => known.get(x)!.name).join(', ') || 'nobody'}`, fieldChanges: [],
  });
  return c.json({ ok: true });
});

/* Production Time is management's budget in hours. Days and hours are never converted. */
productionOrders.patch('/:id/production-time', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await c.req.json().catch(() => ({}))) as { hours?: unknown };
  const hours = validHours(b.hours);
  if (hours === 'bad') return c.json({ error: 'validation', message: 'Give the hours as a number.' }, 422);
  const { data: before } = await scopeToCompanyId(sb.from('production_orders').select('id, po_number, status, production_time_hours').eq('id', c.req.param('id')), co.companyId).maybeSingle();
  const row = before as { id: string; po_number: string; status: string; production_time_hours: number | null } | null;
  if (!row) return c.json(NOT_THIS_COMPANY, 404);
  const { error } = await scopeToCompanyId(sb.from('production_orders').update({ production_time_hours: hours, updated_at: new Date().toISOString() }).eq('id', row.id), co.companyId);
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: row.id, entityDocNo: row.po_number, action: 'UPDATE', actor: c.get('houzsUser'), companyId: co.companyId, statusSnapshot: row.status,
    fieldChanges: compactChanges([fieldChange('productionTimeHours', row.production_time_hours, hours)]),
  });
  return c.json({ ok: true, hours });
});

productionOrders.patch('/:id/hold', makeHoldHandler({ table: 'production_orders', keyColumn: 'id', param: 'id', responseKey: 'purchaseOrder', echoColumns: 'po_number, status' }));
