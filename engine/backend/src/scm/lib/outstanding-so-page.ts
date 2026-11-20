// ----------------------------------------------------------------------------
// ONE PAGE of the PO-from-SO picker (owner, 19 Nov 2026: "show what I search first, or by scrolling; no need to load
// everything at once").
//
// `GET /mfg-purchase-orders/outstanding-so-items` without `limit` still answers the whole list
// (lib/outstanding-so-lines.ts) for the mobile convert wizard and the PO detail page. With `limit` it answers one page.
//
// HOW A PAGE IS CHOSEN (20 Nov 2026). The column funnels (Project, Customer, Supplier, ...) only ever saw the loaded
// page, so a project past the first pages could not be picked from its funnel. The server now reads ONE LIGHT LIST of
// every open SO line in scope (no stock check: that is what made the whole list take 8 to 24 s) and a pure function
// (`buildPickerPage`) takes it with the search, the top-bar filters, the column funnels and the sort, and returns the
// funnel counts, the total and the page's ids. Funnels, total and pages come from the same list, so they cannot
// disagree. Only the page's lines get the full row and the stock check (route).
//
// KEYSET, NOT OFFSET. The cursor is the (sort value, doc_no, id) of the last line handed out: a line that a PO
// converts between two scrolls cannot shift the next page and skip a line.
//
// COUNTS AND TOTAL ARE UPPER BOUNDS. They are taken before the stock check. On production (19 Nov 2026) 4,993 of
// 5,121 live lines passed it, so they are close, but never offered as the count of lines still to order.
//
// FUNNEL VALUES ARE THE GRID'S OWN TEXT. The grid re-applies each funnel to the rows it holds, so `facetValue` must
// give the exact string the page's column hands the grid (PurchaseOrderFromSo.tsx), or a ticked row vanishes.
// ----------------------------------------------------------------------------

import { paginateAll, chunkIn } from './paginate-all';
import { readMfgProductBindings } from './supplier-bindings';
import { poPickerOffers } from './renovation-po-split';
import { categoryGroupOf } from '../shared/renovation-catalog';

/* eslint-disable @typescript-eslint/no-explicit-any -- the SCM routes carry an untyped supabase-js client */

export const PAGE_LIMIT_MAX = 200;
const PAGE_LIMIT_DEFAULT = 100;

export const PICKER_FACET_COLS = ['soDocNo', 'soRef', 'project', 'debtorName', 'itemGroup', 'mainSupplier', 'itemCode', 'description'] as const;
export type PickerFacetCol = typeof PICKER_FACET_COLS[number];
export const PICKER_SORT_COLS = [...PICKER_FACET_COLS, 'qty', 'poQtyPicked', 'processingDate', 'deliveryDate'] as const;
export type PickerSortCol = typeof PICKER_SORT_COLS[number];

export type DateFieldKey = 'soDate' | 'processing' | 'delivery';
export interface PickerSort { key: PickerSortCol; dir: 'asc' | 'desc' }
export type PickerFacets = Record<PickerFacetCol, Array<[string, number]>>;

export interface PageCursor { d: string; i: string; s?: string | number }

export interface OutstandingSoPageQuery {
  limit: number;
  cursor: PageCursor | null;
  q: string;
  category: string | null;
  dateField: DateFieldKey;
  dateFrom: string | null;
  dateTo: string | null;
  supplier: string | null;
  location: string | null;
  docNo: string | null;
  colFilters: Partial<Record<PickerFacetCol, string[]>>;
  sort: PickerSort | null;
}

/** One open SO line, as much of it as the funnels, the sort and the search read. */
export interface PickerLine {
  id: string; docNo: string; itemCode: string; description: string | null; itemGroup: string | null;
  qty: number; poQtyPicked: number;
  soDate: string | null; processingDate: string | null; deliveryDate: string | null;
  debtorName: string | null; ref: string | null; customerSoNo: string | null;
  projectCode: string | null; projectName: string | null;
  mainSupplierCode: string | null; mainSupplierName: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/* Funnel condition tokens (date / number rules) start with \u0001; the text columns the server filters never hold them. */
const CONDITION_TOKEN = '\u0001';

export function encodeCursor(k: PageCursor): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(k)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(raw: string | undefined | null): PageCursor | null {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const k: unknown = JSON.parse(decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))));
    if (!k || typeof k !== 'object') return null;
    const { d, i, s } = k as Record<string, unknown>;
    if (typeof d !== 'string' || typeof i !== 'string') return null;
    return typeof s === 'string' || typeof s === 'number' ? { d, i, s } : { d, i };
  } catch {
    return null;
  }
}

