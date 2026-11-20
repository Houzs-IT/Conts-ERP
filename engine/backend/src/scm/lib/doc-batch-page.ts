// ----------------------------------------------------------------------------
// ONE PAGE of a "pick lines from documents" picker, read a few documents at a time (audit 20 Nov 2026, batch 3).
//
// The same shape as the DO-from-SO picker (deliverable-so-page.ts), for the pickers whose source documents are
// keyed by a number of their own: GRN from PO (/grns/outstanding-po-items) and PI from GRN
// (/purchase-invoices/outstanding-grn-items). Without `limit` those endpoints still answer the whole list.
//
// - DOCUMENTS IN NUMBER ORDER, NEWEST FIRST, a batch at a time. The caller's `linesFor` works out each batch's lines
//   with the same rule as the whole list, and only lines with something left come back. A page holds whole
//   documents, so a supplier or currency lock always sees a document complete.
// - THE CURSOR is the last document number handed out, so a document finished between two scrolls cannot shift the
//   next page.
// - THE SEARCH matches the document's number, its supplier (name or code), or one of its lines (item code,
//   description). Line matches are collected once per request, up to LINE_MATCH_DOCS documents, so the header read
//   stays one URL-sized query.
// - EACH REQUEST IS BOUNDED (MAX_ROUNDS batches): the worker may make 50 outside calls per request on the free plan.
// ----------------------------------------------------------------------------

import { cleanSearch } from './outstanding-so-page';
import { escapeForOr } from './postgrest-search';

export const DOC_PAGE_MAX = 200;
const DOC_PAGE_DEFAULT = 100;
export const DOC_BATCH = 25;
export const MAX_ROUNDS = 2;
/** Documents a line match may add to one search: 200 uuids keep the header query near 8 KB. */
export const LINE_MATCH_DOCS = 200;
export const SUPPLIER_MATCH_MAX = 100;

export interface DocPageQuery { limit: number; cursor: string | null; q: string }

/** The paged mode's parameters, or null when the caller did not ask for a page (no `limit`). */
export function parseDocPageQuery(query: Record<string, string | undefined>): DocPageQuery | null {
  if (query.limit == null || query.limit === '') return null;
  const n = Number(query.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(DOC_PAGE_MAX, Math.floor(n)) : DOC_PAGE_DEFAULT;
  const cursor = query.cursor && query.cursor.trim() ? query.cursor.trim() : null;
  return { limit, cursor, q: cleanSearch(query.q) };
}

/**
 * The `.or()` filter for a search: the number column by text, plus the supplier ids and document ids the search
 * matched elsewhere. Null when nothing can match (the caller answers an empty page).
 */
export function docSearchOr(numberCol: string, q: string, supplierIds: readonly string[], docIds: readonly string[]): string | null {
  const s = escapeForOr(q);
  const parts: string[] = [];
  if (s) parts.push(`${numberCol}.ilike.%${s}%`);
  if (supplierIds.length > 0) parts.push(`supplier_id.in.(${supplierIds.join(',')})`);
  if (docIds.length > 0) parts.push(`id.in.(${docIds.join(',')})`);
  return parts.length > 0 ? parts.join(',') : null;
}

/** Distinct values in first-seen order, at most `max`. */
export function distinctCapped(values: ReadonlyArray<string | null | undefined>, max: number): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/**
 * Take whole documents, in `docOrder`, until at least `want` lines are held. `lastDoc` is the last document looked
 * at, `more` whether documents of this batch were left for the next page.
 */
export function takeWholeDocs<L>(
  docOrder: readonly string[], lines: readonly L[], docOf: (l: L) => string, want: number,
): { lines: L[]; lastDoc: string | null; more: boolean } {
  const byDoc = new Map<string, L[]>();
  for (const l of lines) {
    const k = docOf(l);
    const arr = byDoc.get(k) ?? [];
    arr.push(l);
    byDoc.set(k, arr);
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

/** One batch of candidate documents, newest first. `more`: documents may remain below the batch's last number. */
export interface DocBatch { docs: string[]; more: boolean; error: string | null }

/**
 * The page loop: read a batch of document numbers below the cursor, work out their lines, keep whole documents until
 * the page is full or MAX_ROUNDS batches were read. `nextCursor` is null when the list is done.
 */
export async function readDocPage<L>(args: {
  limit: number;
  cursor: string | null;
  readBatch: (after: string | null, n: number) => Promise<DocBatch>;
  linesFor: (docs: string[]) => Promise<{ lines: L[]; error: string | null }>;
  docOf: (l: L) => string;
}): Promise<{ lines: L[]; nextCursor: string | null; error: string | null }> {
  const picked: L[] = [];
  let cursor = args.cursor;
  let more = true;
  for (let round = 0; round < MAX_ROUNDS && picked.length < args.limit; round++) {
    const batch = await args.readBatch(cursor, DOC_BATCH);
    if (batch.error) return { lines: [], nextCursor: null, error: batch.error };
    if (batch.docs.length === 0) { more = false; break; }
    const got = await args.linesFor(batch.docs);
    if (got.error) return { lines: [], nextCursor: null, error: got.error };
    const took = takeWholeDocs(batch.docs, got.lines, args.docOf, args.limit - picked.length);
    picked.push(...took.lines);
    cursor = took.more ? took.lastDoc : batch.docs[batch.docs.length - 1]!;
    more = took.more || batch.more;
    if (!more) break;
  }
  return { lines: picked, nextCursor: more ? cursor : null, error: null };
}
