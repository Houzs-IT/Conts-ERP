// ----------------------------------------------------------------------------
// ONE PAGE of the PO-from-SO picker (owner, 19 Nov 2026: "show what I search first, or by scrolling; no need to load
// everything at once").
//
// `GET /mfg-purchase-orders/outstanding-so-items` without `limit` still answers the whole list
// (lib/outstanding-so-lines.ts) for the mobile convert wizard and the PO detail page. With `limit` it answers one page:
// this file reads the candidate SO lines for that page, in the same order as the whole list (doc_no DESC, id), with
// the search and the filters applied in the database where PostgREST can express them and in JavaScript where it
// cannot (category, delivery date). The route then runs the stock check (the MRP shortage) on the page's item codes
// only, and keeps the lines that still need a PO.
//
// KEYSET, NOT OFFSET. The cursor is the (doc_no, id) of the last line the server LOOKED AT, not a row number: a line
// that the stock check drops, or that a PO converts between two scrolls, cannot shift the next page and skip a line.
//
// THE TOTAL IS AN UPPER BOUND. `total` counts the open SO lines matching the search and the database filters before
// the stock check, the category filter and the delivery-date filter. On production (19 Nov 2026) 4,993 of 5,121 live
// lines passed the stock check, so it is close, but it is never offered as the count of lines still to order.
// ----------------------------------------------------------------------------

import { OUTSTANDING_SO_SELECT } from './outstanding-so-lines';
import { paginateAll, chunkSizeForUrl } from './paginate-all';
import { mapBounded } from './concurrency';
import { categoryGroupOf } from '../shared/renovation-catalog';

/* eslint-disable @typescript-eslint/no-explicit-any -- the SCM routes carry an untyped supabase-js client */

export const PAGE_LIMIT_MAX = 200;
const PAGE_LIMIT_DEFAULT = 100;
/* How many candidate windows one request may read while the JavaScript filters drop lines. Each window is one round
   trip; past this the page returns short and the cursor carries on from where it stopped. */
const MAX_WINDOWS = 5;
/* Header-matched documents per `doc_no.in.(...)` stream; more documents than one stream holds are read as parallel
   streams and merged, so a broad search is never cut to the first N documents. */
const SEARCH_STREAM_CONCURRENCY = 4;

export type DateFieldKey = 'soDate' | 'processing' | 'delivery';

export type OutstandingSoPageQuery = {
  limit: number;
  cursor: { d: string; i: string } | null;
  q: string;
  category: string | null;
  dateField: DateFieldKey;
  dateFrom: string | null;
  dateTo: string | null;
  supplier: string | null;
  location: string | null;
  docNo: string | null;
};

export type CandidateKey = { d: string; i: string };

export type CandidateRow = {
  id: string; doc_no: string; item_group: string | null; line_delivery_date: string | null;
  so: { status: string; on_hold: boolean | null; so_date: string | null; processing_date: string | null; customer_delivery_date: string | null };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function encodeCursor(k: CandidateKey): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(k)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(raw: string | undefined | null): CandidateKey | null {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const k = JSON.parse(decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))))) as Partial<CandidateKey>;
    return typeof k.d === 'string' && typeof k.i === 'string' ? { d: k.d, i: k.i } : null;
  } catch {
    return null;
  }
}