/** Search text as typed, minus the characters PostgREST or LIKE would read as syntax. */
export function cleanSearch(raw: string | undefined | null): string {
  return String(raw ?? '').replace(/["\\*%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const isFacetCol = (k: string): k is PickerFacetCol => (PICKER_FACET_COLS as readonly string[]).includes(k);
const isSortCol = (k: string): k is PickerSortCol => (PICKER_SORT_COLS as readonly string[]).includes(k);

/** `cols` is the grid's funnel state as JSON (`{"project":["KL 48"]}`). Columns the server does not know are left to
    the grid, which still applies them to the rows it holds. */
function parseColFilters(raw: string | undefined): Partial<Record<PickerFacetCol, string[]>> | null {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Partial<Record<PickerFacetCol, string[]>> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!isFacetCol(k) || !Array.isArray(v)) continue;
    const vals = v.filter((x): x is string => typeof x === 'string' && !x.startsWith(CONDITION_TOKEN));
    if (vals.length > 0) out[k] = vals;
  }
  return out;
}

function parseSort(raw: string | undefined): PickerSort | null {
  const [key, dir] = String(raw ?? '').split(':');
  return key && isSortCol(key) && (dir === 'asc' || dir === 'desc') ? { key, dir } : null;
}

/**
 * The paged mode's parameters, or `null` when the caller did not ask for a page (no `limit`): that caller gets the
 * whole list, unchanged. An unreadable cursor or funnel state is an error, not a silent first page.
 */
export function parseOutstandingSoPageQuery(query: Record<string, string | undefined>):
  { ok: true; page: OutstandingSoPageQuery | null } | { ok: false; reason: string } {
  if (query.limit == null || query.limit === '') return { ok: true, page: null };
  const n = Number(query.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(PAGE_LIMIT_MAX, Math.floor(n)) : PAGE_LIMIT_DEFAULT;
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) return { ok: false, reason: 'cursor is not one this server issued' };
  const colFilters = parseColFilters(query.cols);
  if (!colFilters) return { ok: false, reason: 'cols is not a column filter object' };
  const dateField: DateFieldKey = query.dateField === 'processing' || query.dateField === 'delivery' ? query.dateField : 'soDate';
  const date = (v: string | undefined): string | null => (v && ISO_DATE.test(v) ? v : null);
  const text = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);
  return {
    ok: true,
    page: {
      limit, cursor, q: cleanSearch(query.q),
      category: query.category && query.category !== 'all' ? query.category : null,
      dateField, dateFrom: date(query.dateFrom), dateTo: date(query.dateTo),
      supplier: text(query.supplier), location: text(query.location), docNo: text(query.docNo),
      colFilters, sort: parseSort(query.sort),
    },
  };
}

/** doc_no DESC, id ASC — the order of the whole list, and every sort's tie-break. */
export function compareKeys(a: { d: string; i: string }, b: { d: string; i: string }): number {
  if (a.d !== b.d) return a.d > b.d ? -1 : 1;
  return a.i < b.i ? -1 : a.i > b.i ? 1 : 0;
}

/* The grid's blank key (DataTable filterKeyOf): null and '' both read as an em dash. */
const keyOf = (v: string | null | undefined): string => (v == null || v === '' ? '—' : v);

/** The SO's own reference, by the one display rule (frontend lib/customer-ref.ts customerRefOf). */
const refText = (l: PickerLine): string => (l.ref || l.customerSoNo || '').trim();
const projectTitle = (l: PickerLine): string => l.projectName?.trim() || l.projectCode?.trim() || '';

/** The value a line shows in one column's funnel: the same text the page's column gives the grid. */
export function facetValue(l: PickerLine, col: PickerFacetCol): string {
  switch (col) {
    case 'soDocNo': return keyOf(l.docNo);
    case 'soRef': return refText(l) || '—';
    case 'project': return projectTitle(l) || '(none)';
    case 'debtorName': return keyOf(l.debtorName ?? '(none)');
    case 'itemGroup': return keyOf((l.itemGroup ?? '(none)').toUpperCase());
    case 'mainSupplier': return keyOf(l.mainSupplierName ?? l.mainSupplierCode ?? '(none)');
    case 'itemCode': return keyOf(l.itemCode);
    case 'description': return keyOf(l.description);
  }
}

