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
import { PO_HEADER_COLS, PO_LIST_SELECT, poListSelect, filterPoList, orderPoList, readPoListFilters } from '../lib/po-list-read';
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
import { VALID_STATUSES, parseBulkSupplierDateBody } from './mfg-purchase-orders';

export const productionOrders = new Hono<{ Bindings: Env; Variables: Variables }>();
productionOrders.use('*', supabaseAuth);

const toProduction = (select: string): string => select.replace('items:purchase_order_items', 'items:production_order_items');
const PRODUCTION_LIST_SELECT = toProduction(PO_LIST_SELECT);
export const productionListSelect = (f: Parameters<typeof poListSelect>[0]): string => toProduction(poListSelect(f));

const PO_AUDIT_FIELDS: Array<[string, string]> = [
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
  let statusCounts: { all: number; draft: number; outstanding: number; open: number; partial: number; received: number; cancelled: number } | undefined;
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
    const q = filterPoList(
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
    ]));
    const res = await q;
    data = res.data;
    error = res.error;
    total = res.count ?? (res.data?.length ?? 0);
    const [allC, draftC, outstandingC, openC, partialC, receivedC, cancelledC, onHoldC] = (await countsProm)();
    // A count that could not be READ is reported, never served as 0; an empty bucket still answers 0 (lib/status-counts.ts).
    const counted = readStatusCounts({ all: allC, draft: draftC, outstanding: outstandingC, open: openC, partial: partialC, received: receivedC, cancelled: cancelledC, on_hold: onHoldC });
    if (counted.ok) statusCounts = counted.counts; else countError = counted.reason;
  }
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (countError) return c.json({ error: 'status_counts_failed', reason: countError }, 500);

  /* Nothing is received against a production order: no downstream lock, no GRN column. */
  const stamped = { rows: ((data ?? []) as Array<{ id: string } & Record<string, unknown>>).map((r) => ({ ...r, has_children: false, transfer_to_grns: [] })) };
  if (paginate) {
    /* The page's lines, for the grid's line columns (Item Code, Qty, Delivery
       Date, ...) — the same read the export uses (lib/po-line-export.ts), so the
       screen and the file agree cell for cell. The legacy unpaged path does not
       carry them: its callers never render a line column. */
    const withLines = await attachPoLines(supabase, c, stamped.rows);
    if (withLines.error) return c.json({ error: 'lines_read_failed', reason: withLines.error }, 500);
    return c.json({ purchaseOrders: withLines.rows, total, page, pageSize, statusCounts });
  }
  const purchaseOrders = stamped.rows;
  return c.json({ purchaseOrders });
});



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

productionOrders.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const [headerRes, itemsRes] = await Promise.all([
    scopeToCompany(supabase.from('production_orders')
      .select(`${PO_HEADER_COLS}, source_po_id, supplier:suppliers(id, code, name, contact_person, phone, email, address)`)
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
  return c.json({ purchaseOrder, items });
});

productionOrders.get('/:id/revisions', (c) => c.json({ revisions: [] }));

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
    notes: (body.notes as string | undefined) ?? null, subtotal_sen: subtotal, tax_sen: 0, total_sen: subtotal, created_by: user.id, purchase_location_id: purchaseLocationId,
  };
  if (body.poDate) headerInsert.po_date = body.poDate;
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