/** Search text as typed, minus the characters PostgREST or LIKE would read as syntax. */
export function cleanSearch(raw: string | undefined | null): string {
  return String(raw ?? '').replace(/["\\*%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/**
 * The paged mode's parameters, or `null` when the caller did not ask for a page (no `limit`): that caller gets the
 * whole list, unchanged. An unreadable cursor is an error, not a silent first page.
 */
export function parseOutstandingSoPageQuery(query: Record<string, string | undefined>):
  { ok: true; page: OutstandingSoPageQuery | null } | { ok: false; reason: string } {
  if (query.limit == null || query.limit === '') return { ok: true, page: null };
  const n = Number(query.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(PAGE_LIMIT_MAX, Math.floor(n)) : PAGE_LIMIT_DEFAULT;
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) return { ok: false, reason: 'cursor is not one this server issued' };
  const dateField: DateFieldKey = query.dateField === 'processing' || query.dateField === 'delivery' ? query.dateField : 'soDate';
  const date = (v: string | undefined) => (v && ISO_DATE.test(v) ? v : null);
  const text = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    ok: true,
    page: {
      limit, cursor, q: cleanSearch(query.q),
      category: query.category && query.category !== 'all' ? query.category : null,
      dateField, dateFrom: date(query.dateFrom), dateTo: date(query.dateTo),
      supplier: text(query.supplier), location: text(query.location), docNo: text(query.docNo),
    },
  };
}

const quote = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const keyOf = (r: CandidateRow): CandidateKey => ({ d: r.doc_no, i: r.id });

/** doc_no DESC, id ASC — the order of the whole list, so page 1 + page 2 + ... reads as the old screen did. */
export function compareKeys(a: CandidateKey, b: CandidateKey): number {
  if (a.d !== b.d) return a.d > b.d ? -1 : 1;
  return a.i < b.i ? -1 : a.i > b.i ? 1 : 0;
}

/** The filters PostgREST cannot express, applied exactly as the screen applied them before (PurchaseOrderFromSo.tsx). */
export function passesPageFilters(r: CandidateRow, page: OutstandingSoPageQuery): boolean {
  if (page.category) {
    const s = String(r.item_group ?? '').toUpperCase();
    const f = page.category.toUpperCase();
    if (!(s === f || categoryGroupOf(s) === f)) return false;
  }
  if (page.dateFrom || page.dateTo) {
    const d = page.dateField === 'soDate' ? r.so?.so_date
      : page.dateField === 'processing' ? r.so?.processing_date
      : (r.line_delivery_date ?? r.so?.customer_delivery_date);
    if (!d) return false;
    const day = String(d).slice(0, 10);
    if (page.dateFrom && day < page.dateFrom) return false;
    if (page.dateTo && day > page.dateTo) return false;
  }
  return true;
}

/**
 * The documents whose header matches the search: customer, ref, customer SO no., or the project's code or name.
 * Two reads (projects, then sales-order headers), both paged so nothing past PostgREST's row cap is dropped.
 */
async function headerMatchedDocs(sb: any, scopeQuery: (q: any) => any, companyId: number | null | undefined, term: string):
  Promise<{ docs: string[]; error: string | null }> {
  const like = quote(`*${term}*`);
  const projects = await paginateAll<{ id: number }>((from, to) => {
    const q = sb.schema('public').from('projects').select('id').or(`code.ilike.${like},name.ilike.${like}`);
    return (companyId == null ? q : q.eq('company_id', companyId)).order('id').range(from, to);
  });
  if (projects.error) return { docs: [], error: projects.error.message };
  const projectIds = (projects.data ?? []).map((p) => Number(p.id)).filter(Number.isFinite);
  const terms = [`debtor_name.ilike.${like}`, `ref.ilike.${like}`, `customer_so_no.ilike.${like}`];
  if (projectIds.length > 0) terms.push(`project_id.in.(${projectIds.join(',')})`);
  const heads = await paginateAll<{ doc_no: string }>((from, to) => scopeQuery(sb.from('mfg_sales_orders').select('doc_no'))
    .or(terms.join(','))
    .not('status', 'in', '(CANCELLED,DRAFT,ON_HOLD)')
    .order('doc_no')
    .range(from, to));
  if (heads.error) return { docs: [], error: heads.error.message };
  return { docs: [...new Set((heads.data ?? []).map((h) => h.doc_no).filter(Boolean))], error: null };
}

type Window = { rows: CandidateRow[]; more: boolean; total: number | null; error: string | null };

/**
 * Read the page's candidate lines: the first `limit` lines after `cursor` that pass every filter, reading at most
 * MAX_WINDOWS windows. `nextCursor` is the key of the last line looked at (null once the list is exhausted).
 * `total` is counted on the first page only.
 */
export async function readOutstandingSoCandidates<T extends CandidateRow>(
  sb: any,
  scopeQuery: (q: any) => any,
  companyId: number | null | undefined,
  page: OutstandingSoPageQuery,
): Promise<{ rows: T[]; nextCursor: CandidateKey | null; total: number | null; reads: number; error: string | null }> {
  let reads = 0;
  let docChunks: string[][] = [];
  const lineTerms: string[] = [];
  if (page.q) {
    const header = await headerMatchedDocs(sb, scopeQuery, companyId, page.q);
    reads += 2;
    if (header.error) return { rows: [], nextCursor: null, total: null, reads, error: header.error };
    const like = quote(`*${page.q}*`);
    lineTerms.push(`doc_no.ilike.${like}`, `item_code.ilike.${like}`, `description.ilike.${like}`);
    const size = Math.max(1, Math.min(150, chunkSizeForUrl(header.docs)));
    for (let i = 0; i < header.docs.length; i += size) docChunks.push(header.docs.slice(i, i + size));
  }
  if (docChunks.length === 0) docChunks = [[]];
  const windowSize = Math.min(400, page.limit * 2);

  const stream = async (after: CandidateKey | null, docs: string[], withCount: boolean) => {
    const groups: string[] = [];
    if (after) groups.push(`or(doc_no.lt.${quote(after.d)},and(doc_no.eq.${quote(after.d)},id.gt.${quote(after.i)}))`);
    if (page.q) {
      const terms = [...lineTerms];
      if (docs.length > 0) terms.push(`doc_no.in.(${docs.map(quote).join(',')})`);
      groups.push(`or(${terms.join(',')})`);
    }
    let q = scopeQuery(sb.from('mfg_sales_order_items').select(OUTSTANDING_SO_SELECT, withCount ? { count: 'exact' } : undefined))
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
    if (groups.length === 1) q = q.or(groups[0].replace(/^or\((.*)\)$/, '$1'));
    else if (groups.length > 1) q = q.or(`and(${groups.join(',')})`);
    const res = await q.order('doc_no', { ascending: false }).order('id').range(0, windowSize - 1);
    return res as { data: CandidateRow[] | null; error: { message: string } | null; count: number | null };
  };

  const readWindow = async (after: CandidateKey | null, withCount: boolean): Promise<Window> => {
    const results = await mapBounded(docChunks, SEARCH_STREAM_CONCURRENCY, (docs) => stream(after, docs, withCount && docChunks.length === 1));
    reads += results.length;
    const failed = results.find((r) => r.error);
    if (failed?.error) return { rows: [], more: false, total: null, error: failed.error.message };
    if (results.length === 1) {
      const rows = results[0].data ?? [];
      return { rows, more: rows.length === windowSize, total: results[0].count ?? null, error: null };
    }
    /* Several streams: the merge is exact up to the smallest last key among the streams that came back full; past it
       a full stream may still hold lines that sort earlier. */
    let cut: CandidateKey | null = null;
    for (const r of results) {
      const rows = r.data ?? [];
      if (rows.length === windowSize) {
        const last = keyOf(rows[rows.length - 1]);
        if (!cut || compareKeys(last, cut) < 0) cut = last;
      }
    }
    const byId = new Map<string, CandidateRow>();
    for (const r of results) for (const row of r.data ?? []) byId.set(row.id, row);
    const merged = [...byId.values()].sort((a, b) => compareKeys(keyOf(a), keyOf(b)))
      .filter((row) => !cut || compareKeys(keyOf(row), cut) <= 0);
    return { rows: merged, more: cut != null, total: null, error: null };
  };

  const picked: T[] = [];
  let after = page.cursor;
  let lastSeen: CandidateKey | null = page.cursor;
  let exhausted = false;
  let total: number | null = null;
  for (let w = 0; w < MAX_WINDOWS && picked.length < page.limit; w++) {
    const win = await readWindow(after, w === 0 && page.cursor == null);
    if (win.error) return { rows: [], nextCursor: null, total: null, reads, error: win.error };
    if (w === 0) total = win.total;
    for (const row of win.rows) {
      lastSeen = keyOf(row);
      if (!passesPageFilters(row, page)) continue;
      picked.push(row as T);
      if (picked.length >= page.limit) break;
    }
    if (picked.length >= page.limit) break;
    if (!win.more) { exhausted = true; break; }
    after = lastSeen;
  }
  return { rows: picked, nextCursor: exhausted ? null : lastSeen, total, reads, error: null };
}