function sortValue(l: PickerLine, key: PickerSortCol): string | number {
  switch (key) {
    case 'soDocNo': return l.docNo;
    case 'soRef': return refText(l);
    case 'project': return projectTitle(l);
    case 'debtorName': return l.debtorName ?? '';
    case 'itemGroup': return (l.itemGroup ?? '').toUpperCase();
    case 'mainSupplier': return l.mainSupplierName ?? l.mainSupplierCode ?? '';
    case 'itemCode': return l.itemCode;
    case 'description': return l.description ?? '';
    case 'qty': return l.qty;
    case 'poQtyPicked': return l.poQtyPicked;
    case 'processingDate': return l.processingDate ?? '';
    case 'deliveryDate': return l.deliveryDate ?? '';
  }
}

const compareValues = (a: string | number, b: string | number): number =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));

/** The search box, category and date range, applied as the screen applied them before. */
export function passesTopBar(l: PickerLine, page: OutstandingSoPageQuery): boolean {
  if (page.category) {
    const s = String(l.itemGroup ?? '').toUpperCase();
    const f = page.category.toUpperCase();
    if (!(s === f || categoryGroupOf(s) === f)) return false;
  }
  if (page.dateFrom || page.dateTo) {
    const d = page.dateField === 'soDate' ? l.soDate : page.dateField === 'processing' ? l.processingDate : l.deliveryDate;
    if (!d) return false;
    const day = String(d).slice(0, 10);
    if (page.dateFrom && day < page.dateFrom) return false;
    if (page.dateTo && day > page.dateTo) return false;
  }
  if (page.supplier && l.mainSupplierCode !== page.supplier) return false;
  if (page.q) {
    const q = page.q.toLowerCase();
    const hay = [l.docNo, l.itemCode, l.description, l.debtorName, l.ref, l.customerSoNo, l.projectCode, l.projectName];
    if (!hay.some((v) => v != null && v.toLowerCase().includes(q))) return false;
  }
  return true;
}

export interface PickerPage { ids: string[]; nextCursor: PageCursor | null; total: number; facets: PickerFacets | null }

/**
 * From the light list to one page. Each funnel's counts are taken under every OTHER funnel (the grid's own rule,
 * dataTableRows facetedFilterValues), so the choices narrow as filters are added. Facets come with the first page only.
 */