/* From the sales order, as the PO's From-SO screen does: the SO lines are read for what they say and nothing is written
   back to them, so a production order takes no quota from a sales order line. */
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
  type SoLine = { id: string; doc_no: string; item_code: string; description: string | null; item_group: string | null; variants: unknown; warehouse_id: string | null; line_delivery_date: string | null };
  const { data: soRows, error: soErr } = await scopeToCompanyId(sb.from('mfg_sales_order_items')
    .select('id, doc_no, item_code, description, item_group, variants, warehouse_id, line_delivery_date').in('id', picks.map((p) => p.soItemId)), co.companyId);
  if (soErr) return c.json({ error: 'load_failed', reason: soErr.message }, 500);
  const soById = new Map(((soRows ?? []) as unknown as SoLine[]).map((r) => [r.id, r]));
  const { data: binds, error: bindErr } = await readMfgProductBindings<{ item_code: string; supplier_id: string; unit_price_sen: number }>(sb, {
    codes: [...soById.values()].map((r) => r.item_code), companyId: co.companyId, select: 'item_code, supplier_id, unit_price_sen',
  });
  if (bindErr) return c.json({ error: 'load_failed', reason: bindErr.message }, 500);
  const toItem = (p: { soItemId: string; qty: number }, so: SoLine, supplierId: string | null) => ({
    materialKind: 'mfg_product', itemCode: so.item_code, materialName: so.description ?? so.item_code, description: so.description, qty: Math.floor(Number(p.qty)),
    unitPriceSen: Number(binds.find((x) => x.item_code === so.item_code && x.supplier_id === supplierId)?.unit_price_sen ?? 0), variants: so.variants,
    itemGroup: so.item_group, deliveryDate: b.expectedAt ?? so.line_delivery_date, warehouseId: b.purchaseLocationId ?? so.warehouse_id, soItemId: so.id,
  });

  if (b.targetPoId) {
    const { data: target } = await scopeToCompanyId(sb.from('production_orders').select('id, supplier_id').eq('id', b.targetPoId), co.companyId).maybeSingle();
    if (!target) return c.json(NOT_THIS_COMPANY, 404);
    const supplierId = (target as { supplier_id: string }).supplier_id;
    const { data: last } = await sb.from('production_order_items').select('line_no').eq('production_order_id', b.targetPoId).order('line_no', { ascending: false }).limit(1);
    const start = Number(((last ?? [])[0] as { line_no?: number } | undefined)?.line_no ?? 0) + 1;
    const rows = picks.flatMap((p) => {
      const so = soById.get(p.soItemId);
      if (!so) return [];
      const it = toItem(p, so, supplierId);
      return [{ production_order_id: b.targetPoId, company_id: co.companyId, material_kind: 'mfg_product', item_code: it.itemCode, material_name: it.materialName, description: it.description,
        qty: it.qty, unit_price_sen: it.unitPriceSen, line_total_sen: it.qty * it.unitPriceSen, variants: it.variants, item_group: it.itemGroup, delivery_date: it.deliveryDate, warehouse_id: it.warehouseId, so_item_id: it.soItemId }];
    });
    const { error } = await sb.from('production_order_items').insert(stampPoLineNos(rows, start));
    if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
    await recomputePoTotals(sb, b.targetPoId);
    await recomputePoExpectedAt(sb, b.targetPoId);
    return c.json({ total: 1, created: [], appended: rows.length }, 201);
  }

  const bySupplier = new Map<string, Array<ReturnType<typeof toItem>>>();
  const missing: string[] = [];
  for (const p of picks) {
    const so = soById.get(p.soItemId);
    if (!so) continue;
    const supplierId = p.supplierId ?? b.supplierByCode?.[so.item_code] ?? binds.find((x) => x.item_code === so.item_code)?.supplier_id ?? null;
    if (!supplierId) { missing.push(so.item_code); continue; }
    bySupplier.set(supplierId, [...(bySupplier.get(supplierId) ?? []), toItem(p, so, supplierId)]);
  }
  if (missing.length > 0) return c.json({ error: 'missing_bindings', itemCodes: [...new Set(missing)] }, 400);
  const created: Array<{ id: string; poNumber: string }> = [];
  for (const [supplierId, items] of bySupplier) {
    const location = b.purchaseLocationId ?? items.find((i) => i.warehouseId)?.warehouseId;
    if (!location) return c.json({ error: 'purchase_location_id_required', message: 'These sales order lines have no warehouse.', created }, 409);
    const body = { supplierId, purchaseLocationId: location, expectedAt: items.map((i) => i.deliveryDate).filter(Boolean).sort()[0] ?? null, items };
    const out = await createProductionOrder({
      req: { json: async () => body }, get: (k: string) => c.get(k as 'supabase'), set: (k: string, v: unknown) => c.set(k as 'supabase', v as never), env: c.env,
      json: (j: unknown, status?: number) => ({ json: j, status: status ?? 200 }),
    }) as unknown as { json: { id?: string; poNumber?: string } & Record<string, unknown>; status: number };
    if (out.status >= 300 || !out.json.id) return c.json({ ...out.json, created }, out.status as 409);
    created.push({ id: out.json.id, poNumber: String(out.json.poNumber) });
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

productionOrders.post('/:id/items', async (c) => {
  const poId = c.req.param('id');
  let it: Record<string, unknown>;
  try { it = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!it.itemCode) return c.json({ error: 'item_code_required' }, 400);
  if (!it.materialName) return c.json({ error: 'material_name_required' }, 400);
  const sb = c.get('supabase');
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data: parent } = await scopeToCompanyId(sb.from('production_orders').select('id').eq('id', poId), co.companyId).maybeSingle();
  if (!parent) return c.json(NOT_THIS_COMPANY, 404);
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
  const { data: prevRow } = await scopeToCompanyId(sb.from('production_order_items').select(PO_LINE_AUDIT_SELECT + ', variants, so_item_id, material_kind').eq('id', itemId), co.companyId).maybeSingle();
  if (!prevRow) return c.json(NOT_THIS_COMPANY, 404);
  const prev = prevRow as unknown as Record<string, unknown>;
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
  const { data: doomedRow } = await scopeToCompanyId(sb.from('production_order_items').select(PO_LINE_AUDIT_SELECT).eq('id', itemId), co.companyId).maybeSingle();
  if (!doomedRow) return c.json(NOT_THIS_COMPANY, 404);
  const gone = doomedRow as unknown as Record<string, unknown>;
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

/* The reason is mandatory, as on a PO; it is kept on the order's history. */
productionOrders.patch('/:id/cancel', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 5) return c.json({ error: 'reason_required', message: 'Say why this production order is being cancelled.' }, 400);
  return setStatus(c, ['DRAFT', 'SUBMITTED', 'ON_HOLD'], 'CANCELLED', { cancelled_at: new Date().toISOString() }, reason);
});

productionOrders.patch('/:id/reopen', (c) => setStatus(c, ['CANCELLED'], 'SUBMITTED', { cancelled_at: null }));

productionOrders.patch('/:id/hold', makeHoldHandler({ table: 'production_orders', keyColumn: 'id', param: 'id', responseKey: 'purchaseOrder', echoColumns: 'po_number, status' }));
