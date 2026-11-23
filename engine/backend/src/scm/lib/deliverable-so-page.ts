// ----------------------------------------------------------------------------
// ONE PAGE of the DO-from-SO picker (audit 20 Nov 2026).
//
// GET /delivery-orders-mfg/deliverable-so-lines without `limit` still answers every deliverable line of every
// non-cancelled SO (or of ?docNos=). That read every SO the company ever had (about 10,000, nearly all fully
// delivered), worked out each line's remaining quantity, and left the browser to drop the finished ones, on every
// visit. With `limit` it answers one page:
//
// - SALES ORDERS IN DOC-NUMBER ORDER, NEWEST FIRST, a few at a time. Each batch gets the same live remaining check
//   (soDeliverableRemaining) and only lines with something left are kept. A page holds whole orders, so the
//   one-customer lock and the ready-line pre-tick always see an order complete.
// - THE CURSOR is the last doc number handed out: an order delivered between two scrolls cannot shift the next page.
// - THE BROWSE SKIPS orders whose status says nothing is left to send: DELIVERED and INVOICED (the delivery sync
//   flips an order to DELIVERED only when every line is covered, and reopens it on a return or a cancelled DO), plus
//   the four statuses a DO may not be raised from (DRAFT, CANCELLED, ON_HOLD, CLOSED). A SEARCH skips only
//   CANCELLED, as the whole list did, so an order whose status drifted can still be found by its number.
// - THE SEARCH matches the order (number, customer, customer code, reference, customer PO) or one of its lines
//   (item code, description).
// - EACH REQUEST IS BOUNDED (MAX_ROUNDS batches): the worker may make 50 outside calls per request on the free plan.
//   A short page still carries a cursor; the screen asks for the next when it scrolls.
// ----------------------------------------------------------------------------

import { scopeToCompany, type CompanyScopeCtx } from './companyScope';
import { cleanSearch } from './outstanding-so-page';
import { escapeForOr } from './postgrest-search';

/* eslint-disable @typescript-eslint/no-explicit-any -- the SCM routes carry an untyped supabase-js client */

export const DELIVERABLE_PAGE_MAX = 200;
const DELIVERABLE_PAGE_DEFAULT = 100;
/** Orders read per batch, and batches per request. */
export const DOC_BATCH = 25;
export const MAX_ROUNDS = 2;

export const BROWSE_SKIP_STATUSES = ['CANCELLED', 'DRAFT', 'ON_HOLD', 'CLOSED', 'DELIVERED', 'INVOICED'] as const;

export interface DeliverablePageQuery { limit: number; cursor: string | null; q: string }