export function buildPickerPage(lines: readonly PickerLine[], page: OutstandingSoPageQuery): PickerPage {
  const active = (Object.entries(page.colFilters) as Array<[PickerFacetCol, string[]]>)
    .filter(([, v]) => v.length > 0)
    .map(([col, v]) => [col, new Set(v)] as const);
  const passes = (l: PickerLine, except: PickerFacetCol | null): boolean =>
    active.every(([col, set]) => col === except || set.has(facetValue(l, col)));

  const base = lines.filter((l) => passesTopBar(l, page));
  const matched = base.filter((l) => passes(l, null));

  let facets: PickerFacets | null = null;
  if (!page.cursor) {
    const built: Partial<PickerFacets> = {};
    for (const col of PICKER_FACET_COLS) {
      const counts = new Map<string, number>();
      for (const l of base) {
        if (!passes(l, col)) continue;
        const v = facetValue(l, col);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      built[col] = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    }
    facets = built as PickerFacets;
  }

  const { sort, cursor, limit } = page;
  const mul = sort?.dir === 'desc' ? -1 : 1;
  type Key = { s?: string | number; d: string; i: string };
  const cmp = (a: Key, b: Key): number => {
    if (sort) {
      const c = compareValues(a.s ?? '', b.s ?? '') * mul;
      if (c !== 0) return c;
    }
    return compareKeys(a, b);
  };
  const keyed = matched.map((l) => ({ id: l.id, d: l.docNo, i: l.id, s: sort ? sortValue(l, sort.key) : undefined }));
  keyed.sort(cmp);
  const start = cursor ? keyed.findIndex((k) => cmp(k, cursor) > 0) : 0;
  const from = start < 0 ? keyed.length : start;
  const slice = keyed.slice(from, from + limit);
  const last = slice.at(-1);
  const nextCursor = last && from + limit < keyed.length
    ? (last.s === undefined ? { d: last.d, i: last.i } : { d: last.d, i: last.i, s: last.s })
    : null;
  return { ids: slice.map((k) => k.id), nextCursor, total: matched.length, facets };
}

const INDEX_SELECT = `
      id, doc_no, item_code, description, item_group, qty, po_qty_picked, line_delivery_date,
      so:mfg_sales_orders!inner ( debtor_name, status, on_hold, so_date, customer_delivery_date, processing_date, sales_location, ref, customer_so_no, project_id )
    `;

interface IndexRow {
  id: string; doc_no: string; item_code: string; description: string | null; item_group: string | null;
  qty: number | string | null; po_qty_picked: number | string | null; line_delivery_date: string | null;
  so: {
    debtor_name: string | null; so_date: string | null; customer_delivery_date: string | null; processing_date: string | null;
    ref: string | null; customer_so_no: string | null; project_id: number | null;
  };
}

interface SupplierRef { code: string; name: string }
interface Bind { item_code: string; supplier: SupplierRef | SupplierRef[] | null }

/**
 * The light list: every open SO line in scope, with its project and main supplier, filtered by what the database can
 * filter (status, hold, SO, location, SO / processing date). Lines the picker never offers (works, services, client
 * supplied) are dropped, as the route drops them.
 */
export async function readPickerLines(
  sb: any,
  scopeQuery: (q: any) => any,
  companyId: number | null | undefined,
  page: OutstandingSoPageQuery,
): Promise<{ lines: PickerLine[]; error: string | null }> {
  const rows = await paginateAll<IndexRow>((from, to) => {
    let q = scopeQuery(sb.from('mfg_sales_order_items').select(INDEX_SELECT))
      .eq('cancelled', false)
      .not('so.status', 'in', '(CANCELLED,DRAFT,ON_HOLD)')
      .not('so.on_hold', 'is', true);
    if (page.docNo) q = q.eq('doc_no', page.docNo);
    if (page.location) q = q.eq('so.sales_location', page.location);
    if (page.dateField !== 'delivery') {
      const col = page.dateField === 'soDate' ? 'so.so_date' : 'so.processing_date';
      if (page.dateFrom) q = q.gte(col, page.dateFrom);
      if (page.dateTo) q = q.lte(col, page.dateTo);
    }
    return q.order('doc_no', { ascending: false }).order('id').range(from, to);
  });
  if (rows.error) return { lines: [], error: rows.error.message };
  const data = rows.data ?? [];

  const projectIds = [...new Set(data.map((r) => r.so.project_id).filter((id): id is number => id != null))];
  const codes = [...new Set(data.map((r) => r.item_code).filter(Boolean))];
  const [projects, binds] = await Promise.all([
    chunkIn<{ id: number; code: string | null; name: string | null }, number>(
      projectIds,
      (batch, from, to) => {
        const query = sb.schema('public').from('projects').select('id, code, name').in('id', batch);
        return (companyId == null ? query : query.eq('company_id', companyId)).order('id').range(from, to);
      },
    ),
    readMfgProductBindings<Bind>(sb, { codes, companyId, select: 'item_code, is_main_supplier, supplier:suppliers(code, name)' }),
  ]);
  if (projects.error) return { lines: [], error: `projects: ${projects.error.message}` };
  if (binds.error) return { lines: [], error: `supplier bindings: ${binds.error.message}` };

  const projectById = new Map<number, { code: string | null; name: string | null }>();
  for (const p of projects.data) projectById.set(Number(p.id), { code: p.code, name: p.name });
  // Bindings arrive main supplier first (readMfgProductBindings order), as the route reads them.
  const supplierByCode = new Map<string, SupplierRef>();
  for (const b of binds.data) {
    if (supplierByCode.has(b.item_code)) continue;
    const s = Array.isArray(b.supplier) ? b.supplier[0] : b.supplier;
    if (s) supplierByCode.set(b.item_code, s);
  }

  const lines: PickerLine[] = [];
  for (const r of data) {
    const supplier = supplierByCode.get(r.item_code);
    if (!poPickerOffers({ itemCode: r.item_code, itemGroup: r.item_group, mainSupplierCode: supplier?.code ?? null })) continue;
    const project = r.so.project_id == null ? undefined : projectById.get(Number(r.so.project_id));
    lines.push({
      id: r.id, docNo: r.doc_no, itemCode: r.item_code, description: r.description, itemGroup: r.item_group,
      qty: Number(r.qty ?? 0), poQtyPicked: Number(r.po_qty_picked ?? 0),
      soDate: r.so.so_date, processingDate: r.so.processing_date,
      deliveryDate: r.line_delivery_date ?? r.so.customer_delivery_date,
      debtorName: r.so.debtor_name, ref: r.so.ref, customerSoNo: r.so.customer_so_no,
      projectCode: project?.code ?? null, projectName: project?.name ?? null,
      mainSupplierCode: supplier?.code ?? null, mainSupplierName: supplier?.name ?? null,
    });
  }
  return { lines, error: null };
}