/** The paged mode's parameters, or null when the caller did not ask for a page (no `limit`). */
export function parseDeliverablePageQuery(query: Record<string, string | undefined>): DeliverablePageQuery | null {
  if (query.limit == null || query.limit === '') return null;
  const n = Number(query.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(DELIVERABLE_PAGE_MAX, Math.floor(n)) : DELIVERABLE_PAGE_DEFAULT;
  const cursor = query.cursor && query.cursor.trim() ? query.cursor.trim() : null;
  return { limit, cursor, q: cleanSearch(query.q) };
}

/**
 * The next `n` candidate doc numbers, newest first, from sources merged by keyset: orders whose header matches, and
 * orders with a matching line. A source that was read to its limit carries a `floor` (the last doc number it reached):
 * below it, that source may have more it did not read. The union is cut at the highest floor, so nothing in the
 * result can be missing a doc number that sorts between two it holds.
 */
export function mergeCandidateDocs(sources: Array<{ docs: string[]; floor: string | null }>, n: number): CandidateBatch {
  const all = [...new Set(sources.flatMap((s) => s.docs))].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const floors = sources.map((s) => s.floor).filter((f): f is string => f != null);
  const floor = floors.length > 0 ? floors.reduce((a, b) => (a > b ? a : b)) : null;
  const kept = floor == null ? all : all.filter((d) => d >= floor);
  if (kept.length > n) return { docs: kept.slice(0, n), more: true, scannedTo: kept[n - 1]! };
  /* Everything at or above the floor was seen, so the next read may start below it even when none of it qualified. */
  return { docs: kept, more: floor != null, scannedTo: floor ?? kept[kept.length - 1] ?? null };
}

/** One batch of candidate orders. `more`: orders may remain past `scannedTo`, the lowest doc number fully examined
    (the next read starts below it). */
export interface CandidateBatch { docs: string[]; more: boolean; scannedTo: string | null }

/** Read the next batch of candidate SOs (see the header for which statuses and which search). */
export async function readCandidateDocs(
  sb: any, c: CompanyScopeCtx, opts: { after: string | null; q: string; n: number },
): Promise<CandidateBatch & { error: string | null }> {
  const head = () => {
    let q = scopeToCompany(sb.from('mfg_sales_orders').select('doc_no'), c);
    q = opts.q ? q.neq('status', 'CANCELLED') : q.not('status', 'in', `(${BROWSE_SKIP_STATUSES.join(',')})`);
    if (opts.after) q = q.lt('doc_no', opts.after);
    return q;
  };
  const s = opts.q ? escapeForOr(opts.q) : '';
  if (!s) {
    const { data, error } = await head().order('doc_no', { ascending: false }).limit(opts.n);
    if (error) return { docs: [], more: false, scannedTo: null, error: error.message };
    const docs = ((data ?? []) as Array<{ doc_no: string }>).map((r) => r.doc_no).filter(Boolean);
    return { docs, more: docs.length >= opts.n, scannedTo: docs[docs.length - 1] ?? null, error: null };
  }
  const byHeader = head()
    .or([`doc_no.ilike.%${s}%`, `debtor_name.ilike.%${s}%`, `debtor_code.ilike.%${s}%`, `ref.ilike.%${s}%`, `customer_so_no.ilike.%${s}%`].join(','))
    .order('doc_no', { ascending: false }).limit(opts.n);
  /* Lines repeat their order, so read a few per order to see `n` orders. */
  const lineRead = opts.n * 4;
  let lines = sb.from('mfg_sales_order_items').select('doc_no').eq('cancelled', false)
    .or([`item_code.ilike.%${s}%`, `description.ilike.%${s}%`].join(','));
  if (opts.after) lines = lines.lt('doc_no', opts.after);
  const [h, l] = await Promise.all([byHeader, lines.order('doc_no', { ascending: false }).limit(lineRead)]);
  if (h.error) return { docs: [], more: false, scannedTo: null, error: h.error.message };
  if (l.error) return { docs: [], more: false, scannedTo: null, error: l.error.message };
  const headerDocs = ((h.data ?? []) as Array<{ doc_no: string }>).map((r) => r.doc_no).filter(Boolean);
  const lineRows = ((l.data ?? []) as Array<{ doc_no: string }>).map((r) => r.doc_no).filter(Boolean);
  const lineDocs = [...new Set(lineRows)];
  /* A line match counts only for an order in this company and status: read those headers back. */
  let allowedLineDocs: string[] = [];
  if (lineDocs.length > 0) {
    const back = await head().in('doc_no', lineDocs).limit(lineDocs.length);
    if (back.error) return { docs: [], more: false, scannedTo: null, error: back.error.message };
    allowedLineDocs = ((back.data ?? []) as Array<{ doc_no: string }>).map((r) => r.doc_no).filter(Boolean);
  }
  /* The line read's floor is its own last row, whether or not that order passed the header check. */
  const batch = mergeCandidateDocs([
    { docs: headerDocs, floor: headerDocs.length >= opts.n ? headerDocs[headerDocs.length - 1]! : null },
    { docs: allowedLineDocs, floor: lineRows.length >= lineRead ? lineRows[lineRows.length - 1]! : null },
  ], opts.n);
  return { ...batch, error: null };
}

/**
 * Take whole orders, in `docOrder`, until at least `want` lines are held. `lastDoc` is the last order looked at (the
 * cursor), `more` whether orders of this batch were left for the next page.
 */
export function takeWholeOrders<L extends { docNo: string }>(
  docOrder: readonly string[], lines: readonly L[], want: number,
): { lines: L[]; lastDoc: string | null; more: boolean } {
  const byDoc = new Map<string, L[]>();
  for (const l of lines) {
    const arr = byDoc.get(l.docNo) ?? [];
    arr.push(l);
    byDoc.set(l.docNo, arr);
  }
  const out: L[] = [];
  let lastDoc: string | null = null;
  for (let i = 0; i < docOrder.length; i++) {
    const doc = docOrder[i]!;
    out.push(...(byDoc.get(doc) ?? []));
    lastDoc = doc;
    if (out.length >= want) return { lines: out, lastDoc, more: i < docOrder.length - 1 };
  }
  return { lines: out, lastDoc, more: false };
}
